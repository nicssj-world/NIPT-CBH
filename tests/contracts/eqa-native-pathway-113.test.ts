import {it,expect,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {task3Fixture,halosWorkbook,signerSetup,approveInterpretation,recordPaperRequest,masters} from '../helpers/task3';
import {previewHalosImport,decideHalosImport} from '../../packages/readygen/halos-import';
import {reportCandidate,finalizeReports} from '../../packages/readygen/reports';
import {pdfText} from '../../packages/results/extract';

// Native: renders through the installed Microsoft Word like the normal pathway. One Run holds two EQA specimens (singleton and
// DCDA twins, from the GenQA/EMQN 2026 referral cards) and one ordinary patient. EQA uses the normal engine end to end.
it('EQA follows the normal report pathway (no PET, no patient consent) and never reaches HIS; the patient in the same Run still does',async()=>{
 const f=await task3Fixture([
  {ln:'9900099601',hn:'03NIPT26',pregnancy:'Singleton',sheet:1,eqa:{surname:'POLSON',firstName:'Tonya',dob:'1988-08-23'}},
  {ln:'9900099602',hn:'9900099962',pregnancy:'Singleton',sheet:2},
  {ln:'9900099603',hn:'07NIPT26',pregnancy:'Twins',sheet:3,eqa:{surname:'ESPOSITO',firstName:'Alessia',dob:'1985-02-21'}}]);
 try{
  const deps={store:f.store,templates:masters()};
  const [eqaS,patient,eqaT]=f.cases,[pc,nc]=f.controls;
  const bytes=halosWorkbook({result:[{sample:pc,t13:'TH13',t18:'TH18',t21:'TH21',sex:''},{sample:eqaS.printed,ff:'14.7',gender:'Female'},{sample:patient.printed,ff:'9.6',gender:'Male'},{sample:eqaT.printed,gender:'Male',ff:'11.25'},{sample:nc,sex:''}],
   sampleinfo:f.cases.map(x=>({id:x.vendorId,fetus:x.pregnancy,ga:'17,6'}))});
  const imp=await f.run(t=>previewHalosImport(t,f.u.staff,f.store,{name:'Sample analysis data_S990000001_10242026.xlsx',bytes}));
  await f.run(t=>decideHalosImport(t,f.u.staff,{importId:imp.id,decision:'CONFIRM',expectedRowVersion:imp.rowVersion}));
  const rowOf=(s:string)=>imp.rows.find(r=>r.sheet==='result'&&r.sampleKey===s)!.id;
  await signerSetup(f);
  await approveInterpretation(f,{interpretationApproved:true,singletonApprovedProduct:'HNZ0011',twinApprovedProduct:'HNZ0011',approvalReference:'SYNTHETIC-CLINICAL-APPROVAL-01'});
  await recordPaperRequest(f,patient,'Want');
  // The EQA candidate has no PET/EDD/consent holds: the card supplies identity, GA and the reporting option.
  const cand=await f.run(t=>reportCandidate(t,f.u.certifier,deps,{rowId:rowOf(eqaS.printed)}));
  expect(cand.holds).toEqual([]);expect(cand.eligible).toBe(true);expect(cand.values).toMatchObject({patientName:'Tonya POLSON',hn:'03NIPT26',patientIDCard:'-',ga:'17W 6D',dob_cbh:expect.stringContaining('1988')});
  const fin=await f.run(t=>finalizeReports(t,f.u.certifier,deps,{idempotencyKey:randomUUID(),defaults:{reportedBy:f.u.staff.id,approvedBy:f.u.certifier.id},release:true,
   releaseConfirmations:{reportContentVerified:true,identityAndValuesMatchReport:true,disclosureReviewed:true,abnormalAcknowledged:true,benchMeasurementsReviewed:true},
   items:[{rowId:rowOf(eqaS.printed)},{rowId:rowOf(patient.printed)},{rowId:rowOf(eqaT.printed)}]}));
  const out=Object.fromEntries(fin.items.map(i=>[i.rowId,i]));
  expect(out[rowOf(eqaS.printed)]).toMatchObject({outcome:'FINAL',versionState:'CertifiedReleased',release:'CertifiedReleased'});
  expect(out[rowOf(eqaT.printed)]).toMatchObject({outcome:'FINAL',versionState:'CertifiedReleased'});
  expect(out[rowOf(patient.printed)]).toMatchObject({outcome:'FINAL',versionState:'CertifiedReleased'});
  // One authoritative certified PDF per EQA case, produced by the normal engine, with the card's identity and no EQA mark.
  for(const [c,name,hn] of [[eqaS,'Tonya POLSON','03NIPT26'],[eqaT,'Alessia ESPOSITO','07NIPT26']] as const){
   const ir=(await f.db.query<{pdf_sha256:string}>('SELECT pdf_sha256 FROM internal_report WHERE attempt_id=$1',[c.attemptId])).rows[0];
   const text=(await pdfText(await f.store.get(ir.pdf_sha256))).text;
   expect(text).toContain(name);expect(text).toContain(hn);expect(text).toContain(c.printed);expect(text).toContain('17W 6D');
   expect(text).not.toMatch(/EQA|GenQA|EMQN|\$\{/i);
  }
  // No-HIS: the EQA releases exist internally but nothing is queued, reserved or eligible; the patient's release is queued once.
  const rel=async(caseId:string)=>(await f.db.query<{id:string;epoch:number}>("SELECT id,epoch FROM result_release WHERE case_id=$1 AND state='Active'",[caseId])).rows[0];
  for(const c of [eqaS,eqaT]){
   const r=await rel(c.caseId);expect(r).toBeDefined();
   expect((await f.db.query("SELECT 1 FROM job_outbox WHERE payload->>'releaseId'=$1",[r.id])).rows).toHaveLength(0);
   expect((await f.db.query('SELECT 1 FROM p6_transfer WHERE clinical_release_id=$1',[r.id])).rows).toHaveLength(0);
   expect((await f.db.query<{ok:boolean}>('SELECT p6_release_eligible($1,$2) ok',[r.id,r.epoch])).rows[0].ok).toBe(false);
   await expect(f.db.query("INSERT INTO job_outbox(kind,payload,idempotency_key) VALUES('result_release_completed',$1,$2)",[JSON.stringify({releaseId:r.id}),randomUUID()])).rejects.toThrow(/EQA_NO_HIS_OUTBOUND/);
  }
  const pr=await rel(patient.caseId);
  expect((await f.db.query("SELECT 1 FROM job_outbox WHERE kind='result_release_completed' AND payload->>'releaseId'=$1",[pr.id])).rows).toHaveLength(1);
  expect((await f.db.query<{ok:boolean}>('SELECT p6_release_eligible($1,$2) ok',[pr.id,pr.epoch])).rows[0].ok).toBe(true);
  // Never archived to the patient NAS archive.
  expect((await f.db.query('SELECT 1 FROM pdf_archive_job j JOIN eqa_case e ON e.case_id=j.case_id')).rows).toHaveLength(0);
 }finally{vi.unstubAllEnvs();await f.close();}
},900000);
