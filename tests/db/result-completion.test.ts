import {it,expect,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {task3Fixture} from '../helpers/task3';
import {pdfDate} from '../helpers/results';
import {syntheticReportPdf} from '../../tools/his-simulator/result-pdf';
import {registerIntake,parseIntake} from '../../packages/results/intake';
import {reviewBenchForResult} from '../../packages/lab/bench-review';
import {previewCompletion,confirmCompletion} from '../../packages/results/completion';
import {SETTINGS} from '../../packages/settings/catalog';
import {proposeSetting,validateSetting,approveSetting,activateSetting} from '../../packages/settings/service';

it('one external confirmation publishes only the reviewed patient, preserves PDF bytes and binds replays to actor and target',async()=>{
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
  const completed=await f.run(t=>confirmCompletion(t,f.admin,request));expect(completed.items[0].outcome).toBe('CertifiedReleased');
  expect(await f.run(t=>confirmCompletion(t,f.admin,request))).toEqual(completed);
  const changed=await f.run(t=>confirmCompletion(t,f.admin,{...request,items:[{...request.items[0],attemptId:randomUUID()}]}));
  expect(changed.items[0]).toMatchObject({outcome:'HOLD',code:'IDEMPOTENCY_KEY_REUSED'});
  const other=await f.run(t=>confirmCompletion(t,f.u.certifier,request));expect(other.items[0]).toMatchObject({outcome:'HOLD',code:'NOT_FOUND'});expect(other.items[0]).not.toHaveProperty('versionId');
  expect((await f.db.query('SELECT * FROM result_release')).rows).toHaveLength(1);
  expect((await f.db.query("SELECT * FROM job_outbox WHERE kind='result_release_completed'")).rows).toHaveLength(1);
  const hash=(await f.db.query<{sha256:string}>('SELECT sha256 FROM result_report_version')).rows[0].sha256;expect(await f.store.get(hash)).toEqual(bytes);
 }finally{vi.unstubAllEnvs();await f.close();}
},120000);

it('keeps existing linkage authority checks visible in manual mode for a certifier without proposal rights',async()=>{
 const f=await task3Fixture();try{
  const active=(await f.db.query<{value:Record<string,unknown>}>('SELECT r.value FROM setting_active a JOIN settings_revision r ON r.id=a.revision_id WHERE a.setting_key=\'result_management\'')).rows[0]?.value??SETTINGS.result_management.default;
  await f.run(async t=>{const revision=await proposeSetting(t,f.u.certifier,'result_management',{...active,linkageMode:'MANUAL_REVIEWED_ONLY'},'SYNTHETIC_RESULT_COMPLETION_MANUAL');await validateSetting(t,f.u.certifier,revision,async()=>true);await approveSetting(t,f.u.approver,revision);await activateSetting(t,f.u.approver,revision);});
  const c=f.cases[0],bytes=syntheticReportPdf({kind:'SINGLETON',labNumber:c.printed,hn:c.hn,dob:'01-Jan-1990',collection:pdfDate('2026-10-20'),gaWeeks:17,gaDays:6,sex:null});
  const intakeId=await f.run(t=>registerIntake(t,f.store,{source:'UPLOAD',relativePath:null,originalName:'SYNTHETIC-manual-final.pdf',actorId:f.u.certifier.id,jobId:null},bytes));
  await f.run(t=>parseIntake(t,f.store,intakeId,{maxBytes:10000000,acceptZip:true}));
  await f.run(t=>reviewBenchForResult(t,f.u.certifier,c.attemptId,{revision:1,measurementsReviewed:true,reason:'SYNTHETIC legacy paper-only result evidence review'}));
  const result=(await f.run(t=>previewCompletion(t,f.u.certifier,{intakeIds:[intakeId]}))).items[0];
  expect(result.ready).toBe(false);expect(result.reasons).toContain('LINK_AUTHORITY_REQUIRED');
  expect((await f.db.query('SELECT * FROM result_report_version')).rows).toHaveLength(0);
 }finally{vi.unstubAllEnvs();await f.close();}
},120000);
