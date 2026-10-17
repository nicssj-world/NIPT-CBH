import {z} from 'zod';
import type {Queryable} from '../db/connection';
import {contentHash} from '../p2/service';
import {CONTROL_LABEL,controlTypeOf,formatControlCode,formatPrintedControlId,formatRunLabel,getPlatePosition,getSheetNumber,effectiveLnHalos,specimenDisplayCode,type ControlType} from './rules';
import {finalizePredicates,decide,GATE_RULE_VERSION} from './gate';
import {LabError,uuid,reasonText,need,assertSession,audit,caseEvent,attemptEvent,setAttemptState,pendingPolicy,attemptFacts,assignmentDecision,candidatePrintedId,commonFacts,fifo,caseVisible,gestationalAge,BATCH_TEMPLATE,type Staff} from './core';
import {isoDate} from '../domain/thai-date';

export const EDITABLE=['Draft','PlanChecked','Amended'];
export const FINALIZED=['PlacementFinalized','PreWorkIssued','InExecution','ExecutionRecorded','ExecutionVerified','CompletedIssued'];
type Batch={id:string;run_label:string;run_year:number;run_number:number;state:string;version:number;template_version:string;formula_version:string;created_by:string;created_at:Date};
type Sheet={id:string;batch_id:string;sheet_number:number;state:string;planned_work_date:string|null;planned_operator:string|null;planned_extraction_lot:string|null;planned_extraction_expiry:string|null;planned_library_lot:string|null;planned_library_expiry:string|null;
 plan_checked_by:string|null;plan_checked_at:Date|null;plan_checked_version:number|null;placement_version:number;finalized_by:string|null;finalized_at:Date|null;placement_revision:number;execution_started_at:Date|null;execution_ended_at:Date|null;verified_at:Date|null};
const sheetCols="id,batch_id,sheet_number,state,planned_work_date::text,planned_operator,planned_extraction_lot,planned_extraction_expiry::text,planned_library_lot,planned_library_expiry::text,plan_checked_by,plan_checked_at,plan_checked_version,placement_version,finalized_by,finalized_at,placement_revision,execution_started_at,execution_ended_at,verified_at";

export async function lockBatch(db:Queryable,batchId:string,expectedVersion?:number){
 const b=(await db.query<Batch>('SELECT * FROM lab_batch WHERE id=$1 FOR UPDATE',[uuid.parse(batchId)])).rows[0];
 if(!b)throw new LabError('NOT_FOUND',404);if(b.state==='Cancelled')throw new LabError('BATCH_CANCELLED',409);
 if(expectedVersion!==undefined&&b.version!==expectedVersion)throw new LabError('VERSION_CONFLICT',409,{version:b.version});
 return b;
}
export async function sheetOf(db:Queryable,batchId:string,sheetNumber:number,lock=true){
 const s=(await db.query<Sheet>(`SELECT ${sheetCols} FROM lab_task_sheet WHERE batch_id=$1 AND sheet_number=$2${lock?' FOR UPDATE':''}`,[batchId,sheetNumber])).rows[0];if(!s)throw new LabError('NOT_FOUND',404);return s;
}
async function touch(db:Queryable,batchId:string,sheets:number[]){
 for(const n of [...new Set(sheets)])await db.query("UPDATE lab_task_sheet SET placement_version=placement_version+1,state=CASE WHEN state='PlanChecked' THEN 'Draft' ELSE state END,plan_checked_by=NULL,plan_checked_at=NULL,plan_checked_version=NULL WHERE batch_id=$1 AND sheet_number=$2",[batchId,n]);
 return (await db.query<{version:number}>('UPDATE lab_batch SET version=version+1 WHERE id=$1 RETURNING version',[batchId])).rows[0].version;
}
async function batchEvent(db:Queryable,user:Staff,batchId:string,type:string,sheet:number|null,reason:string|null,details:Record<string,unknown>={}){
 await db.query('INSERT INTO lab_batch_event(batch_id,sheet_number,event_type,reason,actor_id,details) VALUES($1,$2,$3,$4,$5,$6)',[batchId,sheet,type,reason,user.id,JSON.stringify({...details,synthetic:true})]);
}

/** Legacy create_nipt_batch: one assembling (Draft) batch at a time; RunNNN/YYYY by Bangkok calendar year; 3 sheets; 48 template slots. */
export async function createBatch(db:Queryable,user:Staff){
 await assertSession(db,user);need(user,'batch.draft');
 await db.query('SELECT pg_advisory_xact_lock(75432811)');
 const existing=(await db.query<{id:string;run_label:string}>("SELECT id,run_label FROM lab_batch WHERE state='Draft'")).rows[0];
 if(existing)return {batchId:existing.id,runLabel:existing.run_label,created:false};
 const {templateVersion,formulaVersion}=await pendingPolicy(db);
 const year=(await db.query<{y:number}>("SELECT extract(year FROM now() AT TIME ZONE 'Asia/Bangkok')::int y")).rows[0].y;
 const n=(await db.query<{v:number}>('INSERT INTO lab_batch_sequence(run_year,last_value) VALUES($1,1) ON CONFLICT(run_year) DO UPDATE SET last_value=lab_batch_sequence.last_value+1 RETURNING last_value v',[year])).rows[0].v;
 const label=formatRunLabel(n,year);
 const b=(await db.query<{id:string}>('INSERT INTO lab_batch(run_year,run_number,run_label,template_version,formula_version,created_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING id',[year,n,label,`${BATCH_TEMPLATE}+${templateVersion}`,formulaVersion,user.id])).rows[0].id;
 for(const s of [1,2,3])await db.query('INSERT INTO lab_task_sheet(batch_id,sheet_number) VALUES($1,$2)',[b,s]);
 for(let slot=1;slot<=48;slot++)await db.query('INSERT INTO lab_batch_slot(batch_id,slot_number,sheet_number,plate_position,barcode_index,control_type) VALUES($1,$2,$3,$4,$2,$5)',[b,slot,getSheetNumber(slot),getPlatePosition(slot),controlTypeOf(slot)]);
 await batchEvent(db,user,b,'BATCH_CREATED',null,null,{runLabel:label});
 await audit(db,user,'LAB_BATCH_CREATED','lab_batch',b,{version:n});
 return {batchId:b,runLabel:label,created:true};
}

