import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {task3Fixture} from '../helpers/task3';
import {pdfDate} from '../helpers/results';
import {syntheticReportPdf} from '../../tools/his-simulator/result-pdf';
import {registerIntake,parseIntake} from '../../packages/results/intake';
import {reviewBenchForResult} from '../../packages/lab/bench-review';
import {confirmCompletion} from '../../packages/results/completion';
import {sendToHis} from '../../packages/results/send-his';
import {emptyRequest} from '../../packages/p2/schema';
import {nhsoBoard,nhsoDetail,confirmNhsoEntry,cancelNhsoEntry} from '../../packages/results/nhso-entry';

type F=Awaited<ReturnType<typeof task3Fixture>>;
const ID='1101700203451';
const fixture=()=>task3Fixture([
 {ln:'9900099511',hn:'9900099951',pregnancy:'Singleton',sheet:1,pet:{identity:ID}},
 {ln:'9900099512',hn:'9900099952',pregnancy:'Singleton',sheet:2},
 {ln:'9900099513',hn:'9900099953',pregnancy:'Singleton',sheet:3}]);
/** The request draft records the entitlement and gravida (test set-up writes the workspace directly). */
async function request(f:F,index:number,entitlement:string,gravida=2){
 const c=f.cases[index],draft={...emptyRequest,patient:{...emptyRequest.patient,entitlement},pregnancy:{...emptyRequest.pregnancy,gravida}};
 await f.db.query(`INSERT INTO p2_workspace(round_id,case_id,draft,request_mode,consent_mode,updated_by) VALUES($1,$2,$3,'Paper','Paper',$4)
  ON CONFLICT(round_id) DO UPDATE SET draft=EXCLUDED.draft,version=p2_workspace.version+1`,[c.roundId,c.caseId,JSON.stringify(draft),f.admin.id]);
}
/** One external PDF taken through review and "ส่ง HIS": a certified, Active release. */
async function release(f:F,index:number){
 const c=f.cases[index],bytes=syntheticReportPdf({kind:'SINGLETON',labNumber:c.printed,hn:c.hn,dob:'01-Jan-1990',collection:pdfDate('2026-10-20'),gaWeeks:17,gaDays:6,sex:null});
 const intakeId=await f.run(t=>registerIntake(t,f.store,{source:'UPLOAD',relativePath:null,originalName:`SYNTHETIC-nhso-${index}.pdf`,actorId:f.admin.id,jobId:null},bytes));
 await f.run(t=>parseIntake(t,f.store,intakeId,{maxBytes:10000000,acceptZip:true}));
 await f.run(t=>reviewBenchForResult(t,f.admin,c.attemptId,{revision:1,measurementsReviewed:true,reason:'SYNTHETIC legacy paper-only result evidence review'}));
 const done=await f.run(t=>confirmCompletion(t,f.admin,{idempotencyKey:randomUUID(),abnormalAcknowledged:false,items:[{intakeId,caseId:c.caseId,roundId:c.roundId,attemptId:c.attemptId}]}));
 const versionId=done.items[0].versionId!,rv=(await f.db.query<{row_version:number}>('SELECT row_version FROM result_report_version WHERE id=$1',[versionId])).rows[0].row_version;
 const sent=await f.run(t=>sendToHis(t,f.admin,{idempotencyKey:randomUUID(),reviewConfirmed:true,abnormalAcknowledged:false,items:[{versionId,expectedRowVersion:rv}]}));
 expect(sent.items[0].outcome).toBe('CertifiedReleased');
 return (await f.db.query<{id:string}>('SELECT id FROM result_release WHERE version_id=$1',[versionId])).rows[0].id;
}
const board=(f:F,tab:'PENDING'|'DONE',user=f.admin)=>f.run(t=>nhsoBoard(t,user,{tab}));

