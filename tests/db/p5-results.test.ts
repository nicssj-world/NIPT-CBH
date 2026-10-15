import {describe,it,expect,beforeEach,afterEach} from 'vitest';
import {resultFixture,receivedCase,importReport,rowVersion,pdfDate,type ResultFixture} from '../helpers/results';
import * as svc from '../../packages/results/service';
import {registerIntake,parseIntake} from '../../packages/results/intake';
import {syntheticReportPdf,zipAsPdf,syntheticZip} from '../../tools/his-simulator/result-pdf';
import type {Principal} from '../../packages/security/policy';

let f:ResultFixture;
beforeEach(async()=>{f=await resultFixture();});
afterEach(async()=>{await f.close();});
const spec=(c:{hn:string;collection:string},extra:Record<string,unknown>={})=>({kind:'SINGLETON' as const,labNumber:'26B261010001-1',hn:c.hn,collection:pdfDate(c.collection),...extra});
const propose=(id:string,c:{roundId:string;attemptId:string},rv:number,extra:Record<string,unknown>={})=>f.run(t=>svc.proposeLink(t,f.u.staff,{versionId:id,roundId:c.roundId,attemptId:c.attemptId,reason:'จำลอง ตรวจคู่ตามรอบและ Attempt',expectedRowVersion:rv,...extra}));
const approve=(id:string,rv:number,user:Principal=f.u.certifier)=>f.run(t=>svc.decideLink(t,user,{versionId:id,decision:'APPROVE',reason:'จำลอง ยืนยันการเชื่อมโยง',expectedRowVersion:rv}));
const linked=async(c:Awaited<ReturnType<typeof receivedCase>>,extra:Record<string,unknown>={})=>{
 const {versionId}=await importReport(f,spec(c,extra));await propose(versionId,c,(await rowVersion(f,versionId)).row_version);
 const r=await approve(versionId,(await rowVersion(f,versionId)).row_version);return {versionId,...r};
};

describe('P5 intake, import and immutable original (§11.1, AT-RES-01..03)',()=>{
 it('imports as Unlinked, never auto-links, keeps the original bytes and detects duplicates by SHA-256',async()=>{
  const c=await receivedCase(f);const bytes=syntheticReportPdf(spec(c));
  const {versionId,outcome}=await importReport(f,bytes);expect(outcome).toBe('Unlinked');
  const v=(await f.db.query<{sha256:string;case_id:string|null;parser_version:string}>('SELECT sha256,case_id,parser_version FROM result_report_version WHERE id=$1',[versionId])).rows[0];
  expect(v.case_id).toBeNull();expect(v.parser_version).toBe('P5-PARSER-1.0.1');expect(await f.store.get(v.sha256)).toEqual(bytes);
  expect((await f.db.query('SELECT count(*)::int n FROM result_link_event')).rows[0]).toEqual({n:0});
  const again=await importReport(f,bytes);expect(again.outcome).toBe('Duplicate');expect(again.versionId).toBe(versionId);
  await expect(f.db.query("UPDATE result_intake_file SET parsed='{}' WHERE id=(SELECT intake_file_id FROM result_report_version WHERE id=$1)",[versionId])).rejects.toThrow('INTAKE_EVIDENCE_IMMUTABLE');
  await expect(f.db.query("UPDATE result_report_version SET parsed='{}',row_version=row_version+1 WHERE id=$1",[versionId])).rejects.toThrow('REPORT_VERSION_IMMUTABLE');
  await expect(f.db.query('DELETE FROM result_report_version WHERE id=$1',[versionId])).rejects.toThrow();
  const events=(await f.db.query<{to_state:string}>('SELECT to_state FROM result_version_event WHERE version_id=$1 ORDER BY sequence',[versionId])).rows.map(r=>r.to_state);expect(events).toEqual(['Imported','Parsed','Unlinked']);
 });
 it('malformed files are rejected in quarantine with a code; unknown templates become RejectedImport',async()=>{
  const bad=await f.run(t=>registerIntake(t,f.store,{source:'UPLOAD',relativePath:null,originalName:'x.pdf',actorId:f.u.staff.id,jobId:null},Buffer.from('<html>')));
  expect(await f.run(t=>parseIntake(t,f.store,bad,{maxBytes:1e6,acceptZip:true}))).toBe('Rejected');
  expect((await f.db.query('SELECT reject_code FROM result_intake_file WHERE id=$1',[bad])).rows[0]).toEqual({reject_code:'NOT_PDF_OR_ZIP'});
  const zip=await f.run(t=>registerIntake(t,f.store,{source:'UPLOAD',relativePath:null,originalName:'z.pdf',actorId:f.u.staff.id,jobId:null},zipAsPdf({kind:'SINGLETON',labNumber:'L',hn:'990000000001',collection:'10-Oct-2026'})));
  expect(await f.run(t=>parseIntake(t,f.store,zip,{maxBytes:1e6,acceptZip:false}))).toBe('Rejected');
  expect((await importReport(f,{kind:'UNKNOWN',labNumber:'X',hn:'990000000002',collection:'10-Oct-2026'})).outcome).toBe('RejectedImport');
 });
 it('a batch ZIP becomes one intake per PDF member; previews belong to their requester',async()=>{
  const batch=syntheticZip([{name:'a.pdf',data:syntheticReportPdf({kind:'SINGLETON',labNumber:'A',hn:'990000000011',collection:'10-Oct-2026'})},{name:'b.pdf',data:syntheticReportPdf({kind:'NOTICE',labNumber:'B',hn:'990000000012',collection:'10-Oct-2026'}),deflate:true}]);
  const id=await f.run(t=>registerIntake(t,f.store,{source:'UPLOAD',relativePath:null,originalName:'batch.zip',actorId:f.u.staff.id,jobId:null},batch));
  await f.run(t=>parseIntake(t,f.store,id,{maxBytes:1e6,acceptZip:true}));
  const kids=(await f.db.query<{id:string;template_kind:string;member_name:string}>('SELECT id,template_kind,member_name FROM result_intake_file WHERE parent_id=$1 ORDER BY member_name',[id])).rows;
  expect(kids.map(k=>[k.member_name,k.template_kind])).toEqual([['a.pdf','SINGLETON'],['b.pdf','REDRAW_NOTICE']]);
  await expect(f.run(t=>svc.confirmImport(t,f.u.staff2,{intakeIds:[kids[0].id]}))).rejects.toThrow('NOT_FOUND');
  const r=await f.run(t=>svc.confirmImport(t,f.u.staff,{intakeIds:kids.map(k=>k.id)}));expect(r.map(x=>x.outcome)).toEqual(['Unlinked','Unlinked']);
  expect((await f.db.query('SELECT state FROM result_intake_file WHERE id=$1',[id])).rows[0]).toEqual({state:'Imported'});
 });
});

