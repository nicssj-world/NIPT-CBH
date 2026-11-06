import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {Queryable} from '../db/connection';
import {assertSession,audit,LabError,need,uuid,type Staff} from '../lab/core';
import type {Role} from '../security/policy';
import type {FileStore} from '../storage';
import {readArchive,writeArchive} from '../workbook/archive';
import {uniqueNames} from './filename';
import {batchZip,finalizeReports,type FinalizeOutcome,type ReportDeps} from './reports';

export const REPORT_BATCH_JOB='internal_report_batch_item';
const confirmations=z.strictObject({reportContentVerified:z.literal(true),identityAndValuesMatchReport:z.literal(true),disclosureReviewed:z.literal(true),abnormalAcknowledged:z.boolean(),benchMeasurementsReviewed:z.literal(true).optional()});
const itemSchema=z.strictObject({rowId:uuid,pregnancyOverride:z.enum(['Singleton','Twins']).optional(),overrideReason:z.string().max(500).optional(),reportedBy:uuid.nullable().optional(),approvedBy:uuid.nullable().optional(),reissueReason:z.string().trim().min(8).max(500).refine(x=>!/\d{13}/.test(x),'REASON_TEXT_INVALID').optional()});
export const reportBatchSchema=z.strictObject({idempotencyKey:uuid,defaults:z.strictObject({reportedBy:uuid.nullable().default(null),approvedBy:uuid.nullable().default(null)}).default({reportedBy:null,approvedBy:null}),release:z.boolean().default(false),releaseConfirmations:confirmations.optional(),items:z.array(itemSchema).min(1).max(100)}).refine(x=>!x.release||!!x.releaseConfirmations,'RELEASE_CONFIRMATIONS_REQUIRED');
type Request=z.infer<typeof reportBatchSchema>;
type RequestRow={id:string;operator_id:string;session_id:string|null;request:Request;created_at:Date};
type ItemRow={id:string;request_id:string;row_id:string;ordinal:number;idempotency_key:string;outbox_id:string;state:'QUEUED'|'FINAL'|'HOLD'|'ERROR';outcome:FinalizeOutcome|null;finalization_batch_id:string|null;completed_at:Date|null};
const itemView=(i:ItemRow)=>({itemId:i.id,rowId:i.row_id,state:i.state,...(i.outcome?{outcome:i.outcome}:{}),...(i.finalization_batch_id?{finalizationBatchId:i.finalization_batch_id}:{}),completedAt:i.completed_at});

/** Caller transaction atomically writes the immutable request and its existing outbox jobs. No Word work in HTTP. */
export async function enqueueReportBatch(db:Queryable,user:Staff,input:unknown){
 await assertSession(db,user);need(user,'result.review');need(user,'result.certify');
 const d=reportBatchSchema.parse(input);
 if(new Set(d.items.map(i=>i.rowId)).size!==d.items.length)throw new LabError('DUPLICATE_ROW_IN_BATCH',422);
 await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,75432864))',[d.idempotencyKey]);
 const prior=(await db.query<RequestRow>('SELECT * FROM internal_report_request WHERE idempotency_key=$1',[d.idempotencyKey])).rows[0];
 if(prior){if(prior.operator_id!==user.id||JSON.stringify(reportBatchSchema.parse(prior.request))!==JSON.stringify(d))throw new LabError('IDEMPOTENCY_KEY_REUSED',409);return {...await readReportBatch(db,user,prior.id),replayed:true};}
 const batch=(await db.query<{id:string}>('INSERT INTO internal_report_request(operator_id,session_id,idempotency_key,request) VALUES($1,$2,$3,$4) RETURNING id',[user.id,user.sessionId??null,d.idempotencyKey,JSON.stringify(d)])).rows[0];
 for(const [ordinal,item] of d.items.entries()){
  const id=randomUUID(),key=randomUUID(),outbox=randomUUID();
  await db.query('INSERT INTO job_outbox(id,kind,payload,idempotency_key) VALUES($1,$2,$3,$4)',[outbox,REPORT_BATCH_JOB,JSON.stringify({itemId:id}),`internal-report-item:${id}`]);
  await db.query('INSERT INTO internal_report_request_item(id,request_id,ordinal,row_id,idempotency_key,outbox_id) VALUES($1,$2,$3,$4,$5,$6)',[id,batch.id,ordinal,item.rowId,key,outbox]);
 }
 await audit(db,user,'INTERNAL_REPORT_REQUESTED','INTERNAL_REPORT_REQUEST',batch.id,{count:d.items.length,outcome:'QUEUED'});
 return {...await readReportBatch(db,user,batch.id),replayed:false};
}

