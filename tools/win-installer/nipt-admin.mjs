// NIPT-CBH Windows offline installer / operator CLI. Node built-ins only (runs from the package's own node.exe before any dependency exists).
//   node nipt-admin.mjs <command> --root <install root> [options]
// Commands: verify-package, preflight, install, start, stop, restart, status, health, backup, restore, upgrade, rollback, uninstall.
// TEST ENVIRONMENT ONLY. Nothing here connects to a HIS, touches a hospital share, applies a Production migration or accepts clinical use.
import {execFileSync,spawnSync} from 'node:child_process';
import {randomBytes,randomUUID,generateKeyPairSync} from 'node:crypto';
import {existsSync,readFileSync,writeFileSync,mkdirSync,rmSync,cpSync,readdirSync,copyFileSync,appendFileSync} from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import {
 layout,validateConfig,assertSafeRoot,portFree,freeBytes,MIN_FREE_BYTES,verifyPackage,sha256File,readJson,writeJson,compareVersions,
 schemaCompatibility,canRollbackApplicationOnly,healthVerdict,parseLedgerOutput
} from './lib.mjs';

const SYS=process.env.SystemRoot??'C:\\Windows';
const system32=n=>path.join(SYS,'System32',n);
const psExe=path.join(SYS,'System32','WindowsPowerShell','v1.0','powershell.exe');
const TASK_PATH='\\NIPT-CBH\\';

