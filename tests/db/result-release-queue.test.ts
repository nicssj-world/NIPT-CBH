import {it,expect,vi} from 'vitest';
import {randomUUID,createHash} from 'node:crypto';
import {task3Fixture} from '../helpers/task3';
import {pdfDate} from '../helpers/results';
import {syntheticReportPdf} from '../../tools/his-simulator/result-pdf';
import {registerIntake,parseIntake} from '../../packages/results/intake';
import {reviewBenchForResult} from '../../packages/lab/bench-review';
import {confirmCompletion} from '../../packages/results/completion';
import {confirmImport,unlinkVersion,voidVersion} from '../../packages/results/service';
import {dismissHalosRow} from '../../packages/readygen/halos-import';
import {sendToHis} from '../../packages/results/send-his';
import {isSendResolvable,EVIDENCE_RECORDED_BY_SEND,releaseQueue,fixHrefFor,BOARD_CAPS,type BoardRow} from '../../packages/results/release-queue';

type F=Awaited<ReturnType<typeof task3Fixture>>;
const rowVersion=async(f:F,id:string)=>(await f.db.query<{row_version:number}>('SELECT row_version FROM result_report_version WHERE id=$1',[id])).rows[0].row_version;
const stateOf=async(f:F,id:string)=>(await f.db.query<{state:string}>('SELECT state FROM result_report_version WHERE id=$1',[id])).rows[0].state;
async function importPdf(f:F,index:number,name:string){
 const c=f.cases[index],bytes=syntheticReportPdf({kind:'SINGLETON',labNumber:c.printed,hn:c.hn,dob:'01-Jan-1990',collection:pdfDate('2026-10-20'),gaWeeks:17,gaDays:6,sex:null});
 const intakeId=await f.run(t=>registerIntake(t,f.store,{source:'UPLOAD',relativePath:null,originalName:name,actorId:f.admin.id,jobId:null},bytes));
 await f.run(t=>parseIntake(t,f.store,intakeId,{maxBytes:10000000,acceptZip:true}));
 await f.run(t=>reviewBenchForResult(t,f.admin,c.attemptId,{revision:1,measurementsReviewed:true,reason:'SYNTHETIC legacy paper-only result evidence review'}));
 return {c,intakeId};
}
async function pending(f:F,index:number){
 const {c,intakeId}=await importPdf(f,index,`SYNTHETIC-board-${index}.pdf`);
 const done=await f.run(t=>confirmCompletion(t,f.admin,{idempotencyKey:randomUUID(),abnormalAcknowledged:false,items:[{intakeId,caseId:c.caseId,roundId:c.roundId,attemptId:c.attemptId}]}));
 expect(done.items[0].outcome).toBe('PendingCertification');
 return {c,id:done.items[0].versionId!};
}
/** A ReadyGen PDF that is imported but not linked to a patient. */
async function unlinked(f:F,index:number){
 const {c,intakeId}=await importPdf(f,index,`SYNTHETIC-board-unlinked-${index}.pdf`);
 const id=(await f.run(t=>confirmImport(t,f.admin,{intakeIds:[intakeId]})))[0].versionId!;
 if(await stateOf(f,id)!=='Unlinked')await f.run(async t=>unlinkVersion(t,f.admin,{versionId:id,reason:'SYNTHETIC test returns the link to the manual path',expectedRowVersion:await rowVersion(f,id)}));
 expect(await stateOf(f,id)).toBe('Unlinked');
 return {c,id};
}
/** A confirmed HALOS result row for a patient attempt, with no PET/clinical evidence: its report is on HOLD (test set-up only). */
async function halosRow(f:F,index:number){
 const c=f.cases[index],sha=createHash('sha256').update(randomUUID()).digest('hex');
 await f.db.query("INSERT INTO file_asset(sha256,byte_size,media_type,storage_key) VALUES($1,10,'application/octet-stream',$2)",[sha,'sha256/x/'+sha]);
 const imp=(await f.db.query<{id:string}>("INSERT INTO halos_import(sha256,original_name,byte_size,adapter_version,chip_ids,counts,state,uploaded_by,decided_by,decided_at) VALUES($1,'SYNTHETIC-board-halos.xlsx',10,'SYNTHETIC-ADAPTER',ARRAY['C1'],'{}','Confirmed',$2,$2,now()) RETURNING id",[sha,f.admin.id])).rows[0].id;
 return (await f.db.query<{id:string}>("INSERT INTO halos_import_row(import_id,sheet,row_number,raw,sample_raw,sample_key,classification,reason,case_id,round_id,attempt_id,export_kind,export_id,mapping) VALUES($1,'result',2,'{}',$2,$2,'PATIENT','MATCHED',$3,$4,$5,'P4B_HALOS_EXPORT',$6,'{}') RETURNING id",[imp,c.printed,c.caseId,c.roundId,c.attemptId,randomUUID()])).rows[0].id;
}
const board=(f:F,tab:'ACTION'|'READY'|'SENT',extra:Record<string,unknown>={},user=f.admin)=>f.run(t=>releaseQueue(t,user,{store:f.store},{tab,...extra}));
const send=async(f:F,id:string)=>f.run(async t=>sendToHis(t,f.admin,{idempotencyKey:randomUUID(),reviewConfirmed:true,abnormalAcknowledged:false,items:[{versionId:id,expectedRowVersion:await rowVersion(f,id)}]}));