export async function readReportBatch(db:Queryable,user:Staff,batchId:string){
 await assertSession(db,user);need(user,'result.review','read');
 const batch=(await db.query<RequestRow>('SELECT * FROM internal_report_request WHERE id=$1 AND operator_id=$2',[uuid.parse(batchId),user.id])).rows[0];
 if(!batch)throw new LabError('NOT_FOUND',404);
 const rows=(await db.query<ItemRow&{outbox_state:string}>('SELECT i.*,j.state outbox_state FROM internal_report_request_item i JOIN job_outbox j ON j.id=i.outbox_id WHERE i.request_id=$1 ORDER BY i.ordinal',[batch.id])).rows;
 const items=rows.map((i):ItemRow=>i.state==='QUEUED'&&i.outbox_state==='Cancelled'?{...i,state:'ERROR',outcome:{rowId:i.row_id,outcome:'ERROR',code:'JOB_CANCELLED'}}:i);
 const completed=items.filter(i=>i.state!=='QUEUED').length;
 return {batchId:batch.id,state:completed===items.length?'COMPLETED':completed?'RUNNING':'QUEUED',createdAt:batch.created_at,total:items.length,completed,items:items.map(itemView),zipBatchIds:[...new Set(items.flatMap(i=>i.finalization_batch_id?[i.finalization_batch_id]:[]))]};
}

/** Lists only the authenticated operator's requests so a fresh tab can reconnect without browser storage. */
export async function listReportBatches(db:Queryable,user:Staff){
 await assertSession(db,user);need(user,'result.review','read');
 const ids=(await db.query<{id:string}>('SELECT id FROM internal_report_request WHERE operator_id=$1 ORDER BY created_at DESC LIMIT 20',[user.id])).rows;
 const items=[];for(const row of ids)items.push(await readReportBatch(db,user,row.id));return {items};
}

/** The existing ZIP URL supports both original synchronous batches and a single durable parent download. */
export async function reportBatchZip(db:Queryable,user:Staff,store:FileStore,batchId:string){
 await assertSession(db,user);need(user,'result.review','read');
 const durable=(await db.query<{id:string}>('SELECT id FROM internal_report_request WHERE id=$1',[uuid.parse(batchId)])).rows[0];
 if(!durable)return batchZip(db,user,store,batchId);
 const status=await readReportBatch(db,user,batchId),parts=new Map<string,Buffer>();
 const files:Awaited<ReturnType<typeof batchZip>>['manifest']['files']=[];
 const notIncluded:unknown[]=[];
 for(const [index,id] of status.zipBatchIds.entries()){
  // Original helper enforces current case visibility, final-report state and access logging.
  const child=await batchZip(db,user,store,id),archive=readArchive(child.bytes);
  for(const file of child.manifest.files){
   const member=`batch-${String(index+1).padStart(3,'0')}/${file.zipMember}`,bytes=archive.get(file.zipMember);
   if(!bytes)throw Error('REPORT_BATCH_ZIP_MEMBER_MISSING');
   parts.set(member,bytes);files.push({...file,zipMember:member});
  }
  notIncluded.push(...child.manifest.notIncluded);
 }
 const names=uniqueNames(files.map(f=>f.name));for(const [index,file] of files.entries())file.name=names[index];
 const manifest={batchId:status.batchId,createdAt:status.createdAt,operatorId:user.id,files,notIncluded,items:status.items,state:status.state};
 parts.set('manifest.json',Buffer.from(JSON.stringify(manifest,null,2),'utf8'));
 await audit(db,user,'INTERNAL_REPORT_REQUEST_DOWNLOADED','INTERNAL_REPORT_REQUEST',batchId,{outcome:'ZIP',count:files.length});
 return {bytes:writeArchive(parts),filename:`NIPT-REPORTS-${new Date(status.createdAt).toISOString().slice(0,10)}-${batchId.slice(0,8)}.zip`,manifest};
}