function parseArgs(argv){
 const out={_:[]};
 for(let i=0;i<argv.length;i++){
  const a=argv[i];
  if(a.startsWith('--')){const k=a.slice(2);const next=argv[i+1];if(next===undefined||next.startsWith('--'))out[k]=true;else{out[k]=next;i++;}}
  else out._.push(a);
 }
 return out;
}
const args=parseArgs(process.argv.slice(2));
const command=args._[0];
const say=(m)=>process.stderr.write(`[nipt] ${m}\n`);
const fail=(code,detail)=>{const e=Error(code);e.detail=detail;throw e;};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const whoami=()=>execFileSync(system32('whoami.exe'),[],{encoding:'utf8',windowsHide:true}).trim();
const run=(file,a,opts={})=>execFileSync(file,a,{windowsHide:true,encoding:'utf8',stdio:['ignore','pipe','pipe'],...opts});
const ps=(script)=>run(psExe,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-Command',script]);
const q=s=>`'${String(s).replaceAll("'","''")}'`;

async function waitFor(check,label,ms=120000,step=500){
 const start=Date.now();
 while(Date.now()-start<ms){try{if(await check())return;}catch{/* retry */}await sleep(step);}
 fail('TIMEOUT_'+label);
}

// ───────────────────────────── state ─────────────────────────────
function stateOf(L){return JSON.parse(readFileSync(L.installState,'utf8'));}
function saveState(L,s){writeFileSync(L.installState,JSON.stringify(s,null,2));}
function history(L,s,event,detail={}){s.history=[...(s.history??[]),{at:new Date().toISOString(),event,...detail}];saveState(L,s);}
const cfgOf=L=>validateConfig(JSON.parse(readFileSync(L.configFile,'utf8')));
const releaseDir=(L,version)=>path.join(L.releases,version);
const secretFile=(L,n)=>path.join(L.secrets,n);
const readSecret=(L,n)=>readFileSync(secretFile(L,n),'utf8').trim();
const taskName=c=>'nipt-cbh-'+c.instance;

// ───────────────────────────── scheduled task ─────────────────────────────
function registerTask(L,c){
 const supervisor=path.join(L.root,'admin','supervisor.mjs');
 const user=whoami();
 const trigger=c.taskMode==='system'?'New-ScheduledTaskTrigger -AtStartup':`New-ScheduledTaskTrigger -AtLogOn -User ${q(user)}`;
 const principal=c.taskMode==='system'?"New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest":`New-ScheduledTaskPrincipal -UserId ${q(user)} -LogonType Interactive -RunLevel Limited`;
 ps(`$ErrorActionPreference='Stop';`+
  `$a=New-ScheduledTaskAction -Execute ${q(L.node)} -Argument ${q(`"${supervisor}" --root "${L.root}"`)} -WorkingDirectory ${q(L.root)};`+
  `$t=${trigger};`+
  `$s=New-ScheduledTaskSettingsSet -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries;`+
  `$p=${principal};`+
  `Register-ScheduledTask -TaskName ${q(taskName(c))} -TaskPath ${q(TASK_PATH)} -Action $a -Trigger $t -Settings $s -Principal $p -Force | Out-Null`);
}
function taskInfo(c){
 try{return JSON.parse(ps(`$t=Get-ScheduledTask -TaskName ${q(taskName(c))} -TaskPath ${q(TASK_PATH)} -ErrorAction Stop;[pscustomobject]@{state=[string]$t.State;user=[string]$t.Principal.UserId}|ConvertTo-Json -Compress`));}catch{return null;}
}
function startTask(c){ps(`Start-ScheduledTask -TaskName ${q(taskName(c))} -TaskPath ${q(TASK_PATH)}`);}
function unregisterTask(c){try{ps(`Unregister-ScheduledTask -TaskName ${q(taskName(c))} -TaskPath ${q(TASK_PATH)} -Confirm:$false -ErrorAction Stop`);}catch{/* not registered */}}

const alive=pid=>{try{process.kill(pid,0);return true;}catch(e){return e.code==='EPERM';}};
function supervisorPid(L){try{const pid=Number(readFileSync(L.supervisorLock,'utf8'));return Number.isInteger(pid)&&alive(pid)?pid:null;}catch{return null;}}

async function startServices(L,c){
 if(supervisorPid(L)){say('supervisor already running');}
 else{try{rmSync(L.supervisorLock,{force:true});}catch{/* */}rmSync(L.stop,{force:true});
  if(taskInfo(c))startTask(c);
  else{ // no task (e.g. rehearsal without registration): run detached
   const {spawn}=await import('node:child_process');spawn(L.node,[path.join(L.root,'admin','supervisor.mjs'),'--root',L.root],{detached:true,windowsHide:true,stdio:'ignore'}).unref();
  }
  await waitFor(()=>supervisorPid(L)!==null,'SUPERVISOR_START',60000);
 }
}
async function stopServices(L,{keepDatabase=false}={}){
 const pid=supervisorPid(L);
 if(!pid){if(!keepDatabase&&pgRunning(L))pgStop(L);return;}
 writeFileSync(L.stop,JSON.stringify({mode:keepDatabase?'apps':'all',at:new Date().toISOString()}));
 try{await waitFor(()=>supervisorPid(L)===null,'SUPERVISOR_STOP',150000);}
 catch{ // last resort: only the processes the supervisor recorded
  const st=await readJson(L.state,{});for(const s of Object.values(st.services??{}))if(s.pid&&alive(s.pid))try{run(system32('taskkill.exe'),['/PID',String(s.pid),'/T','/F']);}catch{/* gone */}
  try{run(system32('taskkill.exe'),['/PID',String(pid),'/T','/F']);}catch{/* gone */}rmSync(L.supervisorLock,{force:true});rmSync(L.stop,{force:true});say('FORCED_STOP_USED');
 }
}

// ───────────────────────────── postgres helpers ─────────────────────────────
const pgExe=(L,n)=>path.join(L.pgBin,n+'.exe');
const pgRunning=L=>{try{run(pgExe(L,'pg_ctl'),['status','-D',L.pgdata]);return true;}catch{return false;}};
// stdio must be ignored: the detached postgres inherits pipes, and execFileSync would wait for them to close (i.e. until PostgreSQL exits).
function pgStart(L,c){if(pgRunning(L))return;execFileSync(pgExe(L,'pg_ctl'),['start','-D',L.pgdata,'-l',path.join(L.logs,'postgres.log'),'-o',`-p ${c.ports.postgres} -h 127.0.0.1`,'-w','-t','60'],{windowsHide:true,stdio:'ignore'});}
function pgStop(L){if(pgRunning(L))run(pgExe(L,'pg_ctl'),['stop','-D',L.pgdata,'-m','fast','-w','-t','60']);}
function psql(L,c,sql,{db=c.database}={}){
 return run(pgExe(L,'psql'),['-h','127.0.0.1','-p',String(c.ports.postgres),'-U','nipt_migrator','-d',db,'-X','-A','-t','-v','ON_ERROR_STOP=1','-c',sql],{env:{...process.env,PGPASSWORD:readSecret(L,'db-password')}}).trim();
}


// psql on Windows terminates lines with CRLF: parse tolerantly so a trailing CR can never turn a matching checksum into a mismatch.
function ledgerOf(L,c,db=c.database){
 return parseLedgerOutput(psql(L,c,"SELECT name||'|'||checksum FROM schema_migration ORDER BY name",{db}));
}

// ───────────────────────────── environment for application tools ─────────────────────────────
function appEnv(L,c,st,extra={}){
 const files=c.filesRoot??L.files,master=c.masterWorkbook?(c.masterPath??path.join(L.master,'approved-master.xlsx')):undefined;
 return {
  ...process.env,NIPT_MODE:c.mode,NIPT_OPERATIONAL_DATABASE:c.database,APP_ORIGIN:c.origin,NEXT_TELEMETRY_DISABLED:'1',
  FILE_STORE_ROOT:files,SIMULATOR_ROOT:path.join(L.data,'integration'),RENDERER_URL:`http://127.0.0.1:${c.ports.renderer}`,RENDERER_TOKEN_FILE:secretFile(L,'renderer-token'),
  IDENTITY_LOOKUP_KEY_FILE:secretFile(L,'identity-lookup.key'),NIPT_HIS_SHARE_POLICY_FILE:path.join(L.config,'share-policy.json'),NIPT_BACKUP_POLICY_FILE:path.join(L.config,'backup-policy.json'),
  PLAYWRIGHT_BROWSERS_PATH:L.browsers,PG_BIN:L.pgBin,BACKUP_KEY_FILE:secretFile(L,'backup.key'),NIPT_SOURCE_SHA:st.current.revision,
  ...(master?{NIPT_TASK_MASTER_PATH:master}:{}),
  ...extra
 };
}
function nodeIn(L,dir,nodeArgs,env,opts={}){
 const r=spawnSync(L.node,nodeArgs,{cwd:dir,env,windowsHide:true,encoding:'utf8',maxBuffer:64*1024*1024,...opts});
 return r;
}
const urlFor=(L,c,secretName,database=c.database)=>{const u=new URL(readSecret(L,secretName));u.pathname='/'+database;return u.toString();};

// ───────────────────────────── commands ─────────────────────────────
async function preflight(){
 const packageDir=path.resolve(args.package??'');
 const L=layout(args.root??fail('ROOT_REQUIRED'));
 const checks=[];const add=(id,ok,detail='')=>checks.push({id,ok,detail});
 add('windows',process.platform==='win32',process.platform);
 add('node24',/^v24\./.test(process.version),process.version);
 try{assertSafeRoot(L.root,packageDir);add('install_root_safe',true);}catch(e){add('install_root_safe',false,e.message);}
 add('install_root_empty',!existsSync(L.installState)&&(!existsSync(L.root)||readdirSync(L.root).length===0),existsSync(L.installState)?'already installed':'');
 try{mkdirSync(L.root,{recursive:true});add('free_space_8gb',await freeBytes(L.root)>=MIN_FREE_BYTES,String(await freeBytes(L.root)));}catch(e){add('free_space_8gb',false,e.message);}
 const ports=portsFromArgs();
 for(const [name,port] of Object.entries(ports))add('port_'+name,await portFree(port),String(port));
 let manifest=null;
 try{manifest=await verifyPackage(packageDir,path.resolve(args['public-key']??fail('PUBLIC_KEY_REQUIRED')));add('package_signature_and_files',true,manifest.version);}catch(e){add('package_signature_and_files',false,e.message);}
 add('runtime_in_package',!!manifest?.runtimeIncluded&&existsSync(path.join(packageDir,'payload','runtime','pg','bin','initdb.exe'))&&existsSync(path.join(packageDir,'payload','runtime','node','node.exe')),'');
 if(args['master-workbook']){try{add('master_workbook_sha256',await sha256File(args['master-workbook'])===JSON.parse(readFileSync(path.join(packageDir,'payload','release','ops','packages','workbook','master-manifest.json'),'utf8')).sha256,'');}catch(e){add('master_workbook_sha256',false,e.message);}}
 else add('master_workbook_sha256',false,'MASTER_WORKBOOK_REQUIRED (operational backups need the approved master)');
 add('task_scheduler',taskSchedulerAvailable(),'');
 const ok=checks.every(c=>c.ok);
 return {ok,checks,manifest:manifest?{version:manifest.version,revision:manifest.revision}:null};
}
function taskSchedulerAvailable(){try{ps('Get-Command Register-ScheduledTask | Out-Null');return true;}catch{return false;}}
function portsFromArgs(){
 const raw=String(args.ports??'5432,3000,443,3001').split(',').map(Number);
 if(raw.length!==4||raw.some(n=>!Number.isInteger(n)))fail('PORTS_INVALID');
 return {postgres:raw[0],web:raw[1],https:raw[2],renderer:raw[3]};
}

function secureDirectory(dir){
 // current user, SYSTEM and Administrators only
 const user=whoami();
 run(system32('icacls.exe'),[dir,'/inheritance:r','/grant:r',`${user}:(OI)(CI)F`,'*S-1-5-18:(OI)(CI)F','*S-1-5-32-544:(OI)(CI)F']);
}

async function install(){
 const pre=await preflight();
 if(!pre.ok)fail('PREFLIGHT_FAILED',pre.checks.filter(c=>!c.ok));
 const packageDir=path.resolve(args.package),L=layout(args.root);
 const m=await verifyPackage(packageDir,path.resolve(args['public-key']));
 if(m.testFault)fail('PACKAGE_TEST_FAULT_NOT_ALLOWED');
 const ports=portsFromArgs(),instance=String(args.instance??'nipt-cbh');
 const config=validateConfig({
  instance,mode:'operational',database:String(args.database??`nipt_operational_${instance.replaceAll('-','_')}`).slice(0,60),ports,
  origin:String(args.origin??`https://localhost${ports.https===443?'':':'+ports.https}`),taskMode:args['task-mode']==='system'?'system':'user',testEnvironmentOnly:true,
  masterWorkbook:true
 });
 if(config.taskMode==='system'&&!isAdmin())fail('ADMINISTRATOR_REQUIRED_FOR_SYSTEM_TASK');
 say('creating layout');
 for(const d of [L.releases,L.runtime,L.data,L.files,L.inbound,L.outbound,L.master,L.secrets,L.config,L.tls,L.logs,L.run,L.backups,L.restores,path.join(L.root,'admin'),path.join(L.outbound,'res'),path.join(L.outbound,'pdf'),path.join(L.outbound,'backup'),path.join(L.data,'integration','results')])mkdirSync(d,{recursive:true});
 secureDirectory(L.secrets);
 say('copying runtime and release (offline)');
 cpSync(path.join(packageDir,'payload','runtime'),L.runtime,{recursive:true});
 const target=releaseDir(L,m.version);
 cpSync(path.join(packageDir,'payload','release'),target,{recursive:true});
 syncAdmin(L,target);
 await writeJson(L.configFile,config);
 copyFileSync(path.resolve(args['master-workbook']),path.join(L.master,'approved-master.xlsx'));
 const release=await readJson(path.join(target,'release.json'));
 const state={format:'NIPT_WINDOWS_INSTALL_STATE_V1',instance,testEnvironmentOnly:true,status:'INSTALLING',current:{version:m.version,revision:m.revision,migrationsSha256:m.migrationsSha256},previous:null,history:[],installedAt:new Date().toISOString(),acceptance:'NOT_ACCEPTED'};
 saveState(L,state);
 say('generating secrets, certificate and policies');
 const credentials=generateSecrets(L,config);
 generateCertificate(L);
 writePolicies(L,config);
 say('initializing the private PostgreSQL cluster');
 initCluster(L,config);
 pgStart(L,config);
 try{
  say('migrating the database and creating accounts');
  const r=nodeIn(L,path.join(target,'ops'),['--import','tsx','tools/win-installer/provision.ts','--root',L.root,'--phase','install'],appEnv(L,config,state));
  if(r.status!==0)fail('PROVISION_FAILED',(r.stderr||r.stdout).slice(-2000));
 }finally{pgStop(L);}
 writeFileSync(L.credentials,credentials,{mode:0o600});
 history(L,state,'INSTALLED',{version:m.version});
 state.status='INSTALLED_NOT_ACCEPTED';saveState(L,state);
 say('registering the startup task');
 registerTask(L,config);
 await startServices(L,config);
 await waitHealthy(L,config,{timeout:180000});
 say('taking the first verified backup (go-live gate)');
 const backup=await takeBackup(L,config);
 await startServices(L,config);
 const health=await healthReport(L,config);
 return {installed:true,root:L.root,version:m.version,url:config.origin,credentials:L.credentials,admin:path.join(L.root,'admin','nipt-admin.mjs'),firstBackup:backup.backupBase,health,migrations:release.migrationCount};
}
const isAdmin=()=>{try{run(system32('net.exe'),['session']);return true;}catch{return false;}};

function syncAdmin(L,releaseRoot){
 const src=path.join(releaseRoot,'ops','tools','win-installer'),dst=path.join(L.root,'admin');
 mkdirSync(dst,{recursive:true});
 for(const f of readdirSync(src))if(/\.(mjs|ps1)$/.test(f))copyFileSync(path.join(src,f),path.join(dst,f));
 writeFileSync(path.join(L.root,'nipt.cmd'),`@echo off\r\n"%~dp0runtime\\node\\node.exe" "%~dp0admin\\nipt-admin.mjs" %* --root "%~dp0."\r\n`);
}

function generateSecrets(L,c){
 const rnd=()=>randomBytes(32).toString('hex'),db=rnd(),web=rnd(),worker=rnd();
 const url=(user,pw)=>`postgresql://${user}:${pw}@127.0.0.1:${c.ports.postgres}/${c.database}`;
 const accounts=[['uat.admin','Installed test administrator','APP_ADMIN'],['uat.lab','Installed test laboratory staff','LAB_STAFF'],['uat.certifier','Installed test laboratory certifier','LAB_CERTIFIER'],
  ['uat.clinical-approver','Installed test clinical approver','CLINICAL_APPROVER'],['uat.auditor','Installed test auditor','AUDITOR'],['uat.anc','Installed test ANC nurse','ANC_NURSE']]
  .map(([username,displayName,role])=>({username,displayName,role,password:rnd()}));
 const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:3072,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});
 const files={'db-password':db,'web-password':web,'worker-password':worker,'migration-url':url('nipt_migrator',db),'web-url':url('nipt_web',web),'worker-url':url('nipt_worker',worker),
  'renderer-token':rnd(),'identity-lookup.key':randomBytes(32),'backup.key':randomBytes(32),'tls-passphrase':rnd(),'integration-public.pem':publicKey,'integration-private.pem':privateKey,'uat-accounts.json':JSON.stringify(accounts,null,2)};
 for(const [name,value] of Object.entries(files))writeFileSync(secretFile(L,name),value,{flag:'wx',mode:0o600});
 return ['NIPT-CBH WINDOWS INSTALLATION — TEST ENVIRONMENT ONLY — NOT FOR CLINICAL USE',`URL: ${c.origin}/login`,'',...accounts.flatMap(a=>[`Role: ${a.role}`,`Username: ${a.username}`,`Password: ${a.password}`,''])].join('\r\n');
}

