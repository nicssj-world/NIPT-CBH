import {it,expect,vi} from 'vitest';
import {randomUUID,createHash} from 'node:crypto';
import {task3Fixture} from '../helpers/task3';
import {pdfDate} from '../helpers/results';
import {pendingState} from '../helpers/certify-pending';
import {syntheticReportPdf} from '../../tools/his-simulator/result-pdf';
import {registerIntake,parseIntake} from '../../packages/results/intake';
import {reviewBenchForResult} from '../../packages/lab/bench-review';
import {confirmCompletion} from '../../packages/results/completion';
import {confirmImport,unlinkVersion,voidVersion,pickPatient} from '../../packages/results/service';
import {dismissHalosRow} from '../../packages/readygen/halos-import';
import {reportWorklist,prepareReport} from '../../packages/readygen/reports';
import {sendToHis} from '../../packages/results/send-his';

type F=Awaited<ReturnType<typeof task3Fixture>>;
const rowVersion=async(f:F,id:string)=>(await f.db.query<{row_version:number}>('SELECT row_version FROM result_report_version WHERE id=$1',[id])).rows[0].row_version;
const stateOf=async(f:F,id:string)=>(await f.db.query<{state:string}>('SELECT state FROM result_report_version WHERE id=$1',[id])).rows[0].state;
async function importPdf(f:F,index:number,name:string,variant=0,reviewer?:Parameters<typeof reviewBenchForResult>[1]){
 const c=f.cases[index],bytes=syntheticReportPdf({kind:'SINGLETON',labNumber:c.printed,hn:c.hn,dob:'01-Jan-1990',collection:pdfDate('2026-10-20'),gaWeeks:17,gaDays:variant,sex:null});
 const intakeId=await f.run(t=>registerIntake(t,f.store,{source:'UPLOAD',relativePath:null,originalName:name,actorId:f.admin.id,jobId:null},bytes));
 await f.run(t=>parseIntake(t,f.store,intakeId,{maxBytes:10000000,acceptZip:true}));
 await f.run(t=>reviewBenchForResult(t,reviewer??f.admin,c.attemptId,{revision:1,measurementsReviewed:true,reason:'SYNTHETIC legacy paper-only result evidence review'}));
 return {c,intakeId};
}
async function pending(f:F,index:number,name=`SYNTHETIC-action-${index}.pdf`,variant=0){
 const {c,intakeId}=await importPdf(f,index,name,variant);
 const done=await f.run(t=>confirmCompletion(t,f.admin,{idempotencyKey:randomUUID(),abnormalAcknowledged:false,items:[{intakeId,caseId:c.caseId,roundId:c.roundId,attemptId:c.attemptId}]}));
 expect(done.items[0].outcome).toBe('PendingCertification');
 return {c,id:done.items[0].versionId!};
}
/** Moves a version through transitions the guard already allowed before migration 205 (test set-up only). */
async function force(f:F,id:string,...states:string[]){for(const s of states)await f.db.query("UPDATE result_report_version SET state=$2,row_version=row_version+1,case_id=coalesce(case_id,$3),round_id=coalesce(round_id,$4),attempt_id=coalesce(attempt_id,$5),link_mode=coalesce(link_mode,'MANUAL_REVIEWED') WHERE id=$1",[id,s,f.cases[0].caseId,f.cases[0].roundId,f.cases[0].attemptId]);}
const voidIt=async(f:F,id:string)=>f.run(async t=>voidVersion(t,f.admin,{versionId:id,reason:'SYNTHETIC discard this stuck item',expectedRowVersion:await rowVersion(f,id)}));

