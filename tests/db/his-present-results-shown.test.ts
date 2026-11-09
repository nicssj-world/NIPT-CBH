import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {task3Fixture} from '../helpers/task3';
import {pdfDate} from '../helpers/results';
import {syntheticReportPdf} from '../../tools/his-simulator/result-pdf';
import {registerIntake,parseIntake} from '../../packages/results/intake';
import {reviewBenchForResult} from '../../packages/lab/bench-review';
import {confirmCompletion} from '../../packages/results/completion';
import {confirmImport,unlinkVersion,pickPatient,attestHisPresenceBatch,withdrawHisAttestation,ancCaseResults} from '../../packages/results/service';
import {releaseQueue} from '../../packages/results/release-queue';

// Owner 2026-11-09: a result HIS already holds is shown to ANC on the patient, leaves "ต้องจัดการ", and is never sent again.
type F=Awaited<ReturnType<typeof task3Fixture>>;
const rowVersion=async(f:F,id:string)=>(await f.db.query<{row_version:number}>('SELECT row_version FROM result_report_version WHERE id=$1',[id])).rows[0].row_version;
const stateOf=async(f:F,id:string)=>(await f.db.query<{state:string}>('SELECT state FROM result_report_version WHERE id=$1',[id])).rows[0].state;
async function importPdf(f:F,index:number,name:string,hn?:string){
 const c=f.cases[index],bytes=syntheticReportPdf({kind:'SINGLETON',labNumber:c.printed,hn:hn??c.hn,dob:'01-Jan-1990',collection:pdfDate('2026-10-20'),gaWeeks:17,gaDays:6,sex:null});
 const intakeId=await f.run(t=>registerIntake(t,f.store,{source:'UPLOAD',relativePath:null,originalName:name,actorId:f.admin.id,jobId:null},bytes));
 await f.run(t=>parseIntake(t,f.store,intakeId,{maxBytes:10000000,acceptZip:true}));
 await f.run(t=>reviewBenchForResult(t,f.admin,c.attemptId,{revision:1,measurementsReviewed:true,reason:'SYNTHETIC legacy paper-only result evidence review'}));
 return {c,intakeId};
}
/** Linked and waiting to be sent ("รอส่ง HIS"). */
async function pending(f:F,index:number){
 const {c,intakeId}=await importPdf(f,index,`SYNTHETIC-shown-${index}.pdf`);
 const done=await f.run(t=>confirmCompletion(t,f.admin,{idempotencyKey:randomUUID(),abnormalAcknowledged:false,items:[{intakeId,caseId:c.caseId,roundId:c.roundId,attemptId:c.attemptId}]}));
 expect(done.items[0].outcome).toBe('PendingCertification');
 return {c,id:done.items[0].versionId!};
}
/** Imported but not linked to a patient. */
async function unlinked(f:F,index:number,hn?:string){
 const {c,intakeId}=await importPdf(f,index,`SYNTHETIC-shown-unlinked-${index}.pdf`,hn);
 const id=(await f.run(t=>confirmImport(t,f.admin,{intakeIds:[intakeId]})))[0].versionId!;
 if(await stateOf(f,id)!=='Unlinked')await f.run(async t=>unlinkVersion(t,f.admin,{versionId:id,reason:'SYNTHETIC test returns the link to the manual path',expectedRowVersion:await rowVersion(f,id)}));
 expect(await stateOf(f,id)).toBe('Unlinked');
 return {c,id};
}
const board=(f:F,tab:'ACTION'|'READY'|'SENT')=>f.run(t=>releaseQueue(t,f.admin,{store:f.store},{tab}));
const shownToAnc=async(f:F,caseId:string)=>{const r=await f.run(t=>ancCaseResults(t,f.admin,caseId));return r.rounds.map(x=>x.result).filter(Boolean);};
const releases=async(f:F,versionId:string)=>(await f.db.query('SELECT 1 FROM result_release WHERE version_id=$1',[versionId])).rows.length;

it('"มีผลใน HIS แล้ว": the result shows on the patient and leaves the board, with no release and no HIS transfer; withdrawing takes it back',async()=>{
 const f=await task3Fixture();try{
  const a=await pending(f,0),b=await pending(f,1);
  expect((await board(f,'READY')).counts.READY).toBe(2);
  expect(await shownToAnc(f,a.c.caseId)).toEqual([]);                                   // not visible to ANC before anything is said about HIS

  const r=await f.run(t=>attestHisPresenceBatch(t,f.admin,{confirmed:true,items:[{versionId:a.id}]}));
  expect(r.items).toEqual([{versionId:a.id,outcome:'ATTESTED'}]);
  // on the patient, as a result the previous system / HIS already holds
  const shown=await shownToAnc(f,a.c.caseId);
  expect(shown).toHaveLength(1);expect(shown[0]).toMatchObject({state:'HistoricalReported',historical:true});
  // off the board; the other one is untouched
  const ready=await board(f,'READY');expect(ready.counts.READY).toBe(1);expect(ready.rows.map(x=>x.versionId)).toEqual([b.id]);
  expect(await shownToAnc(f,b.c.caseId)).toEqual([]);
  // nothing was released or queued for HIS
  expect(await releases(f,a.id)).toBe(0);
  expect((await f.db.query("SELECT 1 FROM job_outbox WHERE kind='result_release_completed'")).rows).toHaveLength(0);
  expect((await f.db.query('SELECT 1 FROM p6_transfer')).rows).toHaveLength(0);

  // withdrawn: back in "รอส่ง HIS", gone from the patient
  const att=(await f.db.query<{id:string}>('SELECT id FROM result_his_attestation WHERE version_id=$1 AND withdrawn_at IS NULL',[a.id])).rows[0].id;
  await f.run(t=>withdrawHisAttestation(t,f.admin,{attestationId:att,reason:'SYNTHETIC attested by mistake'}));
  expect((await board(f,'READY')).counts.READY).toBe(2);
  expect(await shownToAnc(f,a.c.caseId)).toEqual([]);
 }finally{await f.close();}
},600000);

