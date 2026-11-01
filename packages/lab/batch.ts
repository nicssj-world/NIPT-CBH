import {z} from 'zod';
import type {Queryable} from '../db/connection';
import {contentHash} from '../p2/service';
import {CONTROL_LABEL,controlTypeOf,formatControlCode,formatPrintedControlId,formatRunLabel,getPlatePosition,getSheetNumber,effectiveLnHalos,specimenDisplayCode,type ControlType} from './rules';
import {finalizePredicates,decide,GATE_RULE_VERSION} from './gate';
import {LabError,uuid,reasonText,need,assertSession,audit,caseEvent,attemptEvent,setAttemptState,pendingPolicy,attemptFacts,assignmentDecision,candidatePrintedId,commonFacts,fifo,caseVisible,gestationalAge,BATCH_TEMPLATE,type Staff} from './core';
import {isoDate} from '../domain/thai-date';
import {pageFields,clampPage,offsetOf} from '../db/pagination';

export const EDITABLE=['Draft','PlanChecked','Amended'];
/** Never-printed Draft/PlanChecked sheets, or a printed sheet re-opened for edits (Amended). */
export const placementEditable=(s:{state:string;placement_revision:number})=>EDITABLE.includes(s.state)&&(s.placement_revision===0||s.state==='Amended');
export const FINALIZED=['PlacementFinalized','PreWorkIssued','InExecution','ExecutionRecorded','ExecutionVerified','CompletedIssued'];
type Batch={id:string;run_label:string;run_year:number;run_number:number;state:string;version:number;template_version:string;formula_version:string;created_by:string;created_at:Date};
type Sheet={id:string;batch_id:string;sheet_number:number;state:string;planned_work_date:string|null;planned_operator:string|null;planned_extraction_lot:string|null;planned_extraction_expiry:string|null;planned_library_lot:string|null;planned_library_expiry:string|null;
 plan_checked_by:string|null;plan_checked_at:Date|null;plan_checked_version:number|null;placement_version:number;finalized_by:string|null;finalized_at:Date|null;placement_revision:number;execution_started_at:Date|null;execution_ended_at:Date|null;verified_at:Date|null};
const sheetCols="id,batch_id,sheet_number,state,planned_work_date::text,planned_operator,planned_extraction_lot,planned_extraction_expiry::text,planned_library_lot,planned_library_expiry::text,plan_checked_by,plan_checked_at,plan_checked_version,placement_version,finalized_by,finalized_at,placement_revision,execution_started_at,execution_ended_at,verified_at";

export async function lockBatch(db:Queryable,batchId:string,expectedVersion?:number){
 // Upgrade rehearsals also exercise this read on the pinned pre-111 schema.
 // Once 111 exists, removed drafts always remain inaccessible.
 const hasRemoval=(await db.query<{present:boolean}>("SELECT to_regclass('public.lab_batch_removal') IS NOT NULL present")).rows[0].present;
 const b=(await db.query<Batch>(`SELECT * FROM lab_batch WHERE id=$1${hasRemoval?' AND NOT EXISTS(SELECT 1 FROM lab_batch_removal WHERE batch_id=lab_batch.id)':''} FOR UPDATE`,[uuid.parse(batchId)])).rows[0];
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
 // Upgrade rehearsals create a baseline Draft before migration 111 exists; there can be no removal row on that schema.
 const hasRemoval=(await db.query<{present:boolean}>("SELECT to_regclass('public.lab_batch_removal') IS NOT NULL present")).rows[0].present;
 const existing=(await db.query<{id:string;run_label:string}>(hasRemoval?"SELECT id,run_label FROM lab_batch WHERE state='Draft' AND NOT EXISTS(SELECT 1 FROM lab_batch_removal WHERE batch_id=lab_batch.id)":"SELECT id,run_label FROM lab_batch WHERE state='Draft'")).rows[0];
 if(existing)return {batchId:existing.id,runLabel:existing.run_label,created:false};
 const {templateVersion,formulaVersion}=await pendingPolicy(db);
 const year=(await db.query<{y:number}>("SELECT extract(year FROM now() AT TIME ZONE 'Asia/Bangkok')::int y")).rows[0].y;
 // OWNER-LAB-030: a Run number given back by an unused, trashed Batch is reused first (lowest first), so numbering has no gaps.
 const releasable=(await db.query<{present:boolean}>("SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='lab_batch' AND column_name='run_released_at') present")).rows[0].present;
 const reuse=releasable?(await db.query<{n:number}>(`SELECT r.run_number n FROM lab_batch r WHERE r.run_year=$1 AND r.run_released_at IS NOT NULL
  AND NOT EXISTS(SELECT 1 FROM lab_batch a WHERE a.run_year=r.run_year AND a.run_number=r.run_number AND a.run_released_at IS NULL) ORDER BY r.run_number LIMIT 1`,[year])).rows[0]?.n:undefined;
 const n=reuse??(await db.query<{v:number}>('INSERT INTO lab_batch_sequence(run_year,last_value) VALUES($1,1) ON CONFLICT(run_year) DO UPDATE SET last_value=lab_batch_sequence.last_value+1 RETURNING last_value v',[year])).rows[0].v;
 const label=formatRunLabel(n,year);
 const b=(await db.query<{id:string}>('INSERT INTO lab_batch(run_year,run_number,run_label,template_version,formula_version,created_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING id',[year,n,label,`${BATCH_TEMPLATE}+${templateVersion}`,formulaVersion,user.id])).rows[0].id;
 for(const s of [1,2,3])await db.query('INSERT INTO lab_task_sheet(batch_id,sheet_number) VALUES($1,$2)',[b,s]);
 for(let slot=1;slot<=48;slot++)await db.query('INSERT INTO lab_batch_slot(batch_id,slot_number,sheet_number,plate_position,barcode_index,control_type) VALUES($1,$2,$3,$4,$2,$5)',[b,slot,getSheetNumber(slot),getPlatePosition(slot),controlTypeOf(slot)]);
 await batchEvent(db,user,b,'BATCH_CREATED',null,null,{runLabel:label});
 await audit(db,user,'LAB_BATCH_CREATED','lab_batch',b,{version:n,...(reuse?{outcome:'RUN_NUMBER_REUSED'}:{})});
 return {batchId:b,runLabel:label,created:true,reused:!!reuse};
}

