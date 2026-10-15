import {z} from 'zod';
import type {Queryable} from '../db/connection';
import {LabError,assertSession,need,uuid,audit,bangkokToday,dbClock,type Staff} from '../lab/core';
import {lockBatch} from '../lab/batch';
import {digest} from '../pooling/calculation';
import {getPool,poolingSource,events as poolEvents,stopped as poolStopped,type PoolRow} from '../pooling/service';
import {buildHalosCellPlan,CONTRACT,TEMPLATE_SHA256,type HalosCellPlan} from '../halos-export/contract';
import * as schema from './schemas';
import {operationalWorkflow} from '../lab/operational';
import {operationalHalos} from '../pooling/halos';
export {HOLDS,QC3_CRITERIA,QC4_CRITERIA,common} from './schemas';

export type PoolSnapshot={id:string;pool_id:string;revision:number;payload:PoolRow['payload']&{exportAllowed:boolean;calculationSha256?:string};sha256:string};
export type DnbRow={id:string;batch_id:string;pool_snapshot_id:string;attempt_number:number;revision:number;supersedes_id:string|null;actual_date:string;
 dnb_label:string;preparation:schema.Preparation;payload:{synthetic:boolean;clinicalUsable:false;acceptance:'HOLD';holds:readonly string[];poolSnapshotHash:string;poolSnapshotRevision:number;qubit:ReturnType<typeof qubitCalculation>;idProvenance:Record<string,unknown>};
 sha256:string;source_sha256:string;created_by:string;created_at:Date};
export type DnbEvent={id:string;sequence:number;dnb_id:string;event_type:string;payload:Record<string,unknown>;actor_id:string|null;created_at:Date};
export type DnbObservation={id:string;sequence:number;dnb_id:string;field:'STD1'|'STD2'|'QC3';value:string;unit:'ng/uL';source:string;copy_id:string|null;event_time:Date|null;
 event_precision:string;paper_operator:string|null;paper_evidence_hash:string|null;recorded_by:string;recorded_at:Date;supersedes_id:string|null;review:{result:string;reviewer_id:string;created_at:Date}|null};
export type HandoffRow={id:string;dnb_id:string;revision:number;source_sha256:string;sha256:string;file_sha256:string|null;mapping_status:'MAPPING_UNAVAILABLE'|'synthetic-fixture-unverified';
 payload:{purpose:'SYNTHETIC_SIMULATION';vendorCompatible:false;dnbLabel:string;poolSnapshotId:string;poolSnapshotHash:string;placements:PoolRow['payload']['placements'];
 members:ReturnType<typeof orderedSourceMembers>;mappedMembers:schema.FixtureMember[];manifest:Record<string,unknown>;cellPlan:HalosCellPlan|null;mappingEvidenceReference:string|null};created_by:string;created_at:Date};
export type SequenceRow={id:string;dnb_id:string;attempt_number:number;record:Omit<z.infer<typeof schema.sequencingSchema>,'batchId'|'dnbId'|'requestId'|'expectedVersion'>;created_by:string;created_at:Date};

/** FS-10 uses WI formula, not its contradictory N=3 printed table (955). No clinical acceptance. */
export function qubitCalculation(samples:unknown){const n=z.number().int().min(1).max(48).parse(samples);return {formulaVersion:'FS-10-WI-BM19-v1',samples:n,standardTubes:2,totalTubes:n+2,
 bufferUl:(n+2)*199,dyeUl:n+2,totalUl:(n+2)*200,formula:'Buffer=(N+2)*199; Dye=N+2',source:'WI-T-BM19 §10.3.7.3',warning:'WC-14_TABLE_CONFLICT_955_VS_995',approved:false};}
export function stability(end:Date|string|null,now=new Date()){
 const elapsed=end?now.valueOf()-new Date(end).valueOf():null;
 return {temperatureC:4,limitHours:48,elapsedHours:elapsed===null?null:elapsed/3600000,status:elapsed===null?'PRODUCT_TIME_UNAVAILABLE':elapsed<0?'INVALID_TIME':elapsed>48*3600000?'OUTSIDE_PROPOSED_WINDOW':'WITHIN_PROPOSED_WINDOW',
 informationalOnly:true,clinicalAccepted:false,ownerHold:'OD-33'};
}
export const has=(ev:DnbEvent[],type:string)=>ev.some(e=>e.event_type===type);
export const stopped=(ev:DnbEvent[])=>ev.some(e=>['STOP_USE','SUPERSEDED','HOLD'].includes(e.event_type));
export async function events(db:Queryable,id:string){return (await db.query<DnbEvent>('SELECT * FROM p4c_dnb_event WHERE dnb_id=$1 ORDER BY sequence',[id])).rows;}
export async function observations(db:Queryable,id:string){return (await db.query<DnbObservation>(`SELECT o.*,(SELECT row_to_json(r) FROM p4c_dnb_review r WHERE r.observation_id=o.id) review
 FROM p4c_dnb_observation o WHERE dnb_id=$1 AND NOT EXISTS(SELECT 1 FROM p4c_dnb_observation x WHERE x.supersedes_id=o.id) ORDER BY sequence`,[id])).rows;}
export async function appendEvent(db:Queryable,user:Staff,dnbId:string,type:string,payload:Record<string,unknown>={}){
 const id=(await db.query<{id:string}>('INSERT INTO p4c_dnb_event(dnb_id,event_type,payload,actor_id) VALUES($1,$2,$3,$4) RETURNING id',[dnbId,type,JSON.stringify(payload),user.id])).rows[0].id;
 await audit(db,user,'DNB_'+type,'p4c_dnb_attempt',dnbId,{outcome:'SYNTHETIC_HOLD'});return id;
}
export async function touch(db:Queryable,id:string){return (await db.query<{version:number}>('UPDATE lab_batch SET version=version+1 WHERE id=$1 RETURNING version',[id])).rows[0].version;}
export async function getDnb(db:Queryable,batchId:string,id:string){const row=(await db.query<DnbRow>('SELECT *,actual_date::text FROM p4c_dnb_attempt WHERE id=$1 AND batch_id=$2',[id,batchId])).rows[0];
 if(!row)throw new LabError('NOT_FOUND',404);if(digest(row.payload)!==row.sha256)throw new LabError('DNB_HASH_MISMATCH',409);return row;}
