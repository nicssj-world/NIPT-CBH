import {z} from 'zod';
import {createHash} from 'node:crypto';
import type {Queryable} from '../db/connection';
import {lockLn} from '../db/registration';
import {buildTubeLabelsHtml} from './labels';
import {specimenDisplayCode} from './rules';
import {LabError,uuid,reasonText,need,assertSession,audit,caseEvent,attemptEvent,setAttemptState,attemptFacts,candidatePrintedId,caseVisible,bangkokToday,
 REDRAW_REASONS,REPEAT_REASONS,REPEAT_LEVELS,type Staff} from './core';
import {isoDate} from '../domain/thai-date';

// The F1 queue read (rows, categories, paging) lives in ./worklist; re-exported so existing imports keep working.
export {labWorklist,labWorklistPage,worklistRow,WORKLIST_TABS,READY_SCAN_LIMIT} from './worklist';
export type {QueueCategory,WorklistAttempt,WorklistPage,WorklistTab} from './worklist';

export async function acceptSpecimen(db:Queryable,user:Staff,input:unknown){
 await assertSession(db,user);const d=z.strictObject({roundId:uuid,identityChecked:z.literal(true),labelChecked:z.literal(true),condition:z.enum(['ACCEPTABLE','REJECTED']),criteriaReference:reasonText,reason:reasonText}).parse(input);
 const r=await lockedRound(db,user,d.roundId);need(user,'round.receive','write',{unitId:r.unit_id??undefined,origin:r.registration_origin as 'ANC'});
 if(process.env.NIPT_MODE!=='operational')throw new LabError('OPERATIONAL_MODE_REQUIRED',409);
 const id=(await db.query<{id:string}>('INSERT INTO specimen_acceptance(round_id,identity_checked,label_checked,condition,criteria_reference,reason,actor_id) VALUES($1,true,true,$2,$3,$4,$5) RETURNING id',[r.id,d.condition,d.criteriaReference,d.reason,user.id])).rows[0].id;
 await audit(db,user,'SPECIMEN_ACCEPTANCE_RECORDED','specimen_acceptance',id,{outcome:d.condition});return {id,condition:d.condition};
}

/** F1 queues (Plan §12.9 "คิวในหน้าจอ Lab"). S1 enters from the matched HIS PET receipt only; there is no second S1 receipt here. */
async function lockedRound(db:Queryable,user:Staff,roundId:string){
 const r=(await db.query<{id:string;case_id:string;round_number:number;state:string;received_at:Date|null;collection_date:string|null;case_ln_id:string;ln:string;current_round_id:string;registration_origin:string;unit_id:string|null;redraw_request_id:string|null}>(
  `SELECT r.id,r.case_id,r.round_number,r.state,r.received_at,r.collection_date::text,r.case_ln_id,l.ln,c.current_round_id,c.registration_origin,(SELECT s.unit_id FROM case_unit_scope s WHERE s.case_id=c.id ORDER BY s.unit_id LIMIT 1) unit_id,r.redraw_request_id
   FROM specimen_round r JOIN nipt_case c ON c.id=r.case_id JOIN case_ln l ON l.id=r.case_ln_id WHERE r.id=$1`,[uuid.parse(roundId)])).rows[0];
 if(!r||!caseVisible(user,r))throw new LabError('NOT_FOUND',404);
 await lockLn(db,r.ln);await db.query('SELECT id FROM nipt_case WHERE id=$1 FOR UPDATE',[r.case_id]);
 return (await db.query<typeof r>(`SELECT r.id,r.case_id,r.round_number,r.state,r.received_at,r.collection_date::text,r.case_ln_id,$2::text ln,c.current_round_id,c.registration_origin,$3::uuid unit_id,r.redraw_request_id FROM specimen_round r JOIN nipt_case c ON c.id=r.case_id WHERE r.id=$1 FOR UPDATE OF r`,[r.id,r.ln,r.unit_id])).rows[0];
}
const lnHalosOf=async(db:Queryable,roundId:string)=>(await db.query<{ln_halos:string}>('SELECT ln_halos FROM specimen_lab_number WHERE round_id=$1',[roundId])).rows[0]?.ln_halos??null;

