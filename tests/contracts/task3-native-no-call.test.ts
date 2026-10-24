import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {task3Fixture,halosWorkbook,signerSetup,approveInterpretation,masters} from '../helpers/task3';
import {previewHalosImport,decideHalosImport} from '../../packages/readygen/halos-import';
import {reportCandidate,finalizeReports} from '../../packages/readygen/reports';
import {confirmFailure,noCall} from '../../packages/lab/intake';
import {pdfText} from '../../packages/results/extract';
import {ancCaseResults} from '../../packages/results/service';

// Native (Microsoft Word). Owner Task 1 decision 2: a No Call is the SAME normal master with an explicit "Result = No Call",
// the failed QC as recorded, and no risk/sex/SCA/fetal-fraction finding. It reuses the accepted Task 1 No Call QC5/release contract.
it('native No Call: held until its rendering is approved, then the Owner master with Result = No Call releases through the Task 1 No Call contract',async()=>{
 const f=await task3Fixture([{ln:'9900099541',hn:'9900099941',pregnancy:'Singleton',sheet:1,priorFailures:true},{ln:'9900099542',hn:'9900099942',pregnancy:'Twins',sheet:2,priorFailures:true},{ln:'9900099543',hn:'9900099943',pregnancy:'Singleton',sheet:3}]);
 try{
  const deps={store:f.store,templates:masters()},[s,tw,ok]=f.cases;
  // Attempt 4 really ran in the batch: the operator confirms the sequencing failure, then selects No Call (existing Task 1 APIs).
  for(const c of [s,tw]){
   await f.run(t=>confirmFailure(t,f.u.staff,{attemptId:c.attemptId,stage:'SEQUENCING',confirmed:true,note:'SYNTHETIC sequencing QC failed after four attempts'}));
   await f.run(t=>noCall(t,f.u.staff,{attemptId:c.attemptId}));
  }
  const bytes=halosWorkbook({result:[{sample:s.printed,qc:'Fail',advice:'Resample',t21:'',ff:''},{sample:tw.printed,qc:'Fail',advice:'Resample',gender:''},{sample:ok.printed,qc:'Fail',advice:'Resample'}],
   sampleinfo:f.cases.map(x=>({id:x.vendorId,fetus:x.pregnancy,ga:x===ok?'17,6':'18,0'}))});
  const imp=await f.run(t=>previewHalosImport(t,f.u.staff,f.store,{name:'Sample analysis data_S990000001_NOCALL.xlsx',bytes}));
  expect(imp.rows.filter(r=>r.sheet==='result').map(r=>r.classification)).toEqual(['PATIENT','PATIENT','PATIENT']);
  await f.run(t=>decideHalosImport(t,f.u.staff,{importId:imp.id,decision:'CONFIRM',expectedRowVersion:imp.rowVersion}));
  const rowOf=(x:string)=>imp.rows.find(r=>r.sheet==='result'&&r.sampleKey===x)!.id;
  await signerSetup(f);
  await approveInterpretation(f,{interpretationApproved:true,singletonApprovedProduct:'HNZ0011',twinApprovedProduct:'HNZ0011',approvalReference:'SYNTHETIC-CLINICAL-APPROVAL-NC'});
  // 1. No Call rendering not approved: HOLD, never interpreted. A failed QC without No Call stays an ordinary QC HOLD.
  let c=await f.run(t=>reportCandidate(t,f.u.certifier,deps,{rowId:rowOf(s.printed)}));
  expect(c.holds.map(h=>h.code)).toEqual(['NO_CALL_RENDERING_NOT_APPROVED']);
  const plain=await f.run(t=>reportCandidate(t,f.u.certifier,deps,{rowId:rowOf(ok.printed)}));expect(plain.holds.map(h=>h.code)).toContain('QC_NOT_PASS');
  const held=await f.run(t=>finalizeReports(t,f.u.certifier,deps,{idempotencyKey:randomUUID(),defaults:{reportedBy:f.u.staff.id,approvedBy:f.u.certifier.id},items:[{rowId:rowOf(s.printed)}]}));
  expect(held.items[0]).toMatchObject({outcome:'HOLD'});expect((await f.db.query('SELECT 1 FROM internal_report')).rows).toHaveLength(0);
  // 2. Clinical maker-checker approves the No Call rendering shown in Settings.
  await approveInterpretation(f,{interpretationApproved:true,singletonApprovedProduct:'HNZ0011',twinApprovedProduct:'HNZ0011',noCallRenderingApproved:true,approvalReference:'SYNTHETIC-CLINICAL-APPROVAL-NC'});
  c=await f.run(t=>reportCandidate(t,f.u.certifier,deps,{rowId:rowOf(s.printed)}));expect(c.holds).toEqual([]);
  expect(c.values).toMatchObject({qc:'FAIL',trisomy21_ra:'No Call',gender:'No Call',XO_NEW:'No Call',fetalFaction_2:'No Call',risk21:'-',remarks:'Result = No Call'});
  const fin=await f.run(t=>finalizeReports(t,f.u.certifier,deps,{idempotencyKey:randomUUID(),defaults:{reportedBy:f.u.staff.id,approvedBy:f.u.certifier.id},release:true,
   releaseConfirmations:{reportContentVerified:true,identityAndValuesMatchReport:true,disclosureReviewed:true,abnormalAcknowledged:false},items:[{rowId:rowOf(s.printed)},{rowId:rowOf(tw.printed)}]}));
  expect(fin.items.map(i=>[i.outcome,i.versionState,i.code??null,JSON.stringify(i.details??null)])).toEqual([['FINAL','CertifiedReleased',null,'null'],['FINAL','CertifiedReleased',null,'null']]);
  for(const [x,kind] of [[s,'SINGLETON'],[tw,'TWIN']] as const){
   const v=(await f.db.query<{id:string;sha256:string;origin:string;template_kind:string;parsed:{results:{result:{value:string};qc:{value:string};t21:{value:string|null}}}}>('SELECT v.* FROM result_report_version v JOIN internal_report r ON r.version_id=v.id WHERE r.attempt_id=$1',[x.attemptId])).rows[0];
   expect(v).toMatchObject({origin:'INTERNAL_GENERATED',template_kind:kind});expect(v.parsed.results.result.value).toBe('No Call');expect(v.parsed.results.qc.value).toBe('FAIL');expect(v.parsed.results.t21.value).toBeNull();
   const text=(await pdfText(await f.store.get(v.sha256))).text;
   expect(text).toMatch(/Result = No Call/);expect(text).not.toMatch(/\b(?:Low Risk|High Risk|Male|Female)\b/);expect(text).toMatch(/No Call No Call No Call/);expect(text).toContain(x.printed);
   // The accepted Task 1 No Call QC5 evidence; the attempt stays failed; exactly one active release; ANC shows No Call.
   const q=(await f.db.query<{valid:boolean;no_call_event_id:string|null}>('SELECT task1_no_call_qc5_valid(q) valid,no_call_event_id FROM result_qc5_review q WHERE version_id=$1',[v.id])).rows[0];
   expect(q.valid).toBe(true);expect(q.no_call_event_id).not.toBeNull();
   expect((await f.db.query<{state:string}>('SELECT state FROM analytical_attempt WHERE id=$1',[x.attemptId])).rows[0].state).toBe('QcFailed');
   expect((await f.db.query("SELECT 1 FROM result_release WHERE version_id=$1 AND state='Active'",[v.id])).rows).toHaveLength(1);
   const anc=await f.run(t=>ancCaseResults(t,f.u.anc,x.caseId));expect(JSON.stringify(anc)).toContain('"noCall":true');
  }
 }finally{await f.close();}
},600_000);