function generateCertificate(L){
 const pass=readSecret(L,'tls-passphrase');
 ps(`$ErrorActionPreference='Stop';`+
  `$c=New-SelfSignedCertificate -Subject 'CN=localhost' -TextExtension @('2.5.29.17={text}DNS=localhost&IPAddress=127.0.0.1') -KeyAlgorithm RSA -KeyLength 2048 -HashAlgorithm SHA256 -NotAfter (Get-Date).AddDays(397) -CertStoreLocation Cert:\\CurrentUser\\My -KeyExportPolicy Exportable;`+
  `$s=ConvertTo-SecureString -String ${q(pass)} -AsPlainText -Force;`+
  `Export-PfxCertificate -Cert $c -FilePath ${q(path.join(L.tls,'server.pfx'))} -Password $s | Out-Null;`+
  `Export-Certificate -Cert $c -FilePath ${q(path.join(L.tls,'server.cer'))} -Type CERT | Out-Null;`+
  `Remove-Item -Path ('Cert:\\CurrentUser\\My\\'+$c.Thumbprint) -Force`);
 // Node reads PEM for NODE_EXTRA_CA_CERTS
 const der=readFileSync(path.join(L.tls,'server.cer'));
 writeFileSync(path.join(L.tls,'server.pem'),`-----BEGIN CERTIFICATE-----\n${der.toString('base64').match(/.{1,64}/g).join('\n')}\n-----END CERTIFICATE-----\n`);
}