/**
 * S2+ physical receipt in NIPT (LD-04, §4.2 R4, §12.6.2 ข้อ 3). The receipt update fires the LN Halos issuer in the same transaction.
 * A repeated or retried call for an already-received round returns the existing number (duplicate=true) and never issues another.
 */
export async function receiveRedraw(db:Queryable,user:Staff,input:unknown){
 await assertSession(db,user);
 const d=z.strictObject({roundId:uuid,identityChecked:z.literal(true),labelChecked:z.literal(true),condition:z.enum(['ACCEPTABLE','PROBLEM_NOTED']),conditionNote:reasonText.optional(),collectionDate:isoDate}).refine(v=>v.condition==='ACCEPTABLE'||v.conditionNote!==undefined,{path:['conditionNote'],message:'NOTE_REQUIRED'}).parse(input);
 const r=await lockedRound(db,user,d.roundId);need(user,'round.receive','write',{unitId:r.unit_id??undefined,origin:r.registration_origin as 'ANC'});
 if(r.round_number<2)throw new LabError('S1_RECEIVED_IN_HIS_ONLY',409);
 if(r.received_at){const code=await lnHalosOf(db,r.id);await audit(db,user,'LAB_S2_RECEIPT_DUPLICATE','specimen_round',r.id,{outcome:'DUPLICATE'});return {duplicate:true,lnHalos:code,roundNumber:r.round_number};}
 if(process.env.NIPT_MODE==='operational'||r.round_number>=3)throw new LabError('REDRAW_REQUIRES_NEW_HIS_PET',409);
 if(r.state!=='Expected'||r.current_round_id!==r.id)throw new LabError('ROUND_NOT_EXPECTED',409);
 if(d.collectionDate>bangkokToday())throw new LabError('COLLECTION_DATE_FUTURE',422);
 const previous=(await db.query<{d:string|null}>('SELECT max(collection_date)::text d FROM specimen_round WHERE case_id=$1 AND round_number<$2',[r.case_id,r.round_number])).rows[0]?.d;
 if(previous&&d.collectionDate<previous)throw new LabError('COLLECTION_DATE_BEFORE_PREVIOUS_ROUND',422);
 const check={identity:true,label:true,condition:d.condition,...(d.conditionNote?{conditionNote:d.conditionNote}:{}),acceptancePolicy:'OD01_PENDING'};
 await db.query("UPDATE specimen_round SET state='ReceivedInNIPT',received_source='NIPT_LOCAL_RECEIPT',received_at=now(),received_by=$2,receipt_check=$3,collection_date=$4 WHERE id=$1",[r.id,user.id,JSON.stringify(check),d.collectionDate]);
 if(r.redraw_request_id)await db.query("UPDATE redraw_request SET state='Completed',closed_by=$2,closed_at=now(),close_reason='RECEIVED_IN_NIPT' WHERE id=$1 AND state='Requested'",[r.redraw_request_id,user.id]);
 const code=await lnHalosOf(db,r.id);if(!code)throw new LabError('LN_HALOS_NOT_ISSUED',500);
 await caseEvent(db,user,r.case_id,'NIPT_LOCAL_RECEIPT',{roundNumber:r.round_number,condition:d.condition});
 await audit(db,user,'LAB_S2_RECEIVED','specimen_round',r.id,{outcome:'LN_HALOS_ISSUED',count:r.round_number});
 return {duplicate:false,lnHalos:code,roundNumber:r.round_number};
}