it('a batch reports each item: one that cannot be attested (not linked yet) does not stop the others',async()=>{
 const f=await task3Fixture();try{
  const a=await pending(f,0),u=await unlinked(f,1);
  const r=await f.run(t=>attestHisPresenceBatch(t,f.admin,{confirmed:true,items:[{versionId:u.id},{versionId:a.id}]}));
  expect(r.items).toEqual([{versionId:u.id,outcome:'FAILED',code:'HIS_ATTESTATION_LINKED_RESULT_REQUIRED'},{versionId:a.id,outcome:'ATTESTED'}]);
  expect(await shownToAnc(f,a.c.caseId)).toHaveLength(1);
  expect(await stateOf(f,u.id)).toBe('Unlinked');
  // rules of the call itself
  await expect(f.run(t=>attestHisPresenceBatch(t,f.admin,{confirmed:false,items:[{versionId:a.id}]}))).rejects.toThrow();
  await expect(f.run(t=>attestHisPresenceBatch(t,f.admin,{confirmed:true,items:[]}))).rejects.toThrow();
  await expect(f.run(t=>attestHisPresenceBatch(t,{...f.admin,roles:['ANC_NURSE']},{confirmed:true,items:[{versionId:a.id}]}))).rejects.toMatchObject({code:'FORBIDDEN'});
  expect((await f.db.query("SELECT 1 FROM audit_chain WHERE action='RESULT_HIS_PRESENCE_ATTESTED_BATCH'")).rows.length).toBeGreaterThanOrEqual(1);
 }finally{await f.close();}
},600000);

it('picking a patient can say "มีผลใน HIS แล้ว" in the same step; a PDF that contradicts the patient is linked but not shown, and the reason comes back',async()=>{
 const f=await task3Fixture();try{
  // matching PDF, not auto-linked: pick + present in HIS
  const u=await unlinked(f,0);
  const ok=await f.run(async t=>pickPatient(t,f.u.certifier,{versionId:u.id,expectedRowVersion:await rowVersion(f,u.id),caseId:u.c.caseId,roundId:u.c.roundId,attemptId:u.c.attemptId,hisPresent:true}));
  expect(ok.shownToAnc).toBe(true);expect(ok.attestFailed).toBeUndefined();
  expect(await shownToAnc(f,u.c.caseId)).toHaveLength(1);

  // a PDF whose HN is another patient's is not linked even by a person's pick, so there is nothing to show under this patient
  const bad=await unlinked(f,1,f.cases[2].hn);
  const r=await f.run(async t=>pickPatient(t,f.u.certifier,{versionId:bad.id,expectedRowVersion:await rowVersion(f,bad.id),caseId:bad.c.caseId,roundId:bad.c.roundId,attemptId:bad.c.attemptId,hisPresent:true}));
  expect(r.shownToAnc).toBeUndefined();expect(r.attestFailed).toBe('HIS_ATTESTATION_LINKED_RESULT_REQUIRED');
  expect(await shownToAnc(f,bad.c.caseId)).toEqual([]);
  expect((await f.db.query('SELECT 1 FROM result_his_attestation WHERE version_id=$1',[bad.id])).rows).toHaveLength(0);
 }finally{await f.close();}
},600000);

it('a linked result whose date of birth contradicts the patient is refused, and is shown once the contradiction is gone',async()=>{
 const f=await task3Fixture();try{
  const a=await pending(f,0),c=a.c;
  // the paper request check says another date of birth than the PDF (the PDF reads 1990-01-01)
  await f.db.query("INSERT INTO p2_workspace(round_id,case_id,draft,request_mode,consent_mode,updated_by) VALUES($1,$2,'{}','Paper','Paper',$3) ON CONFLICT(round_id) DO NOTHING",[c.roundId,c.caseId,f.admin.id]);
  const review=(dob:string,at:string)=>f.db.query(`INSERT INTO p2_paper_review(case_id,round_id,kind,template_version,document_reference,panel,status,location,reason,verifier_id,created_at)
   VALUES($1,$2,'REQUEST','CBH-FM01-v1','SYNTHETIC-PAPER',$3,'Verified','SYNTHETIC','SYNTHETIC_TEST',$4,${at})`,[c.caseId,c.roundId,JSON.stringify({dob,gaWeeks:17,gaDays:6,pregnancyType:'Singleton'}),f.admin.id]);
  await review('1991-05-05','now()');
  const refused=await f.run(t=>attestHisPresenceBatch(t,f.admin,{confirmed:true,items:[{versionId:a.id}]}));
  expect(refused.items).toEqual([{versionId:a.id,outcome:'FAILED',code:'HIS_ATTESTATION_IDENTITY_MISMATCH'}]);
  expect(await shownToAnc(f,c.caseId)).toEqual([]);
  await review('1990-01-01',"now()+interval '1 second'");                               // corrected on the request
  const ok=await f.run(t=>attestHisPresenceBatch(t,f.admin,{confirmed:true,items:[{versionId:a.id}]}));
  expect(ok.items[0].outcome).toBe('ATTESTED');
  expect(await shownToAnc(f,c.caseId)).toHaveLength(1);
 }finally{await f.close();}
},600000);
