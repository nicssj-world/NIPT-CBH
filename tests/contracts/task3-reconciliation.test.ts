import {it,expect,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {task3Fixture,halosWorkbook,signerSetup,approveInterpretation,recordPaperRequest,masters} from '../helpers/task3';
import {previewHalosImport,decideHalosImport} from '../../packages/readygen/halos-import';
import {finalizeReports} from '../../packages/readygen/reports';
import * as results from '../../packages/results/service';
import {syntheticReportPdf} from '../../tools/his-simulator/result-pdf';

const accept={reportContentVerified:true as const,identityAndValuesMatchReport:true as const,disclosureReviewed:true as const,abnormalAcknowledged:true,benchMeasurementsReviewed:true as const};
// Native (Microsoft Word) — see task3-native-pathway.test.ts.
it('both pathways converge on one ledger: HIS-presence attestation suppresses outbound, external ReadyGen fallback imports, no duplicate finals, one ANC view',async()=>{
 const f=await task3Fixture();try{
  const deps={store:f.store,templates:masters()};const [a,b]=f.cases;
  const imp=await f.run(t=>previewHalosImport(t,f.u.staff,f.store,{name:'Sample analysis data_S990000002_10242026.xlsx',
   bytes:halosWorkbook({result:[{sample:a.printed,gender:'Female'},{sample:b.printed,gender:'Male'}],sampleinfo:f.cases.map(x=>({id:x.vendorId,fetus:x.pregnancy,ga:'17,6'}))})}));
  await f.run(t=>decideHalosImport(t,f.u.staff,{importId:imp.id,decision:'CONFIRM',expectedRowVersion:imp.rowVersion}));
  const rowOf=(s:string)=>imp.rows.find(r=>r.sheet==='result'&&r.sampleKey===s)!.id;
  await signerSetup(f);await approveInterpretation(f,{interpretationApproved:true,singletonApprovedProduct:'HNZ0011',twinApprovedProduct:'HNZ0011',approvalReference:'SYNTHETIC-CLINICAL-APPROVAL-02'});
  for(const x of [a,b])await recordPaperRequest(f,x,'Want');

  // A. Internal Final without release; HIS already holds the result (authorised attestation) → release without any outbound job.
  const fin=await f.run(t=>finalizeReports(t,f.u.certifier,deps,{idempotencyKey:randomUUID(),defaults:{reportedBy:f.u.staff.id,approvedBy:f.u.certifier.id},items:[{rowId:rowOf(a.printed)}]}));
  expect(fin.items[0]).toMatchObject({outcome:'FINAL',versionState:'ValidationBlocked'});
  const vid=fin.items[0].versionId!,rv=async()=>(await f.db.query<{row_version:number;state:string}>('SELECT row_version,state FROM result_report_version WHERE id=$1',[vid])).rows[0];
  // The external-final attestation is refused for an internal report (no spoofed externalFinalCertified).
  await expect(f.run(async t=>results.acceptAndRelease(t,f.u.certifier,{versionId:vid,expectedRowVersion:(await rv()).row_version,idempotencyKey:randomUUID(),externalFinalCertified:true,identityAndValuesMatchPdf:true,disclosureReviewed:true,abnormalAcknowledged:false}))).rejects.toThrow('EXTERNAL_ATTESTATION_NOT_FOR_INTERNAL_REPORT');
  await expect(f.run(t=>results.attestHisPresence(t,f.u.anc,{versionId:vid,confirmed:true}))).rejects.toThrow('FORBIDDEN');
  const att=await f.run(t=>results.attestHisPresence(t,f.u.staff,{versionId:vid,confirmed:true,note:'SYNTHETIC HIS screen checked by staff'}));expect(att.effect).toBe('SUPPRESSED_BEFORE_RELEASE');
  const row=(await f.db.query<{actor_id:string;statement:string;his_state:string;attested_at:Date}>('SELECT * FROM result_his_attestation WHERE id=$1',[att.id])).rows[0];
  expect(row).toMatchObject({actor_id:f.u.staff.id,statement:'มีผลใน HIS แล้ว',his_state:'PRESENT_IN_HIS'});
  const rel=await f.run(async t=>results.acceptInternalAndRelease(t,f.u.certifier,{versionId:vid,expectedRowVersion:(await rv()).row_version,idempotencyKey:randomUUID(),...accept,benchRevision:1}));
  expect(rel.outcome).toBe('CertifiedReleased');
  expect((await f.db.query("SELECT * FROM job_outbox WHERE kind='result_release_completed' AND payload->>'releaseId'=$1",[rel.releaseId])).rows).toHaveLength(0);
  expect((await f.db.query("SELECT 1 FROM audit_chain WHERE action='RESULT_OUTBOUND_SUPPRESSED' AND resource_id=$1",[rel.releaseId])).rows).toHaveLength(1);
  await expect(f.db.query("INSERT INTO p6_transfer(clinical_release_id,authority) VALUES($1,'CERTIFIED_RESULT')",[rel.releaseId])).rejects.toThrow('HIS_PRESENCE_ATTESTED_NO_OUTBOUND');
  // Withdrawing the attestation queues delivery exactly once (P6 keeps one transfer per release).
  const w=await f.run(t=>results.withdrawHisAttestation(t,f.u.staff,{attestationId:att.id,reason:'SYNTHETIC attestation entered in error'}));expect(w.deliveryQueued).toBe(true);
  expect((await f.db.query("SELECT * FROM job_outbox WHERE kind='result_release_completed' AND payload->>'releaseId'=$1",[rel.releaseId])).rows).toHaveLength(1);
  await expect(f.run(t=>results.withdrawHisAttestation(t,f.u.staff,{attestationId:att.id,reason:'SYNTHETIC second withdrawal'}))).rejects.toThrow('HIS_ATTESTATION_ALREADY_WITHDRAWN');

  // B. External ReadyGen fallback for case b while NIPT-CBH was unavailable: import the finished PDF through the existing case upload.
  const ext=syntheticReportPdf({kind:'SINGLETON',labNumber:b.printed,hn:b.hn,dob:'01-Jan-1990',collection:'20-Oct-2026',received:'20-Oct-2026',reported:'24-Oct-2026',gaWeeks:17,gaDays:6,sex:'Male',qc:'PASS'});
  const target={caseId:b.caseId,roundId:b.roundId,attemptId:b.attemptId};
  const check=await f.run(t=>results.caseUploadCheck(t,f.u.staff,f.store,{target,name:`${b.ln}_SYNTHETIC_Chonburi hospital.pdf`,bytes:ext}));expect(check.outcome).toBe('READY');
  const conf=await f.run(t=>results.caseUploadConfirm(t,f.u.staff,{target,intakeId:check.intakeId}));
  if(conf.state==='Unlinked')await f.run(async t=>results.decideLink(t,f.u.certifier,{versionId:conf.versionId,decision:'APPROVE',reason:'SYNTHETIC second person identity match',expectedRowVersion:(await f.db.query<{row_version:number}>('SELECT row_version FROM result_report_version WHERE id=$1',[conf.versionId])).rows[0].row_version}));
  const ev=(await f.db.query<{origin:string;state:string;row_version:number}>('SELECT origin,state,row_version FROM result_report_version WHERE id=$1',[conf.versionId])).rows[0];expect(ev.origin).toBe('EXTERNAL_READYGEN');
  await f.run(t=>results.recordExternalFallback(t,f.u.staff,{versionId:conf.versionId,outageReference:'SYNTHETIC-OUTAGE-2026-10-24-01',outageStartedAt:'2026-10-24T08:00:00+07:00',outageEndedAt:'2026-10-24T12:00:00+07:00'}));
  const extRel=await f.run(async t=>results.acceptAndRelease(t,f.u.certifier,{versionId:conf.versionId,expectedRowVersion:(await f.db.query<{row_version:number}>('SELECT row_version FROM result_report_version WHERE id=$1',[conf.versionId])).rows[0].row_version,idempotencyKey:randomUUID(),externalFinalCertified:true,identityAndValuesMatchPdf:true,disclosureReviewed:true,abnormalAcknowledged:false,benchRevision:1,benchMeasurementsReviewed:true}));
  expect(extRel.outcome).toBe('CertifiedReleased');
  // The external bytes are archived unchanged; the internal pathway can no longer finalise a second report for that round.
  expect((await f.store.get((await f.db.query<{sha256:string}>('SELECT sha256 FROM result_report_version WHERE id=$1',[conf.versionId])).rows[0].sha256)).equals(ext)).toBe(true);
  const dup=await f.run(t=>finalizeReports(t,f.u.certifier,deps,{idempotencyKey:randomUUID(),defaults:{reportedBy:f.u.certifier.id,approvedBy:f.u.certifier.id},items:[{rowId:rowOf(b.printed)}]}));
  expect(dup.items[0].outcome).toBe('HOLD');expect(dup.items[0].holds!.map(h=>h.code)).toContain('ACTIVE_RELEASE_EXISTS_FOR_ROUND');
  expect(Number((await f.db.query<{n:number}>("SELECT count(*)::int n FROM result_release WHERE round_id=$1 AND state='Active'",[b.roundId])).rows[0].n)).toBe(1);
  // Re-importing the same external bytes is a duplicate, never a second version.
  const again=await f.run(t=>results.caseUploadCheck(t,f.u.staff,f.store,{target,name:'again.pdf',bytes:ext}));expect(again.outcome).toBe('DUPLICATE');

  // C. ANC sees both released results the same way: summary from the certified report, view/download/print of the exact bytes.
  for(const x of [{c:a,origin:'INTERNAL_GENERATED'},{c:b,origin:'EXTERNAL_READYGEN'}]){
   const view=await f.run(t=>results.ancCaseResults(t,f.u.anc,x.c.caseId)),cur=view.rounds.find(r=>r.current)!;
   expect(cur.result).not.toBeNull();expect(cur.result!.summary).toMatchObject({template:'SINGLETON',noCall:false,t21:'Low Risk',qc:'PASS'});expect(JSON.stringify(cur)).not.toContain(x.origin);
   const files=await Promise.all((['VIEW','DOWNLOAD','PRINT'] as const).map(m=>f.run(t=>results.readReleasedFile(t,f.u.anc,f.store,cur.result!.id,m))));
   expect(new Set(files.map(r=>r.sha256)).size).toBe(1);expect(files[1].name).toMatch(new RegExp(`^${x.c.ln}_.*_Chonburi hospital\\.pdf$`));
  }
  const purposes=(await f.db.query<{purpose:string}>("SELECT DISTINCT purpose FROM result_access_log WHERE actor_id=$1",[f.u.anc.id])).rows.map(r=>r.purpose).sort();
  expect(purposes).toEqual(['ANC_RESULT_DOWNLOAD','ANC_RESULT_FILE','ANC_RESULT_LIST','ANC_RESULT_PRINT_VIEW']);
 }finally{vi.unstubAllEnvs();await f.close();}
},600000);
