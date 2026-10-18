import {z} from 'zod';
import {operationalWorkflow} from './operational';
import {createHash,randomUUID} from 'node:crypto';
import type {Queryable} from '../db/connection';
import type {FileStore} from '../storage';
import {authorize} from '../security/policy';
import {contentHash} from '../p2/service';
import {P4_TEMPLATE_VERSION,type P4Document} from '../pdf/p4';
import {CONTROL_LABEL,getSheetNumber,getPlatePosition,stripLabels,controlTypeOf,formatPrintedControlId} from './rules';
import {FIELDS,FIELD_INVENTORY_STATUS,fieldDef,requiredSheetFields,type FieldDef} from './fields';
import {qc1Candidates,QC1_CRITERIA} from './qc';
import {LabError,uuid,reasonText,need,assertSession,audit,caseEvent,attemptEvent,setAttemptState,attemptFacts,candidatePrintedId,caseVisible,DISPOSITION_REASONS,type Staff} from './core';
import {lockBatch,sheetOf,latestSnapshot,FINALIZED,EDITABLE,type PlacementPayload} from './batch';
import {isNativeIssue,type NativeIssuePort} from '../workbook/controlled';
import {labelNativeCopy} from '../workbook/controlled-copy';
import {isoDate,bangkokIsoDay,displayBe} from '../domain/thai-date';

export type DocDeps={render:(doc:P4Document)=>Promise<Buffer>;store:FileStore;native?:NativeIssuePort};
const no13=(v:string)=>!/\d{13}/.test(v);
const hhmm=z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const VALUE:Record<FieldDef['kind'],z.ZodType>={
 TRANSFER:z.strictObject({before:z.literal(true),after:z.literal(true)}),
 CHECK:z.strictObject({checked:z.literal(true)}),
 TEXT:z.strictObject({text:z.string().trim().min(1).max(120).refine(no13)}),
 DATE:z.strictObject({date:isoDate,deviationReason:reasonText.optional()}),
 LOT:z.strictObject({lot:z.string().trim().min(1).max(60).refine(no13),expiry:isoDate}),
 TIME_RANGE:z.strictObject({start:hhmm,end:hhmm}).refine(v=>v.start<=v.end,'END_BEFORE_START'),
 NUMBER:z.strictObject({value:z.string().regex(/^\d{1,4}(\.\d{1,3})?$/),unit:z.literal('ng/uL')})
};
export function valueText(def:FieldDef,v:Record<string,unknown>){
 switch(def.kind){case 'TRANSFER':return '✓ ก่อนดูด / ✓ หลังดูด';case 'CHECK':return '✓';case 'TEXT':return String(v.text);case 'DATE':return displayBe(String(v.date))+(v.deviationReason?` — ต่างจากวันที่วางแผนที่ใช้สร้างรหัส Control (รหัสคงเดิม) เหตุผล: ${String(v.deviationReason)}`:'');
  case 'LOT':return `${v.lot} / Exp. ${displayBe(String(v.expiry))}`;case 'TIME_RANGE':return `${v.start}–${v.end}`;case 'NUMBER':return `${v.value} ng/µL`;}
}
type Obs={id:string;batch_id:string;sheet_id:string|null;slot_number:number|null;field_id:string;item:string;value:Record<string,unknown>;source:'PAPER_TRANSCRIPTION'|'DIRECT_ENTRY';event_time:Date|null;event_time_precision:string;recorded_at:Date;recorded_by:string;status:string;recorder:string;reviewer:string|null};
async function liveObservations(db:Queryable,batchId:string){
 return (await db.query<Obs>(`SELECT o.*,u.display_name recorder,(SELECT ru.display_name FROM lab_observation_review r JOIN app_user ru ON ru.id=r.reviewer_id WHERE r.observation_id=o.id ORDER BY r.created_at DESC LIMIT 1) reviewer
  FROM lab_observation o JOIN app_user u ON u.id=o.recorded_by WHERE o.batch_id=$1 AND o.status<>'Superseded' ORDER BY o.sequence`,[batchId])).rows;
}
/** Slots physically in use on a finalized sheet: its control plus the attempts placed in the latest Placement snapshot. */
function inUse(p:PlacementPayload){return p.slots.filter(s=>s.control||s.attemptId);}
type Disp={id:string;slot_number:number;stage:string;disposition:string;reason_code:string;note:string;confirmed_at:Date|null};
async function dispositions(db:Queryable,batchId:string){return (await db.query<Disp>('SELECT id,slot_number,stage,disposition,reason_code,note,confirmed_at FROM lab_slot_disposition WHERE batch_id=$1',[batchId])).rows;}

