// Isolated synthetic browser environment for the Consent + Run Photo Evidence integration (tools/run-photos-e2e/e2e.ts pattern).
// Uses a disposable loopback PostgreSQL 17 cluster named by NIPT_INTEG_E2E_PG_URL (bootstrap database, not Docker: the Docker
// address pools on this machine are exhausted), loopback ports 19828/19830, a fresh reserved browser database per run, synthetic
// mode only. Never targets the UX-V2 preview, the P0 or photo runners, Integrated UAT or any real database.
import {spawn,execFileSync} from 'node:child_process';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import {randomBytes} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {Pool} from 'pg';
import {migrate} from '../migrate';
import {workerServiceAccount} from '../../packages/integrations/authorized-share';
const repo=process.cwd(),localRoot=path.resolve('.local'),base=path.resolve(process.env.NIPT_INTEG_E2E_BASE??'.local/integration-e2e'),project='nipt-integ-consent-photos-20261018';
if(!base.startsWith(localRoot+path.sep))throw Error('INTEGRATION_E2E_BASE_MUST_BE_UNDER_LOCAL');
if(process.env.NIPT_INTEG_E2E_BASE){try{await fs.access(base);throw Error('INTEGRATION_E2E_BASE_MUST_BE_FRESH');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}}
if(!['NIPT-CBH-INTEG-CONSENT-PHOTOS','NIPT-CBH-UX-PROJECTWIDE','NIPT-CBH-PAGINATION','NIPT-CBH-PARITY-REMEDIATION'].includes(path.basename(repo)))throw Error('ISOLATED_WORKTREE_REQUIRED');
const bootstrapUrl=process.env.NIPT_INTEG_E2E_PG_URL??'';
if(!/^postgres(ql)?:\/\/[^@]+@127\.0\.0\.1:\d+\/postgres$/.test(bootstrapUrl))throw Error('LOOPBACK_BOOTSTRAP_DATABASE_REQUIRED');
await fs.mkdir(base,{recursive:true});
const webPort=Number(process.env.NIPT_INTEG_E2E_WEB_PORT??19828),rendererPort=Number(process.env.NIPT_INTEG_E2E_RENDERER_PORT??19830);
if(![webPort,rendererPort].every(p=>Number.isInteger(p)&&p>1024&&p<65536)||webPort===rendererPort)throw Error('DISTINCT_LOOPBACK_PORTS_REQUIRED');
for(const port of [webPort,rendererPort])await new Promise<void>((resolve,reject)=>{const server=net.createServer();server.once('error',reject);server.listen(port,'127.0.0.1',()=>server.close(()=>resolve()));});
// The reserved-browser-database guard (tests/helpers/browser-database.ts) is kept unchanged: the name uses its approved prefix.
const database='nipt_synthetic_p2_browser_photos_'+randomBytes(6).toString('hex');
const bootstrap=new Pool({connectionString:bootstrapUrl});
try{await bootstrap.query('CREATE DATABASE '+database);}finally{await bootstrap.end();}
const dbUrl=new URL(bootstrapUrl);dbUrl.pathname='/'+database;const url=dbUrl.toString(),origin='http://127.0.0.1:'+webPort;
process.env.NIPT_MODE='synthetic';const db=new Pool({connectionString:url});try{await migrate(db);}finally{await db.end();}
execFileSync(process.execPath,['--import',pathToFileURL(path.join(repo,'node_modules/tsx/dist/loader.mjs')).href,path.join(repo,'tools/init-dev.ts')],{cwd:base,windowsHide:true,stdio:'ignore'});
const key=(name:string)=>path.join(base,'data/keys',name);
async function copyTreeIfChanged(source:string,destination:string) {
 await fs.cp(source,destination,{recursive:true,filter:async(from,to)=>{
  if((await fs.stat(from)).isDirectory())return true;
  try{return !(await fs.readFile(from)).equals(await fs.readFile(to));}
  catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return true;throw error;}
 }});
}
// Photo roots for this run: the installation default and two candidate "admin" folders (a local folder and a second one the
// offline test renames). Reset per run.
const photos=path.join(base,'data/photos');await fs.rm(photos,{recursive:true,force:true});for(const d of ['nas-a','nas-b'])await fs.mkdir(path.join(photos,d),{recursive:true});
const screens=path.join(base,'screens');await fs.rm(screens,{recursive:true,force:true});await fs.mkdir(screens,{recursive:true});
const env={...process.env,NIPT_MODE:'synthetic',DATABASE_URL:url,NIPT_E2E_AUDIT_DATABASE_URL:url,APP_ORIGIN:origin,E2E_BASE_URL:origin,HOSTNAME:'127.0.0.1',PORT:String(webPort),FILE_STORE_ROOT:path.join(base,'data/files'),SIMULATOR_ROOT:path.join(base,'data/simulator'),RENDERER_URL:'http://127.0.0.1:'+rendererPort,RENDERER_PORT:String(rendererPort),RENDERER_TOKEN_FILE:key('renderer-token'),INTEGRATION_PUBLIC_KEY_FILE:key('integration-public.pem'),INTEGRATION_PRIVATE_KEY_FILE:key('integration-private.pem'),IDENTITY_ENCRYPTION_KEY_FILE:key('identity.key'),IDENTITY_LOOKUP_KEY_FILE:key('lookup.key'),BACKUP_KEY_FILE:key('backup.key'),SYNTHETIC_SEED_PASSWORD_FILE:path.join(base,'data/secrets/seed-password'),
 NIPT_E2E_EVIDENCE_DIR:path.join(base,'evidence'),NIPT_E2E_P2_EVIDENCE_DIR:path.join(base,'evidence/p2'),NIPT_E2E_P2_VISUAL_DIR:path.join(screens,'p2'),NIPT_E2E_P4_EVIDENCE_DIR:path.join(base,'evidence/p4'),NIPT_E2E_OUTPUT_DIR:path.join(base,'playwright-results'),NIPT_E2E_HTML_REPORT_DIR:path.join(base,'playwright-report'),
 RUN_PHOTO_DEFAULT_ROOT:path.join(photos,'default'),NIPT_E2E_PHOTO_ROOT:photos,NIPT_E2E_SCREEN_DIR:screens,RUN_PHOTO_STORAGE_TIMEOUT_MS:'4000',
 NIPT_TASK_MASTER_PATH:process.env.NIPT_TASK_MASTER_PATH??'C:/Users/User/Downloads/NIPT_CBH_Final_Combined_Master_2026-10-15.xlsx'};
