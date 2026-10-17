import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import type {PGlite} from '@electric-sql/pglite';
import {testDatabase,addUser} from '../helpers/database';
import {syntheticCase,receiveS1,tx} from '../helpers/lab';
import {dashboard} from '../../packages/anc/service';
import type {Principal} from '../../packages/security/policy';
import {randomUUID} from 'node:crypto';
let db:PGlite,anc:Principal,unit:string,other:string,caseId:string;
beforeAll(async()=>{
 db=await testDatabase();anc=await addUser(db,'ANC_NURSE','synthetic.anc.dashboard');
 unit=(await db.query<{id:string}>("INSERT INTO unit(code,name) VALUES('ANC-DASH-1','ANC 1') RETURNING id")).rows[0].id;
 other=(await db.query<{id:string}>("INSERT INTO unit(code,name) VALUES('ANC-DASH-2','ANC 2') RETURNING id")).rows[0].id;
 anc={...anc,unitIds:[unit]};
 await tx(db,async()=>{const c=await syntheticCase(db,{staff:anc,unit});caseId=c.caseId;
 await db.query("INSERT INTO p2_workspace(case_id,round_id,version,draft,request_mode,consent_mode,updated_by) VALUES($1,$2,0,'{}','Paper','Paper',$3)",[caseId,c.roundId,anc.id]);
 await receiveS1(db,c,new Date('2025-10-01T00:00:00Z'));await db.query('INSERT INTO case_unit_scope(case_id,unit_id) VALUES($1,$2)',[caseId,other]);});
 await tx(db,()=>syntheticCase(db,{staff:anc,unit:other},{evidence:false}));
});
afterAll(async()=>{await db?.close();});
describe('ANC read-only migrated database aggregation',()=>{
 it('deduplicates multi-unit cases and keeps cross-year pending with exact drilldown parity',async()=>{
  const before=(await db.query<{n:number}>('SELECT count(*)::int n FROM audit_chain')).rows[0].n;
  const d=await dashboard(db,anc,{fy:2570,kpi:'pending'});
  expect(d.metrics).toMatchObject({sent:0,pending:1,released:0});expect(d.queue.total).toBe(d.metrics.pending);
  expect(d.queue.items[0]).toMatchObject({id:caseId,stage:'received',documentsReady:true,unitIds:[unit]});
  expect(d.units).toEqual([{id:unit,name:'ANC 1'}]);expect(d.stages.reduce((n,s)=>n+s.count,0)).toBe(1);
  expect((await db.query<{n:number}>('SELECT count(*)::int n FROM audit_chain')).rows[0].n).toBe(before);
 });
 it('cross-unit grant expands read scope without multiplying cases',async()=>{
  const d=await dashboard(db,{...anc,permissions:['ANC_VIEW_ALL_UNITS']},{fy:2569});
  expect(d.queue.total).toBe(2);expect(d.metrics.sent).toBe(1);expect(d.metrics.pending).toBe(1);
  expect(d.queue.items.filter(c=>c.id===caseId)).toHaveLength(1);
 });
 it('rejects unauthorized unit, non-reader, invalid filters and suspended session',async()=>{
  await expect(dashboard(db,anc,{unitId:other})).rejects.toThrow('FORBIDDEN');
  await expect(dashboard(db,{...anc,roles:['IT_OPERATOR']},{})).rejects.toThrow('FORBIDDEN');
  await expect(dashboard(db,{...anc,roles:['AUDITOR']},{})).rejects.toThrow('FORBIDDEN');
  await expect(dashboard(db,{...anc,roles:['LAB_STAFF']},{})).rejects.toThrow('FORBIDDEN');
  await expect(dashboard(db,anc,{flag:'invented'})).rejects.toThrow();
  await expect(dashboard(db,{...anc,sessionId:'00000000-0000-4000-8000-000000000001'},{})).rejects.toThrow('UNAUTHENTICATED');
 });
 it('uses recorded withdrawal as attention and document unready without inferring clinical acceptance',async()=>{
  const round=(await db.query<{id:string}>('SELECT current_round_id id FROM nipt_case WHERE id=$1',[caseId])).rows[0].id;
  await db.query("INSERT INTO p2_revocation(case_id,round_id,stage,reason,actor_id) VALUES($1,$2,'W0','SYNTHETIC_WITHDRAWAL',$3)",[caseId,round,anc.id]);
  const d=await dashboard(db,anc,{flag:'consent_revoked'});
  expect(d.queue.total).toBe(1);expect(d.queue.items[0].documentsReady).toBe(false);
  expect(d.queue.items[0].flags).toContain('consent_revoked');
 });
 it('reads more than 200 cases and returns exact last-page totals in a read-only transaction',async()=>{
  await db.query('BEGIN');
  try{
   for(let n=0;n<205;n++)await syntheticCase(db,{staff:anc,unit},{evidence:false});
   await db.query('COMMIT');
   await db.query('BEGIN');await db.query('SELECT 1');await db.query('SET TRANSACTION READ ONLY');
   const d=await dashboard(db,anc,{page:11,pageSize:20});
   expect(d.queue.total).toBe(206);expect(d.queue.items).toHaveLength(6);
   expect(d.stages.reduce((n,s)=>n+s.count,0)).toBe(206);
  }finally{await db.query('ROLLBACK');}
 });
 it('SQL excludes notices, old rounds, superseded/voided versions and release records',async()=>{
  const round=(await db.query<{id:string}>('SELECT current_round_id id FROM nipt_case WHERE id=$1',[caseId])).rows[0].id;
  // Deliberately adversarial rows only in this disposable in-memory transaction.
  // Skip release-authority triggers for fixture insertion, never in application code.
  for(const fixture of [
   {kind:'RESULT',versionState:'CertifiedReleased',releaseState:'Active',current:true,expected:1},
   {kind:'REDRAW_NOTICE',versionState:'CertifiedReleased',releaseState:'Active',current:true,expected:0},
   {kind:'RESULT',versionState:'Superseded',releaseState:'Active',current:true,expected:0},
   {kind:'RESULT',versionState:'Voided',releaseState:'Active',current:true,expected:0},
   {kind:'RESULT',versionState:'CertifiedReleased',releaseState:'Superseded',current:true,expected:0},
   {kind:'RESULT',versionState:'CertifiedReleased',releaseState:'Voided',current:true,expected:0},
   {kind:'RESULT',versionState:'CertifiedReleased',releaseState:'Active',current:false,expected:0},
  ]){
   await db.query('BEGIN');
   try{
    await db.query('SET LOCAL session_replication_role=replica');
    const id=randomUUID(),r=fixture.current?round:randomUUID();
    await db.query(`INSERT INTO result_report_version(id,intake_file_id,sha256,kind,template_kind,template_version,parser_version,parsed,state,case_id,round_id,attempt_id,link_mode,imported_by) VALUES($1,$2,$3,$4,$5,'SYNTHETIC-v1','SYNTHETIC-v1','{}',$6,$7,$8,$9,'MANUAL_REVIEWED',$10)`,[id,randomUUID(),id.replaceAll('-','').repeat(2),fixture.kind,fixture.kind==='RESULT'?'SINGLETON':'REDRAW_NOTICE',fixture.versionState,caseId,r,randomUUID(),anc.id]);
    await db.query(`INSERT INTO result_release(version_id,case_id,round_id,kind,channel,state,certified_by) VALUES($1,$2,$3,$4,'NIPT_ANC_VIEW',$5,$6)`,[id,caseId,r,fixture.kind,fixture.releaseState,anc.id]);
    const d=await dashboard(db,anc,{kpi:'released'});
    expect(d.metrics.released).toBe(fixture.expected);expect(d.queue.total).toBe(fixture.expected);
   }finally{await db.query('ROLLBACK');}
  }
 });
 it('binds readiness to active modes, current draft/version and the latest granted consent document',async()=>{
  await db.query('BEGIN');
  try{
   const c=await syntheticCase(db,{staff:anc,unit});
   const ready=async()=> (await dashboard(db,anc,{q:c.ln})).queue.items[0].documentsReady;
   // A historical paper review without a current workspace never establishes readiness.
   expect(await ready()).toBe(false);
   await db.query("INSERT INTO p2_workspace(case_id,round_id,version,draft,request_mode,consent_mode,updated_by) VALUES($1,$2,0,'{\"synthetic\":0}','Paper','Paper',$3)",[c.caseId,c.roundId,anc.id]);
   expect(await ready()).toBe(true);
   await db.query("UPDATE p2_workspace SET version=1,request_mode='Electronic',consent_mode='Electronic' WHERE round_id=$1",[c.roundId]);
   expect(await ready()).toBe(false); // Previous paper evidence cannot satisfy electronic modes.
   // Synthetic document bindings only, in a rolled-back disposable database transaction.
   await db.query('SET LOCAL session_replication_role=replica');
   const document=async(kind:'REQUEST'|'CONSENT',version:number,payload:unknown)=>{
    const id=randomUUID();await db.query("INSERT INTO p2_document_revision(id,case_id,round_id,kind,version,template_version,payload,content_hash,reason,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'SYNTHETIC_TEST',$9)",[id,c.caseId,c.roundId,kind,version,kind==='REQUEST'?'SYNTHETIC-FM01-v1':'SYNTHETIC-FM02-v1',JSON.stringify(payload),'1'.repeat(64),anc.id]);return id;
   };
   const final=async(id:string)=>db.query("INSERT INTO p2_final_consent(session_id,document_id,payload,content_hash) VALUES($1,$2,$3,$4)",[randomUUID(),id,JSON.stringify({signature:{decision:'Granted'}}),'2'.repeat(64)]);
   await document('REQUEST',1,{draft:{synthetic:0}});
   const consent1=await document('CONSENT',1,{workspaceVersion:1});await final(consent1);
   expect(await ready()).toBe(true);
   // Draft changes invalidate the previously locked request and workspace-bound consent.
   await db.query("UPDATE p2_workspace SET version=2,draft='{\"synthetic\":1}' WHERE round_id=$1",[c.roundId]);
   expect(await ready()).toBe(false);
   await document('REQUEST',2,{draft:{synthetic:1}});
   expect(await ready()).toBe(false); // Consent still belongs to workspace 1.
   const consent2=await document('CONSENT',2,{workspaceVersion:2});
   expect(await ready()).toBe(false); // Newest consent is unsigned; older final cannot satisfy it.
   await final(consent2);expect(await ready()).toBe(true);
   await db.query("UPDATE p2_workspace SET version=3,request_mode='Paper',consent_mode='Paper' WHERE round_id=$1",[c.roundId]);
   expect(await ready()).toBe(true);
   await db.query("INSERT INTO p2_paper_review(case_id,round_id,kind,template_version,document_reference,panel,status,location,reason,verifier_id,created_at) VALUES($1,$2,'CONSENT','SYNTHETIC-FM02-v1','SYNTHETIC-DECLINED','{\"decision\":\"Declined\"}','Verified','SYNTHETIC','SYNTHETIC_TEST',$3,now()+interval '1 second')",[c.caseId,c.roundId,anc.id]);
   expect(await ready()).toBe(false); // Verified alone never means consent Granted.
  }finally{await db.query('ROLLBACK');}
 });
});
