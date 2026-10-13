import {randomUUID} from 'node:crypto';
import {mkdir,writeFile,symlink,readFile} from 'node:fs/promises';
import path from 'node:path';
import {describe,it,expect,beforeEach,afterEach} from 'vitest';
import {resultFixture,receivedCase,importReport,rowVersion,pdfDate,type ResultFixture} from '../helpers/results';
import * as svc from '../../packages/results/service';
import {testResultFolder,scanResultFolder,previewFolderFiles} from '../../packages/results/folder';
import * as intake from '../../packages/lab/intake';
import {syntheticReportPdf,zipAsPdf} from '../../tools/his-simulator/result-pdf';
import type {Principal} from '../../packages/security/policy';

let f:ResultFixture;
beforeEach(async()=>{f=await resultFixture();});
afterEach(async()=>{await f.close();});
const spec=(c:{hn:string;collection:string},extra:Record<string,unknown>={})=>({kind:'SINGLETON' as const,labNumber:'26B261010001-1',hn:c.hn,collection:pdfDate(c.collection),...extra});
const rv=async(id:string)=>(await rowVersion(f,id)).row_version;
const propose=async(id:string,c:{roundId:string;attemptId:string|null},extra:Record<string,unknown>={})=>{const v=await rv(id);return f.run(t=>svc.proposeLink(t,f.u.staff,{versionId:id,roundId:c.roundId,attemptId:c.attemptId,reason:'จำลอง ตรวจคู่ตามรอบและ Attempt',expectedRowVersion:v,...extra}));};
const approve=async(id:string,user:Principal=f.u.certifier)=>{const v=await rv(id);return f.run(t=>svc.decideLink(t,user,{versionId:id,decision:'APPROVE',reason:'จำลอง ยืนยันการเชื่อมโยง',expectedRowVersion:v}));};
const linked=async(c:Awaited<ReturnType<typeof receivedCase>>,extra:Record<string,unknown>={})=>{const {versionId}=await importReport(f,spec(c,extra));await propose(versionId,c);return {versionId,...await approve(versionId)};};
const review=async(versionId:string,user:Principal=f.u.staff,ack=false)=>{const v=await rv(versionId);return f.run(t=>svc.recordReview(t,user,{versionId,valuesMatchPdf:true,abnormalAcknowledged:ack,expectedRowVersion:v}));};
const certify=async(versionId:string,key=randomUUID().replaceAll('-',''),user:Principal=f.u.certifier,ack=false)=>{const v=await rv(versionId);return f.run(t=>svc.certifyAttempt(t,user,{versionId,idempotencyKey:key,abnormalAcknowledged:ack,expectedRowVersion:v}));};