function writePolicies(L,c){
 const account=whoami();
 const grants=[{root:L.inbound,purposes:['INBOUND'],serviceAccount:account,secretRef:null,mode:'operational'},
  {root:L.outbound,purposes:['OUTBOUND'],serviceAccount:account,secretRef:null,mode:'operational'},
  {root:path.join(L.data,'integration','results'),purposes:['RESULTS'],serviceAccount:account,secretRef:null,mode:'operational'}];
 writeFileSync(path.join(L.config,'share-policy.json'),JSON.stringify({version:1,grants},null,2));
 writeBackupPolicy(L,c);
}
function writeBackupPolicy(L,c){
 const outboundRoots=['res','pdf','backup'].map(n=>({root:path.join(L.outbound,n)}));
 writeFileSync(path.join(L.config,'backup-policy.json'),JSON.stringify({version:1,serviceAccount:whoami(),sourceDatabase:c.database,backupRoot:L.backups,restoreRoot:L.restores,restoreDatabasePrefix:'nipt_operational_restore_',outboundRoots},null,2));
}

function initCluster(L,c){
 const pw=path.join(L.run,'initdb.pw');writeFileSync(pw,readSecret(L,'db-password'),{mode:0o600});
 try{
  run(pgExe(L,'initdb'),['-D',L.pgdata,'-U','nipt_migrator','--pwfile',pw,'-A','scram-sha-256','--no-locale','-E','UTF8']);
 }finally{rmSync(pw,{force:true});}
 appendFileSync(path.join(L.pgdata,'postgresql.conf'),`\nlisten_addresses = '127.0.0.1'\nport = ${c.ports.postgres}\npassword_encryption = scram-sha-256\nlog_connections = off\nlog_line_prefix = '%m [%p] '\n`);
}

