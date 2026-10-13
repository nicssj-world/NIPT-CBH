import {describe,it,expect,beforeAll,afterAll} from 'vitest';
import type {PGlite} from '@electric-sql/pglite';
import {testDatabase,addUser} from '../helpers/database';
import {appendAudit,verifyAuditChain} from '../../packages/db/audit';
import {historicalAuditEvent} from '../../packages/historical/audit';

/**
 * P5H regression on the CURRENT schema (no P5H migration exists yet — see docs/p5h-historical-backfill-foundation.md §9).
 * These tests prove that the fail-closed P1/P3/P5 database guards which historical backfill depends on are in force, so that the
 * pure foundation cannot be bypassed through the database. They create no new schema and run only against a disposable PGlite database.
 */
let db:PGlite;
const KEY='b'.repeat(64);
beforeAll(async()=>{db=await testDatabase();});
afterAll(async()=>{await db.close();});

describe('P5H fail-closed database guards (AT-HIST-02/04/06/11/13 — database part)',()=>{
 it('a HISTORICAL case cannot be inserted (promotion stays disabled until a reviewed migration)',async()=>{
  await expect(db.query("INSERT INTO nipt_case(registration_origin,identity_key) VALUES('HISTORICAL',$1)",[KEY])).rejects.toThrow(/historical promotion disabled/);
 });
 it('AT-HIST-06: an existing ANC / LAB_DIRECT case cannot be converted to HISTORICAL',async()=>{
  const c=(await db.query<{id:string}>("INSERT INTO nipt_case(registration_origin,identity_key) VALUES('ANC',$1) RETURNING id",['c'.repeat(64)])).rows[0].id;
  await expect(db.query("UPDATE nipt_case SET registration_origin='HISTORICAL' WHERE id=$1",[c])).rejects.toThrow(/immutable origin and identity/);
  const d=(await db.query<{id:string}>("INSERT INTO nipt_case(registration_origin,identity_key) VALUES('LAB_DIRECT',$1) RETURNING id",['d'.repeat(64)])).rows[0].id;
  await expect(db.query("UPDATE nipt_case SET registration_origin='HISTORICAL' WHERE id=$1",[d])).rejects.toThrow(/immutable origin and identity/);
 });
 it('even if case creation were bypassed in a disposable database, a HISTORICAL case can never get a specimen round, so no attempt, batch, QC, report, release or export chain can exist',async()=>{
  const scratch=await testDatabase();
  try{
   await scratch.query("ALTER TABLE nipt_case DISABLE TRIGGER case_guard");   // simulates the future, reviewed promotion path only
   const c=(await scratch.query<{id:string}>("INSERT INTO nipt_case(registration_origin,identity_key) VALUES('HISTORICAL',$1) RETURNING id",[KEY])).rows[0].id;
   const ln=(await scratch.query<{id:string}>("INSERT INTO case_ln(case_id,ln,source,verification) VALUES($1,'2600100099','HISTORICAL_DOCUMENT','DOCUMENT_VERIFIED') RETURNING id",[c])).rows[0].id;
   await expect(scratch.query("INSERT INTO specimen_round(case_id,case_ln_id,round_number) VALUES($1,$2,1)",[c,ln])).rejects.toThrow(/historical downstream prohibited/);
   // case_ln lineage and PET verification cannot be forged for it either.
   await expect(scratch.query("UPDATE case_ln SET verification='VERIFIED_BY_PET' WHERE id=$1",[ln])).rejects.toThrow(/PET/);
   await expect(scratch.query("UPDATE case_ln SET source='ANC_ENTRY' WHERE id=$1",[ln])).rejects.toThrow(/immutable LN lineage/);
  }finally{await scratch.close();}
 });
 it('a DOCUMENT_VERIFIED / HISTORICAL_DOCUMENT LN is refused for any current (ANC / LAB_DIRECT) case',async()=>{
  const c=(await db.query<{id:string}>("INSERT INTO nipt_case(registration_origin,identity_key) VALUES('ANC',$1) RETURNING id",['e'.repeat(64)])).rows[0].id;
  await expect(db.query("INSERT INTO case_ln(case_id,ln,source,verification) VALUES($1,'2600100098','HISTORICAL_DOCUMENT','DOCUMENT_VERIFIED')",[c])).rejects.toThrow(/LN begins awaiting PET/);
 });
 it('AT-HIST-14/OD-27 interim: go_live_cutoff cannot be activated once a HISTORICAL case exists',async()=>{
  const scratch=await testDatabase();
  try{
   const maker=await addUser(scratch,'LAB_STAFF','p5h.maker');const checker=await addUser(scratch,'CLINICAL_APPROVER','p5h.checker');
   const rev=async(version:number)=>(await scratch.query<{id:string}>(
    "INSERT INTO settings_revision(setting_key,version,category,risk,value,state,created_by,approved_by,reason,test_passed) VALUES('go_live_cutoff',$1,'Result Management','CLINICAL',$2,'Approved',$3,$4,'synthetic regression',true) RETURNING id",
    [version,JSON.stringify({cutoff:'2026-01-01',impactReportHash:'a'.repeat(64)}),maker.id,checker.id])).rows[0].id;
   // With no historical case the guard allows activation (first activation is the Owner-approved cutoff in a real run).
   await scratch.query("INSERT INTO setting_active(setting_key,revision_id) VALUES('go_live_cutoff',$1)",[await rev(1)]);
   await scratch.query("ALTER TABLE nipt_case DISABLE TRIGGER case_guard");
   await scratch.query("INSERT INTO nipt_case(registration_origin,identity_key) VALUES('HISTORICAL',$1)",[KEY]);
   await expect(scratch.query("UPDATE setting_active SET revision_id=$1 WHERE setting_key='go_live_cutoff'",[await rev(2)])).rejects.toThrow(/OD27_REQUIRED/);
  }finally{await scratch.close();}
 });
 it('P5H audit events chain without any identifying value',async()=>{
  const actor=await addUser(db,'LAB_STAFF','p5h.audit');
  const e=historicalAuditEvent({actorId:actor.id,action:'HIST_PROMOTE_REJECTED',resourceType:'HISTORICAL_DRAFT',outcome:'REJECTED',reasonCode:'SELF_VERIFICATION_PROHIBITED',version:1});
  await appendAudit(db,e);
  await appendAudit(db,historicalAuditEvent({actorId:actor.id,action:'HIST_OUTBOUND_BLOCKED',resourceType:'OUTBOUND',outcome:'DENIED',reasonCode:'HISTORICAL_OUTBOUND_PROHIBITED'}));
  const rows=(await db.query<{previous_hash:string;hash:string;payload:string;action:string;details:Record<string,unknown>}>("SELECT previous_hash,hash,payload,action,details FROM audit_chain ORDER BY sequence")).rows;
  expect(verifyAuditChain(rows)).toBe(true);
  const mine=rows.filter(r=>r.action.startsWith('HIST_'));
  expect(mine.map(r=>r.action)).toEqual(['HIST_PROMOTE_REJECTED','HIST_OUTBOUND_BLOCKED']);
  for(const r of mine)expect(JSON.stringify(r.details)).not.toMatch(/\d{6,}|SYN-HN|Synthetic Patient/);
 });
});
