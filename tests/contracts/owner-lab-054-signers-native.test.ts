import {it,expect,vi} from 'vitest';
import {randomUUID,createHash} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {task3Fixture,halosWorkbook,signerSetup,approveInterpretation,recordPaperRequest,masters} from '../helpers/task3';
import {previewHalosImport,decideHalosImport} from '../../packages/readygen/halos-import';
import {finalizeReports} from '../../packages/readygen/reports';
import {grantDelegation} from '../../packages/readygen/signers';
import {syntheticSignaturePng} from '../helpers/signature-png';
import {analyzeSignerBlocks} from '../helpers/pdf-signer-blocks';

// OWNER-LAB-054 (Owner 2026-10-26, file 14): the GENERATED FINAL native PDF itself must show name, professional licence number and the stored
// signature IMAGE in BOTH the Reported-by and Approved-by blocks - for two different signers and for one person chosen twice.
// Native (Microsoft Word); synthetic identities/signatures only. Set OWNER054_OUT to keep the PDFs for visual review.
it('054: final native PDF shows name + licence + signature image in each signer block (two signers; one person twice)',async()=>{
 const f=await task3Fixture();try{
  const deps={store:f.store,templates:masters()},[a,b]=f.cases;
  const bytes=halosWorkbook({result:[{sample:a.printed,ff:'14.7',gender:'Female'},{sample:b.printed,ff:'11.2',gender:'Female'}],sampleinfo:f.cases.map(x=>({id:x.vendorId,fetus:x.pregnancy,ga:'17,6'}))});
  const imp=await f.run(t=>previewHalosImport(t,f.u.staff,f.store,{name:'Sample analysis data_S990000001_10262026.xlsx',bytes}));
  await f.run(t=>decideHalosImport(t,f.u.staff,{importId:imp.id,decision:'CONFIRM',expectedRowVersion:imp.rowVersion}));
  const rowOf=(s:string)=>imp.rows.find(r=>r.sheet==='result'&&r.sampleKey===s)!.id;
  const sig=await signerSetup(f);
  await approveInterpretation(f,{interpretationApproved:true,singletonApprovedProduct:'HNZ0011',twinApprovedProduct:'HNZ0011',approvalReference:'SYNTHETIC-CLINICAL-APPROVAL-054'});
  for(const x of [a,b])await recordPaperRequest(f,x,'Want');
  const issue=async(row:string,reportedBy:string,approvedBy:string)=>{
   const r=await f.run(t=>finalizeReports(t,f.u.certifier,deps,{idempotencyKey:randomUUID(),defaults:{reportedBy,approvedBy},items:[{rowId:row}]}));
   expect(r.items[0].outcome).toBe('FINAL');
   const ir=(await f.db.query<{pdf_sha256:string;reported_by:string;approved_by:string}>('SELECT * FROM internal_report WHERE attempt_id=(SELECT attempt_id FROM halos_import_row WHERE id=$1)',[row])).rows[0];
   return {ir,pdf:await f.store.get(ir.pdf_sha256)};};
  // Selection is an active user action: no signer chosen -> refused, nothing generated (no invented default, no blank block).
  const none=await f.run(t=>finalizeReports(t,f.u.certifier,deps,{idempotencyKey:randomUUID(),defaults:{reportedBy:null,approvedBy:f.u.certifier.id},items:[{rowId:rowOf(a.printed)}]}));
  expect(none.items[0]).toMatchObject({outcome:'ERROR',code:'REPORTED_BY_REQUIRED'});
  // Case 1: two different authorised people. Reporter signs through the standing delegation to the issuing operator.
  const one=await issue(rowOf(a.printed),f.u.staff.id,f.u.certifier.id);
  // Case 2: the same authorised person chosen for both positions.
  const two=await issue(rowOf(b.printed),f.u.certifier.id,f.u.certifier.id);
  const reporterPng=syntheticSignaturePng(1),approverPng=syntheticSignaturePng(2);
  const out=process.env.OWNER054_OUT;if(out){mkdirSync(out,{recursive:true});writeFileSync(`${out}/final-two-signers.pdf`,one.pdf);writeFileSync(`${out}/final-same-signer.pdf`,two.pdf);writeFileSync(`${out}/sig-reporter.png`,reporterPng);writeFileSync(`${out}/sig-approver.png`,approverPng);}
  expect(createHash('sha256').update(one.pdf).digest('hex')).toBe(one.ir.pdf_sha256);
  const A=await analyzeSignerBlocks(one.pdf);
  expect(A.reported).toMatchObject({name:'Synthetic Reporter',license:'99001'});expect(A.approved).toMatchObject({name:'Synthetic Approver',license:'99002'});
  expect(A.reported.signature).toBeTruthy();expect(A.approved.signature).toBeTruthy();
  expect(A.reported.signature!.matches).toBe('reporter');expect(A.approved.signature!.matches).toBe('approver');
  // Identity is never cross-assigned.
  expect(A.reported.signature!.region).not.toEqual(A.approved.signature!.region);
  const B=await analyzeSignerBlocks(two.pdf);
  expect(B.reported).toMatchObject({name:'Synthetic Approver',license:'99002'});expect(B.approved).toMatchObject({name:'Synthetic Approver',license:'99002'});
  expect(B.reported.signature!.matches).toBe('approver');expect(B.approved.signature!.matches).toBe('approver');
  if(out)writeFileSync(`${out}/analysis.json`,JSON.stringify({twoSigners:A,sameSigner:B},null,1));
  // Signer identity is bound to the frozen report row and audited.
  expect(one.ir).toMatchObject({reported_by:f.u.staff.id,approved_by:f.u.certifier.id});expect(two.ir).toMatchObject({reported_by:f.u.certifier.id,approved_by:f.u.certifier.id});
  expect((await f.db.query("SELECT 1 FROM audit_chain WHERE action='INTERNAL_REPORT_FINALIZED'")).rows.length).toBeGreaterThanOrEqual(2);
  void sig;
 }finally{vi.unstubAllEnvs();await f.close();}
},600000);

