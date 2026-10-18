import {it,expect,describe,beforeEach,afterEach} from 'vitest';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import type {Pool} from 'pg';
import {resultFixture,receivedCase,rowVersion,pdfDate,type ResultFixture} from '../helpers/results';
import {syntheticReportPdf} from '../../tools/his-simulator/result-pdf';
import * as results from '../../packages/results/service';
import {previewFolderFiles} from '../../packages/results/folder';
import {runResultJob} from '../../packages/results/jobs';
import {SETTINGS} from '../../packages/settings/catalog';
import {proposeSetting,validateSetting,approveSetting,activateSetting} from '../../packages/settings/service';

// Owner 2026-10-18: two Final Result PDF channels — folder intake (primary) and upload from the patient's case page (fallback).
// Both use the same intake, parser, storage, versioning, linkage and release rules; uploading is never acceptance or release.
let f:ResultFixture;
beforeEach(async()=>{f=await resultFixture();});
afterEach(async()=>{await f.close();});
const labNo=async(roundId:string)=>(await f.db.query<{ln_halos:string}>('SELECT ln_halos FROM specimen_lab_number WHERE round_id=$1',[roundId])).rows[0].ln_halos;
const pdfFor=async(c:{hn:string;collection:string;roundId:string},extra:Record<string,unknown>={})=>syntheticReportPdf({kind:'SINGLETON',labNumber:await labNo(c.roundId),hn:c.hn,collection:pdfDate(c.collection),...extra});
const target=(c:{caseId:string;roundId:string;attemptId:string})=>({caseId:c.caseId,roundId:c.roundId,attemptId:c.attemptId});
const versions=async()=>(await f.db.query<{n:number}>('SELECT count(*)::int n FROM result_report_version')).rows[0].n;
let uploads=0;
async function upload(c:Parameters<typeof target>[0],bytes:Buffer,name=`case-upload-${++uploads}.pdf`,user=f.u.staff){
 const check=await f.run(t=>results.caseUploadCheck(t,user,f.store,{target:target(c),name,bytes}));
 if(check.outcome!=='READY')return {check,confirm:null};
 return {check,confirm:await f.run(t=>results.caseUploadConfirm(t,user,{target:target(c),intakeId:check.intakeId}))};
}
async function folderImport(bytes:Buffer,name:string){
 await mkdir(path.join(f.root,'results'),{recursive:true});await writeFile(path.join(f.root,'results',name),bytes);
 const scan=await runResultJob(f.db as unknown as Pool,'00000000-0000-4000-8000-000000000009','synthetic_result_scan',{},f.root,f.store) as {files:{path:string;sha256:string;status:string;name:string}[]};
 const file=scan.files.find(x=>x.name===name)!;
 const job=(await f.db.query<{id:string}>("INSERT INTO job_outbox(kind,payload,idempotency_key) VALUES('synthetic_result_preview','{}',$1) RETURNING id",['case-upload-'+Math.random()])).rows[0].id;
 const s=await results.resultSettings(f.db);
 const ids=await f.run(t=>previewFolderFiles(t,f.store,f.root,s.pdfSourcePath,[{path:file.path,sha256:file.sha256}],f.u.staff.id,job,results.limitsOf(s)));
 return {status:file.status,out:await f.run(t=>results.confirmImport(t,f.u.staff,{intakeIds:ids}))};
}
async function p5a(){const id=await f.run(t=>proposeSetting(t,f.u.certifier,'result_management',{...SETTINGS.result_management.default,linkageMode:'UNIQUE_AUTO_LINK'},'Owner P5-A for both channels'));
 await f.run(t=>validateSetting(t,f.u.certifier,id,async()=>true));await f.run(t=>approveSetting(t,f.u.approver,id));await f.run(t=>activateSetting(t,f.u.approver,id));}
const status=async(caseId:string)=>f.run(t=>results.caseResultStatus(t,f.u.certifier,caseId));