type SlotView={slot:number;sheet:number;plate:string;barcode:number;control:ControlType|null;controlLabel:string|null;controlCode:string|null;assignment:null|{attemptId:string;caseId:string;roundId:string;roundNumber:number;hisLn:string;lnHalos:string|null;labelCode:string|null;printedSampleId:string|null;attemptState:string;repeat:boolean;urgent:boolean;ga:ReturnType<typeof gestationalAge>;labelPrints:number}};
export async function batchDetail(db:Queryable,user:Staff,batchId:string){
 await assertSession(db,user);need(user,'worksheet.read','read');
 const b=(await db.query<Batch&{cancel_reason:string|null}>('SELECT * FROM lab_batch WHERE id=$1',[uuid.parse(batchId)])).rows[0];if(!b)throw new LabError('NOT_FOUND',404);
 const sheets=(await db.query<Sheet>(`SELECT ${sheetCols} FROM lab_task_sheet WHERE batch_id=$1 ORDER BY sheet_number`,[b.id])).rows;
 const facts=await attemptFacts(db,'a.id IN (SELECT attempt_id FROM lab_slot_assignment WHERE batch_id=$1 AND removed_at IS NULL)',[b.id]);
 const bySlot=new Map(facts.map(f=>[f.slot_number!,f]));
 const slots:SlotView[]=Array.from({length:48},(_,i)=>{const slot=i+1,sheet=getSheetNumber(slot),control=controlTypeOf(slot),f=bySlot.get(slot),date=sheets[sheet-1].planned_work_date;
  return {slot,sheet,plate:getPlatePosition(slot),barcode:slot,control,controlLabel:control?CONTROL_LABEL[control]:null,controlCode:control&&date?formatPrintedControlId(control,date):null,
   assignment:f&&caseVisible(user,f)?{attemptId:f.attempt_id,caseId:f.case_id,roundId:f.round_id,roundNumber:f.round_number,hisLn:f.ln,lnHalos:f.ln_halos,labelCode:f.ln_halos?specimenDisplayCode(f.ln_halos,f.pregnancy,f.ln_halos_resampling):f.ln_halos,printedSampleId:f.printed_sample_id,attemptState:f.attempt_state,repeat:f.repeat_order_id!==null,urgent:f.urgent,ga:gestationalAge(f),labelPrints:f.label_prints}:null};});
 const documents=(await db.query('SELECT d.id,d.form,d.kind,d.revision,d.doc_code,d.status,d.status_reason,d.file_sha256,d.issued_at,u.display_name issued_by,t.sheet_number,(SELECT count(*) FROM lab_document_copy c WHERE c.document_id=d.id AND c.kind=\'WORKING_COPY\')::int working_copies,(SELECT count(*) FROM lab_document_copy c WHERE c.document_id=d.id AND c.kind=\'WORKING_COPY\' AND c.recalled_at IS NULL)::int unrecalled FROM lab_document d JOIN app_user u ON u.id=d.issued_by LEFT JOIN lab_task_sheet t ON t.id=d.sheet_id WHERE d.batch_id=$1 ORDER BY d.issued_at',[b.id])).rows;
 const events=(await db.query('SELECT e.event_type,e.sheet_number,e.reason,e.created_at,u.display_name actor FROM lab_batch_event e JOIN app_user u ON u.id=e.actor_id WHERE e.batch_id=$1 ORDER BY e.sequence DESC LIMIT 100',[b.id])).rows;
 const snapshots=(await db.query('SELECT s.id,t.sheet_number,s.revision,s.content_hash,s.created_at FROM lab_placement_snapshot s JOIN lab_task_sheet t ON t.id=s.sheet_id WHERE s.batch_id=$1 ORDER BY t.sheet_number,s.revision',[b.id])).rows;
 return {batch:{id:b.id,runLabel:b.run_label,state:b.state,version:b.version,templateVersion:b.template_version,formulaVersion:b.formula_version,createdAt:b.created_at,cancelReason:b.cancel_reason},sheets,slots,documents,events,snapshots};
}
export async function listBatches(db:Queryable,user:Staff){
 await assertSession(db,user);need(user,'worksheet.read','read');
 return (await db.query(`SELECT b.id,b.run_label,b.state,b.version,b.created_at,(SELECT count(*) FROM lab_slot_assignment a WHERE a.batch_id=b.id AND a.removed_at IS NULL)::int samples,
  ARRAY(SELECT t.state FROM lab_task_sheet t WHERE t.batch_id=b.id ORDER BY t.sheet_number) sheet_states FROM lab_batch b ORDER BY b.created_at DESC LIMIT 100`)).rows;
}

