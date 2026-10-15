import {randomUUID} from 'node:crypto';
import {contentHash} from '../p2/service';
import {z} from 'zod';
import type {Queryable} from '../db/connection';
import {LabError,assertSession,need,uuid,reasonText,audit,type Staff,attemptFacts,bangkokToday,dbClock} from '../lab/core';
import {lockBatch,latestSnapshot,sheetOf,type PlacementPayload} from '../lab/batch';
import {CONTROL_LABEL} from '../lab/rules';
import {calculate,digest,scenarioSchema,selectCrosscheck,compareCrosscheck,numeric,HOLDS,type Calculation} from './calculation';

import {QC2_CRITERIA} from './constants';
import {operationalWorkflow} from '../lab/operational';
export {QC2_CRITERIA} from './constants';
type Slot=PlacementPayload['slots'][number];
export type Member=Slot&{kind:'PATIENT'|'PC'|'NC';qc1:{id:string;value:string;source:string;recordedBy:string;recordedAt:string;eventTime:string|null;review:unknown;decision:unknown}};
type PoolPayload={synthetic:boolean;batchId:string;runLabel:string;tubeLabel:string;attemptNumber:number;placements:{id:string;revision:number;sha256:string}[];members:Member[];excluded:{slot:number;kind:string;reasons:string[]}[];calculation:Calculation;sourceHash:string;createdBy:string;createdAt:string;acceptance:'HOLD'|'Accepted';holds:readonly string[]};
export type PoolRow={id:string;batch_id:string;attempt_number:number;revision:number;payload:PoolPayload;sha256:string;source_sha256:string;selected_slots:number[];seed:string;created_by:string;created_at:Date};
type Event={sequence:number;id:string;event_type:string;payload:Record<string,unknown>;actor_id:string|null;created_at:Date};
export type Observation={id:string;sequence:number;pool_id:string;field:'TRANSFER'|'BUFFER'|'QC2'|'STD1'|'STD2';slot:number|null;value:{value?:string;checked?:true;unit?:string};source:string;copy_id:string|null;event_time:Date|null;event_precision:string;recorded_by:string;recorded_at:Date;supersedes_id:string|null;review:{result:string;reviewer_id:string;created_at:Date}|null};
const iso=(value:Date|string|null)=>value?new Date(value).toISOString():null;
/** All inputs come from persisted P4 evidence. Never accepts client concentrations or identities. */
export async function poolingSource(db:Queryable,batchId:string,controls:'PATIENT_ONLY'|'PATIENT_PC_NC'){
 const placements:PoolPayload['placements']=[],members:Member[]=[],excluded:PoolPayload['excluded']=[],evidence:unknown[]=[];
 const state=(await db.query<{state:string}>('SELECT state FROM lab_batch WHERE id=$1',[batchId])).rows[0]?.state;
 evidence.push({batchState:state});
 const facts=await attemptFacts(db,'a.id IN (SELECT attempt_id FROM lab_slot_assignment WHERE batch_id=$1 AND removed_at IS NULL)',[batchId]);
 for(const n of [1,2,3]){
  const sheet=await sheetOf(db,batchId,n);
  // Include draft sheet identity/state in source digest, but never invent its slots.
  evidence.push({sheetId:sheet.id,state:sheet.state,revision:sheet.placement_revision});
  if(!sheet.placement_revision)continue;
  const snap=await latestSnapshot(db,sheet.id);
  if(contentHash(snap.payload)!==snap.content_hash)throw new LabError('SOURCE_INVALID',409);
  placements.push({id:snap.id,revision:snap.revision,sha256:snap.content_hash});
  for(const slot of snap.payload.slots){
   if(!slot.attemptId&&!slot.control)continue;
   const kind=slot.control?CONTROL_LABEL[slot.control]:'PATIENT',reasons:string[]=[];
   if(kind==='BLANK')reasons.push('BLANK_EXCLUDED');
   if(['PC','NC'].includes(kind)&&controls==='PATIENT_ONLY')reasons.push('SYNTHETIC_CONTROL_SCENARIO_EXCLUDED');
   if(!['ExecutionVerified','CompletedIssued'].includes(sheet.state))reasons.push('SHEET_NOT_VERIFIED');
   const obs=(await db.query<{id:string;value:{value:string};source:string;recorded_by:string;recorded_at:Date;event_time:Date|null;status:string}>("SELECT * FROM lab_observation WHERE batch_id=$1 AND slot_number=$2 AND field_id='F3-03' AND status<>'Superseded' ORDER BY sequence DESC LIMIT 1",[batchId,slot.slot])).rows[0];
   const review=obs?(await db.query<{reviewer_id:string;result:string;created_at:Date}>('SELECT reviewer_id,result,created_at FROM lab_observation_review WHERE observation_id=$1 ORDER BY created_at DESC LIMIT 1',[obs.id])).rows[0]:null;
   const dispositions=(await db.query('SELECT id,stage,disposition,confirmed_at FROM lab_slot_disposition WHERE batch_id=$1 AND slot_number=$2 ORDER BY stage',[batchId,slot.slot])).rows;
   if(dispositions.length)reasons.push('DISPOSITION_NOT_MEASURED');
   let decision:unknown=null;
   if(slot.attemptId){
    const f=facts.find(a=>a.attempt_id===slot.attemptId);
    if(!f||f.slot_number!==slot.slot||f.slot_batch_id!==batchId||!['InProgress','AnalysisComplete','FinalQcAccepted','Final'].includes(f.attempt_state)||f.hold||f.resume_decision_required||f.revoked||f.current_round_id!==f.round_id)reasons.push('ATTEMPT_NOT_ELIGIBLE');
    const d=(await db.query<{id:string;decision:string;observation_id:string;criteria_status:string;decided_by:string;decided_at:Date}>('SELECT * FROM attempt_stage_qc WHERE attempt_id=$1 ORDER BY decided_at DESC,id DESC LIMIT 1',[slot.attemptId])).rows[0];
    decision=d??null;
    if(!d||d.decision!=='Accepted'||d.observation_id!==obs?.id)reasons.push('QC1_NOT_ACCEPTED_FOR_CURRENT_VALUE');
    evidence.push({slot:slot.slot,attempt:f?{state:['AnalysisComplete','FinalQcAccepted','Final'].includes(f.attempt_state)?'InProgress':f.attempt_state,hold:f.hold,revoked:f.revoked,currentRound:f.current_round_id,resume:f.resume_decision_required}:null});
   }
   if(!obs||obs.status!=='Verified'||review?.result!=='Confirmed'||review.reviewer_id===obs.recorded_by)reasons.push('QC1_NOT_VERIFIED');
   evidence.push({slot,observation:obs?{...obs,recorded_at:iso(obs.recorded_at),event_time:iso(obs.event_time)}:null,review:review?{...review,created_at:iso(review.created_at)}:null,decision,dispositions});
   if(reasons.length)excluded.push({slot:slot.slot,kind,reasons});
   else members.push({...slot,kind:kind as Member['kind'],qc1:{id:obs!.id,value:obs!.value.value,source:obs!.source,recordedBy:obs!.recorded_by,recordedAt:iso(obs!.recorded_at)!,eventTime:iso(obs!.event_time),review,decision}});
  }
 }
 return {placements,members,excluded,sourceHash:digest({placements,evidence})};
}
async function events(db:Queryable,id:string){return (await db.query<Event>('SELECT * FROM p4b_pool_event WHERE pool_id=$1 ORDER BY sequence',[id])).rows;}
export async function observations(db:Queryable,id:string){return (await db.query<Observation>(`SELECT o.*,(SELECT row_to_json(r) FROM p4b_pool_review r WHERE r.observation_id=o.id) review FROM p4b_pool_observation o
 WHERE pool_id=$1 AND NOT EXISTS(SELECT 1 FROM p4b_pool_observation x WHERE x.supersedes_id=o.id) ORDER BY sequence`,[id])).rows;}