async function healthReport(L,c){
 const st=stateOf(L);
 const ops=path.join(releaseDir(L,st.current.version),'ops');
 const env=appEnv(L,c,st,{DATABASE_URL:readSecret(L,'migration-url'),NIPT_WEB_DB_ROLE:'nipt_web',NIPT_WORKER_DB_ROLE:'nipt_worker',NODE_EXTRA_CA_CERTS:path.join(L.tls,'server.pem'),...(c.lastBackupPath?{NIPT_LAST_BACKUP_PATH:c.lastBackupPath}:{}),NIPT_BACKUP_MAX_AGE_SECONDS:String(7*24*3600)});
 const r=nodeIn(L,ops,['--import','tsx','tools/p8/health.ts'],env);
 let report={};try{report=JSON.parse((r.stdout||'').trim().split('\n').pop());}catch{report={code:'HEALTH_UNREADABLE'};}
 const httpsOk=await new Promise(res=>{const req=https.get({host:'127.0.0.1',port:c.ports.https,path:'/api/health',ca:readFileSync(path.join(L.tls,'server.pem')),servername:'localhost',timeout:5000},resp=>{let b='';resp.on('data',d=>b+=d);resp.on('end',()=>res(resp.statusCode===200&&JSON.parse(b).status==='ok'));});req.on('error',()=>res(false));req.on('timeout',()=>{req.destroy();res(false);});});
 const verdict=healthVerdict(report,{supervisor:supervisorPid(L)!==null,https:httpsOk});
 return {...verdict,release:st.current.version,details:{workerAlive:report.workerAlive,heartbeatAgeSeconds:report.heartbeatAgeSeconds,backlog:report.backlog,webReachable:report.webReachable,rendererReachable:report.rendererReachable,https:httpsOk,backupStatus:report.backupStatus,migrationsMatch:report.migrationsMatch,auditValid:report.auditValid,rolesRestricted:report.rolesRestricted,quarantined:report.quarantined,clinicalAcceptance:false,hospitalOperationalAcceptance:false}};
}
const healthTimeout=(d=180000)=>Number(args['health-timeout-seconds'])>0?Number(args['health-timeout-seconds'])*1000:d;
async function waitHealthy(L,c,{timeout=120000}={}){
 let last;
 await waitFor(async()=>{last=await healthReport(L,c);return last.ok;},'HEALTH_'+JSON.stringify(last?.failed??'pending'),timeout,3000).catch(e=>{e.detail=last;throw e;});
 return last;
}