/** Rounds received before migration 010 have no LN Halos; the same receipt-bound issuer is invoked once, audited, never at registration. */
export async function recoverLnHalos(db:Queryable,user:Staff,input:unknown){
 await assertSession(db,user);const d=z.strictObject({roundId:uuid,reason:reasonText}).parse(input);
 const r=await lockedRound(db,user,d.roundId);need(user,'round.receive','write',{unitId:r.unit_id??undefined,origin:r.registration_origin as 'ANC'});
 if(!r.received_at)throw new LabError('LN_HALOS_REQUIRES_RECEIPT',409);
 const before=await lnHalosOf(db,r.id);
 const code=(await db.query<{c:string}>("SELECT p4_ensure_ln_halos($1,'RECEIPT_RECOVERY') c",[r.id])).rows[0].c;
 if(!before){await caseEvent(db,user,r.case_id,'LN_HALOS_RECOVERED',{roundNumber:r.round_number,reason:d.reason});await audit(db,user,'LAB_LN_HALOS_RECOVERED','specimen_round',r.id,{outcome:'ISSUED'});}
 return {lnHalos:code,duplicate:before!==null};
}

async function lockedAttempt(db:Queryable,user:Staff,attemptId:string){
 const rows=await attemptFacts(db,'a.id=$1',[uuid.parse(attemptId)]);const r=rows[0];
 if(!r||!caseVisible(user,r))throw new LabError('NOT_FOUND',404);
 await lockLn(db,r.ln);await db.query('SELECT id FROM nipt_case WHERE id=$1 FOR UPDATE',[r.case_id]);await db.query('SELECT id FROM analytical_attempt WHERE id=$1 FOR UPDATE',[r.attempt_id]);
 return (await attemptFacts(db,'a.id=$1',[r.attempt_id]))[0];
}

/** Deliberate operator failure disposition; values alone never create a failure. */
export async function confirmFailure(db:Queryable,user:Staff,input:unknown){
 await assertSession(db,user);
 const d=z.strictObject({attemptId:uuid,stage:z.enum(['QC1','QC2','QC3','QC4','SEQUENCING']),confirmed:z.literal(true),note:reasonText}).parse(input);
 const a=await lockedAttempt(db,user,d.attemptId);need(user,'qc.record');
 if(a.no_call_selected||a.current_round_id!==a.round_id||!a.previously_finalized||!a.slot_batch_id||!['Assigned','InProgress'].includes(a.attempt_state))throw new LabError('FAILURE_REQUIRES_LOCKED_EXECUTED_ATTEMPT',409);
 const revision=(await db.query<{id:string;source_sha256:string;values:Record<string,unknown>}>('SELECT id,source_sha256,values FROM task_workbook_revision WHERE batch_id=$1 ORDER BY revision DESC LIMIT 1',[a.slot_batch_id])).rows[0];
 const values=revision?.values??{};
 const keys=d.stage==='QC1'?[`slot.${a.slot_number}.libraryQc`]:d.stage==='QC2'?['pool.concentration']:d.stage==='QC3'?['seq.dnbConcentration']:d.stage==='QC4'?['seq.q30','seq.loadedDnb','seq.bic','seq.fit']:['seq.date','seq.operator'];
 const present=(k:string)=>values[k]!==undefined&&values[k]!==null&&values[k]!=='';
 if(!revision||!(d.stage==='QC4'?keys.some(present):keys.every(present)))throw new LabError('FAILED_STAGE_EVIDENCE_REQUIRED',409);
 if(a.attempt_state==='Assigned')await setAttemptState(db,user,{id:a.attempt_id,case_id:a.case_id,state:'Assigned'},'InProgress',{batchId:a.slot_batch_id,revisionId:revision.id});
 await setAttemptState(db,user,{id:a.attempt_id,case_id:a.case_id,state:'InProgress'},'QcFailed',{stage:d.stage,reason:d.note,revisionId:revision.id},{qcFailedStage:d.stage});
 await attemptEvent(db,user,{attemptId:a.attempt_id,caseId:a.case_id,type:'FAILURE_CONFIRMED',stage:d.stage,reason:d.note,details:{batchId:a.slot_batch_id,slot:a.slot_number,roundId:a.round_id,revisionId:revision.id,sourceSha256:revision.source_sha256}});
 await audit(db,user,'LAB_FAILURE_CONFIRMED','analytical_attempt',a.attempt_id,{outcome:d.stage});
 return {attemptId:a.attempt_id,status:a.overall_ordinal>=4?'รอพิจารณาหลังครบ 4 ครั้ง':'QcFailed'};
}