export async function storedPool(db:Queryable,batchId:string,snapshotId:string){
 const snapshot=(await db.query<PoolSnapshot>('SELECT * FROM p4b_pool_snapshot WHERE id=$1',[snapshotId])).rows[0];if(!snapshot)throw new LabError('POOL_SNAPSHOT_NOT_FOUND',404);
 const p=await getPool(db,batchId,snapshot.pool_id),ev=await poolEvents(db,p.id);
 if(digest(snapshot.payload)!==snapshot.sha256||snapshot.payload.calculationSha256!==undefined&&snapshot.payload.calculationSha256!==p.sha256)throw new LabError('POOL_SNAPSHOT_HASH_MISMATCH',409);
 if(!(snapshot.payload.acceptance==='Accepted'&&!snapshot.payload.synthetic&&snapshot.payload.exportAllowed===true&&ev.some(e=>e.event_type==='ACCEPTED'))&&(!ev.some(e=>e.event_type==='COMPLETED')||snapshot.payload.acceptance!=='HOLD'||snapshot.payload.exportAllowed!==false))throw new LabError('COMPLETED_HOLD_POOL_REQUIRED',409);
 const source=await poolingSource(db,batchId,p.payload.calculation.scenario.controls);
 if(poolStopped(ev)||ev.some(e=>e.event_type==='HOLD')||source.sourceHash!==p.source_sha256)throw new LabError('POOL_STOP_USE',409);
 if(digest(source.placements)!==digest(snapshot.payload.placements)||digest(source.members)!==digest(snapshot.payload.members))throw new LabError('PLACEMENT_OR_MEMBERS_CHANGED',409);
 if((await db.query("SELECT 1 FROM p4b_document_copy c JOIN p4b_document doc ON doc.id=c.document_id WHERE doc.pool_id=$1 AND c.kind='WORKING_COPY' AND EXISTS(SELECT 1 FROM p4b_pool_event e WHERE e.pool_id=$1 AND e.event_type='RECALL' AND e.payload->>'copyId'=c.id::text)",[p.id])).rows.length)throw new LabError('POOL_RECALLED',409);
 return {snapshot,p,source};
}
export async function acceptedPoolAdapter(db:Queryable,user:Staff,input:unknown){await assertSession(db,user);need(user,'handoff.create');const d=z.strictObject({batchId:uuid,poolSnapshotId:uuid}).parse(input);
 await lockBatch(db,d.batchId);await storedPool(db,d.batchId,d.poolSnapshotId);throw new LabError('POOL_ACCEPTED_REQUIRED',423,schema.HOLDS);}