it('a confirmCompletion result appears in READY with reviewed=true and a pdfHref; an Unlinked ReadyGen PDF appears in ACTION with a reason',async()=>{
 const f=await task3Fixture();try{
  const p=await pending(f,0),u=await unlinked(f,1);
  const ready=await board(f,'READY');
  expect(ready.rows).toHaveLength(1);
  expect(ready.rows[0]).toMatchObject({key:`version:${p.id}`,source:'READYGEN',versionId:p.id,halosRowId:null,reviewed:true,abnormal:false,reasons:[],pdfHref:`/api/p5/results/${p.id}/file`,ln:p.c.ln,hn:p.c.hn});
  expect(ready.rows[0].rowVersion).toBe(await rowVersion(f,p.id));
  const action=await board(f,'ACTION');
  expect(action.rows).toHaveLength(1);
  expect(action.rows[0]).toMatchObject({versionId:u.id,reviewed:false,reasons:[{code:'UNLINKED'}]});
  expect(action.counts).toEqual({ACTION:1,READY:1,SENT:0});
  expect(ready.page).toEqual({number:1,size:50,total:1,totalPages:1,hasNext:false});
 }finally{vi.unstubAllEnvs();await f.close();}
},300000);

it('after sendToHis the row stays in READY while the files are written, moves to SENT when written, to ACTION when the send failed; each row is in exactly one tab; q and paging work',async()=>{
 const f=await task3Fixture();try{
  const a=await pending(f,0),b=await pending(f,1),u=await unlinked(f,2);
  const before=(await board(f,'READY')).counts;
  expect(before).toEqual({ACTION:1,READY:2,SENT:0});
  expect((await send(f,b.id)).items[0].outcome).toBe('CertifiedReleased');
  // Owner 2026-11-11 (option ข.): "ส่งแล้ว" means the PDF, .res and .ok were written. Until the job has a receipt the row is "กำลังส่ง HIS" in READY.
  const sending=await board(f,'READY');
  expect(sending.counts).toEqual(before);
  expect(sending.rows.find(r=>r.versionId===b.id)?.hisDelivery?.code).toBe('QUEUED');
  const releaseId=(await f.db.query<{id:string}>("SELECT id FROM result_release WHERE version_id=$1 AND state='Active'",[b.id])).rows[0].id;
  const receipt=async(result:Record<string,unknown>)=>{const j=(await f.db.query<{id:string}>("INSERT INTO job_outbox(kind,payload,idempotency_key) VALUES('result_release_completed',$1,$2) RETURNING id",[JSON.stringify({releaseId,resend:true}),'test-resend:'+randomUUID()])).rows[0].id;
   await f.db.query("UPDATE job_outbox SET created_at=clock_timestamp() WHERE id=$1",[j]);await f.db.query('INSERT INTO integration_job_receipt(outbox_id,result) VALUES($1,$2)',[j,result]);};
  // The send failed: ACTION, with the reason and a link to the HIS outbound settings when the folder is the cause.
  await receipt({sent:false,error:'SHARE_PATH_NOT_FOUND',resend:true});
  const failed=await board(f,'ACTION');
  expect(failed.counts).toEqual({ACTION:before.ACTION+1,READY:before.READY-1,SENT:0});
  expect(failed.rows.find(r=>r.versionId===b.id)?.reasons).toEqual([{code:'HIS_SEND:SHARE_PATH_NOT_FOUND',fixHref:'/settings?key=his_outbound'}]);
  await receipt({sent:true,sentAt:new Date().toISOString(),pdfName:'x.pdf',resName:'x.res',okName:'x.ok',resend:true});
  const after=await board(f,'SENT');
  expect(after.counts).toEqual({ACTION:before.ACTION,READY:before.READY-1,SENT:before.SENT+1});
  expect(after.rows.map(r=>r.versionId)).toEqual([b.id]);
  expect(after.rows[0].hisDelivery).toBeDefined();
  expect(after.rows[0].reviewed).toBe(true);
  // Exactly one tab per row, and the tab totals equal the counts.
  const all:BoardRow[]=[];
  for(const tab of ['ACTION','READY','SENT'] as const){const r=await board(f,tab,{pageSize:100});expect(r.page.total).toBe(r.counts[tab]);all.push(...r.rows);}
  const keys=all.map(r=>r.key);
  expect(new Set(keys).size).toBe(keys.length);
  expect(new Set(keys)).toEqual(new Set([`version:${a.id}`,`version:${b.id}`,`version:${u.id}`]));
  // Search by LN, HN, then something that matches nothing; counts follow the search.
  expect((await board(f,'READY',{q:a.c.ln})).rows.map(r=>r.versionId)).toEqual([a.id]);
  expect((await board(f,'READY',{q:a.c.hn})).rows.map(r=>r.versionId)).toEqual([a.id]);
  expect((await board(f,'SENT',{q:a.c.ln})).rows).toEqual([]);
  expect((await board(f,'READY',{q:'ZZZ-no-such'})).counts).toEqual({ACTION:0,READY:0,SENT:0});
  // Paging: page 2 of a one-row tab is empty with the same total; pageSize below 10 is refused.
  const p2=await board(f,'READY',{page:2});
  expect(p2.rows).toEqual([]);expect(p2.page).toMatchObject({number:2,total:1,hasNext:false});
  await expect(board(f,'READY',{pageSize:5})).rejects.toThrow();
  // A user without result.review sees nothing at all.
  await expect(board(f,'READY',{},f.u.anc)).rejects.toThrow();
 }finally{vi.unstubAllEnvs();await f.close();}
},300000);