/** No clinical PDF, QC acceptance, release or outbound job is produced here. */
export async function noCall(db:Queryable,user:Staff,input:unknown){
 await assertSession(db,user);const d=z.strictObject({attemptId:uuid,note:reasonText.optional()}).parse(input);
 const a=await lockedAttempt(db,user,d.attemptId);need(user,'attempt.noCall');
 const latest=(await db.query<{id:string}>('SELECT id FROM analytical_attempt WHERE case_id=$1 ORDER BY overall_ordinal DESC LIMIT 1',[a.case_id])).rows[0];
 if(a.current_round_id!==a.round_id||latest?.id!==a.attempt_id||a.overall_ordinal<4||a.attempt_state!=='QcFailed')throw new LabError('NO_CALL_REQUIRES_CONFIRMED_FAILURE_AFTER_FOUR',409);
 if(!a.no_call_selected){
  await attemptEvent(db,user,{attemptId:a.attempt_id,caseId:a.case_id,type:'NO_CALL_SELECTED',reason:d.note??'OWNER_TASK1_NO_CALL_SELECTED',details:{roundId:a.round_id,overallOrdinal:a.overall_ordinal}});
  await caseEvent(db,user,a.case_id,'LAB_NO_CALL_AWAITING_EXTERNAL_PDF',{attemptId:a.attempt_id,roundId:a.round_id});
  await audit(db,user,'LAB_NO_CALL_SELECTED','analytical_attempt',a.attempt_id,{outcome:'AWAITING_EXTERNAL_PDF'});
 }
 return {attemptId:a.attempt_id,status:'รอรับ PDF No Call'};
}

/** Repeat (LD-06, §4.3, §12.6.1): same specimen round; a child attempt with lineage, no new specimen, no HIS action. */
export async function orderRepeat(db:Queryable,user:Staff,input:unknown){
 await assertSession(db,user);const d=z.strictObject({attemptId:uuid,level:z.enum(REPEAT_LEVELS),reasonCode:z.enum(REPEAT_REASONS),note:reasonText}).parse(input);
 const a=await lockedAttempt(db,user,d.attemptId);need(user,'repeat.order','write',{unitId:a.unit_id??undefined,origin:a.registration_origin});
 if(a.no_call_selected)throw new LabError('NO_CALL_AWAITING_EXTERNAL_PDF',409);
 if(!['QcFailed','Stopped','BatchCancelled'].includes(a.attempt_state))throw new LabError('REPEAT_REQUIRES_FAILED_OR_STOPPED_ATTEMPT',409);
 if(a.overall_ordinal===4&&a.attempt_state!=='QcFailed')throw new LabError('FOURTH_ATTEMPT_FAILURE_NOT_CONFIRMED',409);
 if(a.round_number===1&&a.attempt_number>=2)throw new LabError('RESAMPLING_REQUIRED_AFTER_S1_REPEAT',409);
 if(a.current_round_id!==a.round_id||!['ReceivedInHIS','ReceivedInNIPT'].includes(a.round_state))throw new LabError('REPEAT_REQUIRES_CURRENT_RECEIVED_ROUND',409);
 if(a.repeat_order_id&&a.repeat_state==='RepeatInProgress')await db.query("UPDATE repeat_work_order SET state='RepeatFailed',closed_by=$2,closed_at=now(),close_reason=$3 WHERE id=$1",[a.repeat_order_id,user.id,'CHILD_'+a.attempt_state.toUpperCase()]);
 const order=(await db.query<{id:string}>("INSERT INTO repeat_work_order(case_id,round_id,reason_code,state,parent_attempt_id,level,note,requested_by) VALUES($1,$2,$3,'RepeatPendingBatch',$4,$5,$6,$7) RETURNING id",[a.case_id,a.round_id,d.reasonCode,a.attempt_id,d.level,d.note,user.id])).rows[0].id;
 const n=(await db.query<{n:number}>('SELECT max(attempt_number)+1 n FROM analytical_attempt WHERE round_id=$1',[a.round_id])).rows[0].n;
 const child=(await db.query<{id:string}>("INSERT INTO analytical_attempt(case_id,round_id,attempt_number,repeat_order_id,state) VALUES($1,$2,$3,$4,'Ready') RETURNING id",[a.case_id,a.round_id,n,order])).rows[0].id;
 await setAttemptState(db,user,{id:a.attempt_id,case_id:a.case_id,state:a.attempt_state},'Superseded',{repeatOrderId:order,childAttemptId:child});
 await attemptEvent(db,user,{attemptId:child,caseId:a.case_id,type:'REPEAT_ORDERED',reason:d.note,details:{parentAttemptId:a.attempt_id,level:d.level,reasonCode:d.reasonCode}});
 await caseEvent(db,user,a.case_id,'LAB_REPEAT_ORDERED',{roundNumber:a.round_number,level:d.level,reasonCode:d.reasonCode,attemptNumber:n});
 await audit(db,user,'LAB_REPEAT_ORDERED','repeat_work_order',order,{reasonCode:d.reasonCode,outcome:d.level});
 const fresh=(await attemptFacts(db,'a.id=$1',[child]))[0];
 return {repeatOrderId:order,attemptId:child,attemptNumber:n,printedSampleId:candidatePrintedId(fresh).id,printedIdStatus:candidatePrintedId(fresh).status};
}