it('void works from LinkConflict, Linked, ValidationBlocked and PendingCertification; refused after CertifiedReleased',async()=>{
 const f=await task3Fixture();try{
  const p=await pending(f,0);
  expect(await stateOf(f,p.id)).toBe('PendingCertification');
  expect((await voidIt(f,p.id)).outcome).toBe('Voided');
  expect((await f.db.query("SELECT 1 FROM result_version_event WHERE version_id=$1 AND to_state='Voided'",[p.id])).rows.length).toBe(1);
  // A voided item stays in the round's series, so a later PDF for the same case is not auto-linked (SERIES_NOT_EMPTY): it arrives Unlinked,
  // which is where set-up starts for the other stuck states (moved with transitions the guard allowed before 205).
  const paths=[['LinkConflict'],['Linked'],['Linked','ValidationBlocked']];
  for(const [i,path] of paths.entries()){
   const {intakeId}=await importPdf(f,0,`SYNTHETIC-action-again-${i}.pdf`,i+1);
   const q=(await f.run(t=>confirmImport(t,f.admin,{intakeIds:[intakeId]})))[0].versionId!;
   expect(await stateOf(f,q)).toBe('Unlinked');
   await force(f,q,...path);
   expect(await stateOf(f,q)).toBe(path[path.length-1]);
   expect((await voidIt(f,q)).outcome).toBe('Voided');
   expect(await stateOf(f,q)).toBe('Voided');
   expect((await f.db.query("SELECT 1 FROM result_version_event WHERE version_id=$1 AND to_state='Voided'",[q])).rows.length).toBe(1);
  }
  const again=await pending(f,1);
  const sent=await f.run(async t=>sendToHis(t,f.admin,{idempotencyKey:randomUUID(),reviewConfirmed:true,abnormalAcknowledged:false,items:[{versionId:again.id,expectedRowVersion:await rowVersion(f,again.id)}]}));
  expect(sent.items[0].outcome).toBe('CertifiedReleased');
  await expect(voidIt(f,again.id)).rejects.toMatchObject({code:'RELEASE_HOLD_AL5'});
  expect(await stateOf(f,again.id)).toBe('CertifiedReleased');
 }finally{vi.unstubAllEnvs();await f.close();}
},300000);

it('pickPatient by one person links a ReadyGen PDF and reaches PendingCertification',async()=>{
 const f=await task3Fixture();try{
  // Path 1: never reviewed (reviewExternalForRelease records review and QC5).
  const {c,intakeId}=await importPdf(f,0,'SYNTHETIC-pick-fresh.pdf',0,f.u.certifier);
  const imp=await f.run(t=>confirmImport(t,f.admin,{intakeIds:[intakeId]}));
  const id=imp[0].versionId!;
  if(await stateOf(f,id)!=='Unlinked')await f.run(async t=>unlinkVersion(t,f.admin,{versionId:id,reason:'SYNTHETIC test returns the link to the manual path',expectedRowVersion:await rowVersion(f,id)}));
  expect(await stateOf(f,id)).toBe('Unlinked');
  const r=await f.run(async t=>pickPatient(t,f.u.certifier,{versionId:id,expectedRowVersion:await rowVersion(f,id),caseId:c.caseId,roundId:c.roundId,attemptId:c.attemptId,reason:'SYNTHETIC picked by the certifier alone'}));
  expect(r.state).toBe('PendingCertification');
  expect(await pendingState(f.db,id)).toMatchObject({state:'PendingCertification',reviews:1,qc5:1,releases:0,outbox:0});
  const ev=(await f.db.query<{event:string;actor_id:string}>('SELECT event,actor_id FROM result_link_event WHERE version_id=$1 ORDER BY sequence',[id])).rows;
  expect(ev.map(e=>e.event).slice(-2)).toEqual(['PROPOSED','APPROVED']);
  expect(ev[ev.length-1].actor_id).toBe(ev[ev.length-2].actor_id);
  // Path 2: already reviewed and QC5-accepted before the unlink (only a fresh review is needed).
  const p=await pending(f,1);
  await f.run(async t=>unlinkVersion(t,f.admin,{versionId:p.id,reason:'SYNTHETIC unlink to pick again',expectedRowVersion:await rowVersion(f,p.id)}));
  const r2=await f.run(async t=>pickPatient(t,f.u.certifier,{versionId:p.id,expectedRowVersion:await rowVersion(f,p.id),caseId:p.c.caseId,roundId:p.c.roundId,attemptId:p.c.attemptId,reason:'SYNTHETIC picked again by one person'}));
  expect(r2.state).toBe('PendingCertification');
 }finally{vi.unstubAllEnvs();await f.close();}
},300000);

