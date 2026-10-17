// Isolated synthetic browser environment for the P0 Task List work (tools/ux-v2/p2-e2e.ts pattern).
// Own Docker project + loopback ports 19628-19630, a fresh reserved browser database per run, synthetic mode only.
// Never targets the UX-V2 preview, Integrated UAT or any real database.
import {spawn,execFileSync} from 'node:child_process';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import {randomBytes} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {Pool} from 'pg';
import {migrate} from '../migrate';
const repo=process.cwd(),base=path.resolve('.local/p0-e2e'),project='nipt-p0-tasklist-e2e-20261017';
if(path.basename(repo)!=='NIPT-CBH-P0-TASKLIST')throw Error('ISOLATED_WORKTREE_REQUIRED');
await fs.mkdir(base,{recursive:true});
const secret=path.join(base,'db-password');
try{await fs.writeFile(secret,randomBytes(32).toString('hex'),{flag:'wx'});}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;}
const compose='tools/p0/e2e.compose.yaml';
const docker=(...args:string[])=>execFileSync('docker',['compose','--project-directory',repo,'-p',project,'-f',compose,...args],{stdio:'ignore',windowsHide:true});
for(const port of [19628,19629,19630])await new Promise<void>((resolve,reject)=>{const server=net.createServer();server.once('error',reject);server.listen(port,'127.0.0.1',()=>server.close(()=>resolve()));});
docker('up','-d','--wait');
const password=(await fs.readFile(secret,'utf8')).trim();
// The reserved-browser-database guard (tests/helpers/browser-database.ts) is kept unchanged: the name uses its approved prefix.
const database='nipt_synthetic_p2_browser_p0_'+randomBytes(6).toString('hex');
const bootstrap=new Pool({connectionString:`postgresql://nipt_e2e:${password}@127.0.0.1:19629/postgres`});
try{await bootstrap.query('CREATE DATABASE '+database);}finally{await bootstrap.end();}
const url=`postgresql://nipt_e2e:${password}@127.0.0.1:19629/${database}`,origin='http://127.0.0.1:19628';
process.env.NIPT_MODE='synthetic';const db=new Pool({connectionString:url});try{await migrate(db);}finally{await db.end();}
execFileSync(process.execPath,['--import',pathToFileURL(path.join(repo,'node_modules/tsx/dist/loader.mjs')).href,path.join(repo,'tools/init-dev.ts')],{cwd:base,windowsHide:true,stdio:'ignore'});
const key=(name:string)=>path.join(base,'data/keys',name);
const env={...process.env,NIPT_MODE:'synthetic',DATABASE_URL:url,NIPT_E2E_AUDIT_DATABASE_URL:url,APP_ORIGIN:origin,E2E_BASE_URL:origin,HOSTNAME:'127.0.0.1',PORT:'19628',FILE_STORE_ROOT:path.join(base,'data/files'),SIMULATOR_ROOT:path.join(base,'data/simulator'),RENDERER_URL:'http://127.0.0.1:19630',RENDERER_PORT:'19630',RENDERER_TOKEN_FILE:key('renderer-token'),INTEGRATION_PUBLIC_KEY_FILE:key('integration-public.pem'),INTEGRATION_PRIVATE_KEY_FILE:key('integration-private.pem'),IDENTITY_ENCRYPTION_KEY_FILE:key('identity.key'),IDENTITY_LOOKUP_KEY_FILE:key('lookup.key'),BACKUP_KEY_FILE:key('backup.key'),SYNTHETIC_SEED_PASSWORD_FILE:path.join(base,'data/secrets/seed-password'),
 // Approved master (read-only, SHA-256 checked by loadRuntimeMaster on every use); native PDFs go through local Microsoft Excel.
 NIPT_TASK_MASTER_PATH:process.env.NIPT_TASK_MASTER_PATH??'C:/Users/User/Downloads/NIPT_CBH_Final_Combined_Master_2026-10-15.xlsx'};
await fs.cp(path.join(repo,'public'),path.join(repo,'.next/standalone/public'),{recursive:true});
await fs.cp(path.join(repo,'.next/static'),path.join(repo,'.next/standalone/.next/static'),{recursive:true});
await fs.mkdir(env.FILE_STORE_ROOT,{recursive:true});await fs.mkdir(path.join(env.SIMULATOR_ROOT,'inbound'),{recursive:true});await fs.mkdir(path.join(env.SIMULATOR_ROOT,'results'),{recursive:true});await fs.writeFile(path.join(env.SIMULATOR_ROOT,'.nipt-synthetic-root'),'NIPT_SYNTHETIC_ONLY_V1');
const children:ReturnType<typeof spawn>[]=[];
async function child(label:string,args:string[],wait=false){const log=await fs.open(path.join(base,label+'.log'),'a');const c=spawn(process.execPath,args,{cwd:repo,env,windowsHide:true,stdio:['ignore',log.fd,log.fd]});await log.close();if(wait)return await new Promise<number>(resolve=>c.once('exit',code=>resolve(code??1)));children.push(c);return 0;}
try{
 if(await child('seed',['--import','tsx','tools/seed.ts'],true))throw Error('SYNTHETIC_SEED_FAILED');
 await child('renderer',['--import','tsx','apps/renderer/main.ts']);await child('worker',['--import','tsx','apps/worker/main.ts']);await child('web',['.next/standalone/server.js']);
 for(let i=0;i<120;i++){if(await fetch(origin+'/login').then(r=>r.ok).catch(()=>false))break;if(i===119)throw Error('SYNTHETIC_WEB_START_FAILED');await new Promise(r=>setTimeout(r,250));}
 const requested=(process.env.NIPT_P0_E2E_SPECS??'p4-task-list.spec.ts').split(',');
 const allowed=['p2.spec.ts','p4-lab.spec.ts','p4-task-list.spec.ts','be-date-input.spec.ts','p4b-pooling.spec.ts','p4c-sequencing.spec.ts','p5-results.spec.ts','p7-result-parity.spec.ts','foundation.spec.ts','p3-inbound.spec.ts'];
 if(requested.some(x=>!allowed.includes(x)))throw Error('UNAPPROVED_E2E_SPEC');
 const code=await child('playwright',['node_modules/@playwright/test/cli.js','test',...requested.map(s=>'tests/e2e/'+s),...(process.env.NIPT_P0_E2E_GREP?['--grep',process.env.NIPT_P0_E2E_GREP]:[]),...process.argv.slice(2)],true);
 await fs.writeFile(path.join(base,'evidence.json'),JSON.stringify({exitCode:code,specs:requested,project,origin,database,databasePort:19629,mode:'synthetic',localOnly:true}));console.log(JSON.stringify({exitCode:code,artifactDirectory:base}));process.exitCode=code;
}finally{for(const c of children.reverse()){if(c.exitCode===null)try{execFileSync('taskkill',['/PID',String(c.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});}catch{}}docker('stop');}