export async function recordObservation(db:Queryable,user:Staff,input:unknown){
 await assertSession(db,user);
 const d=z.strictObject({batchId:uuid,expectedVersion:z.number().int().min(0),sheetNumber:z.number().int().min(1).max(3).optional(),slot:z.number().int().min(1).max(48).optional(),fieldId:z.string().regex(/^F[23]-\d{2}$/),item:z.string().regex(/^[A-Z0-9_]{0,40}$/).default(''),
  value:z.record(z.string(),z.unknown()),source:z.enum(['PAPER_TRANSCRIPTION','DIRECT_ENTRY']),documentCopyId:uuid.optional(),eventTime:z.iso.datetime({offset:true}).nullable().optional(),eventPrecision:z.enum(['MINUTE','DAY','NOT_RECORDED']).optional(),
  supersedesId:uuid.optional(),correctionReason:reasonText.optional()}).parse(input);
 const def=fieldDef(d.fieldId,d.item);
 need(user,def.form==='F3'?'qc.record':d.source==='PAPER_TRANSCRIPTION'?'observation.transcribe':'execution.record');
 const value=VALUE[def.kind].parse(d.value) as Record<string,unknown>;
 const b=await lockBatch(db,d.batchId,d.expectedVersion);
 if(def.scope==='SLOT'&&!d.slot)throw new LabError('SLOT_REQUIRED',422);if(def.scope!=='SLOT'&&d.slot)throw new LabError('SLOT_NOT_ALLOWED',422);
 const sheetNumber=def.form==='F2'?d.sheetNumber:undefined;
 if(def.form==='F2'&&!sheetNumber)throw new LabError('SHEET_REQUIRED',422);
 if(def.form==='F2'&&d.slot&&getSheetNumber(d.slot)!==sheetNumber)throw new LabError('SLOT_NOT_IN_SHEET',422);
 const sheet=sheetNumber?await sheetOf(db,b.id,sheetNumber):d.slot?await sheetOf(db,b.id,getSheetNumber(d.slot)):null;
 if(def.form==='F2'&&sheet&&!def.required(sheet.sheet_number))throw new LabError('FIELD_NOT_ON_THIS_SHEET',422);
 // OD-E / OD-T (Owner 2026-10-18): control IDs were fixed from the planned Library date when execution started and never change.
 // An actual Library Preparation date (F2-02) that differs keeps them and must carry a short reason; no other field carries one.
 if(value.deviationReason!==undefined&&d.fieldId!=='F2-02')throw new LabError('DEVIATION_REASON_NOT_APPLICABLE',422);
 if(d.fieldId==='F2-02'&&sheet&&FINALIZED.includes(sheet.state)){
  const planned=(await latestSnapshot(db,sheet.id)).payload.plan.workDate;
  if(planned&&value.date!==planned&&!value.deviationReason)throw new LabError('LIBRARY_DATE_DEVIATION_REASON_REQUIRED',422,{plannedWorkDate:planned});
  if(planned&&value.date===planned&&value.deviationReason!==undefined)throw new LabError('DEVIATION_REASON_NOT_APPLICABLE',422);
 }
 if(d.slot&&sheet){
  if(!FINALIZED.includes(sheet.state))throw new LabError('SHEET_NOT_FINALIZED',409);
  const snap=await latestSnapshot(db,sheet.id);if(!inUse(snap.payload).some(s=>s.slot===d.slot))throw new LabError('SLOT_NOT_IN_USE',409);
  const stage=def.form==='F2'?'TRANSFER':'QC1';
  if((await dispositions(db,b.id)).some(x=>x.slot_number===d.slot&&x.stage===stage))throw new LabError('SLOT_HAS_DISPOSITION',409);
 }
 // DIRECT_ENTRY: the event happens now (server time). PAPER: the time written on the working copy, or NOT_RECORDED — never invented.
 const now=new Date();let eventTime:Date|null=null,precision:'MINUTE'|'DAY'|'NOT_RECORDED'='MINUTE';
 if(d.source==='PAPER_TRANSCRIPTION'){if(!d.documentCopyId)throw new LabError('WORKING_COPY_REQUIRED',422);precision=d.eventPrecision??(d.eventTime?'MINUTE':'NOT_RECORDED');eventTime=precision==='NOT_RECORDED'?null:d.eventTime?new Date(d.eventTime):null;if(precision!=='NOT_RECORDED'&&!eventTime)throw new LabError('EVENT_TIME_REQUIRED',422);if(eventTime&&eventTime>now)throw new LabError('EVENT_TIME_FUTURE',422);}
 else if(d.documentCopyId)throw new LabError('WORKING_COPY_ONLY_FOR_PAPER',422);
 const live=(await db.query<{id:string;status:string}>("SELECT id,status FROM lab_observation WHERE batch_id=$1 AND field_id=$2 AND item=$3 AND sheet_id IS NOT DISTINCT FROM $4 AND slot_number IS NOT DISTINCT FROM $5 AND status<>'Superseded' FOR UPDATE",[b.id,d.fieldId,d.item,def.form==='F2'?sheet!.id:null,d.slot??null])).rows;
 if(live.length&&!d.supersedesId)throw new LabError('OBSERVATION_EXISTS_USE_CORRECTION',409);
 if(d.supersedesId){
  if(!live.some(x=>x.id===d.supersedesId))throw new LabError('SUPERSEDE_TARGET_MISMATCH',409);
  if(!d.correctionReason)throw new LabError('CORRECTION_REASON_REQUIRED',422);
  if(def.form==='F2'&&sheet&&['ExecutionVerified','CompletedIssued'].includes(sheet.state))throw new LabError('CORRECTION_AFTER_VERIFICATION_NOT_IN_P4',409);
  if(def.form==='F3'&&(await db.query("SELECT 1 FROM lab_document WHERE batch_id=$1 AND form='F3' AND kind='COMPLETED' AND status='Issued'",[b.id])).rows[0])throw new LabError('CORRECTION_AFTER_VERIFICATION_NOT_IN_P4',409);
  await db.query("UPDATE lab_observation SET status='Superseded' WHERE id=$1",[d.supersedesId]);
 }
 const id=(await db.query<{id:string}>("INSERT INTO lab_observation(batch_id,sheet_id,slot_number,field_id,item,value,source,document_copy_id,event_time,event_time_precision,recorded_by,supersedes_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,CASE WHEN $7='DIRECT_ENTRY' THEN now() ELSE $9::timestamptz END,$10,$11,$12) RETURNING id",
  [b.id,def.form==='F2'?sheet!.id:null,d.slot??null,d.fieldId,d.item,JSON.stringify(value),d.source,d.documentCopyId??null,eventTime,precision,user.id,d.supersedesId??null])).rows[0].id;
 await db.query('UPDATE lab_batch SET version=version+1 WHERE id=$1',[b.id]);
 await db.query('INSERT INTO lab_batch_event(batch_id,sheet_number,event_type,reason,actor_id,details) VALUES($1,$2,$3,$4,$5,$6)',[b.id,sheet?.sheet_number??null,d.supersedesId?'OBSERVATION_CORRECTED':'OBSERVATION_RECORDED',d.correctionReason??null,user.id,JSON.stringify({fieldId:d.fieldId,item:d.item,slot:d.slot??null,source:d.source})]);
 await audit(db,user,d.supersedesId?'LAB_OBSERVATION_CORRECTED':'LAB_OBSERVATION_RECORDED','lab_observation',id,{outcome:d.source});
 const warnings:string[]=[];
 // Warning only (OD-L): compared with the Task's planned work date, else the Bangkok calendar day (never UTC).
 if(def.kind==='LOT'&&String(value.expiry)<(sheet?.planned_work_date??bangkokIsoDay()))warnings.push('LOT_EXPIRED_BEFORE_WORK_DATE_OD33');
 const candidates=def.kind==='NUMBER'&&d.slot?qc1Candidates(String(value.value),rowKind(d.slot)):null;
 return {id,warnings,candidates};
}
const rowKind=(slot:number)=>{const c=controlTypeOf(slot);return c?CONTROL_LABEL[c] as 'PC'|'NC'|'BLANK':'PATIENT' as const;};

/** OD-36 strict default: every class needs a second person; Paper values are compared with the working copy. */
export async function reviewObservations(db:Queryable,user:Staff,input:unknown){
 await assertSession(db,user);need(user,'observation.verify');
 const d=z.strictObject({observationIds:z.array(uuid).min(1).max(120),result:z.enum(['Confirmed','Discrepancy']),discrepancyKind:z.enum(['VALUE_MISMATCH','MISSING','ILLEGIBLE','ID_MISMATCH','CHECK_MISSING','WRONG_REVISION']).optional(),note:reasonText.optional()})
  .refine(v=>v.result==='Confirmed'||(v.discrepancyKind&&v.note),{message:'DISCREPANCY_DETAIL_REQUIRED'}).parse(input);
 const rows=(await db.query<{id:string;recorded_by:string;source:string;status:string;batch_id:string}>('SELECT id,recorded_by,source,status,batch_id FROM lab_observation WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE',[d.observationIds])).rows;
 if(rows.length!==d.observationIds.length)throw new LabError('NOT_FOUND',404);
 if(rows.some(r=>r.recorded_by===user.id))throw new LabError('SECOND_PERSON_REQUIRED',403);
 if(rows.some(r=>r.status!=='PendingReconciliation'))throw new LabError('OBSERVATION_NOT_PENDING',409);
 for(const r of rows){
  await db.query('INSERT INTO lab_observation_review(observation_id,reviewer_id,method,result,discrepancy_kind,note) VALUES($1,$2,$3,$4,$5,$6)',[r.id,user.id,r.source==='PAPER_TRANSCRIPTION'?'PAPER_COMPARE':'DIRECT_CONFIRM',d.result,d.discrepancyKind??null,d.note??null]);
  await db.query('UPDATE lab_observation SET status=$2 WHERE id=$1',[r.id,d.result==='Confirmed'?'Verified':'Discrepancy']);
 }
 for(const batchId of new Set(rows.map(r=>r.batch_id)))await db.query('UPDATE lab_batch SET version=version+1 WHERE id=$1',[batchId]);
 await audit(db,user,d.result==='Confirmed'?'LAB_OBSERVATIONS_VERIFIED':'LAB_OBSERVATION_DISCREPANCY','lab_observation',undefined,{count:rows.length});
 return {reviewed:rows.length};
}

