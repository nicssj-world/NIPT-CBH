import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {Queryable} from '../db/connection';
import {sha256,type FileStore} from '../storage';
import {LabError,need,assertSession,uuid,reasonText,audit,type Staff} from '../lab/core';
import {digest} from './calculation';
import {context,common,event,events,has,stopped,touch,getPool,observations,poolingSource,QC2_CRITERIA,type PoolRow} from './service';
import type {F4Document} from '../pdf/f4';
import {operationalWorkflow} from '../lab/operational';
import {isNativeIssue,type NativeIssuePort} from '../workbook/controlled';
import {labelNativeCopy} from '../workbook/controlled-copy';
import {formatBeDateTime} from '../domain/thai-date';
export type F4Deps={store:FileStore;render:(d:F4Document)=>Promise<Buffer>;native?:NativeIssuePort};
const evidence=(o:Awaited<ReturnType<typeof observations>>[number])=>`${o.field}${o.slot?' '+o.slot:''}: ${o.value.checked?'✓':o.value.value+' '+o.value.unit} | Source ${o.source} / Copy ${o.copy_id??'—'} / Event ${o.event_time?formatBeDateTime(o.event_time):'NOT_RECORDED'} (${o.event_precision}) / Recorded ${formatBeDateTime(o.recorded_at)} by ${o.recorded_by} / Verified ${o.review?.reviewer_id??'—'} at ${o.review?formatBeDateTime(o.review.created_at):'—'}`;
export async function issueSyntheticDocument(db:Queryable,user:Staff,input:unknown,deps:F4Deps,previewOnly=false){
 const d=common.extend({kind:z.enum(['PRE_WORK','COMPLETED']),purpose:z.enum(['SYNTHETIC_SIMULATION','OPERATIONAL'])}).parse(input);
 const operational=await operationalWorkflow(db);if((d.purpose==='OPERATIONAL')!==operational)throw new LabError('DOCUMENT_MODE_MISMATCH',409);
 const {p,ev}=await context(db,user,d,'execution.record',operational&&d.kind==='COMPLETED');
 if(!has(ev,'CROSSCHECK_PASS')||has(ev,'CROSSCHECK_FAIL')||has(ev,'HOLD'))throw new LabError('CROSSCHECK_PASS_REQUIRED',409);
 if(!previewOnly&&(await db.query('SELECT 1 FROM p4b_document WHERE pool_id=$1 AND kind=$2',[p.id,d.kind])).rows.length)throw new LabError('DOCUMENT_ALREADY_ISSUED',409);
 const obs=await observations(db,p.id);
 let decision:Record<string,unknown>|undefined;
 if(d.kind==='PRE_WORK'&&has(ev,'START'))throw new LabError('PRE_WORK_BEFORE_EXECUTION_ONLY',409);
 if(d.kind==='COMPLETED'){
  decision=(await db.query<Record<string,unknown>>('SELECT * FROM p4b_qc2_decision WHERE pool_id=$1 ORDER BY sequence DESC LIMIT 1',[p.id])).rows[0];
  if(!has(ev,'END')||!p.payload.members.every(m=>obs.some(o=>o.field==='TRANSFER'&&o.slot===m.slot&&o.review?.result==='Confirmed'))||
   !['BUFFER','QC2','STD1','STD2'].every(f=>obs.some(o=>o.field===f&&o.review?.result==='Confirmed'))||obs.some(o=>o.review?.result!=='Confirmed')||
   decision?.decision!==(operational?'Accepted':'SyntheticReviewed')||decision.observation_id!==obs.find(o=>o.field==='QC2')?.id||!operational&&decision.criteria_version!==QC2_CRITERIA)throw new LabError('POOL_COMPLETION_EVIDENCE_INCOMPLETE',409);
 }
 const id=randomUUID(),at=new Date().toISOString(),name=(await db.query<{display_name:string}>('SELECT display_name FROM app_user WHERE id=$1',[user.id])).rows[0].display_name;
 const evidenceHash=digest({poolHash:p.sha256,kind:d.kind,observations:obs,decision:decision??null});
 if(!operational&&!previewOnly&&!ev.some(e=>e.event_type==='PREVIEW'&&e.actor_id===user.id&&e.payload.evidenceHash===evidenceHash))throw new LabError('CURRENT_PREVIEW_REQUIRED',409);
 if(operational){
  if(!deps.native)throw new LabError('TASK_NATIVE_CONTROLLED_RENDERER_REQUIRED',409);
  const artifact=await deps.native(db,user,{batchId:p.batch_id,poolId:p.id,form:'F4',kind:d.kind,evidence:{poolHash:p.sha256,observations:obs,decision:decision??null}});
  const nativeEvidenceHash=digest({evidenceHash,valuesSha256:artifact.snapshot.valuesSha256,sourceSha256:artifact.snapshot.sourceSha256,masterSha256:artifact.snapshot.masterSha256});artifact.snapshot.evidenceHash=nativeEvidenceHash;
  if(previewOnly){await event(db,user,p.id,'PREVIEW',{kind:d.kind,evidenceHash:nativeEvidenceHash,sha256:sha256(artifact.bytes)});return {bytes:artifact.bytes,version:await touch(db,p.batch_id)};}
  if(!ev.some(e=>e.event_type==='PREVIEW'&&e.actor_id===user.id&&e.payload.evidenceHash===nativeEvidenceHash))throw new LabError('CURRENT_PREVIEW_REQUIRED',409);
  const hash=await deps.store.put(artifact.bytes);await db.query('INSERT INTO p4b_document(id,pool_id,kind,snapshot,file_sha256,issued_by,issued_at) VALUES($1,$2,$3,$4,$5,$6,$7)',[id,p.id,d.kind,JSON.stringify(artifact.snapshot),hash,user.id,at]);await event(db,user,p.id,d.kind,{documentId:id,sha256:hash,purpose:d.purpose});return {id,fileSha256:hash,version:await touch(db,p.batch_id)};
 }
 const doc:F4Document={form:'F4',synthetic:true,clinicalUsable:false,kind:d.kind,preview:previewOnly,templateVersion:'SYNTHETIC-F4-v1',fieldInventory:'SEED_UNVERIFIED',docId:id,poolId:p.id,batchId:p.batch_id,runLabel:p.payload.runLabel,tubeLabel:p.payload.tubeLabel,
  attempt:p.attempt_number,revision:1,issuedBy:name,issuedAt:at,formulaVersion:p.payload.calculation.formulaVersion,poolHash:p.sha256,holds:[...p.payload.holds],plannedBuffer:p.payload.calculation.plannedBuffer,
  rows:p.payload.members.map(m=>({slot:m.slot,plate:m.plate,kind:m.kind,printedId:m.printedSampleId??m.printedControlId??'',lnHalos:m.lnHalos??'',concentration:m.qc1.value,
   planned:p.payload.calculation.rows.find(r=>r.slot===m.slot)!.planned!,actual:d.kind==='COMPLETED'?evidence(obs.find(o=>o.field==='TRANSFER'&&o.slot===m.slot)!):null})),
  evidence:d.kind==='COMPLETED'?[...obs.filter(o=>o.field!=='TRANSFER').map(evidence),`Crosscheck ${JSON.stringify(ev.find(e=>e.event_type==='CROSSCHECK_PASS'))}`,`QC2 ${JSON.stringify(decision)} — acceptance HOLD`]:[],copy:null};
 const bytes=await deps.render(doc);
 if(previewOnly){await event(db,user,p.id,'PREVIEW',{kind:d.kind,evidenceHash,sha256:sha256(bytes)});return {bytes,version:await touch(db,p.batch_id)};}
 const hash=await deps.store.put(bytes);
 await db.query('INSERT INTO p4b_document(id,pool_id,kind,snapshot,file_sha256,issued_by,issued_at) VALUES($1,$2,$3,$4,$5,$6,$7)',[id,p.id,d.kind,JSON.stringify(doc),hash,user.id,at]);
 if(d.kind==='COMPLETED'){
  const payload={...p.payload,poolId:p.id,poolAttempt:p.attempt_number,revision:1,calculationSha256:p.sha256,qc2:obs,decision,crosscheck:ev.find(e=>e.event_type==='CROSSCHECK_PASS'),execution:ev.filter(e=>['START','END'].includes(e.event_type)),f4:{id,sha256:hash},acceptance:'HOLD',exportAllowed:false,actor:user.id,timestamp:at};
  await db.query('INSERT INTO p4b_pool_snapshot(pool_id,revision,payload,sha256,created_by,created_at) VALUES($1,1,$2,$3,$4,$5)',[p.id,JSON.stringify(payload),digest(payload),user.id,at]);
 }
 await event(db,user,p.id,d.kind,{documentId:id,sha256:hash,purpose:d.purpose});return {id,fileSha256:hash,version:await touch(db,p.batch_id)};
}
type Doc={id:string;pool_id:string;kind:string;snapshot:F4Document;file_sha256:string};
async function docContext(db:Queryable,user:Staff,id:string){
 await assertSession(db,user);need(user,'worksheet.read','read');
 const doc=(await db.query<Doc>('SELECT * FROM p4b_document WHERE id=$1',[uuid.parse(id)])).rows[0];if(!doc)throw new LabError('NOT_FOUND',404);
 const row=(await db.query<PoolRow>('SELECT * FROM p4b_pool_attempt WHERE id=$1',[doc.pool_id])).rows[0];
 await db.query('SELECT id FROM lab_batch WHERE id=$1 FOR UPDATE',[row.batch_id]);const p=await getPool(db,row.batch_id,row.id),ev=await events(db,p.id),source=await poolingSource(db,p.batch_id,p.payload.calculation.scenario.controls);
 return {doc,p,ev,inactive:stopped(ev)||source.sourceHash!==p.source_sha256};
}
export async function readF4(db:Queryable,user:Staff,id:string,deps:F4Deps){
 const {doc,inactive}=await docContext(db,user,id);const status=inactive?'STOP_USE':isNativeIssue(doc.snapshot)?'ISSUED':'SYNTHETIC_HOLD';await audit(db,user,'POOL_DOCUMENT_VIEWED','p4b_document',doc.id,{outcome:status});
 return {bytes:await deps.store.get(doc.file_sha256),sha256:doc.file_sha256,status};
}
export async function printF4(db:Queryable,user:Staff,input:unknown,deps:F4Deps){
 const d=z.strictObject({documentId:uuid,kind:z.enum(['ORIGINAL_REPRINT','WORKING_COPY','STATUS_MARKED']),reason:reasonText}).parse(input);
 const {doc,p,inactive,ev}=await docContext(db,user,d.documentId);
 if(d.kind==='WORKING_COPY'){need(user,'execution.record');if(inactive||doc.kind!=='PRE_WORK'||has(ev,'HOLD')||has(ev,'COMPLETED'))throw new LabError('WORKING_COPY_NOT_USABLE',409);}
 if(d.kind==='STATUS_MARKED'&&!inactive)throw new LabError('STATUS_MARK_ONLY_FOR_INACTIVE',409);
 if(d.kind==='ORIGINAL_REPRINT'&&inactive)need(user,'document.obsolete.print');
 const number=(await db.query<{n:number}>('SELECT COALESCE(max(copy_number),0)+1 n FROM p4b_document_copy WHERE document_id=$1',[doc.id])).rows[0].n;
 const copyId=randomUUID();
 const bytes=d.kind==='ORIGINAL_REPRINT'?await deps.store.get(doc.file_sha256):isNativeIssue(doc.snapshot)?await labelNativeCopy(await deps.store.get(doc.file_sha256),{id:copyId,kind:d.kind,number,status:inactive?'STOP_USE':'Issued',originalHash:doc.file_sha256,actorId:user.id,at:new Date().toISOString()}):await deps.render({...doc.snapshot,copy:{kind:d.kind,number,originalHash:doc.file_sha256,actor:user.id,at:new Date().toISOString(),status:inactive?'STOP_USE':'SYNTHETIC_HOLD',reason:d.reason}});
 const hash=await deps.store.put(bytes);
 const copy=(await db.query<{id:string}>('INSERT INTO p4b_document_copy(id,document_id,copy_number,kind,file_sha256,derived_from,reason,actor_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id',[copyId,doc.id,number,d.kind,hash,doc.file_sha256,d.reason,user.id])).rows[0];
 await audit(db,user,'POOL_DOCUMENT_PRINTED','p4b_document_copy',copy.id,{outcome:d.kind,count:number});
 return {id:copy.id,sha256:hash,bytes,status:inactive?'STOP_USE':isNativeIssue(doc.snapshot)?'ISSUED':'SYNTHETIC_HOLD',fileName:`F4-${doc.id}-${d.kind}-copy${number}-${inactive?'STOP_USE':'ISSUED'}.pdf`,version:await touch(db,p.batch_id)};
}
export async function recallF4(db:Queryable,user:Staff,input:unknown){
 const d=common.extend({copyId:uuid,reason:reasonText}).parse(input);await assertSession(db,user);need(user,'document.recall');
 const b=(await db.query<{version:number}>('SELECT version FROM lab_batch WHERE id=$1 FOR UPDATE',[d.batchId])).rows[0];if(!b)throw new LabError('NOT_FOUND',404);if(b.version!==d.expectedVersion)throw new LabError('VERSION_CONFLICT',409);
 const p=await getPool(db,d.batchId,d.poolId),ev=await events(db,p.id);
 if(!stopped(ev)&&!has(ev,'HOLD'))throw new LabError('RECALL_ONLY_FOR_INACTIVE_DOCUMENT',409);
 if(ev.some(e=>e.event_type==='RECALL'&&e.payload.copyId===d.copyId))throw new LabError('COPY_ALREADY_RECALLED',409);
 if(!(await db.query("SELECT 1 FROM p4b_document_copy c JOIN p4b_document doc ON doc.id=c.document_id WHERE c.id=$1 AND doc.pool_id=$2 AND c.kind='WORKING_COPY'",[d.copyId,p.id])).rows.length)throw new LabError('NOT_FOUND',404);
 await event(db,user,p.id,'RECALL',{copyId:d.copyId,reason:d.reason});return {version:await touch(db,p.batch_id)};
}
