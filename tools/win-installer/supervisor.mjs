// NIPT-CBH Windows supervisor: one long-running process, started by a Windows scheduled task at boot/logon.
// It starts the private PostgreSQL cluster (if the installer owns it), then the renderer, worker, web app and HTTPS front,
// restarts any of them that exits (bounded backoff), and stops them in order when run\stop.request appears.
// Windows has no POSIX signals for child processes, so the worker is stopped over its IPC channel (graceful lifecycle) and
// everything else is stopped with taskkill only after a grace period. Node built-ins only.
import {spawn,execFileSync} from 'node:child_process';
import {openSync,closeSync,existsSync,mkdirSync,readFileSync,writeFileSync,unlinkSync,appendFileSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {layout,backoffMs,validateConfig} from './lib.mjs';

const rootArg=process.argv[process.argv.indexOf('--root')+1];
if(!rootArg||process.argv.indexOf('--root')<0){process.stderr.write('SUPERVISOR_ROOT_REQUIRED\n');process.exit(2);}
const L=layout(rootArg);
const readJsonSync=f=>JSON.parse(readFileSync(f,'utf8'));
const config=validateConfig(readJsonSync(L.configFile));
const installState=readJsonSync(L.installState);
const release=path.join(L.releases,installState.current.version);
const appDir=path.join(release,'app'),opsDir=path.join(release,'ops');
mkdirSync(L.logs,{recursive:true});mkdirSync(L.run,{recursive:true});

const logFile=path.join(L.logs,'supervisor.log');
const log=(event,detail={})=>{try{appendFileSync(logFile,JSON.stringify({at:new Date().toISOString(),event,...detail})+'\n');}catch{/* logging must never stop the supervisor */}};
const alive=pid=>{try{process.kill(pid,0);return true;}catch(e){return e.code==='EPERM';}};

// single instance
if(existsSync(L.supervisorLock)){
 const other=Number(readFileSync(L.supervisorLock,'utf8'));
 if(Number.isInteger(other)&&other!==process.pid&&alive(other)){log('ALREADY_RUNNING',{pid:other});process.exit(3);}
}
writeFileSync(L.supervisorLock,String(process.pid));

// A previous supervisor that died without stopping its children (killed, crashed host process) leaves them holding the ports.
// Reap exactly the processes it recorded, and only while they are still node.exe / postgres-free application processes of this installation.
const taskkill=pid=>{try{execFileSync(path.join(process.env.SystemRoot??'C:/Windows','System32','taskkill.exe'),['/PID',String(pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});}catch{/* already gone */}};
const imageOf=pid=>{try{return execFileSync(path.join(process.env.SystemRoot??'C:/Windows','System32','tasklist.exe'),['/FI',`PID eq ${pid}`,'/FO','CSV','/NH'],{encoding:'utf8',windowsHide:true}).split(',')[0].replaceAll('"','').toLowerCase();}catch{return '';}};
try{
 const previous=readJsonSync(L.state);
 for(const [name,svc] of Object.entries(previous.services??{})){
  if(svc.pid&&svc.status==='RUNNING'&&alive(svc.pid)&&imageOf(svc.pid)==='node.exe'){taskkill(svc.pid);log('STALE_SERVICE_REAPED',{service:name,pid:svc.pid});}
 }
}catch{/* no previous state */}

const secret=name=>path.join(L.secrets,name);
const exe=name=>path.join(L.pgBin,name+'.exe');
const pgOptions=`-p ${config.ports.postgres} -h 127.0.0.1`;
const pgRunning=()=>{try{execFileSync(exe('pg_ctl'),['status','-D',L.pgdata],{windowsHide:true,stdio:'ignore'});return true;}catch{return false;}};
function startPostgres(){
 if(pgRunning())return;
 execFileSync(exe('pg_ctl'),['start','-D',L.pgdata,'-l',path.join(L.logs,'postgres.log'),'-o',pgOptions,'-w','-t','60'],{windowsHide:true,stdio:'ignore'});
 log('POSTGRES_STARTED');
}
function stopPostgres(){
 if(!pgRunning())return;
 execFileSync(exe('pg_ctl'),['stop','-D',L.pgdata,'-m','fast','-w','-t','60'],{windowsHide:true,stdio:'ignore'});
 log('POSTGRES_STOPPED');
}

const common={
 ...process.env,
 NIPT_MODE:config.mode,NIPT_OPERATIONAL_DATABASE:config.database,APP_ORIGIN:config.origin,NEXT_TELEMETRY_DISABLED:'1',NODE_ENV:'production',
 FILE_STORE_ROOT:config.filesRoot??L.files,SIMULATOR_ROOT:path.join(L.data,'integration'),
 RENDERER_URL:`http://127.0.0.1:${config.ports.renderer}`,RENDERER_TOKEN_FILE:secret('renderer-token'),
 IDENTITY_LOOKUP_KEY_FILE:secret('identity-lookup.key'),NIPT_HIS_SHARE_POLICY_FILE:path.join(L.config,'share-policy.json'),
 NIPT_BACKUP_POLICY_FILE:path.join(L.config,'backup-policy.json'),PLAYWRIGHT_BROWSERS_PATH:L.browsers,
 ...(config.masterWorkbook?{NIPT_TASK_MASTER_PATH:config.masterPath??path.join(L.master,'approved-master.xlsx')}:{}),
 NIPT_SOURCE_SHA:installState.current.revision
};
const fileUrl=p=>pathToFileURL(p).href;
const runtimeEnv=fileUrl(path.join(appDir,'tools','runtime-env.mjs')),opsRuntimeEnv=fileUrl(path.join(opsDir,'tools','runtime-env.mjs'));
const services=[
 {name:'renderer',cwd:opsDir,args:['--import',opsRuntimeEnv,'--import','tsx','apps/renderer/main.ts'],env:{RENDERER_HOST:'127.0.0.1',RENDERER_PORT:String(config.ports.renderer)}},
 {name:'worker',cwd:opsDir,ipc:true,args:['--import',opsRuntimeEnv,'--import','tsx','tools/win-installer/service-worker.ts'],env:{DATABASE_URL_FILE:secret('worker-url'),INTEGRATION_PRIVATE_KEY_FILE:secret('integration-private.pem')}},
 {name:'web',cwd:appDir,args:['--import',runtimeEnv,'server.js'],env:{HOSTNAME:'127.0.0.1',PORT:String(config.ports.web),DATABASE_URL_FILE:secret('web-url'),INTEGRATION_PUBLIC_KEY_FILE:secret('integration-public.pem')}},
 {name:'https',cwd:opsDir,args:[path.join(opsDir,'tools','win-installer','https-proxy.mjs')],env:{NIPT_HTTPS_PORT:String(config.ports.https),NIPT_UPSTREAM_PORT:String(config.ports.web),NIPT_TLS_PFX:path.join(L.tls,'server.pfx'),NIPT_TLS_PASSPHRASE_FILE:secret('tls-passphrase')}}
];
const state={supervisorPid:process.pid,startedAt:new Date().toISOString(),release:installState.current.version,services:{}};
const writeState=()=>{try{writeFileSync(L.state,JSON.stringify(state,null,2));}catch{/* best effort */}};
const run={};
let stopping=false;

function launch(svc){
 const out=openSync(path.join(L.logs,svc.name+'.log'),'a');
 const child=spawn(L.node,svc.args,{cwd:svc.cwd,env:{...common,...svc.env},windowsHide:true,stdio:['ignore',out,out,...(svc.ipc?['ipc']:[])]});
 closeSync(out);
 const entry=run[svc.name]??={restarts:0,child:null,stableTimer:null};
 entry.child=child;entry.startedAt=Date.now();
 state.services[svc.name]={pid:child.pid,status:'RUNNING',restarts:entry.restarts,startedAt:new Date().toISOString()};writeState();log('SERVICE_STARTED',{service:svc.name,pid:child.pid});
 child.on('error',e=>log('SERVICE_SPAWN_ERROR',{service:svc.name,message:e.message}));
 child.on('exit',(code,signal)=>{
  state.services[svc.name]={...state.services[svc.name],status:stopping?'STOPPED':'EXITED',exitCode:code,signal};writeState();
  log('SERVICE_EXITED',{service:svc.name,code,signal,stopping});
  if(stopping)return;
  entry.restarts=Date.now()-entry.startedAt>60000?0:entry.restarts+1;
  const wait=backoffMs(entry.restarts-1);log('SERVICE_RESTART_SCHEDULED',{service:svc.name,afterMs:wait});
  setTimeout(()=>{if(!stopping)launch(svc);},wait);
 });
}

const killTree=pid=>{try{execFileSync(path.join(process.env.SystemRoot??'C:/Windows','System32','taskkill.exe'),['/PID',String(pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});}catch{/* already gone */}};
const waitExit=(child,ms)=>new Promise(resolve=>{if(child.exitCode!==null||child.signalCode)return resolve(true);const t=setTimeout(()=>resolve(false),ms);child.once('exit',()=>{clearTimeout(t);resolve(true);});});

async function stopAll(mode){
 stopping=true;log('STOP_REQUESTED',{mode});
 for(const name of ['https','web','worker','renderer']){
  const entry=run[name];if(!entry?.child)continue;const child=entry.child;
  if(child.exitCode===null&&!child.signalCode){
   if(name==='worker'&&child.connected){try{child.send('STOP_WORKER');}catch{/* channel closed */}if(await waitExit(child,40000))continue;log('WORKER_GRACEFUL_STOP_TIMEOUT');}
   else if(await waitExit(child,0))continue;
   killTree(child.pid);await waitExit(child,10000);
  }
 }
 if(mode==='all')stopPostgres();
 try{unlinkSync(L.stop);}catch{/* consumed */}
 try{unlinkSync(L.supervisorLock);}catch{/* gone */}
 state.stoppedAt=new Date().toISOString();state.stopMode=mode;writeState();log('SUPERVISOR_STOPPED',{mode});
 process.exit(0);
}

try{
 startPostgres();
 for(const svc of services)launch(svc);
}catch(e){log('SUPERVISOR_START_FAILED',{message:e.message});try{unlinkSync(L.supervisorLock);}catch{/* */}process.exit(1);}

setInterval(()=>{
 if(stopping)return;
 if(existsSync(L.stop)){let mode='all';try{mode=readJsonSync(L.stop).mode==='apps'?'apps':'all';}catch{/* default all */}void stopAll(mode);}
},500);
process.on('SIGTERM',()=>void stopAll('all'));process.on('SIGINT',()=>void stopAll('all'));
log('SUPERVISOR_STARTED',{pid:process.pid,release:installState.current.version});
