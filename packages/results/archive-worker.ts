import type {Queryable} from '../db/connection';
import type {FileStore} from '../storage';
import {publishFinalReport} from './archive-core';
import {resolveArchiveSource} from './archive-source';
import {probeArchiveRoot} from './archive-probe';
import {workerServiceAccount} from '../integrations/authorized-share';

type Job={id:string;claim_token:string;release_id:string;case_id:string;version_id:string;source_sha256:string;root_path:string;attempts:number};
const maxAttempts=5;

export async function runArchiveProbeCycle(db:Queryable){
 const request=(await db.query<{id:string;root_path:string;claim_token:string}>(`WITH candidate AS (
  SELECT id FROM pdf_archive_probe WHERE state='PENDING' OR (state='RUNNING' AND claimed_until<clock_timestamp())
  ORDER BY requested_at FOR UPDATE SKIP LOCKED LIMIT 1
 ) UPDATE pdf_archive_probe p SET state='RUNNING',claim_token=gen_random_uuid(),claimed_until=clock_timestamp()+interval '10 minutes'
 FROM candidate WHERE p.id=candidate.id RETURNING p.id,p.root_path,p.claim_token`)).rows[0];
 if(!request)return;
 const result=await probeArchiveRoot(request.root_path);
 let account:string|null=null;try{account=workerServiceAccount();}catch{/* Do not invent an identity. */}
 const passed=result.ok&&!!account;
 // Complete the probe and optionally recover a FAILED job in ONE SQL statement.
 // The request's actor UUID and claimed admin role are deliberately ignored.
 // A caller with app_rw can request a recheck, but only worker_rw can reset jobs.
 // Recovery is allowed only for an existing failed job on the *same currently
 // enabled root* after this worker's own filesystem probe really passed.
 await db.query(`WITH completed AS (
   UPDATE pdf_archive_probe SET state=$3,error_code=$4,worker_account=$5,
    completed_at=clock_timestamp(),claim_token=NULL,claimed_until=NULL
   WHERE id=$1 AND claim_token=$2
   RETURNING retry_job_id,root_path,state
 ), recovered AS (
   UPDATE pdf_archive_job j SET state='PENDING',attempts=0,
    next_attempt_at=clock_timestamp(),last_error=NULL,
    claimed_until=NULL,claim_token=NULL,updated_at=clock_timestamp()
   FROM completed p
   JOIN pdf_archive_window w ON w.root_path=p.root_path
   JOIN pdf_archive_config cfg ON cfg.singleton AND cfg.enabled AND cfg.root_path=p.root_path
   WHERE p.state='PASSED' AND p.retry_job_id=j.id AND w.id=j.window_id
    AND j.state='FAILED' AND j.claim_token IS NULL AND j.claimed_until IS NULL
   RETURNING j.id
 ) SELECT (SELECT count(*)::int FROM completed) completed_count,
          (SELECT count(*)::int FROM recovered) recovered_count`,
 [request.id,request.claim_token,passed?'PASSED':'FAILED',
  !account?'ARCHIVE_WORKER_IDENTITY_UNAVAILABLE':result.ok?null:result.reason,account]);
}

/** One bounded cycle. NAS I/O occurs after the atomic claim, outside clinical transactions. */
export async function runArchiveCycle(db:Queryable,store:Pick<FileStore,'get'>,publish:typeof publishFinalReport=publishFinalReport){
 await db.query(`INSERT INTO pdf_archive_job(window_id,release_id,version_id,case_id,source_sha256)
  SELECT w.id,r.id,v.id,r.case_id,v.sha256 FROM result_release_completed c
  JOIN result_release r ON r.id=c.release_id AND r.version_id=c.version_id
  JOIN result_report_version v ON v.id=r.version_id AND v.case_id=r.case_id AND v.round_id=r.round_id
  JOIN nipt_case n ON n.id=r.case_id AND n.registration_origin<>'HISTORICAL'
  JOIN pdf_archive_window w ON r.certified_at>w.activated_at AND c.created_at>w.activated_at AND (w.deactivated_at IS NULL OR (r.certified_at<w.deactivated_at AND c.created_at<w.deactivated_at))
  WHERE EXISTS(SELECT 1 FROM pdf_archive_config WHERE singleton AND enabled)
  AND NOT EXISTS(SELECT 1 FROM pdf_archive_job j WHERE j.release_id=r.id)
  ORDER BY c.created_at,c.id LIMIT 20 ON CONFLICT(release_id) DO NOTHING`);
 const result=await db.query<Job>(`WITH expired AS (
  UPDATE pdf_archive_job SET state='FAILED',last_error='ARCHIVE_CLAIM_EXPIRED',claim_token=NULL,claimed_until=NULL,updated_at=clock_timestamp()
  WHERE state='PENDING' AND attempts>=5 AND claimed_until<clock_timestamp() RETURNING id
 ), candidate AS (
  SELECT j.id FROM pdf_archive_job j WHERE j.state='PENDING' AND j.attempts<5 AND j.next_attempt_at<=clock_timestamp()
   AND (j.claimed_until IS NULL OR j.claimed_until<clock_timestamp())
   AND EXISTS(SELECT 1 FROM pdf_archive_config WHERE singleton AND enabled)
  ORDER BY j.next_attempt_at,j.created_at FOR UPDATE SKIP LOCKED LIMIT 1
 ) UPDATE pdf_archive_job j SET claim_token=gen_random_uuid(),claimed_until=clock_timestamp()+interval '10 minutes',attempts=j.attempts+1,updated_at=clock_timestamp()
 FROM candidate,pdf_archive_window w WHERE j.id=candidate.id AND w.id=j.window_id
 RETURNING j.id,j.claim_token,j.release_id,j.case_id,j.version_id,j.source_sha256,j.attempts,w.root_path`);
 const job=result.rows[0];if(!job)return;
 try{
  const source=await resolveArchiveSource(db,store,job.release_id);
  if(source.caseId!==job.case_id||source.versionId!==job.version_id||source.sha256!==job.source_sha256)throw Error('ARCHIVE_IDENTITY_MISMATCH');
  const outcome=await publish(job.root_path,source);
  if(outcome.state!=='ARCHIVED'||outcome.sha256!==job.source_sha256)throw Error(outcome.reason??'ARCHIVE_PUBLICATION_FAILED');
  await db.query("UPDATE pdf_archive_job SET state='ARCHIVED',archived_at=clock_timestamp(),updated_at=clock_timestamp(),last_error=NULL,claim_token=NULL,claimed_until=NULL WHERE id=$1 AND claim_token=$2",[job.id,job.claim_token]);
 }catch(error){
  const reason=error instanceof Error&&/^ARCHIVE_[A-Z0-9_]+$/.test(error.message)?error.message:'ARCHIVE_IO_FAILED';
  await db.query(`UPDATE pdf_archive_job SET state=CASE WHEN attempts >= $3 THEN 'FAILED' ELSE 'PENDING' END,
   last_error=$4,next_attempt_at=clock_timestamp()+interval '1 minute' * LEAST(attempts*attempts,30),
   updated_at=clock_timestamp(),claim_token=NULL,claimed_until=NULL WHERE id=$1 AND claim_token=$2`,[job.id,job.claim_token,maxAttempts,reason]);
 }
}