await copyTreeIfChanged(path.join(repo,'public'),path.join(repo,'.next/standalone/public'));
await copyTreeIfChanged(path.join(repo,'.next/static'),path.join(repo,'.next/standalone/.next/static'));
await fs.mkdir(env.FILE_STORE_ROOT,{recursive:true});await fs.mkdir(path.join(env.SIMULATOR_ROOT,'inbound'),{recursive:true});await fs.mkdir(path.join(env.SIMULATOR_ROOT,'results'),{recursive:true});await fs.writeFile(path.join(env.SIMULATOR_ROOT,'.nipt-synthetic-root'),'NIPT_SYNTHETIC_ONLY_V1');
const hisShare=path.join(base,'data/his-share');await fs.rm(hisShare,{recursive:true,force:true});for(const d of ['in-a','in-b','res','pdf','backup'])await fs.mkdir(path.join(hisShare,d),{recursive:true});
await fs.writeFile(path.join(hisShare,'.nipt-authorized-test-root'),'NIPT_AUTHORIZED_SYNTHETIC_SHARE_V1');
const sharePolicy=path.join(base,'data/his-share-policy.json');await fs.writeFile(sharePolicy,JSON.stringify({version:1,grants:[{root:hisShare,purposes:['INBOUND','OUTBOUND'],serviceAccount:workerServiceAccount(),secretRef:null}]}));
Object.assign(env,{NIPT_HIS_SHARE_POLICY_FILE:sharePolicy,NIPT_E2E_HIS_SHARE_ROOT:hisShare,NIPT_P6_SANDBOX_ENABLED:'yes'});
// ANC form preview: installation registry of the Owner-supplied DCC reference PDFs (read in place, never copied into the repository).
const formSrc=process.env.NIPT_ANC_FORM_SOURCE_DIR??'C:/Users/User/OneDrive/Desktop/NIPT-Audit',formFiles={request:'FM-WI-T-BM17_01 ใบขอส่งตรวจคัดกรอง CBH-NIPT.pdf',consent:'FM-WI-T-BM17_02 เอกสารยินยอมรับการตรวจคัดกรอง CBH-NIPT(1).pdf'};
try{const {createHash}=await import('node:crypto');const entry=async(name:string,code:string,page:string)=>{const p=path.join(formSrc,name);return {path:p,sha256:createHash('sha256').update(await fs.readFile(p)).digest('hex'),docCode:code,page};};
 const set=async(id:string,label:string)=>({id,label,layout:'BM17-2026-10',dccStatus:'REFERENCE_NOT_DCC_APPROVED',request:await entry(formFiles.request,'Fm-WI-T-BM17/01','1 / 2'),consent:await entry(formFiles.consent,'Fm-WI-T-BM17/02','2 / 2')});
 const registry=path.join(base,'data/forms-registry.json');await fs.writeFile(registry,JSON.stringify({version:1,sets:[await set('CBH-BM17-REF-2026-10-18','Owner reference 2026-10-18'),await set('CBH-BM17-SECOND-SET','Second set id, same bytes (Settings test)')]}));
 Object.assign(env,{NIPT_ANC_FORM_REGISTRY:registry});}catch{/* forms not available on this machine: ANC form specs skip */}
