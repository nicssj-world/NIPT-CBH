import {it,expect,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {task3Fixture} from '../helpers/task3';
import {pdfDate} from '../helpers/results';
import {syntheticReportPdf} from '../../tools/his-simulator/result-pdf';
import {registerIntake,parseIntake} from '../../packages/results/intake';
import {reviewBenchForResult} from '../../packages/lab/bench-review';
import {previewCompletion,confirmCompletion} from '../../packages/results/completion';
import {releaseReviewed,ancCaseResults,readReleasedFile,unlinkVersion,proposeLink,decideLink,recordReview,acceptAndRelease,acceptInternalAndRelease} from '../../packages/results/service';
import {SETTINGS} from '../../packages/settings/catalog';
import {proposeSetting,validateSetting,approveSetting,activateSetting} from '../../packages/settings/service';

it('confirmCompletion leaves the PDF in PendingCertification with review and QC5 recorded, preserves PDF bytes and binds replays to actor and target',async()=>{
 const f=await task3Fixture();try{
  const c=f.cases[0],bytes=syntheticReportPdf({kind:'SINGLETON',labNumber:c.printed,hn:c.hn,dob:'01-Jan-1990',collection:pdfDate('2026-10-20'),gaWeeks:17,gaDays:6,sex:null});
  const intakeId=await f.run(t=>registerIntake(t,f.store,{source:'UPLOAD',relativePath:null,originalName:'SYNTHETIC-external-final.pdf',actorId:f.admin.id,jobId:null},bytes));
  await f.run(t=>parseIntake(t,f.store,intakeId,{maxBytes:10000000,acceptZip:true}));
  const preview=()=>f.run(t=>previewCompletion(t,f.admin,{intakeIds:[intakeId]}));
  expect((await preview()).items[0].reasons).toContain('SEQUENCING_EVIDENCE_REQUIRED');
  expect((await f.db.query('SELECT * FROM result_report_version')).rows).toHaveLength(0);
  await f.run(t=>reviewBenchForResult(t,f.admin,c.attemptId,{revision:1,measurementsReviewed:true,reason:'SYNTHETIC legacy paper-only result evidence review'}));
  const p=(await preview()).items[0];expect(p.ready).toBe(true);expect(p.candidate?.ln).toBe(c.ln);
  const request={idempotencyKey:randomUUID(),items:[{intakeId,caseId:c.caseId,roundId:c.roundId,attemptId:c.attemptId}]};
  const completed=await f.run(t=>confirmCompletion(t,f.admin,request));expect(completed.items[0].outcome).toBe('PendingCertification');
  const versionId=completed.items[0].versionId!;
  expect((await f.db.query<{state:string}>('SELECT state FROM result_report_version WHERE id=$1',[versionId])).rows[0].state).toBe('PendingCertification');
  expect(await f.run(t=>releaseReviewed(t,versionId))).toBe(true);
  expect(await f.run(t=>confirmCompletion(t,f.admin,request))).toEqual(completed);
  const changed=await f.run(t=>confirmCompletion(t,f.admin,{...request,items:[{...request.items[0],attemptId:randomUUID()}]}));
  expect(changed.items[0]).toMatchObject({outcome:'HOLD',code:'IDEMPOTENCY_KEY_REUSED'});
  const other=await f.run(t=>confirmCompletion(t,f.u.certifier,request));expect(other.items[0]).toMatchObject({outcome:'HOLD',code:'NOT_FOUND'});expect(other.items[0]).not.toHaveProperty('versionId');
  expect((await f.db.query('SELECT * FROM result_release')).rows).toHaveLength(0);
  expect((await f.db.query("SELECT * FROM job_outbox WHERE kind='result_release_completed'")).rows).toHaveLength(0);
  const hash=(await f.db.query<{sha256:string}>('SELECT sha256 FROM result_report_version')).rows[0].sha256;expect(await f.store.get(hash)).toEqual(bytes);
 }finally{vi.unstubAllEnvs();await f.close();}
},120000);

it('ANC sees no result and no PDF while the result waits to be sent',async()=>{
 const f=await task3Fixture();try{
  const c=f.cases[0],bytes=syntheticReportPdf({kind:'SINGLETON',labNumber:c.printed,hn:c.hn,dob:'01-Jan-1990',collection:pdfDate('2026-10-20'),gaWeeks:17,gaDays:6,sex:null});
  const intakeId=await f.run(t=>registerIntake(t,f.store,{source:'UPLOAD',relativePath:null,originalName:'SYNTHETIC-pending-send.pdf',actorId:f.admin.id,jobId:null},bytes));
  await f.run(t=>parseIntake(t,f.store,intakeId,{maxBytes:10000000,acceptZip:true}));
  await f.run(t=>reviewBenchForResult(t,f.admin,c.attemptId,{revision:1,measurementsReviewed:true,reason:'SYNTHETIC legacy paper-only result evidence review'}));
  const done=await f.run(t=>confirmCompletion(t,f.admin,{idempotencyKey:randomUUID(),items:[{intakeId,caseId:c.caseId,roundId:c.roundId,attemptId:c.attemptId}]}));
  expect(done.items[0].outcome).toBe('PendingCertification');
  const anc=await f.run(t=>ancCaseResults(t,f.u.anc,c.caseId));
  expect(anc.rounds.every(r=>r.result===null)).toBe(true);
  await expect(f.run(t=>readReleasedFile(t,f.u.anc,f.store,done.items[0].versionId!))).rejects.toThrow('NOT_FOUND');
 }finally{vi.unstubAllEnvs();await f.close();}
},120000);

it('previews a certifier without link-proposal rights as ready: result_management.linkageMode no longer gates completion',async()=>{
 const f=await task3Fixture();try{
  const active=(await f.db.query<{value:Record<string,unknown>}>('SELECT r.value FROM setting_active a JOIN settings_revision r ON r.id=a.revision_id WHERE a.setting_key=\'result_management\'')).rows[0]?.value??SETTINGS.result_management.default;
  await f.run(async t=>{const revision=await proposeSetting(t,f.u.certifier,'result_management',{...active,linkageMode:'MANUAL_REVIEWED_ONLY'},'SYNTHETIC_RESULT_COMPLETION_MANUAL');await validateSetting(t,f.u.certifier,revision,async()=>true);await approveSetting(t,f.u.approver,revision);await activateSetting(t,f.u.approver,revision);});
  const c=f.cases[0],bytes=syntheticReportPdf({kind:'SINGLETON',labNumber:c.printed,hn:c.hn,dob:'01-Jan-1990',collection:pdfDate('2026-10-20'),gaWeeks:17,gaDays:6,sex:null});
  const intakeId=await f.run(t=>registerIntake(t,f.store,{source:'UPLOAD',relativePath:null,originalName:'SYNTHETIC-manual-final.pdf',actorId:f.u.certifier.id,jobId:null},bytes));
  await f.run(t=>parseIntake(t,f.store,intakeId,{maxBytes:10000000,acceptZip:true}));
  await f.run(t=>reviewBenchForResult(t,f.u.certifier,c.attemptId,{revision:1,measurementsReviewed:true,reason:'SYNTHETIC legacy paper-only result evidence review'}));
  const result=(await f.run(t=>previewCompletion(t,f.u.certifier,{intakeIds:[intakeId]}))).items[0];
  expect(result.reasons).not.toContain('LINK_AUTHORITY_REQUIRED');expect(result.ready).toBe(true);
 }finally{vi.unstubAllEnvs();await f.close();}
},120000);

it('releaseReviewed follows the gate: relinking after review makes it stale, a fresh review with the same-sha QC5 makes it true again',async()=>{
 const f=await task3Fixture();try{
  const c=f.cases[0],bytes=syntheticReportPdf({kind:'SINGLETON',labNumber:c.printed,hn:c.hn,dob:'01-Jan-1990',collection:pdfDate('2026-10-20'),gaWeeks:17,gaDays:6,sex:null});
  const intakeId=await f.run(t=>registerIntake(t,f.store,{source:'UPLOAD',relativePath:null,originalName:'SYNTHETIC-relink.pdf',actorId:f.admin.id,jobId:null},bytes));
  await f.run(t=>parseIntake(t,f.store,intakeId,{maxBytes:10000000,acceptZip:true}));
  await f.run(t=>reviewBenchForResult(t,f.admin,c.attemptId,{revision:1,measurementsReviewed:true,reason:'SYNTHETIC legacy paper-only result evidence review'}));
  const done=await f.run(t=>confirmCompletion(t,f.admin,{idempotencyKey:randomUUID(),items:[{intakeId,caseId:c.caseId,roundId:c.roundId,attemptId:c.attemptId}]}));
  const id=done.items[0].versionId!;
  expect(await f.run(t=>releaseReviewed(t,id))).toBe(true);
  const rv=async()=>(await f.db.query<{row_version:number}>('SELECT row_version FROM result_report_version WHERE id=$1',[id])).rows[0].row_version;
  await f.run(async t=>unlinkVersion(t,f.admin,{versionId:id,reason:'SYNTHETIC unlink to relink',expectedRowVersion:await rv()}));
  await f.run(async t=>proposeLink(t,f.admin,{versionId:id,roundId:c.roundId,attemptId:c.attemptId,reason:'SYNTHETIC relink after review',expectedRowVersion:await rv()}));
  await f.run(async t=>decideLink(t,f.admin,{versionId:id,decision:'APPROVE',reason:'SYNTHETIC relink approval',expectedRowVersion:await rv()}));
  expect((await f.db.query<{state:string}>('SELECT state FROM result_report_version WHERE id=$1',[id])).rows[0].state).not.toBe('PendingCertification');
  expect(await f.run(t=>releaseReviewed(t,id))).toBe(false);
  await f.run(async t=>recordReview(t,f.admin,{versionId:id,valuesMatchPdf:true,abnormalAcknowledged:false,expectedRowVersion:await rv()}));
  expect(await f.run(t=>releaseReviewed(t,id))).toBe(true);
  expect((await f.db.query<{state:string}>('SELECT state FROM result_report_version WHERE id=$1',[id])).rows[0].state).toBe('PendingCertification');
 }finally{vi.unstubAllEnvs();await f.close();}
},120000);

it('acceptAndRelease on an already reviewed PendingCertification version certifies without recording a second review or QC5',async()=>{
 const f=await task3Fixture();try{
  const c=f.cases[0],bytes=syntheticReportPdf({kind:'SINGLETON',labNumber:c.printed,hn:c.hn,dob:'01-Jan-1990',collection:pdfDate('2026-10-20'),gaWeeks:17,gaDays:6,sex:null});
  const intakeId=await f.run(t=>registerIntake(t,f.store,{source:'UPLOAD',relativePath:null,originalName:'SYNTHETIC-no-double.pdf',actorId:f.admin.id,jobId:null},bytes));
  await f.run(t=>parseIntake(t,f.store,intakeId,{maxBytes:10000000,acceptZip:true}));
  await f.run(t=>reviewBenchForResult(t,f.admin,c.attemptId,{revision:1,measurementsReviewed:true,reason:'SYNTHETIC legacy paper-only result evidence review'}));
  const done=await f.run(t=>confirmCompletion(t,f.admin,{idempotencyKey:randomUUID(),items:[{intakeId,caseId:c.caseId,roundId:c.roundId,attemptId:c.attemptId}]}));
  const id=done.items[0].versionId!;
  const row=(await f.db.query<{row_version:number}>('SELECT row_version FROM result_report_version WHERE id=$1',[id])).rows[0];
  const r=await f.run(t=>acceptAndRelease(t,f.admin,{versionId:id,expectedRowVersion:row.row_version,idempotencyKey:randomUUID(),externalFinalCertified:true,identityAndValuesMatchPdf:true,disclosureReviewed:true,abnormalAcknowledged:false}));
  expect(r.outcome).toBe('CertifiedReleased');
  expect((await f.db.query('SELECT 1 FROM result_review WHERE version_id=$1',[id])).rows).toHaveLength(1);
  expect((await f.db.query('SELECT 1 FROM result_qc5_review WHERE version_id=$1',[id])).rows).toHaveLength(1);
 }finally{vi.unstubAllEnvs();await f.close();}
},120000);

it('the attestation paths keep their origin guards for an already reviewed PendingCertification version',async()=>{
 const f=await task3Fixture();try{
  const c=f.cases[0],bytes=syntheticReportPdf({kind:'SINGLETON',labNumber:c.printed,hn:c.hn,dob:'01-Jan-1990',collection:pdfDate('2026-10-20'),gaWeeks:17,gaDays:6,sex:null});
  const intakeId=await f.run(t=>registerIntake(t,f.store,{source:'UPLOAD',relativePath:null,originalName:'SYNTHETIC-origin-guard.pdf',actorId:f.admin.id,jobId:null},bytes));
  await f.run(t=>parseIntake(t,f.store,intakeId,{maxBytes:10000000,acceptZip:true}));
  await f.run(t=>reviewBenchForResult(t,f.admin,c.attemptId,{revision:1,measurementsReviewed:true,reason:'SYNTHETIC legacy paper-only result evidence review'}));
  const done=await f.run(t=>confirmCompletion(t,f.admin,{idempotencyKey:randomUUID(),items:[{intakeId,caseId:c.caseId,roundId:c.roundId,attemptId:c.attemptId}]}));
  const id=done.items[0].versionId!;
  const rv=async()=>(await f.db.query<{row_version:number}>('SELECT row_version FROM result_report_version WHERE id=$1',[id])).rows[0].row_version;
  const external=async()=>({versionId:id,expectedRowVersion:await rv(),idempotencyKey:randomUUID(),externalFinalCertified:true as const,identityAndValuesMatchPdf:true as const,disclosureReviewed:true as const,abnormalAcknowledged:false});
  const internal=async()=>({versionId:id,expectedRowVersion:await rv(),idempotencyKey:randomUUID(),reportContentVerified:true as const,identityAndValuesMatchReport:true as const,disclosureReviewed:true as const,abnormalAcknowledged:false});
  // (b) the internal attestation is refused for an external PDF that is already reviewed and waiting.
  await expect(f.run(async t=>acceptInternalAndRelease(t,f.admin,await internal()))).rejects.toThrow('INTERNAL_RELEASE_REQUIRES_INTERNAL_REPORT');
  // (a) the external attestation is refused for an internal report that is already reviewed and waiting.
  await f.db.query("ALTER TABLE result_report_version DISABLE TRIGGER USER");
  await f.db.query("UPDATE result_report_version SET origin='INTERNAL_GENERATED' WHERE id=$1",[id]);
  await f.db.query("ALTER TABLE result_report_version ENABLE TRIGGER USER");
  await expect(f.run(async t=>acceptAndRelease(t,f.admin,await external()))).rejects.toThrow('EXTERNAL_ATTESTATION_NOT_FOR_INTERNAL_REPORT');
  expect((await f.db.query('SELECT 1 FROM result_release WHERE version_id=$1',[id])).rows).toHaveLength(0);
  expect((await f.db.query<{state:string}>('SELECT state FROM result_report_version WHERE id=$1',[id])).rows[0].state).toBe('PendingCertification');
 }finally{vi.unstubAllEnvs();await f.close();}
},120000);