it('dismissed HALOS row no longer appears in reportWorklist; reason under 8 chars is refused',async()=>{
 const f=await task3Fixture();try{
  const sha=createHash('sha256').update(randomUUID()).digest('hex');
  await f.db.query("INSERT INTO file_asset(sha256,byte_size,media_type,storage_key) VALUES($1,10,'application/octet-stream',$2)",[sha,'sha256/x/'+sha]);
  const imp=(await f.db.query<{id:string}>("INSERT INTO halos_import(sha256,original_name,byte_size,adapter_version,chip_ids,counts,state,uploaded_by,decided_by,decided_at) VALUES($1,'SYNTHETIC-halos.xlsx',10,'SYNTHETIC-ADAPTER',ARRAY['C1'],'{}','Confirmed',$2,$2,now()) RETURNING id",[sha,f.admin.id])).rows[0].id;
  const row=(await f.db.query<{id:string}>("INSERT INTO halos_import_row(import_id,sheet,row_number,raw,sample_raw,sample_key,classification,reason) VALUES($1,'result',2,'{}','SYNTHETIC-1','SYNTHETIC-1','UNMATCHED','NO_MAPPING') RETURNING id",[imp])).rows[0].id;
  const list=()=>f.run(t=>reportWorklist(t,f.admin,{store:f.store},{status:'ALL'}));
  expect((await list()).rows.map(r=>r.rowId)).toContain(row);
  await expect(f.run(t=>dismissHalosRow(t,f.admin,{rowId:row,reason:'short'}))).rejects.toThrow();
  await expect(f.run(t=>dismissHalosRow(t,f.admin,{rowId:row,reason:'contains 1234567890123 id'}))).rejects.toThrow();
  expect((await list()).rows.map(r=>r.rowId)).toContain(row);
  await f.run(t=>dismissHalosRow(t,f.admin,{rowId:row,reason:'SYNTHETIC unmatched sample, nothing to report'}));
  expect((await list()).rows.map(r=>r.rowId)).not.toContain(row);
  await expect(f.run(t=>dismissHalosRow(t,f.admin,{rowId:row,reason:'SYNTHETIC dismiss twice please'}))).rejects.toMatchObject({code:'HALOS_ROW_ALREADY_DISMISSED'});
  await expect(f.run(t=>prepareReport(t,f.admin,{store:f.store},{rowId:row}))).rejects.toMatchObject({code:'HALOS_ROW_DISMISSED'});
  expect((await f.db.query("SELECT 1 FROM audit_chain WHERE action='HALOS_ROW_DISMISSED'")).rows.length).toBe(1);
  await expect(f.db.query('DELETE FROM halos_row_dismissal WHERE row_id=$1',[row])).rejects.toThrow();
 }finally{vi.unstubAllEnvs();await f.close();}
},180000);

it('migration 205 leaves every other version transition unchanged',async()=>{
 const f=await task3Fixture();try{
  const p=await pending(f,0);
  await force(f,p.id,'Unlinked');
  await expect(f.db.query("UPDATE result_report_version SET state='CertifiedReleased',row_version=row_version+1 WHERE id=$1",[p.id])).rejects.toThrow(/REPORT_TRANSITION_PROHIBITED/);   // Unlinked -> CertifiedReleased: the release hold passes here, the transition table refuses
  for(const to of ['PendingCertification','ValidationBlocked','Superseded','Parsed'])await expect(f.db.query('UPDATE result_report_version SET state=$2,row_version=row_version+1 WHERE id=$1',[p.id,to])).rejects.toThrow(/REPORT_TRANSITION_PROHIBITED/);
  const def=(await f.db.query<{d:string}>("SELECT pg_get_functiondef('p5_version_guard'::regproc) d")).rows[0].d;
  for(const pair of ["('LinkConflict','Voided')","('Linked','Voided')","('ValidationBlocked','Voided')","('PendingCertification','Voided')","('CertifiedReleased','Voided')","('Unlinked','Voided')","('PendingCertification','CertifiedReleased')"])expect(def).toContain(pair);
  await force(f,p.id,'Voided');
  for(const to of ['Unlinked','Linked','Superseded'])await expect(f.db.query('UPDATE result_report_version SET state=$2,row_version=row_version+1 WHERE id=$1',[p.id,to])).rejects.toThrow(/REPORT_TRANSITION_PROHIBITED/);
 }finally{vi.unstubAllEnvs();await f.close();}
},180000);