it('lists only certified results of สปสช. cases; confirm moves a row to DONE and cancel brings it back, each once',async()=>{
 const f=await fixture();try{
  await request(f,0,'สปสช. (UC)');await request(f,1,'ชำระเงินเอง');await request(f,2,'สปสช.');
  const a=await release(f,0);await release(f,1);
  // case 2 is สปสช. but has no released result yet; case 1 is self-pay
  let p=await board(f,'PENDING');
  expect(p.counts).toEqual({PENDING:1,DONE:0});
  expect(p.rows).toHaveLength(1);
  expect(p.rows[0]).toMatchObject({releaseId:a,caseId:f.cases[0].caseId,ln:f.cases[0].ln,hn:f.cases[0].hn,reissued:false,entry:null});

  expect(await f.run(t=>confirmNhsoEntry(t,f.admin,{releaseId:a}))).toEqual({releaseId:a,state:'CONFIRMED'});
  await expect(f.run(t=>confirmNhsoEntry(t,f.admin,{releaseId:a}))).rejects.toMatchObject({code:'NHSO_ALREADY_CONFIRMED'});
  p=await board(f,'PENDING');expect(p.counts).toEqual({PENDING:0,DONE:1});expect(p.rows).toEqual([]);
  const d=await board(f,'DONE');expect(d.rows[0].releaseId).toBe(a);expect(d.rows[0].entry?.at).toBeTruthy();

  expect(await f.run(t=>cancelNhsoEntry(t,f.admin,{releaseId:a}))).toEqual({releaseId:a,state:'CANCELLED'});
  await expect(f.run(t=>cancelNhsoEntry(t,f.admin,{releaseId:a}))).rejects.toMatchObject({code:'NHSO_NOT_CONFIRMED'});
  expect((await board(f,'PENDING')).counts).toEqual({PENDING:1,DONE:0});
  const events=(await f.db.query<{kind:string}>('SELECT kind FROM nhso_result_entry_event WHERE release_id=$1 ORDER BY sequence',[a])).rows.map(r=>r.kind);
  expect(events).toEqual(['CONFIRMED','CANCELLED']);
  const audits=(await f.db.query<{action:string}>("SELECT action FROM audit_chain WHERE action LIKE 'NHSO_ENTRY_%' ORDER BY sequence")).rows.map(r=>r.action);
  expect(audits).toEqual(['NHSO_ENTRY_CONFIRMED','NHSO_ENTRY_CANCELLED']);
  // a self-pay release cannot be confirmed here
  const selfPay=(await f.db.query<{id:string}>('SELECT id FROM result_release WHERE case_id=$1',[f.cases[1].caseId])).rows[0].id;
  await expect(f.run(t=>confirmNhsoEntry(t,f.admin,{releaseId:selfPay}))).rejects.toMatchObject({code:'NOT_FOUND'});
  // permission: ANC users cannot open the board
  await expect(f.run(t=>nhsoBoard(t,{...f.admin,roles:['ANC_NURSE']},{tab:'PENDING'}))).rejects.toMatchObject({code:'FORBIDDEN'});
 }finally{await f.close();}
},600000);

it('popup data: national ID from the stored PET, age at the service date, gravida, GA from registration, Task List date',async()=>{
 const f=await fixture();try{
  await request(f,0,'สปสช.',3);
  const a=await release(f,0);
  const views=async()=>(await f.db.query<{n:number}>("SELECT count(*)::int n FROM phi_access_log WHERE case_id=$1 AND purpose='CASE_DETAIL_VIEW'",[f.cases[0].caseId])).rows[0].n;
  const before=await views();
  const d=await f.run(t=>nhsoDetail(t,f.store,f.admin,a));
  const assigned=(await f.db.query<{d:string}>("SELECT to_char(min(assigned_at) AT TIME ZONE 'Asia/Bangkok','YYYY-MM-DD') d FROM lab_slot_assignment WHERE attempt_id=$1 AND removed_at IS NULL",[f.cases[0].attemptId])).rows[0].d;
  expect(d.patient).toEqual({nationalId:ID,ageYears:36,gravida:3,gaWeeks:17,gaDays:6,serviceDate:'2026-10-20',testDate:assigned});
  // the identity is never stored in clear by this module
  expect((await f.db.query("SELECT 1 FROM nhso_result_entry_event")).rows).toHaveLength(0);
  expect(await views()).toBe(before+1);
 }finally{await f.close();}
},600000);
