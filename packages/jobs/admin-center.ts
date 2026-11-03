import {z} from 'zod';
import type {Queryable} from '../db/connection';
import {requirePermission,type Principal} from '../security/policy';

function admin(user:Principal){
 requirePermission(user,'settings.read',{},'read');
 if(!user.roles.includes('APP_ADMIN'))throw Error('FORBIDDEN');
}

/**
 * Display status of a HIS outbox job, derived only from stored evidence. pg-boss state is read for the open (dispatched, no receipt)
 * jobs only. A dispatched job whose queue job is missing, cancelled or completed without a receipt cannot be explained from our
 * records, so it is shown as RECONCILIATION_REQUIRED instead of being guessed.
 */
export const OUTBOX_STATUS_SQL=`CASE
  WHEN o.outcome='RECONCILIATION_REQUIRED' THEN 'RECONCILIATION_REQUIRED'
  WHEN EXISTS(SELECT 1 FROM integration_job_receipt r WHERE r.outbox_id=j.id) THEN 'COMPLETED'
  WHEN j.state='Cancelled' THEN 'CANCELLED'
  WHEN q.id IS NOT NULL AND o.request_id IS NULL THEN 'CANCEL_REQUESTED'
  WHEN rr.id IS NOT NULL AND rr.outcome IS NULL THEN 'RETRY_REQUESTED'
  WHEN j.state='Dispatched' AND b.job_state='failed' THEN 'FAILED'
  WHEN j.state='Dispatched' AND b.job_state='active' THEN 'RUNNING'
  WHEN j.state='Dispatched' AND b.job_state='retry' THEN 'RETRY'
  WHEN j.state='Dispatched' AND b.job_state IN ('missing','completed','cancelled') THEN 'RECONCILIATION_REQUIRED'
  WHEN j.state='Dispatched' THEN 'DISPATCHED'
  ELSE 'PENDING' END`;
export const ARCHIVE_STATUS_SQL=`CASE
  WHEN o.outcome='RECONCILIATION_REQUIRED' THEN 'RECONCILIATION_REQUIRED'
  WHEN j.state='ARCHIVED' THEN 'COMPLETED'
  WHEN j.state='CANCELLED' THEN 'CANCELLED'
  WHEN q.id IS NOT NULL AND o.request_id IS NULL THEN 'CANCEL_REQUESTED'
  WHEN j.state='FAILED' THEN 'FAILED'
  WHEN j.claim_token IS NOT NULL THEN 'RUNNING'
  WHEN j.attempts>0 THEN 'RETRY'
  ELSE 'PENDING' END`;
/** HIS transfer (RES/PDF delivery journal). Anything that may already have been transmitted and is not confirmed needs a human. */
export const TRANSFER_STATUS_SQL=`CASE j.transfer_state
  WHEN 'SYNTHETIC_CONFIRMED' THEN 'COMPLETED'
  WHEN 'CANCELLED' THEN 'CANCELLED'
  WHEN 'RETRY_PENDING' THEN 'RETRY'
  WHEN 'AWAITING_CONFIRMATION' THEN 'AWAITING_HIS'
  WHEN 'PICKED_UP_UNCONFIRMED' THEN 'AWAITING_HIS'
  WHEN 'UNKNOWN_TIMEOUT' THEN 'RECONCILIATION_REQUIRED'
  WHEN 'RECONCILIATION_REQUIRED' THEN 'RECONCILIATION_REQUIRED'
  WHEN 'FAILED_NEEDS_ADMIN' THEN 'RECONCILIATION_REQUIRED'
  ELSE 'RUNNING' END`;

const pageSchema=z.strictObject({
 scope:z.enum(['OUTBOX','ARCHIVE','HIS_TRANSFER']).default('OUTBOX'),
 status:z.preprocess(v=>v===''?undefined:v,z.string().regex(/^[A-Z_]{3,30}$/).optional()),
 page:z.preprocess(v=>v===''?undefined:v,z.coerce.number().int().min(1).max(100000).default(1)),
 pageSize:z.preprocess(v=>v===''?undefined:v,z.coerce.number().int().refine(n=>[25,50,100].includes(n)).default(50))
});
export type QueueRow={id:string;kind:string;status:string;created_at:Date;attempts:number|null;error:string|null};