/** Redraw (LD-01..05, §4.2 R1): new specimen round under the same case and HIS LN; nothing is written to HIS. */
export async function orderRedraw(db:Queryable,user:Staff,input:unknown){
 await assertSession(db,user);const d=z.strictObject({caseId:uuid,reasonCode:z.enum(REDRAW_REASONS),note:reasonText}).parse(input);
 const head=(await db.query<{current_round_id:string}>('SELECT current_round_id FROM nipt_case WHERE id=$1',[d.caseId])).rows[0];if(!head)throw new LabError('NOT_FOUND',404);
 const r=await lockedRound(db,user,head.current_round_id);need(user,'redraw.order','write',{unitId:r.unit_id??undefined,origin:r.registration_origin as 'ANC'});
 if(r.current_round_id!==r.id||!['ReceivedInHIS','ReceivedInNIPT'].includes(r.state))throw new LabError('REDRAW_REQUIRES_RECEIVED_CURRENT_ROUND',409);
 const latest=(await attemptFacts(db,'a.round_id=$1 ORDER BY a.attempt_number DESC LIMIT 1',[r.id]))[0];
 if(latest?.no_call_selected)throw new LabError('NO_CALL_AWAITING_EXTERNAL_PDF',409);
 const request=(await db.query<{id:string}>("INSERT INTO redraw_request(case_id,source_round_id,reason_code,note,requested_by,prior_round_state) VALUES($1,$2,$3,$4,$5,$6) RETURNING id",[r.case_id,r.id,d.reasonCode,d.note,user.id,r.state])).rows[0].id;
 const live=await attemptFacts(db,"a.round_id=$1 AND a.state IN ('Ready','Assigned','InProgress')",[r.id]);
 for(const a of live){
  if(a.slot_batch_id&&['Draft','PlanChecked','Amended'].includes(a.sheet_state??'')){await db.query("UPDATE lab_slot_assignment SET removed_at=now(),removed_by=$2,removed_reason='REDRAW_ORDERED' WHERE attempt_id=$1 AND removed_at IS NULL",[a.attempt_id,user.id]);await bumpSheet(db,a.slot_batch_id,a.slot_number!);}
  else if(a.slot_batch_id){for(const stage of ['TRANSFER','QC1'])await db.query("INSERT INTO lab_slot_disposition(batch_id,slot_number,stage,disposition,reason_code,note,proposed_by) VALUES($1,$2,$3,'STOPPED','REDRAW_ORDERED',$4,$5) ON CONFLICT DO NOTHING",[a.slot_batch_id,a.slot_number,stage,'คำสั่งเก็บตัวอย่างใหม่ — '+d.note,user.id]);}
  await setAttemptState(db,user,{id:a.attempt_id,case_id:a.case_id,state:a.attempt_state},'Stopped',{redrawRequestId:request});
 }
 await db.query("UPDATE repeat_work_order SET state='Cancelled',closed_by=$2,closed_at=now(),close_reason='REDRAW_ORDERED' WHERE round_id=$1 AND state IN ('RepeatRequested','RepeatPendingBatch')",[r.id,user.id]);
 await db.query("UPDATE repeat_work_order SET state='RepeatFailed',closed_by=$2,closed_at=now(),close_reason='REDRAW_ORDERED' WHERE round_id=$1 AND state='RepeatInProgress'",[r.id,user.id]);
 await db.query("UPDATE specimen_round SET state='RedrawRequested' WHERE id=$1",[r.id]);
 const next=(await db.query<{id:string}>('INSERT INTO specimen_round(case_id,case_ln_id,round_number,redraw_request_id) VALUES($1,$2,$3,$4) RETURNING id',[r.case_id,r.case_ln_id,r.round_number+1,request])).rows[0].id;
 await db.query('UPDATE nipt_case SET current_round_id=$2 WHERE id=$1',[r.case_id,next]);
 await caseEvent(db,user,r.case_id,'LAB_REDRAW_ORDERED',{fromRound:r.round_number,toRound:r.round_number+1,reasonCode:d.reasonCode,stoppedAttempts:live.length});
 await audit(db,user,'LAB_REDRAW_ORDERED','redraw_request',request,{reasonCode:d.reasonCode,count:live.length});
 return {redrawRequestId:request,newRoundId:next,newRoundNumber:r.round_number+1,stoppedAttempts:live.length};
}