it('a HALOS row on HOLD is in ACTION with its hold codes; dismissed, voided and EQA-scope items appear in no tab',async()=>{
 const f=await task3Fixture();try{
  const u=await unlinked(f,1),p=await pending(f,0);
  const row=await halosRow(f,2);
  const action=await board(f,'ACTION');
  const h=action.rows.find(r=>r.halosRowId===row)!;
  expect(h).toMatchObject({key:`halos:${row}`,source:'HALOS',versionId:null,rowVersion:null,abnormal:false,reviewed:false,pdfHref:null,sampleId:f.cases[2].printed});
  expect(h.reasons.length).toBeGreaterThan(0);
  expect(action.counts.ACTION).toBe(2);
  await f.run(t=>dismissHalosRow(t,f.admin,{rowId:row,reason:'SYNTHETIC nothing to report for this row'}));
  await f.run(async t=>voidVersion(t,f.admin,{versionId:u.id,reason:'SYNTHETIC discard this stuck item',expectedRowVersion:await rowVersion(f,u.id)}));
  const after=await board(f,'ACTION');
  expect(after.rows).toEqual([]);expect(after.counts).toEqual({ACTION:0,READY:1,SENT:0});
  await f.run(async t=>voidVersion(t,f.admin,{versionId:p.id,reason:'SYNTHETIC discard the waiting item',expectedRowVersion:await rowVersion(f,p.id)}));
  expect((await board(f,'READY')).counts).toEqual({ACTION:0,READY:0,SENT:0});
  // EQA scope is a separate split: nothing of the patient fixture is in it.
  expect((await board(f,'READY',{scope:'EQA'})).counts).toEqual({ACTION:0,READY:0,SENT:0});
 }finally{vi.unstubAllEnvs();await f.close();}
},300000);

it('fixHrefFor sends patient-data reasons to the case and ruleset reasons to settings, others to nowhere',()=>{
 expect(fixHrefFor('PET_EVIDENCE_REQUIRED','c1')).toBe('/cases/c1');
 expect(fixHrefFor('PREGNANCY_TYPE_NOT_RECORDED','c1')).toBe('/cases/c1');
 expect(fixHrefFor('CLINICAL_DATA_NOT_READY','c1')).toBe('/cases/c1');
 expect(fixHrefFor('CONSENT_REVOKED','c1')).toBe('/cases/c1');
 expect(fixHrefFor('PET_EVIDENCE_REQUIRED',null)).toBeUndefined();
 expect(fixHrefFor('INTERPRETATION_RULESET_NOT_APPROVED','c1')).toBe('/settings?key=report_interpretation');
 expect(fixHrefFor('PRODUCT_TEMPLATE_COMBINATION_NOT_APPROVED',null)).toBe('/settings?key=report_interpretation');
 expect(fixHrefFor('UNLINKED','c1')).toBeUndefined();
 expect(fixHrefFor('SOME_OTHER_TEMPLATE_THING','c1')).toBeUndefined();
 expect(fixHrefFor('XPRODUCT_UNRECOGNIZED','c1')).toBeUndefined();
 expect(BOARD_CAPS).toEqual({halos:500,versions:1000});
});