export async function proposeDisposition(db:Queryable,user:Staff,input:unknown){
 await assertSession(db,user);need(user,'slot.disposition','propose');
 const d=z.strictObject({batchId:uuid,expectedVersion:z.number().int().min(0),slot:z.number().int().min(1).max(48),stage:z.enum(['TRANSFER','QC1']),disposition:z.enum(['NOT_PERFORMED','EXCLUDED','STOPPED']),reasonCode:z.enum(DISPOSITION_REASONS),note:reasonText}).parse(input);
 const b=await lockBatch(db,d.batchId,d.expectedVersion);const s=await sheetOf(db,b.id,getSheetNumber(d.slot));
 if(!['InExecution','ExecutionRecorded','ExecutionVerified','CompletedIssued'].includes(s.state))throw new LabError('DISPOSITION_AFTER_EXECUTION_START_ONLY',409);
 if(!inUse((await latestSnapshot(db,s.id)).payload).some(x=>x.slot===d.slot))throw new LabError('SLOT_NOT_IN_USE',409);
 const id=(await db.query<{id:string}>('INSERT INTO lab_slot_disposition(batch_id,slot_number,stage,disposition,reason_code,note,proposed_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id',[b.id,d.slot,d.stage,d.disposition,d.reasonCode,d.note,user.id])).rows[0].id;
 await db.query('UPDATE lab_batch SET version=version+1 WHERE id=$1',[b.id]);
 await audit(db,user,'LAB_DISPOSITION_PROPOSED','lab_slot_disposition',id,{reasonCode:d.reasonCode,outcome:d.disposition});
 return {id};
}
export async function confirmDisposition(db:Queryable,user:Staff,input:unknown){
 await assertSession(db,user);const d=z.strictObject({dispositionId:uuid}).parse(input);
 const r=(await db.query<{id:string;proposed_by:string;confirmed_at:Date|null;batch_id:string;slot_number:number;stage:string;disposition:string}>('SELECT * FROM lab_slot_disposition WHERE id=$1 FOR UPDATE',[d.dispositionId])).rows[0];
 if(!r)throw new LabError('NOT_FOUND',404);if(r.confirmed_at)throw new LabError('ALREADY_CONFIRMED',409);
 if(!authorize(user,'slot.disposition',{actorId:r.proposed_by},'approve')||r.proposed_by===user.id)throw new LabError('SECOND_PERSON_REQUIRED',403);
 await db.query('UPDATE lab_slot_disposition SET confirmed_by=$2,confirmed_at=now() WHERE id=$1',[r.id,user.id]);
 await db.query('UPDATE lab_batch SET version=version+1 WHERE id=$1',[r.batch_id]);
 await audit(db,user,'LAB_DISPOSITION_CONFIRMED','lab_slot_disposition',r.id,{outcome:r.disposition});
 return {confirmed:true};
}

type TransferStatus='MEASURED'|'NOT_PERFORMED'|'EXCLUDED'|'STOPPED'|'REQUIRED_PENDING'|'NOT_APPLICABLE';
/** §12.21/§12.26 completeness of one sheet: what is still missing before ExecutionVerified. */
export async function sheetCompleteness(db:Queryable,batchId:string,sheetNumber:number){
 const s=await sheetOf(db,batchId,sheetNumber,false);
 if(!FINALIZED.includes(s.state))return {sheet:s,ready:false,missingFields:[],slots:[],open:0};
 const snap=(await latestSnapshot(db,s.id)).payload,obs=(await liveObservations(db,batchId)).filter(o=>o.sheet_id===s.id),disp=await dispositions(db,batchId);
 const missingFields=requiredSheetFields(sheetNumber).filter(f=>!obs.some(o=>o.field_id===f.id&&o.item===f.item&&o.status==='Verified')).map(f=>({id:f.id,item:f.item,label:f.label}));
 const used=new Set(inUse(snap).map(x=>x.slot));
 const slots=snap.slots.map(x=>{let status:TransferStatus='NOT_APPLICABLE';if(used.has(x.slot)){const o=obs.find(o=>o.field_id==='F2-11'&&o.slot_number===x.slot&&o.status==='Verified');const dp=disp.find(y=>y.slot_number===x.slot&&y.stage==='TRANSFER'&&y.confirmed_at);status=o?'MEASURED':dp?dp.disposition as TransferStatus:'REQUIRED_PENDING';}return {slot:x.slot,status};});
 const open=obs.filter(o=>o.status!=='Verified').length;
 return {sheet:s,ready:!missingFields.length&&!slots.some(x=>x.status==='REQUIRED_PENDING')&&open===0,missingFields,slots,open};
}
export async function verifyExecution(db:Queryable,user:Staff,input:unknown){
 await assertSession(db,user);need(user,'observation.verify');
 const d=z.strictObject({batchId:uuid,expectedVersion:z.number().int().min(0),sheetNumber:z.number().int().min(1).max(3)}).parse(input);
 const b=await lockBatch(db,d.batchId,d.expectedVersion);const s=await sheetOf(db,b.id,d.sheetNumber);
 if(s.state!=='ExecutionRecorded')throw new LabError('EXECUTION_NOT_RECORDED',409);
 const c=await sheetCompleteness(db,b.id,d.sheetNumber);
 if(!c.ready)throw new LabError('EXECUTION_EVIDENCE_INCOMPLETE',409,{missingFields:c.missingFields,pendingSlots:c.slots.filter(x=>x.status==='REQUIRED_PENDING').map(x=>x.slot),openObservations:c.open});
 await db.query("UPDATE lab_task_sheet SET state='ExecutionVerified',verified_by=$2,verified_at=now() WHERE id=$1",[s.id,user.id]);
 const version=(await db.query<{version:number}>('UPDATE lab_batch SET version=version+1 WHERE id=$1 RETURNING version',[b.id])).rows[0].version;
 await audit(db,user,'LAB_EXECUTION_VERIFIED','lab_batch',b.id,{version});
 return {version};
}

/** Stage QC1 (§5.6, §12.5): human decision on a Verified value, always stamped UNAPPROVED_OD31 while OD-31 is open. */
export async function decideStageQc1(db:Queryable,user:Staff,input:unknown){
 await assertSession(db,user);need(user,'qc.accept');
 const d=z.strictObject({attemptId:uuid,decision:z.enum(['Accepted','Failed','Remeasure','Hold']),reason:reasonText,criteriaReference:reasonText.optional()}).parse(input);
 const operational=await operationalWorkflow(db),criteriaStatus=operational?'REVIEWED_OPERATIONAL':'UNAPPROVED_OD31';
 if(operational&&!d.criteriaReference)throw new LabError('QC1_CRITERIA_REFERENCE_REQUIRED',422);
 const a=(await db.query<{id:string;case_id:string;state:string;repeat_order_id:string|null}>('SELECT id,case_id,state,repeat_order_id FROM analytical_attempt WHERE id=$1 FOR UPDATE',[d.attemptId])).rows[0];
 if(!a)throw new LabError('NOT_FOUND',404);if(a.state!=='InProgress')throw new LabError('STAGE_QC_REQUIRES_IN_PROGRESS',409);
 const o=(await db.query<{id:string;value:{value:string};batch_id:string;slot_number:number}>("SELECT o.id,o.value,o.batch_id,o.slot_number FROM lab_observation o JOIN lab_slot_assignment x ON x.batch_id=o.batch_id AND x.slot_number=o.slot_number AND x.removed_at IS NULL WHERE x.attempt_id=$1 AND o.field_id='F3-03' AND o.status='Verified' ORDER BY o.sequence DESC LIMIT 1",[a.id])).rows[0];
 if(!o)throw new LabError('STAGE_QC_REQUIRES_VERIFIED_VALUE',409);
 const id=(await db.query<{id:string}>("INSERT INTO attempt_stage_qc(attempt_id,stage,decision,observation_id,criteria_status,criteria_consulted,reason,decided_by) VALUES($1,'QC1',$2,$3,$4,$5,$6,$7) RETURNING id",[a.id,d.decision,o.id,criteriaStatus,operational?[d.criteriaReference!]:QC1_CRITERIA.map(c=>c.code),d.reason,user.id])).rows[0].id;
 const hold=(await db.query<{e:string}>("SELECT event_type e FROM attempt_event WHERE attempt_id=$1 AND event_type IN ('HOLD_SET','HOLD_RELEASED') ORDER BY sequence DESC LIMIT 1",[a.id])).rows[0]?.e==='HOLD_SET';
 if(d.decision==='Failed'){
  await setAttemptState(db,user,a,'QcFailed',{stageQcId:id},{qcFailedStage:'QC1'});
  if(a.repeat_order_id)await db.query("UPDATE repeat_work_order SET state='RepeatFailed',closed_by=$2,closed_at=now(),close_reason='CHILD_QC1_FAILED' WHERE id=$1 AND state='RepeatInProgress'",[a.repeat_order_id,user.id]);
 }else if((d.decision==='Remeasure'||d.decision==='Hold')&&!hold)await attemptEvent(db,user,{attemptId:a.id,caseId:a.case_id,type:'HOLD_SET',stage:'QC1',reason:d.reason});
 else if(d.decision==='Accepted'&&hold)await attemptEvent(db,user,{attemptId:a.id,caseId:a.case_id,type:'HOLD_RELEASED',stage:'QC1',reason:d.reason});
 await db.query('UPDATE lab_batch SET version=version+1 WHERE id=$1',[o.batch_id]);
 await caseEvent(db,user,a.case_id,'LAB_STAGE_QC1_DECIDED',{decision:d.decision,criteria:criteriaStatus});
 await audit(db,user,'LAB_STAGE_QC1_DECIDED','attempt_stage_qc',id,{outcome:d.decision,ruleVersion:criteriaStatus});
 return {id,decision:d.decision,criteriaStatus,candidates:qc1Candidates(o.value.value,'PATIENT')};
}