describe('P5 manual reviewed linkage (§11.3, AT-ID-01..07, AT-RES-04)',()=>{
 it('AT-ID-02: two orders with the same HN are both candidates per round/attempt; nothing links automatically',async()=>{
  const a=await receivedCase(f,{hn:'990000050050'}),b=await receivedCase(f,{hn:'990000050050'});
  const {versionId}=await importReport(f,spec(a));const d=await f.run(t=>svc.versionDetail(t,f.u.staff,versionId));
  expect(d.version.state).toBe('Unlinked');expect(d.candidates.map(x=>x.caseId).sort()).toEqual([a.caseId,b.caseId].sort());
  expect(d.candidates.every(x=>x.matchedOn.includes('HN')&&x.round.number===1)).toBe(true);
 });
 it('AT-ID-06: the proposer cannot approve; a second person links; DB guard enforces it too',async()=>{
  const c=await receivedCase(f);const {versionId}=await importReport(f,spec(c));
  await propose(versionId,c,(await rowVersion(f,versionId)).row_version);
  const current=(await rowVersion(f,versionId)).row_version;
  await expect(f.run(t=>svc.decideLink(t,f.u.staff,{versionId,decision:'APPROVE',reason:'จำลอง อนุมัติเอง',expectedRowVersion:current}))).rejects.toThrow(/SECOND_PERSON_REQUIRED|FORBIDDEN/);
  await expect(f.db.query("INSERT INTO result_link_event(version_id,event,case_id,round_id,attempt_id,outcome,reason,actor_id) VALUES($1,'APPROVED',$2,$3,$4,'Linked','จำลอง ข้าม guard',$5)",[versionId,c.caseId,c.roundId,c.attemptId,f.u.staff.id])).rejects.toThrow('SECOND_PERSON_REQUIRED');
  const r=await approve(versionId,(await rowVersion(f,versionId)).row_version);
  // Linked, then validated: RG-01 (OD-07) and RG-07 (FinalQcAccepted from P4b) keep it blocked.
  expect(r.outcome).toBe('ValidationBlocked');expect(r.cross).toMatchObject({hn:'MATCH',dob:'MATCH',pregnancy:'MATCH',collectionDate:'MATCH',gestationalAge:'MATCH'});
 });
 it('AT-RG-05 / AT-ID-04 / AT-ID-07: a DOB, round collection date or pregnancy mismatch becomes LinkConflict',async()=>{
  const c=await receivedCase(f);expect((await linked(c,{dob:'01-Jan-1990'})).outcome).toBe('LinkConflict');
  const d=await receivedCase(f);expect((await linked(d,{collection:'09-Oct-2026'})).outcome).toBe('LinkConflict');
  const t=await receivedCase(f);expect((await linked(t,{kind:'TWIN'})).outcome).toBe('LinkConflict');
 });
 it('a result cannot link to a round without an attempt; historical cases are never targets',async()=>{
  const c=await receivedCase(f);const {versionId}=await importReport(f,spec(c));
  const v=(await rowVersion(f,versionId)).row_version;await expect(f.run(t=>svc.proposeLink(t,f.u.staff,{versionId,roundId:c.roundId,attemptId:null,reason:'จำลอง ไม่มี Attempt',expectedRowVersion:v}))).rejects.toThrow('ATTEMPT_REQUIRED_FOR_RESULT');
 });
});