const stopped=(ev:Event[])=>ev.some(e=>['STOP_USE','SUPERSEDED'].includes(e.event_type));
const has=(ev:Event[],type:string)=>ev.some(e=>e.event_type===type);
async function event(db:Queryable,user:Staff,poolId:string,type:string,payload:Record<string,unknown>={}){
 await db.query('INSERT INTO p4b_pool_event(pool_id,event_type,payload,actor_id) VALUES($1,$2,$3,$4)',[poolId,type,JSON.stringify(payload),user.id]);
 await audit(db,user,'POOL_'+type,'p4b_pool_attempt',poolId,{outcome:await operationalWorkflow(db)?'OPERATIONAL':'SYNTHETIC_HOLD'});
}
const common=z.strictObject({batchId:uuid,poolId:uuid,expectedVersion:z.number().int().min(0)});
async function getPool(db:Queryable,batchId:string,id:string){const p=(await db.query<PoolRow>('SELECT * FROM p4b_pool_attempt WHERE id=$1 AND batch_id=$2',[id,batchId])).rows[0];if(!p)throw new LabError('NOT_FOUND',404);if(digest(p.payload)!==p.sha256)throw new LabError('POOL_HASH_MISMATCH',409);return p;}
async function context(db:Queryable,user:Staff,d:z.infer<typeof common>,action:string,acceptedDocument=false){
 await assertSession(db,user);need(user,action);await lockBatch(db,d.batchId,d.expectedVersion);
 const p=await getPool(db,d.batchId,d.poolId),ev=await events(db,p.id),source=await poolingSource(db,p.batch_id,p.payload.calculation.scenario.controls);
 if(stopped(ev)||source.sourceHash!==p.source_sha256)throw new LabError('POOL_STOP_USE',409);
 if(has(ev,'ACCEPTED')&&action!=='worksheet.revise'&&!acceptedDocument)throw new LabError('POOL_ACCEPTED_IMMUTABLE',409);
 return {p,ev};
}
async function touch(db:Queryable,id:string){return (await db.query<{version:number}>('UPDATE lab_batch SET version=version+1 WHERE id=$1 RETURNING version',[id])).rows[0].version;}
export async function createPool(db:Queryable,user:Staff,input:unknown){
 await assertSession(db,user);need(user,'execution.record');
 const d=z.strictObject({batchId:uuid,expectedVersion:z.number().int().min(0),scenario:scenarioSchema,reason:reasonText}).parse(input);
 const b=await lockBatch(db,d.batchId,d.expectedVersion);
 const source=await poolingSource(db,b.id,d.scenario.controls);
 const calculation=calculate(source.members.map(m=>({slot:m.slot,kind:m.kind,concentration:m.qc1.value})),d.scenario);
 if(!calculation.valid)throw new LabError('POOL_CALCULATION_INVALID',422,calculation.errors);
 const old=(await db.query<PoolRow>('SELECT * FROM p4b_pool_attempt WHERE batch_id=$1 ORDER BY attempt_number DESC LIMIT 1',[b.id])).rows[0];
 if(old){
  const oldEvents=await events(db,old.id);
  if(!stopped(oldEvents)&&!has(oldEvents,'HOLD')&&old.source_sha256===source.sourceHash)throw new LabError('ACTIVE_POOL_EXISTS',409);
  if(!stopped(oldEvents)&&old.source_sha256!==source.sourceHash)await event(db,user,old.id,'STOP_USE',{reason:'UPSTREAM_CHANGED'});
  const pending=(await db.query(`SELECT 1 FROM p4b_document_copy c JOIN p4b_document d ON d.id=c.document_id WHERE d.pool_id=$1 AND c.kind='WORKING_COPY'
   AND NOT EXISTS(SELECT 1 FROM p4b_pool_event e WHERE e.pool_id=$1 AND e.event_type='RECALL' AND e.payload->>'copyId'=c.id::text)`,[old.id])).rows;
  if(pending.length)throw new LabError('RECALL_PENDING',409);
  await event(db,user,old.id,'SUPERSEDED',{reason:d.reason});
 }
 const attemptNumber=(old?.attempt_number??0)+1,createdAt=new Date().toISOString(),seed=randomUUID();
 const payload:PoolPayload={synthetic:!await operationalWorkflow(db),batchId:b.id,runLabel:b.run_label,tubeLabel:`${bangkokToday()} ${b.run_label} L01 / Pool attempt ${attemptNumber}`,
  attemptNumber,...source,calculation,createdBy:user.id,createdAt,acceptance:'HOLD',holds:HOLDS};
 const p=(await db.query<{id:string}>(`INSERT INTO p4b_pool_attempt(batch_id,attempt_number,supersedes_id,reason,payload,sha256,source_sha256,seed,selected_slots,created_by)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,[b.id,attemptNumber,old?.id??null,d.reason,JSON.stringify(payload),digest(payload),source.sourceHash,seed,selectCrosscheck(source.members.map(m=>m.slot),seed),user.id])).rows[0];
 await audit(db,user,'POOL_CREATED','p4b_pool_attempt',p.id,{outcome:'SYNTHETIC_HOLD',count:source.members.length});
 return {id:p.id,version:await touch(db,b.id)};
}
export async function crosscheck(db:Queryable,user:Staff,input:unknown){
 const d=common.extend({values:z.array(z.strictObject({slot:z.number().int().min(1).max(48),value:numeric})).min(1).max(3)}).parse(input);
 const {p,ev}=await context(db,user,d,'pool.crosscheck');
 if(has(ev,'CROSSCHECK_PASS')||has(ev,'CROSSCHECK_FAIL'))throw new LabError('CROSSCHECK_ALREADY_RECORDED',409);
 const passed=compareCrosscheck(p.payload.calculation,p.selected_slots,d.values);
 await event(db,user,p.id,passed?'CROSSCHECK_PASS':'CROSSCHECK_FAIL',{values:d.values,seed:p.seed,selectedSlots:p.selected_slots,result:passed?'MATCH':'MISMATCH',tolerance:'EXACT_SCENARIO_PRECISION_UNAPPROVED'});
 if(!passed)await event(db,user,p.id,'HOLD',{reason:'CROSSCHECK_MISMATCH_NONCONFORMITY',values:d.values});
 return {passed,version:await touch(db,p.batch_id)};
}
// There is deliberately NO Accepted/PoolAccepted option in this milestone.
export async function operationalGate(db:Queryable,user:Staff,input:unknown){
 await assertSession(db,user);need(user,'pool.approve');
 if(!await operationalWorkflow(db))throw new LabError('OWNER_DECISIONS_HOLD',423,HOLDS);
 const d=common.extend({criteriaReference:reasonText,reason:reasonText}).parse(input),{p,ev}=await context(db,user,d,'pool.approve');
 if(p.payload.synthetic)throw new LabError('OPERATIONAL_POOL_REQUIRED',409);
 const obs=await observations(db,p.id);
 if(!has(ev,'CROSSCHECK_PASS')||has(ev,'CROSSCHECK_FAIL')||!has(ev,'END')||has(ev,'COMPLETED')||
  !p.payload.members.every(m=>obs.some(o=>o.field==='TRANSFER'&&o.slot===m.slot&&o.review?.result==='Confirmed'&&o.event_time))||
  !['BUFFER','QC2','STD1','STD2'].every(f=>obs.some(o=>o.field===f&&o.review?.result==='Confirmed'&&o.event_time))||obs.some(o=>o.review?.result!=='Confirmed'))throw new LabError('POOL_COMPLETION_EVIDENCE_INCOMPLETE',409);
 const qc=obs.find(o=>o.field==='QC2')!;
 const previous=(await db.query<{decision:string;observation_id:string}>('SELECT decision,observation_id FROM p4b_qc2_decision WHERE pool_id=$1 ORDER BY sequence DESC LIMIT 1',[p.id])).rows[0];
 if(previous?.decision==='Remeasure'&&previous.observation_id===qc.id)throw new LabError('QC2_REMEASUREMENT_REQUIRED',409);
 const decision=(await db.query<{id:string}>("INSERT INTO p4b_qc2_decision(pool_id,observation_id,decision,criteria_version,reason,actor_id) VALUES($1,$2,'Accepted',$3,$4,$5) RETURNING id",[p.id,qc.id,d.criteriaReference,d.reason,user.id])).rows[0];
 const payload={...p.payload,poolId:p.id,revision:1,calculationSha256:p.sha256,qc2:obs,decision:{...decision,criteriaReference:d.criteriaReference,reason:d.reason},crosscheck:ev.find(e=>e.event_type==='CROSSCHECK_PASS'),execution:ev.filter(e=>['START','END'].includes(e.event_type)),acceptance:'Accepted',exportAllowed:true,holds:[],actor:user.id,timestamp:new Date().toISOString()};
 const snapshot=(await db.query<{id:string}>('INSERT INTO p4b_pool_snapshot(pool_id,revision,payload,sha256,created_by) VALUES($1,1,$2,$3,$4) RETURNING id',[p.id,JSON.stringify(payload),digest(payload),user.id])).rows[0];
 await event(db,user,p.id,'ACCEPTED',{snapshotId:snapshot.id,sha256:digest(payload)});
 await audit(db,user,'POOL_ACCEPTED','p4b_pool_snapshot',snapshot.id,{outcome:'Accepted',ruleVersion:'AUTHORIZED_QC2_REVIEW_v1'});
 return {snapshotId:snapshot.id,version:await touch(db,p.batch_id)};
}
export async function transition(db:Queryable,user:Staff,input:unknown){
 const d=common.extend({transition:z.enum(['START','END','HOLD','STOP_USE']),reason:reasonText}).parse(input);
 const {p,ev}=await context(db,user,d,d.transition==='STOP_USE'?'worksheet.revise':'execution.record');
 if(d.transition==='START'&&(!(await operationalWorkflow(db)?has(ev,'CROSSCHECK_PASS'):has(ev,'PRE_WORK'))||has(ev,'START')||has(ev,'HOLD')))throw new LabError('SYNTHETIC_PRE_WORK_REQUIRED',409);
 if(d.transition==='END'&&(!has(ev,'START')||has(ev,'END')||has(ev,'HOLD')))throw new LabError('POOL_NOT_IN_EXECUTION',409);
 await event(db,user,p.id,d.transition,{reason:d.reason});return {version:await touch(db,p.batch_id)};
}
export async function recordPoolObservation(db:Queryable,user:Staff,input:unknown){
 const d=common.extend({field:z.enum(['TRANSFER','BUFFER','QC2','STD1','STD2']),slot:z.number().int().min(1).max(48).optional(),
  value:z.union([z.strictObject({checked:z.literal(true)}),z.strictObject({value:numeric,unit:z.enum(['uL','ng/uL'])})]),
  source:z.enum(['DIRECT_ENTRY','PAPER_TRANSCRIPTION']),copyId:uuid.optional(),eventTime:z.iso.datetime({offset:true}).nullable().optional(),eventPrecision:z.enum(['MINUTE','DAY','NOT_RECORDED']).optional(),supersedesId:uuid.optional(),reason:reasonText.optional()}).parse(input);
 const {p,ev}=await context(db,user,d,d.field.startsWith('STD')||d.field==='QC2'?'qc.record':'execution.record');
 if(!has(ev,'START')||has(ev,'COMPLETED')||has(ev,'HOLD'))throw new LabError('POOL_NOT_IN_EXECUTION',409);
 if(d.field==='TRANSFER'&&(!d.slot||!p.payload.members.some(m=>m.slot===d.slot)||!('checked' in d.value)))throw new LabError('TRANSFER_MEMBER_REQUIRED',422);
 if(d.field!=='TRANSFER'&&(d.slot||!('value' in d.value)||d.value.unit!==(d.field==='BUFFER'?'uL':'ng/uL')))throw new LabError('OBSERVATION_UNIT_OR_SCOPE',422);
 if(['QC2','STD1','STD2'].includes(d.field)&&!has(ev,'END'))throw new LabError('QC2_BEFORE_POOL_PRODUCT',409);
 if(['TRANSFER','BUFFER'].includes(d.field)&&has(ev,'END'))throw new LabError('EXECUTION_ALREADY_ENDED',409);
 const live=(await observations(db,p.id)).find(o=>o.field===d.field&&o.slot===(d.slot??null));
 if(live&&(!d.supersedesId||d.supersedesId!==live.id||!d.reason))throw new LabError('OBSERVATION_EXISTS_USE_CORRECTION',409);
 if(!live&&d.supersedesId)throw new LabError('SUPERSEDE_TARGET_MISMATCH',409);
 const now=await dbClock(db);let at:Date|null=now,precision=d.eventPrecision??'MINUTE';
 if(d.source==='PAPER_TRANSCRIPTION'){
  if(!d.copyId)throw new LabError('WORKING_COPY_REQUIRED',422);
  const copy=(await db.query(`SELECT c.id FROM p4b_document_copy c JOIN p4b_document doc ON doc.id=c.document_id WHERE c.id=$1 AND doc.pool_id=$2 AND c.kind='WORKING_COPY'
   AND NOT EXISTS(SELECT 1 FROM p4b_pool_event e WHERE e.pool_id=$2 AND e.event_type='RECALL' AND e.payload->>'copyId'=c.id::text)`,[d.copyId,p.id])).rows[0];
  if(!copy)throw new LabError('WORKING_COPY_NOT_USABLE',409);
  precision=d.eventPrecision??(d.eventTime?'MINUTE':'NOT_RECORDED');at=precision==='NOT_RECORDED'?null:d.eventTime?new Date(d.eventTime):null;
  if(precision!=='NOT_RECORDED'&&!at)throw new LabError('EVENT_TIME_REQUIRED',422);
 }else{if(d.copyId||d.eventTime||d.eventPrecision)throw new LabError('DIRECT_ENTRY_SERVER_TIME',422);precision='MINUTE';}
 if(at&&at>now)throw new LabError('EVENT_TIME_FUTURE',422);
 const anchor=ev.find(e=>e.event_type===(['QC2','STD1','STD2'].includes(d.field)?'END':'START'))!;
 if(at&&at<new Date(anchor.created_at))throw new LabError('EVENT_BEFORE_EXECUTION_ANCHOR',422);
 const o=(await db.query<{id:string}>(`INSERT INTO p4b_pool_observation(pool_id,field,slot,value,source,copy_id,event_time,event_precision,recorded_by,supersedes_id,reason)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,[p.id,d.field,d.slot??null,JSON.stringify(d.value),d.source,d.copyId??null,at,precision,user.id,d.supersedesId??null,d.reason??null])).rows[0];
 await audit(db,user,'POOL_OBSERVATION_RECORDED','p4b_pool_observation',o.id,{outcome:'PENDING_RECONCILIATION'});
 return {id:o.id,version:await touch(db,p.batch_id)};
}
export async function reviewPoolObservation(db:Queryable,user:Staff,input:unknown){
 const d=common.extend({observationId:uuid,result:z.enum(['Confirmed','Discrepancy']),note:reasonText}).parse(input);
 const {p,ev}=await context(db,user,d,'observation.verify');
 if(has(ev,'COMPLETED'))throw new LabError('POOL_COMPLETED_IMMUTABLE',409);
 const o=(await observations(db,p.id)).find(o=>o.id===d.observationId);
 if(!o||o.review)throw new LabError('OBSERVATION_NOT_PENDING',409);if(o.recorded_by===user.id)throw new LabError('SECOND_PERSON_REQUIRED',403);
 await db.query('INSERT INTO p4b_pool_review(observation_id,result,reviewer_id,note) VALUES($1,$2,$3,$4)',[o.id,d.result,user.id,d.note]);
 if(d.result==='Discrepancy')await event(db,user,p.id,'HOLD',{reason:'OBSERVATION_DISCREPANCY',observationId:o.id});
 await audit(db,user,'POOL_OBSERVATION_REVIEWED','p4b_pool_observation',o.id,{outcome:d.result});
 return {version:await touch(db,p.batch_id)};
}
export async function decideQc2(db:Queryable,user:Staff,input:unknown){
 const d=common.extend({decision:z.enum(['Hold','Remeasure','Failed','SyntheticReviewed']),criteriaVersion:z.literal(QC2_CRITERIA),reason:reasonText}).parse(input);
 const {p,ev}=await context(db,user,d,'qc.accept');if(has(ev,'COMPLETED'))throw new LabError('POOL_COMPLETED_IMMUTABLE',409);
 const obs=await observations(db,p.id),qc=obs.find(o=>o.field==='QC2');
 if(!qc||qc.review?.result!=='Confirmed'||!['STD1','STD2'].every(f=>obs.some(o=>o.field===f&&o.review?.result==='Confirmed')))throw new LabError('QC2_VERIFIED_EVIDENCE_REQUIRED',409);
 if(qc.recorded_by===user.id)throw new LabError('SECOND_PERSON_REQUIRED',403);
 const previous=(await db.query<{decision:string;observation_id:string}>('SELECT decision,observation_id FROM p4b_qc2_decision WHERE pool_id=$1 ORDER BY sequence DESC LIMIT 1',[p.id])).rows[0];
 if(previous?.decision==='Remeasure'&&previous.observation_id===qc.id)throw new LabError('QC2_REMEASUREMENT_REQUIRED',409);
 const id=(await db.query<{id:string}>('INSERT INTO p4b_qc2_decision(pool_id,observation_id,decision,criteria_version,reason,actor_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING id',[p.id,qc.id,d.decision,d.criteriaVersion,d.reason,user.id])).rows[0].id;
 if(['Failed','Hold'].includes(d.decision))await event(db,user,p.id,'HOLD',{reason:'QC2_'+d.decision.toUpperCase(),decisionId:id});
 await audit(db,user,'POOL_QC2_DECIDED','p4b_qc2_decision',id,{outcome:d.decision,ruleVersion:QC2_CRITERIA});return {id,version:await touch(db,p.batch_id)};
}
export async function workspace(db:Queryable,user:Staff,batchId:string){
 await assertSession(db,user);need(user,'worksheet.read','read');
 const b=(await db.query<{id:string;run_label:string;version:number}>('SELECT id,run_label,version FROM lab_batch WHERE id=$1 FOR UPDATE',[uuid.parse(batchId)])).rows[0];if(!b)throw new LabError('NOT_FOUND',404);
 const pools=(await db.query<PoolRow>('SELECT * FROM p4b_pool_attempt WHERE batch_id=$1 ORDER BY attempt_number DESC',[b.id])).rows;
 const current=pools[0];if(!current)return {batchId:b.id,runLabel:b.run_label,version:b.version,operational:await operationalWorkflow(db),holds:HOLDS,pools:[],current:null};
 const ev=await events(db,current.id),source=await poolingSource(db,b.id,current.payload.calculation.scenario.controls);
 const stop=stopped(ev)||source.sourceHash!==current.source_sha256;
 const passed=has(ev,'CROSSCHECK_PASS');
 // Blind check: API and browser never receive the expected values until a check has been submitted.
 const {calculation,...payload}=current.payload;
 const obs=await observations(db,current.id);
 const snapshots=(await db.query<{id:string;sha256:string;payload:Record<string,unknown>}>('SELECT id,sha256,payload FROM p4b_pool_snapshot WHERE pool_id=$1',[current.id])).rows;
 const halosExports=(await db.query('SELECT e.id,e.revision,e.dnb_date,e.file_sha256,EXISTS(SELECT 1 FROM p4b_halos_verification v WHERE v.export_id=e.id) verified FROM p4b_halos_export e JOIN p4b_pool_snapshot s ON s.id=e.pool_snapshot_id WHERE s.pool_id=$1 ORDER BY e.revision DESC',[current.id])).rows;
 const documents=(await db.query<{id:string;kind:string;revision:number;file_sha256:string;issued_at:Date;nativeMaster:boolean}>(`SELECT id,kind,revision,file_sha256,issued_at,COALESCE(snapshot->>'nativeMaster'='true',false) AS "nativeMaster" FROM p4b_document WHERE pool_id=$1 ORDER BY issued_at`,[current.id])).rows;
 const copies=(await db.query('SELECT c.* FROM p4b_document_copy c JOIN p4b_document d ON d.id=c.document_id WHERE d.pool_id=$1 ORDER BY c.created_at',[current.id])).rows;
 return {batchId:b.id,runLabel:b.run_label,version:b.version,operational:await operationalWorkflow(db),holds:HOLDS,pools:pools.map(p=>({id:p.id,attemptNumber:p.attempt_number,sha256:p.sha256})),
  current:{id:current.id,revision:current.revision,sha256:current.sha256,payload,selectedSlots:current.selected_slots,seed:current.seed,
   calculation:passed?calculation:null,scenario:calculation.scenario,stopUse:stop,crosschecked:passed,events:ev,observations:obs,documents,copies,snapshots,halosExports,
   state:stop?'STOP_USE':has(ev,'ACCEPTED')?'Accepted':has(ev,'COMPLETED')?'SYNTHETIC_COMPLETED':has(ev,'HOLD')?'HOLD':has(ev,'END')?'QC2':has(ev,'START')?'IN_EXECUTION':has(ev,'PRE_WORK')?'PRE_WORK':'DRAFT',acceptance:has(ev,'ACCEPTED')?'Accepted':'HOLD',exportAllowed:!stop&&has(ev,'ACCEPTED')}};
}
export {context,event,touch,events,has,getPool,stopped,common};