describe('P5 gates, certification attempt and release HOLD (§5.9.2, §11.5, AT-RG-*, AT-RES-06)',()=>{
 it('review then certify: RG re-evaluated in the transaction, BLOCKED by RG-06/07 (awaits P4b), idempotent per key',async()=>{
  const c=await receivedCase(f);const {versionId}=await linked(c);await review(versionId);
  const key=randomUUID().replaceAll('-','');const r=await certify(versionId,key);
  expect(r.outcome).toBe('BLOCKED');expect(r.failed).toEqual(expect.arrayContaining(['RG-07:FINAL_QC_NOT_ACCEPTED','RG-06:ANALYSIS_COMPLETION_NOT_RECORDED']));expect(r.waitsForP4b).toBe(true);
  expect(r.pending).toEqual(expect.arrayContaining(['RG-01:OD-07:TEMPLATE_AND_PIC_NOT_APPROVED','RG-13:OD-05:CONFIRMATION_METHOD_AND_GOVERNANCE_SIGNOFF']));
  expect(await certify(versionId,key)).toMatchObject({outcome:'BLOCKED',replayed:true});
  expect((await f.db.query("SELECT count(*)::int n FROM result_gate_evaluation WHERE purpose='CERTIFY_ATTEMPT'")).rows[0]).toEqual({n:1});
  expect((await f.db.query('SELECT count(*)::int n FROM result_release')).rows[0]).toEqual({n:0});
 });
 it('only an active LAB_CERTIFIER may attempt certification; staff and ANC are refused (AT-RES-06)',async()=>{
  const c=await receivedCase(f);const {versionId}=await linked(c);
  await expect(certify(versionId,undefined,f.u.staff)).rejects.toThrow('FORBIDDEN');await expect(certify(versionId,undefined,f.u.anc)).rejects.toThrow('FORBIDDEN');
 });
 it('the database refuses any release or CertifiedReleased state while AL-5 is open',async()=>{
  const c=await receivedCase(f);const {versionId}=await linked(c);
  await expect(f.db.query("UPDATE result_report_version SET state='CertifiedReleased',row_version=row_version+1 WHERE id=$1",[versionId])).rejects.toThrow('RELEASE_HOLD_AL5');
  await expect(f.db.query("INSERT INTO result_release(version_id,case_id,round_id,kind,channel,certified_by) VALUES($1,$2,$3,'RESULT','NIPT_ANC_VIEW',$4)",[versionId,c.caseId,c.roundId,f.u.certifier.id])).rejects.toThrow('RELEASE_HOLD_AL5');
  expect((await f.db.query('SELECT p5_release_authorized() a')).rows[0]).toEqual({a:false});
 });
 it('AT-RG-09 / AT-CONC-10: a Redraw ordered after the review page opened makes certification fail on RG-05',async()=>{
  const c=await receivedCase(f);const {versionId}=await linked(c);await review(versionId);
  await f.run(t=>intake.orderRedraw(t,f.u.certifier,{caseId:c.caseId,reasonCode:'FETAL_FRACTION_LOW',note:'จำลอง สั่งเจาะซ้ำระหว่างตรวจทาน'}));
  const r=await certify(versionId);expect(r.outcome).toBe('BLOCKED');expect(r.failed.some(x=>x.startsWith('RG-05:'))).toBe(true);
 });
 it('abnormal results require explicit acknowledgement at review and certification',async()=>{
  const c=await receivedCase(f);const {versionId}=await linked(c,{risks:['High Risk','Low Risk','Low Risk']});
  await expect(review(versionId)).rejects.toThrow('ABNORMAL_ACK_REQUIRED');await expect(certify(versionId)).rejects.toThrow('ABNORMAL_ACK_REQUIRED');
  await review(versionId,f.u.staff,true);expect((await certify(versionId,undefined,f.u.certifier,true)).outcome).toBe('BLOCKED');
 });
 it('OD-04: the reviewer may also be the certifier — no forced separation, the result is still HOLD',async()=>{
  const c=await receivedCase(f);const {versionId}=await linked(c);await review(versionId,f.u.certifier);
  const r=await certify(versionId);expect(r.failed.some(x=>x.startsWith('RG-12'))).toBe(false);expect(r.outcome).toBe('BLOCKED');
 });
 it('AT-RES-05: sex shown but not wanted is blocked by RG-11',async()=>{
  const c=await receivedCase(f,{fetalSex:'DoNotWant'});const {versionId}=await linked(c);
  expect((await f.run(t=>svc.versionDetail(t,f.u.staff,versionId))).gate!.failed).toContain('RG-11:SEX_SHOWN_BUT_NOT_WANTED');
 });
});

