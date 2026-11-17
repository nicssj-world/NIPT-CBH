import {it,expect,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {task3Fixture,halosWorkbook,signerSetup,approveInterpretation,masters} from '../helpers/task3';
import {previewHalosImport,decideHalosImport,dismissHalosRow} from '../../packages/readygen/halos-import';
import {finalizeReports} from '../../packages/readygen/reports';
import {actionCenter,cancelRepeat} from '../../packages/lab/intake';
import {attemptFacts} from '../../packages/lab/core';
import {createBatch,assignToBatch} from '../../packages/lab/batch';
import {sendToHis} from '../../packages/results/send-his';
import {voidVersion} from '../../packages/results/service';
import {releaseQueue,type BoardRow} from '../../packages/results/release-queue';
import {certifyPending} from '../helpers/certify-pending';

// Owner 2026-11-17: Sequencing succeeded, the result is abnormal -> repeat like any Re-xx, before the result is sent.
// "ทุกขั้นตอนต้องไปต่อหรือย้อนกลับได้ ห้ามเป็นทางตัน": every state this creates must have a way forward.
// Native: renders through the installed Microsoft Word, like the other report tests. No Seq Task values are typed (HALOS is the analysis output).
const confirmations={reportContentVerified:true,identityAndValuesMatchReport:true,disclosureReviewed:true,abnormalAcknowledged:true} as const;
it('abnormal result: repeat from the HALOS evidence, the issued-but-unsent report cannot be sent and can be discarded, -2 goes to a new Task List; a sent result cannot be repeated',async()=>{
 const f=await task3Fixture([{ln:'9900099521',hn:'9900099961',pregnancy:'Singleton',sheet:1},{ln:'9900099522',hn:'9900099962',pregnancy:'Singleton',sheet:2},{ln:'9900099523',hn:'9900099963',pregnancy:'Singleton',sheet:3}],undefined,{worksheetMeasurements:false});
 try{
  const [a,b,c]=f.cases,deps={store:f.store,templates:masters()};
  const imp=await f.run(t=>previewHalosImport(t,f.u.staff,f.store,{name:'Sample analysis data_S990000021.xlsx',bytes:halosWorkbook({result:[{sample:a.printed,ff:'9.1'},{sample:b.printed,ff:'10.2'},{sample:c.printed,ff:'8.4'}],sampleinfo:[a,b,c].map(x=>({id:x.vendorId,fetus:x.pregnancy,ga:'17,6'}))})}));
  await f.run(t=>decideHalosImport(t,f.u.staff,{importId:imp.id,decision:'CONFIRM',expectedRowVersion:imp.rowVersion,acknowledgeWarnings:[...new Set(imp.issues.filter(i=>i.severity==='WARNING').map(i=>i.code))]}));
  const rowOf=(s:string)=>imp.rows.find(r=>r.sheet==='result'&&r.sampleKey===s)!.id;
  await signerSetup(f);await approveInterpretation(f,{interpretationApproved:true,approvalReference:'SYNTHETIC-HALOS-REPORTING'});
  const fin=await f.run(t=>finalizeReports(t,f.u.certifier,deps,{idempotencyKey:randomUUID(),defaults:{reportedBy:f.u.staff.id,approvedBy:f.u.certifier.id},release:true,releaseConfirmations:confirmations,items:[{rowId:rowOf(a.printed)},{rowId:rowOf(b.printed)}]}));
  for(const i of fin.items)expect(i,JSON.stringify(i)).toMatchObject({outcome:'FINAL',release:'PendingCertification'});
  const versionA=fin.items[0].versionId!,versionB=fin.items[1].versionId!;
  // B is sent.
  expect((await f.run(t=>certifyPending(t,f.u.certifier,versionB))).outcome).toBe('CertifiedReleased');

  // B: a sent result cannot be repeated (the Owner's choice: only before the result is sent); the message names the way on.
  const order=(attemptId:string,kind='RE_LIBRARY')=>({attemptId,kind,stage:'ABNORMAL_RESULT',reasonCode:'ABNORMAL_RESULT',note:'SYNTHETIC abnormal result, repeat to confirm'});
  expect((await attemptFacts(f.db,'a.id=$1',[b.attemptId]))[0].attempt_state).toBe('FinalQcAccepted');
  await expect(f.run(t=>actionCenter(t,f.u.staff,order(b.attemptId)))).rejects.toThrow('ABNORMAL_RESULT_ALREADY_SENT');
  expect((await attemptFacts(f.db,'a.id=$1',[b.attemptId]))[0].attempt_state).toBe('FinalQcAccepted');

  // C: not reported yet, no Seq values typed -> this attempt's row in the confirmed HALOS file is the evidence.
  expect((await attemptFacts(f.db,'a.id=$1',[c.attemptId]))[0].attempt_state).toMatch(/^(Assigned|InProgress)$/);
  const rc=await f.run(t=>actionCenter(t,f.u.staff,order(c.attemptId,'RE_EXTRACTION'))) as {attemptId:string;attemptNumber:number;printedSampleId:string};
  expect(rc.attemptNumber).toBe(2);expect(rc.printedSampleId).toMatch(/-2$/);
  const pc=(await attemptFacts(f.db,'a.id=$1',[c.attemptId]))[0];expect(pc.attempt_state).toBe('Superseded');expect(pc.qc_failed_stage).toBe('ABNORMAL_RESULT');

  // A: its report is issued but not sent. Issuing records QC5, so the attempt is already FinalQcAccepted; it must still be repeatable.
  expect((await attemptFacts(f.db,'a.id=$1',[a.attemptId]))[0].attempt_state).toBe('FinalQcAccepted');
  await expect(f.run(t=>actionCenter(t,f.u.staff,{...order(a.attemptId),stage:'QC1'}))).rejects.toThrow('ABNORMAL_RESULT_STAGE_REQUIRED');
  type Child={attemptId:string;attemptNumber:number;printedSampleId:string};
  const mistaken=await f.run(t=>actionCenter(t,f.u.staff,order(a.attemptId))) as Child;
  // Ordered by mistake -> "ยกเลิกคำสั่งตรวจซ้ำ": A is FinalQcAccepted again and its report is back in READY, sendable as before.
  const boardTabsOf=async(versionId:string)=>{const tabs:string[]=[];for(const tab of ['ACTION','READY'] as const){const x=await f.run(t=>releaseQueue(t,f.u.certifier,deps,{tab}));if((x.rows as BoardRow[]).some(row=>row.versionId===versionId))tabs.push(tab);}return tabs;};
  expect(await boardTabsOf(versionA)).toEqual(['ACTION']);
  expect(await f.run(t=>cancelRepeat(t,f.u.staff,{attemptId:mistaken.attemptId}))).toMatchObject({parentAttemptId:a.attemptId,restoredState:'FinalQcAccepted'});
  const restored=(await attemptFacts(f.db,'a.id=$1',[a.attemptId]))[0];expect(restored.attempt_state).toBe('FinalQcAccepted');expect(restored.qc_failed_stage).toBeNull();
  expect(await boardTabsOf(versionA)).toEqual(['READY']);
  // Ordered again on purpose: the same -2.
  const r=await f.run(t=>actionCenter(t,f.u.staff,order(a.attemptId))) as Child;
  expect(r.printedSampleId).toBe(mistaken.printedSampleId);
  expect((await f.db.query<{stage:string}>("SELECT stage FROM attempt_event WHERE attempt_id=$1 AND event_type='FAILURE_CONFIRMED'",[a.attemptId])).rows.map(x=>x.stage)).toEqual(['ABNORMAL_RESULT']);
  const parent=(await attemptFacts(f.db,'a.id=$1',[a.attemptId]))[0];
  expect(parent.attempt_state).toBe('Superseded');expect(parent.qc_failed_stage).toBe('ABNORMAL_RESULT');
  expect(r.attemptNumber).toBe(2);expect(r.printedSampleId).toMatch(/-2$/);
  expect((await attemptFacts(f.db,'a.id=$1',[r.attemptId]))[0].attempt_state).toBe('Ready');

  // The old report of A can no longer be sent ...
  const rv=async(id:string)=>(await f.db.query<{row_version:number;state:string}>('SELECT row_version,state FROM result_report_version WHERE id=$1',[id])).rows[0];
  const sent=await f.run(async t=>sendToHis(t,f.u.certifier,{idempotencyKey:randomUUID(),reviewConfirmed:true,abnormalAcknowledged:true,items:[{versionId:versionA,expectedRowVersion:(await rv(versionA)).row_version}]}));
  expect(sent.items[0].outcome,JSON.stringify(sent.items[0])).not.toBe('CertifiedReleased');
  expect((await f.db.query("SELECT 1 FROM result_release WHERE version_id=$1",[versionA])).rows).toHaveLength(0);
  // ... it is listed where a person can act on it, and discarding it leaves nothing of A stuck on the board.
  const board=async()=>{const out:{tab:string;row:BoardRow}[]=[];for(const tab of ['ACTION','READY'] as const){const x=await f.run(t=>releaseQueue(t,f.u.certifier,deps,{tab}));for(const row of x.rows as BoardRow[])out.push({tab,row});}return out;};
  const ofA=(rows:{tab:string;row:BoardRow}[])=>rows.filter(x=>x.row.versionId===versionA||x.row.sampleId===a.printed||x.row.lnHalos===a.printed);
  const before=ofA(await board());
  // Listed once, under ACTION (where the discard button is), saying why — not under READY as if it could still be sent.
  expect(before.map(x=>({tab:x.tab,versionId:x.row.versionId,reasons:x.row.reasons.map(y=>y.code)})),JSON.stringify(before)).toEqual([{tab:'ACTION',versionId:versionA,reasons:['ATTEMPT_REPEATED']}]);
  await f.run(async t=>voidVersion(t,f.u.certifier,{versionId:versionA,expectedRowVersion:(await rv(versionA)).row_version,reason:'SYNTHETIC abnormal result is being repeated'}));
  expect((await rv(versionA)).state).toBe('Voided');
  for(const left of ofA(await board())){
   expect(left.row.halosRowId,JSON.stringify(left)).toBeTruthy();
   await f.run(t=>dismissHalosRow(t,f.u.certifier,{rowId:left.row.halosRowId!,reason:'SYNTHETIC abnormal result is being repeated'}));
  }
  expect(ofA(await board())).toEqual([]);
  // C (never reported): whatever is left of its old HALOS row on the board can be dismissed, so nothing stays stuck either.
  const ofC=(rows:{tab:string;row:BoardRow}[])=>rows.filter(x=>x.row.sampleId===c.printed||x.row.lnHalos===c.printed);
  for(const left of ofC(await board())){
   expect(left.row.halosRowId,JSON.stringify(left)).toBeTruthy();
   await f.run(t=>dismissHalosRow(t,f.u.certifier,{rowId:left.row.halosRowId!,reason:'SYNTHETIC abnormal result is being repeated'}));
  }
  expect(ofC(await board())).toEqual([]);

  // Way forward: both -2 attempts go onto the Task List of a new Run.
  const nb=await f.run(t=>createBatch(t,f.u.staff));
  const v=async()=>(await f.db.query<{version:number}>('SELECT version FROM lab_batch WHERE id=$1',[nb.batchId])).rows[0].version;
  const placed=await f.run(async t=>assignToBatch(t,f.u.staff,{batchId:nb.batchId,expectedVersion:await v(),attemptIds:[r.attemptId,rc.attemptId],sheetNumber:1}));
  expect(placed.rejected).toEqual([]);
  for(const id of [r.attemptId,rc.attemptId])expect((await attemptFacts(f.db,'a.id=$1',[id]))[0].attempt_state).toBe('Assigned');
  // Statistics: both are repeats, neither is a QC failure.
  const qcFailed=(await f.db.query<{n:number}>(`SELECT count(*)::int n FROM attempt_event e JOIN analytical_attempt x ON x.id=e.attempt_id WHERE e.event_type='STATE_CHANGED' AND e.to_state='QcFailed'
   AND COALESCE(e.stage,x.qc_failed_stage) IS DISTINCT FROM 'ABNORMAL_RESULT' AND x.case_id=ANY($1::uuid[])`,[[a.caseId,c.caseId]])).rows[0].n;
  expect(qcFailed).toBe(0);
  expect((await f.db.query("SELECT 1 FROM repeat_work_order WHERE reason_code='ABNORMAL_RESULT' AND case_id=ANY($1::uuid[])",[[a.caseId,c.caseId]])).rows).toHaveLength(2);
 }finally{await f.close();vi.unstubAllEnvs();}
},300000);