type SlotView={slot:number;sheet:number;plate:string;barcode:number;control:ControlType|null;controlLabel:string|null;controlCode:string|null;assignment:null|{attemptId:string;caseId:string;roundId:string;roundNumber:number;hisLn:string;hn:string|null;lnHalos:string|null;labelCode:string|null;printedSampleId:string|null;attemptState:string;outcomeStatus:string|null;overallOrdinal:number;attemptNumber:number;exceptional:boolean;repeat:boolean;urgent:boolean;ga:ReturnType<typeof gestationalAge>;labelPrints:number}};
export async function batchDetail(db:Queryable,user:Staff,batchId:string){
 await assertSession(db,user);need(user,'worksheet.read','read');
 const b=(await db.query<Batch&{cancel_reason:string|null}>('SELECT * FROM lab_batch WHERE id=$1 AND NOT EXISTS(SELECT 1 FROM lab_batch_removal WHERE batch_id=lab_batch.id)',[uuid.parse(batchId)])).rows[0];if(!b)throw new LabError('NOT_FOUND',404);
 const sheets=(await db.query<Sheet>(`SELECT ${sheetCols} FROM lab_task_sheet WHERE batch_id=$1 ORDER BY sheet_number`,[b.id])).rows;
 const facts=await attemptFacts(db,'a.id IN (SELECT attempt_id FROM lab_slot_assignment WHERE batch_id=$1 AND removed_at IS NULL)',[b.id]);
 const bySlot=new Map(facts.map(f=>[f.slot_number!,f]));
 const identities=new Map((await db.query<{case_id:string;hn:string}>('SELECT case_id,hn FROM p2_case_identity WHERE case_id=ANY($1::uuid[])',[facts.map(f=>f.case_id)])).rows.map(i=>[i.case_id,i.hn]));
 const urgent40=(await db.query<{enabled:boolean}>('SELECT lab_urgent40_enabled($1) enabled',[b.id])).rows[0].enabled;
 const frozen=(await db.query<{payload:PlacementPayload}>(`SELECT DISTINCT ON(sheet_id) payload FROM lab_placement_snapshot WHERE batch_id=$1 ORDER BY sheet_id,revision DESC`,[b.id])).rows.flatMap(p=>p.payload.slots);
 const slots:SlotView[]=Array.from({length:48},(_,i)=>{const slot=i+1,sheet=getSheetNumber(slot),control=slot===40&&urgent40?null:controlTypeOf(slot),f=bySlot.get(slot),date=sheets[sheet-1].planned_work_date;
  return {slot,sheet,plate:getPlatePosition(slot),barcode:slot,control,controlLabel:control?CONTROL_LABEL[control]:null,controlCode:control?(frozen.find(s=>s.slot===slot)?.printedControlId??(date?formatPrintedControlId(control,date):null)):null,
   assignment:f&&caseVisible(user,f)?{attemptId:f.attempt_id,caseId:f.case_id,roundId:f.round_id,roundNumber:f.round_number,hisLn:f.ln,hn:identities.get(f.case_id)??null,lnHalos:f.ln_halos,labelCode:f.migration_original_ln_halos??(f.ln_halos?specimenDisplayCode(f.ln_halos,f.pregnancy,f.ln_halos_resampling):f.ln_halos),printedSampleId:f.printed_sample_id,attemptState:f.attempt_state,outcomeStatus:f.no_call_selected?'รอรับ PDF No Call':f.overall_ordinal>=4&&f.attempt_state==='QcFailed'?'รอพิจารณาหลังครบ 4 ครั้ง':null,overallOrdinal:f.overall_ordinal,attemptNumber:f.attempt_number,exceptional:f.overall_ordinal>=5,repeat:f.repeat_order_id!==null,urgent:f.urgent,ga:gestationalAge(f),labelPrints:f.label_prints}:null};});
 const documents=(await db.query('SELECT d.id,d.form,d.kind,d.revision,d.doc_code,d.status,d.status_reason,d.file_sha256,d.issued_at,u.display_name issued_by,t.sheet_number,(SELECT count(*) FROM lab_document_copy c WHERE c.document_id=d.id AND c.kind=\'WORKING_COPY\')::int working_copies,(SELECT count(*) FROM lab_document_copy c WHERE c.document_id=d.id AND c.kind=\'WORKING_COPY\' AND c.recalled_at IS NULL)::int unrecalled FROM lab_document d JOIN app_user u ON u.id=d.issued_by LEFT JOIN lab_task_sheet t ON t.id=d.sheet_id WHERE d.batch_id=$1 ORDER BY d.issued_at',[b.id])).rows;
 const events=(await db.query('SELECT e.event_type,e.sheet_number,e.reason,e.created_at,u.display_name actor FROM lab_batch_event e JOIN app_user u ON u.id=e.actor_id WHERE e.batch_id=$1 ORDER BY e.sequence DESC LIMIT 100',[b.id])).rows;
 const snapshots=(await db.query('SELECT s.id,t.sheet_number,s.revision,s.content_hash,s.created_at FROM lab_placement_snapshot s JOIN lab_task_sheet t ON t.id=s.sheet_id WHERE s.batch_id=$1 ORDER BY t.sheet_number,s.revision',[b.id])).rows;
 return {urgent40,batch:{id:b.id,runLabel:b.run_label,state:b.state,version:b.version,templateVersion:b.template_version,formulaVersion:b.formula_version,createdAt:b.created_at,cancelReason:b.cancel_reason},sheets,slots,documents,events,snapshots};
}
const flagOf=z.union([z.boolean(),z.enum(['0','1','true','false'])]).default(false).transform(v=>v===true||v==='1'||v==='true');
const runListInput=z.strictObject({q:z.string().trim().max(40).default(''),open:flagOf,...pageFields(25)});
export type RunListRow={id:string;run_label:string;state:string;version:number;created_at:Date;samples:number;sheet_states:string[]};
/** Runs, newest first (ties by id), one page at a time with an exact total, so every Run ever created stays reachable.
 * `q` matches the Run identifier (RunNNN/ปี) as typed in any part ("16", "Run016", "2026"). `open` returns only Runs whose Task Lists can still be
 * edited - what the "add to Batch" dialog needs - so an old, finished Run can never push an open Draft out of that list. */
