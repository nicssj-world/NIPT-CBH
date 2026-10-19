import {afterEach,beforeEach,describe,expect,it} from 'vitest';
import {resultFixture,receivedCase,importReport,pdfDate,rowVersion,type ResultFixture} from '../helpers/results';
import * as svc from '../../packages/results/service';
import {reportText,syntheticPdf} from '../../tools/his-simulator/result-pdf';

let f:ResultFixture;
beforeEach(async()=>{f=await resultFixture();});
afterEach(async()=>{await f.close();});
const propose=async(versionId:string,c:Awaited<ReturnType<typeof receivedCase>>)=>{const {row_version}=await rowVersion(f,versionId);return f.run(t=>svc.proposeLink(t,f.u.staff,{versionId,roundId:c.roundId,attemptId:c.attemptId,reason:'SYNTHETIC identity regression',expectedRowVersion:row_version}));};

describe('result lab-number identity (D01)',()=>{
 it('permits an unprinted optional lab number when every required identity field matches',async()=>{
  const c=await receivedCase(f),bytes=syntheticPdf(reportText({kind:'SINGLETON',labNumber:'OMITTED',hn:c.hn,collection:pdfDate(c.collection)}).map(line=>line.replace(/^Lab No\. \(LN\): OMITTED /,'')));
  const {versionId}=await importReport(f,bytes);await propose(versionId,c);
  const {row_version}=await rowVersion(f,versionId),result=await f.run(t=>svc.decideLink(t,f.u.certifier,{versionId,decision:'APPROVE',reason:'SYNTHETIC optional lab absent',expectedRowVersion:row_version}));
  expect(result.cross?.labNumber).toBe('NOT_AVAILABLE');expect(result.outcome).toBe('ValidationBlocked');
  const gate=await f.run(t=>svc.versionDetail(t,f.u.staff,versionId));expect(gate.gate?.predicates.find(p=>p.code==='RG-04')).toMatchObject({status:'PASS',reason:'CROSS_CHECK_MATCH'});
 });
 it('two-person manual approval records LinkConflict when all required identity fields match but the lab number conflicts',async()=>{
  const c=await receivedCase(f);
  const {versionId}=await importReport(f,{kind:'SINGLETON',labNumber:'26B999999999-1',hn:c.hn,collection:pdfDate(c.collection)});
  await propose(versionId,c);
  const {row_version}=await rowVersion(f,versionId);
  const result=await f.run(t=>svc.decideLink(t,f.u.certifier,{versionId,decision:'APPROVE',reason:'SYNTHETIC second-person check',expectedRowVersion:row_version}));
  expect(result.cross).toEqual({hn:'MATCH',dob:'MATCH',pregnancy:'MATCH',collectionDate:'MATCH',gestationalAge:'MATCH',labNumber:'MISMATCH'});
  expect(result.outcome).toBe('LinkConflict');
  expect((await rowVersion(f,versionId)).state).toBe('LinkConflict');
  expect((await f.db.query('SELECT outcome,cross_check FROM result_link_event WHERE version_id=$1 AND event=\'APPROVED\'',[versionId])).rows[0]).toMatchObject({outcome:'LinkConflict',cross_check:{labNumber:'MISMATCH'}});
  expect((await f.db.query('SELECT count(*)::int n FROM result_gate_evaluation WHERE version_id=$1',[versionId])).rows[0]).toEqual({n:0});
 });

 it('revalidation rejects a conflicting lab number on a legacy link accepted by the previous rule',async()=>{
  const c=await receivedCase(f);
  const {versionId}=await importReport(f,{kind:'SINGLETON',labNumber:'26B999999999-1',hn:c.hn,collection:pdfDate(c.collection)});
  await propose(versionId,c);
  // Reproduce the old persisted outcome through the real guards, without disabling
  // immutability or rewriting parsed evidence. This setup exists only in disposable PGlite.
  await f.run(async t=>{
   await t.query("INSERT INTO result_link_event(version_id,event,case_id,round_id,attempt_id,outcome,reason,cross_check,actor_id) VALUES($1,'APPROVED',$2,$3,$4,'Linked','SYNTHETIC pre-D01 legacy outcome',$5,$6)",[versionId,c.caseId,c.roundId,c.attemptId,JSON.stringify({hn:'MATCH',dob:'MATCH',pregnancy:'MATCH',collectionDate:'MATCH',gestationalAge:'MATCH',labNumber:'MISMATCH'}),f.u.certifier.id]);
   await t.query("UPDATE result_report_version SET state='Linked',case_id=$2,round_id=$3,attempt_id=$4,link_mode='MANUAL_REVIEWED',row_version=row_version+1 WHERE id=$1",[versionId,c.caseId,c.roundId,c.attemptId]);
  });
  const {row_version}=await rowVersion(f,versionId);
  expect(await f.run(t=>svc.revalidate(t,f.u.staff,{versionId,expectedRowVersion:row_version}))).toEqual({outcome:'ValidationBlocked'});
  const gate=(await f.db.query<{predicates:{code:string;status:string;reason:string}[];eligible:boolean}>('SELECT predicates,eligible FROM result_gate_evaluation WHERE version_id=$1 ORDER BY created_at DESC LIMIT 1',[versionId])).rows[0];
  expect(gate.eligible).toBe(false);
  expect(gate.predicates.find(p=>p.code==='RG-04')).toMatchObject({status:'FAIL',reason:'MISMATCH_LABNUMBER'});
  expect((await f.db.query('SELECT count(*)::int n FROM result_release WHERE version_id=$1',[versionId])).rows[0]).toEqual({n:0});
 });
});