export async function context(db:Queryable,user:Staff,d:z.infer<typeof schema.common>,permission='execution.record'){
 await assertSession(db,user);need(user,permission);const b=await lockBatch(db,d.batchId,d.expectedVersion),dnb=await getDnb(db,b.id,d.dnbId),ev=await events(db,dnb.id);
 const pool=await storedPool(db,b.id,dnb.pool_snapshot_id);
 if(stopped(ev)||dnb.source_sha256!==pool.snapshot.sha256)throw new LabError('DNB_STOP_USE',409);
 const obs=await observations(db,dnb.id),handoffs=(await db.query<HandoffRow>('SELECT * FROM p4c_handoff WHERE dnb_id=$1 ORDER BY revision DESC',[dnb.id])).rows;
 const sequences=(await db.query<SequenceRow>('SELECT * FROM p4c_sequencing_attempt WHERE dnb_id=$1 ORDER BY attempt_number DESC',[dnb.id])).rows;
 return {b,dnb,ev,obs,pool,handoffs,sequences,evidenceHash:digest({dnbHash:dnb.sha256,observations:obs,handoffs,sequences,events:ev.filter(e=>!['PREVIEW','RECALL'].includes(e.event_type))})};
}
type Result={id?:string;version:number;[key:string]:unknown};
/** Caller owns one DB transaction, as in all P4 services. Batch lock serializes source mutations and replay. */
async function command<T extends z.infer<typeof schema.command>>(db:Queryable,user:Staff,d:T,permission:string,name:string,run:(ctx:Awaited<ReturnType<typeof context>>)=>Promise<Record<string,unknown>>):Promise<Result>{
 await assertSession(db,user);need(user,permission);await lockBatch(db,d.batchId);
 const inputHash=digest({operation:name,input:d}),old=(await db.query<{actor_id:string;input_sha256:string;result:Result}>('SELECT * FROM p4c_command WHERE request_id=$1',[d.requestId])).rows[0];
 if(old){if(old.actor_id!==user.id||old.input_sha256!==inputHash)throw new LabError('IDEMPOTENCY_CONFLICT',409);return old.result;}
 const ctx=await context(db,user,d,permission),data=await run(ctx),result={...data,version:await touch(db,d.batchId)};
 await db.query('INSERT INTO p4c_command(request_id,dnb_id,actor_id,input_sha256,result) VALUES($1,$2,$3,$4,$5)',[d.requestId,d.dnbId,user.id,inputHash,JSON.stringify(result)]);return result;
}
export async function createDnb(db:Queryable,user:Staff,input:unknown):Promise<Result>{
 const d=schema.createSchema.parse(input);await assertSession(db,user);need(user,'execution.record');await lockBatch(db,d.batchId);
 const inputHash=digest({operation:'CREATE_DNB',input:d}),oldCommand=(await db.query<{actor_id:string;input_sha256:string;result:Result}>('SELECT * FROM p4c_command WHERE request_id=$1',[d.requestId])).rows[0];
 if(oldCommand){if(oldCommand.actor_id!==user.id||oldCommand.input_sha256!==inputHash)throw new LabError('IDEMPOTENCY_CONFLICT',409);return oldCommand.result;}
 const b=await lockBatch(db,d.batchId,d.expectedVersion),pool=await storedPool(db,b.id,d.poolSnapshotId);
 const operational=await operationalWorkflow(db);
 if(d.purpose==='OPERATIONAL'?(!operational||pool.snapshot.payload.acceptance!=='Accepted'||pool.snapshot.payload.synthetic):(operational||!pool.snapshot.payload.synthetic))throw new LabError('POOL_ACCEPTED_REQUIRED',423,schema.HOLDS);
 if(operational&&(d.preparation.method!=='CONTROLLED_PROTOCOL'||!d.preparation.protocolEvidence))throw new LabError('CONTROLLED_DNB_PROTOCOL_REQUIRED',422);
 if(d.actualDate!==bangkokToday())throw new LabError('ACTUAL_DNB_DATE_REQUIRED',422);
 if(d.preparation.operatorId!==user.id)throw new LabError('ACTUAL_OPERATOR_REQUIRED',422);
 if(d.preparation.lots.some(l=>l.expiry<d.actualDate))throw new LabError('REAGENT_EXPIRED',422);
 const prior=(await db.query<DnbRow>('SELECT * FROM p4c_dnb_attempt WHERE batch_id=$1 ORDER BY attempt_number DESC LIMIT 1',[b.id])).rows[0];
 if(prior){if(!stopped(await events(db,prior.id)))throw new LabError('ACTIVE_DNB_EXISTS',409);
  if(await pendingRecall(db,prior.id))throw new LabError('RECALL_PENDING',409);
  await appendEvent(db,user,prior.id,'SUPERSEDED',{reason:d.reason});}
 const n=(prior?.attempt_number??0)+1,label=`DNB${d.actualDate.replaceAll('-','')}`;
 const payload={synthetic:!operational,clinicalUsable:false as const,acceptance:'HOLD' as const,holds:schema.HOLDS,poolSnapshotHash:pool.snapshot.sha256,poolSnapshotRevision:pool.snapshot.revision,
  qubit:qubitCalculation(d.preparation.qubitSamples),idProvenance:{format:'DNBYYYYMMDD',actualDate:d.actualDate,dateBasis:'actual',serverRecordedAt:new Date().toISOString(),operatorId:user.id,
   attemptNumber:n,ownerHold:'OD-34_SAME_DAY_MULTIPLE_RUN_ID_UNRESOLVED'},lineage:{poolSnapshotId:pool.snapshot.id,poolId:pool.p.id,placementSnapshots:pool.snapshot.payload.placements,supersedesDnbId:prior?.id??null},preparation:d.preparation};
 const id=(await db.query<{id:string}>(`INSERT INTO p4c_dnb_attempt(batch_id,pool_snapshot_id,attempt_number,supersedes_id,purpose,actual_date,dnb_label,preparation,payload,sha256,source_sha256,reason,created_by)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,[b.id,pool.snapshot.id,n,prior?.id??null,d.purpose,d.actualDate,label,JSON.stringify(d.preparation),JSON.stringify(payload),digest(payload),pool.snapshot.sha256,d.reason,user.id])).rows[0].id;
 await audit(db,user,'DNB_CREATED','p4c_dnb_attempt',id,{outcome:'SYNTHETIC_HOLD',count:n});const result={id,version:await touch(db,b.id)};
 await db.query('INSERT INTO p4c_command(request_id,dnb_id,actor_id,input_sha256,result) VALUES($1,$2,$3,$4,$5)',[d.requestId,id,user.id,inputHash,JSON.stringify(result)]);return result;
}
async function pendingRecall(db:Queryable,dnbId:string){if(!(await db.query<{table:string|null}>("SELECT to_regclass('public.p4c_document_copy')::text AS table")).rows[0].table)return false;
 return !!(await db.query("SELECT 1 FROM p4c_document_copy c JOIN p4c_document d ON d.id=c.document_id WHERE d.dnb_id=$1 AND c.kind='WORKING_COPY' AND NOT EXISTS(SELECT 1 FROM p4c_dnb_event e WHERE e.dnb_id=$1 AND e.event_type='RECALL' AND e.payload->>'copyId'=c.id::text)",[dnbId])).rows.length;}
export async function transition(db:Queryable,user:Staff,input:unknown){const d=schema.transitionSchema.parse(input);
 return command(db,user,d,d.transition==='STOP_USE'?'worksheet.revise':'execution.record','TRANSITION',async c=>{
  if(d.transition==='DNB_START'&&(has(c.ev,'DNB_START')||!(await operationalWorkflow(db)?!!c.dnb.preparation.protocolEvidence:has(c.ev,'PRE_WORK'))))throw new LabError('SYNTHETIC_PRE_WORK_REQUIRED',409);
  if(d.transition==='DNB_START'&&(c.dnb.actual_date!==bangkokToday()||!c.dnb.preparation.preclean||!c.dnb.preparation.loadingReagentPrepared||c.dnb.preparation.lots.some(l=>l.expiry<bangkokToday())))throw new LabError('CURRENT_PREPARATION_REQUIRED',409);
  if(d.transition==='DNB_END'&&(!has(c.ev,'DNB_START')||has(c.ev,'DNB_END')))throw new LabError('DNB_NOT_IN_EXECUTION',409);
  await appendEvent(db,user,c.dnb.id,d.transition,{reason:d.reason});return {};
 });}
async function paperTime(db:Queryable,dnbId:string,d:{source:string;copyId?:string;eventTime?:string|null;eventPrecision?:string},anchor:Date|string){
 const now=await dbClock(db);if(d.source==='DIRECT_ENTRY'){if(d.copyId||d.eventTime!==undefined||d.eventPrecision)throw new LabError('DIRECT_ENTRY_SERVER_TIME',422);return {at:now,precision:'MINUTE'};}
 if(!d.copyId||!(await db.query<{usable:boolean}>('SELECT p4c_paper_usable($1,$2) usable',[dnbId,d.copyId])).rows[0].usable)throw new LabError('WORKING_COPY_NOT_USABLE',409);
 const precision=d.eventPrecision??(d.eventTime?'MINUTE':'NOT_RECORDED'),at=precision==='NOT_RECORDED'?null:d.eventTime?new Date(d.eventTime):null;
 if(precision==='NOT_RECORDED'&&d.eventTime||precision!=='NOT_RECORDED'&&!at)throw new LabError('EVENT_TIME_REQUIRED',422);
 if(at&&(at>now||at<new Date(anchor)))throw new LabError('EVENT_TIME_OUTSIDE_EXECUTION',422);return {at,precision};
}
export async function recordObservation(db:Queryable,user:Staff,input:unknown){const d=schema.observationSchema.parse(input);
 return command(db,user,d,'qc.record','OBSERVE',async c=>{
  const end=c.ev.find(e=>e.event_type==='DNB_END');if(!end)throw new LabError('DNB_PRODUCT_REQUIRED',409);if(has(c.ev,'COMPLETED'))throw new LabError('DNB_COMPLETED_IMMUTABLE',409);
  if(c.handoffs.length)throw new LabError('HANDOFF_FROZEN_NEW_DNB_REQUIRED',409);
  const old=c.obs.find(o=>o.field===d.field);if((old?.id??undefined)!==d.supersedesId||old&&!d.reason)throw new LabError('OBSERVATION_REQUIRES_EXACT_SUPERSESSION',409);
  if(d.source==='PAPER_TRANSCRIPTION'&&(!d.paperOperator||!d.paperEvidenceHash))throw new LabError('PAPER_PROVENANCE_REQUIRED',422);
  if(d.source==='DIRECT_ENTRY'&&(d.paperOperator||d.paperEvidenceHash))throw new LabError('DIRECT_ENTRY_PAPER_PROVENANCE_FORBIDDEN',422);
  const time=await paperTime(db,c.dnb.id,d,end.created_at);
  const id=(await db.query<{id:string}>(`INSERT INTO p4c_dnb_observation(dnb_id,field,value,unit,source,copy_id,event_time,event_precision,paper_operator,paper_evidence_hash,recorded_by,supersedes_id,reason)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,[c.dnb.id,d.field,d.value,d.unit,d.source,d.copyId??null,time.at,time.precision,d.paperOperator??null,d.paperEvidenceHash??null,user.id,d.supersedesId??null,d.reason??null])).rows[0].id;
  await audit(db,user,'DNB_OBSERVATION_RECORDED','p4c_dnb_observation',id,{outcome:'PENDING_RECONCILIATION'});return {id};
 });}
