import {createHash} from 'node:crypto';
import {z} from 'zod';
import type {Queryable} from '../db/connection';
import {assertSession,need,uuid,LabError,type Staff} from '../lab/core';
import {operationalWorkflow} from '../lab/operational';
import {certifyAttempt,recordReview,releaseReviewed,reviewExternalForRelease,reviewInternalForRelease} from './service';

export type SendHisOutcome={versionId:string;outcome:'CertifiedReleased'|'BLOCKED'|'ERROR';code?:string;failed?:string[];pending?:string[];details?:unknown};
const sendSchema=z.strictObject({idempotencyKey:uuid,reviewConfirmed:z.boolean(),abnormalAcknowledged:z.boolean(),items:z.array(z.strictObject({versionId:uuid,expectedRowVersion:z.number().int().positive()})).min(1).max(100)});

const MIGRATION_GUARDS=/^MIGRATION_(CURRENT_SOURCE_REQUIRED|REVIEW_BINDING_AUTHORITY_REQUIRED|RELEASE_CURRENT_AUTHORITY_REQUIRED)$/;
/** migration_result_review BEFORE INSERT guards raise plain PostgreSQL exceptions (P0001) with a fixed message.
 *  Untested: the dev fixtures have no migrated-record result. Every other non-LabError still aborts the whole call (fail closed). */
const isMigrationGuard=(e:unknown)=>!(e instanceof LabError)&&typeof e==='object'&&e!==null&&(e as {code?:string}).code==='P0001'&&MIGRATION_GUARDS.test(String((e as {message?:string}).message));

/**
 * "ส่ง HIS" (result-release simplification, Task 4): the only step that certifies a result that waits in PendingCertification.
 * Per item (own SAVEPOINT): review + QC5 first if still missing, then certifyAttempt, which creates the release, makes ANC see the
 * result and queues the HIS outbox job (EQA and "มีผลใน HIS แล้ว" results are certified without a job — inside certifyAttempt).
 * An item that fails its gate at send time becomes BLOCKED (version in ValidationBlocked) and never affects the other items.
 * A version that is already CertifiedReleased returns CertifiedReleased and writes nothing (so a replay or a second key creates no second release).
 */
export async function sendToHis(db:Queryable,user:Staff,input:unknown):Promise<{items:SendHisOutcome[]}>{
 await assertSession(db,user);need(user,'result.review');need(user,'result.certify');need(user,'result.release.check');
 const d=sendSchema.parse(input);
 if(new Set(d.items.map(i=>i.versionId)).size!==d.items.length)throw new LabError('DUPLICATE_ITEMS',422);
 // Without the operational workflow certifyAttempt would only record RELEASE_HOLD and burn the key: refuse before any write.
 if(!await operationalWorkflow(db))throw new LabError('OPERATIONAL_MODE_REQUIRED',409);
 const done=new Map<string,SendHisOutcome>();
 // Fixed lock order (by versionId) so concurrent batches [x,y] and [y,x] cannot deadlock; the response keeps the request order.
 for(const requested of [...d.items].sort((a,b)=>a.versionId<b.versionId?-1:1)){
  const versionId=requested.versionId;
  await db.query('SAVEPOINT send_his_item');
  try{
   const key='send-'+createHash('sha256').update(d.idempotencyKey+versionId).digest('hex').slice(0,48);
   const row=async()=>(await db.query<{state:string;origin:'EXTERNAL_READYGEN'|'INTERNAL_GENERATED';row_version:number;abnormal:boolean}>("SELECT state,origin,row_version,coalesce((parsed->>'abnormal')::boolean,false) abnormal FROM result_report_version WHERE id=$1",[versionId])).rows[0];
   let v=await row();if(!v)throw new LabError('NOT_FOUND',404);
   if(v.state==='CertifiedReleased'){done.set(versionId,{versionId,outcome:'CertifiedReleased'});await db.query('RELEASE SAVEPOINT send_his_item');continue;}
   const replay=(await db.query('SELECT 1 FROM result_gate_evaluation WHERE idempotency_key=$1',[key])).rows.length>0;
   if(!replay){
    if(v.row_version!==requested.expectedRowVersion)throw new LabError('VERSION_CONFLICT',409);
    if(!['Linked','ValidationBlocked','PendingCertification'].includes(v.state))throw new LabError('SEND_REQUIRES_REVIEWED_RESULT',409);
    if(v.abnormal&&!d.abnormalAcknowledged)throw new LabError('ABNORMAL_ACK_REQUIRED',422);
    if(!await releaseReviewed(db,versionId)){
     if(!d.reviewConfirmed)throw new LabError('REVIEW_CONFIRMATION_REQUIRED',422);
     // result_qc5_review is unique per version: a version that already has QC5 (stale review only) gets a new review alone.
     const hasQc5=(await db.query('SELECT 1 FROM result_qc5_review WHERE version_id=$1',[versionId])).rows.length>0;
     if(hasQc5)await recordReview(db,user,{versionId,valuesMatchPdf:true,abnormalAcknowledged:d.abnormalAcknowledged,expectedRowVersion:v.row_version});
     else{
      const review=v.origin==='INTERNAL_GENERATED'?reviewInternalForRelease:reviewExternalForRelease;
      await review(db,user,{versionId,expectedRowVersion:v.row_version,abnormalAcknowledged:d.abnormalAcknowledged});
     }
     v=(await row())!;
    }
   }
   const r=await certifyAttempt(db,user,{versionId,idempotencyKey:key,abnormalAcknowledged:d.abnormalAcknowledged,expectedRowVersion:v.row_version,confirmed:true});
   done.set(versionId,r.outcome==='CertifiedReleased'?{versionId,outcome:'CertifiedReleased'}:{versionId,outcome:'BLOCKED',failed:r.failed,pending:r.pending});
   await db.query('RELEASE SAVEPOINT send_his_item');
  }catch(e){
   await db.query('ROLLBACK TO SAVEPOINT send_his_item');await db.query('RELEASE SAVEPOINT send_his_item');
   if(isMigrationGuard(e)){done.set(versionId,{versionId,outcome:'ERROR',code:'MIGRATION_REVIEW_PRECONDITION_FAILED'});continue;}
   if(!(e instanceof LabError))throw e;
   done.set(versionId,{versionId,outcome:'ERROR',code:e.code,...(e.details!==undefined?{details:e.details}:{})});
  }
 }
 return {items:d.items.map(i=>done.get(i.versionId)!)};
}
