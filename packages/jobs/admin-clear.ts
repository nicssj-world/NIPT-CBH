import {z} from 'zod';
import type {Queryable} from '../db/connection';
import {requirePermission,type Principal} from '../security/policy';
import {appendAudit} from '../db/audit';

const inputSchema=z.strictObject({
 action:z.enum(['CLEAR_ALL','CLEAR_SELECTED']),
 scope:z.enum(['ALL','OUTBOX','ARCHIVE']),
 ids:z.array(z.uuid()).max(300).optional()
});
type Row={id:string;state:string;completed:boolean;claimed:boolean};

/** Admin clear is logical cancellation or hiding, NEVER deletion of clinical receipts. */
export async function clearWorkerQueue(db:Queryable,user:Principal,raw:unknown){
 requirePermission(user,'settings.read',{},'read');
 if(!user.roles.includes('APP_ADMIN'))throw Error('FORBIDDEN');
 const input=inputSchema.parse(raw);
 if(input.action==='CLEAR_SELECTED'&&(input.scope==='ALL'||!input.ids?.length))throw Error('JOB_SELECTION_REQUIRED');
 const totals={cancelled:0,requested:0,uncertain:0,hidden:0};
 const filter=input.action==='CLEAR_SELECTED'?' AND j.id=ANY($1::uuid[])':'';
 const args=input.action==='CLEAR_SELECTED'?[input.ids]:[];
 if(input.scope!=='ARCHIVE'){
  const rows=(await db.query<Row>(`SELECT j.id,j.state,(r.outbox_id IS NOT NULL) completed,false claimed
   FROM job_outbox j LEFT JOIN integration_job_receipt r ON r.outbox_id=j.id
   WHERE NOT EXISTS(SELECT 1 FROM worker_queue_clear_event e WHERE e.scope='OUTBOX' AND e.job_id=j.id)
   ${filter} ORDER BY j.created_at,j.id FOR UPDATE OF j`,args)).rows;
  for(const row of rows){
   const resolution=row.completed?'HIDDEN_COMPLETED':row.state==='Pending'?'CANCELLED':row.state==='Dispatched'?'RECONCILIATION_REQUIRED':'HIDDEN_COMPLETED';
   if(!row.completed&&row.state==='Pending')
    await db.query("UPDATE job_outbox SET state='Cancelled',cancel_epoch=cancel_epoch+1 WHERE id=$1",[row.id]);
   await db.query("INSERT INTO worker_queue_clear_event(scope,job_id,state_before,resolution,actor_id) VALUES('OUTBOX',$1,$2,$3,$4) ON CONFLICT(scope,job_id) DO NOTHING",[row.id,row.state,resolution,user.id]);
   if(resolution==='CANCELLED')totals.cancelled++;
   else if(resolution==='RECONCILIATION_REQUIRED')totals.uncertain++;
   else totals.hidden++;
  }
 }
 if(input.scope!=='OUTBOX'){
  const rows=(await db.query<Row>('SELECT * FROM lock_archive_queue_for_clear($1,$2)',[user.id,input.action==='CLEAR_SELECTED'?input.ids:null])).rows;
  for(const row of rows){
   const resolution=row.completed?'HIDDEN_COMPLETED':row.claimed?'CANCEL_REQUESTED':'CANCELLED';
   if(!row.completed&&['PENDING','FAILED'].includes(row.state))
    await db.query('SELECT request_archive_queue_clear($1,$2)',[row.id,user.id]);
   await db.query("INSERT INTO worker_queue_clear_event(scope,job_id,state_before,resolution,actor_id) VALUES('ARCHIVE',$1,$2,$3,$4) ON CONFLICT(scope,job_id) DO NOTHING",[row.id,row.state,resolution,user.id]);
   if(resolution==='CANCELLED')totals.cancelled++;
   else if(resolution==='CANCEL_REQUESTED')totals.requested++;
   else totals.hidden++;
  }
 }
 await appendAudit(db,{actorId:user.id,action:'WORKER_QUEUE_CLEARED',resourceType:'JOB',details:{outcome:'CLEAR_REQUESTED',count:totals.cancelled+totals.requested+totals.uncertain+totals.hidden}});
 return totals;
}