/** The eligible FIFO queue head and the earlier eligible work a selection would overtake (single source for assign and preview). */
async function fifoOvertaken(db:Queryable,user:Staff,attemptIds:string[],policy:Awaited<ReturnType<typeof pendingPolicy>>['policy']){
 const queue=(await attemptFacts(db,"a.state='Ready' AND c.current_round_id=a.round_id AND c.registration_origin<>'HISTORICAL'",[])).filter(r=>caseVisible(user,r)&&assignmentDecision(r,policy).eligible).sort(fifo);
 const chosen=new Set(attemptIds);
 return {head:queue.slice(0,chosen.size).map(r=>r.attempt_id),overtaken:queue.slice(0,queue.findLastIndex(r=>chosen.has(r.attempt_id))+1).filter(r=>!chosen.has(r.attempt_id))};
}
/** Read-only (P0-3): tells the user before submitting whether a selection overtakes FIFO and so needs a recorded reason. */
export async function previewAssignment(db:Queryable,user:Staff,input:unknown){
 await assertSession(db,user);need(user,'batch.assign');
 const d=z.strictObject({attemptIds:z.array(uuid).min(1).max(45).refine(v=>new Set(v).size===v.length,'DUPLICATE_ATTEMPT')}).parse(input);
 const {policy}=await pendingPolicy(db);
 const selected=await attemptFacts(db,'a.id=ANY($1::uuid[])',[d.attemptIds]);
 if(selected.length!==d.attemptIds.length||selected.some(r=>!caseVisible(user,r)))throw new LabError('NOT_FOUND',404);
 const {overtaken}=await fifoOvertaken(db,user,d.attemptIds,policy);
 return {overtaken:overtaken.length,reasonRequired:overtaken.length>0};
}
/** Assignment Gate (BG-01..07 + BG-08A/09A) per attempt, in this transaction; FIFO proposal skips control slots. */
export async function assignToBatch(db:Queryable,user:Staff,input:unknown){
 await assertSession(db,user);need(user,'batch.assign');
 const d=z.strictObject({batchId:uuid,expectedVersion:z.number().int().min(0),attemptIds:z.array(uuid).min(1).max(45).refine(v=>new Set(v).size===v.length,'DUPLICATE_ATTEMPT'),queueOverrideReason:reasonText.optional()}).parse(input);
 const b=await lockBatch(db,d.batchId,d.expectedVersion);
 const {policy}=await pendingPolicy(db);
 // Lock order: attempts by id, then their cases (shared with redraw/receipt via the case row).
 await db.query('SELECT id FROM analytical_attempt WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE',[d.attemptIds]);
 const selected=await attemptFacts(db,'a.id=ANY($1::uuid[])',[d.attemptIds]);
 if(selected.length!==d.attemptIds.length||selected.some(r=>!caseVisible(user,r)))throw new LabError('NOT_FOUND',404);
 // FIFO is a proposal, not a rule — overtaking eligible earlier work needs a recorded reason (§12.9 ขั้น 3–4).
 const {head,overtaken}=await fifoOvertaken(db,user,d.attemptIds,policy);
 if(overtaken.length&&!d.queueOverrideReason)throw new LabError('QUEUE_OVERRIDE_REASON_REQUIRED',422,{overtaken:overtaken.length});
 const free=(await db.query<{slot_number:number;sheet_number:number}>(`SELECT s.slot_number,s.sheet_number FROM lab_batch_slot s JOIN lab_task_sheet t ON t.batch_id=s.batch_id AND t.sheet_number=s.sheet_number
  WHERE s.batch_id=$1 AND s.control_type IS NULL AND t.state IN ('Draft','PlanChecked','Amended') AND NOT EXISTS(SELECT 1 FROM lab_slot_assignment a WHERE a.batch_id=s.batch_id AND a.slot_number=s.slot_number AND a.removed_at IS NULL) ORDER BY s.slot_number`,[b.id])).rows;
 const placed:{attemptId:string;slot:number;printedSampleId:string}[]=[],rejected:{attemptId:string;failed:string[];pending:string[]}[]=[];
 // Slots are proposed in the order the user saw the selected rows (Receive Date Sorting Owner Lock §2.3), never click order.
 const byId=new Map(selected.map(r=>[r.attempt_id,r]));
 for(const r of d.attemptIds.map(id=>byId.get(id)!)){
  const g=assignmentDecision(r,policy);
  if(!g.eligible){rejected.push({attemptId:r.attempt_id,failed:g.failed,pending:policy==='HOLD'?g.pending:[]});continue;}
  const slot=free.shift();if(!slot){rejected.push({attemptId:r.attempt_id,failed:['BATCH_FULL'],pending:[]});continue;}
  const id=candidatePrintedId(r);
  if(!r.printed_sample_id){await db.query('UPDATE analytical_attempt SET printed_sample_id=$2 WHERE id=$1',[r.attempt_id,id.id]);await attemptEvent(db,user,{attemptId:r.attempt_id,caseId:r.case_id,type:'PRINTED_ID_ASSIGNED',details:{printedSampleId:id.id}});}
  await db.query('INSERT INTO lab_slot_assignment(batch_id,slot_number,attempt_id,assigned_by) VALUES($1,$2,$3,$4)',[b.id,slot.slot_number,r.attempt_id,user.id]);
  await setAttemptState(db,user,{id:r.attempt_id,case_id:r.case_id,state:r.attempt_state},'Assigned',{batchId:b.id,slot:slot.slot_number,gateRuleVersion:GATE_RULE_VERSION,syntheticPendingAccepted:g.syntheticPendingAccepted,pending:g.pending});
  if(r.repeat_order_id)await db.query("UPDATE repeat_work_order SET state='RepeatInProgress' WHERE id=$1 AND state='RepeatPendingBatch'",[r.repeat_order_id]);
  if(overtaken.length&&!head.includes(r.attempt_id))await attemptEvent(db,user,{attemptId:r.attempt_id,caseId:r.case_id,type:'QUEUE_OVERRIDE',reason:d.queueOverrideReason,details:{batchId:b.id,overtaken:overtaken.length}});
  await caseEvent(db,user,r.case_id,'LAB_ASSIGNED_TO_BATCH',{runLabel:b.run_label,slot:slot.slot_number});
  placed.push({attemptId:r.attempt_id,slot:slot.slot_number,printedSampleId:id.id!});
 }
 const version=placed.length?await touch(db,b.id,placed.map(p=>getSheetNumber(p.slot))):b.version;
 if(placed.length)await batchEvent(db,user,b.id,'ASSIGNED',null,d.queueOverrideReason??null,{count:placed.length,queueOverride:overtaken.length>0});
 await audit(db,user,'LAB_BATCH_ASSIGN','lab_batch',b.id,{count:placed.length,outcome:rejected.length?'PARTIAL':'ALL_PLACED',version});
 return {placed,rejected,version};
}

