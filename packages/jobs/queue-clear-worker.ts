import type {Queryable} from '../db/connection';

/** The two pg-boss calls used. Both are supported public APIs (pg-boss 12); internal tables are never written. */
export type BossLike={
 getJobById(name:string,id:string):Promise<{state:string}|null>;
 cancel(name:string,id:string):Promise<unknown>;
};
type Outcome='CANCELLED'|'RECONCILIATION_REQUIRED'|'COMPLETED_NOT_CHANGED';
type Request={id:string;scope:'OUTBOX'|'ARCHIVE';job_id:string};

async function record(db:Queryable,requestId:string,outcome:Outcome,detail:string|null){
 await db.query(`INSERT INTO worker_queue_clear_outcome(request_id,outcome,detail) VALUES($1,$2,$3) ON CONFLICT(request_id) DO NOTHING`,[requestId,outcome,detail]);
}

/** HIS outbox. Cancelled is only recorded when the system holds evidence the job will not run. */
async function applyOutbox(db:Queryable,request:Request,boss?:BossLike):Promise<boolean>{
 const job=(await db.query<{kind:string;state:string;receipt:boolean}>(`SELECT j.kind,j.state,
   EXISTS(SELECT 1 FROM integration_job_receipt r WHERE r.outbox_id=j.id) receipt
   FROM job_outbox j WHERE j.id=$1 FOR UPDATE`,[request.job_id])).rows[0];
 if(!job){await record(db,request.id,'RECONCILIATION_REQUIRED','JOB_MISSING');return true;}
 if(job.receipt){await record(db,request.id,'COMPLETED_NOT_CHANGED','RECEIPT_EXISTS');return true;}
 if(job.state==='Cancelled'){await record(db,request.id,'CANCELLED','ALREADY_CANCELLED');return true;}
 if(job.state==='Pending'){
  const changed=await db.query("UPDATE job_outbox SET state='Cancelled',cancel_epoch=cancel_epoch+1 WHERE id=$1 AND state='Pending' RETURNING id",[request.job_id]);
  if(!changed.rows.length)return false;
  await record(db,request.id,'CANCELLED','PENDING_NOT_DISPATCHED');return true;
 }
 // Dispatched: the job exists in pg-boss and an external effect may already have happened.
 if(!boss)return false;
 const found=await boss.getJobById(job.kind,request.job_id);
 if(found&&['created','retry'].includes(found.state)){
  await boss.cancel(job.kind,request.job_id);
  const after=await boss.getJobById(job.kind,request.job_id);
  if(after?.state==='cancelled'){
   await db.query("UPDATE job_outbox SET state='Cancelled',cancel_epoch=cancel_epoch+1 WHERE id=$1 AND state='Dispatched'",[request.job_id]);
   await record(db,request.id,'CANCELLED','QUEUE_JOB_CANCELLED_BEFORE_START');return true;
  }
  await record(db,request.id,'RECONCILIATION_REQUIRED','QUEUE_JOB_STARTED_DURING_CANCEL');return true;
 }
 await record(db,request.id,'RECONCILIATION_REQUIRED',found?'QUEUE_JOB_'+found.state.toUpperCase():'QUEUE_JOB_NOT_FOUND');
 return true;
}

/**
 * NAS PDF archive. A job that was claimed, or failed with an uncertain publication, may already have
 * written the file, so it is never reported cancelled; a claim that expired without an outcome is uncertain too.
 */
async function applyArchive(db:Queryable,request:Request):Promise<boolean>{
 const job=(await db.query<{state:string;claimed:boolean;expired:boolean;last_error:string|null}>(`SELECT state,
   claim_token IS NOT NULL claimed,COALESCE(claimed_until<clock_timestamp(),false) expired,last_error
   FROM pdf_archive_job WHERE id=$1 FOR UPDATE`,[request.job_id])).rows[0];
 if(!job){await record(db,request.id,'RECONCILIATION_REQUIRED','JOB_MISSING');return true;}
 if(job.state==='ARCHIVED'){await record(db,request.id,'COMPLETED_NOT_CHANGED','ARCHIVED');return true;}
 if(job.state==='CANCELLED'){await record(db,request.id,'CANCELLED','ALREADY_CANCELLED');return true;}
 const uncertain=job.last_error==='ARCHIVE_RECONCILIATION_REQUIRED'||job.last_error==='ARCHIVE_CLAIM_EXPIRED';
 if(job.claimed&&!job.expired){
  // The archive worker stops before publication when it sees this flag; the outcome is recorded on a later pass.
  await db.query('UPDATE pdf_archive_job SET cancellation_requested_at=COALESCE(cancellation_requested_at,clock_timestamp()),updated_at=clock_timestamp() WHERE id=$1',[request.job_id]);
  return false;
 }
 if(job.claimed&&job.expired){
  await db.query(`UPDATE pdf_archive_job SET state='FAILED',last_error='ARCHIVE_RECONCILIATION_REQUIRED',claim_token=NULL,claimed_until=NULL,
   cancellation_requested_at=COALESCE(cancellation_requested_at,clock_timestamp()),updated_at=clock_timestamp() WHERE id=$1`,[request.job_id]);
  await record(db,request.id,'RECONCILIATION_REQUIRED','CLAIM_EXPIRED_PUBLICATION_UNKNOWN');return true;
 }
 if(uncertain){
  await db.query('UPDATE pdf_archive_job SET cancellation_requested_at=COALESCE(cancellation_requested_at,clock_timestamp()),updated_at=clock_timestamp() WHERE id=$1',[request.job_id]);
  await record(db,request.id,'RECONCILIATION_REQUIRED','PUBLICATION_UNCERTAIN');return true;
 }
 await db.query(`UPDATE pdf_archive_job SET state='CANCELLED',cancellation_requested_at=COALESCE(cancellation_requested_at,clock_timestamp()),
  claim_token=NULL,claimed_until=NULL,updated_at=clock_timestamp() WHERE id=$1 AND claim_token IS NULL AND state IN ('PENDING','FAILED')`,[request.job_id]);
 await record(db,request.id,'CANCELLED','NOT_PUBLISHED');
 return true;
}

/** One bounded Worker pass over unresolved clear requests. Runs inside the caller's transaction. */
export async function applyQueueClearRequests(db:Queryable,boss?:BossLike,limit=100){
 const requests=(await db.query<Request>(`SELECT q.id,q.scope,q.job_id FROM worker_queue_clear_request q
  WHERE NOT EXISTS(SELECT 1 FROM worker_queue_clear_outcome o WHERE o.request_id=q.id)
  ORDER BY q.requested_at,q.id LIMIT $1`,[limit])).rows;
 const totals={resolved:0,pending:0};
 for(const request of requests){
  const done=request.scope==='OUTBOX'?await applyOutbox(db,request,boss):await applyArchive(db,request);
  if(done)totals.resolved++;else totals.pending++;
 }
 return totals;
}
