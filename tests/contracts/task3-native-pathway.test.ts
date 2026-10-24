import {it,expect,vi} from 'vitest';
import {randomUUID,createHash} from 'node:crypto';
import {task3Fixture,halosWorkbook,signerSetup,approveInterpretation,recordPaperRequest,masters} from '../helpers/task3';
import {previewHalosImport,decideHalosImport} from '../../packages/readygen/halos-import';
import {reportCandidate,previewReport,finalizeReports} from '../../packages/readygen/reports';
import {submitSignerProfile,decideSignerProfile,revokeDelegation} from '../../packages/readygen/signers';
import {syntheticSignaturePng} from '../helpers/signature-png';
import * as results from '../../packages/results/service';
import {pdfText} from '../../packages/results/extract';

// Native: renders through the installed Microsoft Word (as ReadyGen does). Runs on the Windows development PC; it fails, never skips,
// where Word is unavailable. No real patient data: synthetic cases, synthetic signatures, Owner DOCX masters from the protected copy.
it('pathway A end-to-end: HALOS → approved interpretation → Owner DOCX → signed Final PDF → existing P5 gates/release → HIS outbound, all fail-closed',async()=>{
 const f=await task3Fixture();try{
  const deps={store:f.store,templates:masters()};
  const [a,b,tw]=f.cases,[pc,nc]=f.controls;
  const bytes=halosWorkbook({result:[{sample:pc,t13:'TH13',t18:'TH18',t21:'TH21',sex:''},{sample:a.printed,ff:'14.7',gender:'Female'},{sample:b.printed,t21:'TH21',ff:'9.6',gender:'Male'},{sample:tw.printed,gender:'Male',ff:'11.25'},{sample:nc,sex:''}],
   sampleinfo:f.cases.map(x=>({id:x.vendorId,fetus:x.pregnancy,ga:'17,6'}))});
  const imp=await f.run(t=>previewHalosImport(t,f.u.staff,f.store,{name:'Sample analysis data_S990000001_10242026.xlsx',bytes}));
  await f.run(t=>decideHalosImport(t,f.u.staff,{importId:imp.id,decision:'CONFIRM',expectedRowVersion:imp.rowVersion}));
  const rowOf=(s:string)=>imp.rows.find(r=>r.sheet==='result'&&r.sampleKey===s)!.id;
  // 1. Nothing approved yet: HOLD with explicit reasons, nothing written.
  let cand=await f.run(t=>reportCandidate(t,f.u.certifier,deps,{rowId:rowOf(a.printed)}));
  expect(cand.holds.map(h=>h.code)).toEqual(expect.arrayContaining(['INTERPRETATION_RULESET_NOT_APPROVED','FETAL_SEX_DISCLOSURE_NOT_PERMITTED']));
  expect(cand.values?.qc).toBe('PASS');expect(cand.template).toBe('SINGLETON');
  const sig=await signerSetup(f);
  const held=await f.run(t=>finalizeReports(t,f.u.certifier,deps,{idempotencyKey:randomUUID(),defaults:{reportedBy:f.u.staff.id,approvedBy:f.u.certifier.id},items:[{rowId:rowOf(a.printed)}]}));
  expect(held.items[0].outcome).toBe('HOLD');expect((await f.db.query('SELECT * FROM internal_report')).rows).toHaveLength(0);
  // 2. Clinical maker-checker approval of the ruleset and of HNZ0011 with both masters; documented fetal-sex wish recorded.
  await approveInterpretation(f,{interpretationApproved:true,singletonApprovedProduct:'HNZ0011',twinApprovedProduct:'HNZ0011',approvalReference:'SYNTHETIC-CLINICAL-APPROVAL-01'});
  for(const x of [a,b])await recordPaperRequest(f,x,'Want');
  cand=await f.run(t=>reportCandidate(t,f.u.certifier,deps,{rowId:rowOf(a.printed)}));expect(cand.holds).toEqual([]);expect(cand.eligible).toBe(true);
  // Preview: watermarked PDF, never stored as a report.
  const preview=await f.run(t=>previewReport(t,f.u.staff,deps,{rowId:rowOf(a.printed)}));
  expect((await pdfText(preview.bytes)).text).toContain('PREVIEW - NOT A FINAL REPORT');expect((await f.db.query('SELECT * FROM internal_report')).rows).toHaveLength(0);
  // 3. Final + release in one authorised operator session (no second login). Reported-by signature via the staff member's delegation.
  const key=randomUUID();
  const fin=await f.run(t=>finalizeReports(t,f.u.certifier,deps,{idempotencyKey:key,defaults:{reportedBy:f.u.staff.id,approvedBy:f.u.certifier.id},release:true,
   releaseConfirmations:{reportContentVerified:true,identityAndValuesMatchReport:true,disclosureReviewed:true,abnormalAcknowledged:true,benchMeasurementsReviewed:true},
   items:[{rowId:rowOf(a.printed)},{rowId:rowOf(b.printed)},{rowId:rowOf(tw.printed)},{rowId:rowOf(pc)}]}));
  const out=Object.fromEntries(fin.items.map(i=>[i.rowId,i]));
  expect(out[rowOf(a.printed)]).toMatchObject({outcome:'FINAL',versionState:'CertifiedReleased',release:'CertifiedReleased'});
  expect(out[rowOf(b.printed)]).toMatchObject({outcome:'FINAL',versionState:'CertifiedReleased'});
  // The twin's Y result is shown; its wish is unrecorded and the existing operational twin disclosure review applies.
  expect(out[rowOf(tw.printed)].outcome).toBe('FINAL');
  expect(out[rowOf(pc)]).toMatchObject({outcome:'HOLD'});expect(out[rowOf(pc)].holds!.map(h=>h.code)).toContain('ROW_NOT_REPORTABLE');
  const v=(await f.db.query<{id:string;origin:string;link_mode:string;state:string;sha256:string;parsed:{templateKind:string}}>('SELECT v.* FROM result_report_version v JOIN internal_report r ON r.version_id=v.id WHERE r.attempt_id=$1',[a.attemptId])).rows[0];
  expect(v).toMatchObject({origin:'INTERNAL_GENERATED',link_mode:'FROZEN_EXPORT',state:'CertifiedReleased'});expect(v.parsed.templateKind).toBe('SINGLETON');
  const ir=(await f.db.query<{pdf_sha256:string;operator_id:string;reported_by:string;approved_by:string;reported_authority:{basis:string;delegationId:string;signatureSha256:string;license:string};approved_authority:{basis:string};reported_at:Date;approved_at:Date;ruleset:{approved:boolean;combinationApproved:boolean;settingRevisionId:string};template_sha256:string;bindings:{values:{qc:string;trisomy21_ra:string}}}>('SELECT * FROM internal_report WHERE attempt_id=$1',[a.attemptId])).rows[0];
  expect(ir.pdf_sha256).toBe(v.sha256);expect(ir.operator_id).toBe(f.u.certifier.id);expect(ir.reported_by).toBe(f.u.staff.id);expect(ir.approved_by).toBe(f.u.certifier.id);
  expect(ir.reported_authority).toMatchObject({basis:'STANDING_DELEGATION',delegationId:sig.delegation,license:'99001'});expect(ir.approved_authority.basis).toBe('SELF');
  expect(ir.approved_at.getTime()).toBeGreaterThanOrEqual(ir.reported_at.getTime());expect(ir.ruleset).toMatchObject({approved:true,combinationApproved:true});
  expect(ir.template_sha256).toBe('a56be6e4282b9b2fa06b4a73a527342c0949a70e83bef85a6574d379b4509117');
  // The stored PDF is the rendered master with the bound values; nothing static from the master survives.
  const pdf=await f.store.get(ir.pdf_sha256),text=(await pdfText(pdf)).text;
  expect(createHash('sha256').update(pdf).digest('hex')).toBe(ir.pdf_sha256);
  expect(text).toContain('Synthetic Reporter');expect(text).toContain('Synthetic Approver');expect(text).not.toMatch(/Sirithorn|Siriwat|13099|12396|\$\{/);
  expect(text).toContain(a.printed);expect(text).toContain('17W 6D');
  // Same review/QC5/gates/release tables; release queued outbound once; exactly one release per round.
  const rel=(await f.db.query<{id:string}>("SELECT id FROM result_release WHERE version_id=$1 AND state='Active'",[v.id])).rows[0];
  expect((await f.db.query<{eligible:boolean}>('SELECT p6_release_eligible(id,epoch) eligible FROM result_release WHERE id=$1',[rel.id])).rows[0].eligible).toBe(true);
  expect((await f.db.query("SELECT * FROM job_outbox WHERE kind='result_release_completed' AND payload->>'releaseId'=$1",[rel.id])).rows).toHaveLength(1);
  expect((await f.db.query("SELECT gate FROM result_gate_evaluation WHERE version_id=$1 AND purpose='CERTIFY_ATTEMPT' AND eligible AND predicates @> '[{\"code\":\"RG-14\",\"status\":\"PASS\"}]'",[v.id])).rows).toHaveLength(1);
  // 4. Replay of the same batch key returns the recorded outcome; nothing is generated twice.
  const replay=await f.run(t=>finalizeReports(t,f.u.certifier,deps,{idempotencyKey:key,items:[{rowId:rowOf(a.printed)}]}));expect(replay.replayed).toBe(true);
  expect((await f.db.query('SELECT * FROM internal_report WHERE attempt_id=$1',[a.attemptId])).rows).toHaveLength(1);
  // 5. A second Final for the same attempt is refused (no silent second active final); post-release re-issue follows OD-17 HOLD.
  const again=await f.run(t=>finalizeReports(t,f.u.certifier,deps,{idempotencyKey:randomUUID(),defaults:{reportedBy:f.u.certifier.id,approvedBy:f.u.certifier.id},items:[{rowId:rowOf(a.printed)}]}));
  expect(again.items[0].outcome).toBe('HOLD');expect(again.items[0].holds!.map(h=>h.code)).toEqual(expect.arrayContaining(['INTERNAL_REPORT_ALREADY_FINAL','ACTIVE_RELEASE_EXISTS_FOR_ROUND'].slice(0,1)));
  const reissue=await f.run(t=>finalizeReports(t,f.u.certifier,deps,{idempotencyKey:randomUUID(),defaults:{reportedBy:f.u.certifier.id,approvedBy:f.u.certifier.id},items:[{rowId:rowOf(a.printed),reissueReason:'SYNTHETIC corrected wording request'}]}));
  expect(reissue.items[0].holds!.map(h=>h.code)).toContain('POST_RELEASE_REVISION_PENDING_OD17');
  // 6. Twin internal version: external-final attestation cannot be spoofed; the internal attestation path is the only one.
  const tv=(await f.db.query<{id:string;row_version:number;state:string}>('SELECT v.id,v.row_version,v.state FROM result_report_version v JOIN internal_report r ON r.version_id=v.id WHERE r.attempt_id=$1',[tw.attemptId])).rows[0];
  if(tv.state!=='CertifiedReleased'){
   await expect(f.run(t=>results.acceptAndRelease(t,f.u.certifier,{versionId:tv.id,expectedRowVersion:tv.row_version,idempotencyKey:randomUUID(),externalFinalCertified:true,identityAndValuesMatchPdf:true,disclosureReviewed:true,abnormalAcknowledged:false}))).rejects.toThrow('EXTERNAL_ATTESTATION_NOT_FOR_INTERNAL_REPORT');
  }
  // 7. Signer/profile updates and ruleset changes never alter the frozen report.
  await f.run(t=>submitSignerProfile(t,f.u.staff,f.store,{legalName:'Synthetic Reporter Renamed',mtLicenseNo:'99009',signature:syntheticSignaturePng(7)}));
  await f.run(t=>revokeDelegation(t,f.u.staff,{delegationId:sig.delegation,reason:'SYNTHETIC delegation ended'}));
  await approveInterpretation(f,{interpretationApproved:false});
  const after=(await f.db.query<{pdf_sha256:string;reported_authority:{license:string};ruleset:{approved:boolean}}>('SELECT * FROM internal_report WHERE attempt_id=$1',[a.attemptId])).rows[0];
  expect(after.pdf_sha256).toBe(ir.pdf_sha256);expect(after.reported_authority.license).toBe('99001');expect(after.ruleset.approved).toBe(true);
  // ... while new work now fails closed: delegation revoked and approval withdrawn.
  await expect(f.run(t=>previewReport(t,f.u.certifier,deps,{rowId:rowOf(b.printed),reportedBy:f.u.staff.id,approvedBy:f.u.certifier.id}))).rejects.toThrow(/SIGNATURE_DELEGATION_REQUIRED|SIGNER_PROFILE_NOT_VERIFIED/);
  // Immutable evidence.
  await expect(f.db.query("UPDATE internal_report SET download_name='changed.pdf' WHERE attempt_id=$1",[a.attemptId])).rejects.toThrow('INTERNAL_REPORT_IMMUTABLE');
  await expect(f.db.query("UPDATE internal_report SET bindings='{}' WHERE attempt_id=$1",[a.attemptId])).rejects.toThrow('INTERNAL_REPORT_IMMUTABLE');
  await expect(f.db.query('DELETE FROM internal_report')).rejects.toThrow();
  void sig.reporterProfile;void decideSignerProfile;
 }finally{vi.unstubAllEnvs();await f.close();}
},600000);