export async function listBatchPage(db:Queryable,user:Staff,raw:unknown={}){
 await assertSession(db,user);need(user,'worksheet.read','read');
 const f=runListInput.parse(raw),values:unknown[]=[],where:string[]=['NOT EXISTS(SELECT 1 FROM lab_batch_removal WHERE batch_id=b.id)'];
 if((await db.query<{present:boolean}>("SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='lab_batch' AND column_name='run_released_at') present")).rows[0].present)where.push('b.run_released_at IS NULL');
 if(f.q){values.push(f.q.toLowerCase());where.push(`strpos(lower(b.run_label),$${values.length})>0`);}
 if(f.open)where.push(`b.state<>'Cancelled' AND EXISTS(SELECT 1 FROM lab_task_sheet t WHERE t.batch_id=b.id AND t.state=ANY(ARRAY['${EDITABLE.join("','")}']))`);
 const total=Number((await db.query<{n:string}>(`SELECT count(*)::text n FROM lab_batch b WHERE ${where.join(' AND ')}`,values)).rows[0].n);
 const meta=clampPage(f.page,total,f.pageSize);
 const rows=(await db.query<RunListRow>(`SELECT b.id,b.run_label,b.state,b.version,b.created_at,(SELECT count(*) FROM lab_slot_assignment a WHERE a.batch_id=b.id AND a.removed_at IS NULL)::int samples,
  ARRAY(SELECT t.state FROM lab_task_sheet t WHERE t.batch_id=b.id ORDER BY t.sheet_number) sheet_states FROM lab_batch b WHERE ${where.join(' AND ')} ORDER BY b.created_at DESC,b.id DESC LIMIT ${meta.size} OFFSET ${offsetOf(meta)}`,values)).rows;
 return {rows,page:meta};
}