export async function reviewObservation(db:Queryable,user:Staff,input:unknown){const d=schema.reviewSchema.parse(input);
 return command(db,user,d,'observation.verify','REVIEW',async c=>{
  const o=c.obs.find(o=>o.id===d.observationId);if(!o||o.review)throw new LabError('OBSERVATION_NOT_PENDING',409);if(o.recorded_by===user.id)throw new LabError('SECOND_PERSON_REQUIRED',403);
  if(d.result==='Confirmed'&&!o.event_time)throw new LabError('UNKNOWN_EVENT_TIME_DISCREPANCY',409);
  await db.query('INSERT INTO p4c_dnb_review(observation_id,result,reviewer_id,note) VALUES($1,$2,$3,$4)',[o.id,d.result,user.id,d.note]);
  if(d.result==='Discrepancy')await appendEvent(db,user,c.dnb.id,'HOLD',{reason:'QC3_OBSERVATION_DISCREPANCY',observationId:o.id});
  await audit(db,user,'DNB_OBSERVATION_REVIEWED','p4c_dnb_observation',o.id,{outcome:d.result});return {};
 });}
export async function qc3Evidence(db:Queryable,dnbId:string){const obs=await observations(db,dnbId),qc3=obs.find(o=>o.field==='QC3'),decision=(await db.query<{id:string;decision:string;observation_id:string;actor_id:string;created_at:Date}>('SELECT * FROM p4c_qc3_decision WHERE dnb_id=$1 ORDER BY sequence DESC LIMIT 1',[dnbId])).rows[0];
 return {obs,decision:decision??null,ready:!!qc3&&['STD1','STD2','QC3'].every(f=>obs.some(o=>o.field===f&&o.review?.result==='Confirmed'&&o.event_time))&&['SyntheticReviewed','Accepted'].includes(decision?.decision??'')&&decision.observation_id===qc3.id};}
export async function decideQc3(db:Queryable,user:Staff,input:unknown){const d=schema.qc3Schema.parse(input);
 if(d.decision==='Accepted'&&!await operationalWorkflow(db))throw new LabError('OWNER_DECISIONS_HOLD',423);
 return command(db,user,d,'qc.accept','QC3_DECISION',async c=>{
  if(c.handoffs.length)throw new LabError('HANDOFF_FROZEN_NEW_DNB_REQUIRED',409);
  const qc=c.obs.find(o=>o.field==='QC3');if(!qc||!['STD1','STD2','QC3'].every(f=>c.obs.some(o=>o.field===f&&o.review?.result==='Confirmed')))throw new LabError('QC3_VERIFIED_EVIDENCE_REQUIRED',409);
  if(qc.recorded_by===user.id)throw new LabError('SECOND_PERSON_REQUIRED',403);
  const previous=(await qc3Evidence(db,c.dnb.id)).decision;if(previous?.decision==='Remeasure'&&previous.observation_id===qc.id)throw new LabError('QC3_REMEASUREMENT_REQUIRED',409);
  const id=(await db.query<{id:string}>('INSERT INTO p4c_qc3_decision(dnb_id,observation_id,decision,criteria_version,reason,actor_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING id',[c.dnb.id,qc.id,d.decision,d.criteriaVersion,d.reason,user.id])).rows[0].id;
  if(['Hold','Failed'].includes(d.decision))await appendEvent(db,user,c.dnb.id,'HOLD',{reason:'QC3_'+d.decision.toUpperCase(),decisionId:id});
  await audit(db,user,'DNB_QC3_DECIDED','p4c_qc3_decision',id,{outcome:d.decision,ruleVersion:schema.QC3_CRITERIA});return {id};
 });}