async function takeBackup(L,c){
 const st=stateOf(L),ops=path.join(releaseDir(L,st.current.version),'ops');
 await stopServices(L,{keepDatabase:true});
 pgStart(L,c);
 const env=appEnv(L,c,st,{DATABASE_URL:readSecret(L,'migration-url'),BACKUP_SOURCE_QUIESCENT:'yes'});
 const r=nodeIn(L,ops,[path.join('tools','win-installer','ops-backup.mjs'),'backup',L.backups],env);
 if(r.status!==0)fail('BACKUP_FAILED',(r.stderr||r.stdout).slice(-2000));
 const out=JSON.parse(r.stdout.trim().split('\n').pop());
 c.lastBackupPath=out.backupBase;await writeJson(L.configFile,c);
 const index=await readJson(path.join(L.backups,'index.json'),[]);index.push({...out,release:st.current.version,at:new Date().toISOString()});await writeJson(path.join(L.backups,'index.json'),index);
 return out;
}

async function backup(){
 const L=layout(args.root),c=cfgOf(L);
 const out=await takeBackup(L,c);
 await startServices(L,c);await waitHealthy(L,c);
 return {backup:out};
}

async function restore(){
 const L=layout(args.root),c=cfgOf(L),st=stateOf(L);
 const backupDir=path.resolve(args.backup??fail('BACKUP_REQUIRED'));
 const ops=path.join(releaseDir(L,st.current.version),'ops');
 await stopServices(L,{keepDatabase:true});pgStart(L,c);
 const id=randomUUID().replaceAll('-',''),database='nipt_operational_restore_'+id.slice(0,24),destination=path.join(L.restores,id);
 psql(L,c,`CREATE DATABASE ${database}`,{db:'postgres'});
 const restoreUrl=urlFor(L,c,'migration-url',database);
 const env=appEnv(L,c,st,{DATABASE_URL:readSecret(L,'migration-url'),RESTORE_DATABASE_URL:restoreUrl,RESTORE_TO_NEW_OPERATIONAL_DATABASE:'yes'});
 const r=nodeIn(L,ops,[path.join('tools','win-installer','ops-restore.mjs'),'restore',backupDir,destination],env);
 if(r.status!==0){psql(L,c,`DROP DATABASE IF EXISTS ${database}`,{db:'postgres'});await startServices(L,c);fail('RESTORE_FAILED',(r.stderr||r.stdout).slice(-2000));}
 const receipt=JSON.parse(r.stdout.trim().split('\n').pop());
 const result={restored:true,database,destination,receipt:{restoreVerified:receipt.restoreVerified,quarantined:receipt.quarantined,tableCount:receipt.tableCount,fileCount:receipt.fileCount,tableDigest:receipt.tableDigest}};
 if(!args.activate){await startServices(L,c);await waitHealthy(L,c);return {...result,activated:false,note:'restored database is quarantined and not in use; inspect then rerun with --activate --confirm-source-fenced yes'};}
 if(args['confirm-source-fenced']!=='yes'){await startServices(L,c);fail('SOURCE_FENCE_CONFIRMATION_REQUIRED');}
 const releaseNow=await readJson(path.join(releaseDir(L,st.current.version),'release.json'));
 const restoredLedger=ledgerOf(L,c,database);
 const restoredCompat=schemaCompatibility({ledger:restoredLedger,releaseMigrations:releaseNow.migrations});
 if(!restoredCompat.compatibleWithDatabase){await startServices(L,c);fail('RESTORE_BACKUP_NEWER_THAN_RELEASE',restoredCompat);}
 const a=nodeIn(L,ops,[path.join('tools','win-installer','ops-restore.mjs'),'activate',destination],{...env,RESTORE_SOURCE_FENCED:'yes'});
 if(a.status!==0){await startServices(L,c);fail('ACTIVATION_FAILED',(a.stderr||a.stdout).slice(-2000));}
 // the application now runs on the restored database and file store
 psql(L,c,`GRANT CREATE ON DATABASE ${database} TO nipt_worker`,{db:'postgres'});
 const previous={database:c.database,filesRoot:c.filesRoot??L.files,masterPath:c.masterPath??null};
 for(const n of ['migration-url','web-url','worker-url'])writeFileSync(secretFile(L,n),urlFor(L,c,n,database),{mode:0o600});
 c.database=database;c.filesRoot=path.join(destination,'files');c.masterPath=path.join(destination,'master','owner-master.xlsx');
 await writeJson(L.configFile,c);writeBackupPolicy(L,c);
 // a backup older than the running release is brought forward with the release's own forward-only migrations
 const mig=nodeIn(L,ops,['--import','tsx','tools/win-installer/provision.ts','--root',L.root,'--phase','migrate'],appEnv(L,c,st));
 if(mig.status!==0)fail('RESTORE_FORWARD_MIGRATION_FAILED',(mig.stderr||mig.stdout).slice(-1500));
 const s2=stateOf(L);history(L,s2,'RESTORE_ACTIVATED',{database,previous});
 await startServices(L,c);const health=await waitHealthy(L,c);
 return {...result,activated:true,previous,forwardMigrationsApplied:restoredCompat.pending,health:{ok:health.ok}};
}

