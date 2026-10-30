import {z} from 'zod';
import {compareReceive,READY_QUEUE_DEFAULT_SORT} from './receive-sort';
import {operationalDataEnabled} from '../security/runtime';
import type {Queryable} from '../db/connection';
import {appendAudit} from '../db/audit';
import {authorize,type Principal,type Operation} from '../security/policy';
import {readActiveSettings} from '../settings/service';
import {printedSampleId,type RepeatLevel} from './rules';
import {assignmentPredicates,decide,type PendingPolicy,type CommonFacts} from './gate';

export type Staff=Principal&{sessionId?:string};
export class LabError extends Error{constructor(public code:string,public status=400,public details?:unknown){super(code);}}
export const uuid=z.uuid();
// Free text never carries identifiers: 8–500 characters, no 13-digit runs (possible national ID), no control characters.
export const reasonText=z.string().trim().min(8).max(500).refine(v=>!/\d{13}/.test(v)&&!/[\u0000-\u001f]/.test(v),'REASON_TEXT_INVALID');
// Synthetic reason vocabularies — final wording/codes remain OD-11 / OD-34 decisions.
export const REDRAW_REASONS=['QC1_FAILED','QC_SAMPLE_FAILED','FETAL_FRACTION_LOW','SPECIMEN_PROBLEM','OTHER'] as const;
export const REPEAT_REASONS=['QC1_LOW','LIBRARY_FAILURE','BATCH_CANCELLED','STOPPED_BY_LAB','OTHER'] as const;
export const DISPOSITION_REASONS=['INSUFFICIENT_SAMPLE','TUBE_BROKEN','INSTRUMENT_FAILURE','CONSENT_WITHDRAWN','REDRAW_ORDERED','OTHER'] as const;
export const REPEAT_LEVELS=['RE_LIBRARY','RE_EXTRACTION'] as const satisfies readonly RepeatLevel[];