/** The eligible FIFO queue head and the earlier eligible work a selection would overtake (single source for assign and preview). */
async function eligibleQueue(db:Queryable,user:Staff,policy:Awaited<ReturnType<typeof pendingPolicy>>['policy']){
 return (await attemptFacts(db,"a.state='Ready' AND c.current_round_id=a.round_id AND c.registration_origin<>'HISTORICAL'",[])).filter(r=>caseVisible(user,r)&&assignmentDecision(r,policy).eligible).sort(fifo);
}
async function fifoOvertaken(db:Queryable,user:Staff,attemptIds:string[],policy:Awaited<ReturnType<typeof pendingPolicy>>['policy']){
 const queue=await eligibleQueue(db,user,policy);
 const chosen=new Set(attemptIds),head=queue.slice(0,chosen.size).map(r=>r.attempt_id);
 const overtaken=queue.slice(0,queue.findLastIndex(r=>chosen.has(r.attempt_id))+1).filter(r=>!chosen.has(r.attempt_id));
 // OD-A: when every selected sample that goes ahead is Urgent, its own recorded Urgent reason stands for the override reason.
 const overtakers=queue.filter(r=>chosen.has(r.attempt_id)&&!head.includes(r.attempt_id));
 return {head,overtaken,urgentReasonCovers:overtaken.length>0&&overtakers.length>0&&overtakers.every(r=>r.urgent&&!!r.urgent_reason)};
}
/** Read-only (P0-3): tells the user before submitting whether a selection overtakes FIFO and so needs a recorded reason. */
export async function previewAssignment(db:Queryable,user:Staff,input:unknown){
 await assertSession(db,user);need(user,'batch.assign');
 const d=z.strictObject({attemptIds:z.array(uuid).min(1).max(46).refine(v=>new Set(v).size===v.length,'DUPLICATE_ATTEMPT')}).parse(input);
 const {policy}=await pendingPolicy(db);
 const selected=await attemptFacts(db,'a.id=ANY($1::uuid[])',[d.attemptIds]);
 if(selected.length!==d.attemptIds.length||selected.some(r=>!caseVisible(user,r)))throw new LabError('NOT_FOUND',404);
 const {overtaken,urgentReasonCovers}=await fifoOvertaken(db,user,d.attemptIds,policy);
 return {overtaken:overtaken.length,reasonRequired:overtaken.length>0&&!urgentReasonCovers,urgentReasonReused:urgentReasonCovers};
}
/** Assignment Gate (BG-01..07 + BG-08A/09A) per attempt, in this transaction; FIFO proposal skips control slots. */
export async function assignToBatch(db:Queryable,user:Staff,input:unknown){
 await assertSession(db,user);need(user,'batch.assign');
 const d=z.strictObject({batchId:uuid,expectedVersion:z.number().int().min(0),attemptIds:z.array(uuid).min(1).max(46).refine(v=>new Set(v).size===v.length,'DUPLICATE_ATTEMPT'),queueOverrideReason:reasonText.optional(),targetSlot:z.number().int().min(1).max(48).optional(),sheetNumber:z.number().int().min(1).max(3).optional()}).parse(input);
 const b=await lockBatch(db,d.batchId,d.expectedVersion);
 const {policy}=await pendingPolicy(db);
 // Lock order: attempts by id, then their cases (shared with redraw/receipt via the case row).
 await db.query('SELECT id FROM analytical_attempt WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE',[d.attemptIds]);
 const selected=await attemptFacts(db,'a.id=ANY($1::uuid[])',[d.attemptIds]);
 if(selected.length!==d.attemptIds.length||selected.some(r=>!caseVisible(user,r)))throw new LabError('NOT_FOUND',404);
 // FIFO is a proposal, not a rule — overtaking eligible earlier work needs a recorded reason (§12.9 ขั้น 3–4).
 const {head,overtaken,urgentReasonCovers}=await fifoOvertaken(db,user,d.attemptIds,policy);
 if(overtaken.length&&!d.queueOverrideReason&&!urgentReasonCovers)throw new LabError('QUEUE_OVERRIDE_REASON_REQUIRED',422,{overtaken:overtaken.length});
 // OD-G: the user may choose the destination Task; slot, control and eligibility rules are unchanged.
 if(d.sheetNumber&&!EDITABLE.includes((await sheetOf(db,b.id,d.sheetNumber)).state))throw new LabError('PLACEMENT_LOCKED',409);
 const free=(await db.query<{slot_number:number;sheet_number:number}>(`SELECT s.slot_number,s.sheet_number FROM lab_batch_slot s JOIN lab_task_sheet t ON t.batch_id=s.batch_id AND t.sheet_number=s.sheet_number
  WHERE s.batch_id=$1 AND (s.control_type IS NULL OR s.slot_number=40 AND lab_urgent40_enabled(s.batch_id)) AND t.state IN ('Draft','PlanChecked','Amended') AND (t.placement_revision=0 OR t.state='Amended') AND ($2::int IS NULL OR s.sheet_number=$2) AND NOT EXISTS(SELECT 1 FROM lab_slot_assignment a WHERE a.batch_id=s.batch_id AND a.slot_number=s.slot_number AND a.removed_at IS NULL) ORDER BY s.slot_number`,[b.id,d.sheetNumber??null])).rows;
 if(d.targetSlot&&(!free.some(s=>s.slot_number===d.targetSlot)||d.attemptIds.length!==1))throw new LabError('EXACT_SLOT_UNAVAILABLE',409);
 const placed:{attemptId:string;slot:number;printedSampleId:string}[]=[],rejected:{attemptId:string;failed:string[];pending:string[]}[]=[];
 // Slots are proposed in the order the user saw the selected rows (Receive Date Sorting Owner Lock §2.3), never click order.
 const byId=new Map(selected.map(r=>[r.attempt_id,r]));
 for(const r of d.attemptIds.map(id=>byId.get(id)!)){
  const g=assignmentDecision(r,policy);
  if(!g.eligible){rejected.push({attemptId:r.attempt_id,failed:g.failed,pending:policy==='HOLD'?g.pending:[]});continue;}
  const index=free.findIndex(s=>s.slot_number===40&&r.urgent);const candidate=d.targetSlot?free.findIndex(s=>s.slot_number===d.targetSlot&&(s.slot_number!==40||r.urgent)):index>=0?index:free.findIndex(s=>s.slot_number!==40||r.urgent);const slot=candidate>=0?free.splice(candidate,1)[0]:undefined;if(!slot){rejected.push({attemptId:r.attempt_id,failed:['BATCH_FULL'],pending:[]});continue;}
  const id=candidatePrintedId(r);
  if(!r.printed_sample_id){await db.query('UPDATE analytical_attempt SET printed_sample_id=$2 WHERE id=$1',[r.attempt_id,id.id]);await attemptEvent(db,user,{attemptId:r.attempt_id,caseId:r.case_id,type:'PRINTED_ID_ASSIGNED',details:{printedSampleId:id.id}});}
  await db.query('INSERT INTO lab_slot_assignment(batch_id,slot_number,attempt_id,assigned_by) VALUES($1,$2,$3,$4)',[b.id,slot.slot_number,r.attempt_id,user.id]);
  await setAttemptState(db,user,{id:r.attempt_id,case_id:r.case_id,state:r.attempt_state},'Assigned',{batchId:b.id,slot:slot.slot_number,gateRuleVersion:GATE_RULE_VERSION,syntheticPendingAccepted:g.syntheticPendingAccepted,pending:g.pending});
  if(r.repeat_order_id)await db.query("UPDATE repeat_work_order SET state='RepeatInProgress' WHERE id=$1 AND state='RepeatPendingBatch'",[r.repeat_order_id]);
  if(overtaken.length&&!head.includes(r.attempt_id))await attemptEvent(db,user,{attemptId:r.attempt_id,caseId:r.case_id,type:'QUEUE_OVERRIDE',reason:d.queueOverrideReason??r.urgent_reason??undefined,details:{batchId:b.id,overtaken:overtaken.length,...(d.queueOverrideReason?{}:{reasonSource:'URGENT_REASON'})}});
  await caseEvent(db,user,r.case_id,'LAB_ASSIGNED_TO_BATCH',{runLabel:b.run_label,slot:slot.slot_number});
  placed.push({attemptId:r.attempt_id,slot:slot.slot_number,printedSampleId:id.id!});
 }
 const version=placed.length?await touch(db,b.id,placed.map(p=>getSheetNumber(p.slot))):b.version;
 if(placed.length)await batchEvent(db,user,b.id,'ASSIGNED',null,d.queueOverrideReason??null,{count:placed.length,queueOverride:overtaken.length>0});
 await audit(db,user,'LAB_BATCH_ASSIGN','lab_batch',b.id,{count:placed.length,outcome:rejected.length?'PARTIAL':'ALL_PLACED',version});
 return {placed,rejected,version};
}

