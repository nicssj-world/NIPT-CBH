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
import {releaseQueue,fixHrefFor,BOARD_CAPS,type BoardRow} from '../../packages/results/release-queue';

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

it('after sendToHis the row moves to SENT and counts change by one; each row is in exactly one tab; q and paging work',async()=>{
 const f=await task3Fixture();try{
  const a=await pending(f,0),b=await pending(f,1),u=await unlinked(f,2);
  const before=(await board(f,'READY')).counts;
  expect(before).toEqual({ACTION:1,READY:2,SENT:0});
  expect((await send(f,b.id)).items[0].outcome).toBe('CertifiedReleased');
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
