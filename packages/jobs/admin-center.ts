import type {Queryable} from '../db/connection';
import type {Principal} from '../security/policy';
import {requirePermission} from '../security/policy';

/** Admin-only redacted overview. No payload, patient identifiers or outbound paths. */
export async function readWorkerQueueOverview(db:Queryable,user:Principal){
 requirePermission(user,'settings.read',{},'read');
 if(!user.roles.includes('APP_ADMIN'))throw Error('FORBIDDEN');
 const [outbox,archive,items,archiveJobs]=await Promise.all([
  db.query<{kind:string;state:string;completed:boolean;count:number}>(`SELECT j.kind,j.state,
   (r.outbox_id IS NOT NULL) completed,count(*)::int count
   FROM job_outbox j LEFT JOIN integration_job_receipt r ON r.outbox_id=j.id
   WHERE NOT EXISTS(SELECT 1 FROM worker_queue_clear_event e WHERE e.scope='OUTBOX' AND e.job_id=j.id AND e.resolution<>'RECONCILIATION_REQUIRED')
   GROUP BY j.kind,j.state,(r.outbox_id IS NOT NULL)
   ORDER BY j.kind,j.state`),
  db.query<{state:string;count:number}>(`SELECT state,count(*)::int count FROM pdf_archive_job j WHERE NOT EXISTS(SELECT 1 FROM worker_queue_clear_event e WHERE e.scope='ARCHIVE' AND e.job_id=j.id AND e.resolution<>'CANCEL_REQUESTED') GROUP BY state ORDER BY state`),
  db.query<{id:string;kind:string;state:string;created_at:Date;completed:boolean;reconciliation_required:boolean}>(`SELECT j.id,j.kind,j.state,j.created_at,
    EXISTS(SELECT 1 FROM worker_queue_clear_event e WHERE e.scope='OUTBOX' AND e.job_id=j.id AND e.resolution='RECONCILIATION_REQUIRED') reconciliation_required,
    (r.outbox_id IS NOT NULL) completed
    FROM job_outbox j LEFT JOIN integration_job_receipt r ON r.outbox_id=j.id
    WHERE NOT EXISTS(SELECT 1 FROM worker_queue_clear_event e WHERE e.scope='OUTBOX' AND e.job_id=j.id AND e.resolution<>'RECONCILIATION_REQUIRED')
    ORDER BY j.created_at DESC,j.id DESC LIMIT 75`),
  db.query<{id:string;state:string;created_at:Date;attempts:number;claimed:boolean;reconciliation_required:boolean}>(`SELECT j.id,j.state,j.created_at,j.attempts,(j.claim_token IS NOT NULL) claimed,
    EXISTS(SELECT 1 FROM worker_queue_clear_event e WHERE e.scope='ARCHIVE' AND e.job_id=j.id AND e.resolution='CANCEL_REQUESTED') reconciliation_required
    FROM pdf_archive_job j
    WHERE NOT EXISTS(SELECT 1 FROM worker_queue_clear_event e WHERE e.scope='ARCHIVE' AND e.job_id=j.id AND e.resolution<>'CANCEL_REQUESTED')
    ORDER BY j.created_at DESC,j.id DESC LIMIT 75`)
 ]);
 return {outbox:outbox.rows,archive:archive.rows,items:items.rows,archiveJobs:archiveJobs.rows};
}

/** Bounded, redacted pg-boss overview, including active/retry/scheduled jobs.
 * Real transport control and outbox receipt reconciliation remain separate.
 */
export async function readPgBossQueueOverview(db:Queryable,user:Principal){
 requirePermission(user,'settings.read',{},'read');
 if(!user.roles.includes('APP_ADMIN'))throw Error('FORBIDDEN');
 const [counts,items]=await Promise.all([
  db.query<{kind:string;job_state:string;job_count:number}>('SELECT * FROM nipt_pg_boss_counts()'),
  db.query<{job_id:string;kind:string;job_state:string;created_at:Date;start_after:Date;retry_count:number}>('SELECT * FROM nipt_pg_boss_recent($1)',[75])
 ]);
 return {counts:counts.rows,items:items.rows};
}