describe('P5 revision, unlink and void (§11.6)',()=>{
 it('a second PDF for the same round needs revision details and supersedes the open version',async()=>{
  const c=await receivedCase(f);const first=await linked(c);
  const {versionId}=await importReport(f,spec(c,{reported:'21-Oct-2026'}));
  await expect(propose(versionId,c)).rejects.toThrow('REVISION_DETAILS_REQUIRED');
  await propose(versionId,c,{revision:{receivedDate:'2026-10-21',requestedBy:'จำลอง ห้องปฏิบัติการ',reason:'จำลอง แก้ไขฉบับรายงาน'}});
  expect((await approve(versionId)).outcome).toBe('ValidationBlocked');expect((await rowVersion(f,first.versionId)).state).toBe('Superseded');
  expect((await f.db.query('SELECT supersedes_id FROM result_report_version WHERE id=$1',[versionId])).rows[0]).toEqual({supersedes_id:first.versionId});
  const v=await rv(versionId);await expect(f.run(t=>svc.unlinkVersion(t,f.u.certifier,{versionId,reason:'จำลอง ถอดการเชื่อมโยง',expectedRowVersion:v}))).rejects.toThrow('UNLINK_REVISION_PROHIBITED');
 });
 it('unlink returns to Unlinked with history; void withdraws only an unlinked import and needs result.revise',async()=>{
  const c=await receivedCase(f);const {versionId}=await linked(c);
  let v=await rv(versionId);await f.run(t=>svc.unlinkVersion(t,f.u.certifier,{versionId,reason:'จำลอง เชื่อมผิดรอบ',expectedRowVersion:v}));expect((await rowVersion(f,versionId)).state).toBe('Unlinked');
  v=await rv(versionId);await expect(f.run(t=>svc.voidVersion(t,f.u.staff,{versionId,reason:'จำลอง ยกเลิกรายการนำเข้า',expectedRowVersion:v}))).rejects.toThrow('FORBIDDEN');
  await f.run(t=>svc.voidVersion(t,f.u.certifier,{versionId,reason:'จำลอง ยกเลิกรายการนำเข้า',expectedRowVersion:v}));expect((await rowVersion(f,versionId)).state).toBe('Voided');
  expect((await f.db.query<{event:string}>('SELECT event FROM result_link_event WHERE version_id=$1 ORDER BY sequence',[versionId])).rows.map(r=>r.event)).toEqual(['PROPOSED','APPROVED','UNLINKED']);
 });
 it('a stale page (old row version) cannot change the version',async()=>{
  const c=await receivedCase(f);const {versionId}=await importReport(f,spec(c));
  await expect(f.run(t=>svc.proposeLink(t,f.u.staff,{versionId,roundId:c.roundId,attemptId:c.attemptId,reason:'จำลอง หน้าเก่า',expectedRowVersion:0}))).rejects.toThrow('VERSION_CONFLICT');
 });
});

describe('P5 Redraw notice (§11.7, AT-LIN-05, AT-RG-08)',()=>{
 it('a notice imported before the Redraw order fails RN-03; it never needs QC; the channel stays PENDING OD-07',async()=>{
  const c=await receivedCase(f);const {versionId}=await importReport(f,{kind:'NOTICE',labNumber:'26B261010001-1',hn:c.hn,collection:pdfDate(c.collection)});
  await new Promise(r=>setTimeout(r,5));
  await f.run(t=>intake.orderRedraw(t,f.u.certifier,{caseId:c.caseId,reasonCode:'FETAL_FRACTION_LOW',note:'จำลอง สั่งเจาะซ้ำ'}));
  await propose(versionId,{roundId:c.roundId,attemptId:null});expect((await approve(versionId)).outcome).toBe('ValidationBlocked');
  const g=(await f.run(t=>svc.versionDetail(t,f.u.staff,versionId))).gate!;
  expect(g.gate).toBe('RN');expect(g.failed).toContain('RN-03:NOTICE_IMPORTED_BEFORE_REDRAW_ORDER');expect(g.predicates.find(p=>p.code==='RN-06')?.status).toBe('PASS');expect(g.pending).toContain('RN-07:OD-07:NOTICE_CHANNEL_NIPT_ONLY_PENDING');
 });
});

describe('P5 ANC Result Viewer scope (§11.8, AT-RES-07, AT-RN-01, AT-LIN-12)',()=>{
 it('ANC in scope sees the Redraw badge at once and no unreleased PDF; other units and file reads are denied',async()=>{
  const c=await receivedCase(f);await linked(c);await importReport(f,{kind:'NOTICE',labNumber:'N',hn:c.hn,collection:pdfDate(c.collection)});
  await f.run(t=>intake.orderRedraw(t,f.u.certifier,{caseId:c.caseId,reasonCode:'FETAL_FRACTION_LOW',note:'จำลอง สั่งเจาะซ้ำ'}));
  const v=await f.run(t=>svc.ancCaseResults(t,f.u.anc,c.caseId));
  expect(v.releaseHold).toBe(true);const r1=v.rounds.find(r=>r.number===1)!;
  expect(r1.redraw?.reasonCode).toBe('FETAL_FRACTION_LOW');expect(r1.result).toBeNull();expect(r1.notices).toEqual([]);expect(JSON.stringify(v)).not.toMatch(/sha256|SYNTHETIC PATIENT|9900000/);
  expect((await f.db.query("SELECT count(*)::int n FROM result_access_log WHERE purpose='ANC_RESULT_LIST'")).rows[0]).toEqual({n:1});
  await expect(f.run(t=>svc.ancCaseResults(t,{...f.u.anc,unitIds:[randomUUID()]},c.caseId))).rejects.toThrow('NOT_FOUND');
  const versionId=(await f.db.query<{id:string}>('SELECT id FROM result_report_version LIMIT 1')).rows[0].id;
  await expect(f.run(t=>svc.versionDetail(t,f.u.anc,versionId))).rejects.toThrow('FORBIDDEN');
  await expect(f.run(t=>svc.readVersionFile(t,f.u.anc,f.store,versionId))).rejects.toThrow('FORBIDDEN');
  await expect(f.run(t=>svc.readReleasedFile(t,f.u.anc,f.store,versionId))).rejects.toThrow('NOT_FOUND');
 });
 it('Auditor reads the queue but cannot import; ANC cannot import',async()=>{
  expect((await f.run(t=>svc.resultQueue(t,f.u.auditor))).releaseHold).toBe(true);
  await expect(f.run(t=>svc.queueResultJob(t,f.u.auditor,'synthetic_result_scan'))).rejects.toThrow('FORBIDDEN');
  await expect(f.run(t=>svc.queueResultJob(t,f.u.anc,'synthetic_result_scan'))).rejects.toThrow('FORBIDDEN');
 });
});