// Owner decision 2026-11-01 (single APP_ADMIN): the administrator operates the report and selects Reported By and Approved By in ONE
// session. Each named person's own verified profile and own standing delegation to the administrator is the evidence; the operator
// stays recorded as the administrator, separately from the two personnel. Without a person's delegation nothing is generated.
it('single APP_ADMIN: one session, two named personnel, operator recorded separately; native PDF shows both signers',async()=>{
 const f=await task3Fixture();try{
  const deps={store:f.store,templates:masters()},[a,b]=f.cases;
  const bytes=halosWorkbook({result:[{sample:a.printed,ff:'14.7',gender:'Female'},{sample:b.printed,ff:'11.2',gender:'Female'}],sampleinfo:f.cases.map(x=>({id:x.vendorId,fetus:x.pregnancy,ga:'17,6'}))});
  const imp=await f.run(t=>previewHalosImport(t,f.u.staff,f.store,{name:'Sample analysis data_S990000001_10262026.xlsx',bytes}));
  await f.run(t=>decideHalosImport(t,f.u.staff,{importId:imp.id,decision:'CONFIRM',expectedRowVersion:imp.rowVersion}));
  const rowOf=(s:string)=>imp.rows.find(r=>r.sheet==='result'&&r.sampleKey===s)!.id;
  await signerSetup(f);
  await approveInterpretation(f,{interpretationApproved:true,singletonApprovedProduct:'HNZ0011',twinApprovedProduct:'HNZ0011',approvalReference:'SYNTHETIC-CLINICAL-APPROVAL-SINGLE-ADMIN'});
  for(const x of [a,b])await recordPaperRequest(f,x,'Want');
  const finalize=(row:string)=>f.run(t=>finalizeReports(t,f.admin,deps,{idempotencyKey:randomUUID(),defaults:{reportedBy:f.u.staff.id,approvedBy:f.u.certifier.id},items:[{rowId:row}]}));
  // only the reporter has authorised the administrator so far: the approver's name alone is not evidence -> refused, nothing generated
  await f.run(t=>grantDelegation(t,f.u.staff,{granteeId:f.admin.id,roles:['REPORTED'],authorityReference:'SYNTHETIC-SOP-NIPT-SIGNATURE-01'}));
  const refused=await finalize(rowOf(a.printed));
  expect(refused.items[0]).toMatchObject({outcome:'ERROR',code:'SIGNATURE_DELEGATION_REQUIRED'});
  expect((await f.db.query('SELECT 1 FROM internal_report')).rows).toEqual([]);
  await f.run(t=>grantDelegation(t,f.u.certifier,{granteeId:f.admin.id,roles:['APPROVED'],authorityReference:'SYNTHETIC-SOP-NIPT-SIGNATURE-01'}));
  const done=await finalize(rowOf(a.printed));expect(done.items[0].outcome).toBe('FINAL');
  const ir=(await f.db.query<{pdf_sha256:string;operator_id:string;reported_by:string;approved_by:string;reported_authority:{basis:string;operatorId:string;authorityReference:string};approved_authority:{basis:string;operatorId:string};reported_at:Date;approved_at:Date}>('SELECT * FROM internal_report WHERE attempt_id=(SELECT attempt_id FROM halos_import_row WHERE id=$1)',[rowOf(a.printed)])).rows[0];
  expect(ir).toMatchObject({operator_id:f.admin.id,reported_by:f.u.staff.id,approved_by:f.u.certifier.id});
  expect(ir.reported_authority).toMatchObject({basis:'STANDING_DELEGATION',operatorId:f.admin.id,authorityReference:'SYNTHETIC-SOP-NIPT-SIGNATURE-01'});
  expect(ir.approved_authority).toMatchObject({basis:'STANDING_DELEGATION',operatorId:f.admin.id});
  expect(ir.reported_at).toBeTruthy();expect(ir.approved_at).toBeTruthy();
  const pdf=await f.store.get(ir.pdf_sha256),A=await analyzeSignerBlocks(pdf);
  const out=process.env.OWNER054_OUT;if(out){mkdirSync(out,{recursive:true});writeFileSync(`${out}/final-single-admin-operator.pdf`,pdf);writeFileSync(`${out}/single-admin-analysis.json`,JSON.stringify(A,null,1));}
  expect(A.reported).toMatchObject({name:'Synthetic Reporter',license:'99001'});expect(A.approved).toMatchObject({name:'Synthetic Approver',license:'99002'});
  expect(A.reported.signature!.matches).toBe('reporter');expect(A.approved.signature!.matches).toBe('approver');
  // the administrator's own name is never printed as a signer; the audit trail names the administrator as the actor
  expect(JSON.stringify(A)).not.toContain('synthetic.task3.admin');
  expect((await f.db.query("SELECT 1 FROM audit_chain WHERE action='INTERNAL_REPORT_FINALIZED' AND actor_id=$1",[f.admin.id])).rows.length).toBe(1);
 }finally{vi.unstubAllEnvs();await f.close();}
},600000);