type QcStatus='MEASURED'|'AWAITING_DECISION'|'NOT_PERFORMED'|'EXCLUDED'|'STOPPED'|'REQUIRED_PENDING'|'NOT_APPLICABLE';
export async function qcCompleteness(db:Queryable,batchId:string){
 const sheets=await Promise.all([1,2,3].map(n=>sheetOf(db,batchId,n,false)));
 const snaps=new Map<number,PlacementPayload>();for(const s of sheets)if(FINALIZED.includes(s.state))snaps.set(s.sheet_number,(await latestSnapshot(db,s.id)).payload);
 const obs=(await liveObservations(db,batchId)).filter(o=>o.field_id.startsWith('F3-')),disp=await dispositions(db,batchId);
 const decisions=(await db.query<{attempt_id:string;decision:string}>('SELECT DISTINCT ON(attempt_id) attempt_id,decision FROM attempt_stage_qc WHERE attempt_id IN (SELECT attempt_id FROM lab_slot_assignment WHERE batch_id=$1) ORDER BY attempt_id,decided_at DESC',[batchId])).rows;
 const rows=Array.from({length:48},(_,i)=>{const slot=i+1,sheet=getSheetNumber(slot),snap=snaps.get(sheet),x=snap?.slots.find(y=>y.slot===slot);
  if(!snap||!x||!(x.control||x.attemptId))return {slot,sheet,status:'NOT_APPLICABLE' as QcStatus,obs:null as Obs|null,decision:null as string|null,disposition:null as Disp|null,x:x??null,finalized:!!snap};
  const o=obs.find(o=>o.field_id==='F3-03'&&o.slot_number===slot)??null,dp=disp.find(y=>y.slot_number===slot&&y.stage==='QC1')??null,dec=x.attemptId?decisions.find(y=>y.attempt_id===x.attemptId)?.decision??null:null;
  const status:QcStatus=dp?.confirmed_at?dp.disposition as QcStatus:o?.status==='Verified'?(x.control||dec?'MEASURED':'AWAITING_DECISION'):'REQUIRED_PENDING';
  return {slot,sheet,status,obs:o,decision:dec,disposition:dp,x,finalized:true};});
 const standards=['STD1','STD2'].map(item=>obs.find(o=>o.field_id==='F3-05'&&o.item===item)??null),operator=obs.find(o=>o.field_id==='F3-01')??null;
 const sheetsReady=sheets.every(s=>s.placement_revision===0&&['Draft','PlanChecked','Cancelled'].includes(s.state)?true:['ExecutionVerified','CompletedIssued'].includes(s.state));
 const ready=snaps.size>0&&sheetsReady&&rows.every(r=>['MEASURED','NOT_PERFORMED','EXCLUDED','STOPPED','NOT_APPLICABLE'].includes(r.status))&&standards.every(s=>s?.status==='Verified')&&operator?.status==='Verified'&&!obs.some(o=>o.status!=='Verified');
 return {rows,standards,operator,ready,sheets};
}

// ---------- Documents (§12.20 D-66) ----------
const CONTROL_INSTRUCTION:Record<number,string>={1:'แบ่งตัวอย่าง 200 µL ลง Strip Plate ตามตำแหน่ง / ตำแหน่ง 1 (PC) ใส่ MilliQ',2:'แบ่งตัวอย่าง 200 µL ลง Strip Plate ตามตำแหน่ง / ตำแหน่ง 25 (NC) ใส่ MilliQ',3:'แบ่งตัวอย่าง 200 µL ลง Strip Plate ตามตำแหน่ง / ตำแหน่ง 40 (BC) ใส่ MilliQ'};
const th=(d:Date|null)=>d?d.toLocaleString('th-TH',{timeZone:'Asia/Bangkok',hour12:false}):'ไม่ได้บันทึกบนเอกสาร';
const DISP_TEXT:Record<string,string>={NOT_PERFORMED:'ไม่ได้ทำ',EXCLUDED:'ถอดออก',STOPPED:'หยุด'};
async function displayName(db:Queryable,id:string){return (await db.query<{display_name:string}>('SELECT display_name FROM app_user WHERE id=$1',[id])).rows[0]?.display_name??'ไม่ทราบ';}