describe('P5 browser file picker (NIPTY upload alternative)',()=>{
 it('registers accepted files under one parse job and rejects empty/oversized files with codes; Thai names are kept',async()=>{
  const pdf=syntheticReportPdf({kind:'SINGLETON',labNumber:'UP',hn:'990000000801',collection:'10-Oct-2026'});
  const r=await f.run(t=>svc.registerUploads(t,f.u.staff,f.store,[{name:'ผล รายที่ 1.pdf',bytes:pdf},{name:'empty.pdf',bytes:Buffer.alloc(0)},{name:'big.pdf',bytes:Buffer.alloc(11*1024*1024,1)}]));
  expect(r.accepted).toBe(1);expect(r.rejected).toEqual([{name:'empty.pdf',code:'EMPTY_FILE'},{name:'big.pdf',code:'FILE_TOO_LARGE'}]);
  const rows=(await f.db.query<{id:string;original_name:string;state:string}>('SELECT id,original_name,state FROM result_intake_file WHERE job_id=$1',[r.jobId])).rows;
  expect(rows.map(x=>[x.original_name,x.state])).toEqual([['ผล รายที่ 1.pdf','Quarantined']]);
  expect((await f.db.query('SELECT kind FROM job_outbox WHERE id=$1',[r.jobId])).rows[0]).toEqual({kind:'synthetic_result_parse'});
  await expect(f.run(t=>svc.registerUploads(t,f.u.anc,f.store,[{name:'x.pdf',bytes:pdf}]))).rejects.toThrow('FORBIDDEN');
 });
});