/** Exact destination, with deliberate draft-only urgent/repeat displacement. */
export async function assignExact(db:Queryable,user:Staff,input:unknown){
 await assertSession(db,user);need(user,'batch.assign');
 const d=z.strictObject({batchId:uuid,expectedVersion:z.number().int().min(0),attemptId:uuid,slot:z.number().int().min(1).max(48),mode:z.enum(['MANUAL','URGENT','REPEAT']),queueOverrideReason:reasonText.optional()}).parse(input);
 const b=await lockBatch(db,d.batchId,d.expectedVersion),sheet=await sheetOf(db,b.id,getSheetNumber(d.slot));
 if(!placementEditable(sheet))throw new LabError('PLACEMENT_LOCKED',409);
 const urgent40=(await db.query<{enabled:boolean}>('SELECT lab_urgent40_enabled($1) enabled',[b.id])).rows[0].enabled;
 if(controlTypeOf(d.slot)&&!(d.slot===40&&urgent40))throw new LabError('CONTROL_SLOT_PROTECTED',409);
 await db.query('SELECT id FROM analytical_attempt WHERE id=$1 FOR UPDATE',[d.attemptId]);
 const selected=(await attemptFacts(db,'a.id=$1',[d.attemptId]))[0];
 if(!selected||!caseVisible(user,selected))throw new LabError('NOT_FOUND',404);
 const {policy}=await pendingPolicy(db),gate=assignmentDecision(selected,policy);if(!gate.eligible)throw new LabError('ASSIGNMENT_GATE_FAILED',409,{failed:gate.failed,pending:gate.pending});
 if(d.mode==='REPEAT'&&!selected.repeat_order_id&&selected.round_number<2)throw new LabError('REPEAT_ATTEMPT_REQUIRED',422);
 if(d.mode==='URGENT'&&!selected.urgent){if(!d.queueOverrideReason)throw new LabError('URGENT_REASON_REQUIRED',422);await attemptEvent(db,user,{attemptId:selected.attempt_id,caseId:selected.case_id,type:'URGENT_SET',reason:d.queueOverrideReason});await audit(db,user,'LAB_URGENT_SET','analytical_attempt',selected.attempt_id);}
 if(d.slot===40&&d.mode!=='URGENT'&&!selected.urgent)throw new LabError('URGENT_ATTEMPT_REQUIRED',422);
 const occupied=await liveAssignment(db,b.id,d.slot);let expectedVersion=b.version;
 if(occupied){
  if(d.mode==='MANUAL')throw new LabError('EXACT_SLOT_UNAVAILABLE',409);
  if(occupied.state!=='Assigned'||await hasRecordedBenchWorkAtSlot(db,b.id,d.slot))throw new LabError('DISPLACEMENT_ONLY_BEFORE_EXECUTION',409);
  const removed=await removeFromBatch(db,user,{batchId:b.id,expectedVersion,slot:d.slot,reason:d.queueOverrideReason??'TASK1_EXACT_FILL_REPLACEMENT'});expectedVersion=removed.version;
 }
 const result=await assignToBatch(db,user,{batchId:b.id,expectedVersion,attemptIds:[d.attemptId],targetSlot:d.slot,queueOverrideReason:d.queueOverrideReason});
 if(result.rejected.length)throw new LabError('EXACT_SLOT_ASSIGNMENT_FAILED',409,result.rejected);return result;
}

/** G07 read-only: what "เติมตัวอย่างจากคิว" would place into this Task — the eligible FIFO head, up to the Task's empty patient slots (max 15). */
export async function previewFill(db:Queryable,user:Staff,input:unknown){
 await assertSession(db,user);need(user,'batch.assign');
 const d=z.strictObject({batchId:uuid,sheetNumber:z.number().int().min(1).max(3)}).parse(input);
 return fillProposal(db,user,d.batchId,d.sheetNumber);
}
async function fillProposal(db:Queryable,user:Staff,batchId:string,sheetNumber:number){
 const s=await sheetOf(db,batchId,sheetNumber,false);
 if(!placementEditable(s))throw new LabError('PLACEMENT_LOCKED',409);
 const free=(await db.query<{n:number}>(`SELECT count(*)::int n FROM lab_batch_slot s WHERE s.batch_id=$1 AND s.sheet_number=$2 AND (s.control_type IS NULL OR s.slot_number=40 AND lab_urgent40_enabled(s.batch_id))
  AND NOT EXISTS(SELECT 1 FROM lab_slot_assignment a WHERE a.batch_id=s.batch_id AND a.slot_number=s.slot_number AND a.removed_at IS NULL)`,[batchId,sheetNumber])).rows[0].n;
 const {policy}=await pendingPolicy(db),queue=await eligibleQueue(db,user,policy);
 const take=queue.slice(0,Math.min(free,15));
 const identities=new Map((await db.query<{case_id:string;hn:string}>('SELECT case_id,hn FROM p2_case_identity WHERE case_id=ANY($1::uuid[])',[take.map(r=>r.case_id)])).rows.map(i=>[i.case_id,i.hn]));
 return {sheetNumber,freeSlots:free,queueSize:queue.length,candidates:take.map(r=>({attemptId:r.attempt_id,hisLn:r.ln,hn:identities.get(r.case_id)??null,labelCode:r.ln_halos?specimenDisplayCode(r.ln_halos,r.pregnancy,r.ln_halos_resampling):null,printedSampleId:candidatePrintedId(r).id,receivedAt:r.received_at?.toISOString()??null,roundNumber:r.round_number,urgent:r.urgent}))};
}
/** G07 "เติมตัวอย่างจากคิว": places exactly the previewed FIFO head into the chosen Task's empty slots through the normal Assignment Gate.
 * If the queue or the Task changed since the preview, nothing is placed and the user reviews the new proposal. Never triggered by PET receipt. */