export function orderedSourceMembers(pool:PoolSnapshot){return pool.payload.members.map((m,i)=>({order:i+1,memberKey:m.attemptId??`${m.kind}:${m.slot}`,physicalPosition:m.slot,plate:m.plate,
 role:m.kind,printedSampleId:m.printedSampleId??m.printedControlId??null,lnHalos:m.lnHalos??null,placementBarcode:m.barcode,halosBarcode:null,
 sourceQc1Id:m.qc1.id,attemptId:m.attemptId??null,roundId:m.roundId??null}));}
export async function createHandoff(db:Queryable,user:Staff,input:unknown){const d=schema.handoffSchema.parse(input);
 return command(db,user,d,'handoff.create','CREATE_HANDOFF',async c=>{
  if(!(await qc3Evidence(db,c.dnb.id)).ready)throw new LabError('QC3_SYNTHETIC_REVIEW_REQUIRED',409);
  if(c.sequences.some(s=>c.ev.some(e=>e.event_type==='SEQUENCE_START'&&e.payload.sequencingId===s.id)))throw new LabError('SEQUENCE_STARTED_HANDOFF_FROZEN',409);
  const members=orderedSourceMembers(c.pool.snapshot),revision=(c.handoffs[0]?.revision??0)+1;
  let plan:HalosCellPlan|null=null;
  if(d.mapping){
   if(members.length!==47)throw new LabError('MAPPING_UNAVAILABLE_PARTIAL_SOURCE',409);
   for(const supplied of d.mapping.members){const source=members.find(m=>m.memberKey===supplied.memberKey);
    if(!source||source.physicalPosition!==supplied.physicalPosition||source.role!==supplied.role||source.printedSampleId!==supplied.printedSampleId||source.role==='PATIENT'&&source.lnHalos!==supplied.lnHalos)throw new LabError('MAPPING_SOURCE_IDENTITY_MISMATCH',409);}
   if(new Set(d.mapping.members.map(m=>m.memberKey)).size!==members.length)throw new LabError('MAPPING_MEMBER_MISMATCH',409);
   plan=buildHalosCellPlan({contract:CONTRACT,mode:'synthetic',mappingStatus:d.mapping.status,batch:{id:c.b.id,revision:c.b.version},
    placement:{id:digest(c.pool.snapshot.payload.placements),revision:1},pool:{id:c.pool.snapshot.id,revision:c.pool.snapshot.revision},handoffRevision:revision,templateSha256:TEMPLATE_SHA256,
    dnb:{id:c.dnb.dnb_label,workDate:c.dnb.actual_date,dateBasis:'actual'},excludedBlank:{physicalPosition:40,role:'BLANK'},members:d.mapping.members});
  }
  const fileHash=plan?digest(plan):null,createdAt=new Date().toISOString(),mappingStatus=plan?'synthetic-fixture-unverified':'MAPPING_UNAVAILABLE';
  const payload={purpose:'SYNTHETIC_SIMULATION' as const,vendorCompatible:false as const,dnbLabel:c.dnb.dnb_label,poolSnapshotId:c.pool.snapshot.id,poolSnapshotHash:c.pool.snapshot.sha256,
   placements:c.pool.snapshot.payload.placements,members,mappedMembers:d.mapping?.members??[],mappingEvidenceReference:d.mapping?.evidenceReference??null,cellPlan:plan,
   manifest:{revision,count:members.length,orderedMembersHash:digest(members),mappedMembersHash:digest(d.mapping?.members??[]),fileHash,fileKind:'INTERNAL_JSON_CELL_PLAN_NO_VENDOR_FILE',
    templateSha256:TEMPLATE_SHA256,createdBy:user.id,createdAt,acceptance:'HOLD',mappingStatus,holds:schema.HOLDS}};
  const id=(await db.query<{id:string}>('INSERT INTO p4c_handoff(dnb_id,revision,source_sha256,payload,sha256,file_sha256,mapping_status,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id',
   [c.dnb.id,revision,c.evidenceHash,JSON.stringify(payload),digest(payload),fileHash,mappingStatus,user.id])).rows[0].id;
  await audit(db,user,'DNB_HANDOFF_CREATED','p4c_handoff',id,{outcome:mappingStatus,count:members.length});return {id,mappingStatus,fileHash};
 });}
async function currentHandoff(db:Queryable,c:Awaited<ReturnType<typeof context>>,id:string){const h=c.handoffs[0];if(!h||h.id!==id)throw new LabError('HANDOFF_NOT_CURRENT',409);
 if(digest(h.payload)!==h.sha256||h.file_sha256!==null&&digest(h.payload.cellPlan)!==h.file_sha256)throw new LabError('HANDOFF_HASH_MISMATCH',409);
 if(h.mapping_status!=='synthetic-fixture-unverified')throw new LabError('MAPPING_UNAVAILABLE',423);
 if(!(await qc3Evidence(db,c.dnb.id)).ready)throw new LabError('QC3_SYNTHETIC_REVIEW_REQUIRED',409);return h;}
export async function transferHandoff(db:Queryable,user:Staff,input:unknown){const d=schema.transferSchema.parse(input);
 return command(db,user,d,'handoff.create','TRANSFER_HANDOFF',async c=>{
  const h=await currentHandoff(db,c,d.handoffId);if(d.fileHash!==h.file_sha256)throw new LabError('HANDOFF_FILE_HASH_MISMATCH',409);
  const id=(await db.query<{id:string}>('INSERT INTO p4c_handoff_transfer(handoff_id,file_sha256,status,evidence_hash,evidence_reference,actor_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING id',[h.id,d.fileHash,d.status,d.evidenceHash,d.evidenceReference,user.id])).rows[0].id;
  await audit(db,user,'DNB_HANDOFF_TRANSFER_RECORDED','p4c_handoff_transfer',id,{outcome:'SIMULATION_'+d.status});return {id};
 });}
