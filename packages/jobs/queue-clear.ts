import {z} from 'zod';
import type {Queryable} from '../db/connection';
import {requirePermission,type Principal} from '../security/policy';
import {appendAudit} from '../db/audit';

const inputSchema=z.strictObject({
 action:z.enum(['CLEAR_ALL','CLEAR_SELECTED']),
 scope:z.enum(['ALL','OUTBOX','ARCHIVE']),
 ids:z.array(z.uuid()).max(300).optional()
});
export type ClearRequestResult={requested:number;alreadyRequested:number};

/**
 * Admin asks for queue items to be cleared. This records an immutable request only: web never changes
 * job_outbox or pdf_archive_job. The Worker decides per item (cancel, leave completed, or mark
 * RECONCILIATION_REQUIRED) and records the outcome, so a dispatched or published job is never reported cancelled.
 */
export async function requestWorkerQueueClear(db:Queryable,user:Principal,raw:unknown):Promise<ClearRequestResult>{
 requirePermission(user,'settings.read',{},'read');
 if(!user.roles.includes('APP_ADMIN'))throw Error('FORBIDDEN');
 const input=inputSchema.parse(raw);
 if(input.action==='CLEAR_SELECTED'&&(input.scope==='ALL'||!input.ids?.length))throw Error('JOB_SELECTION_REQUIRED');
 if(input.action==='CLEAR_ALL'&&input.ids)throw Error('JOB_SELECTION_NOT_ALLOWED');
 const selected=input.action==='CLEAR_SELECTED';
 let requested=0,candidates=0;
 const sources:Array<['OUTBOX'|'ARCHIVE',string]>=[
  ['OUTBOX',`SELECT id,state FROM job_outbox j WHERE ${selected?'id=ANY($1::uuid[])':'true'}
    AND NOT EXISTS(SELECT 1 FROM integration_job_receipt r WHERE r.outbox_id=j.id) AND state<>'Cancelled'`],
  ['ARCHIVE',`SELECT id,state FROM pdf_archive_job j WHERE ${selected?'id=ANY($1::uuid[])':'true'} AND state IN ('PENDING','FAILED')`]
 ];
 for(const [scope,sql] of sources){
  if(input.scope!=='ALL'&&input.scope!==scope)continue;
  const rows=(await db.query<{id:string;state:string}>(sql,selected?[input.ids]:[])).rows;
  candidates+=rows.length;
  for(const row of rows){
   const inserted=await db.query(`INSERT INTO worker_queue_clear_request(scope,job_id,requested_by,state_before)
    VALUES($1,$2,$3,$4) ON CONFLICT(scope,job_id) DO NOTHING RETURNING id`,[scope,row.id,user.id,row.state]);
   requested+=inserted.rows.length;
  }
 }
 await appendAudit(db,{actorId:user.id,action:'WORKER_QUEUE_CLEAR_REQUESTED',resourceType:'JOB',details:{outcome:'REQUESTED',count:requested}});
 return {requested,alreadyRequested:candidates-requested};
}