async function liveAssignment(db:Queryable,batchId:string,slot:number){
 return (await db.query<{id:string;attempt_id:string;case_id:string;state:string;repeat_order_id:string|null}>('SELECT s.id,s.attempt_id,a.case_id,a.state,a.repeat_order_id FROM lab_slot_assignment s JOIN analytical_attempt a ON a.id=s.attempt_id WHERE s.batch_id=$1 AND s.slot_number=$2 AND s.removed_at IS NULL FOR UPDATE OF s,a',[batchId,slot])).rows[0];
}
/** Move into an empty patient slot, or swap two placed attempts — Draft only; controls can never be moved or covered. */
export async function moveSlot(db:Queryable,user:Staff,input:unknown){
 await assertSession(db,user);need(user,'batch.draft');
 const d=z.strictObject({batchId:uuid,expectedVersion:z.number().int().min(0),fromSlot:z.number().int().min(1).max(48),toSlot:z.number().int().min(1).max(48),reason:reasonText.optional()}).refine(v=>v.fromSlot!==v.toSlot,'SAME_SLOT').parse(input);
 const b=await lockBatch(db,d.batchId,d.expectedVersion);
 if(controlTypeOf(d.fromSlot)||controlTypeOf(d.toSlot))throw new LabError('CONTROL_SLOT_PROTECTED',409);
 const sheets=[getSheetNumber(d.fromSlot),getSheetNumber(d.toSlot)];
 for(const n of sheets){const s=await sheetOf(db,b.id,n);if(!EDITABLE.includes(s.state))throw new LabError('PLACEMENT_LOCKED',409);if(s.state==='PlanChecked'&&!d.reason)throw new LabError('REASON_REQUIRED_AFTER_PLAN_CHECK',422);}
 const from=await liveAssignment(db,b.id,d.fromSlot);if(!from)throw new LabError('SLOT_EMPTY',409);
 const to=await liveAssignment(db,b.id,d.toSlot);
 for(const x of [from,to].filter(Boolean))await db.query("UPDATE lab_slot_assignment SET removed_at=now(),removed_by=$2,removed_reason='MOVED' WHERE id=$1",[x!.id,user.id]);
 await db.query('INSERT INTO lab_slot_assignment(batch_id,slot_number,attempt_id,assigned_by) VALUES($1,$2,$3,$4)',[b.id,d.toSlot,from.attempt_id,user.id]);
 if(to)await db.query('INSERT INTO lab_slot_assignment(batch_id,slot_number,attempt_id,assigned_by) VALUES($1,$2,$3,$4)',[b.id,d.fromSlot,to.attempt_id,user.id]);
 const version=await touch(db,b.id,sheets);
 await batchEvent(db,user,b.id,to?'SLOTS_SWAPPED':'SLOT_MOVED',null,d.reason??null,{fromSlot:d.fromSlot,toSlot:d.toSlot});
 await audit(db,user,to?'LAB_SLOTS_SWAPPED':'LAB_SLOT_MOVED','lab_batch',b.id,{version});
 return {version,swapped:!!to};
}
export async function removeFromBatch(db:Queryable,user:Staff,input:unknown){
 await assertSession(db,user);need(user,'batch.draft');
 const d=z.strictObject({batchId:uuid,expectedVersion:z.number().int().min(0),slot:z.number().int().min(1).max(48),reason:reasonText.optional()}).parse(input);
 const b=await lockBatch(db,d.batchId,d.expectedVersion);const s=await sheetOf(db,b.id,getSheetNumber(d.slot));
 if(!EDITABLE.includes(s.state))throw new LabError('PLACEMENT_LOCKED',409);if((s.state!=='Draft'||s.placement_revision>0)&&!d.reason)throw new LabError('REASON_REQUIRED_AFTER_PLAN_CHECK',422);
 const a=await liveAssignment(db,b.id,d.slot);if(!a)throw new LabError('SLOT_EMPTY',409);
 await db.query("UPDATE lab_slot_assignment SET removed_at=now(),removed_by=$2,removed_reason=$3 WHERE id=$1",[a.id,user.id,d.reason??'REMOVED_IN_DRAFT']);
 await setAttemptState(db,user,{id:a.attempt_id,case_id:a.case_id,state:a.state},'Ready',{batchId:b.id,slot:d.slot,reason:d.reason??null});
 if(a.repeat_order_id)await db.query("UPDATE repeat_work_order SET state='RepeatPendingBatch' WHERE id=$1 AND state='RepeatInProgress'",[a.repeat_order_id]);
 await caseEvent(db,user,a.case_id,'LAB_REMOVED_FROM_BATCH',{runLabel:b.run_label,slot:d.slot});
 const version=await touch(db,b.id,[s.sheet_number]);
 await batchEvent(db,user,b.id,'SLOT_REMOVED',s.sheet_number,d.reason??null,{slot:d.slot});
 await audit(db,user,'LAB_SLOT_REMOVED','lab_batch',b.id,{version});
 return {version};
}
const optText=z.string().trim().max(80).refine(v=>!/\d{13}/.test(v)).nullable();
export async function updateSheetPlan(db:Queryable,user:Staff,input:unknown){
 await assertSession(db,user);need(user,'batch.draft');
 const d=z.strictObject({batchId:uuid,expectedVersion:z.number().int().min(0),sheetNumber:z.number().int().min(1).max(3),plannedWorkDate:isoDate,plannedOperator:optText,plannedExtractionLot:optText,plannedExtractionExpiry:isoDate.nullable(),plannedLibraryLot:optText,plannedLibraryExpiry:isoDate.nullable()}).parse(input);
 const b=await lockBatch(db,d.batchId,d.expectedVersion);const s=await sheetOf(db,b.id,d.sheetNumber);if(!EDITABLE.includes(s.state))throw new LabError('PLACEMENT_LOCKED',409);
 await db.query('UPDATE lab_task_sheet SET planned_work_date=$2,planned_operator=$3,planned_extraction_lot=$4,planned_extraction_expiry=$5,planned_library_lot=$6,planned_library_expiry=$7 WHERE id=$1',[s.id,d.plannedWorkDate,d.plannedOperator,d.plannedExtractionLot,d.plannedExtractionExpiry,d.plannedLibraryLot,d.plannedLibraryExpiry]);
 const version=await touch(db,b.id,[d.sheetNumber]);await batchEvent(db,user,b.id,'PLAN_DATA_UPDATED',d.sheetNumber,null);
 return {version};
}
/** Plan check (§12.9 ขั้น 7): confirms the plan on screen — explicitly NOT evidence that anything was pipetted. */
export async function planCheck(db:Queryable,user:Staff,input:unknown){
 await assertSession(db,user);need(user,'batch.finalize');
 const d=z.strictObject({batchId:uuid,expectedVersion:z.number().int().min(0),sheetNumber:z.number().int().min(1).max(3),confirm:z.strictObject({controlsAtTemplate:z.literal(true),identifiersMatch:z.literal(true),noDuplicates:z.literal(true)})}).parse(input);
 const b=await lockBatch(db,d.batchId,d.expectedVersion);const s=await sheetOf(db,b.id,d.sheetNumber);
 if(!['Draft','Amended'].includes(s.state))throw new LabError('PLAN_CHECK_STATE',409);
 if(!s.planned_work_date)throw new LabError('PLANNED_WORK_DATE_REQUIRED_FOR_CONTROL_CODES',422);
 const n=(await db.query<{n:number}>('SELECT count(*)::int n FROM lab_slot_assignment a JOIN lab_batch_slot s ON s.batch_id=a.batch_id AND s.slot_number=a.slot_number WHERE a.batch_id=$1 AND s.sheet_number=$2 AND a.removed_at IS NULL',[b.id,d.sheetNumber])).rows[0].n;
 if(!n)throw new LabError('SHEET_HAS_NO_SAMPLES',422);
 await db.query("UPDATE lab_task_sheet SET state='PlanChecked',plan_checked_by=$2,plan_checked_at=now(),plan_checked_version=placement_version WHERE id=$1",[s.id,user.id]);
 const version=(await db.query<{version:number}>('UPDATE lab_batch SET version=version+1 WHERE id=$1 RETURNING version',[b.id])).rows[0].version;
 await batchEvent(db,user,b.id,'PLAN_CHECKED',d.sheetNumber,null,{samples:n});await audit(db,user,'LAB_PLAN_CHECKED','lab_batch',b.id,{count:n,version});
 return {version};
}