describe('P5 folder workflow in the worker (NIPTY Test Path → Scan → Preview)',()=>{
 const limits={maxBytes:10*1024*1024,acceptZip:true};
 const seed=async()=>{
  await mkdir(path.join(f.root,'results','2026-10','ชุดที่ 1'),{recursive:true});
  await writeFile(path.join(f.root,'results','top.pdf'),syntheticReportPdf({kind:'SINGLETON',labNumber:'T',hn:'990000000901',collection:'10-Oct-2026'}));
  await writeFile(path.join(f.root,'results','2026-10','ชุดที่ 1','ผล รายที่ 2.pdf'),syntheticReportPdf({kind:'TWIN',labNumber:'U',hn:'990000000902',collection:'10-Oct-2026'}));
  await writeFile(path.join(f.root,'results','2026-10','old.zip'),zipAsPdf({kind:'SINGLETON',labNumber:'V',hn:'990000000903',collection:'10-Oct-2026'}));
  await writeFile(path.join(f.root,'results','2026-10','copy.pdf'),await readFile(path.join(f.root,'results','top.pdf')));
  await writeFile(path.join(f.root,'results','notes.txt'),'not a result');await writeFile(path.join(f.root,'results','.hidden.pdf'),'x');
 };
 it('Test Path is read-only and reports counts; hospital or escaping paths are refused in synthetic mode',async()=>{
  await seed();const before=await readFile(path.join(f.root,'results','top.pdf'));
  expect(await testResultFolder(f.root,'simulator/results',{recursive:true,maxFiles:100})).toMatchObject({passed:true,files:4,folders:2});
  expect(await readFile(path.join(f.root,'results','top.pdf'))).toEqual(before);
  for(const p of ['D:/NIPT-System/NIPTPDFresult','\\\\hospital\\share\\pdf','simulator/inbound','simulator/results/../inbound'])expect((await testResultFolder(f.root,p,{recursive:true,maxFiles:100})).errorCode).toBe('SIMULATOR_PATH_REQUIRED');
  expect((await testResultFolder(f.root,'simulator/results/missing',{recursive:true,maxFiles:100})).errorCode).toBe('FOLDER_NOT_FOUND');
 });
 it('Scan lists .pdf/.zip in sub-folders with SHA-256, in-scan duplicates and imported files; Preview re-checks the bytes',async()=>{
  await seed();
  try{await symlink(path.join(f.root,'results','top.pdf'),path.join(f.root,'results','link.pdf'));}catch{/* symlinks may need privileges on Windows */}
  const s=await scanResultFolder(f.db,f.root,'simulator/results',{recursive:true,maxFiles:100,maxBytes:limits.maxBytes,acceptZip:true});
  expect(s.files.map(x=>x.path).sort()).toEqual(['2026-10/copy.pdf','2026-10/old.zip','2026-10/ชุดที่ 1/ผล รายที่ 2.pdf','top.pdf']);
  expect(s.files.filter(x=>x.status==='DUPLICATE_IN_SCAN')).toHaveLength(1);
  expect((await scanResultFolder(f.db,f.root,'simulator/results',{recursive:false,maxFiles:100,maxBytes:limits.maxBytes,acceptZip:false})).files.map(x=>x.path)).toEqual(['top.pdf']);
  const pick=s.files.filter(x=>x.status==='NEW').map(x=>({path:x.path,sha256:x.sha256!}));
  const job=(await f.db.query<{id:string}>("INSERT INTO job_outbox(kind,payload,idempotency_key) VALUES('synthetic_result_preview','{}',$1) RETURNING id",['p5:'+randomUUID()])).rows[0].id;
  // top.pdf and copy.pdf hold the same bytes: whichever the scan listed first is NEW; change it on disk after the scan.
  const changed=pick.find(x=>['top.pdf','2026-10/copy.pdf'].includes(x.path))!.path;
  await writeFile(path.join(f.root,'results',...changed.split('/')),syntheticReportPdf({kind:'SINGLETON',labNumber:'T2',hn:'990000000901',collection:'10-Oct-2026'}));
  const ids=await f.run(t=>previewFolderFiles(t,f.store,f.root,'simulator/results',pick,f.u.staff.id,job,limits));
  const rows=(await f.db.query<{relative_path:string}>('SELECT relative_path,state,reject_code,template_kind,container FROM result_intake_file WHERE id=ANY($1)',[ids])).rows.sort((a,b)=>a.relative_path.localeCompare(b.relative_path));
  expect(rows).toEqual([{relative_path:'2026-10/old.zip',state:'Parsed',reject_code:null,template_kind:'SINGLETON',container:'ZIP_AS_PDF'},{relative_path:'2026-10/ชุดที่ 1/ผล รายที่ 2.pdf',state:'Parsed',reject_code:null,template_kind:'TWIN',container:'PDF'},{relative_path:changed,state:'Rejected',reject_code:'CHANGED_SINCE_SCAN',template_kind:null,container:null}].sort((a,b)=>a.relative_path.localeCompare(b.relative_path)));
  expect((await f.run(t=>svc.confirmImport(t,f.u.staff,{intakeIds:ids}))).map(x=>x.outcome).sort()).toEqual(['Rejected','Unlinked','Unlinked']);
  expect((await scanResultFolder(f.db,f.root,'simulator/results',{recursive:true,maxFiles:100,maxBytes:limits.maxBytes,acceptZip:true})).files.find(x=>x.path==='2026-10/old.zip')?.status).toBe('IMPORTED');
  expect((await f.run(t=>svc.resultQueue(t,f.u.staff))).latestFolder?.folder).toBe('2026-10/ชุดที่ 1');
  await expect(f.run(t=>previewFolderFiles(t,f.store,f.root,'simulator/results',[{path:'../inbound/x.pdf',sha256:'a'.repeat(64)}],f.u.staff.id,job,limits))).rejects.toThrow();
 });
});
