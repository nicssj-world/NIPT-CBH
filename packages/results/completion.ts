import {createHash} from 'node:crypto';
import {z} from 'zod';
import type {Queryable} from '../db/connection';
import {assertSession,need,uuid,LabError,caseVisible,type Staff} from '../lab/core';
import {authorize} from '../security/policy';
import type {Parsed} from './parser';
import {attemptEvidence} from './evidence';
import {isNoCallReport} from './parser';
import {autoMatchCandidate,linkCandidates,resultSettings,confirmImport,proposeAutoMatch,decideLink,reviewExternalForRelease,validationGateIssues,type Candidate} from './service';

export function completionPreview(candidates:Candidate[],options:{kind:string;openRevision:boolean}){
 const candidate=autoMatchCandidate(candidates,options);
 return {ready:!!candidate,candidate,reasons:candidate?[]:[options.kind!=='RESULT'?'NOT_FINAL_RESULT':options.openRevision?'OPEN_REPORT_EXISTS_FOR_ROUND':'IDENTITY_MATCH_REQUIRED']};
}
const previewSchema=z.strictObject({intakeIds:z.array(uuid).min(1).max(100)});
export async function previewCompletion(db:Queryable,user:Staff,input:unknown){
 await assertSession(db,user);need(user,'result.import');
 const d=previewSchema.parse(input),settings=await resultSettings(db),items=[];
 for(const id of [...new Set(d.intakeIds)]){
  const r=(await db.query<{id:string;actor_id:string;state:string;container:string;parsed:Parsed;sha256:string;name:string;job_id:string|null}>(
   'SELECT *,coalesce(member_name,original_name) name FROM result_intake_file WHERE id=$1',[id])).rows[0];
  if(!r||r.actor_id!==user.id)throw new LabError('NOT_FOUND',404);
  if(r.state!=='Parsed'||r.container==='ZIP_BATCH'){items.push({intakeId:id,name:r.name,ready:false,candidate:null,reasons:['INTAKE_NOT_READY'],abnormal:false});continue;}
  const candidates=await linkCandidates(db,user,r.parsed,settings);
  const open=candidates.length?(await db.query('SELECT 1 FROM result_report_version WHERE round_id=ANY($1::uuid[]) AND kind=$2 AND state IN (\'LinkConflict\',\'Linked\',\'ValidationBlocked\',\'PendingCertification\',\'CertifiedReleased\') LIMIT 1',[candidates.map(c=>c.round.id),'RESULT'])).rows.length>0:false;
  const planned=completionPreview(candidates,{kind:['SINGLETON','TWIN'].includes(r.parsed.templateKind)?'RESULT':r.parsed.templateKind,openRevision:open});
  if(!authorize(user,'result.certify')){planned.ready=false;planned.reasons.push('CERTIFIER_REQUIRED');}
  const run=planned.candidate?(await db.query<{run_label:string}>("SELECT b.run_label FROM lab_slot_assignment a JOIN lab_batch b ON b.id=a.batch_id WHERE a.attempt_id=$1 AND a.removed_at IS NULL AND b.state<>'Cancelled'",[planned.candidate.attempt.id])).rows[0]?.run_label??null:null;
  if(planned.candidate&&!run){planned.ready=false;planned.reasons.push('REPORT_RUN_REQUIRED');}
  if(planned.candidate&&!isNoCallReport(r.parsed)){
   const evidence=await attemptEvidence(db,planned.candidate.attempt.id,user.id);
   if(!evidence.current||!evidence.analysisAccepted||(!evidence.sequencingId&&!evidence.benchReviewId)){planned.ready=false;planned.reasons.push('SEQUENCING_EVIDENCE_REQUIRED');}
   else if(!evidence.sequencingId&&evidence.benchReviewId&&evidence.benchReviewerId!==user.id){planned.ready=false;planned.reasons.push('SEQUENCING_REVIEWER_MISMATCH');}
  }
  items.push({intakeId:id,name:r.name,...planned,runLabel:run,abnormal:r.parsed.abnormal});
 }
 return {items};
}
const confirmSchema=z.strictObject({idempotencyKey:uuid,abnormalAcknowledged:z.boolean().default(false),items:z.array(z.strictObject({intakeId:uuid,caseId:uuid,roundId:uuid,attemptId:uuid})).min(1).max(100)});
export async function confirmCompletion(db:Queryable,user:Staff,input:unknown){
 await assertSession(db,user);need(user,'result.import');need(user,'result.certify');
 const d=confirmSchema.parse(input),items=[];
 for(const requested of d.items){
  await db.query('SAVEPOINT complete_result_item');
  try{
   const source=(await db.query<{actor_id:string}>('SELECT actor_id FROM result_intake_file WHERE id=$1',[requested.intakeId])).rows[0];
   if(!source||source.actor_id!==user.id)throw new LabError('NOT_FOUND',404);
   const key='complete-'+createHash('sha256').update(d.idempotencyKey+requested.intakeId).digest('hex').slice(0,48);
   await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,75432866))',[key]);
   // Replay: this intake already became a version that waits for sending (or was certified earlier). Bound to the requested target.
   const prior=(await db.query<{version_id:string;state:string;case_id:string;round_id:string;attempt_id:string;registration_origin:string;unit_id:string|null}>(`SELECT v.id version_id,v.state,v.case_id,v.round_id,v.attempt_id,c.registration_origin,
    (SELECT unit_id FROM case_unit_scope WHERE case_id=v.case_id ORDER BY unit_id LIMIT 1) unit_id
    FROM result_report_version v JOIN nipt_case c ON c.id=v.case_id WHERE v.intake_file_id=$1 AND v.round_id IS NOT NULL AND v.state IN ('PendingCertification','CertifiedReleased') ORDER BY v.imported_at DESC LIMIT 1`,[requested.intakeId])).rows[0];
   if(prior){
    if(!caseVisible(user,prior))throw new LabError('NOT_FOUND',404);
    if(prior.case_id!==requested.caseId||prior.round_id!==requested.roundId||prior.attempt_id!==requested.attemptId)throw new LabError('IDEMPOTENCY_KEY_REUSED',409);
    items.push({intakeId:requested.intakeId,versionId:prior.version_id,outcome:prior.state});await db.query('RELEASE SAVEPOINT complete_result_item');continue;
   }
   const preview=(await previewCompletion(db,user,{intakeIds:[requested.intakeId]})).items[0],c=preview.candidate;
   if(!preview.ready||!c)throw new LabError(preview.reasons[0]??'IDENTITY_MATCH_REQUIRED',409);
   if(c.caseId!==requested.caseId||c.round.id!==requested.roundId||c.attempt.id!==requested.attemptId)throw new LabError('MATCH_CHANGED_SINCE_PREVIEW',409);
   if(preview.abnormal&&!d.abnormalAcknowledged)throw new LabError('ABNORMAL_ACK_REQUIRED',422);
   const imported=(await confirmImport(db,user,{intakeIds:[requested.intakeId]}))[0];
   if(!imported.versionId)throw new LabError('INTAKE_NOT_READY',409);
   const version=async()=>(await db.query<{id:string;state:string;row_version:number;round_id:string;attempt_id:string}>('SELECT id,state,row_version,round_id,attempt_id FROM result_report_version WHERE id=$1',[imported.versionId])).rows[0];
   let v=await version();
   if(v.state==='Unlinked'){
    await proposeAutoMatch(db,user,{versionId:v.id,expectedRowVersion:v.row_version});v=await version();
    if(v.state==='Unlinked'){await decideLink(db,user,{versionId:v.id,decision:'APPROVE',reason:'ยืนยันการจับคู่ PDF Final กับผู้ป่วยจากหน้าออกผล',expectedRowVersion:v.row_version});v=await version();}
   }
   if(v.round_id!==requested.roundId||v.attempt_id!==requested.attemptId)throw new LabError('MATCH_CHANGED_SINCE_PREVIEW',409);
   // Review + QC5 only: the version waits in PendingCertification ("รอส่ง HIS"); ANC sees nothing until the Send HIS step certifies it.
   const reviewed=await reviewExternalForRelease(db,user,{versionId:v.id,expectedRowVersion:v.row_version,abnormalAcknowledged:d.abnormalAcknowledged});
   if(reviewed.state!=='PendingCertification')throw new LabError('RESULT_COMPLETION_BLOCKED',409,{state:reviewed.state,...await validationGateIssues(db,v.id)});
   items.push({intakeId:requested.intakeId,versionId:v.id,outcome:'PendingCertification'});
   await db.query('RELEASE SAVEPOINT complete_result_item');
  }catch(e){await db.query('ROLLBACK TO SAVEPOINT complete_result_item');await db.query('RELEASE SAVEPOINT complete_result_item');if(!(e instanceof LabError))throw e;items.push({intakeId:requested.intakeId,outcome:'HOLD',code:e.code,details:e.details});}
 }
 return {items};
}