export function need(user:Staff,action:string,operation:Operation='write',resource:Parameters<typeof authorize>[2]={}){if(!authorize(user,action,resource,operation))throw new LabError('FORBIDDEN',403);}
export async function assertSession(db:Queryable,user:Staff){
 if(!user.sessionId)return;
 const r=await db.query<{signing_suspended:boolean}>('SELECT signing_suspended FROM app_session WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL AND idle_expires_at>now() AND absolute_expires_at>now()',[user.sessionId,user.id]);
 if(!r.rows[0])throw new LabError('UNAUTHENTICATED',401);if(r.rows[0].signing_suspended)throw new LabError('STAFF_SESSION_SUSPENDED',423);
}
export async function audit(db:Queryable,user:Staff,action:string,resourceType:string,resourceId:string|undefined,details:Record<string,string|number|boolean>={}){
 await appendAudit(db,{actorId:user.id,action,resourceType,resourceId,details:{...details,synthetic:!operationalDataEnabled()}});
}
export async function caseEvent(db:Queryable,user:Staff,caseId:string,type:string,details:Record<string,unknown>={}){
 await db.query('INSERT INTO case_event(case_id,event_type,details) VALUES($1,$2,$3)',[caseId,type,JSON.stringify({...details,actorId:user.id,synthetic:!operationalDataEnabled()})]);
}
export async function attemptEvent(db:Queryable,user:Staff,e:{attemptId:string;caseId:string;type:string;from?:string;to?:string;reason?:string|null;stage?:string|null;details?:Record<string,unknown>}){
 await db.query('INSERT INTO attempt_event(attempt_id,case_id,event_type,stage,from_state,to_state,reason,actor_id,details) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[e.attemptId,e.caseId,e.type,e.stage??null,e.from??null,e.to??null,e.reason??null,user.id,JSON.stringify({...(e.details??{}),synthetic:!operationalDataEnabled()})]);
}
export async function setAttemptState(db:Queryable,user:Staff,a:{id:string;case_id:string;state:string},to:string,details:Record<string,unknown>={},extra:{qcFailedStage?:string}={}){
 if(a.state===to)return;
 await db.query('UPDATE analytical_attempt SET state=$2,qc_failed_stage=COALESCE($3,qc_failed_stage) WHERE id=$1',[a.id,to,extra.qcFailedStage??null]);
 await attemptEvent(db,user,{attemptId:a.id,caseId:a.case_id,type:'STATE_CHANGED',from:a.state,to,details});
}
export async function pendingPolicy(db:Queryable):Promise<{policy:PendingPolicy;templateVersion:string;formulaVersion:string}>{
 const lab=(await readActiveSettings(db)).laboratory as {pendingGovernanceGate?:PendingPolicy;templateVersion?:string;formulaVersion?:string}|undefined;
 return {policy:lab?.pendingGovernanceGate??'HOLD',templateVersion:lab?.templateVersion??'synthetic-v1',formulaVersion:lab?.formulaVersion??'unvalidated'};
}
export const BATCH_TEMPLATE='SYNTHETIC-BATCH48-PC1-NC25-BLANK40-v1';

export type AttemptRow={overall_ordinal:number;no_call_selected:boolean;ln_halos_resampling:boolean;attempt_id:string;case_id:string;round_id:string;attempt_number:number;attempt_state:string;repeat_order_id:string|null;printed_sample_id:string|null;resume_decision_required:boolean;qc_failed_stage:string|null;attempt_created_at:Date;
 lab_operational_route?:boolean;round_pet_or_eqa_ok?:boolean;eqa_verified?:boolean;round_number:number;round_state:string;received_source:string|null;received_at:Date|null;analysis_started:boolean;round_collection_date:string|null;receipt_check:Record<string,unknown>|null;specimen_accepted?:boolean;
 current_round_id:string;registration_origin:'ANC'|'LAB_DIRECT'|'HISTORICAL';unit_id:string|null;hn:string|null;ln:string;ln_verification:string;ln_halos:string|null;
 repeat_state:string|null;repeat_level:RepeatLevel|null;parent_attempt_id:string|null;open_issues:number;revoked:boolean;consent_ev:string|null;request_ev:string|null;clinical_state:string|null;collection_dates:string[];
 pregnancy:'Singleton'|'Twins'|null;ga_edd:string|null;ga_request_collection:string|null;other_relibrary:number;previously_finalized:boolean;hold:boolean;hold_stage:string|null;urgent:boolean;urgent_reason:string|null;
 slot_batch_id:string|null;slot_number:number|null;run_label:string|null;sheet_state:string|null;label_prints:number;last_label_print:Date|null};

/** Every fact needed for BG-01..09A, queue position and labels of the given attempts, in one set-based read. */
export async function attemptFacts(db:Queryable,where:string,params:unknown[]):Promise<AttemptRow[]>{
 return (await db.query<AttemptRow>(`SELECT a.id attempt_id,a.case_id,a.round_id,a.attempt_number,a.overall_ordinal,EXISTS(SELECT 1 FROM attempt_event e WHERE e.attempt_id=a.id AND e.event_type='NO_CALL_SELECTED') no_call_selected,a.state attempt_state,a.repeat_order_id,a.printed_sample_id,a.resume_decision_required,a.qc_failed_stage,a.created_at attempt_created_at,
  r.round_number,r.state round_state,r.received_source,r.received_at,r.analysis_started,r.collection_date::text round_collection_date,r.receipt_check,
  nipt_round_pet_or_eqa_ok(r.id) round_pet_or_eqa_ok,EXISTS(SELECT 1 FROM eqa_case eq WHERE eq.case_id=a.case_id) eqa_verified,
  c.current_round_id,c.registration_origin,(SELECT i.hn FROM p2_case_identity i WHERE i.case_id=c.id) hn,(labreg.round_id IS NOT NULL AND labreg.paper_request AND labreg.paper_consent) lab_operational_route,(SELECT s.unit_id FROM case_unit_scope s WHERE s.case_id=c.id ORDER BY s.unit_id LIMIT 1) unit_id,l.ln,l.verification ln_verification,n.ln_halos,(n.original_round_id IS NOT NULL) ln_halos_resampling,
  o.state repeat_state,o.level repeat_level,o.parent_attempt_id,
  (SELECT count(*) FROM his_intake_issue i WHERE i.case_id=a.case_id AND i.state IN ('Open','Proposed'))::int open_issues,
  EXISTS(SELECT 1 FROM p2_revocation v WHERE v.case_id=a.case_id) revoked,
  CASE p2_consent_latest_decision(a.round_id) WHEN 'Granted' THEN 'GRANTED' WHEN 'Declined' THEN 'DECLINED'
   ELSE (SELECT 'PAPER_SELECTED' FROM p2_workspace w WHERE w.round_id=a.round_id AND w.consent_mode='Paper') END consent_ev,
  (SELECT x.ev FROM (SELECT d.created_at,'VERIFIED' ev FROM p2_document_revision d WHERE d.round_id=a.round_id AND d.kind='REQUEST'
    UNION ALL SELECT p.created_at,CASE WHEN p.status='Verified' THEN 'VERIFIED' ELSE 'NONE' END FROM p2_paper_review p WHERE p.round_id=a.round_id AND p.kind='REQUEST') x ORDER BY x.created_at DESC LIMIT 1) request_ev,
  (SELECT CASE WHEN p2_clinical_ready(a.round_id) THEN 'ClinicalPassed' WHEN s.result->>'state'='ClinicalPassed' THEN 'PendingClinicalReview' ELSE s.result->>'state' END FROM clinical_snapshot s WHERE s.round_id=a.round_id ORDER BY s.created_at DESC LIMIT 1) clinical_state,
  (SELECT condition='ACCEPTABLE' FROM specimen_acceptance WHERE round_id=a.round_id ORDER BY created_at DESC,id DESC LIMIT 1) specimen_accepted,
  ARRAY(SELECT y.d FROM (SELECT DISTINCT ON(f.source) f.collection_date::text d FROM p2_collection_fact f WHERE f.round_id=a.round_id ORDER BY f.source,f.sequence DESC) y) collection_dates,
  COALESCE((SELECT x.pt FROM (SELECT d.created_at,d.payload->'draft'->'pregnancy'->>'type' pt FROM p2_document_revision d WHERE d.round_id=a.round_id AND d.kind='REQUEST'
    UNION ALL SELECT p.created_at,p.panel->>'pregnancyType' FROM p2_paper_review p WHERE p.round_id=a.round_id AND p.kind='REQUEST' AND p.status='Verified') x WHERE x.pt IN ('Singleton','Twins') ORDER BY x.created_at DESC LIMIT 1),labreg.pregnancy,CASE WHEN labreg.round_id IS NOT NULL THEN (SELECT CASE WHEN w.draft#>>'{pregnancy,type}' IN ('Singleton','Twins') THEN w.draft#>>'{pregnancy,type}' END FROM p2_workspace w WHERE w.round_id=r.id) END,eq.pregnancy_type) pregnancy,
  COALESCE(ga.edd,labreg.edd::text,eq.edd::text,CASE WHEN labreg.round_id IS NOT NULL THEN (SELECT w.draft#>>'{pregnancy,edd}' FROM p2_workspace w WHERE w.round_id=r.id) END) ga_edd,ga.cd ga_request_collection,
  EXISTS(SELECT 1 FROM lab_placement_snapshot ps,jsonb_array_elements(ps.payload->'slots') sl WHERE sl->>'attemptId'=a.id::text) previously_finalized,
  (SELECT count(*) FROM analytical_attempt b JOIN repeat_work_order w ON w.id=b.repeat_order_id WHERE b.round_id=a.round_id AND b.id<>a.id AND w.level='RE_LIBRARY')::int other_relibrary,
  COALESCE((SELECT e.event_type='HOLD_SET' FROM attempt_event e WHERE e.attempt_id=a.id AND e.event_type IN ('HOLD_SET','HOLD_RELEASED') ORDER BY e.sequence DESC LIMIT 1),false) hold,
  (SELECT e.stage FROM attempt_event e WHERE e.attempt_id=a.id AND e.event_type IN ('HOLD_SET','HOLD_RELEASED') ORDER BY e.sequence DESC LIMIT 1) hold_stage,
  COALESCE((SELECT e.event_type='URGENT_SET' FROM attempt_event e WHERE e.attempt_id=a.id AND e.event_type IN ('URGENT_SET','URGENT_CLEARED') ORDER BY e.sequence DESC LIMIT 1),false) urgent,
  (SELECT e.reason FROM attempt_event e WHERE e.attempt_id=a.id AND e.event_type='URGENT_SET' ORDER BY e.sequence DESC LIMIT 1) urgent_reason,
  sa.batch_id slot_batch_id,sa.slot_number,b.run_label,t.state sheet_state,
  (SELECT count(*) FROM label_print_item i WHERE i.round_id=a.round_id)::int label_prints,(SELECT max(j.created_at) FROM label_print_item i JOIN label_print_job j ON j.id=i.job_id WHERE i.round_id=a.round_id) last_label_print
 FROM analytical_attempt a JOIN specimen_round_current r ON r.id=a.round_id JOIN nipt_case c ON c.id=a.case_id JOIN case_ln l ON l.id=r.case_ln_id LEFT JOIN eqa_case eq ON eq.case_id=c.id
 LEFT JOIN LATERAL (SELECT * FROM lab_operational_registration lr WHERE lr.case_id=c.id ORDER BY (lr.round_id=r.id) DESC,lr.created_at DESC LIMIT 1) labreg ON true
 LEFT JOIN specimen_lab_number n ON n.round_id=r.id LEFT JOIN repeat_work_order o ON o.id=a.repeat_order_id
 LEFT JOIN LATERAL (SELECT x.edd,x.cd FROM (SELECT d.created_at,d.payload->'draft'->'pregnancy'->>'edd' edd,d.payload->'draft'->'pregnancy'->>'collectionDate' cd FROM p2_document_revision d WHERE d.round_id=a.round_id AND d.kind='REQUEST'
    UNION ALL SELECT p.created_at,p.panel->>'edd',p.panel->>'collectionDate' FROM p2_paper_review p WHERE p.round_id=a.round_id AND p.kind='REQUEST' AND p.status='Verified') x WHERE x.edd IS NOT NULL ORDER BY x.created_at DESC LIMIT 1) ga ON true
 LEFT JOIN lab_slot_assignment sa ON sa.attempt_id=a.id AND sa.removed_at IS NULL LEFT JOIN lab_batch b ON b.id=sa.batch_id
 LEFT JOIN lab_task_sheet t ON t.batch_id=sa.batch_id AND t.sheet_number=CASE WHEN sa.slot_number<=16 THEN 1 WHEN sa.slot_number<=32 THEN 2 ELSE 3 END
 WHERE ${where}`,params)).rows;
}
export function commonFacts(r:AttemptRow):CommonFacts{
 const dates=[...r.collection_dates];if(r.round_collection_date)dates.push(r.round_collection_date);
 const check=r.receipt_check??{};
 return {labOperationalRoute:r.lab_operational_route===true,isCurrentRound:r.current_round_id===r.round_id,roundNumber:r.round_number,roundState:r.round_state,receivedSource:r.received_source,analysisStarted:r.analysis_started,isRepeatChild:r.repeat_order_id!==null,previouslyFinalized:r.previously_finalized,
  openIdentityIssues:r.open_issues,roundPetOrEqaOk:r.round_pet_or_eqa_ok===true,eqaVerified:r.eqa_verified===true,lnVerifiedByPet:r.ln_verification==='VERIFIED_BY_PET',receiptIdentityAndLabel:check.identity===true&&check.label===true,
  consentRevoked:r.revoked,consentRoundEvidence:r.consent_ev==='GRANTED'?'GRANTED':r.consent_ev==='DECLINED'?'DECLINED':r.consent_ev==='PAPER_SELECTED'||r.lab_operational_route?'PAPER_SELECTED':'NONE',requestRoundEvidence:r.request_ev==='VERIFIED'?'VERIFIED':'NONE',
  clinicalState:r.clinical_state,collectionDates:dates,specimenAccepted:r.specimen_accepted===true};
}
export function candidatePrintedId(r:AttemptRow){
 if(r.printed_sample_id)return {status:'YES' as const,id:r.printed_sample_id};
 if(!r.ln_halos)return {status:'OD03_FORMAT_PENDING' as const,id:null};
 if(!r.pregnancy)return {status:'PREGNANCY_UNCONFIRMED' as const,id:null};
 const id=printedSampleId({base:r.ln_halos,pregnancy:r.pregnancy,attemptNumber:r.attempt_number,repeatLevel:r.repeat_level,earlierReLibraryCount:r.other_relibrary,roundNumber:r.round_number,receivedSource:r.received_source,overallOrdinal:r.overall_ordinal});
 return id?{status:'YES' as const,id}:{status:'OD03_FORMAT_PENDING' as const,id:null};
}
export function assignmentDecision(r:AttemptRow,policy:PendingPolicy){
 return decide(assignmentPredicates({...commonFacts(r),attemptState:r.attempt_state,hasActiveSlot:r.slot_batch_id!==null,onHold:r.hold,resumeDecisionRequired:r.resume_decision_required,repeatOrderState:r.repeat_state,printedIdAvailable:candidatePrintedId(r).status}),policy);
}
/** FIFO = the Ready Queue display order: specimen-round receipt time ASC (Repeat keeps the original receipt time), immutable tie keys.
 * OD-A (Owner 2026-10-18): Urgent is a badge and never jumps the queue by itself; it only lets its own recorded reason stand for a manual override. */
export const fifo=(a:AttemptRow,b:AttemptRow)=>compareReceive({receivedAt:a.received_at,keys:[a.ln,a.attempt_id]},{receivedAt:b.received_at,keys:[b.ln,b.attempt_id]},READY_QUEUE_DEFAULT_SORT);
/** GA ≥ 22+0 notice (Owner: warning only). EDD from the latest verified Request of this round; collection date from the HIS receipt
 * evidence when present, otherwise the Request. Same arithmetic as P2 `calculations()`. Display only: no gate, FIFO, urgent or override reads it. */
export const GA_WARNING_DAYS=22*7;
export function gestationalAge(r:Pick<AttemptRow,'ga_edd'|'ga_request_collection'|'round_collection_date'>){
 const iso=/^\d{4}-\d{2}-\d{2}$/,collection=r.round_collection_date??r.ga_request_collection;
 if(!r.ga_edd||!collection||!iso.test(r.ga_edd)||!iso.test(collection))return null;
 const days=280+Math.round((Date.parse(collection)-Date.parse(r.ga_edd))/86400000);if(days<0||days>315)return null;
 return {days,weeks:Math.floor(days/7),remainder:days%7,warning:days>=GA_WARNING_DAYS,collectionBasis:r.round_collection_date?'HIS_RECEIPT' as const:'REQUEST' as const};
}
export const caseVisible=(user:Staff,r:{unit_id:string|null;registration_origin:string})=>authorize(user,'case.read',{unitId:r.unit_id??undefined,origin:r.registration_origin as 'ANC'},'read');
/** The database clock: the single time authority for DIRECT_ENTRY event times (it also stamps recorded_at and the execution anchors).
 * A Date holds milliseconds, so the value is never later than the microsecond clock_timestamp() that later stamps recorded_at. */
export async function dbClock(db:Queryable):Promise<Date>{return (await db.query<{t:Date}>('SELECT clock_timestamp() t')).rows[0].t;}
export const bangkokToday=()=>new Date(Date.now()+7*3600000).toISOString().slice(0,10);
