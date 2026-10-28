import {it,expect,vi} from 'vitest';
import {Client} from 'pg';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {readFile,mkdtemp,mkdir,rm,rename} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {migrate} from '../../tools/migrate';
import {assertSyntheticDatabase,type Queryable} from '../../packages/db/connection';
import {FileStore} from '../../packages/storage';
import {tx} from '../helpers/lab';
import {task3Fixture,halosWorkbook,approveInterpretation,recordPaperRequest,masters} from '../helpers/task3';
import {syntheticSignaturePng} from '../helpers/signature-png';
import {previewHalosImport,decideHalosImport} from '../../packages/readygen/halos-import';
import {submitSignerProfile,decideSignerProfile,grantDelegation} from '../../packages/readygen/signers';
import {finalizeReports} from '../../packages/readygen/reports';
import {enableArchive,queueArchiveProbe,retryFailedArchive} from '../../packages/results/archive-settings';
import {runArchiveCycle,runArchiveProbeCycle} from '../../packages/results/archive-worker';
import {readArchiveStatus} from '../../packages/results/archive-access';

it.skipIf(!process.env.NIPT_TEST_DATABASE_URL)('native synthetic clinical pathway releases then archives without changing release or HIS outbox',async()=>{
 const shared=process.env.NIPT_TEST_DATABASE_URL!;assertSyntheticDatabase(shared);
 const name='nipt_synthetic_archive_clinical_'+randomBytes(4).toString('hex'),server=new URL(shared);server.pathname='/postgres';
 const admin=new Client({connectionString:server.toString()});await admin.connect();await admin.query('CREATE DATABASE '+name);
 const url=new URL(shared);url.pathname='/'+name;assertSyntheticDatabase(url.toString());
 const owner=new Client({connectionString:url.toString()});await owner.connect();const clients:Client[]=[];
 const base=await mkdtemp(path.join(os.tmpdir(),'nipt-archive-clinical-')),store=new FileStore(path.join(base,'files')),archive=path.join(base,'archive');await mkdir(archive);
 const session=async(role:'app_rw'|'worker_rw')=>{const c=new Client({connectionString:url.toString()});await c.connect();await c.query(`SET ROLE ${role}`);clients.push(c);return c as unknown as Queryable;};
 try{
  await migrate(owner);await owner.query(await readFile('packages/db/roles.sql','utf8'));await owner.query(await readFile('packages/p6/grants.sql','utf8'));
  const f=await task3Fixture(undefined,{db:owner as unknown as Queryable,root:base,store,lookupKey:randomBytes(32),close:async()=>{}});
  const app=await session('app_rw'),worker=await session('worker_rw'),worker2=await session('worker_rw'),a=f.cases[0],b=f.cases[1];
  // Local fixture path is admitted only in synthetic mode; archive worker and publication code are unchanged.
  vi.stubEnv('NIPT_MODE','synthetic');const probe=await tx(app,t=>queueArchiveProbe(t,f.admin,archive));await runArchiveProbeCycle(worker);await tx(app,t=>enableArchive(t,f.admin,probe));vi.stubEnv('NIPT_MODE','operational');
  const imp=await tx(app,t=>previewHalosImport(t,f.u.staff,store,{name:'Sample analysis data_S990000003_10242026.xlsx',bytes:halosWorkbook({result:[{sample:a.printed},{sample:b.printed,gender:'Male'}],sampleinfo:f.cases.map(x=>({id:x.vendorId,fetus:x.pregnancy,ga:'17,6'}))})}));
  await tx(app,t=>decideHalosImport(t,f.u.staff,{importId:imp.id,decision:'CONFIRM',expectedRowVersion:imp.rowVersion}));
  for(const [user,legal,license,seed] of [[f.u.staff,'Synthetic Reporter','99001',1],[f.u.certifier,'Synthetic Approver','99002',2]] as const){const p=await tx(app,t=>submitSignerProfile(t,user,store,{legalName:legal,mtLicenseNo:license,signature:syntheticSignaturePng(seed)}));await tx(app,t=>decideSignerProfile(t,f.admin,{profileId:p.id,decision:'VERIFY',reason:'SYNTHETIC identity and licence checked'}));}
  await tx(app,t=>grantDelegation(t,f.u.staff,{granteeId:f.u.certifier.id,roles:['REPORTED'],authorityReference:'SYNTHETIC-SOP-NIPT-SIGNATURE-01'}));
  await approveInterpretation(f,{interpretationApproved:true,singletonApprovedProduct:'HNZ0011',twinApprovedProduct:'HNZ0011',approvalReference:'SYNTHETIC-CLINICAL-APPROVAL-NATIVE'});await recordPaperRequest(f,a,'Want');await recordPaperRequest(f,b,'Want');
  const row=imp.rows.find(r=>r.sheet==='result'&&r.sampleKey===a.printed)!;
  const fin=await tx(app,t=>finalizeReports(t,f.u.certifier,{store,templates:masters()},{idempotencyKey:randomUUID(),defaults:{reportedBy:f.u.staff.id,approvedBy:f.u.certifier.id},release:true,releaseConfirmations:{reportContentVerified:true,identityAndValuesMatchReport:true,disclosureReviewed:true,abnormalAcknowledged:true,benchMeasurementsReviewed:true},items:[{rowId:row.id}]}));
  expect(fin.items[0]).toMatchObject({outcome:'FINAL',versionState:'CertifiedReleased'});
  const versionId=fin.items[0].versionId!;
  const before=(await owner.query('SELECT row_to_json(r)::text release,(SELECT json_agg(row_to_json(o) ORDER BY o.id)::text FROM job_outbox o) outbox FROM result_release r WHERE version_id=$1',[versionId])).rows[0];
  await runArchiveCycle(worker,store,async(_root,intent)=>({state:'FAILED',sha256:intent.sha256,reason:'ARCHIVE_ENOENT'}));
  expect((await readArchiveStatus(app,f.u.staff,versionId)).state).toBe('PENDING');
  const afterFailure=(await owner.query('SELECT row_to_json(r)::text release,(SELECT json_agg(row_to_json(o) ORDER BY o.id)::text FROM job_outbox o) outbox FROM result_release r WHERE version_id=$1',[versionId])).rows[0];expect(afterFailure).toEqual(before);
  await worker.query("UPDATE pdf_archive_job SET next_attempt_at=clock_timestamp()-interval '1 second' WHERE version_id=$1",[versionId]);
  await Promise.all([runArchiveCycle(worker,store),runArchiveCycle(worker2,store)]);const status=await readArchiveStatus(app,f.u.staff,versionId);expect(status.state).toBe('ARCHIVED');
  await expect(readArchiveStatus(app,{...f.u.anc,unitIds:[randomUUID()]},versionId)).rejects.toThrow('FORBIDDEN');
  await expect(readArchiveStatus(app,f.u.staff,randomUUID())).rejects.toThrow('NOT_FOUND');
  expect((await owner.query('SELECT id FROM pdf_archive_job WHERE version_id=$1',[versionId])).rows).toHaveLength(1);
  const job=(await owner.query<{case_id:string;source_sha256:string}>('SELECT case_id,source_sha256 FROM pdf_archive_job WHERE version_id=$1',[versionId])).rows[0];
  expect(createHash('sha256').update(await readFile(path.join(archive,job.case_id,`${versionId}.pdf`))).digest('hex')).toBe(job.source_sha256);
  const after=(await owner.query('SELECT row_to_json(r)::text release,(SELECT json_agg(row_to_json(o) ORDER BY o.id)::text FROM job_outbox o) outbox FROM result_release r WHERE version_id=$1',[versionId])).rows[0];expect(after).toEqual(before);
  const second=imp.rows.find(r=>r.sheet==='result'&&r.sampleKey===b.printed)!;
  const fin2=await tx(app,t=>finalizeReports(t,f.u.certifier,{store,templates:masters()},{idempotencyKey:randomUUID(),defaults:{reportedBy:f.u.staff.id,approvedBy:f.u.certifier.id},release:true,releaseConfirmations:{reportContentVerified:true,identityAndValuesMatchReport:true,disclosureReviewed:true,abnormalAcknowledged:true,benchMeasurementsReviewed:true},items:[{rowId:second.id}]}));
  expect(fin2.items[0]).toMatchObject({outcome:'FINAL',versionState:'CertifiedReleased'});const secondId=fin2.items[0].versionId!;
  const snapshot=async()=>(await owner.query('SELECT row_to_json(r)::text release,(SELECT json_agg(row_to_json(o) ORDER BY o.id)::text FROM job_outbox o) outbox FROM result_release r WHERE version_id=$1',[secondId])).rows[0];
  const beforeOffline=await snapshot();await rename(archive,archive+'-offline');
  try{for(let attempt=1;attempt<=5;attempt++){
   await runArchiveCycle(worker,store);
   const job=(await owner.query<{state:string;attempts:number;last_error:string}>('SELECT state,attempts,last_error FROM pdf_archive_job WHERE version_id=$1',[secondId])).rows[0];
   expect(job.attempts).toBe(attempt);expect(job.state).toBe(attempt===5?'FAILED':'PENDING');expect(job.last_error).toBe('ARCHIVE_ENOENT');
   if(attempt<5)await worker.query("UPDATE pdf_archive_job SET next_attempt_at=clock_timestamp()-interval '1 second' WHERE version_id=$1",[secondId]);
  }}finally{await rename(archive+'-offline',archive);}
  expect(await snapshot()).toEqual(beforeOffline);
  // APP_ADMIN asks for a recheck, but cannot change the FAILED job directly.
  const failed=(await owner.query<{id:string;state:string}>(`SELECT id,state FROM pdf_archive_job WHERE version_id=$1`,[secondId])).rows[0];
  expect(failed.state).toBe('FAILED');
  const recheck=await tx(app,t=>retryFailedArchive(t,f.admin,failed.id));
  expect(recheck.state).toBe('PENDING_PROBE');
  expect((await owner.query<{state:string}>(`SELECT state FROM pdf_archive_job WHERE id=$1`,[failed.id])).rows[0].state).toBe('FAILED');
  // Actual worker identity and filesystem access must pass the probe.
  await runArchiveProbeCycle(worker);
  expect((await owner.query<{state:string}>(`SELECT state FROM pdf_archive_job WHERE id=$1`,[failed.id])).rows[0].state).toBe('PENDING');
  await runArchiveCycle(worker,store);
  expect((await readArchiveStatus(app,f.u.staff,secondId)).state).toBe('ARCHIVED');
  expect(await snapshot()).toEqual(beforeOffline);
 }finally{
  vi.unstubAllEnvs();for(const c of clients)await c.end();await owner.end();await admin.query('DROP DATABASE IF EXISTS '+name);await admin.end();
  if(!path.resolve(base).startsWith(path.resolve(os.tmpdir())+path.sep))throw Error('TEMP_CLEANUP_PATH_INVALID');await rm(base,{recursive:true,force:true});
 }
},300000);