async function f2Document(db:Queryable,batchId:string,sheetNumber:number,kind:'PRE_WORK'|'COMPLETED',meta:{docCode:string;revision:number;issuedAt:Date;issuedBy:string}):Promise<{doc:P4Document;snapshotRef:string}>{
 const b=(await db.query<{run_label:string}>('SELECT run_label FROM lab_batch WHERE id=$1',[batchId])).rows[0];const s=await sheetOf(db,batchId,sheetNumber,false);const snap=await latestSnapshot(db,s.id);const p=snap.payload;
 const c=kind==='COMPLETED'?await sheetCompleteness(db,batchId,sheetNumber):null;
 const obs=kind==='COMPLETED'?(await liveObservations(db,batchId)).filter(o=>o.sheet_id===s.id&&o.status==='Verified'):[];
 const disp=await dispositions(db,batchId);
 const rows=p.slots.map(x=>{const kindRow=x.control?'CONTROL' as const:x.attemptId?'PATIENT' as const:'EMPTY' as const;let transfer=null;
  if(c&&kindRow!=='EMPTY'){const st=c.slots.find(y=>y.slot===x.slot)!.status;const o=obs.find(o=>o.field_id==='F2-11'&&o.slot_number===x.slot);const dp=disp.find(y=>y.slot_number===x.slot&&y.stage==='TRANSFER');
   transfer=st==='MEASURED'&&o?{status:'MEASURED' as const,text:'✓',source:o.source==='PAPER_TRANSCRIPTION'?'กระดาษ':'บันทึกตรง',recordedBy:o.recorder,verifiedBy:o.reviewer}:{status:(dp?.disposition??'NOT_PERFORMED') as 'NOT_PERFORMED',text:`${dp?.reason_code??''} ${dp?.note??''}`.trim(),source:null,recordedBy:null,verifiedBy:null};}
  return {slot:x.slot,plate:x.plate,barcode:x.barcode,kind:kindRow,control:x.control?CONTROL_LABEL[x.control] as 'PC':null,printedId:x.control?x.printedControlId??'':x.printedSampleId??'',lnHalos:x.lnHalos??'',round:x.roundNumber?`รอบที่ ${x.roundNumber}`:'',repeat:x.repeat,transfer};});
 const checklist=FIELDS.filter(f=>f.form==='F2'&&f.kind==='CHECK'&&f.required(sheetNumber)).map(f=>({key:`${f.id}${f.item?':'+f.item:''}`,label:f.label}));
 const execution=obs.filter(o=>o.field_id!=='F2-11').map(o=>{const def=fieldDef(o.field_id,o.item);return {label:def.label,value:valueText(def,o.value),source:o.source,eventTime:o.event_time_precision==='NOT_RECORDED'?'ไม่ได้บันทึกบนเอกสาร':th(o.event_time),recordedAt:th(o.recorded_at),recordedBy:o.recorder,verifiedBy:o.reviewer??''};});
 const doc:P4Document={form:'F2',kind,...meta,issuedAt:th(meta.issuedAt),runLabel:b.run_label,templateVersion:P4_TEMPLATE_VERSION,fieldInventory:FIELD_INVENTORY_STATUS,snapshotRevision:`Placement r${snap.revision} ${snap.content_hash.slice(0,12)}`,copy:null,synthetic:true,
  sheetNumber,strips:stripLabels(b.run_label,sheetNumber as 1),controlInstruction:CONTROL_INSTRUCTION[sheetNumber],plan:{workDate:displayBe(p.plan.workDate),operator:p.plan.operator??'—',extractionLot:p.plan.extractionLot??'—',extractionExpiry:displayBe(p.plan.extractionExpiry),libraryLot:p.plan.libraryLot??'—',libraryExpiry:displayBe(p.plan.libraryExpiry)},
  rows,checklist,execution,startedAt:kind==='COMPLETED'?th(s.execution_started_at):null,pendingGovernance:p.gate.pendingAccepted,dateBasis:await dateBasisText(db,batchId,s.id,p.plan.workDate,kind)};
 return {doc,snapshotRef:snap.id};
}
/** OD-S/T/E (Owner 2026-10-18): states unambiguously which date the control IDs carry and, on Completed, any actual Library date that differs. */
async function dateBasisText(db:Queryable,batchId:string,sheetId:string,planned:string|null,kind:'PRE_WORK'|'COMPLETED'){
 if(!planned)return undefined;
 const dev=kind==='COMPLETED'?await libraryDateDeviation(db,batchId,sheetId):null;
 return dev?`รหัส Control สร้างจากวันที่ทำ Library Preparation ที่วางแผน ${displayBe(planned)} (ล็อกเมื่อเริ่มปฏิบัติงาน) · วันที่ทำ Library Preparation จริง ${displayBe(dev.actualLibraryDate)} · เหตุผล: ${dev.reason}`
  :`รหัส Control สร้างจากวันที่ทำ Library Preparation ${displayBe(planned)}${kind==='COMPLETED'?' (ตรงกับวันที่ทำจริง)':' (วางแผน)'}`;
}
async function f3Document(db:Queryable,batchId:string,kind:'PRE_WORK'|'COMPLETED',meta:{docCode:string;revision:number;issuedAt:Date;issuedBy:string}):Promise<{doc:P4Document;included:string[]}>{
 const b=(await db.query<{run_label:string}>('SELECT run_label FROM lab_batch WHERE id=$1',[batchId])).rows[0];const q=await qcCompleteness(db,batchId);
 const included=(await db.query<{s:string}>(`SELECT t.sheet_number||':'||max(p.revision) s FROM lab_task_sheet t JOIN lab_placement_snapshot p ON p.sheet_id=t.id WHERE t.batch_id=$1 AND t.state IN (${FINALIZED.map(x=>`'${x}'`).join(',')}) GROUP BY t.sheet_number ORDER BY t.sheet_number`,[batchId])).rows.map(r=>r.s);
 const decisionText:Record<string,string>={Accepted:'ผ่าน (เกณฑ์ยังไม่รับรอง)',Failed:'ไม่ผ่าน (เกณฑ์ยังไม่รับรอง)',Remeasure:'วัดซ้ำ',Hold:'ระงับ'};
 const rows=q.rows.map(r=>{const sheet=q.sheets[r.sheet-1];const rowStatus=r.finalized?'IN_BATCH' as const:sheet.placement_revision===0&&!(r.x?.attemptId)&&sheet.state!=='Amended'?'NOT_IN_BATCH' as const:'NOT_PLACED' as const;
  const kindRow=r.x?.control?'CONTROL' as const:r.x?.attemptId?'PATIENT' as const:'EMPTY' as const;
  const result=kind==='PRE_WORK'||rowStatus!=='IN_BATCH'||kindRow==='EMPTY'?null:r.status==='MEASURED'||r.status==='AWAITING_DECISION'?{value:`${(r.obs!.value as {value:string}).value}`,decision:r.x?.control?'Control — การตัดสินตามนโยบาย IQC (OD-34)':decisionText[r.decision??'']??'ยังไม่ตัดสิน',source:r.obs!.source==='PAPER_TRANSCRIPTION'?'กระดาษ':'บันทึกตรง',recordedBy:r.obs!.recorder,verifiedBy:r.obs!.reviewer}
   :{value:null,decision:`ไม่ได้วัด — ${DISP_TEXT[r.status]??r.status}: ${r.disposition?.note??''}`,source:null,recordedBy:null,verifiedBy:null};
  return {slot:r.slot,plate:getPlatePosition(r.slot),kind:kindRow,control:r.x?.control?CONTROL_LABEL[r.x.control] as 'PC':null,printedId:r.x?.control?r.x.printedControlId??'':r.x?.printedSampleId??'',rowStatus,result};});
 const count=(f:(r:typeof q.rows[number])=>boolean)=>q.rows.filter(f).length;
 const summary=`ผ่าน ${count(r=>r.decision==='Accepted')} / ไม่ผ่าน ${count(r=>r.decision==='Failed')} / ไม่ได้วัด ${count(r=>['NOT_PERFORMED','EXCLUDED','STOPPED'].includes(r.status))} (ถอดออก ${count(r=>r.status==='EXCLUDED')}, หยุด ${count(r=>r.status==='STOPPED')}, ไม่ได้ทำ ${count(r=>r.status==='NOT_PERFORMED')}) · Control วัดแล้ว ${count(r=>!!r.x?.control&&r.status==='MEASURED')} — ตัดสินภายใต้เกณฑ์ที่ยังไม่รับรอง (OD-31)`;
 const entry=(o:Obs|null,label:string)=>o&&o.status==='Verified'?{label,value:valueText(fieldDef(o.field_id,o.item),o.value),source:o.source,eventTime:o.event_time_precision==='NOT_RECORDED'?'ไม่ได้บันทึกบนเอกสาร':th(o.event_time),recordedAt:th(o.recorded_at),recordedBy:o.recorder,verifiedBy:o.reviewer??''}:null;
 const doc:P4Document={form:'F3',kind,...meta,issuedAt:th(meta.issuedAt),runLabel:b.run_label,templateVersion:P4_TEMPLATE_VERSION,fieldInventory:FIELD_INVENTORY_STATUS,snapshotRevision:included.map(s=>'TL'+s.replace(':',' r')).join(', '),copy:null,synthetic:true,rows,
  standards:kind==='COMPLETED'?[entry(q.standards[0],'Standard 1'),entry(q.standards[1],'Standard 2')].filter(x=>x!==null):[],operator:kind==='COMPLETED'?entry(q.operator,'ผู้ปฏิบัติงาน QC'):null,criteria:QC1_CRITERIA.map(c=>c.label),summary:kind==='COMPLETED'?summary:''};
 return {doc,included};
}
const docCode=(runLabel:string,form:'F2'|'F3',sheet:number|null)=>`${form}-${runLabel.replace('/','-').toUpperCase()}${sheet?'-TL'+sheet:''}`;
async function storeDocument(db:Queryable,user:Staff,deps:DocDeps,x:{batchId:string;sheetId:string|null;form:'F2'|'F3';kind:'PRE_WORK'|'COMPLETED';code:string;revision:number;doc:P4Document;supersedes:string|null}){
 const operational=await operationalWorkflow(db);
 if(operational&&!deps.native)throw new LabError('TASK_NATIVE_CONTROLLED_RENDERER_REQUIRED',409);
 const native=operational?await deps.native!(db,user,{batchId:x.batchId,form:x.form,kind:x.kind,sheetNumber:x.doc.form==='F2'?x.doc.sheetNumber:undefined,evidence:x.doc}):null;
 const bytes=native?.bytes??await deps.render(x.doc);if(!bytes.subarray(0,5).equals(Buffer.from('%PDF-')))throw new LabError('RENDERER_INVALID_PDF',502);
 const hash=await deps.store.put(bytes);
 const id=(await db.query<{id:string}>('INSERT INTO lab_document(batch_id,sheet_id,form,kind,revision,doc_code,snapshot,snapshot_hash,file_sha256,file_size,template_version,supersedes_id,issued_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id',
  [x.batchId,x.sheetId,x.form,x.kind,x.revision,x.code,JSON.stringify(native?.snapshot??x.doc),contentHash(native?.snapshot??x.doc),hash,bytes.length,native?.templateVersion??P4_TEMPLATE_VERSION,x.supersedes,user.id])).rows[0].id;
 await audit(db,user,'LAB_DOCUMENT_ISSUED','lab_document',id,{outcome:`${x.form}_${x.kind}`,version:x.revision});
 return {id,fileSha256:hash,revision:x.revision};
}
async function nextRevision(db:Queryable,batchId:string,form:string,kind:string,sheetId:string|null){
 return (await db.query<{n:number}>('SELECT COALESCE(max(revision),0)+1 n FROM lab_document WHERE batch_id=$1 AND form=$2 AND kind=$3 AND sheet_id IS NOT DISTINCT FROM $4',[batchId,form,kind,sheetId])).rows[0].n;
}
/** The verified F2-02 that differs from the planned (control-ID) date of the latest Placement snapshot, if any. */
export async function libraryDateDeviation(db:Queryable,batchId:string,sheetId:string){
 const plan=(await latestSnapshot(db,sheetId)).payload.plan;
 const o=(await liveObservations(db,batchId)).find(x=>x.sheet_id===sheetId&&x.field_id==='F2-02'&&x.status==='Verified');
 return o&&plan.workDate&&o.value.date!==plan.workDate?{plannedWorkDate:plan.workDate,actualLibraryDate:String(o.value.date),reason:String(o.value.deviationReason??'')}:null;
}
/**
 * OD-B (Owner 2026-10-18): uncontrolled F2 preview of a Task that is not finalized yet, built from its live plan and slots.
 * DRAFT watermark, no DocID series, never stored as a lab_document and never usable as a working copy; audited as a preview.
 */