describe('Two PDF intake channels',()=>{
 it('1 folder channel: scan → preview → import → P5-A link (worker job path), status moves to awaiting acceptance',async()=>{
  await p5a();const c=await receivedCase(f);
  expect((await status(c.caseId)).rounds[0].status).toBe('NO_RESULT');
  const {out}=await folderImport(await pdfFor(c),'folder-report.pdf');
  expect(out[0]).toMatchObject({autoLink:'LINKED'});expect(['PendingCertification','ValidationBlocked']).toContain(out[0].outcome);
  const st=await status(c.caseId);expect(st.rounds[0].status).toBe('AWAITING_ACCEPTANCE');expect(st.versions[0]).toMatchObject({channel:'FOLDER_OR_RESULTS_PAGE',linkMode:'AUTO_UNIQUE'});
 });
 it('2 case-page upload: check against the selected round/attempt, confirm, proposal for a second person, MANUAL_UPLOAD recorded',async()=>{
  const c=await receivedCase(f),bytes=await pdfFor(c);
  const {check,confirm}=await upload(c,bytes);
  expect(check).toMatchObject({outcome:'READY',channel:'MANUAL_UPLOAD',kind:'RESULT',cross:{hn:'MATCH',dob:'MATCH',collectionDate:'MATCH',gestationalAge:'MATCH',labNumber:'MATCH'}});
  expect(confirm).toMatchObject({outcome:'IMPORTED',state:'Unlinked',next:'รอผู้รับรองคนที่สองยืนยันการเชื่อมโยง'});
  const v=confirm!.versionId;
  const ev=(await f.db.query<{details:Record<string,string>;actor_id:string}>("SELECT details,actor_id FROM result_version_event WHERE version_id=$1 AND reason='MANUAL_UPLOAD_FOR_CASE'",[v])).rows[0];
  expect(ev).toMatchObject({actor_id:f.u.staff.id,details:{channel:'MANUAL_UPLOAD',caseId:c.caseId,roundId:c.roundId,attemptId:c.attemptId}});
  const stored=(await f.db.query<{sha256:string;imported_by:string;imported_at:Date}>('SELECT sha256,imported_by,imported_at FROM result_report_version WHERE id=$1',[v])).rows[0];
  expect(stored).toMatchObject({sha256:check.sha256,imported_by:f.u.staff.id});expect(await f.store.get(stored.sha256)).toEqual(bytes); // original kept as uploaded
  expect((await status(c.caseId)).rounds[0].status).toBe('AWAITING_MATCH');
  await expect(f.run(async t=>results.decideLink(t,f.u.staff,{versionId:v,decision:'APPROVE',reason:'Same person must not approve',expectedRowVersion:(await rowVersion(f,v)).row_version}))).rejects.toMatchObject({code:'SECOND_PERSON_REQUIRED'});
  await f.run(async t=>results.decideLink(t,f.u.certifier,{versionId:v,decision:'APPROVE',reason:'Uploaded report identity confirmed',expectedRowVersion:(await rowVersion(f,v)).row_version}));
  expect((await status(c.caseId)).rounds[0].status).toBe('AWAITING_ACCEPTANCE');
  // With P5-A on, a clean upload links to the same selected target without a second person.
  await p5a();const c2=await receivedCase(f);const r2=await upload(c2,await pdfFor(c2));
  expect(r2.confirm).toMatchObject({linkMode:'AUTO_UNIQUE',next:'รอตรวจรับ PDF และยืนยันส่งผล'});
  expect((await f.db.query('SELECT round_id,attempt_id FROM result_report_version WHERE id=$1',[r2.confirm!.versionId])).rows[0]).toEqual({round_id:c2.roundId,attempt_id:c2.attemptId});
  await expect(f.run(t=>results.caseUploadCheck(t,f.u.anc,f.store,{target:target(c2),name:'x.pdf',bytes}))).rejects.toMatchObject({code:'FORBIDDEN'});
 });
 it('3 Worker stopped: the upload needs no job and no Worker; the case page says the folder channel is down',async()=>{
  const c=await receivedCase(f);const jobs=async()=>(await f.db.query<{n:number}>('SELECT count(*)::int n FROM job_outbox')).rows[0].n,before=await jobs();
  await f.db.query("INSERT INTO worker_heartbeat(worker_id,observed_at) VALUES('synthetic-worker',now()-interval '1 hour')");
  const st=await status(c.caseId);expect(st.folderChannel).toMatchObject({workerAlive:false,manualUploadAvailable:true});
  expect((await f.run(t=>results.caseResultStatus(t,f.u.staff,c.caseId))).can.upload).toBe(true);
  const {confirm}=await upload(c,await pdfFor(c));expect(confirm?.outcome).toBe('IMPORTED');expect(await jobs()).toBe(before);
 });
 it('4 a PDF of another patient (or another round) is refused on the case page and nothing is attached',async()=>{
  const a=await receivedCase(f),b=await receivedCase(f);
  const before=await versions();
  const wrong=await upload(a,await pdfFor(b));
  expect(wrong.check).toMatchObject({outcome:'REFUSED',code:'IDENTITY_CONFLICT_WITH_SELECTED_CASE',failed:expect.arrayContaining(['hn'])});
  expect(await versions()).toBe(before);
  // The refused intake can never be confirmed afterwards, even by a direct API call.
  await expect(f.run(t=>results.caseUploadConfirm(t,f.u.staff,{target:target(a),intakeId:wrong.check.intakeId}))).rejects.toMatchObject({code:'UPLOAD_NOT_READY'});
  const otherDate=await upload(a,await pdfFor(a,{collection:pdfDate('2026-10-01')}));
  expect(otherDate.check).toMatchObject({outcome:'REFUSED',code:'IDENTITY_CONFLICT_WITH_SELECTED_CASE',failed:expect.arrayContaining(['collectionDate'])});
  expect((await f.db.query<{n:number}>("SELECT count(*)::int n FROM audit_chain WHERE action='RESULT_CASE_UPLOAD_REFUSED'")).rows[0].n).toBe(2);
 });
 it('5 the same file through both channels is one report: folder then upload, and upload then folder',async()=>{
  const a=await receivedCase(f),bytesA=await pdfFor(a);
  const first=await folderImport(bytesA,'same-a.pdf');const upA=await upload(a,bytesA,'same-a-uploaded.pdf');
  expect(upA.check).toMatchObject({outcome:'DUPLICATE',versionId:first.out[0].versionId});
  const b=await receivedCase(f),bytesB=await pdfFor(b);
  const upB=await upload(b,bytesB);const later=await folderImport(bytesB,'same-b.pdf');
  expect(later.status).toBe('IMPORTED');expect(later.out[0]).toMatchObject({outcome:'Duplicate',versionId:upB.confirm!.versionId});
  expect(await versions()).toBe(2);
 });
 it('6 the Worker coming back never replaces an accepted report; a different PDF for the round stays a separate manual item',async()=>{
  await p5a();const c=await receivedCase(f),bytes=await pdfFor(c);
  const {confirm}=await upload(c,bytes);const v=confirm!.versionId;
  await f.run(async t=>results.recordReview(t,f.u.certifier,{versionId:v,valuesMatchPdf:true,abnormalAcknowledged:false,expectedRowVersion:(await rowVersion(f,v)).row_version}));
  const snap=async()=>(await f.db.query('SELECT state,sha256,row_version,round_id,attempt_id,link_mode FROM result_report_version WHERE id=$1',[v])).rows[0],before=await snap();
  const again=await folderImport(bytes,'returned-worker.pdf');expect(again.out[0]).toMatchObject({outcome:'Duplicate',versionId:v});
  const other=await folderImport(await pdfFor(c,{reported:'25-Oct-2026'}),'returned-worker-other.pdf');
  expect(other.out[0]).toMatchObject({outcome:'Unlinked',autoLink:'SERIES_NOT_EMPTY'});
  expect(await snap()).toEqual(before);
 });
 it('7 neither channel releases: after upload and link the report still needs the authorised acceptance (P5-B)',async()=>{
  await p5a();const c=await receivedCase(f);const {confirm}=await upload(c,await pdfFor(c));
  expect(['PendingCertification','ValidationBlocked']).toContain(confirm!.state);
  expect((await f.db.query<{n:number}>('SELECT count(*)::int n FROM result_release')).rows[0].n).toBe(0);
  expect((await f.db.query<{n:number}>("SELECT count(*)::int n FROM job_outbox WHERE kind='result_release_completed'")).rows[0].n).toBe(0);
  await expect(f.run(async t=>results.acceptAndRelease(t,f.u.certifier,{versionId:confirm!.versionId,expectedRowVersion:(await rowVersion(f,confirm!.versionId)).row_version,idempotencyKey:'c'.repeat(32),externalFinalCertified:true,identityAndValuesMatchPdf:true,disclosureReviewed:true,abnormalAcknowledged:false}))).rejects.toMatchObject({code:'OPERATIONAL_MODE_REQUIRED'});
 });
});
