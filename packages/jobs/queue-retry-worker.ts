import type {Queryable} from '../db/connection';
import {RETRY_SAFE_KINDS} from './queue-retry';

/** pg-boss calls used. All are supported public APIs of pg-boss 12; internal tables are never written. */
export type RetryBossLike={
 getJobById(name:string,id:string):Promise<{state:string}|null>;
 retry(name:string,id:string):Promise<unknown>;
};
type Request={id:string;job_id:string};

async function record(db:Queryable,id:string,outcome:'RETRIED'|'REFUSED',reason:string){
 await db.query('INSERT INTO worker_queue_retry_outcome(request_id,outcome,reason) VALUES($1,$2,$3) ON CONFLICT(request_id) DO NOTHING',[id,outcome,reason]);
}

/**
 * One bounded Worker pass over unresolved retry requests, inside the caller's transaction. A job is retried only when pg-boss itself
 * reports it failed and nothing indicates an effect may exist: no receipt, no clear request, a retry-safe kind. Anything else is
 * refused with a stable reason; a refused retry never changes the job.
 */
export async function applyQueueRetryRequests(db:Queryable,boss?:RetryBossLike,limit=100){
 const requests=(await db.query<Request>(`SELECT q.id,q.job_id FROM worker_queue_retry_request q
  WHERE NOT EXISTS(SELECT 1 FROM worker_queue_retry_outcome o WHERE o.request_id=q.id) ORDER BY q.requested_at,q.id LIMIT $1`,[limit])).rows;
 const totals={retried:0,refused:0,pending:0};
 for(const request of requests){
  // Same row lock as clear and dispatch: a clear or a dispatch cannot interleave with this decision.
  const job=(await db.query<{kind:string;state:string;receipt:boolean;clear:boolean}>(`SELECT j.kind,j.state,
    EXISTS(SELECT 1 FROM integration_job_receipt r WHERE r.outbox_id=j.id) receipt,
    EXISTS(SELECT 1 FROM worker_queue_clear_request c WHERE c.scope='OUTBOX' AND c.job_id=j.id) clear
    FROM job_outbox j WHERE j.id=$1 FOR UPDATE`,[request.job_id])).rows[0];
  const refuse=async(reason:string)=>{await record(db,request.id,'REFUSED',reason);totals.refused++;};
  if(!job){await refuse('JOB_MISSING');continue;}
  if(job.receipt){await refuse('RECEIPT_EXISTS');continue;}
  if(job.clear){await refuse('CLEAR_REQUESTED');continue;}
  if(job.state==='Cancelled'){await refuse('JOB_CANCELLED');continue;}
  if(job.state!=='Dispatched'){await refuse('NOT_DISPATCHED');continue;}
  if(!(RETRY_SAFE_KINDS as readonly string[]).includes(job.kind)){await refuse('KIND_NOT_RETRY_SAFE');continue;}
  if(!boss){totals.pending++;continue;}
  const found=await boss.getJobById(job.kind,request.job_id);
  if(!found){await refuse('QUEUE_JOB_MISSING');continue;}
  if(found.state!=='failed'){await refuse('QUEUE_JOB_NOT_FAILED');continue;}
  await boss.retry(job.kind,request.job_id);
  const after=await boss.getJobById(job.kind,request.job_id);
  if(after&&['retry','created','active'].includes(after.state)){await record(db,request.id,'RETRIED','QUEUE_JOB_RETRIED');totals.retried++;}
  else await refuse('QUEUE_RETRY_NOT_APPLIED');
 }
 return totals;
}
