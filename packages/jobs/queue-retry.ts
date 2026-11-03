import {z} from 'zod';
import type {Queryable} from '../db/connection';
import {requirePermission,type Principal} from '../security/policy';
import {appendAudit} from '../db/audit';

export {RETRY_SAFE_KINDS} from './retry-kinds';

const inputSchema=z.strictObject({scope:z.literal('OUTBOX'),ids:z.array(z.uuid()).min(1).max(75)});
export type RetryRequestResult={requested:number;alreadyRequested:number;unknown:number};

/** Admin asks for failed queue jobs to be retried. Records an immutable request only; the Worker decides and records the outcome. */
export async function requestWorkerQueueRetry(db:Queryable,user:Principal,raw:unknown):Promise<RetryRequestResult>{
 requirePermission(user,'settings.read',{},'read');
 if(!user.roles.includes('APP_ADMIN'))throw Error('FORBIDDEN');
 const input=inputSchema.parse(raw);
 let requested=0,alreadyRequested=0,unknown=0;
 for(const id of [...new Set(input.ids)]){
  // One open request per job: the advisory lock makes the check-then-insert atomic against a concurrent click or tab.
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,75432810))',[id]);
  if(!(await db.query('SELECT 1 FROM job_outbox WHERE id=$1',[id])).rows.length){unknown++;continue;}
  const open=await db.query(`SELECT 1 FROM worker_queue_retry_request r WHERE r.job_id=$1
   AND NOT EXISTS(SELECT 1 FROM worker_queue_retry_outcome o WHERE o.request_id=r.id)`,[id]);
  if(open.rows.length){alreadyRequested++;continue;}
  await db.query('INSERT INTO worker_queue_retry_request(job_id,requested_by) VALUES($1,$2)',[id,user.id]);
  requested++;
 }
 await appendAudit(db,{actorId:user.id,action:'WORKER_QUEUE_RETRY_REQUESTED',resourceType:'JOB',details:{outcome:'REQUESTED',count:requested}});
 return {requested,alreadyRequested,unknown};
}
