import {z} from 'zod';
import type {Queryable} from '../db/connection';
import {requirePermission,type Principal} from '../security/policy';
import {appendAudit} from '../db/audit';
import {FROM,OUTBOX_STATUS_SQL} from './admin-center';

const inputSchema=z.strictObject({action:z.literal('RESOLVE_SELECTED'),scope:z.literal('OUTBOX'),ids:z.array(z.uuid()).min(1).max(75)});
export type ResolveResult={resolved:number;notApplicable:number};

/**
 * Owner 2026-11-25 "ปิดงานที่ตรวจแล้ว": an Administrator who has checked a HIS outbox job that shows "ต้องตรวจสอบปลายทาง" closes it.
 * Only that status can be closed; any other selected job is left as it is and counted as not applicable. The close is recorded once
 * (worker_queue_resolution, immutable) and the job becomes Cancelled in the same transaction, so the Worker skips it and the backlog
 * no longer counts it (as results/service.ts already cancels a pending release job from web). Receipts, releases and HIS files are
 * not touched. No reason is asked (Owner); who closed it and when is kept in the record and the Audit Log.
 */
export async function resolveCheckedOutboxJobs(db:Queryable,user:Principal,raw:unknown):Promise<ResolveResult>{
 requirePermission(user,'settings.read',{},'read');
 if(!user.roles.includes('APP_ADMIN'))throw Error('FORBIDDEN');
 const input=inputSchema.parse(raw);
 const rows=(await db.query<{id:string;status:string}>(`SELECT j.id,${OUTBOX_STATUS_SQL} status ${FROM.OUTBOX} WHERE j.id=ANY($1::uuid[]) FOR UPDATE OF j`,[input.ids])).rows;
 let resolved=0;
 for(const row of rows.filter(r=>r.status==='RECONCILIATION_REQUIRED')){
  const inserted=await db.query(`INSERT INTO worker_queue_resolution(job_id,scope,status_before,resolved_by) VALUES($1,'OUTBOX',$2,$3)
   ON CONFLICT(job_id) DO NOTHING RETURNING job_id`,[row.id,row.status,user.id]);
  if(!inserted.rows.length)continue;
  await db.query("UPDATE job_outbox SET state='Cancelled',cancel_epoch=cancel_epoch+1 WHERE id=$1 AND state<>'Cancelled'",[row.id]);
  resolved++;
 }
 await appendAudit(db,{actorId:user.id,action:'WORKER_QUEUE_JOB_RESOLVED',resourceType:'JOB',details:{outcome:'RESOLVED',count:resolved}});
 return {resolved,notApplicable:input.ids.length-resolved};
}