const OPEN_OUTBOX=`(SELECT COALESCE(array_agg(x.id),'{}') FROM (SELECT id FROM job_outbox WHERE state='Dispatched'
  AND NOT EXISTS(SELECT 1 FROM integration_job_receipt r WHERE r.outbox_id=job_outbox.id) ORDER BY created_at DESC LIMIT 5000) x)`;
const FROM={
 OUTBOX:`FROM job_outbox j
  LEFT JOIN worker_queue_clear_request q ON q.scope='OUTBOX' AND q.job_id=j.id
  LEFT JOIN worker_queue_clear_outcome o ON o.request_id=q.id
  LEFT JOIN nipt_pg_boss_state_of(${OPEN_OUTBOX}) b ON b.job_id=j.id
  LEFT JOIN LATERAL (SELECT r.id,ro.outcome FROM worker_queue_retry_request r LEFT JOIN worker_queue_retry_outcome ro ON ro.request_id=r.id
   WHERE r.job_id=j.id ORDER BY r.requested_at DESC,r.id DESC LIMIT 1) rr ON true`,
 ARCHIVE:`FROM pdf_archive_job j
  LEFT JOIN worker_queue_clear_request q ON q.scope='ARCHIVE' AND q.job_id=j.id
  LEFT JOIN worker_queue_clear_outcome o ON o.request_id=q.id`,
 HIS_TRANSFER:`FROM nipt_his_transfer_overview() j`
} as const;
const STATUS={OUTBOX:OUTBOX_STATUS_SQL,ARCHIVE:ARCHIVE_STATUS_SQL,HIS_TRANSFER:TRANSFER_STATUS_SQL} as const;
const KIND={OUTBOX:'j.kind',ARCHIVE:"'nas_pdf_archive'",HIS_TRANSFER:"'his_transfer'"} as const;
const ATTEMPTS={OUTBOX:'NULL::int',ARCHIVE:'j.attempts',HIS_TRANSFER:'j.attempts'} as const;
const ERROR={OUTBOX:'NULL::text',ARCHIVE:'j.last_error',HIS_TRANSFER:'j.last_code'} as const;

/** Admin-only, redacted: no payload, patient identifiers, paths or result values. */
export async function readWorkerQueueOverview(db:Queryable,user:Principal,raw:unknown={}){
 admin(user);
 const f=pageSchema.parse(raw);
 const counts=await Promise.all((['OUTBOX','ARCHIVE','HIS_TRANSFER'] as const).map(async scope=>
  (await db.query<{kind:string;status:string;count:number}>(`SELECT ${KIND[scope]} kind,${STATUS[scope]} status,count(*)::int count ${FROM[scope]} GROUP BY 1,2 ORDER BY 1,2`)).rows.map(r=>({...r,scope}))));
 const s=f.scope,where=f.status?`WHERE ${STATUS[s]}=$1`:'',args=f.status?[f.status]:[];
  const total=Number((await db.query<{n:string}>(`SELECT count(*)::text n ${FROM[s]} ${where}`,args)).rows[0].n);
 const pages=Math.max(1,Math.ceil(total/f.pageSize)),page=Math.min(f.page,pages);
 const rows=(await db.query<QueueRow>(`SELECT j.id,${KIND[s]} kind,${STATUS[s]} status,j.created_at,${ATTEMPTS[s]} attempts,${ERROR[s]} error
  ${FROM[s]} ${where} ORDER BY j.created_at DESC,j.id DESC LIMIT ${f.pageSize} OFFSET ${(page-1)*f.pageSize}`,args)).rows;
 return {counts:counts.flat(),rows,scope:s,status:f.status??null,page,pages,total,pageSize:f.pageSize};
}

/** Bounded pg-boss inventory (names, states, timestamps and retry counts only). Retry/cancel go through the Worker. */
export async function readPgBossQueueOverview(db:Queryable,user:Principal){
 admin(user);
 const [counts,items]=await Promise.all([
  db.query<{kind:string;job_state:string;job_count:number}>('SELECT * FROM nipt_pg_boss_counts()'),
  db.query<{job_id:string;kind:string;job_state:string;created_on:Date;start_after:Date;retry_count:number}>('SELECT * FROM nipt_pg_boss_recent($1)',[75])
 ]);
 return {counts:counts.rows,items:items.rows};
}