/** Every mapped cell/identity/order is compared; no normalization, sorting, repair or status inference. */
export function verificationErrors(expected:schema.FixtureMember[],observed:schema.FixtureMember[],status:string,dnbLabel:string,observedDnbId:string,fileHash:string,observedHash:string){
 const errors:string[]=[];if(status!=='Complete')errors.push('TRANSFER_NOT_COMPLETE');if(dnbLabel!==observedDnbId)errors.push('DNB_ID_MISMATCH');if(fileHash!==observedHash)errors.push('FILE_HASH_MISMATCH');
 if(expected.length!==observed.length)errors.push('COUNT_MISMATCH');
 for(const key of ['memberKey','physicalPosition','exportSampleId','printedSampleId','lnHalos','barcodeIndex'] as const)if(new Set(observed.map(m=>m[key])).size!==observed.length)errors.push('DUPLICATE_'+key);
 if(expected.some(e=>!observed.some(o=>o.memberKey===e.memberKey)))errors.push('MISSING_MEMBER');if(observed.some(o=>!expected.some(e=>e.memberKey===o.memberKey)))errors.push('EXTRA_MEMBER');
 if(digest(expected)!==digest(observed))errors.push('ORDER_OR_IDENTITY_OR_BARCODE_MISMATCH');return errors;
}
export async function verifyHandoff(db:Queryable,user:Staff,input:unknown){const d=schema.verifySchema.parse(input);
 return command(db,user,d,'handoff.verify','VERIFY_HANDOFF',async c=>{
  const h=await currentHandoff(db,c,d.handoffId),transfer=(await db.query<{id:string;actor_id:string;status:string}>('SELECT * FROM p4c_handoff_transfer WHERE handoff_id=$1 ORDER BY sequence DESC LIMIT 1',[h.id])).rows[0];
  if(!transfer||transfer.id!==d.transferId)throw new LabError('TRANSFER_NOT_CURRENT',409);if(transfer.actor_id===user.id)throw new LabError('SECOND_PERSON_REQUIRED',403);
  const errors=verificationErrors(h.payload.mappedMembers,d.observedRows,transfer.status==='Complete'?d.status:transfer.status,c.dnb.dnb_label,d.observedDnbId,h.file_sha256!,d.fileHash),result=errors.length?'MISMATCH':'MATCH';
  const id=(await db.query<{id:string}>('INSERT INTO p4c_handoff_verification(transfer_id,result,observed,errors,evidence_hash,reviewer_id,note) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id',[transfer.id,result,JSON.stringify(d),JSON.stringify(errors),d.evidenceHash,user.id,d.note])).rows[0].id;
  await audit(db,user,'DNB_HANDOFF_VERIFIED','p4c_handoff_verification',id,{outcome:result});return {id,result,errors};
 });}
export async function handoffVerified(db:Queryable,dnbId:string){return (await db.query<{verified:boolean}>('SELECT p4c_handoff_verified($1) verified',[dnbId])).rows[0].verified;}
export async function createSequencing(db:Queryable,user:Staff,input:unknown){const d=schema.sequencingSchema.parse(input);
 if((d.purpose==='OPERATIONAL')!==await operationalWorkflow(db))throw new LabError('RUNTIME_DATA_MODE_MISMATCH',423);
 return command(db,user,d,'execution.record','CREATE_SEQUENCE',async c=>{
  if(!(await qc3Evidence(db,c.dnb.id)).ready)throw new LabError('QC3_SYNTHETIC_REVIEW_REQUIRED',409);
  if(d.wash.expiry<bangkokToday()||d.wash.preparedOn>bangkokToday()||d.wash.expiry<d.wash.preparedOn)throw new LabError('WASH_REAGENT_DATES_INVALID',422);
  const previous=c.sequences[0];if(previous&&!c.ev.some(e=>e.event_type==='SEQUENCE_HOLD'&&e.payload.sequencingId===previous.id))throw new LabError('ACTIVE_SEQUENCING_ATTEMPT',409);
  const {batchId:_batchId,dnbId:_dnbId,requestId:_requestId,expectedVersion:_expectedVersion,...record}=d;
  void _batchId;void _dnbId;void _requestId;void _expectedVersion;
  const id=(await db.query<{id:string}>('INSERT INTO p4c_sequencing_attempt(dnb_id,attempt_number,supersedes_id,record,created_by) VALUES($1,$2,$3,$4,$5) RETURNING id',[c.dnb.id,(previous?.attempt_number??0)+1,previous?.id??null,JSON.stringify(record),user.id])).rows[0].id;
  await audit(db,user,'DNB_SEQUENCING_CREATED','p4c_sequencing_attempt',id,{outcome:'SYNTHETIC_HOLD'});return {id};
 });}
export async function transitionSequencing(db:Queryable,user:Staff,input:unknown){const d=schema.sequenceTransitionSchema.parse(input);
 return command(db,user,d,'execution.record','TRANSITION_SEQUENCE',async c=>{
  const sequence=c.sequences[0];if(!sequence||sequence.id!==d.sequencingId)throw new LabError('SEQUENCE_NOT_CURRENT',409);
  if(c.ev.some(e=>e.event_type==='SEQUENCE_HOLD'&&e.payload.sequencingId===sequence.id))throw new LabError('SEQUENCE_ON_HOLD',409);
  if(['SEQUENCE_START','ANALYSIS_COMPLETE'].includes(d.transition)&&!await handoffVerified(db,c.dnb.id))throw new LabError('HANDOFF_VERIFICATION_REQUIRED',409);
  if(d.transition==='SEQUENCE_START'){
   if(d.firstCycle||d.postWash)throw new LabError('SEQUENCE_END_VALUES_ONLY',422);
   if(!(await qc3Evidence(db,c.dnb.id)).ready)throw new LabError('QC3_SYNTHETIC_REVIEW_REQUIRED',409);
   if(sequence.record.wash.expiry<bangkokToday())throw new LabError('WASH_REAGENT_EXPIRED',409);
  }
  if(d.transition==='SEQUENCE_END'&&(!d.firstCycle||!d.postWash))throw new LabError('FIRST_CYCLE_AND_POST_WASH_REQUIRED',422);
  if(d.transition==='ANALYSIS_COMPLETE'){
   if(d.firstCycle||d.postWash)throw new LabError('SEQUENCE_END_VALUES_ONLY',422);
   if(!(await qc4Evidence(db,c.dnb.id,sequence.id)).ready)throw new LabError('QC4_SYNTHETIC_REVIEW_REQUIRED',409);
  }
  await appendEvent(db,user,c.dnb.id,d.transition,{sequencingId:sequence.id,reason:d.reason,...(d.firstCycle?{firstCycle:d.firstCycle,postWash:d.postWash}:{}),acceptance:'HOLD',clinicalUsable:false});return {};
 });}