it('q finds a row by LN Halos and by sample id; a HALOS HOLD row and a version of the same patient are both listed under separate keys',async()=>{
 const f=await task3Fixture();try{
  const u=await unlinked(f,1),row=await halosRow(f,1);
  const lnHalos=(await f.db.query<{ln_halos:string|null}>('SELECT ln_halos FROM specimen_lab_number WHERE round_id=$1',[f.cases[1].roundId])).rows[0]?.ln_halos;
  const action=await board(f,'ACTION');
  expect(action.rows.map(r=>r.key).sort()).toEqual([`halos:${row}`,`version:${u.id}`].sort());
  expect(action.counts.ACTION).toBe(2);expect(action.page.total).toBe(2);
  expect((await board(f,'ACTION',{q:f.cases[1].printed})).rows.some(r=>r.versionId===u.id)).toBe(true);
  if(lnHalos)expect((await board(f,'ACTION',{q:lnHalos})).rows.some(r=>r.halosRowId===row||r.versionId===u.id)).toBe(true);
  expect((await board(f,'ACTION',{q:'ZZZ-no-such'})).rows).toEqual([]);
 }finally{vi.unstubAllEnvs();await f.close();}
},300000);

it('a caps-limited read sets truncated; the normal read does not; a real ValidationBlocked version carries fixHref exactly as the map says',async()=>{
 const f=await task3Fixture();try{
  const a=await pending(f,0),b=await pending(f,1);
  expect((await board(f,'READY')).truncated).toBe(false);
  const capped=await f.run(t=>releaseQueue(t,f.admin,{store:f.store},{tab:'READY'},{halos:500,versions:1}));
  expect(capped.truncated).toBe(true);expect(capped.counts.READY).toBe(1);expect(capped.rows).toHaveLength(1);
  await f.db.query("INSERT INTO p2_revocation(case_id,round_id,stage,reason,actor_id) VALUES($1,$2,'W1','SYNTHETIC consent withdrawal while waiting',$3)",[b.c.caseId,b.c.roundId,f.u.staff.id]);
  const r=await f.run(async t=>sendToHis(t,f.admin,{idempotencyKey:randomUUID(),reviewConfirmed:true,abnormalAcknowledged:false,items:[{versionId:b.id,expectedRowVersion:await rowVersion(f,b.id)}]}));
  expect(r.items[0].outcome).toBe('BLOCKED');
  const row=(await board(f,'ACTION')).rows.find(x=>x.versionId===b.id)!;
  expect(row.reasons.length).toBeGreaterThan(0);
  for(const x of row.reasons)expect(x.fixHref).toBe(fixHrefFor(x.code,b.c.caseId));
  expect(row.reasons.map(x=>x.code).join()).toContain('CONSENT');
  expect(a.id).toBeTruthy();
 }finally{vi.unstubAllEnvs();await f.close();}
},300000);

