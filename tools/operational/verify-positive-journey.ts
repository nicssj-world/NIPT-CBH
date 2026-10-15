import {verifyOperationalRecovery} from './verify-recovery';
import {positiveJourney} from './positive-journey-steps';
/** Explicit disposable operational runtime exercise: test identities only, no hospital paths. */
import {execFileSync,spawn,type ChildProcess} from 'node:child_process';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {chromium,expect,type Page} from '@playwright/test';
import {migrate} from '../migrate';
import {configureOperational} from '../configure-operational';
import {hashPassword} from '../../packages/security/password';
import {workerServiceAccount} from '../../packages/integrations/authorized-share';
import type {Principal} from '../../packages/security/policy';
if(process.env.NIPT_OPERATIONAL_TEST_BUILT_WEB!=='yes')throw Error('COMPILED_NEXT_BUILD_REQUIRED');
const bin=process.env.NIPT_OPERATIONAL_TEST_PG_BIN;if(!bin)throw Error('EXISTING_POSTGRES_BIN_REQUIRED');
await fs.mkdir('.local',{recursive:true});const base=await fs.mkdtemp(path.resolve('.local/operational-positive-')),pgdata=path.join(base,'pgdata'),events:string[]=[];
const exe=(name:string)=>path.join(bin,name+(process.platform==='win32'?'.exe':''));
const run=(name:string,args:string[])=>execFileSync(exe(name),args,{windowsHide:true,stdio:'ignore'});
const freePort=()=>new Promise<number>((resolve,reject)=>{const server=net.createServer();server.once('error',reject);server.listen(0,'127.0.0.1',()=>{const port=(server.address() as net.AddressInfo).port;server.close(()=>resolve(port));});});
const pgPort=await freePort(),webPort=await freePort(),tlsPort=await freePort(),origin='https://127.0.0.1:'+tlsPort,dbName='nipt_operational_test';
let database:Pool|undefined,browser:Awaited<ReturnType<typeof chromium.launch>>|undefined,proxy:https.Server|undefined,pgStarted=false;
const children:ChildProcess[]=[];const browserErrors:string[]=[];
async function waitFor(check:()=>Promise<boolean>,label:string,timeout=90000){const start=Date.now();while(Date.now()-start<timeout){if(await check().catch(()=>false))return;await new Promise(r=>setTimeout(r,250));}throw Error('TIMEOUT_'+label);}
async function stop(child:ChildProcess){if(child.exitCode!==null)return;if(child.connected){child.send('STOP_DISPOSABLE_WORKER');await waitFor(async()=>child.exitCode!==null,'GRACEFUL_WORKER_STOP',40000);return;}if(process.platform==='win32'){try{execFileSync('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'pipe'});}catch{}}else child.kill('SIGTERM');await waitFor(async()=>child.exitCode!==null,'CHILD_STOP',10000);}
try{
 const inbound=path.join(base,'inbound');await fs.mkdir(inbound);const policy=path.join(base,'share-policy.json'),lookup=path.join(base,'lookup.key');await fs.writeFile(lookup,randomBytes(32));await fs.writeFile(policy,JSON.stringify({version:1,grants:[{root:inbound,purposes:['INBOUND'],serviceAccount:workerServiceAccount(),secretRef:null,mode:'operational'}]}));
 const key=path.join(base,'tls.key'),cert=path.join(base,'tls.crt');execFileSync(process.env.NIPT_TEST_OPENSSL??'C:/Program Files/Git/usr/bin/openssl.exe',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','1','-subj','/CN=localhost','-addext','subjectAltName=IP:127.0.0.1,DNS:localhost'],{windowsHide:true,stdio:'pipe'});
 run('initdb',['-D',pgdata,'-U','nipt_test_owner','-A','trust','--no-locale','-E','UTF8']);run('pg_ctl',['-D',pgdata,'-l',path.join(base,'postgres.log'),'-o',`-p ${pgPort} -h 127.0.0.1`,'-w','start']);pgStarted=true;
 const ownerUrl=`postgresql://nipt_test_owner@127.0.0.1:${pgPort}/${dbName}`,bootstrap=new Pool({connectionString:ownerUrl.replace('/'+dbName,'/postgres')});await bootstrap.query('CREATE DATABASE '+dbName);await bootstrap.end();database=new Pool({connectionString:ownerUrl});await migrate(database);const ledgerBefore=await database.query('SELECT name,checksum FROM schema_migration ORDER BY name');await migrate(database);assert.deepEqual((await database.query('SELECT name,checksum FROM schema_migration ORDER BY name')).rows,ledgerBefore.rows);events.push('MIGRATION_REAPPLY_CHECKSUM_IDEMPOTENCE');
 process.env.NIPT_MODE='operational';process.env.APP_ORIGIN=origin;await configureOperational(database);
 await database.query(await fs.readFile('packages/db/roles.sql','utf8'));await database.query(await fs.readFile('packages/p6/grants.sql','utf8'));
 await database.query('CREATE ROLE nipt_test_app LOGIN; GRANT app_rw TO nipt_test_app; CREATE ROLE nipt_test_worker LOGIN; GRANT worker_rw TO nipt_test_worker; GRANT CREATE ON DATABASE '+dbName+' TO nipt_test_worker;');
 const password='Operational-Test-'+randomUUID()+'!',hash=await hashPassword(password),users:Record<string,Principal>={};
 for(const [name,role] of [['test.admin','APP_ADMIN'],['test.lab','LAB_STAFF'],['test.certifier','LAB_CERTIFIER'],['test.reviewer','CLINICAL_APPROVER']] as const){const id=(await database.query('INSERT INTO app_user(username,display_name,password_hash) VALUES($1,$1,$2) RETURNING id',[name,hash])).rows[0].id;users[name]={id,roles:[role],unitIds:[],permissions:[]};}
 for(const [name,u] of Object.entries(users))await database.query('INSERT INTO role_assignment(user_id,role,approved_by) VALUES($1,$2,$3)',[u.id,u.roles[0],name==='test.certifier'?users['test.admin'].id:null]);
 const unit=(await database.query("INSERT INTO unit(code,name) VALUES('TEST-OP','หน่วยทดสอบ') RETURNING id")).rows[0].id;
 if(process.argv.includes('--anc')){await database.query("INSERT INTO role_assignment(user_id,role) VALUES($1,'ANC_NURSE')",[users['test.lab'].id]);await database.query('INSERT INTO user_unit_scope(user_id,unit_id) VALUES($1,$2)',[users['test.lab'].id,unit]);}
 const rendererPort=await freePort();
 const env={...process.env,RENDERER_TOKEN:randomBytes(32).toString('hex'),RENDERER_PORT:String(rendererPort),RENDERER_URL:'http://127.0.0.1:'+rendererPort,NIPT_MODE:'operational',NIPT_OPERATIONAL_DATABASE:dbName,APP_ORIGIN:origin,NIPT_HIS_SHARE_POLICY_FILE:policy,IDENTITY_LOOKUP_KEY_FILE:lookup,FILE_STORE_ROOT:path.join(base,'files'),SIMULATOR_ROOT:path.join(base,'simulator'),NEXT_TELEMETRY_DISABLED:'1'};
 async function launch(runtimeEnv:NodeJS.ProcessEnv){for(const kind of ['renderer','worker','web']){const log=await fs.open(path.join(base,kind+'.log'),'a'),args=kind==='web'?['node_modules/next/dist/bin/next',...(process.env.NIPT_OPERATIONAL_TEST_BUILT_WEB==='yes'?['start']:['dev','--webpack']),'--hostname','127.0.0.1','--port',String(webPort)]:["node_modules/tsx/dist/cli.mjs",kind==='renderer'?'apps/renderer/main.ts':'tools/operational/worker-process.ts'];const child=spawn(process.execPath,args,{windowsHide:true,env:{...runtimeEnv,DATABASE_URL:runtimeEnv.DATABASE_URL!.replace('nipt_test_owner',kind==='web'?'nipt_test_app':'nipt_test_worker')},stdio:kind==='worker'?['ignore',log.fd,log.fd,'ipc']:['ignore',log.fd,log.fd]});children.push(child);await log.close();}}
 await launch({...env,DATABASE_URL:ownerUrl});

 await waitFor(async()=>!!(await database!.query("SELECT 1 FROM worker_heartbeat WHERE worker_id='operational-worker'")).rowCount,'WORKER_START');events.push('OPERATIONAL_WORKER_LEAST_PRIVILEGE_STARTED');
 proxy=https.createServer({key:await fs.readFile(key),cert:await fs.readFile(cert)},(request,response)=>{const upstream=http.request({hostname:'127.0.0.1',port:webPort,path:request.url,method:request.method,headers:{...request.headers,'x-forwarded-proto':'https','x-forwarded-host':request.headers.host}},reply=>{response.writeHead(reply.statusCode??502,reply.headers);reply.pipe(response);});upstream.on('error',()=>{if(!response.headersSent)response.writeHead(502);response.end();});request.pipe(upstream);});await new Promise<void>(resolve=>proxy!.listen(tlsPort,'127.0.0.1',resolve));
 browser=await chromium.launch({headless:true});const labContext=await browser.newContext({baseURL:origin,ignoreHTTPSErrors:true}),certContext=await browser.newContext({baseURL:origin,ignoreHTTPSErrors:true}),reviewContext=await browser.newContext({baseURL:origin,ignoreHTTPSErrors:true});
 await waitFor(async()=>(await labContext.request.get('/login')).ok(),'WEB_START');
 const lab=await labContext.newPage(),certifier=await certContext.newPage(),reviewer=await reviewContext.newPage();
 for(const page of [lab,certifier,reviewer]){page.on('pageerror',error=>browserErrors.push(error.message));page.on('console',message=>{if(message.type()==='error')browserErrors.push(message.text()+' '+message.location().url);});}
 async function login(page:Page,name:string){await page.goto('/login');await page.getByLabel('ชื่อผู้ใช้',{exact:true}).fill(name);await page.getByLabel('รหัสผ่าน',{exact:true}).fill(password);await page.getByRole('button',{name:'เข้าสู่ระบบ',exact:true}).click();await expect(page).not.toHaveURL(/\/login$/);}
 await login(lab,'test.lab');await login(certifier,'test.certifier');await login(reviewer,'test.reviewer');const cookies=await labContext.cookies();assert.equal(cookies.find(c=>c.name==='nipt_session')?.secure,true);events.push('HTTPS_LOGIN_SECURE_COOKIES');
 async function api(page:Page,url:string,body?:unknown){const out=await page.evaluate(async({url,body})=>{const token=document.cookie.split('; ').find(x=>x.startsWith('nipt_csrf='))?.split('=').slice(1).join('=')??'';const r=await fetch(url,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json','x-csrf-token':token},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:r.status,data:await r.json()};},{url,body});if(out.status>=400)throw Error('API_'+out.status+'_'+JSON.stringify(out.data));return out.data;}

 await positiveJourney({anc:process.argv.includes('--anc'),workflowOnly:process.argv.includes('--workflow-only'),db:database,base,inbound,policy,unit,lab,certifier,reviewer,users,api,waitFor,events});
 if(process.argv.includes('--recovery'))await verifyOperationalRecovery({db:database,base,ownerUrl,env,events,waitFor,stopWriters:async()=>{await browser?.close();browser=undefined;for(const child of [...children].reverse())await stop(child);},restart:launch});
 assert.deepEqual(browserErrors,[],'positive browser pages must have no runtime/resource errors');
 const evidence={passed:true,sourceHead:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),browserErrors,completeNativeDocumentJourney:!process.argv.includes('--workflow-only'),poolPdf:process.argv.includes('--workflow-only')?'NOT_RUN_WORKFLOW_ONLY_DIAGNOSTIC':'PASS',events,environment:'DISPOSABLE_LOOPBACK_OPERATIONAL_TEST_IDENTITIES',productionBuild:true,physicalHalosAcceptance:'NOT_RUN',hospitalLanAcceptance:'NOT_RUN',hisConfirmed:false};
 await fs.writeFile(path.join(base,'evidence.json'),JSON.stringify(evidence,null,2));process.stdout.write(JSON.stringify({...evidence,artifactDirectory:base})+'\n');
}catch(error){await fs.writeFile(path.join(base,'failure.json'),JSON.stringify({events,browserErrors,error:error instanceof Error?error.stack:'FAILED'},null,2));throw error;}
finally{await browser?.close();if(proxy)await new Promise<void>(resolve=>proxy!.close(()=>resolve()));for(const child of children.reverse())await stop(child);await database?.end();if(pgStarted)run('pg_ctl',['-D',pgdata,'-m','immediate','-w','stop']);}
