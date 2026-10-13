import {randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import type {Pool} from 'pg';
import {describe,it,expect,beforeEach,afterEach} from 'vitest';
import {resultFixture,receivedCase,importReport,rowVersion,pdfDate,type ResultFixture} from '../helpers/results';
import * as svc from '../../packages/results/service';
import {registerIntake,parseIntake} from '../../packages/results/intake';
import {runResultJob,queueScheduledScan,scheduledScanKey} from '../../packages/results/jobs';
import {syntheticReportPdf} from '../../tools/his-simulator/result-pdf';

// Owner decisions A14 (duplicate = SHA-256; same name + different bytes is reviewed, never skipped or auto-revised) and
// A23 (scheduled folder scan: listing only, 0 = off). Regression tests for the service, the DB guard and the worker job.
let f:ResultFixture;
beforeEach(async()=>{f=await resultFixture();});
afterEach(async()=>{await f.close();});
const spec=(c:{hn:string;collection:string},extra:Record<string,unknown>={})=>({kind:'SINGLETON' as const,labNumber:'26B261010001-1',hn:c.hn,collection:pdfDate(c.collection),...extra});
const limits={maxBytes:1e7,acceptZip:true};
const preview=async(bytes:Buffer,name:string,jobId:string|null=null)=>{const id=await f.run(t=>registerIntake(t,f.store,{source:'UPLOAD',relativePath:null,originalName:name,actorId:f.u.staff.id,jobId},bytes));await f.run(t=>parseIntake(t,f.store,id,limits));return id;};
const rv=async(id:string)=>(await rowVersion(f,id)).row_version;

describe('A14 — duplicates by SHA-256, same-name/different-content goes to review',()=>{
 it('same bytes under another name is a Duplicate; same name with other bytes is a name conflict that must be acknowledged',async()=>{
  const c=await receivedCase(f);const first=await importReport(f,spec(c),f.u.staff,'NIPT-RESULT.pdf');
  const dupBytes=syntheticReportPdf(spec(c));const dup=await preview(dupBytes,'other-name.pdf');
  expect((await f.db.query('SELECT state,duplicate_of FROM result_intake_file WHERE id=$1',[dup])).rows[0]).toEqual({state:'Duplicate',duplicate_of:first.versionId});
  const job=(await f.db.query<{id:string}>("INSERT INTO job_outbox(kind,payload,idempotency_key) VALUES('synthetic_result_parse',$1,$2) RETURNING id",[JSON.stringify({actorId:f.u.staff.id}),'p5:'+randomUUID()])).rows[0].id;
  const second=await preview(syntheticReportPdf(spec(c,{reported:'22-Oct-2026'})),'nipt-result.PDF',job);
  const rows=await f.run(t=>svc.intakeRows(t,f.u.staff,job));
  expect(rows[0].nameConflicts.versions.map(v=>v.id)).toEqual([first.versionId]);
  await expect(f.run(t=>svc.confirmImport(t,f.u.staff,{intakeIds:[second]}))).rejects.toThrow('NAME_CONFLICT_ACK_REQUIRED');
  expect((await f.db.query('SELECT count(*)::int n FROM result_report_version')).rows[0]).toEqual({n:1});
  const r=await f.run(t=>svc.confirmImport(t,f.u.staff,{intakeIds:[second],acknowledgeNameConflicts:[second]}));
  expect(r[0].outcome).toBe('Unlinked');expect((await rowVersion(f,first.versionId)).state).toBe('Unlinked');
  expect((await f.db.query("SELECT reason FROM result_version_event WHERE version_id=$1 AND to_state='Imported'",[r[0].versionId])).rows[0]).toEqual({reason:'NAME_CONFLICT_ACKNOWLEDGED'});
  expect((await f.db.query('SELECT supersedes_id FROM result_report_version WHERE id=$1',[r[0].versionId])).rows[0]).toEqual({supersedes_id:null});
  expect((await f.run(t=>svc.resultQueue(t,f.u.staff))).rows.filter(x=>x.name_conflict)).toHaveLength(2);
 });
 it('two different files with one name inside the same Preview are both flagged',async()=>{
  const job=(await f.db.query<{id:string}>("INSERT INTO job_outbox(kind,payload,idempotency_key) VALUES('synthetic_result_parse',$1,$2) RETURNING id",[JSON.stringify({actorId:f.u.staff.id}),'p5:'+randomUUID()])).rows[0].id;
  await preview(syntheticReportPdf({kind:'SINGLETON',labNumber:'A',hn:'990000000301',collection:'10-Oct-2026'}),'same.pdf',job);
  await preview(syntheticReportPdf({kind:'SINGLETON',labNumber:'B',hn:'990000000302',collection:'10-Oct-2026'}),'same.pdf',job);
  expect((await f.run(t=>svc.intakeRows(t,f.u.staff,job))).map(r=>r.nameConflicts.sameBatch)).toEqual([1,1]);
 });
 it('the link proposal must classify NEW_REPORT or REVISION; the second person approves the same classification; no automatic revision',async()=>{
  const c=await receivedCase(f);const first=await importReport(f,spec(c),f.u.staff,'NIPT-RESULT.pdf');
  await f.run(async t=>svc.proposeLink(t,f.u.staff,{versionId:first.versionId,roundId:c.roundId,attemptId:c.attemptId,reason:'จำลอง ฉบับแรกของรอบ',expectedRowVersion:await rv(first.versionId)}));
  await f.run(async t=>svc.decideLink(t,f.u.certifier,{versionId:first.versionId,decision:'APPROVE',reason:'จำลอง ยืนยันฉบับแรก',expectedRowVersion:await rv(first.versionId)}));
  const job=(await f.db.query<{id:string}>("INSERT INTO job_outbox(kind,payload,idempotency_key) VALUES('synthetic_result_parse',$1,$2) RETURNING id",[JSON.stringify({actorId:f.u.staff.id}),'p5:'+randomUUID()])).rows[0].id;
  const id=await preview(syntheticReportPdf(spec(c,{reported:'23-Oct-2026'})),'NIPT-RESULT.pdf',job);
  const versionId=(await f.run(t=>svc.confirmImport(t,f.u.staff,{intakeIds:[id],acknowledgeNameConflicts:[id]})))[0].versionId!;
  expect((await f.run(t=>svc.versionDetail(t,f.u.staff,versionId))).nameConflicts.map(x=>x.id)).toEqual([first.versionId]);
  const base={versionId,roundId:c.roundId,attemptId:c.attemptId,reason:'จำลอง ตรวจชื่อซ้ำแล้ว'};
  const revision={receivedDate:'2026-10-23',requestedBy:'จำลอง ห้องปฏิบัติการ',reason:'จำลอง แก้ไขฉบับรายงาน'};
  await expect(f.run(async t=>svc.proposeLink(t,f.u.staff,{...base,expectedRowVersion:await rv(versionId)}))).rejects.toThrow('NAME_REVIEW_REQUIRED');
  await expect(f.run(async t=>svc.proposeLink(t,f.u.staff,{...base,nameReview:'REVISION',expectedRowVersion:await rv(versionId)}))).rejects.toThrow('REVISION_DETAILS_REQUIRED');
  await expect(f.run(async t=>svc.proposeLink(t,f.u.staff,{...base,nameReview:'NEW_REPORT',revision,expectedRowVersion:await rv(versionId)}))).rejects.toThrow('NAME_REVIEW_MISMATCH');
  // A "new report" for a round whose report is still open cannot bypass revision either.
  await expect(f.run(async t=>svc.proposeLink(t,f.u.staff,{...base,nameReview:'NEW_REPORT',expectedRowVersion:await rv(versionId)}))).rejects.toThrow('REVISION_DETAILS_REQUIRED');
  await f.run(async t=>svc.proposeLink(t,f.u.staff,{...base,nameReview:'REVISION',revision,expectedRowVersion:await rv(versionId)}));
  // Proposal alone changes nothing: the open version is untouched until the second person approves.
  expect((await rowVersion(f,first.versionId)).state).toBe('ValidationBlocked');
  await expect(f.db.query("INSERT INTO result_link_event(version_id,event,case_id,round_id,attempt_id,outcome,reason,revision,name_review,actor_id) VALUES($1,'APPROVED',$2,$3,$4,'Linked','จำลอง ข้ามการจัดประเภท',$5,'NEW_REPORT',$6)",[versionId,c.caseId,c.roundId,c.attemptId,null,f.u.certifier.id])).rejects.toThrow();
  await f.run(async t=>svc.decideLink(t,f.u.certifier,{versionId,decision:'APPROVE',reason:'จำลอง ยืนยันเป็นฉบับแก้ไข',expectedRowVersion:await rv(versionId)}));
  expect((await f.db.query("SELECT name_review FROM result_link_event WHERE version_id=$1 AND event='APPROVED'",[versionId])).rows[0]).toEqual({name_review:'REVISION'});
  expect((await rowVersion(f,first.versionId)).state).toBe('Superseded');expect((await f.db.query('SELECT count(*)::int n FROM result_release')).rows[0]).toEqual({n:0});
 });
});

describe('A23 — scheduled folder scan lists only',()=>{
 it('0 = off; one audited listing job per interval bucket; no actor attached',async()=>{
  expect(await f.run(t=>queueScheduledScan(t,0))).toBeNull();
  const now=Date.parse('2026-10-13T08:00:00Z');const id=await f.run(t=>queueScheduledScan(t,5,now));expect(id).toBeTruthy();
  expect(await f.run(t=>queueScheduledScan(t,5,now+60000))).toBeNull();expect(await f.run(t=>queueScheduledScan(t,5,now+5*60000))).toBeTruthy();
  const job=(await f.db.query<{kind:string;payload:Record<string,unknown>;idempotency_key:string}>('SELECT kind,payload,idempotency_key FROM job_outbox WHERE id=$1',[id])).rows[0];
  expect(job).toEqual({kind:'synthetic_result_scan',payload:{trigger:'SCHEDULED'},idempotency_key:scheduledScanKey(5,now)});
  expect((await f.db.query("SELECT count(*)::int n FROM audit_chain WHERE action='RESULT_SCHEDULED_SCAN_QUEUED'")).rows[0]).toEqual({n:2});
 });
 it('the scheduled job runs the same read-only scan and creates no intake, report, link or release; it can never preview or parse',async()=>{
  await mkdir(path.join(f.root,'results','2026-10'),{recursive:true});
  await writeFile(path.join(f.root,'results','2026-10','SCHEDULED.pdf'),syntheticReportPdf({kind:'SINGLETON',labNumber:'S',hn:'990000000401',collection:'10-Oct-2026'}));
  const id=(await f.run(t=>queueScheduledScan(t,5)))!;
  const out=await runResultJob(f.db as unknown as Pool,id,'synthetic_result_scan',{trigger:'SCHEDULED'},f.root,f.store) as {trigger:string;files:{path:string;status:string}[]};
  expect(out.trigger).toBe('SCHEDULED');expect(out.files).toEqual([expect.objectContaining({path:'2026-10/SCHEDULED.pdf',status:'NEW'})]);
  for(const t of ['result_intake_file','result_report_version','result_link_event','result_release'])expect((await f.db.query(`SELECT count(*)::int n FROM ${t}`)).rows[0]).toEqual({n:0});
  await expect(runResultJob(f.db as unknown as Pool,id,'synthetic_result_preview',{trigger:'SCHEDULED',paths:[]},f.root,f.store)).rejects.toThrow('SCHEDULED_SCAN_LIST_ONLY');
  await expect(runResultJob(f.db as unknown as Pool,id,'synthetic_result_parse',{},f.root,f.store)).rejects.toThrow('ACTOR_REQUIRED');
  await expect(runResultJob(f.db as unknown as Pool,id,'synthetic_result_test_path',{trigger:'SCHEDULED'},f.root,f.store)).rejects.toThrow('SCHEDULED_SCAN_LIST_ONLY');
  // Path security is identical to the manual scan: without the synthetic root marker nothing is read.
  expect(await runResultJob(f.db as unknown as Pool,id,'synthetic_result_scan',{trigger:'SCHEDULED'},path.join(f.base,'not-a-simulator'),f.store)).toMatchObject({passed:false});
 });
});