export async function previewDraftF2(db:Queryable,user:Staff,input:unknown,deps:Pick<DocDeps,'render'>){
 await assertSession(db,user);need(user,'batch.draft');
 const d=z.strictObject({batchId:uuid,sheetNumber:z.number().int().min(1).max(3)}).parse(input);
 const b=(await db.query<{id:string;run_label:string}>("SELECT id,run_label FROM lab_batch WHERE id=$1 AND state<>'Cancelled'",[d.batchId])).rows[0];if(!b)throw new LabError('NOT_FOUND',404);
 const s=await sheetOf(db,b.id,d.sheetNumber,false);
 if(!EDITABLE.includes(s.state))throw new LabError('DRAFT_PREVIEW_ONLY_BEFORE_FINALIZE',409);
 const facts=await attemptFacts(db,'a.id IN (SELECT attempt_id FROM lab_slot_assignment WHERE batch_id=$1 AND removed_at IS NULL)',[b.id]);
 const lo=(d.sheetNumber-1)*16+1,date=s.planned_work_date;
 const rows=Array.from({length:16},(_,i)=>{const slot=lo+i,control=controlTypeOf(slot),f=facts.find(x=>x.slot_number===slot);
  if(control)return {slot,plate:getPlatePosition(slot),barcode:slot,kind:'CONTROL' as const,control:CONTROL_LABEL[control] as 'PC',printedId:date?formatPrintedControlId(control,date):'(ยังไม่ระบุวันที่ Library Preparation)',lnHalos:'',round:'',repeat:false,transfer:null};
  if(!f)return {slot,plate:getPlatePosition(slot),barcode:slot,kind:'EMPTY' as const,control:null,printedId:'',lnHalos:'',round:'',repeat:false,transfer:null};
  const visible=caseVisible(user,f);
  return {slot,plate:getPlatePosition(slot),barcode:slot,kind:'PATIENT' as const,control:null,printedId:visible?f.printed_sample_id??candidatePrintedId(f).id??'—':'(ไม่มีสิทธิ์ดู)',lnHalos:visible?f.ln_halos??'':'',round:`รอบที่ ${f.round_number}`,repeat:f.repeat_order_id!==null,transfer:null};});
 const doc:P4Document={form:'F2',kind:'PRE_WORK',docCode:`DRAFT-${b.run_label.replace('/','-')}-TL${d.sheetNumber}`,revision:1,issuedAt:th(new Date()),issuedBy:await displayName(db,user.id),runLabel:b.run_label,templateVersion:P4_TEMPLATE_VERSION,fieldInventory:FIELD_INVENTORY_STATUS,
  snapshotRevision:'ยังไม่ Finalize — ไม่มี Snapshot',copy:null,synthetic:true,sheetNumber:d.sheetNumber,strips:stripLabels(b.run_label,d.sheetNumber as 1),controlInstruction:CONTROL_INSTRUCTION[d.sheetNumber],
  plan:{workDate:displayBe(date),operator:s.planned_operator??'—',extractionLot:s.planned_extraction_lot??'—',extractionExpiry:displayBe(s.planned_extraction_expiry),libraryLot:s.planned_library_lot??'—',libraryExpiry:displayBe(s.planned_library_expiry)},
  rows,checklist:FIELDS.filter(f=>f.form==='F2'&&f.kind==='CHECK'&&f.required(d.sheetNumber)).map(f=>({key:`${f.id}${f.item?':'+f.item:''}`,label:f.label})),execution:[],startedAt:null,pendingGovernance:[],
  dateBasis:date?`รหัส Control จะสร้างจากวันที่ทำ Library Preparation ที่วางแผน ${displayBe(date)} เมื่อ Finalize`:'ยังไม่ระบุวันที่ทำ Library Preparation — ยังสร้างรหัส Control ไม่ได้',draft:true};
 const bytes=await deps.render(doc);if(!bytes.subarray(0,5).equals(Buffer.from('%PDF-')))throw new LabError('RENDERER_INVALID_PDF',502);
 await audit(db,user,'LAB_DRAFT_PREVIEW','lab_batch',b.id,{outcome:'F2_DRAFT_PREVIEW',count:d.sheetNumber});
 return {bytes,fileName:`${doc.docCode}.pdf`};
}
/** F2 Pre-work from the Placement snapshot — before any pipetting; only blank boxes for execution data (AT-PREWORK-01/02). */
export async function issuePreWork(db:Queryable,user:Staff,input:unknown,deps:DocDeps){
 await assertSession(db,user);need(user,'batch.finalize');
 const d=z.strictObject({batchId:uuid,expectedVersion:z.number().int().min(0),sheetNumber:z.number().int().min(1).max(3)}).parse(input);
 const b=await lockBatch(db,d.batchId,d.expectedVersion);const s=await sheetOf(db,b.id,d.sheetNumber);
 if(s.state!=='PlacementFinalized')throw new LabError('PLACEMENT_FINALIZE_REQUIRED',409);
 const previous=(await db.query<{id:string}>("SELECT id FROM lab_document WHERE sheet_id=$1 AND kind='PRE_WORK' AND status='StopUse' ORDER BY revision DESC LIMIT 1",[s.id])).rows[0]?.id??null;
 const revision=await nextRevision(db,b.id,'F2','PRE_WORK',s.id),code=docCode(b.run_label,'F2',d.sheetNumber);
 const {doc}=await f2Document(db,b.id,d.sheetNumber,'PRE_WORK',{docCode:code,revision,issuedAt:new Date(),issuedBy:await displayName(db,user.id)});
 const r=await storeDocument(db,user,deps,{batchId:b.id,sheetId:s.id,form:'F2',kind:'PRE_WORK',code,revision,doc,supersedes:previous});
 if(previous)await db.query("UPDATE lab_document SET status='Superseded',status_reason=$2,status_changed_by=$3,status_changed_at=now() WHERE id=$1",[previous,`แทนที่โดย Rev ${revision}`,user.id]);
 await db.query("UPDATE lab_task_sheet SET state='PreWorkIssued' WHERE id=$1",[s.id]);
 const version=(await db.query<{version:number}>('UPDATE lab_batch SET version=version+1 WHERE id=$1 RETURNING version',[b.id])).rows[0].version;
 return {...r,version};
}
/** F3 Pre-work covers every sheet already finalized; a later finalize issues a new revision (Appendix F.5). Idempotent for the same sheet set. */
export async function issueQcPreWork(db:Queryable,user:Staff,input:unknown,deps:DocDeps){
 await assertSession(db,user);need(user,'batch.finalize');
 const d=z.strictObject({batchId:uuid,expectedVersion:z.number().int().min(0)}).parse(input);const b=await lockBatch(db,d.batchId,d.expectedVersion);
 const code=docCode(b.run_label,'F3',null),revision=await nextRevision(db,b.id,'F3','PRE_WORK',null);
 const {doc,included}=await f3Document(db,b.id,'PRE_WORK',{docCode:code,revision,issuedAt:new Date(),issuedBy:await displayName(db,user.id)});
 if(!included.length)throw new LabError('NO_FINALIZED_SHEET',409);
 const current=(await db.query<{id:string;file_sha256:string;revision:number;snapshot:{snapshotRevision:string}}>("SELECT id,file_sha256,revision,snapshot FROM lab_document WHERE batch_id=$1 AND form='F3' AND kind='PRE_WORK' AND status='Issued' ORDER BY revision DESC LIMIT 1",[b.id])).rows[0];
 const currentPlacement=current&&(isNativeIssue(current.snapshot)?(current.snapshot.evidence as {snapshotRevision?:string})?.snapshotRevision:current.snapshot.snapshotRevision);
 if(current&&currentPlacement===doc.snapshotRevision)return {id:current.id,fileSha256:current.file_sha256,revision:current.revision,version:b.version,unchanged:true};
 const r=await storeDocument(db,user,deps,{batchId:b.id,sheetId:null,form:'F3',kind:'PRE_WORK',code,revision,doc,supersedes:current?.id??null});
 if(current)await db.query("UPDATE lab_document SET status='Superseded',status_reason=$2,status_changed_by=$3,status_changed_at=now() WHERE id=$1",[current.id,`แทนที่โดย Rev ${revision} (เพิ่ม Sheet ที่ Finalize)`,user.id]);
 const version=(await db.query<{version:number}>('UPDATE lab_batch SET version=version+1 WHERE id=$1 RETURNING version',[b.id])).rows[0].version;
 return {...r,version,unchanged:false};
}
export async function issueCompleted(db:Queryable,user:Staff,input:unknown,deps:DocDeps){
 await assertSession(db,user);need(user,'execution.record');
 const d=z.strictObject({batchId:uuid,expectedVersion:z.number().int().min(0),sheetNumber:z.number().int().min(1).max(3)}).parse(input);
 const b=await lockBatch(db,d.batchId,d.expectedVersion);const s=await sheetOf(db,b.id,d.sheetNumber);
 if(s.state!=='ExecutionVerified')throw new LabError('EXECUTION_VERIFICATION_REQUIRED',409);
 // OD-E2: the approved native master has one date cell (B4). A native Completed whose B4 (actual Library date) differs from the date inside
 // the control IDs would be ambiguous, and an annex is a controlled-format change that QA must accept first. Chromium documents state the basis.
 if(await operationalWorkflow(db)&&await libraryDateDeviation(db,b.id,s.id))throw new LabError('LIBRARY_DATE_DEVIATION_ANNEX_PENDING_QA',409);
 const code=docCode(b.run_label,'F2',d.sheetNumber),revision=await nextRevision(db,b.id,'F2','COMPLETED',s.id);
 const {doc}=await f2Document(db,b.id,d.sheetNumber,'COMPLETED',{docCode:code,revision,issuedAt:new Date(),issuedBy:await displayName(db,user.id)});
 const r=await storeDocument(db,user,deps,{batchId:b.id,sheetId:s.id,form:'F2',kind:'COMPLETED',code,revision,doc,supersedes:null});
 await db.query("UPDATE lab_task_sheet SET state='CompletedIssued' WHERE id=$1",[s.id]);
 await db.query(`UPDATE lab_batch b SET state='ExtractionLibrary' WHERE id=$1 AND state='InPreparation' AND NOT EXISTS(SELECT 1 FROM lab_task_sheet t WHERE t.batch_id=b.id AND t.placement_revision>0 AND t.state NOT IN ('CompletedIssued','Cancelled')) AND NOT EXISTS(SELECT 1 FROM lab_task_sheet t WHERE t.batch_id=b.id AND t.state IN ('PlanChecked','Amended'))`,[b.id]);
 const version=(await db.query<{version:number}>('UPDATE lab_batch SET version=version+1 WHERE id=$1 RETURNING version',[b.id])).rows[0].version;
 return {...r,version};
}
export async function issueQcCompleted(db:Queryable,user:Staff,input:unknown,deps:DocDeps){
 await assertSession(db,user);need(user,'qc.record');
 const d=z.strictObject({batchId:uuid,expectedVersion:z.number().int().min(0)}).parse(input);const b=await lockBatch(db,d.batchId,d.expectedVersion);
 const q=await qcCompleteness(db,b.id);
 if(!q.ready)throw new LabError('QC1_RECORD_INCOMPLETE',409,{pendingSlots:q.rows.filter(r=>['REQUIRED_PENDING','AWAITING_DECISION'].includes(r.status)).map(r=>r.slot),standards:q.standards.map(x=>x?.status??'MISSING'),operator:q.operator?.status??'MISSING'});
 const code=docCode(b.run_label,'F3',null),revision=await nextRevision(db,b.id,'F3','COMPLETED',null);
 const {doc}=await f3Document(db,b.id,'COMPLETED',{docCode:code,revision,issuedAt:new Date(),issuedBy:await displayName(db,user.id)});
 const r=await storeDocument(db,user,deps,{batchId:b.id,sheetId:null,form:'F3',kind:'COMPLETED',code,revision,doc,supersedes:null});
 await db.query("UPDATE lab_batch SET state='QC1Complete' WHERE id=$1 AND state='ExtractionLibrary'",[b.id]);
 const version=(await db.query<{version:number}>('UPDATE lab_batch SET version=version+1 WHERE id=$1 RETURNING version',[b.id])).rows[0].version;
 return {...r,version};
}

