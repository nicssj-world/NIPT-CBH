import {it,expect,vi,afterEach} from 'vitest';
import {mkdir,writeFile} from 'node:fs/promises';
import {importReport} from '../helpers/results';
import {setHold} from '../../packages/lab/intake';
import {releaseResultFromParsed,releaseOrderFromPet} from '../../packages/p6/released-result';
import {serializeOperationalRes,syntheticProfile} from '../../packages/p6/res';
import {syntheticReportPdf} from '../../tools/his-simulator/result-pdf';
import type {Parsed} from '../../packages/results/parser';

import {noCallFixture} from '../helpers/task1-no-call';
afterEach(()=>vi.unstubAllEnvs());

it('same normal-structure external No Call PDF imports, identity-links, certifies and remains failed QC; outbound says No Call',async()=>{
 const f=await noCallFixture();try{
  expect((await f.db.query('SELECT * FROM result_release')).rows).toHaveLength(0);expect((await f.db.query("SELECT * FROM job_outbox WHERE kind='result_release_completed'")).rows).toHaveLength(0);
  const bytes=syntheticReportPdf(f.spec),report=await importReport(f.rf,bytes);await f.link(report.versionId);
  await expect(f.accept(report.versionId,f.u.staff)).rejects.toThrow('FORBIDDEN');
  const released=await f.accept(report.versionId);expect(released.outcome).toBe('CertifiedReleased');
  const release=(await f.db.query<{id:string;epoch:number}>('SELECT id,epoch FROM result_release WHERE version_id=$1',[report.versionId])).rows[0];
  expect((await f.db.query<{eligible:boolean}>('SELECT p6_release_eligible($1,$2) eligible',[release.id,release.epoch])).rows[0].eligible).toBe(true);
  expect((await f.db.query<{state:string}>('SELECT state FROM analytical_attempt WHERE id=$1',[f.a.id])).rows[0].state).toBe('QcFailed');
  expect((await f.db.query('SELECT * FROM attempt_stage_qc WHERE attempt_id=$1 AND decision=\'Accepted\'',[f.a.id])).rows).toHaveLength(0);
  const q=(await f.db.query<{no_call_event_id:string;pool_id:null;bench_review_id:null}>('SELECT * FROM result_qc5_review WHERE version_id=$1',[report.versionId])).rows[0];expect(q.no_call_event_id).toBeTruthy();expect(q.pool_id).toBeNull();expect(q.bench_review_id).toBeNull();
  const v=(await f.db.query<{parsed:Parsed}>('SELECT parsed FROM result_report_version WHERE id=$1',[report.versionId])).rows[0];expect(v.parsed.results.qc.value).toBe('FAIL');expect(v.parsed.results.t21.value).toBeNull();
  const outbound=releaseResultFromParsed(v.parsed),res=serializeOperationalRes({order:releaseOrderFromPet(f.pet),generatedAt:'20261024080000',approvedAt:'20261024080000',certifierHisId:'SYNTHETIC^CERTIFIER',result:outbound},{...syntheticProfile,syntheticOnly:false,style:'short'}),text=res.bytes.subarray(2).toString('utf16le');
  expect(text).toContain('No Call');expect(text).not.toContain('Low risk');
  const root='.local/task1-owner-resolution-20261024';await mkdir(root,{recursive:true});await writeFile(root+'/synthetic-external-no-call.pdf',bytes);await writeFile(root+'/synthetic-no-call.res',res.bytes);await writeFile(root+'/no-call-release-evidence.json',JSON.stringify({syntheticOnly:true,versionId:report.versionId,releaseId:release.id,parsed:v.parsed,outbound,gate:'p6_release_eligible=true',attemptState:'QcFailed',noActualHisTransmission:true},null,2));
  // Check each post-release publication guard independently, rolling back its synthetic mutation.
  for(const change of ['HOLD','CONSENT','CURRENT_ATTEMPT'] as const){
   await f.db.query('BEGIN');try{
    if(change==='HOLD')await setHold(f.db,f.u.staff,{attemptId:f.a.id,hold:true,reason:'SYNTHETIC safety hold after certification'});
    else if(change==='CONSENT')await f.db.query("INSERT INTO p2_revocation(case_id,round_id,stage,reason,actor_id) VALUES($1,$2,'W1','SYNTHETIC consent withdrawal guard fixture',$3)",[f.registered.caseId,f.a.round_id,f.u.staff.id]);
    else {
     const order=(await f.db.query<{id:string}>("INSERT INTO repeat_work_order(case_id,round_id,reason_code,state,parent_attempt_id,level,note,requested_by) VALUES($1,$2,'OTHER','RepeatFailed',$3,'RE_LIBRARY','SYNTHETIC current-attempt guard fixture',$4) RETURNING id",[f.registered.caseId,f.a.round_id,f.a.id,f.u.staff.id])).rows[0].id;
     await f.db.query("INSERT INTO analytical_attempt(case_id,round_id,attempt_number,repeat_order_id,state,qc_failed_stage) VALUES($1,$2,5,$3,'QcFailed','SEQUENCING')",[f.registered.caseId,f.a.round_id,order]);
    }
    expect((await f.db.query<{eligible:boolean}>('SELECT p6_release_eligible($1,$2) eligible',[release.id,release.epoch])).rows[0].eligible).toBe(false);
   }finally{await f.db.query('ROLLBACK');}
   expect((await f.db.query<{eligible:boolean}>('SELECT p6_release_eligible($1,$2) eligible',[release.id,release.epoch])).rows[0].eligible).toBe(true);
  }
 }finally{await f.close();}
},120000);

it.each(['NO_SELECTION','NORMAL_PDF','WRONG_IDENTITY','MISSING_QC','HOLD'] as const)('external No Call fails closed: %s',async scenario=>{
 const f=await noCallFixture(scenario!=='NO_SELECTION');try{
  const spec=scenario==='NORMAL_PDF'?{...f.spec,result:undefined,qc:'PASS'}:scenario==='WRONG_IDENTITY'?{...f.spec,hn:'9900099999'}:scenario==='MISSING_QC'?{...f.spec,qc:undefined}:f.spec;
  const report=await importReport(f.rf,spec),linked=await f.link(report.versionId);
  if(scenario==='WRONG_IDENTITY')expect(linked.outcome).toBe('LinkConflict');
  const parsed=(await f.db.query<{parsed:Parsed}>('SELECT parsed FROM result_report_version WHERE id=$1',[report.versionId])).rows[0].parsed;
  if(scenario==='NORMAL_PDF')expect(parsed.results.result?.value).toBeNull();
  if(scenario==='MISSING_QC')expect(parsed.results.qc.value).toBeNull();
  if(scenario==='HOLD')await f.run(t=>setHold(t,f.u.staff,{attemptId:f.a.id,hold:true,reason:'SYNTHETIC safety hold before certification'}));
  await expect(f.accept(report.versionId)).rejects.toThrow();
  expect((await f.db.query('SELECT * FROM result_release')).rows).toHaveLength(0);expect((await f.db.query("SELECT * FROM job_outbox WHERE kind='result_release_completed'")).rows).toHaveLength(0);
  expect((await f.db.query<{state:string}>('SELECT state FROM analytical_attempt WHERE id=$1',[f.a.id])).rows[0].state).toBe('QcFailed');
 }finally{await f.close();}
},120000);