it('pickPatient links even when the review step cannot be recorded: reviewSkipped carries the code and the item is not left Unlinked',async()=>{
 const f=await task3Fixture();try{
  // Bench evidence reviewed by someone else (admin): the certifier's QC5 step raises SEQUENCING_REVIEWER_MISMATCH, which must not undo the link.
  const {c,intakeId}=await importPdf(f,0,'SYNTHETIC-pick-skip.pdf');
  const id=(await f.run(t=>confirmImport(t,f.admin,{intakeIds:[intakeId]})))[0].versionId!;
  if(await stateOf(f,id)!=='Unlinked')await f.run(async t=>unlinkVersion(t,f.admin,{versionId:id,reason:'SYNTHETIC test returns the link to the manual path',expectedRowVersion:await rowVersion(f,id)}));
  const r=await f.run(async t=>pickPatient(t,f.u.certifier,{versionId:id,expectedRowVersion:await rowVersion(f,id),caseId:c.caseId,roundId:c.roundId,attemptId:c.attemptId,reason:'SYNTHETIC picked without review evidence'}));
  expect(r.reviewSkipped).toBe('SEQUENCING_REVIEWER_MISMATCH');
  expect(['Linked','ValidationBlocked','PendingCertification']).toContain(r.state);
  expect(await stateOf(f,id)).toBe(r.state);
  expect((await f.db.query('SELECT 1 FROM result_qc5_review WHERE version_id=$1',[id])).rows.length).toBe(0);
  expect((await f.db.query("SELECT 1 FROM result_link_event WHERE version_id=$1 AND event='APPROVED'",[id])).rows.length).toBe(1);
 }finally{vi.unstubAllEnvs();await f.close();}
},300000);

it('a HALOS row whose internal report is Final cannot be dismissed (HALOS_ROW_HAS_FINAL_REPORT)',async()=>{
 const f=await task3Fixture();try{
  const sha=createHash('sha256').update(randomUUID()).digest('hex');
  await f.db.query("INSERT INTO file_asset(sha256,byte_size,media_type,storage_key) VALUES($1,10,'application/octet-stream',$2)",[sha,'sha256/x/'+sha]);
  const imp=(await f.db.query<{id:string}>("INSERT INTO halos_import(sha256,original_name,byte_size,adapter_version,chip_ids,counts,state,uploaded_by,decided_by,decided_at) VALUES($1,'SYNTHETIC-halos2.xlsx',10,'SYNTHETIC-ADAPTER',ARRAY['C1'],'{}','Confirmed',$2,$2,now()) RETURNING id",[sha,f.admin.id])).rows[0].id;
  const row=(await f.db.query<{id:string}>("INSERT INTO halos_import_row(import_id,sheet,row_number,raw,sample_raw,sample_key,classification,reason) VALUES($1,'result',2,'{}','SYNTHETIC-2','SYNTHETIC-2','UNMATCHED','NO_MAPPING') RETURNING id",[imp])).rows[0].id;
  // internal_report has many guards and FKs; the dismissal check only reads state, so the evidence row is inserted with them off (test set-up only).
  const c=f.cases[0],shaPdf=createHash('sha256').update(randomUUID()).digest('hex');
  await f.db.query("INSERT INTO file_asset(sha256,byte_size,media_type,storage_key) VALUES($1,10,'application/pdf',$2)",[shaPdf,'sha256/y/'+shaPdf]);
  await f.db.query('SET session_replication_role = replica');
  await f.db.query("INSERT INTO internal_report(halos_row_id,attempt_id,round_id,case_id,template_kind,template_code,template_sha256,pregnancy_source,interpretation,ruleset,bindings,operator_id,reported_by,reported_profile_id,reported_authority,reported_at,approved_by,approved_profile_id,approved_authority,approved_at,pdf_sha256,download_name,state) VALUES($1,$2,$3,$4,'SINGLETON','FM-WI-T-BM-17-07',$5,'ANC_REQUEST','{}','{}','{}',$6,$6,$7,'{}',now(),$6,$7,'{}',now(),$8,'SYNTHETIC-final.pdf','Final')",[row,c.attemptId,c.roundId,c.caseId,'a'.repeat(64),f.admin.id,randomUUID(),shaPdf]);
  await f.db.query('SET session_replication_role = origin');
  await expect(f.run(t=>dismissHalosRow(t,f.admin,{rowId:row,reason:'SYNTHETIC try to hide a reported row'}))).rejects.toMatchObject({code:'HALOS_ROW_HAS_FINAL_REPORT'});
  expect((await f.db.query('SELECT 1 FROM halos_row_dismissal WHERE row_id=$1',[row])).rows.length).toBe(0);
 }finally{vi.unstubAllEnvs();await f.close();}
},180000);
