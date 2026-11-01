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
import {task3Fixture,halosWorkbook,approveInterpretation,recordPaperRequest,masters} from '../helpers/task3';
import {syntheticSignaturePng} from '../helpers/signature-png';
import {previewHalosImport,decideHalosImport} from '../../packages/readygen/halos-import';
import {submitSignerProfile,decideSignerProfile,grantDelegation} from '../../packages/readygen/signers';
import {finalizeReports} from '../../packages/readygen/reports';
import * as results from '../../packages/results/service';
import {reserveReleasedResult} from '../../packages/p6/released-result';
import {runTransfer} from '../../packages/p6/worker';
import {workerServiceAccount} from '../../packages/integrations/authorized-share';
import {syntheticProfile} from '../../packages/p6/res';
import {SETTINGS} from '../../packages/settings/catalog';
import {proposeSetting,validateSetting,approveSetting,activateSetting} from '../../packages/settings/service';

// Native PostgreSQL + Microsoft Word: the Task 3 pathway runs under the real least-privilege roles (app_rw web, worker_rw P6),
// delivers the exact internal PDF through the existing P6 transport once, and an "มีผลใน HIS แล้ว" attestation stops any transfer.
it.skipIf(!process.env.NIPT_TEST_DATABASE_URL)('native Task 3: app_rw internal report + release, worker_rw P6 delivery exactly once, attestation suppresses outbound',async()=>{
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
  const app=await session('app_rw'),worker=await session('worker_rw'),deps={store,templates:masters()};const [a,b]=f.cases;
  // Every Task 3 action below runs as app_rw (the web role): import, signers, delegation, final, attestation.
  const imp=await tx(app,t=>previewHalosImport(t,f.u.staff,store,{name:'Sample analysis data_S990000003_10242026.xlsx',bytes:halosWorkbook({result:[{sample:a.printed},{sample:b.printed,gender:'Male'}],sampleinfo:f.cases.map(x=>({id:x.vendorId,fetus:x.pregnancy,ga:'17,6'}))})}));
  await tx(app,t=>decideHalosImport(t,f.u.staff,{importId:imp.id,decision:'CONFIRM',expectedRowVersion:imp.rowVersion}));
  for(const [user,legal,license,seed] of [[f.u.staff,'Synthetic Reporter','99001',1],[f.u.certifier,'Synthetic Approver','99002',2]] as const){
   const p=await tx(app,t=>submitSignerProfile(t,user,store,{legalName:legal,mtLicenseNo:license,signature:syntheticSignaturePng(seed)}));
   await tx(app,t=>decideSignerProfile(t,f.admin,{profileId:p.id,decision:'VERIFY',reason:'SYNTHETIC identity and licence checked'}));}
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
  // A: Final + release as app_rw; worker_rw delivers the exact internal PDF once.
  const fin=await tx(app,t=>finalizeReports(t,f.u.certifier,deps,{idempotencyKey:randomUUID(),defaults:{reportedBy:f.u.staff.id,approvedBy:f.u.certifier.id},release:true,
   releaseConfirmations:{reportContentVerified:true,identityAndValuesMatchReport:true,disclosureReviewed:true,abnormalAcknowledged:true,benchMeasurementsReviewed:true},items:[{rowId:rowOf(a.printed)}]}));
  expect(fin.items[0]).toMatchObject({outcome:'FINAL',versionState:'CertifiedReleased'});
  const rel=(await owner.query<{id:string;sha256:string}>('SELECT r.id,v.sha256 FROM result_release r JOIN result_report_version v ON v.id=r.version_id WHERE v.id=$1',[fin.items[0].versionId])).rows[0];
  const transfer=await reserveReleasedResult(worker,rel.id,store);expect((await reserveReleasedResult(worker,rel.id,store)).id).toBe(transfer.id);
  expect(await runTransfer(worker,transfer.id)).toBe('AWAITING_CONFIRMATION');
  const pdf=await readFile(path.join(share,'pdf',transfer.plan.pdfName)),res=await readFile(path.join(share,'res',transfer.plan.resName));
  expect(createHash('sha256').update(pdf).digest('hex')).toBe(rel.sha256);expect(res.subarray(2).toString('utf16le')).toMatch(/low risk/i);
  expect((await owner.query('SELECT 1 FROM p6_transfer WHERE clinical_release_id=$1',[rel.id])).rows).toHaveLength(1);
  // B: attested before release → release without job; worker reservation refused by the database guard; no transfer.
  const fin2=await tx(app,t=>finalizeReports(t,f.u.certifier,deps,{idempotencyKey:randomUUID(),defaults:{reportedBy:f.u.staff.id,approvedBy:f.u.certifier.id},items:[{rowId:rowOf(b.printed)}]}));
  const vid=fin2.items[0].versionId!;await tx(app,t=>results.attestHisPresence(t,f.u.staff,{versionId:vid,confirmed:true}));
  const rv=async()=>(await owner.query<{row_version:number}>('SELECT row_version FROM result_report_version WHERE id=$1',[vid])).rows[0].row_version;
  const r2=await tx(app,async t=>results.acceptInternalAndRelease(t,f.u.certifier,{versionId:vid,expectedRowVersion:await rv(),idempotencyKey:randomUUID(),reportContentVerified:true,identityAndValuesMatchReport:true,disclosureReviewed:true,abnormalAcknowledged:true,benchRevision:1,benchMeasurementsReviewed:true}));
  expect(r2.outcome).toBe('CertifiedReleased');
  // Two database layers refuse it: migration 147 makes p6_release_eligible false for an attested HIS presence (checked first), and the insert guard
  // of migration 128 (HIS_PRESENCE_ATTESTED_NO_OUTBOUND) remains the last line of defence. Either way no transfer may exist.
  await expect(reserveReleasedResult(worker,r2.releaseId!,store)).rejects.toThrow(/HIS_PRESENCE_ATTESTED_NO_OUTBOUND|CERTIFIED_CURRENT_RELEASE_REQUIRED/);
  expect((await owner.query('SELECT 1 FROM p6_transfer WHERE clinical_release_id=$1',[r2.releaseId])).rows).toHaveLength(0);
  // Least privilege: the worker cannot attest; the web role cannot rewrite frozen evidence.
  await expect(worker.query("INSERT INTO result_his_attestation(version_id,round_id,case_id,statement,his_state,effect,actor_id) SELECT version_id,round_id,case_id,statement,his_state,effect,actor_id FROM result_his_attestation LIMIT 1")).rejects.toThrow();
  await expect(app.query("UPDATE internal_report SET download_name='x.pdf'")).rejects.toThrow('INTERNAL_REPORT_IMMUTABLE');
  await expect(app.query('DELETE FROM halos_import_row')).rejects.toThrow();
  const evidence=path.resolve('.local/task3-evidence/native-pg');await mkdir(evidence,{recursive:true});
  await writeFile(path.join(evidence,'native-pg-evidence.json'),JSON.stringify({database:name,loopbackOnly:true,appRole:'app_rw',workerRole:'worker_rw',renderer:'Microsoft Word',
   internalRelease:rel.id,transfer:transfer.id,transferState:'AWAITING_CONFIRMATION',deliveredPdfSha256:rel.sha256,attestedRelease:r2.releaseId,attestedTransferRows:0,hisConfirmed:false,generatedAt:new Date().toISOString()},null,2));
 }finally{
  vi.unstubAllEnvs();for(const c of clients)await c.end();await owner.end();await admin.query('DROP DATABASE IF EXISTS '+name);await admin.end();
  if(!path.resolve(base).startsWith(path.resolve(os.tmpdir())+path.sep))throw Error('TEMP_CLEANUP_PATH_INVALID');await rm(base,{recursive:true,force:true});
 }
},300000);
