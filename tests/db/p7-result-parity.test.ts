import {describe,it,expect,beforeEach,afterEach} from 'vitest';
import {createHash,randomUUID} from 'node:crypto';
import {resultFixture,importReport,type ResultFixture} from '../helpers/results';
import {exportResultPage,queryResults} from '../../packages/results/query';
import {reparseResult,reparseHistory} from '../../packages/results/reparse';
import type {Principal} from '../../packages/security/policy';
import {registerIntake,parseIntake} from '../../packages/results/intake';
import {syntheticReportPdf,zipAsPdf} from '../../tools/his-simulator/result-pdf';
import {FileStore} from '../../packages/storage';
let f:ResultFixture;
beforeEach(async()=>{f=await resultFixture();});afterEach(async()=>{await f.close();});
async function session(u:Principal){const id=(await f.db.query<{id:string}>("INSERT INTO app_session(user_id,token_hash,csrf_hash,idle_expires_at,absolute_expires_at) VALUES($1,$2,$3,now()+interval '1 hour',now()+interval '2 hours') RETURNING id",[u.id,createHash('sha256').update(randomUUID()).digest('hex'),'c'.repeat(64)])).rows[0].id;return {...u,sessionId:id};}
const spec=(hn:string,kind:'SINGLETON'|'UNKNOWN'='SINGLETON')=>({kind,labNumber:'0000123',hn,collection:'10-Oct-2026'});
describe('P7 approved result parity',()=>{
 it('reported-date/search/gender/QC filters share full parsed-field CSV without inferring unknown values',async()=>{
  const target=await importReport(f,zipAsPdf({...spec('00021'),name:'ชื่อ _% จำลอง',reported:'20-Oct-2026'}));
  await importReport(f,{...spec('00022'),name:'OTHER SYNTHETIC',reported:'21-Oct-2026',sex:'Male',qc:'FAIL'});
  const missing=await importReport(f,{...spec('00023'),name:'MISSING DATE',reported:'30-Feb-2026',sex:null,omit:['qc']});
  const u=await session(f.u.staff),filters={dateField:'REPORTED',from:'2026-10-20',to:'2026-10-20',q:'_%',gender:'Female',qc:'PASS',pageSize:1};
  const page=await f.run(t=>queryResults(t,u,filters));expect(page.rows.map(x=>x.id)).toEqual([target.versionId]);expect(page.page.hasNext).toBe(false);
  const out=await f.run(t=>exportResultPage(t,u,filters));expect(out.rows).toEqual(page.rows);
  for(const value of ['ชื่อ _% จำลอง','2026-10-20','Low Risk','Not Detected','12.4','PASS','P5-PARSER-1.0.1','ANCHORED','SYNTHETIC_PARSED_NOT_CERTIFIED'])expect(out.csv).toContain(value);
  expect((await f.run(t=>queryResults(t,u,{q:'00022',gender:'Female'}))).rows).toEqual([]);
  const unknown=await f.run(t=>queryResults(t,u,{q:'00023',gender:'UNKNOWN',qc:'UNKNOWN'}));expect(unknown.rows.map(x=>x.id)).toEqual([missing.versionId]);expect(unknown.rows[0].risk).toBe('UNKNOWN');
  expect((await f.run(t=>queryResults(t,u,{dateField:'REPORTED',from:'2026-01-01',q:'00023'}))).rows).toEqual([]);
 });
 it('uses inclusive Bangkok date boundaries and excludes unsupported result risks before limit',async()=>{
  const fixture=async(hn:string,at:string)=>{
   const intake=await f.run(t=>registerIntake(t,f.store,{source:'UPLOAD',relativePath:null,originalName:`synthetic-date-${hn}.pdf`,actorId:f.u.staff.id,jobId:null},syntheticReportPdf(spec(hn))));
   await f.run(t=>parseIntake(t,f.store,intake,{maxBytes:1e6,acceptZip:true}));
   await f.db.query("INSERT INTO file_asset(sha256,byte_size,media_type,storage_key) SELECT sha256,byte_size,'application/pdf','sha256/'||substring(sha256,1,2)||'/'||substring(sha256,3,2)||'/'||sha256 FROM result_intake_file WHERE id=$1",[intake]);
   return (await f.db.query<{id:string}>(`INSERT INTO result_report_version(intake_file_id,sha256,kind,template_kind,template_version,parser_version,parsed,imported_by,imported_at)
    SELECT id,sha256,'RESULT',template_kind,parsed->>'templateVersion',parser_version,parsed,actor_id,$2 FROM result_intake_file WHERE id=$1 RETURNING id`,[intake,at])).rows[0].id;
  };
  await fixture('00010','2026-10-09T16:59:59Z');const start=await fixture('00011','2026-10-09T17:00:00Z'),end=await fixture('00012','2026-10-10T16:59:59Z');await fixture('00013','2026-10-10T17:00:00Z');
  const r=await f.run(t=>queryResults(t,f.u.staff,{from:'2026-10-10',to:'2026-10-10',risk:'LOW'}));expect(new Set(r.rows.map(x=>x.id))).toEqual(new Set([start,end]));
 });
 it('filters import dates/risk/state before pagination, same bounded CSV and audit',async()=>{
  const low=await importReport(f,spec('00001')),unknown=await importReport(f,spec('00002','UNKNOWN'));
  const u=await session(f.u.staff),q={bucket:'closed',risk:'UNKNOWN',pageSize:'1'};
  const page=await f.run(t=>queryResults(t,u,q));expect(page.rows.map(r=>r.id)).toEqual([unknown.versionId]);expect(page.page.hasNext).toBe(false);
  const out=await f.run(t=>exportResultPage(t,u,q));expect(out.rows).toEqual(page.rows);expect(out.csv).toContain("'00002");expect(out.csv).not.toContain(low.versionId);
  expect((await f.db.query<{n:number}>("SELECT count(*)::int n FROM audit_chain WHERE action='RESULT_QUEUE_CSV_EXPORTED'")).rows[0].n).toBe(1);
  const all=await f.run(t=>queryResults(t,u,{pageSize:'1'}));expect(all.rows).toHaveLength(1);expect(all.page.hasNext).toBe(true);
  const ancient=await f.run(t=>queryResults(t,u,{to:'2000-01-01'}));expect(ancient.rows).toEqual([]);
 });
 it('requires export+review, lab role and an active session for export',async()=>{
  await expect(f.run(t=>exportResultPage(t,f.u.staff,{}))).rejects.toThrow('UNAUTHENTICATED');
  for(const principal of [f.u.auditor,f.u.anc])await expect(f.run(async t=>exportResultPage(t,await session(principal),{}))).rejects.toThrow('FORBIDDEN');
  const u=await session(f.u.staff);await f.db.query('UPDATE app_session SET revoked_at=now() WHERE id=$1',[u.sessionId]);await expect(f.run(t=>exportResultPage(t,u,{}))).rejects.toThrow('UNAUTHENTICATED');
 });
 it('controlled reparse is append-only, reasoned, idempotent and cannot change clinical evidence',async()=>{
  const {versionId}=await importReport(f,spec('00003')),u=await session(f.u.certifier),request={versionId,reason:'จำลอง ตรวจ parser จากต้นฉบับ',idempotencyKey:randomUUID()};
  const before=(await f.db.query('SELECT * FROM result_report_version WHERE id=$1',[versionId])).rows[0];
  const a=await f.run(t=>reparseResult(t,u,f.store,request)),b=await f.run(t=>reparseResult(t,u,f.store,request));expect(a.id).toBe(b.id);expect(a.promoted).toBe(false);expect(a.outcome).toBe('PARSED_DIAGNOSTIC');
  expect((await f.db.query('SELECT * FROM result_report_version WHERE id=$1',[versionId])).rows[0]).toEqual(before);
  expect((await f.db.query<{n:number}>('SELECT count(*)::int n FROM result_reparse_evidence')).rows[0].n).toBe(1);
  for(const table of ['result_link_event','result_review','result_release'])expect((await f.db.query<{n:number}>(`SELECT count(*)::int n FROM ${table}`)).rows[0].n).toBe(0);
  await expect(f.run(t=>reparseResult(t,u,f.store,{...request,reason:'จำลอง เปลี่ยนเหตุผลของคำขอเดิม'}))).rejects.toThrow('IDEMPOTENCY_KEY_REUSED');
  await expect(f.db.query('DELETE FROM result_reparse_evidence')).rejects.toThrow();
  await expect(f.db.query("UPDATE result_reparse_evidence SET reason='changed' WHERE id=$1",[a.id])).rejects.toThrow();
 });
 it('reparse refuses staff, missing/revoked sessions and invalid reasons',async()=>{
  const {versionId}=await importReport(f,spec('00004')),req={versionId,reason:'จำลอง ตรวจซ้ำ parser',idempotencyKey:randomUUID()};
  await expect(f.run(async t=>reparseResult(t,await session(f.u.staff),f.store,req))).rejects.toThrow('FORBIDDEN');
  await expect(f.run(t=>reparseResult(t,f.u.certifier,f.store,req))).rejects.toThrow('UNAUTHENTICATED');
  const u=await session(f.u.certifier);await expect(f.run(t=>reparseResult(t,u,f.store,{...req,reason:'short'}))).rejects.toThrow();
  await f.db.query('UPDATE app_session SET signing_suspended=true WHERE id=$1',[u.sessionId]);await expect(f.run(t=>reparseResult(t,u,f.store,req))).rejects.toThrow('STAFF_SESSION_SUSPENDED');
 });
 it('records an unreadable original as a rejected diagnostic without changing imported values',async()=>{
  const {versionId}=await importReport(f,spec('00005')),u=await session(f.u.certifier),before=(await f.db.query('SELECT parsed,state,row_version FROM result_report_version WHERE id=$1',[versionId])).rows[0];
  const r=await f.run(t=>reparseResult(t,u,new FileStore(f.base+'/missing-originals'),{versionId,reason:'จำลอง ตรวจไฟล์ต้นฉบับที่อ่านไม่ได้',idempotencyKey:randomUUID()}));
  expect(r).toMatchObject({outcome:'REJECTED_DIAGNOSTIC',rejectCode:'ORIGINAL_UNREADABLE',promoted:false});expect((await f.db.query('SELECT parsed,state,row_version FROM result_report_version WHERE id=$1',[versionId])).rows[0]).toEqual(before);
 });
 it('rejects wall-clock session expiry during extraction and stale certifier grants; history has exact scope',async()=>{
  const {versionId}=await importReport(f,spec('00006')),u=await session(f.u.certifier),input={versionId,reason:'จำลอง ตรวจ expiry ระหว่างอ่านต้นฉบับ',idempotencyKey:randomUUID()};
  class ExpiringStore extends FileStore{override async get(hash:string){const bytes=await f.store.get(hash);await f.db.query("UPDATE app_session SET idle_expires_at=clock_timestamp()-interval '1 microsecond' WHERE id=$1",[u.sessionId]);return bytes;}}
  await expect(f.run(t=>reparseResult(t,u,new ExpiringStore(f.store.root),input))).rejects.toThrow('UNAUTHENTICATED');
  expect((await f.db.query<{n:number}>('SELECT count(*)::int n FROM result_reparse_evidence')).rows[0].n).toBe(0);
  await expect(f.run(t=>reparseHistory(t,u,randomUUID()))).rejects.toThrow('NOT_FOUND');
  await f.db.query("UPDATE role_assignment SET expires_at=clock_timestamp()-interval '1 second' WHERE user_id=$1 AND role='LAB_CERTIFIER'",[u.id]);
  await expect(f.run(t=>reparseResult(t,u,f.store,input))).rejects.toThrow('FORBIDDEN');
 });
});
