import {it,expect,vi} from 'vitest';
import {Client} from 'pg';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {readFile,mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {migrate} from '../../tools/migrate';
import {assertSyntheticDatabase,type Queryable} from '../../packages/db/connection';
import {FileStore} from '../../packages/storage';
import {tx} from '../helpers/lab';
import {addUser} from '../helpers/database';
import {task3Fixture,halosWorkbook,approveInterpretation,recordPaperRequest,T3_SOURCES} from '../helpers/task3';
import {syntheticSignaturePng} from '../helpers/signature-png';
import {previewHalosImport,decideHalosImport} from '../../packages/readygen/halos-import';
import {submitSignerProfile,decideSignerProfile,grantDelegation} from '../../packages/readygen/signers';
import {certifyPending,pendingState} from '../helpers/certify-pending';
import {reserveReleasedResult} from '../../packages/p6/released-result';
import {runTransfer} from '../../packages/p6/worker';
import {workerServiceAccount} from '../../packages/integrations/authorized-share';
import {syntheticProfile} from '../../packages/p6/res';
import {SETTINGS} from '../../packages/settings/catalog';
import {proposeSetting,validateSetting,approveSetting,activateSetting} from '../../packages/settings/service';

import {enqueueReportBatch,runReportBatchItem,readReportBatch} from '../../packages/readygen/batch-jobs';

// Native PostgreSQL + Microsoft Word: the Task 3 pathway runs under the real least-privilege roles (app_rw web, worker_rw P6),
// delivers the exact internal PDF through the existing P6 transport once, and an "มีผลใน HIS แล้ว" attestation stops any transfer.
it.skipIf(!process.env.NIPT_TEST_DATABASE_URL)('report batch: worker_rw finalizes, web certifies, worker_rw delivers PDF + RES + OK to the HIS share',async()=>{
 const shared=process.env.NIPT_TEST_DATABASE_URL!;assertSyntheticDatabase(shared);
 const name='nipt_synthetic_test_task3_'+randomBytes(4).toString('hex'),server=new URL(shared);server.pathname='/postgres';
 const admin=new Client({connectionString:server.toString()});await admin.connect();await admin.query('CREATE DATABASE '+name);
 const url=new URL(shared);url.pathname='/'+name;assertSyntheticDatabase(url.toString());
 const owner=new Client({connectionString:url.toString()});await owner.connect();const clients:Client[]=[];
 const base=await mkdtemp(path.join(os.tmpdir(),'nipt-task3-native-')),store=new FileStore(path.join(base,'files'));
 const session=async(role:'app_rw'|'worker_rw')=>{const c=new Client({connectionString:url.toString()});await c.connect();await c.query(`SET ROLE ${role}`);clients.push(c);return c as unknown as Queryable;};
 try{
  await migrate(owner);await owner.query(await readFile('packages/db/roles.sql','utf8'));await owner.query(await readFile('packages/p6/grants.sql','utf8'));
  const o=owner as unknown as Queryable,f=await task3Fixture(undefined,{db:o,root:base,store,lookupKey:randomBytes(32),close:async()=>{}});
  const app=await session('app_rw'),worker=await session('worker_rw'),workerDeps={store};const [a,b]=f.cases;
  // The Worker gets only {store}: the template comes from the registry (report_template_active) or the installed master, as in Production.
  vi.stubEnv('NIPT_REPORT_TEMPLATE_SINGLETON',path.join(T3_SOURCES,'singleton.docx'));vi.stubEnv('NIPT_REPORT_TEMPLATE_TWIN',path.join(T3_SOURCES,'twin.docx'));
  // Every Task 3 action below runs as app_rw (the web role): import, signers, delegation, final, attestation.
  const imp=await tx(app,t=>previewHalosImport(t,f.u.staff,store,{name:'Sample analysis data_S990000003_10242026.xlsx',bytes:halosWorkbook({result:[{sample:a.printed},{sample:b.printed,gender:'Male'}],sampleinfo:f.cases.map(x=>({id:x.vendorId,fetus:x.pregnancy,ga:'17,6'}))})}));
  await tx(app,t=>decideHalosImport(t,f.u.staff,{importId:imp.id,decision:'CONFIRM',expectedRowVersion:imp.rowVersion}));
  for(const [user,legal,license,seed] of [[f.u.staff,'Synthetic Reporter','99001',1],[f.u.certifier,'Synthetic Approver','99002',2]] as const){
   const p=await tx(app,t=>submitSignerProfile(t,user,store,{legalName:legal,mtLicenseNo:license,signature:syntheticSignaturePng(seed)}));
   await tx(app,t=>decideSignerProfile(t,f.admin,{profileId:p.id,decision:'VERIFY',layoutReviewed:true,reason:'SYNTHETIC identity and licence checked'}));}
  await tx(app,t=>grantDelegation(t,f.u.staff,{granteeId:f.u.certifier.id,roles:['REPORTED'],authorityReference:'SYNTHETIC-SOP-NIPT-SIGNATURE-01'}));
  await approveInterpretation(f,{interpretationApproved:true,singletonApprovedProduct:'HNZ0011',twinApprovedProduct:'HNZ0011',approvalReference:'SYNTHETIC-CLINICAL-APPROVAL-NATIVE'});
  for(const x of [a,b])await recordPaperRequest(f,x,'Want');
  const rowOf=(s:string)=>imp.rows.find(r=>r.sheet==='result'&&r.sampleKey===s)!.id;
  // HIS outbound configured to a disposable local share (operational transport, never a hospital path).
  const share=path.join(base,'local-only-outbound');await mkdir(share);for(const n of ['res','pdf','backup'])await mkdir(path.join(share,n));
  const policy=path.join(base,'policy.json');await writeFile(policy,JSON.stringify({version:1,grants:[{root:share,purposes:['OUTBOUND'],serviceAccount:workerServiceAccount(),secretRef:null,mode:'operational'}]}));vi.stubEnv('NIPT_HIS_SHARE_POLICY_FILE',policy);
  const settingsAdmin=await addUser(owner as unknown as Parameters<typeof addUser>[0],'APP_ADMIN','synthetic.task3.outbound.admin');
  const setting=await tx(o,t=>proposeSetting(t,settingsAdmin,'his_outbound',{...SETTINGS.his_outbound.default,enabled:true,target:'AUTHORIZED_SHARE',productionAuthorized:true,resultStyle:'short',resDestinationPath:path.join(share,'res'),pdfDestinationPath:path.join(share,'pdf'),backupPath:path.join(share,'backup'),resProfile:{...syntheticProfile,syntheticOnly:false,version:'SYNTHETIC-TASK3-LOCAL'},certifierHisMappings:{[f.u.certifier.id]:'SYNTHETIC^CERTIFIER'}},'SYNTHETIC disposable loopback local share'));
  await tx(o,t=>validateSetting(t,settingsAdmin,setting,async()=>true));await tx(o,t=>approveSetting(t,f.u.approver,setting));await tx(o,t=>activateSetting(t,f.u.approver,setting));
  // Web queues the batch (app_rw); the Worker (worker_rw) finalizes the item exactly as it does in Production.
  const conf={reportContentVerified:true,identityAndValuesMatchReport:true,disclosureReviewed:true,abnormalAcknowledged:true,benchMeasurementsReviewed:true};
  // A real signed-in session, as in Production: the Worker re-checks it (app_session) before it finalizes. Without one the check is skipped.
  const sid=(await owner.query<{id:string}>("INSERT INTO app_session(user_id,token_hash,csrf_hash,idle_expires_at,absolute_expires_at) VALUES($1,$2,$3,now()+interval '30 minutes',now()+interval '8 hours') RETURNING id",[f.u.certifier.id,'a'.repeat(64),'b'.repeat(64)])).rows[0].id;
  const signedIn={...f.u.certifier,sessionId:sid};
  const batch=await tx(app,t=>enqueueReportBatch(t,signedIn,{idempotencyKey:randomUUID(),defaults:{reportedBy:f.u.staff.id,approvedBy:f.u.certifier.id},release:true,releaseConfirmations:conf,items:[{rowId:rowOf(a.printed)}]} as never));
  const job=(await owner.query<{id:string;payload:unknown}>('SELECT j.id,j.payload FROM job_outbox j JOIN internal_report_request_item i ON i.outbox_id=j.id WHERE i.request_id=$1',[batch.batchId])).rows[0];
  expect(await tx(worker,t=>runReportBatchItem(t,job.id,job.payload,workerDeps,3))).toMatchObject({state:'FINAL'});
  const st=await readReportBatch(app,f.u.certifier,batch.batchId);
  expect(st.state).toBe('COMPLETED');expect(st.items[0].outcome).toMatchObject({outcome:'FINAL'});
  const versionId=st.items[0].outcome!.versionId as string;
  // The result is on the patient as a version waiting to be sent.
  expect((await owner.query<{state:string}>('SELECT state FROM result_report_version WHERE id=$1',[versionId])).rows[0].state).toBe('PendingCertification');
  expect(await tx(app,t=>pendingState(t,versionId))).toEqual({state:'PendingCertification',reviews:1,qc5:1,releases:0,outbox:0});
  // The send step (web role) certifies it; that is the release the HIS transfer picks up.
  await tx(app,t=>certifyPending(t,f.u.certifier,versionId));
  const rel=(await owner.query<{id:string;sha256:string}>('SELECT r.id,v.sha256 FROM result_release r JOIN result_report_version v ON v.id=r.version_id WHERE v.id=$1',[versionId])).rows[0];
  // The Worker reserves the transfer once and publishes PDF, RES and the OK readiness marker.
  const transfer=await reserveReleasedResult(worker,rel.id,store);expect((await reserveReleasedResult(worker,rel.id,store)).id).toBe(transfer.id);
  expect(await runTransfer(worker,transfer.id)).toBe('AWAITING_CONFIRMATION');
  const pdf=await readFile(path.join(share,'pdf',transfer.plan.pdfName)),res=await readFile(path.join(share,'res',transfer.plan.resName)),ok=await readFile(path.join(share,'res',transfer.plan.okName));
  expect(createHash('sha256').update(pdf).digest('hex')).toBe(rel.sha256);
  expect(res.subarray(0,2).toString('hex')).toBe('fffe');expect(res.subarray(2).toString('utf16le')).toMatch(/low risk/i);
  expect(ok.toString('hex')).toBe('fffe');expect(transfer.plan.okName).toBe(transfer.plan.resName.replace(/.res$/,'.ok'));
  expect((await owner.query('SELECT 1 FROM p6_transfer WHERE clinical_release_id=$1',[rel.id])).rows).toHaveLength(1);
 }finally{
  vi.unstubAllEnvs();for(const c of clients)await c.end();await owner.end();await admin.query('DROP DATABASE IF EXISTS '+name);await admin.end();
  if(!path.resolve(base).startsWith(path.resolve(os.tmpdir())+path.sep))throw Error('TEMP_CLEANUP_PATH_INVALID');await rm(base,{recursive:true,force:true});
 }
},300000);
