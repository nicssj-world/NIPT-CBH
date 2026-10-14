import {execFileSync,spawn,type ChildProcess} from 'node:child_process';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import {Pool} from 'pg';
import {migrate} from '../migrate';
import {pathToFileURL} from 'node:url';
const repo=process.cwd(),bin=process.env.NIPT_OPERATIONAL_TEST_PG_BIN;if(!bin)throw Error('EXISTING_POSTGRES_BIN_REQUIRED');
const base=await fs.mkdtemp(path.resolve('.local/browser-regression-')),pgdata=path.join(base,'pgdata'),children:ChildProcess[]=[];
const exe=(n:string)=>path.join(bin,n+'.exe');const run=(n:string,a:string[])=>execFileSync(exe(n),a,{windowsHide:true,stdio:'ignore'});
const port=()=>new Promise<number>(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=(s.address() as net.AddressInfo).port;s.close(()=>resolve(p));});});
const pgPort=await port(),webPort=await port(),rendererPort=await port(),url=`postgresql://nipt_browser_owner@127.0.0.1:${pgPort}/nipt_synthetic_p2_browser_operational`,origin=`http://127.0.0.1:${webPort}`;let started=false;
async function child(label:string,args:string[],env:NodeJS.ProcessEnv,wait=false){const log=await fs.open(path.join(base,label+'.log'),'a'),c=spawn(process.execPath,args,{cwd:repo,windowsHide:true,env,stdio:['ignore',log.fd,log.fd]});await log.close();if(wait)return await new Promise<number>(resolve=>c.once('exit',code=>resolve(code??1)));children.push(c);return 0;}
try{
 run('initdb',['-D',pgdata,'-U','nipt_browser_owner','-A','trust','--no-locale','-E','UTF8']);run('pg_ctl',['-D',pgdata,'-l',path.join(base,'postgres.log'),'-o',`-p ${pgPort} -h 127.0.0.1`,'-w','start']);started=true;
 const bootstrap=new Pool({connectionString:url.replace('/nipt_synthetic_p2_browser_operational','/postgres')});await bootstrap.query('CREATE DATABASE nipt_synthetic_p2_browser_operational');await bootstrap.query('CREATE DATABASE nipt_p6_synthetic_browser');await bootstrap.end();const db=new Pool({connectionString:url});await migrate(db);await db.end();
 execFileSync(process.execPath,['--import',pathToFileURL(path.join(repo,'node_modules/tsx/dist/loader.mjs')).href,path.join(repo,'tools/init-dev.ts')],{cwd:base,windowsHide:true,stdio:'ignore'});
 const key=(n:string)=>path.join(base,'data/keys',n),env={...process.env,NIPT_MODE:'synthetic',DATABASE_URL:url,NIPT_E2E_AUDIT_DATABASE_URL:url,NIPT_P6_NATIVE_URL:url.replace('/nipt_synthetic_p2_browser_operational','/nipt_p6_synthetic_browser'),APP_ORIGIN:origin,E2E_BASE_URL:origin,FILE_STORE_ROOT:path.join(base,'data/files'),SIMULATOR_ROOT:path.join(base,'data/simulator'),RENDERER_URL:`http://127.0.0.1:${rendererPort}`,RENDERER_PORT:String(rendererPort),RENDERER_TOKEN_FILE:key('renderer-token'),INTEGRATION_PUBLIC_KEY_FILE:key('integration-public.pem'),INTEGRATION_PRIVATE_KEY_FILE:key('integration-private.pem'),IDENTITY_ENCRYPTION_KEY_FILE:key('identity.key'),IDENTITY_LOOKUP_KEY_FILE:key('lookup.key'),BACKUP_KEY_FILE:key('backup.key'),SYNTHETIC_SEED_PASSWORD_FILE:path.join(base,'data/secrets/seed-password')};
 await fs.mkdir(path.join(env.SIMULATOR_ROOT,'results'),{recursive:true});await fs.mkdir(path.join(env.SIMULATOR_ROOT,'inbound'),{recursive:true});await fs.writeFile(path.join(env.SIMULATOR_ROOT,'.nipt-synthetic-root'),'NIPT_SYNTHETIC_ONLY_V1');
 if(await child('seed',['--import','tsx','tools/seed.ts'],env,true))throw Error('SEED_FAILED');await child('renderer',['--import','tsx','apps/renderer/main.ts'],env);await child('worker',['--import','tsx','apps/worker/main.ts'],env);await child('web',['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',String(webPort)],env);
 for(let i=0;i<120;i++){if(await fetch(origin+'/login').then(r=>r.ok).catch(()=>false))break;if(i===119)throw Error('WEB_START_FAILED');await new Promise(r=>setTimeout(r,250));}
 const code=await child('playwright',['node_modules/@playwright/test/cli.js','test'],env,true);await fs.writeFile(path.join(base,'evidence.json'),JSON.stringify({exitCode:code,environment:'DISPOSABLE_LOOPBACK_SYNTHETIC_BROWSER_REGRESSION',productionBuild:true}));process.stdout.write(JSON.stringify({exitCode:code,artifactDirectory:base})+'\n');process.exitCode=code;
}finally{for(const c of children.reverse()){if(c.exitCode===null)try{execFileSync('taskkill',['/PID',String(c.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});}catch{}}if(started)run('pg_ctl',['-D',pgdata,'-m','immediate','-w','stop']);}