/** Finalize Placement (§12.9 ขั้น 8): Finalize Gate for every attempt in one transaction; any failure rejects the whole sheet. */
export async function finalizeSheet(db:Queryable,user:Staff,input:unknown){
 await assertSession(db,user);need(user,'batch.finalize');
 const d=z.strictObject({batchId:uuid,expectedVersion:z.number().int().min(0),sheetNumber:z.number().int().min(1).max(3)}).parse(input);
 const b=await lockBatch(db,d.batchId,d.expectedVersion);const s=await sheetOf(db,b.id,d.sheetNumber);
 if(s.state!=='PlanChecked')throw new LabError('PLAN_CHECK_REQUIRED',409);
 const {policy}=await pendingPolicy(db);
 const ids=(await db.query<{attempt_id:string}>('SELECT a.attempt_id FROM lab_slot_assignment a JOIN lab_batch_slot s ON s.batch_id=a.batch_id AND s.slot_number=a.slot_number WHERE a.batch_id=$1 AND s.sheet_number=$2 AND a.removed_at IS NULL ORDER BY a.attempt_id',[b.id,d.sheetNumber])).rows.map(r=>r.attempt_id);
 await db.query('SELECT id FROM analytical_attempt WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE',[ids]);
 const facts=await attemptFacts(db,'a.id=ANY($1::uuid[])',[ids]);
 const counts=new Map((await db.query<{attempt_id:string;here:number;elsewhere:number}>(`SELECT x.attempt_id,count(*) FILTER(WHERE x.batch_id=$1 AND bs.sheet_number=$2)::int here,count(*) FILTER(WHERE NOT(x.batch_id=$1 AND bs.sheet_number=$2))::int elsewhere
  FROM lab_slot_assignment x JOIN lab_batch_slot bs ON bs.batch_id=x.batch_id AND bs.slot_number=x.slot_number WHERE x.attempt_id=ANY($3::uuid[]) AND x.removed_at IS NULL GROUP BY x.attempt_id`,[b.id,d.sheetNumber,ids])).rows.map(r=>[r.attempt_id,r]));
 const results=facts.map(f=>({f,g:decide(finalizePredicates({...commonFacts(f),attemptState:f.attempt_state,activeSlotsInThisSheet:counts.get(f.attempt_id)?.here??0,activeSlotsElsewhere:counts.get(f.attempt_id)?.elsewhere??0,onHold:f.hold,resumeDecisionRequired:f.resume_decision_required,repeatOrderState:f.repeat_state,sheetPlanCheckedAtVersion:s.plan_checked_version===s.placement_version}),policy)}));
 const failed=results.filter(x=>!x.g.eligible);
 if(!ids.length||failed.length){throw new LabError('FINALIZE_GATE_FAILED',409,failed.map(x=>({attemptId:x.f.attempt_id,slot:x.f.slot_number,failed:x.g.failed,pending:x.g.pending})));}
 const revision=s.placement_revision+1,date=s.planned_work_date!;
 const users=new Map((await db.query<{id:string;display_name:string}>('SELECT id,display_name FROM app_user WHERE id=ANY($1::uuid[])',[[user.id,s.plan_checked_by]])).rows.map(u=>[u.id,u.display_name]));
 const bySlot=new Map(results.map(x=>[x.f.slot_number!,x]));
 const lo=(d.sheetNumber-1)*16+1;
 const payload={synthetic:true,batchId:b.id,runLabel:b.run_label,sheetNumber:d.sheetNumber,placementRevision:revision,templateVersion:b.template_version,formulaVersion:b.formula_version,
  plan:{workDate:date,operator:s.planned_operator,extractionLot:s.planned_extraction_lot,extractionExpiry:s.planned_extraction_expiry,libraryLot:s.planned_library_lot,libraryExpiry:s.planned_library_expiry},
  planCheck:{by:users.get(s.plan_checked_by!)??null,at:s.plan_checked_at?.toISOString()??null},finalizedBy:users.get(user.id),gate:{ruleVersion:GATE_RULE_VERSION,policy,pendingAccepted:[...new Set(results.flatMap(x=>x.g.syntheticPendingAccepted?x.g.pending:[]))]},
  slots:Array.from({length:16},(_,i)=>{const slot=lo+i,control=controlTypeOf(slot),x=bySlot.get(slot);
   return {slot,plate:getPlatePosition(slot),barcode:slot,control,controlCode:control?formatControlCode(control,date):null,printedControlId:control?formatPrintedControlId(control,date):null,
    attemptId:x?.f.attempt_id??null,caseId:x?.f.case_id??null,roundId:x?.f.round_id??null,roundNumber:x?.f.round_number??null,lnHalos:x&&x.f.ln_halos&&x.f.pregnancy?effectiveLnHalos(x.f.ln_halos,x.f.pregnancy):null,printedSampleId:x?.f.printed_sample_id??null,repeat:x?x.f.repeat_order_id!==null:false};})};
 if(payload.slots.some(x=>x.attemptId&&!x.printedSampleId))throw new LabError('PRINTED_ID_MISSING',409);
 const hash=contentHash(payload);
 await db.query('INSERT INTO lab_placement_snapshot(batch_id,sheet_id,revision,payload,content_hash,created_by) VALUES($1,$2,$3,$4,$5,$6)',[b.id,s.id,revision,JSON.stringify(payload),hash,user.id]);
 await db.query("UPDATE lab_task_sheet SET state='PlacementFinalized',finalized_by=$2,finalized_at=now(),placement_revision=$3 WHERE id=$1",[s.id,user.id,revision]);
 // Milestone "เริ่มตรวจวิเคราะห์" (Baseline §4) becomes true and never reverts; attempts stay Assigned until physical execution starts.
 await db.query('UPDATE specimen_round SET analysis_started=true WHERE id=ANY($1::uuid[]) AND NOT analysis_started',[facts.map(f=>f.round_id)]);
 for(const f of facts)await caseEvent(db,user,f.case_id,'LAB_PLACEMENT_FINALIZED',{runLabel:b.run_label,sheet:d.sheetNumber,slot:f.slot_number,revision});
 const version=(await db.query<{version:number}>("UPDATE lab_batch SET version=version+1,state=CASE WHEN state='Draft' THEN 'InPreparation' ELSE state END WHERE id=$1 RETURNING version",[b.id])).rows[0].version;
 await batchEvent(db,user,b.id,'PLACEMENT_FINALIZED',d.sheetNumber,null,{revision,hash,samples:ids.length});
 await audit(db,user,'LAB_PLACEMENT_FINALIZED','lab_batch',b.id,{count:ids.length,version:revision,ruleVersion:GATE_RULE_VERSION,outcome:payload.gate.pendingAccepted.length?'SYNTHETIC_PENDING_ACCEPTED':'ALL_PASS'});
 return {version,revision,snapshotHash:hash,pendingAccepted:payload.gate.pendingAccepted};
}
export type PlacementPayload={synthetic:true;batchId:string;runLabel:string;sheetNumber:number;placementRevision:number;templateVersion:string;formulaVersion:string;plan:{workDate:string;operator:string|null;extractionLot:string|null;extractionExpiry:string|null;libraryLot:string|null;libraryExpiry:string|null};
 planCheck:{by:string|null;at:string|null};finalizedBy:string;gate:{ruleVersion:string;policy:string;pendingAccepted:string[]};slots:{slot:number;plate:string;barcode:number;control:ControlType|null;controlCode:string|null;printedControlId:string|null;attemptId:string|null;caseId:string|null;roundId:string|null;roundNumber:number|null;lnHalos:string|null;printedSampleId:string|null;repeat:boolean}[]};