type DocRow={id:string;batch_id:string;form:'F2'|'F3';kind:'PRE_WORK'|'COMPLETED';revision:number;doc_code:string;snapshot:P4Document;file_sha256:string;status:string;status_reason:string|null};
/** Original reprint = the same bytes; a working copy or status-marked copy is a derivative with its own hash and `derived_from`. */
export async function printDocument(db:Queryable,user:Staff,input:unknown,deps:DocDeps){
 await assertSession(db,user);
 const d=z.strictObject({documentId:uuid,kind:z.enum(['ORIGINAL_REPRINT','WORKING_COPY','STATUS_MARKED']),reason:reasonText.optional()}).parse(input);
 const doc=(await db.query<DocRow>('SELECT * FROM lab_document WHERE id=$1 FOR UPDATE',[d.documentId])).rows[0];if(!doc)throw new LabError('NOT_FOUND',404);
 const issued=doc.status==='Issued';
 if(d.kind==='WORKING_COPY'){need(user,'execution.record');if(!issued||doc.kind!=='PRE_WORK')throw new LabError('WORKING_COPY_ONLY_FROM_ISSUED_PRE_WORK',409);}
 else if(d.kind==='ORIGINAL_REPRINT'){if(issued)need(user,'worksheet.read','read');else{need(user,'document.obsolete.print');if(!d.reason)throw new LabError('REASON_REQUIRED',422);}}
 else{need(user,'worksheet.read','read');if(issued)throw new LabError('STATUS_MARK_ONLY_FOR_INACTIVE',409);}
 let bytes:Buffer,copyNumber:number|null=null;const copyId=randomUUID();
 if(d.kind==='ORIGINAL_REPRINT')bytes=await deps.store.get(doc.file_sha256);
 else{
  if(d.kind==='WORKING_COPY')copyNumber=(await db.query<{n:number}>('SELECT COALESCE(max(copy_number),0)+1 n FROM lab_document_copy WHERE document_id=$1',[doc.id])).rows[0].n;
  const name=await displayName(db,user.id),now=new Date().toLocaleString('th-TH',{timeZone:'Asia/Bangkok',hour12:false});
  const statusText:Record<string,string>={StopUse:'ระงับใช้',Superseded:'ถูกแทนที่',Cancelled:'ยกเลิก'};
  bytes=isNativeIssue(doc.snapshot)?await labelNativeCopy(await deps.store.get(doc.file_sha256),{id:copyId,kind:d.kind,number:copyNumber,status:doc.status,originalHash:doc.file_sha256,actorId:user.id,at:new Date().toISOString()}):await deps.render({...doc.snapshot,copy:{kind:d.kind,copyNumber,originalHash:doc.file_sha256,printedBy:name,printedAt:now,status:d.kind==='STATUS_MARKED'?statusText[doc.status]:null,statusReason:d.kind==='STATUS_MARKED'?doc.status_reason:null}} as P4Document);
  await deps.store.put(bytes);
 }
 const sha=createHash('sha256').update(bytes).digest('hex');
 const id=(await db.query<{id:string}>('INSERT INTO lab_document_copy(id,document_id,kind,copy_number,file_sha256,derived_from,actor_id,reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id',[copyId,doc.id,d.kind,copyNumber,sha,doc.file_sha256,user.id,d.reason??null])).rows[0].id;
 await audit(db,user,'LAB_DOCUMENT_PRINTED','lab_document_copy',id,{outcome:d.kind,count:copyNumber??0});
 return {copyId:id,bytes,sha256:sha,copyNumber,status:doc.status,fileName:`${doc.doc_code}-rev${doc.revision}${copyNumber?`-copy${copyNumber}`:d.kind==='STATUS_MARKED'?`-status${isNativeIssue(doc.snapshot)?'-'+doc.status:''}`:''}.pdf`};
}
export async function readOriginal(db:Queryable,user:Staff,documentId:string,deps:Pick<DocDeps,'store'>){
 await assertSession(db,user);need(user,'worksheet.read','read');
 const doc=(await db.query<DocRow>('SELECT * FROM lab_document WHERE id=$1',[uuid.parse(documentId)])).rows[0];if(!doc)throw new LabError('NOT_FOUND',404);
 const bytes=await deps.store.get(doc.file_sha256);
 await audit(db,user,'LAB_DOCUMENT_VIEWED','lab_document',doc.id,{outcome:doc.status});
 return {bytes,status:doc.status,fileName:`${doc.doc_code}-rev${doc.revision}.pdf`,sha256:doc.file_sha256};
}
export async function recallCopy(db:Queryable,user:Staff,input:unknown){
 await assertSession(db,user);need(user,'document.recall');
 const d=z.strictObject({copyId:uuid,note:reasonText}).parse(input);
 const c=(await db.query<{id:string;kind:string;recalled_at:Date|null;status:string}>('SELECT c.id,c.kind,c.recalled_at,d.status FROM lab_document_copy c JOIN lab_document d ON d.id=c.document_id WHERE c.id=$1 FOR UPDATE OF c',[d.copyId])).rows[0];
 if(!c)throw new LabError('NOT_FOUND',404);if(c.kind!=='WORKING_COPY'||c.recalled_at)throw new LabError('RECALL_NOT_APPLICABLE',409);if(c.status==='Issued')throw new LabError('RECALL_ONLY_FOR_INACTIVE_DOCUMENT',409);
 await db.query('UPDATE lab_document_copy SET recalled_by=$2,recalled_at=now(),recall_note=$3 WHERE id=$1',[c.id,user.id,d.note]);
 await audit(db,user,'LAB_WORKING_COPY_RECALLED','lab_document_copy',c.id);
 return {recalled:true};
}
export async function documentCopies(db:Queryable,user:Staff,batchId:string){
 await assertSession(db,user);need(user,'worksheet.read','read');
 return (await db.query('SELECT c.id,c.document_id,c.kind,c.copy_number,c.created_at,c.recalled_at,u.display_name actor,d.status document_status,d.doc_code,d.revision FROM lab_document_copy c JOIN lab_document d ON d.id=c.document_id JOIN app_user u ON u.id=c.actor_id WHERE d.batch_id=$1 ORDER BY c.created_at',[uuid.parse(batchId)])).rows;
}
export async function observationsView(db:Queryable,user:Staff,batchId:string){
 await assertSession(db,user);need(user,'worksheet.read','read');
 const obs=await liveObservations(db,uuid.parse(batchId));
 return obs.map(o=>{const def=fieldDef(o.field_id,o.item);return {id:o.id,sheetId:o.sheet_id,slot:o.slot_number,fieldId:o.field_id,item:o.item,label:def.label,cls:def.cls,value:o.value,valueText:valueText(def,o.value),source:o.source,eventTime:o.event_time,eventPrecision:o.event_time_precision,recordedAt:o.recorded_at,recorder:o.recorder,recordedBy:o.recorded_by,reviewer:o.reviewer,status:o.status,
  candidates:o.field_id==='F3-03'&&o.slot_number?qc1Candidates(String(o.value.value),rowKind(o.slot_number)):null};});
}
export async function dispositionsView(db:Queryable,user:Staff,batchId:string){
 await assertSession(db,user);need(user,'worksheet.read','read');
 return (await db.query('SELECT d.*,p.display_name proposer,c.display_name confirmer FROM lab_slot_disposition d JOIN app_user p ON p.id=d.proposed_by LEFT JOIN app_user c ON c.id=d.confirmed_by WHERE d.batch_id=$1 ORDER BY d.slot_number,d.stage',[uuid.parse(batchId)])).rows;
}
export {DISPOSITION_REASONS};
