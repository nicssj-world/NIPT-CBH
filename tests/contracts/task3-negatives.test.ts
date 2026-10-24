import {it,expect} from 'vitest';
import {randomUUID,createHash} from 'node:crypto';
import {task3Fixture,halosWorkbook,signerSetup,approveInterpretation,recordPaperRequest,masters} from '../helpers/task3';
import {labUsers} from '../helpers/lab';
import {previewHalosImport,decideHalosImport} from '../../packages/readygen/halos-import';
import {reportCandidate,previewReport,finalizeReports} from '../../packages/readygen/reports';
import {submitSignerProfile,decideSignerProfile,grantDelegation,revokeDelegation,signerAuthority} from '../../packages/readygen/signers';
import {syntheticSignaturePng} from '../helpers/signature-png';
import * as results from '../../packages/results/service';
import type {Principal} from '../../packages/security/policy';

// Native (Microsoft Word). Fail-closed paths of Task 3 that the main pathway test does not reach: product/template approval,
// signer eligibility, revocation, expiry and delegation scope, stale sessions, idempotency reuse, twin Y disclosure review (RG-11),
// pre-release re-issue, and "มีผลใน HIS แล้ว" withdrawal queueing delivery exactly once.
it('Task 3 negatives: product, signer authority, session, idempotency, twin RG-11, re-issue and HIS attestation withdrawal',async()=>{
 const f=await task3Fixture();try{
  const deps={store:f.store,templates:masters()},[a,b,tw]=f.cases,cert=f.u.certifier;
  const bytes=halosWorkbook({result:[{sample:a.printed,gender:'Female'},{sample:b.printed,gender:'Female'},{sample:tw.printed,gender:'Male'}],sampleinfo:f.cases.map(x=>({id:x.vendorId,fetus:x.pregnancy,ga:'17,6'}))});
  const imp=await f.run(t=>previewHalosImport(t,f.u.staff,f.store,{name:'Sample analysis data_S990000001_NEG.xlsx',bytes}));
  await f.run(t=>decideHalosImport(t,f.u.staff,{importId:imp.id,decision:'CONFIRM',expectedRowVersion:imp.rowVersion}));
  const rowOf=(s:string)=>imp.rows.find(r=>r.sheet==='result'&&r.sampleKey===s)!.id;
  for(const x of [a,b])await recordPaperRequest(f,x,'Want');

  // 1. Product/template: the HALOS product HNZ0011 against an approval naming only HNZ0051 holds (T3-05-08).
  await approveInterpretation(f,{interpretationApproved:true,singletonApprovedProduct:'HNZ0051',twinApprovedProduct:'HNZ0051',approvalReference:'SYNTHETIC-CLINICAL-APPROVAL-NEG'});
  const wrong=await f.run(t=>reportCandidate(t,cert,deps,{rowId:rowOf(a.printed)}));
  expect(wrong.holds).toEqual([{code:'PRODUCT_TEMPLATE_COMBINATION_NOT_APPROVED',raw:'HNZ0011/FM-WI-T-BM-17-07'}]);
  await approveInterpretation(f,{interpretationApproved:true,singletonApprovedProduct:'HNZ0011',twinApprovedProduct:'HNZ0011',approvalReference:'SYNTHETIC-CLINICAL-APPROVAL-NEG'});

  // 2. Signer eligibility and profiles (T3-06-01/07).
  await expect(f.run(t=>signerAuthority(t,cert,f.u.anc.id,'REPORTED'))).rejects.toThrow('SIGNER_NOT_ELIGIBLE');
  await expect(f.run(t=>submitSignerProfile(t,f.u.anc,f.store,{legalName:'Synthetic Nurse',mtLicenseNo:'99100',signature:syntheticSignaturePng(9)}))).rejects.toThrow('SIGNER_ROLE_REQUIRED');
  await expect(f.run(t=>submitSignerProfile(t,f.u.staff,f.store,{legalName:'Synthetic Reporter',mtLicenseNo:'99001',signature:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')}))).rejects.toThrow('SIGNATURE_IMAGE_FORMAT_INVALID');
  await expect(f.run(t=>submitSignerProfile(t,f.u.staff,f.store,{legalName:'Synthetic Reporter',mtLicenseNo:'MT-1',signature:syntheticSignaturePng(1)}))).rejects.toThrow();
  const pending=await f.run(t=>submitSignerProfile(t,f.u.staff,f.store,{legalName:'Synthetic Reporter',mtLicenseNo:'99001',signature:syntheticSignaturePng(1)}));
  await expect(f.run(t=>decideSignerProfile(t,f.u.staff,{profileId:pending.id,decision:'VERIFY',reason:'SYNTHETIC self verification attempt'}))).rejects.toThrow('FORBIDDEN');
  await expect(f.run(t=>signerAuthority(t,f.u.staff,f.u.staff.id,'REPORTED'))).rejects.toThrow('SIGNER_PROFILE_NOT_VERIFIED');
  const sig=await signerSetup(f);
  // Another person's stored signature needs a standing delegation for that role; none exists the other way round.
  await expect(f.run(t=>signerAuthority(t,f.u.staff,cert.id,'APPROVED'))).rejects.toThrow();
  expect((await f.run(t=>signerAuthority(t,cert,f.u.staff.id,'REPORTED'))).basis).toBe('STANDING_DELEGATION');
  await f.run(t=>revokeDelegation(t,f.u.staff,{delegationId:sig.delegation,reason:'SYNTHETIC delegation ended'}));
  await expect(f.run(t=>signerAuthority(t,cert,f.u.staff.id,'REPORTED'))).rejects.toThrow('SIGNATURE_DELEGATION_REQUIRED');
  const revoked=await f.run(t=>finalizeReports(t,cert,deps,{idempotencyKey:randomUUID(),defaults:{reportedBy:f.u.staff.id,approvedBy:cert.id},items:[{rowId:rowOf(a.printed)}]}));
  expect(revoked.items[0]).toMatchObject({outcome:'ERROR',code:'SIGNATURE_DELEGATION_REQUIRED'});expect((await f.db.query('SELECT 1 FROM internal_report')).rows).toHaveLength(0);
  // Expired delegation: valid for a moment only.
  await f.run(t=>grantDelegation(t,f.u.staff,{granteeId:cert.id,roles:['REPORTED'],authorityReference:'SYNTHETIC-SOP-SHORT-01',expiresAt:new Date(Date.now()+1500).toISOString()}));
  expect((await f.run(t=>signerAuthority(t,cert,f.u.staff.id,'REPORTED'))).basis).toBe('STANDING_DELEGATION');
  await new Promise(r=>setTimeout(r,2000));
  await expect(f.run(t=>signerAuthority(t,cert,f.u.staff.id,'REPORTED'))).rejects.toThrow('SIGNATURE_DELEGATION_REQUIRED');
  // A revoked own profile stops the signer until a new profile is verified by a second person.
  const certProfile=(await f.db.query<{id:string}>('SELECT id FROM report_signer_profile WHERE user_id=$1 AND task3_signer_profile_current(id)',[cert.id])).rows[0].id;
  await f.run(t=>decideSignerProfile(t,cert,{profileId:certProfile,decision:'REVOKE',reason:'SYNTHETIC signature withdrawn'}));
  await expect(f.run(t=>signerAuthority(t,cert,cert.id,'APPROVED'))).rejects.toThrow('SIGNER_PROFILE_NOT_VERIFIED');
  const again=await f.run(t=>submitSignerProfile(t,cert,f.store,{legalName:'Synthetic Approver',mtLicenseNo:'99002',signature:syntheticSignaturePng(2)}));
  await f.run(t=>decideSignerProfile(t,f.admin,{profileId:again.id,decision:'VERIFY',reason:'SYNTHETIC identity and licence checked again'}));
  await f.run(t=>grantDelegation(t,f.u.staff,{granteeId:cert.id,roles:['REPORTED'],authorityReference:'SYNTHETIC-SOP-NIPT-SIGNATURE-02'}));

  // 3. Stale session (revoked) refuses preview and Final; an idempotency key cannot be replayed by another operator.
  const sid=(await f.db.query<{id:string}>("INSERT INTO app_session(user_id,token_hash,csrf_hash,idle_expires_at,absolute_expires_at,revoked_at) VALUES($1,$2,$3,now()+interval '1 hour',now()+interval '2 hours',now()) RETURNING id",[cert.id,createHash('sha256').update(randomUUID()).digest('hex'),'c'.repeat(64)])).rows[0].id;
  const stale={...cert,sessionId:sid} as Principal;
  await expect(f.run(t=>previewReport(t,stale,deps,{rowId:rowOf(a.printed)}))).rejects.toThrow('UNAUTHENTICATED');
  await expect(f.run(t=>finalizeReports(t,stale,deps,{idempotencyKey:randomUUID(),defaults:{reportedBy:f.u.staff.id,approvedBy:cert.id},items:[{rowId:rowOf(a.printed)}]}))).rejects.toThrow('UNAUTHENTICATED');

  // 4. Final without release for all three; same key replayed by a second certifier is refused.
  const key=randomUUID();
  const fin=await f.run(t=>finalizeReports(t,cert,deps,{idempotencyKey:key,defaults:{reportedBy:f.u.staff.id,approvedBy:cert.id},items:[{rowId:rowOf(a.printed)},{rowId:rowOf(b.printed)},{rowId:rowOf(tw.printed)}]}));
  expect(fin.items.map(i=>i.outcome)).toEqual(['FINAL','FINAL','FINAL']);
  const other=(await labUsers(f.db,'neg2')).certifier;
  await expect(f.run(t=>finalizeReports(t,other,deps,{idempotencyKey:key,items:[{rowId:rowOf(a.printed)}]}))).rejects.toThrow('IDEMPOTENCY_KEY_REUSED');
  const ver=async(attemptId:string)=>(await f.db.query<{id:string;row_version:number;state:string}>("SELECT v.id,v.row_version,v.state FROM result_report_version v JOIN internal_report r ON r.version_id=v.id WHERE r.attempt_id=$1 AND r.state='Final'",[attemptId])).rows[0];
  const rg11=async(id:string,purpose:string)=>[...new Set((await f.db.query<{predicates:{code:string;status:string;reason:string}[]}>('SELECT predicates FROM result_gate_evaluation WHERE version_id=$1 AND purpose=$2',[id,purpose])).rows.map(r=>{const x=r.predicates.find(p=>p.code==='RG-11')!;return `${x.status}:${x.reason}`;}))];
  // 5. Twin Y disclosure (T3-05-06): no wish is recorded for twins; RG-11 stays PENDING until the authorised disclosure review at release.
  const tv=await ver(tw.attemptId);expect(tv.state).toBe('ValidationBlocked');
  expect(await rg11(tv.id,'VALIDATION')).toEqual(['PENDING:TWIN_Y_CHROMOSOME_DISCLOSURE_RULE']);
  const bench=(await f.db.query<{n:number}>('SELECT max(revision)::int n FROM task_workbook_revision WHERE batch_id=$1',[f.batchId])).rows[0].n;
  const accept=(v:{id:string;row_version:number})=>f.run(t=>results.acceptInternalAndRelease(t,cert,{versionId:v.id,expectedRowVersion:v.row_version,idempotencyKey:randomUUID(),reportContentVerified:true,identityAndValuesMatchReport:true,disclosureReviewed:true,abnormalAcknowledged:false,benchMeasurementsReviewed:true,benchRevision:bench}));
  expect((await accept(tv)).outcome).toBe('CertifiedReleased');
  expect(await rg11(tv.id,'CERTIFY_ATTEMPT')).toEqual(['PASS:TWIN_DISCLOSURE_REVIEWED']);
  // 6. Pre-release re-issue (T3-07-07): the earlier report is Superseded, never overwritten, and can no longer be released.
  const old=await ver(a.attemptId),oldInternal=(await f.db.query<{id:string;pdf_sha256:string}>("SELECT id,pdf_sha256 FROM internal_report WHERE attempt_id=$1 AND state='Final'",[a.attemptId])).rows[0];
  const re=await f.run(t=>finalizeReports(t,cert,deps,{idempotencyKey:randomUUID(),defaults:{reportedBy:f.u.staff.id,approvedBy:cert.id},items:[{rowId:rowOf(a.printed),reissueReason:'SYNTHETIC corrected referring doctor'}]}));
  expect(re.items[0].outcome).toBe('FINAL');
  const rows=(await f.db.query<{id:string;state:string;supersedes_id:string|null;pdf_sha256:string}>('SELECT id,state,supersedes_id,pdf_sha256 FROM internal_report WHERE attempt_id=$1 ORDER BY created_at',[a.attemptId])).rows;
  expect(rows.map(r=>r.state)).toEqual(['Superseded','Final']);expect(rows[1].supersedes_id).toBe(oldInternal.id);expect(rows[0].pdf_sha256).toBe(oldInternal.pdf_sha256);
  expect((await f.store.get(oldInternal.pdf_sha256)).length).toBeGreaterThan(1000);
  expect((await f.db.query<{ok:boolean}>('SELECT task3_internal_version_current($1) ok',[old.id])).rows[0].ok).toBe(false);
  await expect(accept(old)).rejects.toThrow('INTERNAL_REPORT_AUTHORITY_REQUIRED');
  // 7. "มีผลใน HIS แล้ว" before release: released without outbound; withdrawal queues delivery once; a second withdrawal is refused.
  const bv=await ver(b.attemptId);
  const att=await f.run(t=>results.attestHisPresence(t,f.u.staff,{versionId:bv.id,confirmed:true}));expect(att.effect).toBe('SUPPRESSED_BEFORE_RELEASE');
  await expect(f.run(t=>results.attestHisPresence(t,f.u.staff,{versionId:bv.id,confirmed:true}))).rejects.toThrow('HIS_ATTESTATION_EXISTS');
  expect((await accept(await ver(b.attemptId))).outcome).toBe('CertifiedReleased');
  const rel=(await f.db.query<{id:string}>("SELECT id FROM result_release WHERE version_id=$1 AND state='Active'",[bv.id])).rows[0];
  const jobs=async()=>(await f.db.query<{idempotency_key:string}>("SELECT idempotency_key FROM job_outbox WHERE kind='result_release_completed' AND payload->>'releaseId'=$1 AND state<>'Cancelled'",[rel.id])).rows;
  expect(await jobs()).toHaveLength(0);
  expect((await f.db.query("SELECT 1 FROM audit_chain WHERE action='RESULT_OUTBOUND_SUPPRESSED' AND resource_id=$1",[rel.id])).rows).toHaveLength(1);
  const w=await f.run(t=>results.withdrawHisAttestation(t,f.u.staff,{attestationId:att.id,reason:'SYNTHETIC HIS does not have it'}));expect(w.deliveryQueued).toBe(true);
  expect((await jobs()).map(j=>j.idempotency_key)).toEqual([`release:${rel.id}:attestation-withdrawn:${att.id}`]);
  await expect(f.run(t=>results.withdrawHisAttestation(t,f.u.staff,{attestationId:att.id,reason:'SYNTHETIC second withdrawal'}))).rejects.toThrow('HIS_ATTESTATION_ALREADY_WITHDRAWN');
  expect(await jobs()).toHaveLength(1);
  // ANC cannot attest HIS presence (no his.reconcile).
  await expect(f.run(t=>results.attestHisPresence(t,f.u.anc,{versionId:tv.id,confirmed:true}))).rejects.toThrow('FORBIDDEN');
 }finally{await f.close();}
},600_000);
