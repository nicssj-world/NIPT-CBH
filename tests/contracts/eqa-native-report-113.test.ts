import {it,expect,vi} from 'vitest';
import {randomUUID,createHash} from 'node:crypto';
import {task3Fixture,halosWorkbook,signerSetup,approveInterpretation,masters} from '../helpers/task3';
import {previewHalosImport,decideHalosImport} from '../../packages/readygen/halos-import';
import {reportCandidate,previewReport,finalizeReports} from '../../packages/readygen/reports';
import {pdfText} from '../../packages/results/extract';
it('EQA PET-less case reaches native Word signed final PDF and certified release; HIS queue stays empty',async()=>{
 const f=await task3Fixture([
  {ln:'9900099541',hn:'9900099941',pregnancy:'Singleton',sheet:1,eqa:true},
  {ln:'9900099542',hn:'9900099942',pregnancy:'Singleton',sheet:2},
  {ln:'9900099543',hn:'9900099943',pregnancy:'Twins',sheet:3}
 ]);
 try{
  const deps={store:f.store,templates:masters()};
  const [eqa,patient,twin]=f.cases,[pc,nc]=f.controls;
  const bytes=halosWorkbook({result:[
    {sample:pc,t13:'TH13',t18:'TH18',t21:'TH21',sex:''},
    {sample:eqa.printed,ff:'14.7',gender:'Female'},
    {sample:patient.printed,ff:'14.7',gender:'Female'},
    {sample:twin.printed,gender:'Male',ff:'11.25'},
    {sample:nc,sex:''
  }],sampleinfo:f.cases.map(x=>({id:x.vendorId,fetus:x.pregnancy,ga:'17,6'}))});
  const imp=await f.run(t=>previewHalosImport(t,f.u.staff,f.store,{name:'S990000001_EQA_10242026.xlsx',bytes}));
  await f.run(t=>decideHalosImport(t,f.u.staff,{importId:imp.id,decision:'CONFIRM',expectedRowVersion:imp.rowVersion}));
  const row=imp.rows.find(x=>x.sheet==='result'&&x.sampleKey===eqa.printed)!;
  await signerSetup(f);
  await approveInterpretation(f,{interpretationApproved:true,singletonApprovedProduct:'HNZ0011',twinApprovedProduct:'HNZ0011',approvalReference:'SYNTHETIC-EQA-INTERPRETATION-2026'});
  const cand=await f.run(t=>reportCandidate(t,f.u.certifier,deps,{rowId:row.id}));
  console.log('EQA_CANDIDATE_HOLDS',JSON.stringify(cand.holds));
  expect(cand.holds).toEqual([]);
  const preview=await f.run(t=>previewReport(t,f.u.staff,deps,{rowId:row.id}));
  expect((await pdfText(preview.bytes)).text).toContain('PREVIEW - NOT A FINAL REPORT');
  const key=randomUUID();
  const fin=await f.run(t=>finalizeReports(t,f.u.certifier,deps,{
    idempotencyKey:key,defaults:{reportedBy:f.u.staff.id,approvedBy:f.u.certifier.id},
    release:true,releaseConfirmations:{reportContentVerified:true,identityAndValuesMatchReport:true,disclosureReviewed:true,abnormalAcknowledged:true,benchMeasurementsReviewed:true},
    items:[{rowId:row.id}]
  }));
  console.log('EQA_NATIVE_FINAL_OUTCOME',JSON.stringify(fin.items));
  expect(fin.items[0]).toMatchObject({outcome:'FINAL',versionState:'CertifiedReleased',release:'CertifiedReleased'});
  const ir=(await f.db.query<{pdf_sha256:string;download_name:string}>('SELECT pdf_sha256,download_name FROM internal_report WHERE attempt_id=$1',[eqa.attemptId])).rows[0];
  expect(ir.pdf_sha256).toMatch(/^[a-f0-9]{64}$/);
  const pdf=await f.store.get(ir.pdf_sha256),text=(await pdfText(pdf)).text;
  expect(createHash('sha256').update(pdf).digest('hex')).toBe(ir.pdf_sha256);
  expect(text).toContain('SYNTHETIC ORGANIZER PATIENT');
  expect(text).toContain(eqa.printed);
  expect(text).not.toMatch(/\bEQA\b/i);
  const rel=(await f.db.query<{id:string}>('SELECT id FROM result_release WHERE case_id=$1 AND state=$2',[eqa.caseId,'Active'])).rows[0];
  expect(rel?.id).toBeTruthy();
  expect((await f.db.query("SELECT id FROM job_outbox WHERE kind='result_release_completed' AND payload->>'releaseId'=$1",[rel.id])).rows).toHaveLength(0);
  expect((await f.db.query("SELECT id FROM p6_transfer WHERE clinical_release_id=$1",[rel.id])).rows).toHaveLength(0);
  // Defense in depth: an attacker/old worker replay cannot enqueue or reserve
  // a certified EQA release for HIS even if the UI never offered that action.
  await expect(f.db.query(
   "INSERT INTO job_outbox(kind,payload,idempotency_key) VALUES('result_release_completed',$1,$2)",
   [JSON.stringify({releaseId:rel.id}),'eqa-forged-release-'+randomUUID()]
  )).rejects.toThrow('EQA_HIS_OUTBOUND_PROHIBITED');
  await expect(f.db.query(
   'INSERT INTO p6_transfer(clinical_release_id) VALUES($1)',[rel.id]
  )).rejects.toThrow('EQA_HIS_OUTBOUND_PROHIBITED');
  const again=await f.run(t=>finalizeReports(t,f.u.certifier,deps,{idempotencyKey:key,items:[{rowId:row.id}]}));
  expect(again.replayed).toBe(true);
 }finally{vi.unstubAllEnvs();await f.close();}
},600000);