export async function fillFromQueue(db:Queryable,user:Staff,input:unknown){
 await assertSession(db,user);need(user,'batch.assign');
 const d=z.strictObject({batchId:uuid,expectedVersion:z.number().int().min(0),sheetNumber:z.number().int().min(1).max(3),attemptIds:z.array(uuid).min(1).max(15).refine(v=>new Set(v).size===v.length,'DUPLICATE_ATTEMPT')}).parse(input);
 const b=await lockBatch(db,d.batchId,d.expectedVersion);await sheetOf(db,b.id,d.sheetNumber);
 const now=await fillProposal(db,user,b.id,d.sheetNumber);
 if(now.candidates.map(c=>c.attemptId).join()!==d.attemptIds.join())throw new LabError('FILL_PROPOSAL_CHANGED',409,{proposal:now});
 const r=await assignToBatch(db,user,{batchId:b.id,expectedVersion:d.expectedVersion,attemptIds:d.attemptIds,sheetNumber:d.sheetNumber});
 await batchEvent(db,user,b.id,'FIFO_FILL',d.sheetNumber,null,{count:r.placed.length});
 return r;
}
async function liveAssignment(db:Queryable,batchId:string,slot:number){
 return (await db.query<{id:string;attempt_id:string;case_id:string;state:string;repeat_order_id:string|null}>('SELECT s.id,s.attempt_id,a.case_id,a.state,a.repeat_order_id FROM lab_slot_assignment s JOIN analytical_attempt a ON a.id=s.attempt_id WHERE s.batch_id=$1 AND s.slot_number=$2 AND s.removed_at IS NULL FOR UPDATE OF s,a',[batchId,slot])).rows[0];
}
/** Move into an empty patient slot, or swap two placed attempts — Draft only; controls can never be moved or covered. */
export async function moveSlot(db:Queryable,user:Staff,input:unknown){
 await assertSession(db,user);need(user,'batch.draft');
 const d=z.strictObject({batchId:uuid,expectedVersion:z.number().int().min(0),fromSlot:z.number().int().min(1).max(48),toSlot:z.number().int().min(1).max(48),reason:reasonText.optional()}).refine(v=>v.fromSlot!==v.toSlot,'SAME_SLOT').parse(input);
 const b=await lockBatch(db,d.batchId,d.expectedVersion);
 const urgent40=(await db.query<{enabled:boolean}>('SELECT lab_urgent40_enabled($1) enabled',[b.id])).rows[0].enabled;
 if([d.fromSlot,d.toSlot].some(slot=>!!controlTypeOf(slot)&&!(slot===40&&urgent40)))throw new LabError('CONTROL_SLOT_PROTECTED',409);
 const sheets=[getSheetNumber(d.fromSlot),getSheetNumber(d.toSlot)];
 for(const n of sheets){const s=await sheetOf(db,b.id,n);if(!placementEditable(s))throw new LabError('PLACEMENT_LOCKED',409);if(s.state==='PlanChecked'&&!d.reason)throw new LabError('REASON_REQUIRED_AFTER_PLAN_CHECK',422);}
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
 if(!placementEditable(s))throw new LabError('PLACEMENT_LOCKED',409);if((s.state!=='Draft'||s.placement_revision>0)&&!d.reason)throw new LabError('REASON_REQUIRED_AFTER_PLAN_CHECK',422);
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
 const b=await lockBatch(db,d.batchId,d.expectedVersion);const s=await sheetOf(db,b.id,d.sheetNumber);if(s.state==='Cancelled')throw new LabError('PLACEMENT_LOCKED',409);
 await db.query('UPDATE lab_task_sheet SET planned_work_date=$2,planned_operator=$3,planned_extraction_lot=$4,planned_extraction_expiry=$5,planned_library_lot=$6,planned_library_expiry=$7 WHERE id=$1',[s.id,d.plannedWorkDate,d.plannedOperator,d.plannedExtractionLot,d.plannedExtractionExpiry,d.plannedLibraryLot,d.plannedLibraryExpiry]);
 const version=s.placement_revision>0?(await db.query<{version:number}>('UPDATE lab_batch SET version=version+1 WHERE id=$1 RETURNING version',[b.id])).rows[0].version:await touch(db,b.id,[d.sheetNumber]);
 await batchEvent(db,user,b.id,'PLAN_DATA_UPDATED',d.sheetNumber,null,{before:{workDate:s.planned_work_date,operator:s.planned_operator,extractionLot:s.planned_extraction_lot,extractionExpiry:s.planned_extraction_expiry,libraryLot:s.planned_library_lot,libraryExpiry:s.planned_library_expiry},after:{workDate:d.plannedWorkDate,operator:d.plannedOperator,extractionLot:d.plannedExtractionLot,extractionExpiry:d.plannedExtractionExpiry,libraryLot:d.plannedLibraryLot,libraryExpiry:d.plannedLibraryExpiry},placementUnchanged:s.placement_revision>0});
 await audit(db,user,'LAB_TASK_METADATA_UPDATED','lab_task_sheet',s.id,{version});
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
 const lo=(d.sheetNumber-1)*16+1,urgent40=(await db.query<{enabled:boolean}>('SELECT lab_urgent40_enabled($1) enabled',[b.id])).rows[0].enabled;
 const payload={synthetic:true,batchId:b.id,runLabel:b.run_label,sheetNumber:d.sheetNumber,placementRevision:revision,templateVersion:b.template_version,formulaVersion:b.formula_version,
  plan:{workDate:date,operator:s.planned_operator,extractionLot:s.planned_extraction_lot,extractionExpiry:s.planned_extraction_expiry,libraryLot:s.planned_library_lot,libraryExpiry:s.planned_library_expiry},
  planCheck:{by:users.get(s.plan_checked_by!)??null,at:s.plan_checked_at?.toISOString()??null},finalizedBy:users.get(user.id),gate:{ruleVersion:GATE_RULE_VERSION,policy,pendingAccepted:[...new Set(results.flatMap(x=>x.g.syntheticPendingAccepted?x.g.pending:[]))]},
  slots:Array.from({length:16},(_,i)=>{const slot=lo+i,control=slot===40&&urgent40?null:controlTypeOf(slot),x=bySlot.get(slot);
   return {slot,plate:getPlatePosition(slot),barcode:slot,control,controlCode:control?formatControlCode(control,date):null,printedControlId:control?formatPrintedControlId(control,date):null,
    attemptId:x?.f.attempt_id??null,caseId:x?.f.case_id??null,roundId:x?.f.round_id??null,roundNumber:x?.f.round_number??null,lnHalos:x&&x.f.ln_halos&&x.f.pregnancy?effectiveLnHalos(x.f.ln_halos,x.f.pregnancy):null,printedSampleId:x?.f.printed_sample_id??null,overallOrdinal:x?.f.overall_ordinal??null,exceptional:(x?.f.overall_ordinal??0)>=5,repeat:x?x.f.repeat_order_id!==null:false};})};
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
 planCheck:{by:string|null;at:string|null};finalizedBy:string;gate:{ruleVersion:string;policy:string;pendingAccepted:string[]};slots:{slot:number;plate:string;barcode:number;control:ControlType|null;controlCode:string|null;printedControlId:string|null;attemptId:string|null;caseId:string|null;roundId:string|null;roundNumber:number|null;lnHalos:string|null;printedSampleId:string|null;overallOrdinal?:number|null;exceptional?:boolean;repeat:boolean}[]};