// R9: a linked version whose only open gate items are the ones "ส่ง HIS" records itself (review + QC5) is listed in READY with reviewed=false.
async function linkedWithoutReview(f:F,index:number){
 const {proposeAutoMatch,decideLink}=await import('../../packages/results/service');
 const c=f.cases[index],bytes=syntheticReportPdf({kind:'SINGLETON',labNumber:c.printed,hn:c.hn,dob:'01-Jan-1990',collection:pdfDate('2026-10-20'),gaWeeks:17,gaDays:6,sex:null});
 const intakeId=await f.run(t=>registerIntake(t,f.store,{source:'UPLOAD',relativePath:null,originalName:`SYNTHETIC-linked-no-review-${index}.pdf`,actorId:f.admin.id,jobId:null},bytes));
 await f.run(t=>parseIntake(t,f.store,intakeId,{maxBytes:10000000,acceptZip:true}));
 await f.run(t=>reviewBenchForResult(t,f.admin,c.attemptId,{revision:1,measurementsReviewed:true,reason:'SYNTHETIC legacy paper-only result evidence review'}));
 const id=(await f.run(t=>confirmImport(t,f.admin,{intakeIds:[intakeId]})))[0].versionId!;
 const rv=async()=>(await f.db.query<{state:string;row_version:number}>('SELECT state,row_version FROM result_report_version WHERE id=$1',[id])).rows[0];
 let v=await rv();
 if(v.state==='Unlinked'){await f.run(t=>proposeAutoMatch(t,f.admin,{versionId:id,expectedRowVersion:v.row_version}));v=await rv();}
 if(v.state==='Unlinked'){await f.run(t=>decideLink(t,f.admin,{versionId:id,decision:'APPROVE',reason:'SYNTHETIC approve link for test',expectedRowVersion:v.row_version}));v=await rv();}
 return {c,id,state:v.state};
}
it('a linked version failing only RG-06/RG-07/RG-01 (no review, no QC5) is in READY with reviewed=false, in no other tab, and sends with reviewConfirmed',async()=>{
 const f=await task3Fixture();try{
  const l=await linkedWithoutReview(f,0);
  expect(['Linked','ValidationBlocked']).toContain(l.state);
  const ready=await board(f,'READY'),action=await board(f,'ACTION');
  const row=ready.rows.find(r=>r.versionId===l.id);
  expect(row).toMatchObject({reviewed:false});
  expect(action.rows.some(r=>r.versionId===l.id)).toBe(false);
  expect(ready.counts.READY).toBe(ready.page.total);expect(action.counts.ACTION).toBe(action.page.total);
  const r=await f.run(t=>sendToHis(t,f.admin,{idempotencyKey:randomUUID(),reviewConfirmed:true,abnormalAcknowledged:false,items:[{versionId:l.id,expectedRowVersion:row!.rowVersion!}]}));
  expect(r.items[0].outcome).toBe('CertifiedReleased');
  expect((await f.db.query('SELECT 1 FROM result_review WHERE version_id=$1',[l.id])).rows.length).toBe(1);
  expect((await f.db.query('SELECT 1 FROM result_qc5_review WHERE version_id=$1',[l.id])).rows.length).toBe(1);
 }finally{vi.unstubAllEnvs();await f.close();}
},180000);
it('a linked version that also fails for another reason (consent revoked) stays in ACTION with its reasons',async()=>{
 const f=await task3Fixture();try{
  const l=await linkedWithoutReview(f,1);
  await f.db.query("INSERT INTO p2_revocation(case_id,round_id,stage,reason,actor_id) VALUES($1,$2,'W1','SYNTHETIC consent withdrawal',$3)",[l.c.caseId,l.c.roundId,f.u.staff.id]);
  const ready=await board(f,'READY'),action=await board(f,'ACTION');
  expect(ready.rows.some(r=>r.versionId===l.id)).toBe(false);
  const row=action.rows.find(r=>r.versionId===l.id);expect(row).toBeTruthy();
  expect(row!.reasons.map(x=>x.code)).toContain('CONSENT_REVOKED');
 }finally{vi.unstubAllEnvs();await f.close();}
},180000);

it('isSendResolvable: only items that sending records itself',()=>{
 expect(isSendResolvable({failed:['RG-06:ANALYSIS_COMPLETION_NOT_RECORDED','RG-07:FINAL_QC_NOT_ACCEPTED','RG-12:REVIEW_NOT_RECORDED'],pending:['RG-01:OD-07:TEMPLATE_AND_PIC_NOT_APPROVED']})).toBe(true);
 expect(isSendResolvable({failed:[],pending:['RG-11:OD-09:DISCLOSURE_RULE_PROPOSED_ONLY']})).toBe(true);
 expect(isSendResolvable({failed:['RG-07:FINAL_QC_NOT_ACCEPTED','RG-10:CONSENT_REVOKED'],pending:[]})).toBe(false);
 expect(isSendResolvable({failed:['RG-03:NOT_LINKED'],pending:[]})).toBe(false);
 expect(isSendResolvable({failed:['RG-06:UPSTREAM_EVIDENCE_MISSING'],pending:[]})).toBe(false);
 expect(isSendResolvable({failed:[],pending:['RG-09:OD-08:CLINICAL_RULES_NOT_APPROVED']})).toBe(false);
 expect(isSendResolvable({failed:[],pending:[]})).toBe(false);
 expect(EVIDENCE_RECORDED_BY_SEND.size).toBe(7);
});