/** §5.12 cancel of a wrongly-ordered redraw, only before the new round is physically received. Stopped attempts are not resumed silently. */
export async function cancelRedraw(db:Queryable,user:Staff,input:unknown){
 await assertSession(db,user);const d=z.strictObject({caseId:uuid,reason:reasonText}).parse(input);
 const head=(await db.query<{current_round_id:string}>('SELECT current_round_id FROM nipt_case WHERE id=$1',[d.caseId])).rows[0];if(!head)throw new LabError('NOT_FOUND',404);
 const r=await lockedRound(db,user,head.current_round_id);need(user,'redraw.cancel','write',{unitId:r.unit_id??undefined,origin:r.registration_origin as 'ANC'});
 if(r.round_number<2||r.state!=='Expected'||!r.redraw_request_id)throw new LabError('REDRAW_CANCEL_ONLY_BEFORE_RECEIPT',409);
 const q=(await db.query<{source_round_id:string;prior_round_state:string}>("SELECT source_round_id,prior_round_state FROM redraw_request WHERE id=$1 AND state='Requested' FOR UPDATE",[r.redraw_request_id])).rows[0];if(!q)throw new LabError('REDRAW_NOT_ACTIVE',409);
 await db.query("UPDATE specimen_round SET state='Cancelled' WHERE id=$1",[r.id]);
 await db.query("UPDATE redraw_request SET state='Cancelled',closed_by=$2,closed_at=now(),close_reason=$3 WHERE id=$1",[r.redraw_request_id,user.id,d.reason]);
 await db.query('UPDATE specimen_round SET state=$2 WHERE id=$1',[q.source_round_id,q.prior_round_state]);
 await db.query('UPDATE nipt_case SET current_round_id=$2 WHERE id=$1',[r.case_id,q.source_round_id]);
 const stopped=(await db.query<{id:string}>("UPDATE analytical_attempt a SET resume_decision_required=true WHERE a.round_id=$1 AND a.state='Stopped' AND EXISTS(SELECT 1 FROM attempt_event e WHERE e.attempt_id=a.id AND e.to_state='Stopped' AND e.details->>'redrawRequestId'=$2) RETURNING a.id",[q.source_round_id,r.redraw_request_id])).rows;
 await caseEvent(db,user,r.case_id,'LAB_REDRAW_CANCELLED',{cancelledRound:r.round_number,reason:d.reason,resumeDecisions:stopped.length});
 await audit(db,user,'LAB_REDRAW_CANCELLED','redraw_request',r.redraw_request_id,{count:stopped.length});
 return {restoredRoundId:q.source_round_id,resumeDecisionRequired:stopped.length};
}

