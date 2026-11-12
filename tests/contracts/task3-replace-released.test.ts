import {it,expect,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {task3Fixture,halosWorkbook,signerSetup,approveInterpretation,masters} from '../helpers/task3';
import {previewHalosImport,decideHalosImport} from '../../packages/readygen/halos-import';
import {reportCandidate,finalizeReports} from '../../packages/readygen/reports';
import {ancCaseResults} from '../../packages/results/service';
import {certifyPending} from '../helpers/certify-pending';

// Owner 2026-11-12: the first HALOS file was wrong and its results were released. A new HALOS file is imported and, with
// "ออกผลใหม่แทนผลเดิม" ticked (no reason asked), the wrong released result is DELETED and the new report takes its place: it waits in
// "รอส่ง HIS" and is sent as usual. Native: renders through the installed Microsoft Word, like the other report tests.
const confirmations={reportContentVerified:true,identityAndValuesMatchReport:true,disclosureReviewed:true,abnormalAcknowledged:true} as const;
it('a released result is deleted and replaced by a new HALOS report only when ticked; the new one is sent as usual',async()=>{
 const f=await task3Fixture(undefined,undefined,{worksheetMeasurements:false});
 try{
  const [a]=f.cases,deps={store:f.store,templates:masters()};
  const importHalos=async(name:string,ff:string)=>{
   const imp=await f.run(t=>previewHalosImport(t,f.u.staff,f.store,{name,bytes:halosWorkbook({result:[{sample:a.printed,ff}],sampleinfo:[{id:a.vendorId,fetus:a.pregnancy,ga:'17,6'}]})}));
   await f.run(t=>decideHalosImport(t,f.u.staff,{importId:imp.id,decision:'CONFIRM',expectedRowVersion:imp.rowVersion,acknowledgeWarnings:[...new Set(imp.issues.filter(i=>i.severity==='WARNING').map(i=>i.code))]}));
   return imp.rows.find(r=>r.sheet==='result'&&r.sampleKey===a.printed)!.id;
  };
  const finalize=(rowId:string,extra:Record<string,unknown>={})=>f.run(t=>finalizeReports(t,f.u.certifier,deps,{idempotencyKey:randomUUID(),defaults:{reportedBy:f.u.staff.id,approvedBy:f.u.certifier.id},release:true,releaseConfirmations:confirmations,items:[{rowId,...extra}]}));
  const count=async(sql:string,args:unknown[])=>(await f.db.query<{n:number}>(`SELECT count(*)::int n FROM ${sql}`,args)).rows[0].n;
  // 1. The wrong file is reported and released.
  const wrongRow=await importHalos('Sample analysis data_S990000001_WRONG.xlsx','6.1');
  await signerSetup(f);await approveInterpretation(f,{interpretationApproved:true,approvalReference:'SYNTHETIC-HALOS-REPORTING'});
  const first=await finalize(wrongRow);expect(first.items[0],JSON.stringify(first.items[0])).toMatchObject({outcome:'FINAL',release:'PendingCertification'});
  const oldVersion=first.items[0].versionId!,oldReport=first.items[0].internalReportId!;
  expect((await f.run(t=>certifyPending(t,f.u.certifier,oldVersion))).outcome).toBe('CertifiedReleased');
  const oldRelease=(await f.db.query<{id:string}>("SELECT id FROM result_release WHERE version_id=$1 AND state='Active'",[oldVersion])).rows[0].id;
  // 2. The corrected file. Without the tick the released result stays (existing OD-17 hold); with it the candidate is clean.
  const rightRow=await importHalos('Sample analysis data_S990000001_RIGHT.xlsx','14.7');
  const holds=async(input:Record<string,unknown>)=>(await f.run(t=>reportCandidate(t,f.u.certifier,deps,{rowId:rightRow,...input}))).holds.map(h=>h.code);
  expect(await holds({})).toContain('INTERNAL_REPORT_ALREADY_FINAL');
  expect(await holds({reissue:true})).toContain('POST_RELEASE_REVISION_PENDING_OD17');
  expect(await holds({reissue:true,replaceReleased:true})).toEqual([]);
  // 3. Replace, under the Worker's own role as in Production: the old result is gone, the new report waits to be sent.
  await f.db.exec(await readFile('packages/db/roles.sql','utf8'));await f.db.exec(await readFile('packages/p6/grants.sql','utf8'));await f.db.query('SET ROLE worker_rw');
  let replaced;try{replaced=await finalize(rightRow,{replaceReleased:true});}finally{await f.db.query('RESET ROLE');}
  expect(replaced.items[0],JSON.stringify(replaced.items[0])).toMatchObject({outcome:'FINAL',release:'PendingCertification'});
  const newVersion=replaced.items[0].versionId!;
  expect(await count('result_report_version WHERE id=$1',[oldVersion])).toBe(0);
  expect(await count('result_release WHERE id=$1',[oldRelease])).toBe(0);
  expect(await count('internal_report WHERE id=$1',[oldReport])).toBe(0);
  for(const table of ['result_review','result_qc5_review','result_gate_evaluation','result_link_event','result_version_event','result_access_log'])expect(await count(`${table} WHERE version_id=$1`,[oldVersion]),table).toBe(0);
  expect(await count("job_outbox WHERE kind='result_release_completed' AND state='Pending' AND payload->>'releaseId'=$1",[oldRelease])).toBe(0);
  // the guards are back on: nothing else can be deleted
  await expect(f.db.query('DELETE FROM result_report_version WHERE id=$1',[newVersion])).rejects.toThrow();
  // 4. Sent as usual: exactly one release (the new one) with its own HIS job; ANC sees only the corrected values.
  expect((await f.run(t=>certifyPending(t,f.u.certifier,newVersion))).outcome).toBe('CertifiedReleased');
  const active=(await f.db.query<{version_id:string;id:string}>("SELECT version_id,id FROM result_release WHERE round_id=$1",[a.roundId])).rows;
  expect(active.map(r=>r.version_id)).toEqual([newVersion]);
  expect(await count("job_outbox WHERE kind='result_release_completed' AND payload->>'releaseId'=$1",[active[0].id])).toBe(1);
  const anc=await f.run(t=>ancCaseResults(t,f.u.certifier,a.caseId)) as unknown as {rounds:{result:{id:string;summary:{fetalFraction:number}}|null;history:unknown[]}[]};
  expect(anc.rounds[0].result).toMatchObject({id:active[0].id,summary:{fetalFraction:14.7}});
  expect(anc.rounds[0].history).toEqual([]);
 }finally{await f.close();vi.unstubAllEnvs();}
},240000);