async function upgrade(){
 const L=layout(args.root),c=cfgOf(L),st=stateOf(L);
 const packageDir=path.resolve(args.package??fail('PACKAGE_REQUIRED'));
 const m=await verifyPackage(packageDir,path.resolve(args['public-key']??fail('PUBLIC_KEY_REQUIRED')));
 if(m.testFault&&args['allow-test-fault']!=='yes')fail('PACKAGE_TEST_FAULT_NOT_ALLOWED');
 if(!args['allow-same-version']&&compareVersions(m.version,st.current.version)<=0)fail('UPGRADE_VERSION_NOT_NEWER',{current:st.current.version,package:m.version});
 if(m.minFromVersion&&compareVersions(st.current.version,m.minFromVersion)<0)fail('UPGRADE_FROM_VERSION_TOO_OLD',{minFromVersion:m.minFromVersion});
 const installedRuntime=await readJson(path.join(L.runtime,'runtime.json'),null);
 if(m.runtime&&installedRuntime&&JSON.stringify(m.runtime)!==JSON.stringify(installedRuntime))fail('RUNTIME_CHANGE_NOT_SUPPORTED');
 const next=releaseDir(L,m.version);
 if(existsSync(next))fail('RELEASE_DIRECTORY_EXISTS');
 // compatibility of the new release with the live ledger
 pgStart(L,c);
 const ledger=ledgerOf(L,c);
 const newRelease=JSON.parse(readFileSync(path.join(packageDir,'payload','release','release.json'),'utf8'));
 const compat=schemaCompatibility({ledger,releaseMigrations:newRelease.migrations});
 if(!compat.compatibleWithDatabase)fail('UPGRADE_SCHEMA_INCOMPATIBLE',compat);
 say('pre-upgrade verified backup');
 const pre=await takeBackup(L,c);
 // services are stopped; PostgreSQL is running
 say('staging release '+m.version);
 cpSync(path.join(packageDir,'payload','release'),next+'.staging',{recursive:true});
 const {renameSync}=await import('node:fs');renameSync(next+'.staging',next);
 history(L,st,'UPGRADE_STARTED',{from:st.current.version,to:m.version,backup:pre.backupBase});
 say('applying forward migrations ('+compat.pending.length+' pending)');
  const prov=nodeIn(L,path.join(next,'ops'),['--import','tsx','tools/win-installer/provision.ts','--root',L.root,'--phase','migrate'],appEnv(L,c,{...st,current:{...st.current,revision:m.revision}}));
 if(prov.status!==0){
  const live=ledgerOf(L,c);
  const oldRelease=await readJson(path.join(releaseDir(L,st.current.version),'release.json'));
  const ok=canRollbackApplicationOnly({ledger:live,targetMigrations:oldRelease.migrations}).ok;
  const s=stateOf(L);history(L,s,ok?'UPGRADE_FAILED_MIGRATION_OLD_RELEASE_KEPT':'UPGRADE_FAILED_MIGRATION_RESTORE_REQUIRED',{to:m.version});
  rmSync(next,{recursive:true,force:true});
  if(ok){await startServices(L,c);await waitHealthy(L,c);}
  fail(ok?'UPGRADE_MIGRATION_FAILED_OLD_RELEASE_STILL_RUNNING':'UPGRADE_MIGRATION_FAILED_RESTORE_REQUIRED',(prov.stderr||prov.stdout).slice(-1500));
 }
 // switch release atomically, refresh the admin tools, start, verify
 const from=st.current;
 st.previous=from;st.current={version:m.version,revision:m.revision,migrationsSha256:m.migrationsSha256};st.preUpgradeBackup=pre.backupBase;saveState(L,st);
 syncAdmin(L,next);
 try{
  await startServices(L,c);
  const health=await waitHealthy(L,c,{timeout:healthTimeout()});
  history(L,st,'UPGRADED',{from:from.version,to:m.version});
  return {upgraded:true,from:from.version,to:m.version,pendingMigrationsApplied:compat.pending,preUpgradeBackup:pre.backupBase,health:{ok:health.ok}};
 }catch(error){
  say('new release did not become healthy: '+error.message+' — rolling back');
  const rb=await rollbackInternal(L,c,{reason:'UPGRADE_HEALTH_FAILED'}).catch(e=>({rolledBack:false,error:e.message}));
  const s=stateOf(L);history(L,s,'UPGRADE_FAILED_AUTO_ROLLBACK',{to:m.version,result:rb});
  if(rb.rolledBack){const {renameSync:mv}=await import('node:fs');try{mv(next,next+'.failed-'+Date.now());}catch{/* kept as is */}}
  fail('UPGRADE_FAILED_HEALTH',rb);
 }
}

