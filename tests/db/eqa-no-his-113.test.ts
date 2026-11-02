import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import type {PGlite} from '@electric-sql/pglite';
import {randomUUID,createHash} from 'node:crypto';
import {testDatabase} from '../helpers/database';
import {labUsers,syntheticCase,receiveS1} from '../helpers/lab';

let db:PGlite,u:Awaited<ReturnType<typeof labUsers>>;
beforeAll(async()=>{db=await testDatabase();u=await labUsers(db);});
afterAll(async()=>{await db?.close();});

const sha=()=>createHash('sha256').update(randomUUID()).digest('hex');
const classify=(c:{caseId:string;roundId:string},o:{sample?:string;actor?:string}={})=>db.query(
 `INSERT INTO eqa_case(case_id,round_id,organizer,program_year,sample_ref,surname,first_name,dob,ga_weeks,ga_days,collection_date,pregnancy,note,registered_by)
  VALUES($1,$2,'SYNTHETIC-ORGANIZER',2026,$3,'POLSON','Tonya','1988-08-23',11,1,'2026-10-19','Singleton',NULL,$4)`,[c.caseId,c.roundId,o.sample??'S-'+randomUUID().slice(0,8),o.actor??u.staff.id]);
const eqaCase=async()=>{const c=await syntheticCase(db,u,{evidence:false});await classify(c);return c;};
/** A released version for a case. Trigger-free fixture insert, mirroring tests/db/archive-native.test.ts. */
async function release(caseId:string,roundId:string){
 const v=randomUUID(),rel=randomUUID();
 await db.exec('BEGIN');
 try{
  await db.exec('SET LOCAL session_replication_role=replica');
  await db.query("INSERT INTO file_asset(sha256,byte_size,media_type,storage_key) VALUES($1,10,'application/pdf',$1) ON CONFLICT DO NOTHING",[v.replaceAll('-','').padEnd(64,'0')]);
  await db.query("INSERT INTO result_report_version(id,intake_file_id,sha256,kind,template_kind,template_version,parser_version,parsed,case_id,round_id,imported_by) VALUES($1,$2,$3,'RESULT','SINGLETON','fixture','fixture','{}',$4,$5,$6)",[v,randomUUID(),v.replaceAll('-','').padEnd(64,'0'),caseId,roundId,u.staff.id]);
  await db.query("INSERT INTO result_release(id,version_id,case_id,round_id,kind,channel,certified_by) VALUES($1,$2,$3,$4,'RESULT','NIPT_ANC_VIEW',$5)",[rel,v,caseId,roundId,u.certifier.id]);
  await db.exec('COMMIT');
 }catch(e){await db.exec('ROLLBACK');throw e;}
 return {versionId:v,releaseId:rel};
}
const code=(p:Promise<unknown>)=>p.then(()=>'OK',e=>String((e as Error).message));
const outbox=(payload:unknown,kind='result_release_completed')=>code(db.query('INSERT INTO job_outbox(kind,payload,idempotency_key) VALUES($1,$2,$3)',[kind,JSON.stringify(payload),randomUUID()]));

describe('EQA classification',()=>{
 it('registers a new LAB_DIRECT case and is immutable',async()=>{
  const c=await syntheticCase(db,u,{evidence:false});
  await classify(c);
  expect(await code(db.query('UPDATE eqa_case SET organizer=\'X\' WHERE case_id=$1',[c.caseId]))).toMatch(/append-only/i);
  expect(await code(db.query('DELETE FROM eqa_case WHERE case_id=$1',[c.caseId]))).toMatch(/append-only/i);
  expect(await code(classify(c))).toMatch(/duplicate|unique/i);
 });
 it('refuses a case that already has HIS PET evidence (a real patient cannot be reclassified)',async()=>{
  const c=await syntheticCase(db,u,{evidence:false});
  await receiveS1(db,c);
  expect(await code(classify(c))).toMatch(/EQA_REQUIRES_NEW_LAB_DIRECT_CASE|EQA_CASE_HAS_PATIENT_EVIDENCE/);
 });
 it('refuses a case that already has a released result, and an unknown or disabled actor',async()=>{
  const c=await syntheticCase(db,u,{evidence:false});
  await release(c.caseId,c.roundId);
  expect(await code(classify(c))).toMatch(/EQA_CASE_HAS_PATIENT_EVIDENCE/);
  const d=await syntheticCase(db,u,{evidence:false});
  expect(await code(classify(d,{actor:randomUUID()}))).toMatch(/foreign key|EQA_ACTOR_INVALID/i);
 });
 it('a PET that arrives later cannot become a HIS receipt for an EQA case',async()=>{
  const c=await eqaCase();
  expect(await code(receiveS1(db,c))).toMatch(/EQA_CASE_REJECTS_HIS_RECEIPT/);
 });
});