export async function setUrgent(db:Queryable,user:Staff,input:unknown){
 await assertSession(db,user);const d=z.strictObject({attemptId:uuid,urgent:z.boolean(),reason:reasonText}).parse(input);
 const a=await lockedAttempt(db,user,d.attemptId);need(user,'batch.assign','write');
 if(a.urgent===d.urgent)return {urgent:a.urgent};
 await attemptEvent(db,user,{attemptId:a.attempt_id,caseId:a.case_id,type:d.urgent?'URGENT_SET':'URGENT_CLEARED',reason:d.reason});
 await audit(db,user,d.urgent?'LAB_URGENT_SET':'LAB_URGENT_CLEARED','analytical_attempt',a.attempt_id);
 return {urgent:d.urgent};
}
export async function setHold(db:Queryable,user:Staff,input:unknown){
 await assertSession(db,user);const d=z.strictObject({attemptId:uuid,hold:z.boolean(),reason:reasonText}).parse(input);
 const a=await lockedAttempt(db,user,d.attemptId);need(user,'specimen.hold','write');
 if(a.hold===d.hold)return {hold:a.hold};
 await attemptEvent(db,user,{attemptId:a.attempt_id,caseId:a.case_id,type:d.hold?'HOLD_SET':'HOLD_RELEASED',reason:d.reason,stage:d.hold?null:a.hold_stage});
 await audit(db,user,d.hold?'LAB_HOLD_SET':'LAB_HOLD_RELEASED','analytical_attempt',a.attempt_id);
 return {hold:d.hold};
}
async function bumpSheet(db:Queryable,batchId:string,slot:number){
 const sheet=slot<=16?1:slot<=32?2:3;
 await db.query("UPDATE lab_task_sheet SET placement_version=placement_version+1,state=CASE WHEN state='PlanChecked' THEN 'Draft' ELSE state END,plan_checked_by=NULL,plan_checked_at=NULL,plan_checked_version=NULL WHERE batch_id=$1 AND sheet_number=$2",[batchId,sheet]);
 await db.query('UPDATE lab_batch SET version=version+1 WHERE id=$1',[batchId]);
}