export async function latestSnapshot(db:Queryable,sheetId:string){
 const r=(await db.query<{id:string;revision:number;payload:PlacementPayload;content_hash:string}>('SELECT id,revision,payload,content_hash FROM lab_placement_snapshot WHERE sheet_id=$1 ORDER BY revision DESC LIMIT 1',[sheetId])).rows[0];
 if(!r)throw new LabError('PLACEMENT_SNAPSHOT_REQUIRED',409);return r;
}

/** Controlled amendment before physical execution (§12.9, §12.22): Stop-use + recall; snapshots and PDFs are never edited. */
export async function amendSheet(db:Queryable,user:Staff,input:unknown){
 await assertSession(db,user);need(user,'batch.amend');
 const d=z.strictObject({batchId:uuid,expectedVersion:z.number().int().min(0),sheetNumber:z.number().int().min(1).max(3),reason:reasonText}).parse(input);
 const b=await lockBatch(db,d.batchId,d.expectedVersion);const s=await sheetOf(db,b.id,d.sheetNumber);
 if(!['PlacementFinalized','PreWorkIssued'].includes(s.state))throw new LabError('AMEND_ONLY_BEFORE_EXECUTION',409);
 const stopped=(await db.query<{id:string}>("UPDATE lab_document SET status='StopUse',status_reason=$3,status_changed_by=$4,status_changed_at=now() WHERE batch_id=$1 AND status='Issued' AND kind='PRE_WORK' AND (sheet_id=$2 OR form='F3') RETURNING id",[b.id,s.id,d.reason,user.id])).rows.length;
 await db.query("UPDATE lab_task_sheet SET state='Amended',plan_checked_by=NULL,plan_checked_at=NULL,plan_checked_version=NULL,placement_version=placement_version+1 WHERE id=$1",[s.id]);
 const version=(await db.query<{version:number}>('UPDATE lab_batch SET version=version+1 WHERE id=$1 RETURNING version',[b.id])).rows[0].version;
 await batchEvent(db,user,b.id,'SHEET_AMENDED',d.sheetNumber,d.reason,{stoppedDocuments:stopped});await audit(db,user,'LAB_SHEET_AMENDED','lab_batch',b.id,{count:stopped,version});
 return {version,stoppedDocuments:stopped};
}

