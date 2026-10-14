import {workerServiceAccount} from '../../packages/integrations/authorized-share';
/** Explicit opt-in, disposable loopback PostgreSQL + actual web/worker processes.
 * No existing DB/env file or hospital path is used. Requires installed PostgreSQL binaries. */
import {execFileSync,spawn,type ChildProcess} from 'node:child_process';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {chromium,expect,type Page} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {migrate} from '../migrate';
import {hashPassword} from '../../packages/security/password';
import {syntheticPet} from '../../packages/integrations/pet';
import {lookbackFolders} from '../../packages/inbound/discovery';
import {bindActiveOutboundSettings} from '../../packages/settings/his';
import {registerFixture,reserveFixture,loadTransfer} from '../../packages/p6/journal';
import {sandboxFixture} from '../p6/fixtures';
import {SETTINGS} from '../../packages/settings/catalog';
const bin=process.env.NIPT_HIS_TEST_PG_BIN;if(!bin)throw Error('Set NIPT_HIS_TEST_PG_BIN to existing PostgreSQL bin directory');
const base=await fs.mkdtemp(path.resolve('.local/his-native-')),pgdata=path.join(base,'pgdata'),share=path.join(base,'share'),events:string[]=[];
const exe=(name:string)=>path.join(bin,name+(process.platform==='win32'?'.exe':''));
const run=(name:string,args:string[])=>execFileSync(exe(name),args,{windowsHide:true,stdio:'ignore'});
const freePort=()=>new Promise<number>((resolve,reject)=>{const server=net.createServer();server.once('error',reject);server.listen(0,'127.0.0.1',()=>{const port=(server.address() as net.AddressInfo).port;server.close(()=>resolve(port));});});
const pgPort=await freePort(),webPort=await freePort(),origin='http://127.0.0.1:'+webPort,dbName='nipt_his_synthetic';
let database:Pool|undefined,worker:ChildProcess|undefined,pgStarted=false,browser:Awaited<ReturnType<typeof chromium.launch>>|undefined;
const children:ChildProcess[]=[];
async function waitFor(check:()=>Promise<boolean>,label:string,timeout=90000){const start=Date.now();while(Date.now()-start<timeout){if(await check().catch(()=>false))return;await new Promise(r=>setTimeout(r,250));}throw Error('TIMEOUT_'+label);}
async function stop(child?:ChildProcess){if(!child||child.exitCode!==null)return;if(process.platform==='win32'){try{execFileSync('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'pipe'});}catch{}}else child.kill('SIGTERM');await waitFor(async()=>child.exitCode!==null,'CHILD_STOP',10000);}
try{
 await fs.mkdir(share);for(const name of ['in-a','in-b','res','pdf','backup','res-b','pdf-b','backup-b'])await fs.mkdir(path.join(share,name));
 await fs.writeFile(path.join(share,'.nipt-authorized-test-root'),'NIPT_AUTHORIZED_SYNTHETIC_SHARE_V1');
 const policy=path.join(base,'share-policy.json');await fs.writeFile(policy,JSON.stringify({version:1,grants:[{root:share,purposes:['INBOUND','OUTBOUND'],serviceAccount:workerServiceAccount(),secretRef:null}]}));
 const lookup=path.join(base,'lookup.key');await fs.writeFile(lookup,randomBytes(32));
 run('initdb',['-D',pgdata,'-U','nipt_test_owner','-A','trust','--no-locale','-E','UTF8']);
 run('pg_ctl',['-D',pgdata,'-l',path.join(base,'postgres.log'),'-o',`-p ${pgPort} -h 127.0.0.1`,'-w','start']);pgStarted=true;
 const adminUrl=`postgresql://nipt_test_owner@127.0.0.1:${pgPort}/${dbName}`,bootstrap=new Pool({connectionString:adminUrl.replace('/'+dbName,'/postgres')});
 await bootstrap.query('CREATE DATABASE '+dbName);await bootstrap.end();database=new Pool({connectionString:adminUrl});await migrate(database);
 await database.query(await fs.readFile('packages/db/roles.sql','utf8'));await database.query(await fs.readFile('packages/p6/grants.sql','utf8'));
 await database.query('CREATE ROLE nipt_test_app LOGIN; GRANT app_rw TO nipt_test_app; CREATE ROLE nipt_test_worker LOGIN; GRANT worker_rw TO nipt_test_worker; GRANT CREATE ON DATABASE '+dbName+' TO nipt_test_worker;');
 const password='Synthetic-Native-'+randomUUID()+'!',passwordHash=await hashPassword(password);
 for(const [username,role] of [['synthetic.his.maker','APP_ADMIN'],['synthetic.his.checker','CLINICAL_APPROVER']]){const u=(await database.query('INSERT INTO app_user(username,display_name,password_hash) VALUES($1,$1,$2) RETURNING id',[username,passwordHash])).rows[0];await database.query('INSERT INTO role_assignment(user_id,role) VALUES($1,$2)',[u.id,role]);}
 const env={...process.env,NIPT_MODE:'synthetic',APP_ORIGIN:origin,NIPT_P6_SANDBOX_ENABLED:'yes',NIPT_HIS_SHARE_POLICY_FILE:policy,IDENTITY_LOOKUP_KEY_FILE:lookup,FILE_STORE_ROOT:path.join(base,'files'),SIMULATOR_ROOT:path.join(base,'simulator'),NEXT_TELEMETRY_DISABLED:'1'};
 const launch=async(kind:'web'|'worker')=>{const logs=await fs.open(path.join(base,kind+'-'+Date.now()+'.log'),'a'),args=kind==='web'?['node_modules/next/dist/bin/next',...(process.env.NIPT_HIS_TEST_BUILT_WEB==='yes'?['start']:['dev','--webpack']),'--hostname','127.0.0.1','--port',String(webPort)]:['node_modules/tsx/dist/cli.mjs','apps/worker/main.ts'];const child=spawn(process.execPath,args,{cwd:process.cwd(),windowsHide:true,env:{...env,DATABASE_URL:adminUrl.replace('nipt_test_owner',kind==='web'?'nipt_test_app':'nipt_test_worker')},stdio:['ignore',logs.fd,logs.fd]});children.push(child);await logs.close();return child;};
 const startWorker=async()=>{const before=new Date();worker=await launch('worker');await waitFor(async()=>!!(await database!.query('SELECT 1 FROM worker_heartbeat WHERE observed_at>$1',[before])).rowCount,'WORKER_HEARTBEAT');};
 await startWorker();await launch('web');await waitFor(async()=>(await fetch(origin+'/login')).ok,'WEB_START');
 browser=await chromium.launch({headless:true});const makerContext=await browser.newContext({baseURL:origin}),checkerContext=await browser.newContext({baseURL:origin});const maker=await makerContext.newPage(),checker=await checkerContext.newPage();
 async function login(page:Page,name:string){await page.goto('/login');await page.getByLabel('ชื่อผู้ใช้',{exact:true}).fill(name);await page.getByLabel('รหัสผ่าน',{exact:true}).fill(password);await expect(page.getByRole('button',{name:'เข้าสู่ระบบ',exact:true})).toBeEnabled();await page.getByRole('button',{name:'เข้าสู่ระบบ',exact:true}).click();await expect(page).toHaveURL(origin+'/');}
 await login(maker,'synthetic.his.maker');await login(checker,'synthetic.his.checker');
 async function post(page:Page,url:string,data:unknown){const me=await page.request.get('/api/me').then(r=>r.json());const r=await page.request.post(url,{headers:{origin,'x-csrf-token':me.csrf},data});assert.equal(r.ok(),true,await r.text());return r.json();}
 async function pair(folder:string,index:number){const p=syntheticPet(index),day=lookbackFolders(1,new Date())[0],dir=path.join(share,folder,day);await fs.mkdir(dir,{recursive:true});await fs.writeFile(path.join(dir,p.filename),p.bytes);await fs.writeFile(path.join(dir,p.filename.replace('.pet','.ok')),Buffer.alloc(0));return p;}
 await pair('in-a',87001);await maker.goto('/settings?key=his_inbound');await expect(maker.getByLabel('โฟลเดอร์ขาเข้า',{exact:true})).toBeVisible();await maker.getByLabel('โฟลเดอร์ขาเข้า',{exact:true}).fill(path.join(share,'in-a'));await maker.getByLabel('เปิดการสแกนอัตโนมัติ',{exact:true}).check();await maker.getByLabel('รอบการสแกน (วินาที)',{exact:true}).fill('5');await maker.getByLabel('เหตุผลที่เปลี่ยน',{exact:true}).fill('SYNTHETIC_NATIVE_VERIFY');await maker.getByRole('button',{name:'บันทึกร่าง',exact:true}).click();await expect(maker.getByRole('button',{name:'ทดสอบร่าง',exact:true})).toBeVisible();await maker.getByRole('button',{name:'ทดสอบร่าง',exact:true}).click();await expect(maker.getByRole('button',{name:'บันทึกผลทดสอบผ่านของร่างนี้',exact:true})).toBeVisible({timeout:30000});await maker.getByRole('button',{name:'บันทึกผลทดสอบผ่านของร่างนี้',exact:true}).click();
 let incoming=(await database.query("SELECT id FROM settings_revision WHERE setting_key='his_inbound' ORDER BY version DESC LIMIT 1")).rows[0].id;
 await waitFor(async()=>(await database!.query('SELECT state FROM settings_revision WHERE id=$1',[incoming])).rows[0].state==='Validated','UI_VALIDATE');
 async function approve(id:string){await post(checker,'/api/settings',{operation:'approve',id});await post(checker,'/api/settings',{operation:'activate',id});}
 await approve(incoming);await waitFor(async()=>!!(await database!.query('SELECT 1 FROM his_inbound_file')).rowCount,'FIRST_SCAN');events.push('BROWSER_SAVE_WORKER_VALIDATE_APPROVE_ACTIVATE','ACTIVE_INBOUND_SCAN');
 async function configure(key:string,value:unknown){const {id}=await post(maker,'/api/settings',{operation:'propose',key,value,reason:'SYNTHETIC_NATIVE_VERIFY'});const q=await post(maker,'/api/settings',{operation:'validate',id});await waitFor(async()=>!!(await database!.query('SELECT 1 FROM integration_job_receipt WHERE outbox_id=$1',[q.jobId])).rowCount,'WORKER_TEST');const result=(await database!.query('SELECT result FROM integration_job_receipt WHERE outbox_id=$1',[q.jobId])).rows[0].result;assert.equal(result.passed,true,JSON.stringify(result));await post(maker,'/api/settings',{operation:'validate',id});await approve(id);return id;}
 await pair('in-b',87002);incoming=await configure('his_inbound',{...SETTINGS.his_inbound.default,enabled:true,basePath:path.join(share,'in-b'),intervalSeconds:5,lookbackDays:1});await waitFor(async()=>(await database!.query('SELECT count(*)::int n FROM his_inbound_file')).rows[0].n===2,'CHANGED_SCAN');
 await stop(worker);await startWorker();await pair('in-b',87003);await waitFor(async()=>(await database!.query('SELECT count(*)::int n FROM his_inbound_file')).rows[0].n===3,'RESTART_SCAN');await new Promise(r=>setTimeout(r,5500));assert.equal((await database.query('SELECT count(*)::int n FROM his_inbound_file')).rows[0].n,3);events.push('ACTIVE_PATH_VERSION_CHANGE','REAL_WORKER_PROCESS_RESTART','PET_OK_DUPLICATE_PROTECTION');
 const outbound=(suffix='')=>({...SETTINGS.his_outbound.default,enabled:true,resultStyle:'short',retryLimit:2,retryDelaySeconds:1,resDestinationPath:path.join(share,'res'+suffix),pdfDestinationPath:path.join(share,'pdf'+suffix),backupPath:path.join(share,'backup'+suffix)});
 await configure('his_outbound',outbound());
 process.env.NIPT_MODE='synthetic';process.env.NIPT_P6_SANDBOX_ENABLED='yes';process.env.NIPT_HIS_SHARE_POLICY_FILE=policy;
 async function enroll(n:number){const client=await database!.connect();try{const d=await bindActiveOutboundSettings(client,sandboxFixture(n));await registerFixture(client,d,'SYNTHETIC-NATIVE-HIS');return {row:await reserveFixture(client,d.fixtureId),draft:d};}finally{client.release();}}
 const first=await enroll(87004);await waitFor(async()=>(await loadTransfer(database!,first.row.id)).model.state==='AWAITING_CONFIRMATION','OUTBOUND');assert.deepEqual(await fs.readFile(path.join(share,'res',first.row.plan.okName)),Buffer.from([255,254]));assert.deepEqual(await fs.readFile(path.join(share,'pdf',first.row.plan.pdfName)),first.draft.pdf);assert.ok((await fs.readFile(path.join(share,'backup',first.draft.fixtureId,'manifest.json'),'utf8')).includes(first.row.plan.fingerprint));events.push('REAL_WORKER_RES_PDF_OK_BACKUP');
 await stop(worker);const stale=await enroll(87005);await configureWithoutWorker();
 async function configureWithoutWorker(){// Validation still goes through a real Worker, with old transfer held by its advisory lock.
  const locked=await database!.connect();await locked.query('SELECT pg_advisory_lock(hashtextextended($1,0))',['P6_SANDBOX_TRANSFER:'+stale.row.id]);await startWorker();try{await configure('his_outbound',outbound('-b'));}finally{await locked.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',['P6_SANDBOX_TRANSFER:'+stale.row.id]);locked.release();}}
 await waitFor(async()=>(await loadTransfer(database!,stale.row.id)).model.state==='CANCELLED','STALE_CONFIG_CANCEL');const next=await enroll(87006);await waitFor(async()=>(await loadTransfer(database!,next.row.id)).model.state==='AWAITING_CONFIRMATION','NEW_OUTBOUND');assert.deepEqual(await fs.readFile(path.join(share,'res-b',next.row.plan.okName)),Buffer.from([255,254]));events.push('OUTBOUND_CONFIGURATION_CHANGE_CANCELS_OLD','NEW_OUTBOUND_DESTINATION');
 await maker.goto('/settings?key=his_outbound');await expect(maker.getByText('Transfer Status / Retry',{exact:true})).toBeVisible();await expect(maker.getByText('AWAITING_CONFIRMATION',{exact:false}).first()).toBeVisible();await maker.getByRole('button',{name:'ดูประวัติ / Error',exact:true}).first().click();await expect(maker.getByRole('region',{name:'ประวัติการส่ง',exact:true})).toBeVisible();assert.deepEqual((await new AxeBuilder({page:maker}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze()).violations,[]);await maker.screenshot({path:path.join(base,'settings-outbound.png'),fullPage:true});events.push('BROWSER_TRANSFER_STATUS_HISTORY','SETTINGS_AXE_PASS');
 assert.equal((await database.query('SELECT p5_release_authorized() allowed')).rows[0].allowed,false);assert.equal((await database.query('SELECT count(*)::int n FROM result_release')).rows[0].n,0);
 const workerDb=new Pool({connectionString:adminUrl.replace('nipt_test_owner','nipt_test_worker')});await assert.rejects(workerDb.query("UPDATE settings_revision SET test_passed=true"),/permission denied/);await assert.rejects(workerDb.query("INSERT INTO p6_fixture(id) VALUES('SYNTHETIC-FORBIDDEN')"),/permission denied/);await workerDb.end();events.push('WORKER_DB_LEAST_PRIVILEGE','CLINICAL_RELEASE_HOLD');
 const evidence={passed:true,events,hospitalLanAcceptance:'NOT_RUN',uncSmbAcceptance:'NOT_RUN',environment:'ISOLATED_LOCAL_DIRECTORIES_LOOPBACK_POSTGRES',clinicalPublisherEnabled:false};await fs.writeFile(path.join(base,'evidence.json'),JSON.stringify(evidence,null,2));process.stdout.write(JSON.stringify({...evidence,artifactDirectory:base})+'\n');
}catch(e){await fs.writeFile(path.join(base,'failure.json'),JSON.stringify({events,error:e instanceof Error?e.message:'FAILED'},null,2));throw e;}
finally{await browser?.close();for(const child of children.reverse())await stop(child);await database?.end();if(pgStarted)run('pg_ctl',['-D',pgdata,'-m','immediate','-w','stop']);}
