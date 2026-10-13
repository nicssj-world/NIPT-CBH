import type {Queryable} from '../../packages/db/connection';
import type {Principal} from '../../packages/security/policy';
import {FIELDS} from '../../packages/lab/fields';
import * as batch from '../../packages/lab/batch';
import * as rec from '../../packages/lab/records';
import {syntheticCase,receiveS1,attemptOf,tx,version,setPendingPolicy} from './lab';
export const POOL_SCENARIO={controls:'PATIENT_ONLY',targetPmol:'16',ngPerPmol:'160',desiredVolume:'768',buffer:'TE',pipetteDecimals:2} as const;
/** Real P4 service journey on disposable synthetic databases; no forged verification or signatures. */
export async function poolingFixture(db:Queryable,u:{staff:Principal;certifier:Principal;approver:Principal;unit:string},deps:rec.DocDeps,count=2){
 await setPendingPolicy(db,u,'PROCEED_SYNTHETIC_LABELLED');
 const cases=[];
 for(let i=0;i<count;i++){const c=await tx(db,t=>syntheticCase(t,u));await tx(db,t=>receiveS1(t,c,new Date(Date.now()-(count-i)*60000)));cases.push(c);}
 const attempts=await Promise.all(cases.map(c=>attemptOf(db,c.roundId)));
 const b=await tx(db,t=>batch.createBatch(t,u.staff)),id=b.batchId;
 const call=async(fn:(t:Queryable,u:Principal,input:unknown)=>Promise<unknown>,extra:Record<string,unknown>={})=>tx(db,async t=>fn(t,u.staff,{batchId:id,expectedVersion:await version(t,id),...extra}));
 await call(batch.assignToBatch,{attemptIds:attempts.map(a=>a.id),queueOverrideReason:'จำลอง Pool fixture FIFO'});
 const placed=(await db.query<{slot_number:number;sheet_number:number}>(`SELECT a.slot_number,s.sheet_number FROM lab_slot_assignment a JOIN lab_batch_slot s ON s.batch_id=a.batch_id AND s.slot_number=a.slot_number WHERE a.batch_id=$1 AND a.removed_at IS NULL ORDER BY a.slot_number`,[id])).rows;
 const sheets=[...new Set(placed.map(p=>p.sheet_number))],slots=[...placed.map(p=>p.slot_number),...[1,25,40].filter(n=>sheets.includes(Math.floor((n-1)/16)+1))].sort((a,b)=>a-b);
 const observationIds:string[]=[];
 const add=async(x:Record<string,unknown>)=>{const r=await tx(db,async t=>rec.recordObservation(t,u.staff,{batchId:id,expectedVersion:await version(t,id),source:'DIRECT_ENTRY',...x}));observationIds.push(r.id);};
 for(const sheetNumber of sheets){
  await call(batch.updateSheetPlan,{sheetNumber,plannedWorkDate:'2026-10-13',plannedOperator:'จำลอง Pool fixture',plannedExtractionLot:null,plannedExtractionExpiry:null,plannedLibraryLot:null,plannedLibraryExpiry:null});
  await call(batch.planCheck,{sheetNumber,confirm:{controlsAtTemplate:true,identifiersMatch:true,noDuplicates:true}});await call(batch.finalizeSheet,{sheetNumber});
  await tx(db,async t=>rec.issuePreWork(t,u.staff,{batchId:id,expectedVersion:await version(t,id),sheetNumber},deps));await call(batch.startExecution,{sheetNumber});
  observationIds.length=0;
  await add({sheetNumber,fieldId:'F2-05',value:{text:'จำลอง ผู้ปฏิบัติ'}});await add({sheetNumber,fieldId:'F2-02',value:{date:'2026-10-13'}});
  for(const fieldId of ['F2-13','F2-14'])await add({sheetNumber,fieldId,value:{lot:'SYN-POOL',expiry:'2027-01-31'}});
  await add({sheetNumber,fieldId:'F2-24',value:{start:'09:00',end:'11:30'}});
  for(const f of FIELDS.filter(x=>x.form==='F2'&&x.kind==='CHECK'&&x.required(sheetNumber)))await add({sheetNumber,fieldId:f.id,item:f.item,value:{checked:true}});
  for(const slot of slots.filter(n=>Math.floor((n-1)/16)+1===sheetNumber))await add({sheetNumber,slot,fieldId:'F2-11',value:{before:true,after:true}});
  await call(batch.endExecution,{sheetNumber});await tx(db,t=>rec.reviewObservations(t,u.certifier,{observationIds:[...observationIds],result:'Confirmed'}));
  await tx(db,async t=>rec.verifyExecution(t,u.certifier,{batchId:id,expectedVersion:await version(t,id),sheetNumber}));
 }
 observationIds.length=0;
 for(const slot of slots)await add({slot,fieldId:'F3-03',value:{value:'10',unit:'ng/uL'}});
 await tx(db,t=>rec.reviewObservations(t,u.certifier,{observationIds,result:'Confirmed'}));
 for(const a of attempts)await tx(db,t=>rec.decideStageQc1(t,u.certifier,{attemptId:a.id,decision:'Accepted',reason:'จำลอง ยอมรับ QC1 เท่านั้น'}));
 return {batchId:id,attempts,cases,slots};
}
