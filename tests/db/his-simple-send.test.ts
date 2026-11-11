import {it,expect,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import os from 'node:os';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import {task3Fixture} from '../helpers/task3';
import {pdfDate} from '../helpers/results';
import {syntheticReportPdf} from '../../tools/his-simulator/result-pdf';
import {registerIntake,parseIntake} from '../../packages/results/intake';
import {reviewBenchForResult} from '../../packages/lab/bench-review';
import {confirmCompletion} from '../../packages/results/completion';
import {sendToHis,resendToHis} from '../../packages/results/send-his';
import {sendReleasedResult} from '../../packages/p6/send-result';
import {readHisDeliveryStatuses} from '../../packages/results/his-status';
import {saveSystemSetting} from '../../packages/settings/direct';
import {SETTINGS} from '../../packages/settings/catalog';
import {syntheticProfile} from '../../packages/p6/res';

// Owner 2026-11-11: "ส่ง HIS" = PDF -> CFS folder, .res + .ok -> RES folder. No backup, no confirmation wait, no simulator /
// Production Authorized switch. A failure is recorded with its reason; "ส่ง HIS อีกครั้ง" queues another job that writes again.
type F=Awaited<ReturnType<typeof task3Fixture>>;
async function released(f:F){
 const c=f.cases[0],bytes=syntheticReportPdf({kind:'SINGLETON',labNumber:c.printed,hn:c.hn,dob:'01-Jan-1990',collection:pdfDate('2026-10-20'),gaWeeks:17,gaDays:6,sex:null});
 const intakeId=await f.run(t=>registerIntake(t,f.store,{source:'UPLOAD',relativePath:null,originalName:'SYNTHETIC-simple-send.pdf',actorId:f.admin.id,jobId:null},bytes));
 await f.run(t=>parseIntake(t,f.store,intakeId,{maxBytes:10000000,acceptZip:true}));
 await f.run(t=>reviewBenchForResult(t,f.admin,c.attemptId,{revision:1,measurementsReviewed:true,reason:'SYNTHETIC legacy paper-only result evidence review'}));
 const done=await f.run(t=>confirmCompletion(t,f.admin,{idempotencyKey:randomUUID(),abnormalAcknowledged:false,items:[{intakeId,caseId:c.caseId,roundId:c.roundId,attemptId:c.attemptId}]}));
 const versionId=done.items[0].versionId!;
 const rv=(await f.db.query<{row_version:number}>('SELECT row_version FROM result_report_version WHERE id=$1',[versionId])).rows[0].row_version;
 const sent=await f.run(t=>sendToHis(t,f.admin,{idempotencyKey:randomUUID(),reviewConfirmed:true,abnormalAcknowledged:false,items:[{versionId,expectedRowVersion:rv}]}));
 expect(sent.items[0].outcome).toBe('CertifiedReleased');
 const releaseId=(await f.db.query<{id:string}>("SELECT id FROM result_release WHERE version_id=$1 AND state='Active'",[versionId])).rows[0].id;
 return {versionId,releaseId};
}

it('writes PDF to CFS and RES + OK to the RES folder; a missing folder is a recorded reason; resend writes again',async()=>{
 const f=await task3Fixture();const out=await fs.mkdtemp(path.join(os.tmpdir(),'nipt-his-out-')),resDir=path.join(out,'res'),pdfDir=path.join(out,'cfs');
 try{
  await fs.mkdir(resDir,{recursive:true});await fs.mkdir(pdfDir,{recursive:true});
  const {versionId,releaseId}=await released(f);
  // The old switches stay off: target SIMULATOR, productionAuthorized false, disabled. The send does not read them any more.
  await f.run(t=>saveSystemSetting(t,f.admin,'his_outbound',{...SETTINGS.his_outbound.default,resDestinationPath:resDir,pdfDestinationPath:pdfDir,
   resProfile:{...syntheticProfile,syntheticOnly:false,version:'TEST-SIMPLE-1'},operatorHisId:'TESTOP^ผู้ส่งผล'}));
  const job=(await f.db.query<{id:string}>("SELECT id FROM job_outbox WHERE kind='result_release_completed' AND payload->>'releaseId'=$1",[releaseId])).rows[0];
  expect((await readHisDeliveryStatuses(f.db,[versionId])).get(versionId)?.code).toBe('QUEUED');

  const first=await sendReleasedResult(f.db,releaseId,f.store);
  if(!('sent' in first)||!first.sent)throw Error(JSON.stringify(first));
  expect(await fs.readdir(pdfDir)).toEqual([first.pdfName]);
  expect((await fs.readdir(resDir)).sort()).toEqual([first.okName,first.resName].sort());
  expect(first.okName).toBe(first.resName.replace(/\.res$/,'.ok'));
  expect(await fs.readFile(path.join(resDir,first.okName))).toEqual(Buffer.from([255,254]));
  const res=(await fs.readFile(path.join(resDir,first.resName))).subarray(2).toString('utf16le');
  expect(res).toContain('TESTOP^ผู้ส่งผล');expect(res.split('\r')[0]).toMatch(/^H\|/);
  const pdfSha=(await f.db.query<{sha256:string}>('SELECT sha256 FROM result_report_version WHERE id=$1',[versionId])).rows[0].sha256;
  expect(await fs.readFile(path.join(pdfDir,first.pdfName))).toEqual(await f.store.get(pdfSha));
  await f.db.query('INSERT INTO integration_job_receipt(outbox_id,result) VALUES($1,$2)',[job.id,first]);
  expect((await readHisDeliveryStatuses(f.db,[versionId])).get(versionId)).toMatchObject({code:'SENT',label:'ส่ง HIS แล้ว',tone:'good'});

  // A CFS folder that is gone: nothing is thrown, the reason is the result and the badge shows it.
  await fs.rm(pdfDir,{recursive:true});
  const again=await f.run(t=>resendToHis(t,f.admin,{versionId}));
  expect((await f.db.query<{payload:unknown}>('SELECT payload FROM job_outbox WHERE id=$1',[again.jobId])).rows[0].payload).toEqual({releaseId,resend:true});
  const failed=await sendReleasedResult(f.db,releaseId,f.store,{resend:true});
  expect(failed).toEqual({sent:false,error:'SHARE_PATH_NOT_FOUND',resend:true});
  await f.db.query('INSERT INTO integration_job_receipt(outbox_id,result) VALUES($1,$2)',[again.jobId,failed]);
  expect((await readHisDeliveryStatuses(f.db,[versionId])).get(versionId)).toMatchObject({code:'FAILED',error:'SHARE_PATH_NOT_FOUND'});

  // Folder back, "ส่ง HIS อีกครั้ง": the files are written again (the PDF keeps its name and is replaced; no temp file left).
  await fs.mkdir(pdfDir);
  const third=await f.run(t=>resendToHis(t,f.admin,{versionId}));
  const ok=await sendReleasedResult(f.db,releaseId,f.store,{resend:true});
  if(!('sent' in ok)||!ok.sent)throw Error(JSON.stringify(ok));
  await f.db.query('INSERT INTO integration_job_receipt(outbox_id,result) VALUES($1,$2)',[third.jobId,ok]);
  expect(await fs.readdir(pdfDir)).toEqual([first.pdfName]);
  expect((await fs.readdir(resDir)).some(n=>n.endsWith('.part'))).toBe(false);
  expect((await readHisDeliveryStatuses(f.db,[versionId])).get(versionId)?.code).toBe('SENT');
  expect((await f.db.query("SELECT 1 FROM audit_chain WHERE action IN ('HIS_RESULT_SENT','HIS_RESULT_RESENT','HIS_RESULT_RESEND_QUEUED')")).rows).toHaveLength(4);
 }finally{vi.unstubAllEnvs();await f.close();await fs.rm(out,{recursive:true,force:true});}
},180000);

it('refuses "ส่ง HIS อีกครั้ง" for a result that was never sent',async()=>{
 const f=await task3Fixture();
 try{await expect(f.run(t=>resendToHis(t,f.admin,{versionId:randomUUID()}))).rejects.toThrow('RESEND_REQUIRES_SENT_RESULT');}
 finally{vi.unstubAllEnvs();await f.close();}
},180000);