export type Qc4Observation={id:string;sequencing_id:string;scope:'LANE'|'SAMPLE';member_key:string|null;lane:string;metrics:Record<string,string>;source:string;copy_id:string|null;event_time:Date|null;event_precision:string;recorded_by:string;recorded_at:Date;review:{result:string;reviewer_id:string;created_at:Date}|null};
export async function qc4Evidence(db:Queryable,dnbId:string,sequenceId:string){const observations=(await db.query<Qc4Observation>(`SELECT o.*,(SELECT row_to_json(r) FROM p4c_qc4_review r WHERE r.qc4_id=o.id) review FROM p4c_qc4_observation o
 WHERE sequencing_id=$1 AND NOT EXISTS(SELECT 1 FROM p4c_qc4_observation x WHERE x.supersedes_id=o.id) ORDER BY sequence`,[sequenceId])).rows;
 const h=(await db.query<HandoffRow>('SELECT * FROM p4c_handoff WHERE dnb_id=$1 ORDER BY revision DESC LIMIT 1',[dnbId])).rows[0];
 const operational=await operationalWorkflow(db),members=operational?(await operationalHalos(db,dnbId))?.source.members??[]:h?.payload.mappedMembers??[],accepted=operational?'Accepted':'SyntheticReviewed';return {observations,ready:members.length===47&&observations.some(o=>o.scope==='LANE'&&o.review?.result===accepted)&&members.every(m=>observations.some(o=>o.scope==='SAMPLE'&&o.member_key===m.memberKey&&o.review?.result===accepted))&&observations.every(o=>!!o.event_time&&o.review?.result===accepted)};}
