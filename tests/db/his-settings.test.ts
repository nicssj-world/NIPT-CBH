import {workerServiceAccount} from '../../packages/integrations/authorized-share';
import {beforeAll,afterAll,it,expect,vi} from 'vitest';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomBytes} from 'node:crypto';
import type {PGlite} from '@electric-sql/pglite';
import type {Principal} from '../../packages/security/policy';
import {testDatabase,addUser} from '../helpers/database';
import {SETTINGS} from '../../packages/settings/catalog';
import {proposeSetting,approveSetting,activateSetting} from '../../packages/settings/service';
import {requestHisTest,activeHis,bindActiveOutboundSettings} from '../../packages/settings/his';
import {executeInboundJob} from '../../packages/jobs/his';
import {persistJobResult} from '../../packages/jobs/worker';
import {runHisSettingsTest} from '../../packages/jobs/his-settings-test';
import {executeHisRetry} from '../../packages/jobs/his-retry';
import {FileStore} from '../../packages/storage';
import {syntheticPet} from '../../packages/integrations/pet';
import {lookbackFolders} from '../../packages/inbound/discovery';
import {syntheticProfile} from '../../packages/p6/res';
import type {SyntheticDraft} from '../../packages/p6/transfer';
import {registerFixture,reserveFixture,loadTransfer,readHistory} from '../../packages/p6/journal';
import {runTransfer} from '../../packages/p6/worker';
import {hisMonitoring,requestHisRetry} from '../../packages/settings/his-monitoring';
let db:PGlite,root:string,maker:Principal,checker:Principal;const key=randomBytes(32);
const fixture=(n:number):SyntheticDraft=>({fixtureId:'SYNTHETIC-HIS-'+n,reportVersionId:'SYNTHETIC-HIS-V-'+n,roundId:'SYNTHETIC-HIS-R-'+n,attemptId:'SYNTHETIC-HIS-A-'+n,origin:'LAB_DIRECT',lnGeneration:1,roundNumber:1,epoch:0,input:{order:{ln:'9900080000'+n,hn:'SYNTHETIC-HIS-'+n,dspname:'SYNTHETIC TEST',dob:'20000101',sex:'F',specimen_date:'20261014070000'},result:{t21:'Low',t18:'Low',t13:'Low'},generatedAt:'20261014080000',approvedAt:'20261014080000',certifierHisId:'SYNTHETIC^SYNTHETIC'},profile:{...syntheticProfile},pdf:Buffer.from('%PDF-1.4 SYNTHETIC'),settings:{version:'SYNTHETIC-UNBOUND',resDirectory:'simulator/p6/res',pdfDirectory:'simulator/p6/cfs',backupDirectory:'simulator/p6/backup',retryDelaysMs:[1],confirmationTimeoutMs:300000}});
beforeAll(async()=>{db=await testDatabase();maker=await addUser(db);checker=await addUser(db,'CLINICAL_APPROVER','synthetic.checker.his');root=await fs.mkdtemp(path.join(os.tmpdir(),'nipt-his-flow-'));for(const name of ['in-a','in-b','res','pdf','backup','res-b','pdf-b','backup-b'])await fs.mkdir(path.join(root,name));await fs.writeFile(path.join(root,'.nipt-authorized-test-root'),'NIPT_AUTHORIZED_SYNTHETIC_SHARE_V1');const policy=path.join(root,'policy.json');await fs.writeFile(policy,JSON.stringify({version:1,grants:[{root,purposes:['INBOUND','OUTBOUND'],serviceAccount:workerServiceAccount(),secretRef:null}]}));vi.stubEnv('NIPT_MODE','synthetic');vi.stubEnv('NIPT_P6_SANDBOX_ENABLED','yes');vi.stubEnv('NIPT_HIS_SHARE_POLICY_FILE',policy);});
afterAll(async()=>{await db.close();await fs.rm(root,{recursive:true,force:true});vi.unstubAllEnvs();});
async function validate(id:string){const queued=await requestHisTest(db,maker,id);if(queued.queued){const job=(await db.query<{payload:unknown}>('SELECT payload FROM job_outbox WHERE id=$1',[queued.jobId])).rows[0];const result=await runHisSettingsTest(db,job.payload);await persistJobResult(db,queued.jobId,result);expect(result).toMatchObject({passed:true,revisionId:id});}const saved=await requestHisTest(db,maker,id);expect(saved.queued).toBe(false);}
async function activate(key:'his_inbound'|'his_outbound',value:unknown){const id=await proposeSetting(db,maker,key,value,'SYNTHETIC_HIS_TEST');await expect(activateSetting(db,checker,id)).rejects.toThrow('SETTING_APPROVAL_REQUIRED');await validate(id);await expect(approveSetting(db,maker,id)).rejects.toThrow('FORBIDDEN');await approveSetting(db,checker,id);await activateSetting(db,checker,id);return id;}
async function pair(dir:string,n:number){const pet=syntheticPet(n);const day=lookbackFolders(1,new Date())[0],folder=path.join(root,dir,day);await fs.mkdir(folder,{recursive:true});await fs.writeFile(path.join(folder,pet.filename),pet.bytes);await fs.writeFile(path.join(folder,pet.filename.replace('.pet','.ok')),Buffer.alloc(0));return pet;}
it('Save -> worker Validate -> independent Approve -> Activate; worker follows active base and new version on restart',async()=>{
 await pair('in-a',801);const first=await activate('his_inbound',{...SETTINGS.his_inbound.default,enabled:true,basePath:path.join(root,'in-a'),lookbackDays:1});const store=new FileStore(path.join(root,'files'));
 const a=await executeInboundJob(db,'synthetic_scan',{},store,key);expect(a).toMatchObject({configurationId:first,counts:{stored:1}});const replay=await executeInboundJob(db,'synthetic_scan',{},store,key);expect(replay).toMatchObject({counts:{unchanged:1}});
 await pair('in-b',802);const second=await activate('his_inbound',{...SETTINGS.his_inbound.default,enabled:true,basePath:path.join(root,'in-b'),lookbackDays:1});expect((await activeHis(db,'his_inbound')).version).toBe(2);
 const b=await executeInboundJob(db,'synthetic_scan',{},new FileStore(path.join(root,'files')),key);expect(b).toMatchObject({configurationId:second,counts:{stored:1}});expect(b.configurationId).not.toBe(first);
 const test=await executeInboundJob(db,'synthetic_inbound_test',{},store,key);expect(test).toMatchObject({passed:true,configurationId:second});
 await expect(executeInboundJob(db,'synthetic_scan',{configurationId:first},store,key)).rejects.toThrow('HIS_CONFIGURATION_CHANGED');
});
it('bad path test cannot validate or activate; unrelated roles cannot enqueue tests',async()=>{
 const id=await proposeSetting(db,maker,'his_inbound',{...SETTINGS.his_inbound.default,basePath:path.join(root,'missing')},'SYNTHETIC_BAD_PATH');const q=await requestHisTest(db,maker,id);const job=(await db.query<{payload:unknown}>('SELECT payload FROM job_outbox WHERE id=$1',[q.jobId])).rows[0];const r=await runHisSettingsTest(db,job.payload);expect(r).toMatchObject({passed:false,errorCode:'SHARE_PATH_NOT_FOUND'});await persistJobResult(db,q.jobId,r);await requestHisTest(db,maker,id);expect((await db.query<{state:string}>('SELECT state FROM settings_revision WHERE id=$1',[id])).rows[0].state).toBe('Draft');await expect(approveSetting(db,checker,id)).rejects.toThrow('SETTING_NOT_VALIDATED');await expect(requestHisTest(db,{...maker,roles:['AUDITOR']},id)).rejects.toThrow('FORBIDDEN');
});
const outbound=(suffix='')=>({...SETTINGS.his_outbound.default,enabled:true,resDestinationPath:path.join(root,'res'+suffix),pdfDestinationPath:path.join(root,'pdf'+suffix),backupPath:path.join(root,'backup'+suffix),resultStyle:'short',retryDelaySeconds:1,retryLimit:2});
it('active outbound paths/style/retry freeze into existing journal; RES/PDF/OK and backup use them',async()=>{
 const id=await activate('his_outbound',outbound());const draft=await bindActiveOutboundSettings(db,fixture(901));expect(draft.profile.style).toBe('short');expect(draft.settings.retryDelaysMs).toEqual([1000,2000]);await registerFixture(db,draft,'SYNTHETIC-HIS');const row=await reserveFixture(db,draft.fixtureId);await runTransfer(db,row.id);const done=await loadTransfer(db,row.id);expect(done.model.state).toBe('AWAITING_CONFIRMATION');expect(done.plan.settingsVersion).toBe('SYNTHETIC-SETTINGS-'+id);expect(await fs.readFile(path.join(root,'res',done.plan.okName))).toEqual(Buffer.from([255,254]));expect(await fs.readFile(path.join(root,'pdf',done.plan.pdfName))).toEqual(draft.pdf);expect((await readHistory(db,row.id)).hisConfirmed).toBe(false);expect(await fs.readFile(path.join(root,'backup',draft.fixtureId,'manifest.json'),'utf8')).toContain(done.plan.fingerprint);
});
it('configuration change cancels queued old-version transfer; new fixture uses new paths after restart',async()=>{
 const draft=await bindActiveOutboundSettings(db,fixture(902));await registerFixture(db,draft,'SYNTHETIC-HIS');const old=await reserveFixture(db,draft.fixtureId);await activate('his_outbound',outbound('-b'));await runTransfer(db,old.id);expect((await loadTransfer(db,old.id)).model.state).toBe('CANCELLED');await expect(fs.stat(path.join(root,'res',old.plan.okName))).rejects.toMatchObject({code:'ENOENT'});const fresh=await bindActiveOutboundSettings(db,fixture(903));await registerFixture(db,fresh,'SYNTHETIC-HIS');const row=await reserveFixture(db,fresh.fixtureId);await runTransfer(db,row.id);expect(await fs.readFile(path.join(root,'res-b',row.plan.okName))).toEqual(Buffer.from([255,254]));
});
it('existing engine recovers pre-checkpoint file without new sequence, retains clinical/historical HOLD and audited versions',async()=>{
 const d=await bindActiveOutboundSettings(db,fixture(904));await registerFixture(db,d,'SYNTHETIC-HIS');const row=await reserveFixture(db,d.fixtureId);await expect(runTransfer(db,row.id,{afterArtifact:async a=>{if(a==='PDF')throw Error('SYNTHETIC_RESTART');}})).rejects.toThrow('SYNTHETIC_RESTART');await runTransfer(db,row.id);expect((await loadTransfer(db,row.id)).plan.sequence).toBe(1);expect((await loadTransfer(db,row.id)).model.state).toBe('AWAITING_CONFIRMATION');await expect(registerFixture(db,{...fixture(905),origin:'HISTORICAL' as never},'SYNTHETIC-HIS')).rejects.toThrow();expect((await db.query<{allowed:boolean}>('SELECT p5_release_authorized() allowed')).rows[0].allowed).toBe(false);expect((await db.query('SELECT * FROM result_release')).rows).toHaveLength(0);const audits=(await db.query<{action:string}>('SELECT action FROM audit_chain')).rows.map(r=>r.action);for(const a of ['SETTING_PROPOSED','HIS_SETTINGS_TEST_QUEUED','HIS_SETTINGS_TEST_COMPLETED','SETTING_TESTED','SETTING_APPROVED','SETTING_ACTIVATED','P6_RESERVED'])expect(audits).toContain(a);
});
it('authorized transport failure records Error/Retry history and UI retry uses the same frozen journal/backoff',async()=>{
 const d=await bindActiveOutboundSettings(db,fixture(906));await registerFixture(db,d,'SYNTHETIC-HIS');const row=await reserveFixture(db,d.fixtureId);
 await runTransfer(db,row.id,{fileHook:async e=>{if(e.artifact==='RES'&&e.point==='AFTER_TEMP_SYNC')throw Error('SYNTHETIC_IO_FAILURE');}});const failed=await loadTransfer(db,row.id);expect(failed.model.state).toBe('RETRY_PENDING');
 expect((await hisMonitoring(db)).transfers.find(t=>t.id===row.id)).toMatchObject({state:'RETRY_PENDING',last_code:'IO_ERROR'});await expect(requestHisRetry(db,{...maker,roles:['AUDITOR']},row.id)).rejects.toThrow('FORBIDDEN');
 const q=await requestHisRetry(db,maker,row.id);const payload=(await db.query<{payload:unknown}>('SELECT payload FROM job_outbox WHERE id=$1',[q.jobId])).rows[0].payload;
 await new Promise(r=>setTimeout(r,1100));expect(await executeHisRetry(db,payload)).toMatchObject({state:'AWAITING_CONFIRMATION'});const done=await loadTransfer(db,row.id);expect(done.plan.fingerprint).toBe(failed.plan.fingerprint);expect(done.plan.sequence).toBe(failed.plan.sequence);expect(done.model.attempts).toBe(2);expect((await readHistory(db,row.id)).events.map(e=>e.code)).toContain('RETRY');await expect(requestHisRetry(db,maker,row.id)).rejects.toThrow('HIS_RETRY_NOT_ALLOWED');
});
it('same relative filename, size and mtime in a new physical root is read and deduplicated by bytes',async()=>{
 const pet=await pair('in-a',811),day=lookbackFolders(1,new Date())[0],a=path.join(root,'in-a',day,pet.filename),b=path.join(root,'in-b',day,pet.filename);await fs.copyFile(a,b);await fs.copyFile(a.replace('.pet','.ok'),b.replace('.pet','.ok'));const time=new Date('2026-10-14T00:00:00Z');await fs.utimes(a,time,time);await fs.utimes(b,time,time);
 const store=new FileStore(path.join(root,'files'));await activate('his_inbound',{...SETTINGS.his_inbound.default,enabled:true,basePath:path.join(root,'in-a'),lookbackDays:1});await executeInboundJob(db,'synthetic_scan',{trigger:'MANUAL'},store,key);
 await activate('his_inbound',{...SETTINGS.his_inbound.default,enabled:true,basePath:path.join(root,'in-b'),lookbackDays:1});const r=await executeInboundJob(db,'synthetic_scan',{trigger:'MANUAL'},store,key);expect((r.counts as Record<string,number>).sameContent).toBe(1);expect((await db.query('SELECT source_id FROM his_inbound_source WHERE sha256=$1',[pet.bytes? (await import('../../packages/storage')).sha256(pet.bytes):''])).rows).toHaveLength(2);
});
it('temporarily unavailable authorized destination remains retryable before any OK is published',async()=>{
 const d=await bindActiveOutboundSettings(db,fixture(907));await registerFixture(db,d,'SYNTHETIC-HIS');const row=await reserveFixture(db,d.fixtureId);const original=path.join(root,'pdf-b'),offline=path.join(root,'pdf-offline');await fs.rename(original,offline);
 try{await runTransfer(db,row.id);expect((await loadTransfer(db,row.id)).model.state).toBe('RETRY_PENDING');expect(await runTransfer(db,row.id)).toBe('BACKOFF_PENDING');}finally{await fs.rename(offline,original);}
 await new Promise(r=>setTimeout(r,1100));await runTransfer(db,row.id);const done=await loadTransfer(db,row.id);expect(done.model.state).toBe('AWAITING_CONFIRMATION');expect(done.model.attempts).toBe(2);expect((await readHistory(db,row.id)).events.some(e=>e.event.accessCode==='SHARE_PATH_NOT_FOUND')).toBe(true);
});