const labelInput=z.strictObject({roundIds:z.array(uuid).min(1).max(48).refine(v=>new Set(v).size===v.length,'DUPLICATE_ROUND'),includeName:z.boolean(),reason:reasonText.optional()});
/** Owner Lock §5: labels come only from an already-issued LN Halos; printing/reprinting never issues or changes a number. */
async function labelSamples(db:Queryable,user:Staff,d:z.infer<typeof labelInput>){
 const rows=(await db.query<{round_id:string;case_id:string;ln:string;ln_halos:string;resampling:boolean;round_state:string;unit_id:string|null;registration_origin:string;prints:number;name:string|null}>(`SELECT n.round_id,n.case_id,l.ln,n.ln_halos,(n.original_round_id IS NOT NULL) resampling,r.state round_state,
   (SELECT s.unit_id FROM case_unit_scope s WHERE s.case_id=n.case_id ORDER BY s.unit_id LIMIT 1) unit_id,c.registration_origin,(SELECT count(*) FROM label_print_item i WHERE i.round_id=n.round_id)::int prints,
   (SELECT w.draft->'patient'->>'syntheticName' FROM p2_workspace w JOIN specimen_round wr ON wr.id=w.round_id WHERE w.case_id=n.case_id ORDER BY wr.round_number DESC LIMIT 1) name
  FROM specimen_lab_number n JOIN specimen_round r ON r.id=n.round_id JOIN nipt_case c ON c.id=n.case_id JOIN case_ln l ON l.id=r.case_ln_id WHERE n.round_id=ANY($1::uuid[])`,[d.roundIds])).rows;
 const byRound=new Map(rows.map(r=>[r.round_id,r]));
 const ordered=d.roundIds.map(id=>{const r=byRound.get(id);if(!r||!caseVisible(user,r))throw new LabError('LN_HALOS_NOT_ISSUED_OR_NOT_VISIBLE',404,{roundId:id});if(['Cancelled'].includes(r.round_state))throw new LabError('ROUND_CANCELLED',409,{roundId:id});return r;});
 const facts=await attemptFacts(db,'a.round_id=ANY($1::uuid[]) AND a.attempt_number=1',[d.roundIds]);
 const pregnancy=new Map(facts.map(f=>[f.round_id,f.pregnancy]));
 const unconfirmed=ordered.filter(r=>!pregnancy.get(r.round_id)).map(r=>r.round_id);
 if(unconfirmed.length)throw new LabError('PREGNANCY_TYPE_UNCONFIRMED',422,{roundIds:unconfirmed});
 // Name only on explicit request, only a synthetic name the user may already read for that case (Owner Lock §3 line 3).
 // Tube labels print the display code (OD-R1a): a redraw S2 shows BASE[D]R, never the S1 text.
 const samples=ordered.map(r=>({ln:r.ln,lnHalos:specimenDisplayCode(r.ln_halos,pregnancy.get(r.round_id)!,r.resampling),patientName:d.includeName&&r.name&&/^(SYNTHETIC|จำลอง|ผู้รับบริการจำลอง)/.test(r.name)?r.name:null}));
 return {ordered,samples,html:buildTubeLabelsHtml(samples),reprint:ordered.some(r=>r.prints>0)};
}
export async function previewLabels(db:Queryable,user:Staff,input:unknown){
 await assertSession(db,user);need(user,'label.print','write');const d=labelInput.parse(input);
 const {samples,html,reprint}=await labelSamples(db,user,d);
 await audit(db,user,'LAB_LABEL_PREVIEWED','label_print_job',undefined,{count:samples.length});
 return {html,reprint,stickers:samples.length*4,halves:samples.length*8,codes:samples.map(s=>s.lnHalos)};
}
export async function printLabels(db:Queryable,user:Staff,input:unknown){
 await assertSession(db,user);need(user,'label.print','write');const d=labelInput.parse(input);
 const {ordered,samples,html,reprint}=await labelSamples(db,user,d);
 if(reprint&&!d.reason)throw new LabError('REPRINT_REASON_REQUIRED',422);
 const job=(await db.query<{id:string}>('INSERT INTO label_print_job(actor_id,kind,reason,sample_count,include_name,html_sha256) VALUES($1,$2,$3,$4,$5,$6) RETURNING id',[user.id,reprint?'REPRINT':'PRINT',d.reason??null,samples.length,d.includeName,createHash('sha256').update(html).digest('hex')])).rows[0].id;
 for(const [i,r] of ordered.entries())await db.query('INSERT INTO label_print_item(job_id,position,round_id,printed_code) VALUES($1,$2,$3,$4)',[job,i+1,r.round_id,samples[i].lnHalos]);
 for(const r of ordered)await caseEvent(db,user,r.case_id,reprint?'LAB_LABEL_REPRINTED':'LAB_LABEL_PRINTED',{jobId:job});
 await audit(db,user,reprint?'LAB_LABEL_REPRINTED':'LAB_LABEL_PRINTED','label_print_job',job,{count:samples.length,outcome:d.includeName?'WITH_NAME':'WITHOUT_NAME'});
 return {jobId:job,kind:reprint?'REPRINT':'PRINT',html};
}
