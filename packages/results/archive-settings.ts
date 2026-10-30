import path from 'node:path';
import type {Queryable} from '../db/connection';
import {requirePermission,type Principal} from '../security/policy';
import {appendAudit} from '../db/audit';
import {uuid} from '../lab/core';

function admin(user:Principal){requirePermission(user,'settings.read',{},'read');}
function validRoot(input:string){
 const root=input.trim();
 if(!root||root.length>500||/[\0\r\n*?"<>|]/.test(root))throw Error('ARCHIVE_PATH_INVALID');
 if(!/^\\\\[^\\/]+\\[^\\/]+(?:\\[^\\/]+)*\\?$/.test(root)){
  if(process.env.NIPT_MODE!=='synthetic'||!path.isAbsolute(root))throw Error('ARCHIVE_UNC_ROOT_REQUIRED');
 }
 if(root.split(/[\\/]/).some(part=>part==='.'||part==='..'))throw Error('ARCHIVE_PATH_INVALID');
 return root;
}
export async function queueArchiveProbe(db:Queryable,user:Principal,input:string){
 admin(user);const root=validRoot(input);
 const row=(await db.query<{id:string}>('INSERT INTO pdf_archive_probe(root_path,requested_by) VALUES($1,$2) RETURNING id',[root,user.id])).rows[0];
 await appendAudit(db,{actorId:user.id,action:'ARCHIVE_TEST_REQUESTED',resourceType:'PDF_ARCHIVE',resourceId:row.id});
 return row.id;
}
/** Caller owns a database transaction. Probe results expire after ten minutes. */
export async function enableArchive(db:Queryable,user:Principal,id:string){
 admin(user);await db.query("SELECT pg_advisory_xact_lock(hashtextextended('pdf_archive_config',0))");
 const probe=(await db.query<{root_path:string}>("SELECT root_path FROM pdf_archive_probe WHERE id=$1 AND requested_by=$2 AND retry_job_id IS NULL AND state='PASSED' AND used_at IS NULL AND completed_at>clock_timestamp()-interval '10 minutes' FOR UPDATE",[id,user.id])).rows[0];
 if(!probe)throw Error('ARCHIVE_TEST_REQUIRED');
 await db.query('UPDATE pdf_archive_window SET deactivated_at=clock_timestamp() WHERE deactivated_at IS NULL');
 await db.query('INSERT INTO pdf_archive_window(root_path,activated_by) VALUES($1,$2)',[probe.root_path,user.id]);
 await db.query('UPDATE pdf_archive_config SET enabled=true,root_path=$1,updated_by=$2,updated_at=clock_timestamp() WHERE singleton',[probe.root_path,user.id]);
 await db.query('UPDATE pdf_archive_probe SET used_at=clock_timestamp() WHERE id=$1',[id]);
 await appendAudit(db,{actorId:user.id,action:'ARCHIVE_ENABLED',resourceType:'PDF_ARCHIVE',resourceId:id});
}
export async function disableArchive(db:Queryable,user:Principal){
 admin(user);await db.query("SELECT pg_advisory_xact_lock(hashtextextended('pdf_archive_config',0))");
 await db.query('UPDATE pdf_archive_window SET deactivated_at=clock_timestamp() WHERE deactivated_at IS NULL');
 await db.query('UPDATE pdf_archive_config SET enabled=false,updated_by=$1,updated_at=clock_timestamp() WHERE singleton',[user.id]);
 await appendAudit(db,{actorId:user.id,action:'ARCHIVE_DISABLED',resourceType:'PDF_ARCHIVE'});
}
/**
 * Queue an UNTRUSTED recovery hint, not a privileged database retry.
 * The worker must independently probe its own storage root, confirm that
 * the job is FAILED and belongs to the currently enabled archive root, and
 * only then requeue it. Caller-provided user IDs have no authority there.
 */
export async function retryFailedArchive(db:Queryable,user:Principal,id:string){
 admin(user);const jobId=uuid.parse(id);
 const row=(await db.query<{root_path:string}>(`SELECT w.root_path FROM pdf_archive_job j
  JOIN pdf_archive_window w ON w.id=j.window_id
  JOIN pdf_archive_config cfg ON cfg.singleton AND cfg.enabled AND cfg.root_path=w.root_path
  WHERE j.id=$1 AND j.state='FAILED' AND j.cancellation_requested_at IS NULL`,[jobId])).rows[0];
 if(!row)throw Error('ARCHIVE_RETRY_UNAVAILABLE');
 const request=(await db.query<{id:string}>(`INSERT INTO pdf_archive_probe(root_path,requested_by,retry_job_id)
  VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING id`,[row.root_path,user.id,jobId])).rows[0];
 if(!request)throw Error('ARCHIVE_RETRY_ALREADY_QUEUED');
 await appendAudit(db,{actorId:user.id,action:'ARCHIVE_RECHECK_REQUESTED',resourceType:'PDF_ARCHIVE',resourceId:jobId,
  details:{reasonCode:'WORKER_RECHECK'}});
 return {probeId:request.id,state:'PENDING_PROBE' as const};
}