/** Cancel before physical execution. Never-finalized placements return to Ready; finalized attempts become BatchCancelled (Repeat next). */
export async function cancelBatch(db:Queryable,user:Staff,input:unknown){
 await assertSession(db,user);
 const d=z.strictObject({batchId:uuid,expectedVersion:z.number().int().min(0),reason:reasonText}).parse(input);
 const b=await lockBatch(db,d.batchId,d.expectedVersion);
 const sheets=(await db.query<Sheet>(`SELECT ${sheetCols} FROM lab_task_sheet WHERE batch_id=$1 ORDER BY sheet_number FOR UPDATE`,[b.id])).rows;
 const everFinalized=sheets.some(s=>s.placement_revision>0);need(user,everFinalized?'batch.unlock':'batch.draft');
 if(sheets.some(s=>['InExecution','ExecutionRecorded','ExecutionVerified','CompletedIssued'].includes(s.state)))throw new LabError('CANCEL_ONLY_BEFORE_EXECUTION',409);
 const live=(await db.query<{id:string;attempt_id:string;case_id:string;state:string;repeat_order_id:string|null;sheet_number:number}>(`SELECT x.id,x.attempt_id,a.case_id,a.state,a.repeat_order_id,bs.sheet_number FROM lab_slot_assignment x JOIN analytical_attempt a ON a.id=x.attempt_id JOIN lab_batch_slot bs ON bs.batch_id=x.batch_id AND bs.slot_number=x.slot_number WHERE x.batch_id=$1 AND x.removed_at IS NULL FOR UPDATE OF x,a`,[b.id])).rows;
 for(const a of live){
  const finalized=sheets[a.sheet_number-1].placement_revision>0;
  await db.query("UPDATE lab_slot_assignment SET removed_at=now(),removed_by=$2,removed_reason='BATCH_CANCELLED' WHERE id=$1",[a.id,user.id]);
  if(a.state==='Assigned'){await setAttemptState(db,user,{id:a.attempt_id,case_id:a.case_id,state:a.state},finalized?'BatchCancelled':'Ready',{batchId:b.id});
   if(a.repeat_order_id)await db.query(`UPDATE repeat_work_order SET state=$2${finalized?",closed_by=$3,closed_at=now(),close_reason='BATCH_CANCELLED'":''} WHERE id=$1 AND state='RepeatInProgress'`,finalized?[a.repeat_order_id,'RepeatFailed',user.id]:[a.repeat_order_id,'RepeatPendingBatch']);}
  await caseEvent(db,user,a.case_id,'LAB_BATCH_CANCELLED',{runLabel:b.run_label});
 }
 for(const s of sheets)if(s.state!=='Cancelled')await db.query("UPDATE lab_task_sheet SET state='Cancelled' WHERE id=$1",[s.id]);
 await db.query("UPDATE lab_document SET status='Cancelled',status_reason=$2,status_changed_by=$3,status_changed_at=now() WHERE batch_id=$1 AND status IN ('Issued','StopUse')",[b.id,d.reason,user.id]);
 await db.query("UPDATE lab_batch SET state='Cancelled',cancelled_by=$2,cancelled_at=now(),cancel_reason=$3,version=version+1 WHERE id=$1",[b.id,user.id,d.reason]);
 await batchEvent(db,user,b.id,'BATCH_CANCELLED',null,d.reason,{released:live.length});await audit(db,user,'LAB_BATCH_CANCELLED','lab_batch',b.id,{count:live.length});
 return {released:live.length};
}

