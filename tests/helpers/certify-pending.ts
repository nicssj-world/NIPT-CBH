import {randomUUID} from 'node:crypto';
import type {Queryable} from '../../packages/db/connection';
import type {Staff} from '../../packages/lab/core';
import {certifyAttempt} from '../../packages/results/service';

/** Since 2026-11-07 finalize/completion stop at PendingCertification. Where a test needs the release, it certifies explicitly (what the Send HIS step does). */
export async function certifyPending(t:Queryable,user:Staff,versionId:string,abnormalAcknowledged=true){
 const v=(await t.query<{row_version:number;state:string}>('SELECT row_version,state FROM result_report_version WHERE id=$1',[versionId])).rows[0];
 if(v.state!=='PendingCertification')throw new Error('NOT_PENDING_CERTIFICATION:'+v.state);
 return certifyAttempt(t,user,{versionId,idempotencyKey:randomUUID(),abnormalAcknowledged,expectedRowVersion:v.row_version,confirmed:true});
}
/** Asserts the version waits to be sent: review + QC5 recorded, no release row, no outbound job. */
export async function pendingState(t:Queryable,versionId:string){
 const q=async(sql:string)=>(await t.query(sql,[versionId])).rows.length;
 return {
  state:(await t.query<{state:string}>('SELECT state FROM result_report_version WHERE id=$1',[versionId])).rows[0].state,
  reviews:await q('SELECT 1 FROM result_review WHERE version_id=$1'),
  qc5:await q('SELECT 1 FROM result_qc5_review WHERE version_id=$1'),
  releases:await q('SELECT 1 FROM result_release WHERE version_id=$1'),
  // Any queued release delivery for this version's case (a release row of the case is what the outbox payload points at).
  outbox:await q("SELECT 1 FROM job_outbox o JOIN result_release r ON r.id::text=o.payload->>'releaseId' JOIN result_report_version v ON v.case_id=r.case_id WHERE o.kind='result_release_completed' AND v.id=$1")
 };
}