export async function recordQc4(db:Queryable,user:Staff,input:unknown){const d=schema.qc4Schema.parse(input);
 return command(db,user,d,'qc.record','RECORD_QC4',async c=>{
  if(c.sequences[0]?.id!==d.sequencingId)throw new LabError('SEQUENCE_NOT_CURRENT',409);
  if((d.scope==='SAMPLE')!==!!d.memberKey)throw new LabError('QC4_MEMBER_SCOPE',422);
  if(d.scope==='SAMPLE'&&!(await operationalWorkflow(db)?(await operationalHalos(db,c.dnb.id))?.source.members:c.handoffs[0]?.payload.mappedMembers)?.some(m=>m.memberKey===d.memberKey))throw new LabError('QC4_MEMBER_SCOPE',422);
  const end=c.ev.find(e=>e.event_type==='SEQUENCE_END'&&e.payload.sequencingId===d.sequencingId);if(!end)throw new LabError('SEQUENCE_END_REQUIRED',409);
  const old=(await qc4Evidence(db,c.dnb.id,d.sequencingId)).observations.find(o=>o.scope===d.scope&&o.member_key===(d.memberKey??null));if((old?.id??undefined)!==d.supersedesId||old&&!d.reason)throw new LabError('OBSERVATION_REQUIRES_EXACT_SUPERSESSION',409);
  const time=await paperTime(db,c.dnb.id,d,end.created_at),id=(await db.query<{id:string}>(`INSERT INTO p4c_qc4_observation(sequencing_id,scope,member_key,lane,metrics,source,copy_id,event_time,event_precision,evidence_hash,supersedes_id,reason,recorded_by)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,[d.sequencingId,d.scope,d.memberKey??null,d.lane,JSON.stringify(d.metrics),d.source,d.copyId??null,time.at,time.precision,d.evidenceHash,d.supersedesId??null,d.reason??null,user.id])).rows[0].id;
  await audit(db,user,'DNB_QC4_RECORDED','p4c_qc4_observation',id,{outcome:'PENDING_RECONCILIATION'});return {id};
 });}
export async function reviewQc4(db:Queryable,user:Staff,input:unknown){const d=schema.qc4ReviewSchema.parse(input);
 if(d.result==='Accepted'&&!await operationalWorkflow(db))throw new LabError('OWNER_DECISIONS_HOLD',423);
 return command(db,user,d,'qc.accept','REVIEW_QC4',async c=>{
  const seq=c.sequences[0];if(!seq)throw new LabError('NOT_FOUND',404);const o=(await qc4Evidence(db,c.dnb.id,seq.id)).observations.find(o=>o.id===d.qc4Id);
  if(!o||o.review)throw new LabError('QC4_NOT_PENDING',409);if(o.recorded_by===user.id)throw new LabError('SECOND_PERSON_REQUIRED',403);
  if(['SyntheticReviewed','Accepted'].includes(d.result)&&!o.event_time)throw new LabError('UNKNOWN_EVENT_TIME_DISCREPANCY',409);
  await db.query('INSERT INTO p4c_qc4_review(qc4_id,result,criteria_version,note,reviewer_id) VALUES($1,$2,$3,$4,$5)',[o.id,d.result,d.criteriaVersion,d.note,user.id]);
  if(['Hold','Failed'].includes(d.result))await appendEvent(db,user,c.dnb.id,'SEQUENCE_HOLD',{sequencingId:seq.id,reason:'QC4_'+d.result.toUpperCase(),qc4Id:o.id});
  await audit(db,user,'DNB_QC4_REVIEWED','p4c_qc4_observation',o.id,{outcome:d.result});return {};
 });}
export async function operationalGate(db:Queryable,user:Staff,input:unknown){await assertSession(db,user);need(user,'pool.approve');const d=schema.common.parse(input);
 await lockBatch(db,d.batchId,d.expectedVersion);await getDnb(db,d.batchId,d.dnbId);throw new LabError('OWNER_DECISIONS_HOLD',423,schema.HOLDS);}
export async function recallCopy(db:Queryable,user:Staff,input:unknown){const d=schema.command.extend({copyId:uuid,reason:schema.reviewSchema.shape.note}).parse(input);
 await assertSession(db,user);need(user,'document.recall');const b=(await db.query<{version:number;state:string}>('SELECT version,state FROM lab_batch WHERE id=$1 FOR UPDATE',[d.batchId])).rows[0];if(!b)throw new LabError('NOT_FOUND',404);
 const inputHash=digest({operation:'RECALL',input:d}),old=(await db.query<{actor_id:string;input_sha256:string;result:Result}>('SELECT * FROM p4c_command WHERE request_id=$1',[d.requestId])).rows[0];
 if(old){if(old.actor_id!==user.id||old.input_sha256!==inputHash)throw new LabError('IDEMPOTENCY_CONFLICT',409);return old.result;}
 if(b.version!==d.expectedVersion)throw new LabError('VERSION_CONFLICT',409);const row=await getDnb(db,d.batchId,d.dnbId),ev=await events(db,row.id);
 if(b.state!=='Cancelled'&&!stopped(ev))throw new LabError('RECALL_ONLY_FOR_INACTIVE_DOCUMENT',409);
 if(ev.some(e=>e.event_type==='RECALL'&&e.payload.copyId===d.copyId))throw new LabError('COPY_ALREADY_RECALLED',409);
 if(!(await db.query("SELECT 1 FROM p4c_document_copy c JOIN p4c_document doc ON doc.id=c.document_id WHERE c.id=$1 AND doc.dnb_id=$2 AND c.kind='WORKING_COPY'",[d.copyId,row.id])).rows.length)throw new LabError('NOT_FOUND',404);
 await appendEvent(db,user,row.id,'RECALL',{copyId:d.copyId,reason:d.reason});const result={version:await touch(db,d.batchId)};
 await db.query('INSERT INTO p4c_command(request_id,dnb_id,actor_id,input_sha256,result) VALUES($1,$2,$3,$4,$5)',[d.requestId,d.dnbId,user.id,inputHash,JSON.stringify(result)]);return result;
}
/** Read originals/history even for Stop-use or cancelled Batches; clinical usability is always false. */
export async function workspace(db:Queryable,user:Staff,batchId:string){await assertSession(db,user);need(user,'worksheet.read','read');
 const operational=await operationalWorkflow(db);
 const b=(await db.query<{id:string;run_label:string;version:number;state:string}>('SELECT id,run_label,version,state FROM lab_batch WHERE id=$1 FOR UPDATE',[uuid.parse(batchId)])).rows[0];if(!b)throw new LabError('NOT_FOUND',404);
 const attempts=(await db.query<DnbRow>('SELECT *,actual_date::text FROM p4c_dnb_attempt WHERE batch_id=$1 ORDER BY attempt_number DESC',[b.id])).rows;
 const snapshots=(await db.query<{id:string;revision:number;sha256:string;pool_id:string}>('SELECT s.id,s.revision,s.sha256,s.pool_id FROM p4b_pool_snapshot s JOIN p4b_pool_attempt p ON p.id=s.pool_id WHERE p.batch_id=$1 ORDER BY s.created_at DESC',[b.id])).rows;
 const dnb=attempts[0];if(!dnb)return {operational,batchId:b.id,runLabel:b.run_label,version:b.version,holds:schema.HOLDS,attempts:[],poolSnapshots:snapshots,current:null};
 const ev=await events(db,dnb.id);let stopUse=b.state==='Cancelled'||stopped(ev);try{await storedPool(db,b.id,dnb.pool_snapshot_id);}catch{stopUse=true;}
 const handoffs=(await db.query<HandoffRow>('SELECT * FROM p4c_handoff WHERE dnb_id=$1 ORDER BY revision DESC',[dnb.id])).rows;
 const sequences=(await db.query<SequenceRow>('SELECT * FROM p4c_sequencing_attempt WHERE dnb_id=$1 ORDER BY attempt_number DESC',[dnb.id])).rows;
 const currentRunEvents=ev.filter(e=>e.payload.sequencingId===sequences[0]?.id);
 const transfers=(await db.query('SELECT t.* FROM p4c_handoff_transfer t JOIN p4c_handoff h ON h.id=t.handoff_id WHERE h.dnb_id=$1 ORDER BY t.sequence',[dnb.id])).rows;
 const verifications=(await db.query('SELECT v.* FROM p4c_handoff_verification v JOIN p4c_handoff_transfer t ON t.id=v.transfer_id JOIN p4c_handoff h ON h.id=t.handoff_id WHERE h.dnb_id=$1 ORDER BY v.created_at',[dnb.id])).rows;
 return {operational,batchId:b.id,runLabel:b.run_label,version:b.version,holds:schema.HOLDS,attempts:attempts.map(a=>({id:a.id,attemptNumber:a.attempt_number,dnbLabel:a.dnb_label,sha256:a.sha256})),poolSnapshots:snapshots,
  current:{...dnb,operationalHalos:operational?await operationalHalos(db,dnb.id):null,events:ev,observations:await observations(db,dnb.id),qc3:await qc3Evidence(db,dnb.id),handoffs,sequences,transfers,verifications,
   qc4:sequences[0]?await qc4Evidence(db,dnb.id,sequences[0].id):null,stopUse,stability:stability(ev.find(e=>e.event_type==='DNB_END')?.created_at??null),
   handoffVerified:!stopUse&&await handoffVerified(db,dnb.id),clinicalUsable:false,acceptance:'HOLD',exportAllowed:false,
   state:stopUse?'STOP_USE':has(ev,'COMPLETED')?'SYNTHETIC_COMPLETED':has(currentRunEvents,'SEQUENCE_HOLD')?'SEQUENCE_HOLD':has(currentRunEvents,'ANALYSIS_COMPLETE')?'SYNTHETIC_ANALYSIS_COMPLETE':has(currentRunEvents,'SEQUENCE_END')?'QC4':has(currentRunEvents,'SEQUENCE_START')?'SEQUENCING':has(ev,'DNB_END')?'QC3':has(ev,'DNB_START')?'DNB_EXECUTION':has(ev,'PRE_WORK')?'PRE_WORK':'DRAFT'}};
}