describe('EQA never reaches a HIS outbound pathway',()=>{
 it('p6_transfer: no transfer can be reserved for an EQA release (direct write, forged or replayed)',async()=>{
  const c=await eqaCase(),r=await release(c.caseId,c.roundId);
  const insert=(extra='')=>code(db.query(`INSERT INTO p6_transfer(authority,clinical_release_id,ln,ln_generation,report_version_id,sequence,res_destination,pdf_destination,res_name,pdf_name,plan,model,gate${extra})
   VALUES('CERTIFIED_RESULT',$1,'1',1,'V',1,'r','p','a.res','a.pdf','{}','{"hisConfirmed":"false"}','{}')`,[r.releaseId]));
  expect(await insert()).toMatch(/EQA_NO_HIS_TRANSFER/);
  expect(await insert()).toMatch(/EQA_NO_HIS_TRANSFER/);
 });
 it('job_outbox: any job naming the EQA case, release, version or transfer is refused; unrelated jobs are not',async()=>{
  const c=await eqaCase(),r=await release(c.caseId,c.roundId);
  expect(await outbox({releaseId:r.releaseId})).toMatch(/EQA_NO_HIS_OUTBOUND/);
  expect(await outbox({versionId:r.versionId})).toMatch(/EQA_NO_HIS_OUTBOUND/);
  expect(await outbox({caseId:c.caseId},'synthetic_outbound_retry')).toMatch(/EQA_NO_HIS_OUTBOUND/);
  expect(await outbox({transferId:randomUUID()},'synthetic_outbound_retry')).toBe('OK');
  expect(await outbox({releaseId:'not-a-uuid'})).toBe('OK');
  expect(await outbox('a string payload')).toBe('OK');
 });
 it('a non-EQA patient release is unaffected by the guards',async()=>{
  const c=await syntheticCase(db,u,{evidence:false}),r=await release(c.caseId,c.roundId);
  expect(await outbox({releaseId:r.releaseId})).toBe('OK');
  const attempt=await code(db.query(`INSERT INTO p6_transfer(authority,clinical_release_id,ln,ln_generation,report_version_id,sequence,res_destination,pdf_destination,res_name,pdf_name,plan,model,gate)
   VALUES('CERTIFIED_RESULT',$1,'1',1,'V',1,'r','p','a.res','a.pdf','{}','{"hisConfirmed":"false"}','{}')`,[r.releaseId]));
  expect(attempt).not.toMatch(/EQA_/);
 });
 it('p6_release_eligible is wrapped (not replaced): it still delegates to the composed function and excludes EQA',async()=>{
  const def=(await db.query<{src:string}>("SELECT prosrc src FROM pg_proc WHERE proname='p6_release_eligible'")).rows[0].src;
  expect(def).toContain('eqa_unfiltered_release_eligible');
  expect(def).toContain('eqa_case');
  const inner=(await db.query<{src:string}>("SELECT prosrc src FROM pg_proc WHERE proname='eqa_unfiltered_release_eligible'")).rows[0].src;
  expect(inner).toContain('migration_presence_unfiltered_release_eligible');
 });
});

describe('EQA is kept out of the patient NAS archive until a storage policy is verified',()=>{
 it('archives a normal release but creates no archive job for an EQA release',async()=>{
  const {runArchiveCycle}=await import('../../packages/results/archive-worker');
  const eqa=await eqaCase(),normal=await syntheticCase(db,u,{evidence:false});
  const a=await release(eqa.caseId,eqa.roundId),b=await release(normal.caseId,normal.roundId);
  await db.exec('BEGIN');
  try{
   await db.exec('SET LOCAL session_replication_role=replica');
   await db.query("INSERT INTO pdf_archive_window(root_path,activated_by,activated_at) VALUES('synthetic-root',$1,clock_timestamp()-interval '2 hours')",[u.staff.id]);
   await db.query("UPDATE pdf_archive_config SET enabled=true,root_path='synthetic-root' WHERE singleton");
   for(const r of [a,b])await db.query("INSERT INTO result_release_completed(release_id,version_id,actor_id) VALUES($1,$2,$3)",[r.releaseId,r.versionId,u.staff.id]);
   await db.exec('COMMIT');
  }catch(e){await db.exec('ROLLBACK');throw e;}
  await runArchiveCycle(db,{get:async()=>{throw Error('no source read in this test');}});
  const jobs=(await db.query<{release_id:string}>('SELECT release_id FROM pdf_archive_job')).rows.map(r=>r.release_id);
  expect(jobs).toContain(b.releaseId);
  expect(jobs).not.toContain(a.releaseId);
 });
});