async function rollbackInternal(L,c,{reason}){
 const st=stateOf(L);
 if(!st.previous)fail('NO_PREVIOUS_RELEASE');
 await stopServices(L,{keepDatabase:true});pgStart(L,c);
 const target=st.previous,targetRelease=await readJson(path.join(releaseDir(L,target.version),'release.json'));
 const ledger=ledgerOf(L,c);
 const gate=canRollbackApplicationOnly({ledger,targetMigrations:targetRelease.migrations});
 if(!gate.ok){history(L,st,'ROLLBACK_REFUSED_SCHEMA',{reason:gate.reason,unknown:gate.unknown});await startServices(L,c).catch(()=>{});fail('ROLLBACK_REQUIRES_DATABASE_RESTORE',{reason:gate.reason,newerMigrations:gate.unknown,preUpgradeBackup:st.preUpgradeBackup??null});}
 const from=st.current;st.current=target;st.previous=from;saveState(L,st);
 syncAdmin(L,releaseDir(L,target.version));
 await startServices(L,c);const health=await waitHealthy(L,c,{timeout:healthTimeout()});
 history(L,st,'ROLLED_BACK',{from:from.version,to:target.version,reason});
 return {rolledBack:true,from:from.version,to:target.version,health:{ok:health.ok}};
}
async function rollback(){const L=layout(args.root),c=cfgOf(L);return rollbackInternal(L,c,{reason:'OPERATOR'});}

async function uninstall(){
 const L=layout(args.root),c=cfgOf(L);
 if(args.confirm!==path.basename(L.root))fail('CONFIRM_WITH_ROOT_FOLDER_NAME_REQUIRED');
 await stopServices(L);unregisterTask(c);
 const keep=!args['remove-data'];
 const own=path.resolve(process.execPath).toLowerCase().startsWith(L.root.toLowerCase()+path.sep);
 if(keep){for(const d of [L.releases,path.join(L.root,'admin')])rmSync(d,{recursive:true,force:true});
  if(existsSync(L.runtime))for(const e of readdirSync(L.runtime))if(!(own&&e==='node'))rmSync(path.join(L.runtime,e),{recursive:true,force:true}); // the running node.exe cannot delete itself
  rmSync(path.join(L.root,'nipt.cmd'),{force:true});const s=stateOf(L);s.status='UNINSTALLED_DATA_RETAINED';saveState(L,s);return {uninstalled:true,dataRetained:true,root:L.root};}
 // The installed CLI runs from its own runtime folder, which Windows will not let it delete: remove everything else now and
 // let a detached cmd delete the rest after this process exits.
 if(own){
  for(const e of readdirSync(L.root))if(e!=='runtime')rmSync(path.join(L.root,e),{recursive:true,force:true});
  for(const e of readdirSync(L.runtime))if(e!=='node')rmSync(path.join(L.runtime,e),{recursive:true,force:true});
  const {spawn}=await import('node:child_process');
  spawn(system32('cmd.exe'),['/c',`ping -n 4 127.0.0.1 >nul & rmdir /s /q "${L.root}"`],{detached:true,windowsHide:true,stdio:'ignore'}).unref();
  return {uninstalled:true,dataRetained:false,root:L.root,finalRemoval:'SCHEDULED_AFTER_EXIT'};
 }
 rmSync(L.root,{recursive:true,force:true});
 return {uninstalled:true,dataRetained:false,root:L.root};
}

async function status(){
 const L=layout(args.root),c=cfgOf(L),st=stateOf(L);
 return {instance:c.instance,status:st.status,release:st.current,previous:st.previous,supervisorPid:supervisorPid(L),task:taskInfo(c),postgresRunning:pgRunning(L),services:(await readJson(L.state,{})).services??{},lastBackup:c.lastBackupPath??null};
}

const commands={
 'verify-package':async()=>{const m=await verifyPackage(path.resolve(args.package),path.resolve(args['public-key']));return {ok:true,version:m.version,revision:m.revision,files:Object.keys(m.files).length};},
 preflight,install,
 start:async()=>{const L=layout(args.root),c=cfgOf(L);await startServices(L,c);return {started:true};},
 stop:async()=>{const L=layout(args.root);await stopServices(L,{keepDatabase:args['keep-database']===true});return {stopped:true};},
 restart:async()=>{const L=layout(args.root),c=cfgOf(L);await stopServices(L);await startServices(L,c);await waitHealthy(L,c);return {restarted:true};},
 status,
 health:async()=>{const L=layout(args.root);return healthReport(L,cfgOf(L));},
 backup,restore,upgrade,rollback,uninstall
};
if(!commands[command]){process.stderr.write(`usage: nipt-admin <${Object.keys(commands).join('|')}> --root <dir> [options]\n`);process.exit(2);}
try{
 const result=await commands[command]();
 process.stdout.write(JSON.stringify(result,null,2)+'\n');
 if(result?.ok===false)process.exitCode=1;
}catch(e){
 process.stdout.write(JSON.stringify({ok:false,error:e.message,detail:e.detail},null,2)+'\n');
 process.exitCode=1;
}
