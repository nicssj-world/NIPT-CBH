// Isolated synthetic browser environment for the P0 Task List work (tools/ux-v2/p2-e2e.ts pattern).
// Own Docker project + loopback ports 19728-19730, a fresh reserved browser database per run, synthetic mode only.
// Never targets the UX-V2 preview, Integrated UAT or any real database.
import {spawn,execFileSync} from 'node:child_process';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import {randomBytes} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {Pool} from 'pg';
import {migrate} from '../migrate';
import {workerServiceAccount} from '../../packages/integrations/authorized-share';
const repo=process.cwd(),base=path.resolve('.local/p0-e2e-113'),project='nipt-p0-his113-e2e-20261030';
const distDir='.next-p0-113';
if(path.basename(repo)!=='claude-update-113')throw Error('ISOLATED_WORKTREE_REQUIRED');
// Always build the current source into an isolated, writable output directory;
// never serve an older immutable/foreign-owned .next standalone build.
execFileSync(process.execPath,['node_modules/next/dist/bin/next','build'],{cwd:repo,windowsHide:true,stdio:'inherit',env:{...process.env,NIPT_MODE:'synthetic',NIPT_E2E_DIST_DIR:distDir}});
const compose='tools/p0/e2e-113.compose.yaml';
const docker=(...args:string[])=>execFileSync('docker',['compose','--project-directory',repo,'-p',project,'-f',compose,...args],{stdio:'ignore',windowsHide:true});
try{
docker('down','--remove-orphans');
await fs.mkdir(base,{recursive:true});
const secret=path.join(base,'db-password');
try{await fs.writeFile(secret,randomBytes(32).toString('hex'),{flag:'wx'});}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;}
for(const port of [19728,19729,19730])await new Promise<void>((resolve,reject)=>{const server=net.createServer();server.once('error',reject);server.listen(port,'127.0.0.1',()=>server.close(()=>resolve()));});
docker('up','-d','--wait');
const password=(await fs.readFile(secret,'utf8')).trim();
// The reserved-browser-database guard (tests/helpers/browser-database.ts) is kept unchanged: the name uses its approved prefix.
const database='nipt_synthetic_p2_browser_p0_'+randomBytes(6).toString('hex');
const bootstrap=new Pool({connectionString:`postgresql://nipt_e2e:${password}@127.0.0.1:19729/postgres`});
try{await bootstrap.query('CREATE DATABASE '+database);}finally{await bootstrap.end();}
const url=`postgresql://nipt_e2e:${password}@127.0.0.1:19729/${database}`,origin='http://127.0.0.1:19728';
process.env.NIPT_MODE='synthetic';const db=new Pool({connectionString:url});try{await migrate(db);}finally{await db.end();}
execFileSync(process.execPath,['--import',pathToFileURL(path.join(repo,'node_modules/tsx/dist/loader.mjs')).href,path.join(repo,'tools/init-dev.ts')],{cwd:base,windowsHide:true,stdio:'ignore'});
const key=(name:string)=>path.join(base,'data/keys',name);
const env={...process.env,NIPT_MODE:'synthetic',DATABASE_URL:url,NIPT_E2E_AUDIT_DATABASE_URL:url,APP_ORIGIN:origin,E2E_BASE_URL:origin,HOSTNAME:'127.0.0.1',PORT:'19728',FILE_STORE_ROOT:path.join(base,'data/files'),SIMULATOR_ROOT:path.join(base,'data/simulator'),RENDERER_URL:'http://127.0.0.1:19730',RENDERER_PORT:'19730',RENDERER_TOKEN_FILE:key('renderer-token'),INTEGRATION_PUBLIC_KEY_FILE:key('integration-public.pem'),INTEGRATION_PRIVATE_KEY_FILE:key('integration-private.pem'),IDENTITY_ENCRYPTION_KEY_FILE:key('identity.key'),IDENTITY_LOOKUP_KEY_FILE:key('lookup.key'),BACKUP_KEY_FILE:key('backup.key'),SYNTHETIC_SEED_PASSWORD_FILE:path.join(base,'data/secrets/seed-password'),
 // Approved master (read-only, SHA-256 checked by loadRuntimeMaster on every use); native PDFs go through local Microsoft Excel.
 NIPT_TASK_MASTER_PATH:process.env.NIPT_TASK_MASTER_PATH??'C:/Users/User/Downloads/NIPT_CBH_Final_Combined_Master_2026-10-15.xlsx'};
async function copyTreeIfChanged(source:string,destination:string) {
 await fs.cp(source,destination,{recursive:true,filter:async(from,to)=>{
  if((await fs.stat(from)).isDirectory())return true;
  try{return !(await fs.readFile(from)).equals(await fs.readFile(to));}
  catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return true;throw error;}
 }});
}
await copyTreeIfChanged(path.join(repo,'public'),path.join(repo,distDir,'standalone/public'));
await copyTreeIfChanged(path.join(repo,distDir,'static'),path.join(repo,distDir,'standalone',distDir,'static'));
await fs.mkdir(env.FILE_STORE_ROOT,{recursive:true});await fs.mkdir(path.join(env.SIMULATOR_ROOT,'inbound'),{recursive:true});await fs.mkdir(path.join(env.SIMULATOR_ROOT,'results'),{recursive:true});await fs.writeFile(path.join(env.SIMULATOR_ROOT,'.nipt-synthetic-root'),'NIPT_SYNTHETIC_ONLY_V1');
// Settings acceptance: a loopback "authorised test share" for the HIS inbound/outbound Settings (never a hospital path), reset per run.
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
 await child('renderer',['--import','tsx','apps/renderer/main.ts']);await child('worker',['--import','tsx','apps/worker/main.ts']);await child('web',[path.join(distDir,'standalone/server.js')]);
 for(let i=0;i<120;i++){if(await fetch(origin+'/login').then(r=>r.ok).catch(()=>false))break;if(i===119)throw Error('SYNTHETIC_WEB_START_FAILED');await new Promise(r=>setTimeout(r,250));}
 const requested=(process.env.NIPT_P0_E2E_SPECS??'his-path-settings-113.spec.ts').split(',');
 const allowed=['his-path-settings-113.spec.ts','be-date-input.spec.ts','foundation.spec.ts','p2.spec.ts','p3-inbound.spec.ts','p4-lab.spec.ts','p4-task-list.spec.ts','p4b-pooling.spec.ts','p4c-sequencing.spec.ts','p5-results.spec.ts','p5h-bulk.spec.ts','p6-sandbox.spec.ts','p7-result-parity.spec.ts','p8-installed.spec.ts','settings-operational.spec.ts','p5-case-upload.spec.ts','anc-forms.spec.ts','workbook-f52-approved.spec.ts','zz-p2-doctor-loading-race.spec.ts'];
 if(requested.some(x=>!allowed.includes(x)))throw Error('UNAPPROVED_E2E_SPEC');
 const code=await child('playwright',['node_modules/@playwright/test/cli.js','test',...requested.map(s=>'tests/e2e/'+s),...(process.env.NIPT_P0_E2E_GREP?['--grep',process.env.NIPT_P0_E2E_GREP]:[]),...process.argv.slice(2)],true);
 await fs.writeFile(path.join(base,'evidence.json'),JSON.stringify({exitCode:code,specs:requested,project,origin,database,databasePort:19729,mode:'synthetic',localOnly:true}));console.log(JSON.stringify({exitCode:code,artifactDirectory:base}));process.exitCode=code;
}finally{for(const c of children.reverse()){if(c.exitCode===null)try{execFileSync('taskkill',['/PID',String(c.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});}catch{}}}
}finally{docker('down','--remove-orphans');}