const children:ReturnType<typeof spawn>[]=[];
async function child(label:string,args:string[],wait=false){const log=await fs.open(path.join(base,label+'.log'),'a');const c=spawn(process.execPath,args,{cwd:repo,env,windowsHide:true,stdio:['ignore',log.fd,log.fd]});await log.close();if(wait)return await new Promise<number>(resolve=>c.once('exit',code=>resolve(code??1)));children.push(c);return 0;}
try{
 if(await child('seed',['--import','tsx','tools/seed.ts'],true))throw Error('SYNTHETIC_SEED_FAILED');
 await child('renderer',['--import','tsx','apps/renderer/main.ts']);await child('worker',['--import','tsx','apps/worker/main.ts']);await child('web',['.next/standalone/server.js']);
 for(let i=0;i<120;i++){if(await fetch(origin+'/login').then(r=>r.ok).catch(()=>false))break;if(i===119)throw Error('SYNTHETIC_WEB_START_FAILED');await new Promise(r=>setTimeout(r,250));}
 const requested=(process.env.NIPT_INTEG_E2E_SPECS??'anc-forms.spec.ts,be-date-input.spec.ts,foundation.spec.ts,p2.spec.ts,p3-inbound.spec.ts,p4-lab.spec.ts,p4-task-list.spec.ts,p4b-pooling.spec.ts,p4c-sequencing.spec.ts,p5-case-upload.spec.ts,p5-results.spec.ts,p5h-bulk.spec.ts,p6-sandbox.spec.ts,p7-result-parity.spec.ts,run-photos.spec.ts,settings-operational.spec.ts,workbook-f52-approved.spec.ts,zz-p2-doctor-loading-race.spec.ts').split(',');
 const allowed=['run-photos.spec.ts','be-date-input.spec.ts','foundation.spec.ts','p2.spec.ts','p3-inbound.spec.ts','p4-lab.spec.ts','p4-task-list.spec.ts','p4b-pooling.spec.ts','p4c-sequencing.spec.ts','p5-results.spec.ts','p5h-bulk.spec.ts','p6-sandbox.spec.ts','p7-result-parity.spec.ts','settings-operational.spec.ts','p5-case-upload.spec.ts','anc-forms.spec.ts','workbook-f52-approved.spec.ts','zz-p2-doctor-loading-race.spec.ts'];
 if(requested.some(x=>!allowed.includes(x)))throw Error('UNAPPROVED_E2E_SPEC');
 const code=await child('playwright',['node_modules/@playwright/test/cli.js','test',...requested.map(s=>'tests/e2e/'+s),...(process.env.NIPT_INTEG_E2E_GREP?['--grep',process.env.NIPT_INTEG_E2E_GREP]:[]),...process.argv.slice(2)],true);
 await fs.writeFile(path.join(base,'evidence.json'),JSON.stringify({exitCode:code,specs:requested,project,origin,database,databasePort:Number(dbUrl.port),mode:'synthetic',localOnly:true}));console.log(JSON.stringify({exitCode:code,artifactDirectory:base}));process.exitCode=code;
}finally{for(const c of children.reverse()){if(c.exitCode===null)try{execFileSync('taskkill',['/PID',String(c.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});}catch{}}}