async function currentActor(db:Queryable,batch:RequestRow):Promise<Staff>{
 const enabled=(await db.query<{enabled:boolean}>('SELECT enabled FROM app_user WHERE id=$1',[batch.operator_id])).rows[0];
 if(!enabled?.enabled)throw new LabError('FORBIDDEN',403);
 const roles=(await db.query<{role:Role}>('SELECT role FROM role_assignment WHERE user_id=$1 AND effective_from<=now() AND (expires_at IS NULL OR expires_at>now())',[batch.operator_id])).rows;
 const units=(await db.query<{unit_id:string}>('SELECT unit_id FROM user_unit_scope WHERE user_id=$1',[batch.operator_id])).rows;
 const permissions=(await db.query<{permission:string}>('SELECT permission FROM user_permission WHERE user_id=$1',[batch.operator_id])).rows;
 return {id:batch.operator_id,roles:roles.map(x=>x.role),unitIds:units.map(x=>x.unit_id),permissions:permissions.map(x=>x.permission),...(batch.session_id?{sessionId:batch.session_id}:{})};
}

/** One worker transaction per item. The finalization ledger and item result commit together; receipt loss can replay safely. */
export async function runReportBatchItem(db:Queryable,outboxId:string,payload:unknown,deps:ReportDeps,retryCount=0):Promise<Record<string,unknown>>{
 const {itemId}=z.strictObject({itemId:uuid}).parse(payload);
 const item=(await db.query<ItemRow>('SELECT * FROM internal_report_request_item WHERE id=$1 AND outbox_id=$2 FOR UPDATE',[itemId,outboxId])).rows[0];
 if(!item)throw new LabError('REPORT_BATCH_ITEM_NOT_FOUND',404);
 if(item.state!=='QUEUED')return {state:item.state,...(item.outcome?.code?{code:item.outcome.code}:{}),itemId:item.id};
 const batch=(await db.query<RequestRow>('SELECT * FROM internal_report_request WHERE id=$1',[item.request_id])).rows[0];
 const request=reportBatchSchema.parse(batch.request);
 let outcome:FinalizeOutcome,finalizationBatchId:string|null=null;
 await db.query('SAVEPOINT durable_report_item');
 try{
  const user=await currentActor(db,batch);await assertSession(db,user);need(user,'result.review');need(user,'result.certify');
  const result=await finalizeReports(db,user,deps,{...request,idempotencyKey:item.idempotency_key,items:[request.items[item.ordinal]]});
  outcome=result.items[0];if(!outcome)throw Error('REPORT_BATCH_OUTCOME_MISSING');finalizationBatchId=result.batchId;
  await db.query('RELEASE SAVEPOINT durable_report_item');
 }catch(error){
  await db.query('ROLLBACK TO SAVEPOINT durable_report_item');await db.query('RELEASE SAVEPOINT durable_report_item');
  // Expected patient/authority failures remain visible, while transient process/render/storage failures retry on the same key.
  if(!(error instanceof LabError)&&retryCount<3)throw error;
  const code=error instanceof LabError?error.code:error instanceof Error&&/^[A-Z][A-Z0-9_]{0,99}$/.test(error.message)?error.message:'REPORT_BATCH_ITEM_FAILED';
  outcome={rowId:item.row_id,outcome:'ERROR',code,...(error instanceof LabError&&error.details?{details:error.details}:{})};
 }
 await db.query('UPDATE internal_report_request_item SET state=$2,outcome=$3,finalization_batch_id=$4,completed_at=now() WHERE id=$1',[item.id,outcome.outcome,JSON.stringify(outcome),finalizationBatchId]);
 return {state:outcome.outcome,...(outcome.code?{code:outcome.code}:{}),itemId:item.id};
}