/** Online start of physical execution (§12.9 ขั้น 10): server time is the execution anchor; Assigned → InProgress. */
export async function startExecution(db:Queryable,user:Staff,input:unknown){
 await assertSession(db,user);need(user,'execution.record');
 const d=z.strictObject({batchId:uuid,expectedVersion:z.number().int().min(0),sheetNumber:z.number().int().min(1).max(3)}).parse(input);
 const b=await lockBatch(db,d.batchId,d.expectedVersion);const s=await sheetOf(db,b.id,d.sheetNumber);
 if(s.state!=='PreWorkIssued')throw new LabError('PRE_WORK_REQUIRED_BEFORE_EXECUTION',409);
 const open=(await db.query<{n:number}>("SELECT count(*)::int n FROM lab_document_copy c JOIN lab_document d ON d.id=c.document_id WHERE d.batch_id=$1 AND d.status IN ('StopUse','Superseded','Cancelled') AND c.kind='WORKING_COPY' AND c.recalled_at IS NULL",[b.id])).rows[0].n;
 if(open)throw new LabError('RECALL_PENDING',409,{workingCopies:open});
 await db.query("UPDATE lab_task_sheet SET state='InExecution',execution_mode='ONLINE_LIVE',execution_started_at=now(),execution_started_by=$2 WHERE id=$1",[s.id,user.id]);
 const attempts=(await db.query<{id:string;case_id:string;state:string}>("SELECT a.id,a.case_id,a.state FROM lab_slot_assignment x JOIN analytical_attempt a ON a.id=x.attempt_id JOIN lab_batch_slot bs ON bs.batch_id=x.batch_id AND bs.slot_number=x.slot_number WHERE x.batch_id=$1 AND bs.sheet_number=$2 AND x.removed_at IS NULL AND a.state='Assigned' FOR UPDATE OF a",[b.id,d.sheetNumber])).rows;
 for(const a of attempts)await setAttemptState(db,user,a,'InProgress',{batchId:b.id,sheet:d.sheetNumber});
 const version=(await db.query<{version:number}>('UPDATE lab_batch SET version=version+1 WHERE id=$1 RETURNING version',[b.id])).rows[0].version;
 await batchEvent(db,user,b.id,'EXECUTION_STARTED',d.sheetNumber,null,{attempts:attempts.length});await audit(db,user,'LAB_EXECUTION_STARTED','lab_batch',b.id,{count:attempts.length,version});
 return {version,started:attempts.length};
}
export async function endExecution(db:Queryable,user:Staff,input:unknown){
 await assertSession(db,user);need(user,'execution.record');
 const d=z.strictObject({batchId:uuid,expectedVersion:z.number().int().min(0),sheetNumber:z.number().int().min(1).max(3)}).parse(input);
 const b=await lockBatch(db,d.batchId,d.expectedVersion);const s=await sheetOf(db,b.id,d.sheetNumber);
 if(s.state!=='InExecution')throw new LabError('EXECUTION_NOT_STARTED',409);
 await db.query("UPDATE lab_task_sheet SET state='ExecutionRecorded',execution_ended_at=now(),execution_ended_by=$2 WHERE id=$1",[s.id,user.id]);
 const version=(await db.query<{version:number}>('UPDATE lab_batch SET version=version+1 WHERE id=$1 RETURNING version',[b.id])).rows[0].version;
 await batchEvent(db,user,b.id,'EXECUTION_RECORDED',d.sheetNumber,null);await audit(db,user,'LAB_EXECUTION_RECORDED','lab_batch',b.id,{version});
 return {version};
}
