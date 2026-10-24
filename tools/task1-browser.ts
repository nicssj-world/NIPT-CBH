import {execFileSync,spawn,type ChildProcess} from 'node:child_process';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import {Pool} from 'pg';
import {migrate} from './migrate';
import {pathToFileURL} from 'node:url';
const repo=process.cwd(),bin=process.env.NIPT_OPERATIONAL_TEST_PG_BIN;if(!bin)throw Error('EXISTING_POSTGRES_BIN_REQUIRED');
const base=await fs.mkdtemp(path.resolve('.local/task1-browser-')),pgdata=path.join(base,'pgdata'),children:ChildProcess[]=[];
const exe=(n:string)=>path.join(bin,n+'.exe');const run=(n:string,a:string[])=>execFileSync(exe(n),a,{windowsHide:true,stdio:'ignore'});
const port=()=>new Promise<number>(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=(s.address() as net.AddressInfo).port;s.close(()=>resolve(p));});});
const pgPort=await port(),webPort=await port(),rendererPort=await port(),url=`postgresql://nipt_browser_owner@127.0.0.1:${pgPort}/nipt_synthetic_p2_browser_operational`,origin=`http://127.0.0.1:${webPort}`;let started=false;
async function child(label:string,args:string[],env:NodeJS.ProcessEnv,wait=false){const log=await fs.open(path.join(base,label+'.log'),'a'),c=spawn(process.execPath,args,{cwd:repo,windowsHide:true,env,stdio:['ignore',log.fd,log.fd]});await log.close();if(wait)return await new Promise<number>(resolve=>c.once('exit',code=>resolve(code??1)));children.push(c);return 0;}
try{
 run('initdb',['-D',pgdata,'-U','nipt_browser_owner','-A','trust','--no-locale','-E','UTF8']);run('pg_ctl',['-D',pgdata,'-l',path.join(base,'postgres.log'),'-o',`-p ${pgPort} -h 127.0.0.1`,'-w','start']);started=true;
 const bootstrap=new Pool({connectionString:url.replace('/nipt_synthetic_p2_browser_operational','/postgres')});await bootstrap.query('CREATE DATABASE nipt_synthetic_p2_browser_operational');await bootstrap.query('CREATE DATABASE nipt_p6_synthetic_browser');await bootstrap.end();const db=new Pool({connectionString:url});await migrate(db);await db.end();
 execFileSync(process.execPath,['--import',pathToFileURL(path.join(repo,'node_modules/tsx/dist/loader.mjs')).href,path.join(repo,'tools/init-dev.ts')],{cwd:base,windowsHide:true,stdio:'ignore'});
 const key=(n:string)=>path.join(base,'data/keys',n),env={...process.env,NIPT_MODE:'synthetic',DATABASE_URL:url,NIPT_E2E_AUDIT_DATABASE_URL:url,NIPT_P6_NATIVE_URL:url.replace('/nipt_synthetic_p2_browser_operational','/nipt_p6_synthetic_browser'),APP_ORIGIN:origin,E2E_BASE_URL:origin,WEB_DB_PASSWORD_FILE:path.join(base,'data/secrets/web-password'),WORKER_DB_PASSWORD_FILE:path.join(base,'data/secrets/worker-password'),NIPT_TASK1_EVIDENCE_DIR:path.join(base,'evidence'),NIPT_E2E_P4_EVIDENCE_DIR:path.join(base,'p4-pdf-evidence'),NIPT_E2E_OUTPUT_DIR:path.join(base,'playwright-results'),NIPT_TASK_MASTER_PATH:process.env.NIPT_TASK_MASTER_PATH??path.resolve('.local/lab-owner-evidence/lab-combined-master.xlsx'),FILE_STORE_ROOT:path.join(base,'data/files'),SIMULATOR_ROOT:path.join(base,'data/simulator'),RENDERER_URL:`http://127.0.0.1:${rendererPort}`,RENDERER_PORT:String(rendererPort),RENDERER_TOKEN_FILE:key('renderer-token'),INTEGRATION_PUBLIC_KEY_FILE:key('integration-public.pem'),INTEGRATION_PRIVATE_KEY_FILE:key('integration-private.pem'),IDENTITY_ENCRYPTION_KEY_FILE:key('identity.key'),IDENTITY_LOOKUP_KEY_FILE:key('lookup.key'),BACKUP_KEY_FILE:key('backup.key'),SYNTHETIC_SEED_PASSWORD_FILE:path.join(base,'data/secrets/seed-password')};
 await fs.mkdir(path.join(env.SIMULATOR_ROOT,'results'),{recursive:true});await fs.mkdir(path.join(env.SIMULATOR_ROOT,'inbound'),{recursive:true});await fs.writeFile(path.join(env.SIMULATOR_ROOT,'.nipt-synthetic-root'),'NIPT_SYNTHETIC_ONLY_V1');
 if(await child('seed',['--import','tsx','tools/seed.ts'],env,true))throw Error('SEED_FAILED');
 let nativeContractCode:number|null=null;
 if(process.env.NIPT_TASK1_NATIVE_CONTRACTS==='yes'){
  const owner=new Pool({connectionString:url});try{
   await owner.query(await fs.readFile('packages/db/roles.sql','utf8'));
   for(const [name,group,file] of [['nipt_web','app_rw',env.WEB_DB_PASSWORD_FILE],['nipt_worker','worker_rw',env.WORKER_DB_PASSWORD_FILE]]){const password=(await fs.readFile(file,'utf8')).trim(),literal=(await owner.query<{value:string}>('SELECT quote_literal($1) value',[password])).rows[0].value;await owner.query(`CREATE ROLE ${name} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD ${literal}`);await owner.query(`GRANT ${group} TO ${name}`);}
   await owner.query('GRANT CREATE ON DATABASE nipt_synthetic_p2_browser_operational TO nipt_worker');
  }finally{await owner.end();}
  nativeContractCode=await child('native-contracts',['node_modules/vitest/vitest.mjs','run','tests/contracts/lab-repeat-native.test.ts','tests/contracts/p4-native.test.ts','tests/contracts/p3-native.test.ts','tests/contracts/p5a-auto-link-native.test.ts','tests/contracts/task1-no-call-native.test.ts'],{...env,NIPT_TEST_DATABASE_URL:url},true);
  await fs.writeFile(path.join(base,'native-contracts-evidence.json'),JSON.stringify({exitCode:nativeContractCode,tests:['lab-repeat-native','p4-native','p3-native','p5a-auto-link-native','task1-no-call-native'],database:'nipt_synthetic_p2_browser_operational',loopback:true}));
 }
 if(process.env.NIPT_TASK1_PERSISTENCE==='yes'&&await child('persistence-prepare',['--import','tsx','tools/task1-native-persistence.ts','prepare'],env,true))throw Error('PERSISTENCE_PREPARE_FAILED');await child('renderer',['--import','tsx','apps/renderer/main.ts'],env);await child('worker',['--import','tsx','apps/worker/main.ts'],env);await child('web',['node_modules/next/dist/bin/next','dev','--hostname','127.0.0.1','--port',String(webPort)],env);
 let readyCount=0;for(let i=0;i<240;i++){readyCount=(await fetch(origin+'/login').then(r=>r.ok).catch(()=>false))?readyCount+1:0;if(readyCount>=12)break;const web=children.at(-1)!;if(web.exitCode!==null){if(i>120)throw Error('WEB_START_FAILED');await child('web-retry',['node_modules/next/dist/bin/next','dev','--hostname','127.0.0.1','--port',String(webPort)],env);}if(i===239)throw Error('WEB_START_FAILED');await new Promise(r=>setTimeout(r,250));}
 const code=await child('playwright',['node_modules/@playwright/test/cli.js','test',...process.argv.slice(2),'--reporter=list'],env,true);
 if(process.env.NIPT_TASK1_PERSISTENCE==='yes'){
  for(const c of children.reverse()){if(c.exitCode===null)try{execFileSync('taskkill',['/PID',String(c.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});}catch{}}children.length=0;
  run('pg_ctl',['-D',pgdata,'-m','fast','-w','stop']);started=false;run('pg_ctl',['-D',pgdata,'-l',path.join(base,'postgres.log'),'-o',`-p ${pgPort} -h 127.0.0.1`,'-w','start']);started=true;
  await child('renderer-restarted',['--import','tsx','apps/renderer/main.ts'],env);await child('worker-restarted',['--import','tsx','apps/worker/main.ts'],env);await child('web-restarted',['node_modules/next/dist/bin/next','dev','--hostname','127.0.0.1','--port',String(webPort)],env);
  let readyCount=0;for(let i=0;i<240;i++){readyCount=(await fetch(origin+'/login').then(r=>r.ok).catch(()=>false))?readyCount+1:0;if(readyCount>=12)break;const web=children.at(-1)!;if(web.exitCode!==null){if(i>120)throw Error('RESTARTED_WEB_FAILED');await child('web-restarted-retry',['node_modules/next/dist/bin/next','dev','--hostname','127.0.0.1','--port',String(webPort)],env);}if(i===239)throw Error('RESTARTED_WEB_FAILED');await new Promise(r=>setTimeout(r,250));}
  if(await child('persistence-verify',['--import','tsx','tools/task1-native-persistence.ts','verify'],env,true))throw Error('PERSISTENCE_VERIFY_FAILED');
 }
 await fs.writeFile(path.join(base,'evidence.json'),JSON.stringify({exitCode:code||nativeContractCode||0,nativeContractCode,environment:'DISPOSABLE_LOOPBACK_SYNTHETIC_BROWSER_REGRESSION',productionBuild:false}));process.stdout.write(JSON.stringify({exitCode:code||nativeContractCode||0,nativeContractCode,artifactDirectory:base})+'\n');process.exitCode=code||nativeContractCode||0;
}finally{for(const c of children.reverse()){if(c.exitCode===null)try{execFileSync('taskkill',['/PID',String(c.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});}catch{}}if(started)run('pg_ctl',['-D',pgdata,'-m','immediate','-w','stop']);}