export async function latestSnapshot(db:Queryable,sheetId:string){
 const r=(await db.query<{id:string;revision:number;payload:PlacementPayload;content_hash:string}>('SELECT id,revision,payload,content_hash FROM lab_placement_snapshot WHERE sheet_id=$1 ORDER BY revision DESC LIMIT 1',[sheetId])).rows[0];
 if(!r)throw new LabError('PLACEMENT_SNAPSHOT_REQUIRED',409);return r;
}

/** Controlled amendment before physical execution (§12.9, §12.22): Stop-use + recall; snapshots and PDFs are never edited. */
async function hasRecordedBenchWork(db:Queryable,batchId:string){
 const schema=(await db.query<{present:boolean}>("SELECT to_regclass('public.task_workbook_revision') IS NOT NULL present")).rows[0].present;
 if(!schema)return false;
 return (await db.query<{recorded:boolean}>(`SELECT EXISTS(SELECT 1 FROM task_workbook_revision r CROSS JOIN LATERAL jsonb_each(r.values) e WHERE r.batch_id=$1 AND jsonb_typeof(e.value)='number' AND e.key ~ '^(slot\\.[0-9]+\\.libraryQc|qc\\.[123]\\.(standard1|standard2|standard2Concentration)|pool\\.(concentration|standard1|standard2|standard2Concentration|dilutionC1)|seq\\.(standard1|standard2|standard2Concentration|dnbConcentration|dilutedConcentration|driveMemoryTb|negativePressureKpa|loadedDnb|q30|bic|fit))$') recorded`,[batchId])).rows[0].recorded;
}
/** Exact-slot replacement only inspects evidence attributable to the occupied target slot. Measurements in another Task of this Batch
 * cannot make an otherwise editable target Task look executed; finalized/started Task state and the target slot's own recorded values remain protected. */
