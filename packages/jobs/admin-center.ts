import {z} from 'zod';
import type {Queryable} from '../db/connection';
import {requirePermission,type Principal} from '../security/policy';

function admin(user:Principal){
 requirePermission(user,'settings.read',{},'read');
 if(!user.roles.includes('APP_ADMIN'))throw Error('FORBIDDEN');
}

/** Display status of a HIS outbox job, derived only from stored evidence. */
export const OUTBOX_STATUS_SQL=`CASE
  WHEN o.outcome='RECONCILIATION_REQUIRED' THEN 'RECONCILIATION_REQUIRED'
  WHEN EXISTS(SELECT 1 FROM integration_job_receipt r WHERE r.outbox_id=j.id) THEN 'COMPLETED'
  WHEN j.state='Cancelled' THEN 'CANCELLED'
  WHEN q.id IS NOT NULL AND o.request_id IS NULL THEN 'CANCEL_REQUESTED'
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

const pageSchema=z.strictObject({
 scope:z.enum(['OUTBOX','ARCHIVE']).default('OUTBOX'),
 status:z.string().regex(/^[A-Z_]{3,30}$/).optional(),
 page:z.coerce.number().int().min(1).max(100000).default(1),
 pageSize:z.coerce.number().int().refine(n=>[25,50,100].includes(n)).default(50)
});
export type QueueRow={id:string;kind:string;status:string;created_at:Date;attempts:number|null;error:string|null};

/** Admin-only, redacted: no payload, patient identifiers, paths or result values. */
export async function readWorkerQueueOverview(db:Queryable,user:Principal,raw:unknown={}){
 admin(user);
 const f=pageSchema.parse(raw);
 const joins=(table:'job_outbox'|'pdf_archive_job',scope:string)=>`FROM ${table} j
  LEFT JOIN worker_queue_clear_request q ON q.scope='${scope}' AND q.job_id=j.id
  LEFT JOIN worker_queue_clear_outcome o ON o.request_id=q.id`;
 const outboxFrom=joins('job_outbox','OUTBOX'),archiveFrom=joins('pdf_archive_job','ARCHIVE');
 const [outboxCounts,archiveCounts]=await Promise.all([
  db.query<{kind:string;status:string;count:number}>(`SELECT j.kind,${OUTBOX_STATUS_SQL} status,count(*)::int count ${outboxFrom} GROUP BY 1,2 ORDER BY 1,2`),
  db.query<{kind:string;status:string;count:number}>(`SELECT 'nas_pdf_archive' kind,${ARCHIVE_STATUS_SQL} status,count(*)::int count ${archiveFrom} GROUP BY 2 ORDER BY 2`)
 ]);
 const from=f.scope==='OUTBOX'?outboxFrom:archiveFrom,status=f.scope==='OUTBOX'?OUTBOX_STATUS_SQL:ARCHIVE_STATUS_SQL;
 const kind=f.scope==='OUTBOX'?'j.kind':"'nas_pdf_archive'",attempts=f.scope==='OUTBOX'?'NULL::int':'j.attempts',error=f.scope==='OUTBOX'?'NULL::text':'j.last_error';
 const where=f.status?`WHERE ${status}=$1`:'',args=f.status?[f.status]:[];
 const total=Number((await db.query<{n:string}>(`SELECT count(*)::text n ${from} ${where}`,args)).rows[0].n);
 const pages=Math.max(1,Math.ceil(total/f.pageSize)),page=Math.min(f.page,pages);
 const rows=(await db.query<QueueRow>(`SELECT j.id,${kind} kind,${status} status,j.created_at,${attempts} attempts,${error} error
  ${from} ${where} ORDER BY j.created_at DESC,j.id DESC LIMIT ${f.pageSize} OFFSET ${(page-1)*f.pageSize}`,args)).rows;
 return {counts:[...outboxCounts.rows.map(r=>({...r,scope:'OUTBOX' as const})),...archiveCounts.rows.map(r=>({...r,scope:'ARCHIVE' as const}))],
  rows,scope:f.scope,status:f.status??null,page,pages,total,pageSize:f.pageSize};
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