async function hasRecordedBenchWorkAtSlot(db:Queryable,batchId:string,slot:number){
 const schema=(await db.query<{present:boolean}>("SELECT to_regclass('public.task_workbook_revision') IS NOT NULL present")).rows[0].present;
 if(!schema)return false;
 const keyPrefix=`slot.${slot}.`;
 return (await db.query<{recorded:boolean}>(`SELECT EXISTS(SELECT 1 FROM task_workbook_revision r CROSS JOIN LATERAL jsonb_each(r.values) e
  WHERE r.batch_id=$1 AND ((e.key IN ($2,$3) AND jsonb_typeof(e.value)='number') OR (e.key=$4 AND e.value='"✓"'::jsonb))) recorded`,
 [batchId,`${keyPrefix}libraryQc`,`${keyPrefix}extractionQc`,`${keyPrefix}transferChecked`])).rows[0].recorded;
}
export async function amendSheet(db:Queryable,user:Staff,input:unknown){
 await assertSession(db,user);need(user,'batch.amend');
 const d=z.strictObject({batchId:uuid,expectedVersion:z.number().int().min(0),sheetNumber:z.number().int().min(1).max(3),reason:reasonText}).parse(input);
 const b=await lockBatch(db,d.batchId,d.expectedVersion);const s=await sheetOf(db,b.id,d.sheetNumber);
 if(s.placement_revision>0)throw new LabError('PLACEMENT_LOCKED',409);
 if(await hasRecordedBenchWork(db,b.id))throw new LabError('AMEND_ONLY_BEFORE_EXECUTION',409);
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
 if(await hasRecordedBenchWork(db,b.id))throw new LabError('CANCEL_ONLY_BEFORE_EXECUTION',409);
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

/** Owner LAB-06: hide an empty draft while retaining Run allocation, controls, audit and all historical evidence. */
export async function deleteEmptyDraft(db:Queryable,user:Staff,input:unknown){
 await assertSession(db,user);if(!user.roles.some(r=>['LAB_STAFF','LAB_CERTIFIER','APP_ADMIN'].includes(r)))throw new LabError('FORBIDDEN',403);
 const d=z.strictObject({batchId:uuid,expectedVersion:z.number().int().min(0)}).parse(input),b=await lockBatch(db,d.batchId,d.expectedVersion);
 try{await db.query('INSERT INTO lab_batch_removal(batch_id,actor_id) VALUES($1,$2)',[b.id,user.id]);}catch(e){if(e instanceof Error&&e.message.includes('ONLY_EMPTY_DRAFT_BATCH_CAN_BE_REMOVED'))throw new LabError('ONLY_EMPTY_DRAFT_BATCH_CAN_BE_REMOVED',409);throw e;}
 await db.query("UPDATE lab_task_sheet SET state='Cancelled' WHERE batch_id=$1",[b.id]);
 await db.query("UPDATE lab_batch SET state='Cancelled',cancelled_by=$2,cancelled_at=now(),cancel_reason='EMPTY_DRAFT_REMOVED',version=version+1 WHERE id=$1",[b.id,user.id]);
 await batchEvent(db,user,b.id,'EMPTY_DRAFT_REMOVED',null,null);await audit(db,user,'LAB_EMPTY_DRAFT_REMOVED','lab_batch',b.id);return {removed:true};
}
export async function setUrgentSlot40(db:Queryable,user:Staff,input:unknown){
 await assertSession(db,user);need(user,'batch.draft');
 const d=z.strictObject({batchId:uuid,expectedVersion:z.number().int().min(0),enabled:z.boolean()}).parse(input),b=await lockBatch(db,d.batchId,d.expectedVersion);
 const s=await sheetOf(db,b.id,3);if(!EDITABLE.includes(s.state)||s.placement_revision)throw new LabError('SLOT40_MODE_LOCKED',409);
 if(await liveAssignment(db,b.id,40))throw new LabError('SLOT40_MODE_LOCKED',409);
 await db.query('INSERT INTO lab_slot40_mode(batch_id,enabled,actor_id) VALUES($1,$2,$3)',[b.id,d.enabled,user.id]);
 const version=await touch(db,b.id,[3]);await batchEvent(db,user,b.id,'SLOT40_MODE_CHANGED',3,null,{urgentPatient:d.enabled});return {version};
}

/** OWNER-LAB-031: plan check and placement lock happen when the Task List is printed, not as separate operator steps.
 *  The Finalize Gate is unchanged; a printed sheet that was not changed prints the same revision again. */
export async function printTaskList(db:Queryable,user:Staff,input:unknown){
 await assertSession(db,user);need(user,'batch.finalize');
 const d=z.strictObject({batchId:uuid,expectedVersion:z.number().int().min(0),sheetNumber:z.number().int().min(1).max(3)}).parse(input);
 const b=await lockBatch(db,d.batchId,d.expectedVersion);const s=await sheetOf(db,b.id,d.sheetNumber);
 if(!EDITABLE.includes(s.state))return {version:b.version,revision:s.placement_revision,finalizedNow:false};
 let version=b.version;
 if(s.state!=='PlanChecked')version=(await planCheck(db,user,{batchId:b.id,expectedVersion:version,sheetNumber:d.sheetNumber,confirm:{controlsAtTemplate:true,identifiersMatch:true,noDuplicates:true}})).version;
 const r=await finalizeSheet(db,user,{batchId:b.id,expectedVersion:version,sheetNumber:d.sheetNumber});
 return {version:r.version,revision:r.revision,finalizedNow:true,previousRevision:s.placement_revision||null};
}
/** OWNER-LAB-031: edit a printed sheet before any bench work is recorded. The printed revision becomes obsolete when the
 *  sheet is printed again (a new immutable snapshot); earlier snapshots and events are never changed. */
export async function reopenPlacement(db:Queryable,user:Staff,input:unknown){
 await assertSession(db,user);need(user,'batch.draft');
 const d=z.strictObject({batchId:uuid,expectedVersion:z.number().int().min(0),sheetNumber:z.number().int().min(1).max(3)}).parse(input);
 const b=await lockBatch(db,d.batchId,d.expectedVersion);const s=await sheetOf(db,b.id,d.sheetNumber);
 if(s.state!=='PlacementFinalized')throw new LabError('REOPEN_ONLY_PRINTED_SHEET',409);
 if(await hasRecordedBenchWork(db,b.id))throw new LabError('REOPEN_ONLY_BEFORE_BENCH_WORK',409);
 await db.query("UPDATE lab_task_sheet SET state='Amended',plan_checked_by=NULL,plan_checked_at=NULL,plan_checked_version=NULL,placement_version=placement_version+1 WHERE id=$1",[s.id]);
 const version=(await db.query<{version:number}>('UPDATE lab_batch SET version=version+1 WHERE id=$1 RETURNING version',[b.id])).rows[0].version;
 await batchEvent(db,user,b.id,'PLACEMENT_REOPENED',d.sheetNumber,null,{revision:s.placement_revision});
 await audit(db,user,'LAB_PLACEMENT_REOPENED','lab_batch',b.id,{version:s.placement_revision});
 return {version,obsoleteRevision:s.placement_revision};
}
/** OWNER-LAB-030 single trash action. Unused (never printed, no evidence): one confirmation, no reason, samples return to
 *  the queue and the Run number is given back. Otherwise the existing reasoned cancellation keeps the number and history. */
export async function trashBatch(db:Queryable,user:Staff,input:unknown){
 await assertSession(db,user);
 const d=z.strictObject({batchId:uuid,expectedVersion:z.number().int().min(0),reason:z.string().trim().max(500).optional()}).parse(input);
 const b=await lockBatch(db,d.batchId,d.expectedVersion);
 if(b.state==='Cancelled')throw new LabError('BATCH_ALREADY_CANCELLED',409);
 const unused=(await db.query<{unused:boolean}>(`SELECT NOT(EXISTS(SELECT 1 FROM lab_task_sheet WHERE batch_id=$1 AND placement_revision>0)
  OR EXISTS(SELECT 1 FROM lab_placement_snapshot WHERE batch_id=$1) OR EXISTS(SELECT 1 FROM lab_document WHERE batch_id=$1) OR EXISTS(SELECT 1 FROM lab_observation WHERE batch_id=$1)
  OR EXISTS(SELECT 1 FROM task_workbook_revision WHERE batch_id=$1) OR EXISTS(SELECT 1 FROM p4b_pool_attempt WHERE batch_id=$1) OR EXISTS(SELECT 1 FROM p4c_dnb_attempt WHERE batch_id=$1)
  OR EXISTS(SELECT 1 FROM lab_actual_pooling WHERE batch_id=$1) OR EXISTS(SELECT 1 FROM lab_bench_export WHERE batch_id=$1) OR EXISTS(SELECT 1 FROM lab_seq_export_pair WHERE batch_id=$1)) unused`,[b.id])).rows[0].unused;
 if(!unused){
  if(!d.reason||d.reason.length<8)throw new LabError('REASON_REQUIRED_FOR_USED_BATCH',422);
  return {...await cancelBatch(db,user,{batchId:b.id,expectedVersion:d.expectedVersion,reason:d.reason}),runReleased:false};
 }
 const r=await cancelBatch(db,user,{batchId:b.id,expectedVersion:d.expectedVersion,reason:'ยกเลิก Batch ที่ยังไม่ได้ใช้งาน (คืนเลข Run)'});
 await db.query('UPDATE lab_batch SET run_released_at=now(),run_released_by=$2 WHERE id=$1',[b.id,user.id]);
 await batchEvent(db,user,b.id,'RUN_NUMBER_RELEASED',null,null,{runLabel:b.run_label});
 await audit(db,user,'LAB_RUN_NUMBER_RELEASED','lab_batch',b.id,{count:r.released});
 return {...r,runReleased:true,runLabel:b.run_label};
}
