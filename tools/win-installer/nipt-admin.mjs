// NIPT-CBH Windows offline installer / operator CLI. Node built-ins only (runs from the package's own node.exe before any dependency exists).
//   node nipt-admin.mjs <command> --root <install root> [options]
// Commands: verify-package, preflight, install, start, stop, restart, status, health, backup, restore, upgrade, rollback, uninstall.
// Profile follows the signed package: `test` (six UAT accounts, test banner) or `production` (admin bootstrap, no test account, acceptance never set). Nothing here connects to a HIS, touches a hospital share, applies a Production migration or accepts clinical use.
import {execFileSync,spawnSync} from 'node:child_process';
import {randomBytes,randomUUID,generateKeyPairSync} from 'node:crypto';
import {existsSync,readFileSync,writeFileSync,mkdirSync,rmSync,cpSync,readdirSync,copyFileSync,appendFileSync,statSync,renameSync} from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {
 layout,validateConfig,assertSafeRoot,portFree,freeBytes,MIN_FREE_BYTES,verifyPackage,sha256File,readJson,writeJson,compareVersions,
 schemaCompatibility,canRollbackApplicationOnly,healthVerdict,classifyUpgradeHealthOutcome,recordedProcessState,parseLedgerOutput,isValidHost,isIPv4,originFor,sanEntries,sanText,normalizeLanAllow,normalizeLanProfiles,pickLanAddress,
 environmentVariables,ENVIRONMENT_STAMP_FORMAT
} from './lib.mjs';
import {releaseFormEnvironment} from './form-assets.mjs';

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
// Windows PowerShell 5.1 started from a PowerShell 7 session inherits PSModulePath entries for PowerShell 7 and then cannot load its own
// Security module (the Cert: drive disappears). Always give it the Windows PowerShell module path only. (Found when Setup was started from pwsh.)
const psEnv=()=>({...process.env,PSModulePath:[path.join(process.env.USERPROFILE??'','Documents','WindowsPowerShell','Modules'),path.join(process.env.ProgramFiles??'C:\\Program Files','WindowsPowerShell','Modules'),path.join(SYS,'System32','WindowsPowerShell','v1.0','Modules')].join(';')});
const ps=(script)=>run(psExe,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-Command',script],{env:psEnv()});
const q=s=>`'${String(s).replaceAll("'","''")}'`;

async function waitFor(check,label,ms=120000,step=500){
 const start=Date.now();
 while(Date.now()-start<ms){try{if(await check())return;}catch{/* retry */}await sleep(step);}
 fail('TIMEOUT_'+(typeof label==='function'?label():label));
}

// ───────────────────────────── state ─────────────────────────────
function stateOf(L){return JSON.parse(readFileSync(L.installState,'utf8'));}
function saveState(L,s){writeFileSync(L.installState,JSON.stringify(s,null,2));}
function history(L,s,event,detail={}){
 const latest=existsSync(L.installState)?stateOf(L):s;
 // Health probes persist independently while an upgrade runs; merge their current state before saving the older transition object.
 if(Object.hasOwn(latest,'healthCheck'))s.healthCheck=latest.healthCheck;
 s.history=[...(latest.history??s.history??[]),{at:new Date().toISOString(),event,...detail}];
 saveState(L,s);
}
// A backup run under the service identity cannot rewrite config (read-only for it by design: it holds the share policy), so the
// last backup is also recorded in runlast-backup.json, which wins when present.
const cfgOf=L=>{const c=validateConfig(JSON.parse(readFileSync(L.configFile,'utf8')));try{const b=JSON.parse(readFileSync(path.join(L.run,'last-backup.json'),'utf8'));if(typeof b.lastBackupPath==='string')c.lastBackupPath=b.lastBackupPath;}catch{/* none yet */}return c;};
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
function startTask(c,name=taskName(c)){
 const ref=`-TaskName ${q(name)} -TaskPath ${q(TASK_PATH)}`;
 // Setup is also the recovery path for an installed-but-unaccepted release. A disabled task cannot be started;
 // enable the already-registered product task before starting it, while preserving its existing action/principal.
 ps(`$ErrorActionPreference='Stop';$t=Get-ScheduledTask ${ref} -ErrorAction Stop;if([string]$t.State -eq 'Disabled'){Enable-ScheduledTask ${ref} -ErrorAction Stop | Out-Null};Start-ScheduledTask ${ref} -ErrorAction Stop`);
}
function unregisterTask(c){try{ps(`Unregister-ScheduledTask -TaskName ${q(taskName(c))} -TaskPath ${q(TASK_PATH)} -Confirm:$false -ErrorAction Stop`);}catch{/* not registered */}}

// ── native Excel bridge (only when the applications cannot reach Excel themselves, i.e. they run as a SYSTEM task) ──
const bridgeTaskName=c=>taskName(c)+'-excel-bridge';
const bridgeMode=c=>(c.excelMode??(c.taskMode==='system'?'bridge':'direct'))==='bridge';
function registerBridgeTask(L,c){
 const user=c.excelUser??whoami(),pwsh=path.join(L.runtime,'pwsh','pwsh.exe'),script=path.join(L.root,'admin','Start-ExcelBridge.ps1');
 ps(`$ErrorActionPreference='Stop';`+
  `$a=New-ScheduledTaskAction -Execute ${q(pwsh)} -Argument ${q(`-NoLogo -NoProfile -ExecutionPolicy Bypass -File "${script}" -Root "${L.root}"`)} -WorkingDirectory ${q(L.root)};`+
  `$t=New-ScheduledTaskTrigger -AtLogOn -User ${q(user)};`+
  `$s=New-ScheduledTaskSettingsSet -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries;`+
  `$p=New-ScheduledTaskPrincipal -UserId ${q(user)} -LogonType Interactive -RunLevel Limited;`+
  `Register-ScheduledTask -TaskName ${q(bridgeTaskName(c))} -TaskPath ${q(TASK_PATH)} -Action $a -Trigger $t -Settings $s -Principal $p -Force | Out-Null`);
}
function bridgeStatus(L){
 try{const s=JSON.parse(readFileSync(path.join(L.excelSpool,'bridge-status.json'),'utf8'));const age=(Date.now()-Date.parse(s.updatedAt))/1000;return {state:s.state,pid:s.pid,ageSeconds:age,alive:(s.state==='idle'&&age<10)||(s.state==='processing'&&age<240)};}catch{return {state:'NOT_RUNNING',alive:false};}
}
async function stopBridge(L,c){
 try{writeFileSync(path.join(L.excelSpool,'stop.request'),'stop');}catch{/* no spool */}
 try{await waitFor(()=>!bridgeStatus(L).alive,'BRIDGE_STOP',30000);}catch{/* continue: the task is stopped below */}
 try{ps(`Stop-ScheduledTask -TaskName ${q(bridgeTaskName(c))} -TaskPath ${q(TASK_PATH)}`);}catch{/* not registered or not running */}
}
async function startBridge(L,c){
 rmSync(path.join(L.excelSpool,'stop.request'),{force:true});
 startTask(c,bridgeTaskName(c));
 await waitFor(()=>bridgeStatus(L).alive,'EXCEL_BRIDGE_START',60000);
}
/** After a release switch the bridge must be restarted so it uses the new release's export script. */
async function restartBridge(L,c){if(!bridgeMode(c))return;await stopBridge(L,c);await startBridge(L,c);}
function unregisterBridgeTask(c){try{ps(`Unregister-ScheduledTask -TaskName ${q(bridgeTaskName(c))} -TaskPath ${q(TASK_PATH)} -Confirm:$false -ErrorAction Stop`);}catch{/* not registered */}}


const alive=pid=>{try{process.kill(pid,0);return true;}catch(e){return e.code==='EPERM';}};
function supervisorPid(L){try{const pid=Number(readFileSync(L.supervisorLock,'utf8'));return Number.isInteger(pid)&&alive(pid)?pid:null;}catch{return null;}}
function processEvidence(L,pid,marker){
 const value=Number(pid);if(!Number.isInteger(value)||value<=0)return {pid:null,state:'NOT_RECORDED'};
 const isAlive=alive(value);if(!isAlive)return {pid:value,state:'NOT_RUNNING'};
 try{
  const raw=ps(`$p=Get-CimInstance Win32_Process -Filter ${q(`ProcessId = ${value}`)} -ErrorAction Stop;if($p){[pscustomobject]@{name=[string]$p.Name;commandLine=[string]$p.CommandLine}|ConvertTo-Json -Compress}`);
  if(!raw)return {pid:value,state:'UNVERIFIED'};
  const actual=JSON.parse(raw);
  return {pid:value,state:recordedProcessState({pid:value,alive:isAlive,image:actual.name,commandLine:actual.commandLine,root:L.root,marker})};
 }catch{return {pid:value,state:'UNVERIFIED'};}
}
const supervisorEvidence=L=>processEvidence(L,supervisorPid(L),'supervisor.mjs');

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


// Dual-environment layout: the database itself names its environment, so a Staging-only operation can verify it is not looking at Production data.
// Database names are validated by validateConfig ([a-z0-9_]), so they are safe as SQL identifiers here.
const DATABASE_MARKER=c=>`NIPT_ENVIRONMENT=${c.environment}`;
function markDatabase(L,c){if(c.environment!==undefined)psql(L,c,`COMMENT ON DATABASE ${c.database} IS '${DATABASE_MARKER(c)}'`,{db:'postgres'});}
function databaseEnvironment(L,c){try{return psql(L,c,`SELECT coalesce(shobj_description(oid,'pg_database'),'') FROM pg_database WHERE datname='${c.database}'`,{db:'postgres'});}catch{return null;}}

// psql on Windows terminates lines with CRLF: parse tolerantly so a trailing CR can never turn a matching checksum into a mismatch.
function ledgerOf(L,c,db=c.database){
 return parseLedgerOutput(psql(L,c,"SELECT name||'|'||checksum FROM schema_migration ORDER BY name",{db}));
}

// ───────────────────────────── environment for application tools ─────────────────────────────
function appEnv(L,c,st,extra={}){
 const files=c.filesRoot??L.files,master=c.masterWorkbook?(c.masterPath??path.join(L.master,'approved-master.xlsx')):undefined;
 return {
  ...process.env,NIPT_MODE:c.mode,NIPT_OPERATIONAL_DATABASE:c.database,APP_ORIGIN:c.origin,NEXT_TELEMETRY_DISABLED:'1',
  ...releaseFormEnvironment(releaseDir(L,st.current.version)),
  FILE_STORE_ROOT:files,SIMULATOR_ROOT:path.join(L.data,'integration'),RENDERER_URL:`http://127.0.0.1:${c.ports.renderer}`,RENDERER_TOKEN_FILE:secretFile(L,'renderer-token'),
  IDENTITY_LOOKUP_KEY_FILE:secretFile(L,'identity-lookup.key'),NIPT_HIS_SHARE_POLICY_FILE:path.join(L.config,'share-policy.json'),NIPT_BACKUP_POLICY_FILE:path.join(L.config,'backup-policy.json'),
  PLAYWRIGHT_BROWSERS_PATH:L.browsers,PG_BIN:L.pgBin,...(existsSync(path.join(L.runtime,'pwsh','pwsh.exe'))?{NIPT_NATIVE_POWERSHELL:path.join(L.runtime,'pwsh','pwsh.exe')}:{}),...(bridgeMode(c)?{NIPT_NATIVE_EXCEL_SPOOL:L.excelSpool}:{}),BACKUP_KEY_FILE:secretFile(L,'backup.key'),NIPT_SOURCE_SHA:st.current.revision,
  ...(master?{NIPT_TASK_MASTER_PATH:master}:{}),
  ...environmentVariables(c,L.root),
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
 const priorState=existsSync(L.installState)?JSON.parse(readFileSync(L.installState,'utf8')):null;
 add('install_root_empty',(!priorState&&(!existsSync(L.root)||readdirSync(L.root).length===0))||priorState?.status==='UNINSTALLED_DATA_RETAINED',priorState?(priorState.status==='UNINSTALLED_DATA_RETAINED'?'data retained from an earlier uninstall: it will be reused, never recreated':'already installed'):'');
 try{mkdirSync(L.root,{recursive:true});add('free_space_8gb',await freeBytes(L.root)>=MIN_FREE_BYTES,String(await freeBytes(L.root)));}catch(e){add('free_space_8gb',false,e.message);}
 const ports=await resolvePorts();
 for(const [name,port] of Object.entries(ports))add('port_'+name,await portFree(port,name==='https'&&args.lan==='yes'?'0.0.0.0':'127.0.0.1'),String(port));
 if(args.lan==='yes'){const h=args.host??detectLan()?.ipv4;add('lan_address',!!h&&isValidHost(h),String(h??'no LAN adapter with a default gateway was found'));}
 let manifest=null;
 try{manifest=await verifyPackage(packageDir,path.resolve(args['public-key']??fail('PUBLIC_KEY_REQUIRED')));add('package_signature_and_files',true,manifest.version);}catch(e){add('package_signature_and_files',false,e.message);}
 add('runtime_in_package',!!manifest?.runtimeIncluded&&existsSync(path.join(packageDir,'payload','runtime','pg','bin','initdb.exe'))&&existsSync(path.join(packageDir,'payload','runtime','node','node.exe')),'');
 const masterFile=args['master-workbook']??path.join(packageDir,'payload','master','approved-master.xlsx');
 if(existsSync(masterFile)){try{add('master_workbook_sha256',await sha256File(masterFile)===JSON.parse(readFileSync(path.join(packageDir,'payload','release','ops','packages','workbook','master-manifest.json'),'utf8')).sha256,'');}catch(e){add('master_workbook_sha256',false,e.message);}}
 else add('master_workbook_sha256',false,'MASTER_WORKBOOK_REQUIRED (operational backups need the approved master)');
 add('task_scheduler',taskSchedulerAvailable(),'');
 add('powershell7_in_package',existsSync(path.join(packageDir,'payload','runtime','pwsh','pwsh.exe')),'the native Excel export needs PowerShell 7');
 const word=wordInstalled();
 add('word_installed',word||args['allow-no-word']==='yes',word?'':'Microsoft Word is not registered on this host: the signed NIPT result PDF cannot be produced (override: --allow-no-word yes)');
 const excel=excelInstalled();
 add('excel_installed',excel||args['allow-no-excel']==='yes',excel?'':'Microsoft Excel is not registered on this host: Task List PDFs cannot be produced (override: --allow-no-excel yes)');
 if(excel&&(args['excel-mode']??(args['task-mode']==='system'?'bridge':'direct'))==='direct')add('default_printer_current_user',defaultPrinterPresent(),'the export reads the signed-in user default printer (HKCU) and sets it to A4');
 const ok=checks.every(c=>c.ok);
 return {ok,checks,manifest:manifest?{version:manifest.version,revision:manifest.revision}:null};
}
function wordInstalled(){try{run(system32('reg.exe'),['query','HKCR\\Word.Application\\CurVer']);return true;}catch{return false;}}
function excelInstalled(){try{run(system32('reg.exe'),['query','HKCR\\Excel.Application\\CurVer']);return true;}catch{return false;}}
function defaultPrinterPresent(){try{return ps("(Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows NT\\CurrentVersion\\Windows' -Name Device -ErrorAction Stop).Device").trim().length>0;}catch{return false;}}
function taskSchedulerAvailable(){try{ps('Get-Command Register-ScheduledTask | Out-Null');return true;}catch{return false;}}
let autoPortCache=null;
/** `--ports auto`: PostgreSQL, web and renderer on high loopback ports that are free now; HTTPS on 443 when free, otherwise 8443 (then upwards). */
async function pickFree(candidates,host,taken){for(const p of candidates)if(!taken.includes(p)&&await portFree(p,host))return p;fail('NO_FREE_PORT',{candidates:[candidates[0],candidates.at(-1)]});}
async function resolvePorts(){
 if(args.ports!=='auto')return portsFromArgs();
 if(autoPortCache)return autoPortCache;
 const range=(a,n)=>Array.from({length:n},(_,i)=>a+i),taken=[];
 const postgres=await pickFree(range(55432,40),'127.0.0.1',taken);taken.push(postgres);
 const web=await pickFree(range(38080,40),'127.0.0.1',taken);taken.push(web);
 const renderer=await pickFree(range(38200,40),'127.0.0.1',taken);taken.push(renderer);
 const https=await pickFree([443,...range(8443,20)],args.lan==='yes'?'0.0.0.0':'127.0.0.1',taken);
 return autoPortCache={postgres,web,https,renderer};
}
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

/** A single confidential file (the one-time credential hand-off): installing user, SYSTEM and Administrators only, no inherited access. */
function secureFile(file){
 const user=whoami();
 run(system32('icacls.exe'),[file,'/inheritance:r','/grant:r',`${user}:F`,'*S-1-5-18:F','*S-1-5-32-544:F']);
}

async function install(){
 const pre=await preflight();
 if(!pre.ok)fail('PREFLIGHT_FAILED',pre.checks.filter(c=>!c.ok));
 const packageDir=path.resolve(args.package),L=layout(args.root);
 const m=await verifyPackage(packageDir,path.resolve(args['public-key']));
 if(m.testFault)fail('PACKAGE_TEST_FAULT_NOT_ALLOWED');
 const production=m.testEnvironmentOnly===false;
 if(args.profile!==undefined&&args.profile!==(production?'production':'test'))fail('PROFILE_PACKAGE_MISMATCH',{package:production?'production':'test',requested:args.profile});
 if(production&&(m.extraTestMigration||m.rehearsalOnly||m.testFault))fail('PRODUCTION_PACKAGE_REFUSES_TEST_INPUTS');
 const masterSource=path.resolve(args['master-workbook']??path.join(packageDir,'payload','master','approved-master.xlsx'));
 const retained=existsSync(L.installState)&&JSON.parse(readFileSync(L.installState,'utf8')).status==='UNINSTALLED_DATA_RETAINED';
 // retained data already holds its accounts: a reinstall never bootstraps again and never needs new first-account names
 const initialAdmins=production&&!retained?initialAdminInput():null;
 const keptConfig=retained?cfgOf(L):null;
 const ports=keptConfig?keptConfig.ports:await resolvePorts(),instance=keptConfig?keptConfig.instance:String(args.instance??'nipt-cbh');
 const lanWanted=args.lan==='yes';
 // dual-environment layout (deploy\windows): the environment is fixed at first install and survives a reinstall on retained data
 const environment=args.environment===undefined?keptConfig?.environment:String(args.environment);
 if(keptConfig&&keptConfig.environment!==environment)fail('ENVIRONMENT_CHANGE_NOT_ALLOWED',{retained:keptConfig.environment??null,requested:environment??null});
 const protectedRoots=args['protected-roots']===undefined?keptConfig?.protectedRoots:String(args['protected-roots']).split(';').map(s=>s.trim()).filter(Boolean);
 const detectedLan=lanWanted&&!args.host?detectLan():null;
 const hostChosen=String(args.host??(lanWanted?(detectedLan?.ipv4??fail('LAN_ADDRESS_NOT_FOUND')):'localhost'));
 const config=validateConfig({
  instance,mode:'operational',database:keptConfig?keptConfig.database:String(args.database??`nipt_operational_${instance.replaceAll('-','_')}`).slice(0,60),ports,
  origin:String(args.origin??originFor(hostChosen,ports.https)),host:hostChosen,lanEnabled:lanWanted,taskMode:args['task-mode']==='system'?'system':'user',testEnvironmentOnly:!production,
  masterWorkbook:true,
  excelMode:args['excel-mode']==='bridge'?'bridge':args['excel-mode']==='direct'?'direct':(args['task-mode']==='system'?'bridge':'direct'),
  ...(args['excel-user']?{excelUser:String(args['excel-user'])}:{}),
  ...(environment!==undefined?{environment,protectedRoots}:{}),
  ...(lanWanted?{httpsHost:String(args['https-host']??'0.0.0.0'),lanAllow:normalizeLanAllow(args['lan-allow']),lanProfiles:normalizeLanProfiles(args['lan-profiles'])}:(args['https-host']?{httpsHost:String(args['https-host'])}:{}))
 });
 if(config.taskMode==='system'&&!isAdmin())fail('ADMINISTRATOR_REQUIRED_FOR_SYSTEM_TASK');
 say('creating layout');
 for(const d of [L.releases,L.runtime,L.data,L.files,L.inbound,L.outbound,L.master,L.secrets,L.config,L.tls,L.logs,L.run,L.backups,L.restores,L.excelSpool,path.join(L.root,'admin'),path.join(L.outbound,'res'),path.join(L.outbound,'pdf'),path.join(L.outbound,'backup'),path.join(L.data,'integration','results')])mkdirSync(d,{recursive:true});
 secureDirectory(L.secrets);
 // every service refuses to start unless this stamp names the same environment as its configuration (tools/environment-boundary.mjs)
 if(config.environment!==undefined&&!retained)await writeJson(path.join(L.root,'environment.json'),{format:ENVIRONMENT_STAMP_FORMAT,environment:config.environment,instance,createdAt:new Date().toISOString()});
 say('copying runtime and release (offline)');
 cpSync(path.join(packageDir,'payload','runtime'),L.runtime,{recursive:true});
 const target=releaseDir(L,m.version);
 cpSync(path.join(packageDir,'payload','release'),target,{recursive:true});
 syncAdmin(L,target);
 await writeJson(L.configFile,config);
 if(!retained)copyFileSync(masterSource,path.join(L.master,'approved-master.xlsx'));
 const release=await readJson(path.join(target,'release.json'));
 const state={retainedHistory:retained?(JSON.parse(readFileSync(L.installState,'utf8')).history??[]):[],format:'NIPT_WINDOWS_INSTALL_STATE_V1',instance,testEnvironmentOnly:!production,profile:production?'production':'test',status:'INSTALLING',current:{version:m.version,revision:m.revision,migrationsSha256:m.migrationsSha256},previous:null,history:[],installedAt:new Date().toISOString(),acceptance:'NOT_ACCEPTED'};
 saveState(L,state);
 say('generating secrets, certificate and policies');
 const credentials=retained?null:generateSecrets(L,config,initialAdmins);
 generateCertificate(L,config);
 writePolicies(L,config);
 const trust=args['trust-certificate']==='yes'?trustCertificate(L,config):{trusted:false,reason:'NOT_REQUESTED'};
 if(trust.trusted)await writeJson(L.configFile,config);
 say(retained?'reusing the retained PostgreSQL cluster':'initializing the private PostgreSQL cluster');
 if(!retained)initCluster(L,config);
 pgStart(L,config);
 try{
  say(retained?'applying forward migrations to the retained database':'migrating the database and creating accounts');
  const r=nodeIn(L,path.join(target,'ops'),['--import','tsx','tools/win-installer/provision.ts','--root',L.root,'--phase',retained?'migrate':'install','--profile',production?'production':'test'],appEnv(L,config,state));
  if(r.status!==0)fail('PROVISION_FAILED',(r.stderr||r.stdout).slice(-2000));
  markDatabase(L,config);
 }finally{pgStop(L);}
 if(credentials){writeFileSync(L.credentials,credentials,{mode:0o600});secureFile(L.credentials);}
 history(L,state,retained?'REINSTALLED_ON_RETAINED_DATA':'INSTALLED',{version:m.version});
 state.status='INSTALLED_NOT_ACCEPTED';saveState(L,state);
 // the scoped firewall rule exists BEFORE the first start, so Windows never shows its own "allow access" prompt for node.exe
 const firewall=ensureFirewall(L,config);
 say('registering the startup task');
 registerTask(L,config);
 if(bridgeMode(config)){registerBridgeTask(L,config);await startBridge(L,config);}
 await startServices(L,config);
 await waitHealthy(L,config,{timeout:180000});
 say('taking the first verified backup (go-live gate)');
 const backup=await takeBackup(L,config);
 await startServices(L,config);
 const health=await waitHealthy(L,config);
 const lan=await lanSummary(L,config);
 return {installed:true,reusedRetainedData:retained,root:L.root,version:m.version,url:config.origin,lan,firewall,trust,credentials:L.credentials,admin:path.join(L.root,'admin','nipt-admin.mjs'),firstBackup:backup.backupBase,health,migrations:release.migrationCount};
}
const isAdmin=()=>{try{run(system32('net.exe'),['session']);return true;}catch{return false;}};

function syncAdmin(L,releaseRoot){
 const src=path.join(releaseRoot,'ops','tools','win-installer'),dst=path.join(L.root,'admin');
 mkdirSync(dst,{recursive:true});
 for(const f of readdirSync(src))if(/\.(mjs|ps1)$/.test(f))copyFileSync(path.join(src,f),path.join(dst,f));
 writeFileSync(path.join(L.root,'nipt.cmd'),`@echo off\r\n"%~dp0runtime\\node\\node.exe" "%~dp0admin\\nipt-admin.mjs" %* --root "%~dp0."\r\n`);
 // double-click helpers for the Start menu (the administrator never has to type a command)
 const cli = '"%~dp0runtime\\node\\node.exe" "%~dp0admin\\nipt-admin.mjs"';
 writeFileSync(path.join(L.root, 'Set-LAN.cmd'), `@echo off\r\nchcp 65001 >nul\r\n${cli} set-lan --interactive --root "%~dp0."\r\necho.\r\npause\r\n`);
 writeFileSync(path.join(L.root, 'Status.cmd'), `@echo off\r\nchcp 65001 >nul\r\n${cli} lan-status --root "%~dp0."\r\necho.\r\n${cli} status --root "%~dp0."\r\npause\r\n`);
}

/** Production: the operator names the ONE first account (APP_ADMIN, owner decision 2026-11-01); there is no default username and no
 * default password. A second bootstrap identity (the former CLINICAL_APPROVER) is refused: other users are added in user management. */
function initialAdminInput(){
 const need=k=>{const v=args[k];if(typeof v!=='string'||!v.trim())fail('PRODUCTION_ADMIN_IDENTITY_REQUIRED',{missing:k});return v.trim();};
 for(const k of ['checker-user','checker-name'])if(args[k]!==undefined)fail('SINGLE_ADMIN_BOOTSTRAP_ONLY',{unexpected:k});
 const admin={username:need('admin-user').toLowerCase(),displayName:need('admin-name')};
 if(!/^[a-z0-9._-]{3,64}$/.test(admin.username)||admin.username.startsWith('synthetic.')||admin.username.startsWith('uat.'))fail('PRODUCTION_ADMIN_USERNAME_INVALID',{username:admin.username});
 return {admin};
}

function generateSecrets(L,c,initial){
 const rnd=()=>randomBytes(32).toString('hex'),db=rnd(),web=rnd(),worker=rnd();
 const url=(user,pw)=>`postgresql://${user}:${pw}@127.0.0.1:${c.ports.postgres}/${c.database}`;
 const production=!!initial;
 const accounts=production?[]:[['uat.admin','Installed test administrator','APP_ADMIN'],['uat.lab','Installed test laboratory staff','LAB_STAFF'],['uat.certifier','Installed test laboratory certifier','LAB_CERTIFIER'],
  ['uat.clinical-approver','Installed test clinical approver','CLINICAL_APPROVER'],['uat.auditor','Installed test auditor','AUDITOR'],['uat.anc','Installed test ANC nurse','ANC_NURSE']]
  .map(([username,displayName,role])=>({username,displayName,role,password:rnd()}));
 const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:3072,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});
 const files={'db-password':db,'web-password':web,'worker-password':worker,'migration-url':url('nipt_migrator',db),'web-url':url('nipt_web',web),'worker-url':url('nipt_worker',worker),
  'renderer-token':rnd(),'identity-lookup.key':randomBytes(32),'backup.key':randomBytes(32),'tls-passphrase':rnd(),'integration-public.pem':publicKey,'integration-private.pem':privateKey,...(production?{'initial-admins.json':JSON.stringify({admin:{...initial.admin,password:rnd().slice(0,32)}})}:{'uat-accounts.json':JSON.stringify(accounts,null,2)})};
 for(const [name,value] of Object.entries(files))writeFileSync(secretFile(L,name),value,{flag:'wx',mode:0o600});
 if(production){const i=JSON.parse(files['initial-admins.json']);return ['NIPT-CBH WINDOWS INSTALLATION — FIRST SIGN-IN (CONFIDENTIAL)',`URL: ${c.origin}/login`,'','One-time password: the account must choose a new password at first sign-in.','Deliver the password only to its owner, then DELETE THIS FILE.','',`Role: APP_ADMIN`,`Username: ${i.admin.username}`,`Password: ${i.admin.password}`,''].join(String.fromCharCode(13,10));}
 return ['NIPT-CBH WINDOWS INSTALLATION — TEST ENVIRONMENT ONLY — NOT FOR CLINICAL USE',`URL: ${c.origin}/login`,'',...accounts.flatMap(a=>[`Role: ${a.role}`,`Username: ${a.username}`,`Password: ${a.password}`,''])].join('\r\n');
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
 writeFileSync(path.join(L.config,'backup-policy.json'),JSON.stringify({version:1,serviceAccount:whoami(),sourceDatabase:c.database,backupRoot:c.backupRoot??L.backups,restoreRoot:L.restores,restoreDatabasePrefix:'nipt_operational_restore_',outboundRoots},null,2));
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
 const supervisor=supervisorEvidence(L);
 const verdict=healthVerdict(report,{supervisor:supervisor.state==='RUNNING',https:httpsOk,excelBridge:bridgeMode(c)?bridgeStatus(L).alive:undefined});
 return {...verdict,release:st.current.version,details:{lanUrl:c.origin,lanEnabled:!!c.lanEnabled,supervisorProcess:supervisor.state,postgresProcess:pgRunning(L),databaseReachable:report.databaseReachable===true,workerAlive:report.workerAlive,heartbeatAgeSeconds:report.heartbeatAgeSeconds,backlog:report.backlog,webReachable:report.webReachable,rendererReachable:report.rendererReachable,https:httpsOk,excelBridge:bridgeMode(c)?bridgeStatus(L).state:'NOT_USED_DIRECT_EXCEL',backupStatus:report.backupStatus,migrationsMatch:report.migrationsMatch,auditValid:report.auditValid,rolesRestricted:report.rolesRestricted,quarantined:report.quarantined,clinicalAcceptance:false,hospitalOperationalAcceptance:false}};
}
const healthTimeout=(d=180000)=>Number(args['health-timeout-seconds'])>0?Number(args['health-timeout-seconds'])*1000:d;
function recordHealthCheck(L,status,{timeoutMs,elapsedMs,report}={}){
 const st=stateOf(L);
 st.healthCheck={status,release:st.current.version,checkedAt:new Date().toISOString(),...(timeoutMs===undefined?{}:{timeoutMs}),...(elapsedMs===undefined?{}:{elapsedMs}),...(report?{failed:report.failed??[],technicalReady:report.technicalReady===true,backupStatus:report.backupStatus??'UNKNOWN',details:report.details??{}}:{})};
 // the scheduled backup runs as the service identity, which can read but not rewrite install-state.json (by design)
 try{saveState(L,st);}catch(e){if(e?.code!=='EPERM'&&e?.code!=='EACCES')throw e;}
}
async function waitHealthy(L,c,{timeout=120000}={}){
 const started=Date.now();let last;
 recordHealthCheck(L,'STARTING',{timeoutMs:timeout});
 await waitFor(async()=>{last=await healthReport(L,c);return last.ok;},()=>`HEALTH_${JSON.stringify(last?.failed??['HEALTH_REPORT_UNAVAILABLE'])}`,timeout,3000).catch(e=>{
  const detail={state:'FAILED',release:stateOf(L).current.version,timeoutMs:timeout,elapsedMs:Date.now()-started,failed:last?.failed??['HEALTH_REPORT_UNAVAILABLE'],health:last??null};
  recordHealthCheck(L,'FAILED',{timeoutMs:timeout,elapsedMs:detail.elapsedMs,report:last});
  e.detail=detail;throw e;
 });
 recordHealthCheck(L,'HEALTHY',{timeoutMs:timeout,elapsedMs:Date.now()-started,report:last});
 return last;
}

async function takeBackup(L,c){
 const st=stateOf(L),ops=path.join(releaseDir(L,st.current.version),'ops');
 await stopServices(L,{keepDatabase:true});
 pgStart(L,c);
 const env=appEnv(L,c,st,{DATABASE_URL:readSecret(L,'migration-url'),BACKUP_SOURCE_QUIESCENT:'yes'});
 const r=nodeIn(L,ops,[path.join('tools','win-installer','ops-backup.mjs'),'backup',c.backupRoot??L.backups],env);
 if(r.status!==0)fail('BACKUP_FAILED',(r.stderr||r.stdout).slice(-2000));
 const out=JSON.parse(r.stdout.trim().split('\n').pop());
 c.lastBackupPath=out.backupBase;mkdirSync(L.run,{recursive:true});await writeJson(path.join(L.run,'last-backup.json'),{lastBackupPath:out.backupBase,at:new Date().toISOString()});
 try{await writeJson(L.configFile,c);}catch{/* service identity: config is read-only by design; runlast-backup.json holds it */}
 const index=await readJson(path.join(c.backupRoot??L.backups,'index.json'),[]);index.push({...out,release:st.current.version,at:new Date().toISOString()});await writeJson(path.join(c.backupRoot??L.backups,'index.json'),index);
 return out;
}

async function backup(){
 const L=layout(args.root),c=cfgOf(L);
 const out=await takeBackup(L,c);
 await startServices(L,c);await waitHealthy(L,c);
 const pruned=args.keep===undefined?[]:await pruneBackups(L,c,args.keep);
 return {backup:out,...(args.keep===undefined?{}:{retention:{keep:Number(args.keep),pruned}})};
}
/** Retention after a successful backup: keep the newest N backups of THIS installation. Only folders recorded in its own index.json,
 *  named operational-*, directly inside the backup root, are removed; anything else in the destination is never touched. */
async function pruneBackups(L,c,keepArg){
 const keep=Number(keepArg);if(!Number.isInteger(keep)||keep<3||keep>365)fail('KEEP_MUST_BE_3_TO_365');
 const root=c.backupRoot??L.backups,indexFile=path.join(root,'index.json'),index=await readJson(indexFile,[]);
 const ordered=[...index].sort((a,b)=>String(a.at).localeCompare(String(b.at))),old=ordered.slice(0,Math.max(0,ordered.length-keep)),pruned=[];
 for(const b of old){
  const base=String(b.backupBase??''),inside=path.dirname(path.resolve(base)).toLowerCase()===path.resolve(root).toLowerCase()&&/^operational-\d+-[0-9a-f-]{36}$/i.test(path.basename(base));
  if(!inside)continue; // never outside this installation's own backup folders
  rmSync(base,{recursive:true,force:true});pruned.push(path.basename(base));
 }
 await writeJson(indexFile,index.filter(b=>!pruned.includes(path.basename(String(b.backupBase??'')))));
 return pruned;
}

async function restore(){
 const L=layout(args.root),c=cfgOf(L),st=stateOf(L);
 if(!args.backup&&args.fresh!==true)fail('BACKUP_REQUIRED');
 const ops=path.join(releaseDir(L,st.current.version),'ops');
 await stopServices(L,{keepDatabase:true});pgStart(L,c);
 // --fresh: back up the current (quiescent) source first and restore exactly that backup, so nothing can change between backup and activation.
 // Used for recovery drills and planned moves; an older backup over changed work is refused by the activation gate.
 const backupDir=args.fresh===true?(await takeBackup(L,c)).backupBase:path.resolve(args.backup);
 const id=randomUUID().replaceAll('-',''),database='nipt_operational_restore_'+id.slice(0,24),destination=path.join(L.restores,id);
 psql(L,c,`CREATE DATABASE ${database}`,{db:'postgres'});
 const restoreUrl=urlFor(L,c,'migration-url',database);
 const env=appEnv(L,c,st,{DATABASE_URL:readSecret(L,'migration-url'),RESTORE_DATABASE_URL:restoreUrl,RESTORE_TO_NEW_OPERATIONAL_DATABASE:'yes'});
 const r=nodeIn(L,ops,[path.join('tools','win-installer','ops-restore.mjs'),'restore',backupDir,destination],env);
 if(r.status!==0){psql(L,c,`DROP DATABASE IF EXISTS ${database}`,{db:'postgres'});await startServices(L,c);fail('RESTORE_FAILED',(r.stderr||r.stdout).slice(-2000));}
 const receipt=JSON.parse(r.stdout.trim().split('\n').pop());
 const result={restored:true,database,destination,receipt:{restoreVerified:receipt.restoreVerified,quarantined:receipt.quarantined,tableCount:receipt.tableCount,fileCount:receipt.fileCount,tableDigest:receipt.tableDigest}};
 // a fresh installation has an empty file store, which the backup does not carry as a directory; the restored tree must still have one
 mkdirSync(path.join(destination,'files'),{recursive:true});
 if(!args.activate){await startServices(L,c);await waitHealthy(L,c);return {...result,activated:false,note:'restored database is quarantined and not in use; inspect then rerun with --activate --confirm-source-fenced yes'};}
 if(args['confirm-source-fenced']!=='yes'){await startServices(L,c);fail('SOURCE_FENCE_CONFIRMATION_REQUIRED');}
 const releaseNow=await readJson(path.join(releaseDir(L,st.current.version),'release.json'));
 const restoredLedger=ledgerOf(L,c,database);
 const restoredCompat=schemaCompatibility({ledger:restoredLedger,releaseMigrations:releaseNow.migrations});
 if(!restoredCompat.compatibleWithDatabase){await startServices(L,c);fail('RESTORE_BACKUP_NEWER_THAN_RELEASE',restoredCompat);}
 const a=nodeIn(L,ops,[path.join('tools','win-installer','ops-restore.mjs'),'activate',destination],{...env,RESTORE_SOURCE_FENCED:'yes'});
 if(a.status!==0){
  const text=(a.stderr||a.stdout);await startServices(L,c);
  // The existing activation gate refuses to fence a source that changed after the backup: activating would silently discard that work.
  if(text.includes('RESTORE_SOURCE_CHANGED_SINCE_BACKUP'))fail('RESTORE_SOURCE_CHANGED_SINCE_BACKUP',{database,destination,note:'the live database changed after this backup; the restored copy stays quarantined for inspection. Activating an older backup discards later work and needs an Owner/IT-authorised procedure.'});
  fail('ACTIVATION_FAILED',text.slice(-2000));
 }
 // the application now runs on the restored database and file store
 psql(L,c,`GRANT CREATE ON DATABASE ${database} TO nipt_worker`,{db:'postgres'});
 const previous={database:c.database,filesRoot:c.filesRoot??L.files,masterPath:c.masterPath??null};
 for(const n of ['migration-url','web-url','worker-url'])writeFileSync(secretFile(L,n),urlFor(L,c,n,database),{mode:0o600});
 c.database=database;c.filesRoot=path.join(destination,'files');c.masterPath=path.join(destination,'master','owner-master.xlsx');
 await writeJson(L.configFile,c);writeBackupPolicy(L,c);
 // a backup older than the running release is brought forward with the release's own forward-only migrations
 const mig=nodeIn(L,ops,['--import','tsx','tools/win-installer/provision.ts','--root',L.root,'--phase','migrate'],appEnv(L,c,st));
 if(mig.status!==0)fail('RESTORE_FORWARD_MIGRATION_FAILED',(mig.stderr||mig.stdout).slice(-1500));
 markDatabase(L,c);
 const s2=stateOf(L);history(L,s2,'RESTORE_ACTIVATED',{database,previous});
 await startServices(L,c);const health=await waitHealthy(L,c);
 return {...result,activated:true,previous,forwardMigrationsApplied:restoredCompat.pending,health:{ok:health.ok}};
}

async function upgrade(){
 const L=layout(args.root),c=cfgOf(L),st=stateOf(L);
 const packageDir=path.resolve(args.package??fail('PACKAGE_REQUIRED'));
 const m=await verifyPackage(packageDir,path.resolve(args['public-key']??fail('PUBLIC_KEY_REQUIRED')));
 if((m.testFault||m.rehearsalOnly)&&args['allow-test-fault']!=='yes')fail('PACKAGE_TEST_FAULT_NOT_ALLOWED');
 // an update is built on one exact installed source; any other installed revision is refused before anything is touched
 if(m.requiresInstalledRevision&&m.requiresInstalledRevision!==st.current.revision)fail('UPGRADE_BASE_REVISION_MISMATCH',{installedVersion:st.current.version,installedRevision:st.current.revision,requiredRevision:m.requiresInstalledRevision});
 // an installation never changes profile through an upgrade: a test package cannot be applied to production data, nor the reverse
 if((m.testEnvironmentOnly===false)!==(c.testEnvironmentOnly===false))fail('UPGRADE_PROFILE_MISMATCH',{installed:c.testEnvironmentOnly===false?'production':'test',package:m.testEnvironmentOnly===false?'production':'test'});
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
 let pre;
 try{pre=await takeBackup(L,c);}
 catch(error){ // nothing was changed yet: leave the installed system running exactly as before
  say('pre-upgrade backup failed — restarting the installed release unchanged');
  await startServices(L,c).then(()=>waitHealthy(L,c)).catch(e=>say('restart after failed backup: '+e.message));
  throw error;
 }
 // services are stopped; PostgreSQL is running
 say('staging release '+m.version);
 cpSync(path.join(packageDir,'payload','release'),next+'.staging',{recursive:true});
 const {renameSync}=await import('node:fs');renameSync(next+'.staging',next);
 history(L,st,'UPGRADE_STARTED',{from:st.current.version,to:m.version,backup:pre.backupBase});
 say('applying forward migrations ('+compat.pending.length+' pending)');
  const prov=nodeIn(L,path.join(next,'ops'),['--import','tsx','tools/win-installer/provision.ts','--root',L.root,'--phase','migrate'],appEnv(L,c,{...st,current:{...st.current,version:m.version,revision:m.revision}}));
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
 await restartBridge(L,c).catch(e=>say('excel bridge restart failed: '+e.message));
 try{
  await startServices(L,c);
  const health=await waitHealthy(L,c,{timeout:healthTimeout()});
  history(L,st,'UPGRADED',{from:from.version,to:m.version});
  return {upgraded:true,from:from.version,to:m.version,pendingMigrationsApplied:compat.pending,preUpgradeBackup:pre.backupBase,health:{ok:health.ok}};
 }catch(error){
  say('new release did not become healthy: '+error.message+' — checking rollback compatibility');
  const healthFailure={code:error.message,detail:error.detail??null};
  const rb=await rollbackInternal(L,c,{reason:'UPGRADE_HEALTH_FAILED'}).catch(e=>({rolledBack:false,error:e.message,detail:e.detail??null}));
  const outcome=classifyUpgradeHealthOutcome(rb);
  const s=stateOf(L);history(L,s,rb.rolledBack?'UPGRADE_FAILED_AUTO_ROLLBACK':'UPGRADE_FAILED_RECOVERY_REQUIRED',{from:from.version,to:m.version,healthFailure,rollback:rb});
  if(rb.rolledBack){const {renameSync:mv}=await import('node:fs');try{mv(next,next+'.failed-'+Date.now());}catch{/* kept as is */}}
  const after=stateOf(L);
  fail(outcome,{releaseAttempted:m.version,currentRelease:after.current?.version??null,previousRelease:after.previous?.version??null,installedStatus:after.status??'UNKNOWN',healthFailure,rollback:rb,preUpgradeBackup:after.preUpgradeBackup??pre.backupBase});
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
 await restartBridge(L,c).catch(e=>say('excel bridge restart failed: '+e.message));
 await startServices(L,c);const health=await waitHealthy(L,c,{timeout:healthTimeout()});
 history(L,st,'ROLLED_BACK',{from:from.version,to:target.version,reason});
 return {rolledBack:true,from:from.version,to:target.version,health:{ok:health.ok}};
}
async function rollback(){const L=layout(args.root),c=cfgOf(L);return rollbackInternal(L,c,{reason:'OPERATOR'});}

async function uninstall(){
 const L=layout(args.root),c=cfgOf(L);
 if(args.confirm!==path.basename(L.root))fail('CONFIRM_WITH_ROOT_FOLDER_NAME_REQUIRED');
 await stopServices(L);if(bridgeMode(c))await stopBridge(L,c);unregisterTask(c);unregisterBridgeTask(c);unscheduleBackup();removeFirewall(c);untrustCertificate(c);
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
  // verbatim arguments: Node's default quoting of an argument that contains both spaces and quotes breaks cmd's parsing (a root path with a space was never removed)
  spawn(system32('cmd.exe'),['/d','/s','/c',`"ping -n 4 127.0.0.1 >nul & rmdir /s /q "${L.root}""`],{detached:true,windowsHide:true,stdio:'ignore',windowsVerbatimArguments:true}).unref();
  return {uninstalled:true,dataRetained:false,root:L.root,finalRemoval:'SCHEDULED_AFTER_EXIT'};
 }
 rmSync(L.root,{recursive:true,force:true});
 return {uninstalled:true,dataRetained:false,root:L.root};
}

async function status(){
 const L=layout(args.root),c=cfgOf(L),st=stateOf(L);
 const recorded=await readJson(L.state,{}),serviceMarkers={renderer:'apps/renderer/main.ts',worker:'tools/win-installer/service-worker.ts',web:'server.js',https:'https-proxy.mjs'};
 const services=Object.fromEntries(Object.entries(recorded.services??{}).map(([name,service])=>[name,{...service,liveProcess:processEvidence(L,service.pid,serviceMarkers[name]??'').state}]));
 let databaseReachable=false;try{databaseReachable=psql(L,c,'SELECT 1')==='1';}catch{/* report unavailable separately from the process probe */}
 const supervisor=supervisorEvidence(L),postgresRunning=pgRunning(L);
 const databaseMarker=c.environment===undefined?undefined:(databaseReachable?databaseEnvironment(L,c):null);
 return {instance:c.instance,environment:c.environment??null,...(databaseMarker===undefined?{}:{databaseMarker,databaseMarkerOk:databaseMarker===DATABASE_MARKER(c)}),status:st.status,acceptance:st.acceptance??'NOT_ACCEPTED',healthCheck:st.healthCheck??{status:'UNKNOWN'},release:st.current,previous:st.previous,supervisorPid:supervisor.pid,supervisorProcess:supervisor.state,task:taskInfo(c),postgresRunning,postgresProcess:postgresRunning?'RUNNING':'NOT_RUNNING',databaseReachable,services,lastBackup:c.lastBackupPath??null};
}


// ───────────────────────────── hospital LAN access ─────────────────────────────
// The HTTPS front is the ONLY listener that may leave the machine; PostgreSQL, the web process and the renderer stay on loopback.
// The published address (IP or DNS name) is the application origin: users must type exactly that URL.
const firewallRuleName=c=>`NIPT-CBH HTTPS (${c.instance})`;
function detectLan(){
 const raw=ps("$r=@(Get-NetIPConfiguration | Where-Object {$_.IPv4DefaultGateway -and $_.NetAdapter.Status -eq 'Up'} | ForEach-Object {[pscustomobject]@{alias=$_.InterfaceAlias;description=$_.InterfaceDescription;ipv4=@($_.IPv4Address)[0].IPAddress;gateway=@($_.IPv4DefaultGateway)[0].NextHop;metric=[int]$_.NetIPv4Interface.InterfaceMetric;category=[string]$_.NetProfile.NetworkCategory}});ConvertTo-Json -InputObject $r -Compress");
 let adapters=[];try{adapters=JSON.parse(raw);}catch{/* none */}
 return pickLanAddress(Array.isArray(adapters)?adapters:[adapters]);
}
function firewallState(c){
 try{
  return JSON.parse(ps(`$r=Get-NetFirewallRule -DisplayName ${q(firewallRuleName(c))} -ErrorAction Stop;$p=$r|Get-NetFirewallPortFilter;$a=$r|Get-NetFirewallAddressFilter;$g=$r|Get-NetFirewallApplicationFilter;[pscustomobject]@{exists=$true;enabled=[string]$r.Enabled;profile=[string]$r.Profile;direction=[string]$r.Direction;action=[string]$r.Action;localPort=[string]$p.LocalPort;remoteAddress=(@($a.RemoteAddress) -join ',');program=[string]$g.Program}|ConvertTo-Json -Compress`));
 }catch{return {exists:false};}
}
function ensureFirewall(L,c){
 if(!c.lanEnabled)return {created:false,reason:'LAN_DISABLED'};
 if(!isAdmin())return {created:false,reason:'ADMINISTRATOR_REQUIRED'};
 const profiles=normalizeLanProfiles(c.lanProfiles),allow=normalizeLanAllow(c.lanAllow),name=firewallRuleName(c);
 ps(`$ErrorActionPreference='Stop';Get-NetFirewallRule -DisplayName ${q(name)} -ErrorAction SilentlyContinue | Remove-NetFirewallRule;`+
  `New-NetFirewallRule -DisplayName ${q(name)} -Description 'NIPT-CBH HTTPS front only. Limited to the hospital network; never PostgreSQL, web or renderer.' -Direction Inbound -Action Allow -Protocol TCP -LocalPort ${c.ports.https} -Profile ${profiles} -RemoteAddress ${allow} -Program ${q(L.node)} | Out-Null`);
 return {created:true,name,profiles,remoteAddress:allow,port:c.ports.https,program:L.node};
}
function removeFirewall(c){try{if(isAdmin())ps(`Get-NetFirewallRule -DisplayName ${q(firewallRuleName(c))} -ErrorAction SilentlyContinue | Remove-NetFirewallRule`);}catch{/* best effort */}}
function generateCertificate(L,c){
 const pass=readSecret(L,'tls-passphrase'),host=c.host??'localhost',san=sanText(sanEntries(c.host,os.hostname()));
 ps(`$ErrorActionPreference='Stop';`+
  `$c=New-SelfSignedCertificate -Subject ${q('CN='+host)} -TextExtension @(${q(san)}) -KeyAlgorithm RSA -KeyLength 2048 -HashAlgorithm SHA256 -NotAfter (Get-Date).AddDays(397) -CertStoreLocation Cert:\\CurrentUser\\My -KeyExportPolicy Exportable;`+
  `$s=ConvertTo-SecureString -String ${q(pass)} -AsPlainText -Force;`+
  `Export-PfxCertificate -Cert $c -FilePath ${q(path.join(L.tls,'server.pfx'))} -Password $s | Out-Null;`+
  `Export-Certificate -Cert $c -FilePath ${q(path.join(L.tls,'server.cer'))} -Type CERT | Out-Null;`+
  `Remove-Item -Path ('Cert:\\CurrentUser\\My\\'+$c.Thumbprint) -Force`);
 const der=readFileSync(path.join(L.tls,'server.cer'));
 writeFileSync(path.join(L.tls,'server.pem'),`-----BEGIN CERTIFICATE-----\n${der.toString('base64').match(/.{1,64}/g).join('\n')}\n-----END CERTIFICATE-----\n`);
}
/** Trusting the installation's own certificate on THIS machine only (LocalMachine\Root, needs Administrator). Recorded by thumbprint and removed on uninstall. */
function trustCertificate(L,c){
 if(!isAdmin())return {trusted:false,reason:'ADMINISTRATOR_REQUIRED'};
 const thumb=ps(`(Import-Certificate -FilePath ${q(path.join(L.tls,'server.cer'))} -CertStoreLocation Cert:\\LocalMachine\\Root).Thumbprint`).trim();
 if(!/^[A-F0-9]{40}$/i.test(thumb))return {trusted:false,reason:'IMPORT_FAILED'};
 c.trustedCertThumbprint=thumb;return {trusted:true,thumbprint:thumb};
}
function untrustCertificate(c){
 if(!c.trustedCertThumbprint||!/^[A-F0-9]{40}$/i.test(c.trustedCertThumbprint))return {removed:false};
 try{if(isAdmin()){ps(`Remove-Item -Path ('Cert:\\LocalMachine\\Root\\'+${q(c.trustedCertThumbprint)}) -Force -ErrorAction Stop`);delete c.trustedCertThumbprint;return {removed:true};}}catch{/* reported */}
 return {removed:false,reason:'ADMINISTRATOR_REQUIRED_OR_ALREADY_GONE'};
}
/** Checked from the server itself against the published host name or address (not "localhost"): TLS name match, health answer, certificate download. */
function lanProbe(L,c){
 const host=c.host??'localhost';
 return new Promise(resolve=>{
  const ca=readFileSync(path.join(L.tls,'server.pem'));
  const opts={host,port:c.ports.https,path:'/api/health',ca,timeout:6000,...(isIPv4(host)?{}:{servername:host})};
  const req=https.get(opts,resp=>{let b='';resp.on('data',d=>b+=d);resp.on('end',()=>{let ok=false;try{ok=resp.statusCode===200&&JSON.parse(b).status==='ok';}catch{/* not json */}resolve({url:c.origin,reachableFromThisServer:ok,tlsNameMatches:true,statusCode:resp.statusCode});});});
  req.on('error',e=>resolve({url:c.origin,reachableFromThisServer:false,tlsNameMatches:!/altname|hostname|IP/i.test(e.message),error:e.code??e.message}));
  req.on('timeout',()=>{req.destroy();resolve({url:c.origin,reachableFromThisServer:false,error:'TIMEOUT'});});
 });
}
async function lanSummary(L,c){
 const probe=await lanProbe(L,c);
 const fw=c.lanEnabled?firewallState(c):{exists:false,notApplicable:true};
 const warnings=[];
 if(c.lanEnabled){
  if(!fw.exists)warnings.push('FIREWALL_RULE_MISSING');
  const net=detectLan();
  if(net&&!normalizeLanProfiles(c.lanProfiles).split(',').includes(net.category))warnings.push('NETWORK_CATEGORY_NOT_COVERED:'+net.category);
  if(c.host&&net&&isIPv4(c.host)&&net.ipv4!==c.host)warnings.push('HOST_IS_NOT_THIS_SERVERS_CURRENT_ADDRESS');
 }
 return {enabled:!!c.lanEnabled,url:c.origin,host:c.host??'localhost',listenAddress:c.lanEnabled?(c.httpsHost??'0.0.0.0'):'127.0.0.1',port:c.ports.https,allow:c.lanEnabled?normalizeLanAllow(c.lanAllow):null,profiles:c.lanEnabled?normalizeLanProfiles(c.lanProfiles):null,
  firewall:fw,probe,certificateDownload:c.lanEnabled?`${c.origin}/.well-known/nipt-cbh-certificate.cer`:null,certificateTrustedOnThisServer:!!c.trustedCertThumbprint,warnings,
  note:'Reachability is checked from this server only. Open the URL from an ANC or Lab computer to prove the network path; the certificate is self-signed unless a hospital certificate was installed.'};
}
async function setLan(){
 const L=layout(args.root),c=cfgOf(L);
 const rl=args.interactive===true?(await import('node:readline/promises')).createInterface({input:process.stdin,output:process.stderr}):null;
 const ask=async(q2,def)=>rl?((await rl.question(`${q2} [${def}]: `)).trim()||def):def;
 try{
  const detected=detectLan();
  const lanEnabled=args.lan==='no'?false:args.lan==='yes'?true:rl?((await ask('เปิดให้เครื่องอื่นใน LAN เข้าใช้งาน? (yes/no)',c.lanEnabled?'yes':'yes'))==='yes'):(c.lanEnabled??false);
  let host=args.host?String(args.host):c.host&&c.host!=='localhost'?c.host:detected?.ipv4;
  if(lanEnabled&&rl)host=await ask('ที่อยู่ที่ผู้ใช้จะพิมพ์ใน Browser (IP หรือชื่อ DNS)',host??'');
  if(!lanEnabled)host=args.host?String(args.host):'localhost';
  if(!isValidHost(host))fail('HOST_INVALID',{host});
  const allow=normalizeLanAllow(args.allow??(rl?await ask('จำกัดให้เข้าได้เฉพาะ (LocalSubnet หรือ CIDR เช่น 192.168.1.0/24)',c.lanAllow??'LocalSubnet'):(c.lanAllow??'LocalSubnet')));
  const profiles=normalizeLanProfiles(args.profiles??c.lanProfiles??'Domain,Private');
  const port=args.port?Number(args.port):c.ports.https;
  if(!Number.isInteger(port)||port<1||port>65535||[c.ports.postgres,c.ports.web,c.ports.renderer].includes(port))fail('PORT_INVALID');
  const next={...c,host,lanEnabled,ports:{...c.ports,https:port},origin:originFor(host,port),...(lanEnabled?{httpsHost:'0.0.0.0',lanAllow:allow,lanProfiles:profiles}:{httpsHost:'127.0.0.1'})};
  validateConfig(next);
  // OWNER-LAB-058: a DNS name must resolve on this server before anything is stopped (IT owns the DNS record and certificate).
  if(!isIPv4(host)&&host!=='localhost'){try{await (await import('node:dns/promises')).lookup(host);}catch(e){fail('HOST_DNS_UNRESOLVED',{host,error:e.code??String(e)});}}
  const before={origin:c.origin,host:c.host??null,lanEnabled:!!c.lanEnabled,port:c.ports.https};
  const tlsBackup=existsSync(path.join(L.tls,'server.pfx'))?readFileSync(path.join(L.tls,'server.pfx')):null,passBackup=existsSync(secretFile(L,'tls-passphrase'))?readFileSync(secretFile(L,'tls-passphrase')):null;
  const record=(outcome,extra={})=>appendFileSync(path.join(L.logs,'origin-changes.jsonl'),JSON.stringify({at:new Date().toISOString(),actor:os.userInfo().username,computer:os.hostname(),before,after:{origin:next.origin,host,lanEnabled,port},outcome,...extra})+'\n');
  await stopServices(L);
  untrustCertificate(next);
  if(args['cert-pfx']){
   // a hospital certificate: it must open with its passphrase and name the published host
   const pfx=path.resolve(String(args['cert-pfx'])),passFile=path.resolve(String(args['cert-passphrase-file']??fail('CERT_PASSPHRASE_FILE_REQUIRED')));
   const pass=readFileSync(passFile,'utf8').trim();
   const info=JSON.parse(ps(`$c=New-Object System.Security.Cryptography.X509Certificates.X509Certificate2(${q(pfx)},${q(pass)});[pscustomobject]@{san=(($c.Extensions|Where-Object{$_.Oid.Value -eq '2.5.29.17'}|ForEach-Object{$_.Format($false)}) -join ';');days=[int]($c.NotAfter-(Get-Date)).TotalDays;hasKey=$c.HasPrivateKey}|ConvertTo-Json -Compress`));
   if(!info.hasKey)fail('CERT_HAS_NO_PRIVATE_KEY');if(info.days<1)fail('CERT_EXPIRED');
   if(!new RegExp('(DNS Name|IP Address)=?\\s*:?\\s*'+host.replaceAll('.','\\.'),'i').test(info.san))fail('CERT_DOES_NOT_NAME_HOST',{host,san:info.san});
   copyFileSync(pfx,path.join(L.tls,'server.pfx'));writeFileSync(secretFile(L,'tls-passphrase'),pass,{mode:0o600});
   ps(`$c=New-Object System.Security.Cryptography.X509Certificates.X509Certificate2(${q(pfx)},${q(pass)});[IO.File]::WriteAllBytes(${q(path.join(L.tls,'server.cer'))},$c.Export('Cert'))`);
   const der=readFileSync(path.join(L.tls,'server.cer'));writeFileSync(path.join(L.tls,'server.pem'),`-----BEGIN CERTIFICATE-----\n${der.toString('base64').match(/.{1,64}/g).join('\n')}\n-----END CERTIFICATE-----\n`);
  }else generateCertificate(L,next); // the self-signed test certificate always follows the published host
  await writeJson(L.configFile,next);
  const fw=ensureFirewall(L,next);if(!lanEnabled)removeFirewall(next);
  const trust=args['trust-certificate']==='yes'?trustCertificate(L,next):{trusted:false,reason:'NOT_REQUESTED'};
  await writeJson(L.configFile,next);
  // OWNER-LAB-058: if the new origin does not come up healthy, restore the previous configuration and certificate (no lockout).
  try{await startServices(L,next);await waitHealthy(L,next,{timeout:120000});}
  catch(e){
   await stopServices(L).catch(()=>undefined);
   if(tlsBackup)writeFileSync(path.join(L.tls,'server.pfx'),tlsBackup);if(passBackup)writeFileSync(secretFile(L,'tls-passphrase'),passBackup,{mode:0o600});
   await writeJson(L.configFile,c);if(!c.lanEnabled)removeFirewall(c);else ensureFirewall(L,c);
   await startServices(L,c);await waitHealthy(L,c,{timeout:120000}).catch(()=>undefined);
   record('ROLLED_BACK',{error:e?.code??String(e?.message??e)});
   fail('ORIGIN_CHANGE_ROLLED_BACK',{restored:c.origin,error:e?.code??String(e?.message??e)});
  }
  record('APPLIED');
  return {lan:await lanSummary(L,next),firewallAction:fw,trust,before,note:'Sessions of signed-in users end because the origin changed; they sign in again at the new URL.'};
 }finally{rl?.close();}
}
async function lanStatus(){const L=layout(args.root),c=cfgOf(L);return lanSummary(L,c);}

// ───────────────────────────── backup destination, schedule, DR drill, photo tools ─────────────────────────────
const backupTaskName=c=>taskName(c)+'-backup';
async function setBackupRoot(){
 const L=layout(args.root),c=cfgOf(L),target=path.resolve(String(args.path??fail('PATH_REQUIRED')));
 if(!/^(?:[a-z]:|\\\\)/i.test(target))fail('BACKUP_ROOT_MUST_BE_A_DRIVE_OR_UNC_PATH');
 if(target.toLowerCase().startsWith(L.data.toLowerCase()))fail('BACKUP_ROOT_MUST_BE_OUTSIDE_THE_DATA_FOLDER');
 // pg_dump.exe writes its dump file into the backup folder through the ANSI command line: a path the system code page cannot represent makes it fail (found by the rehearsal)
 if(!/^[ -~]+$/.test(target))fail('BACKUP_ROOT_MUST_BE_ASCII');
 // prove the account that will run the scheduled backup can write it (the same account as the application task)
 mkdirSync(target,{recursive:true});const probe=path.join(target,'nipt-write-test-'+process.pid+'.tmp');writeFileSync(probe,'x');rmSync(probe);
 c.backupRoot=target;await writeJson(L.configFile,c);writeBackupPolicy(L,c);
 return {backupRoot:target,policyUpdated:true,note:'Run a backup now to prove the destination end to end; the encryption key stays in <root>\\secrets and must be escrowed separately.'};
}
function scheduleBackup(){
 const L=layout(args.root),c=cfgOf(L),at=String(args.time??'02:00');
 if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(at))fail('TIME_MUST_BE_HH_MM');
 if(args.keep!==undefined&&(!Number.isInteger(Number(args.keep))||Number(args.keep)<3||Number(args.keep)>365))fail('KEEP_MUST_BE_3_TO_365');
 const user=whoami();
 const trigger=`New-ScheduledTaskTrigger -Daily -At ${q(at)}`;
 const principal=c.taskMode==='system'?"New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest":`New-ScheduledTaskPrincipal -UserId ${q(user)} -LogonType Interactive -RunLevel Limited`;
 ps(`$ErrorActionPreference='Stop';`+
  `$a=New-ScheduledTaskAction -Execute ${q(L.node)} -Argument ${q(`"${path.join(L.root,'admin','nipt-admin.mjs')}" backup --root "${L.root}"${args.keep===undefined?'':` --keep ${Number(args.keep)}`}`)} -WorkingDirectory ${q(L.root)};`+
  `$t=${trigger};`+
  `$s=New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Hours 3) -StartWhenAvailable -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries;`+
  `$p=${principal};`+
  `Register-ScheduledTask -TaskName ${q(backupTaskName(c))} -TaskPath ${q(TASK_PATH)} -Action $a -Trigger $t -Settings $s -Principal $p -Force | Out-Null`);
 return {scheduled:true,task:TASK_PATH+backupTaskName(c),dailyAt:at,...(args.keep===undefined?{}:{keep:Number(args.keep)}),account:c.taskMode==='system'?'SYSTEM':user,note:'The backup stops the applications for its duration (quiescent snapshot). Choose a quiet hour; the achieved RPO is the interval between successful backups, not the schedule.'};
}
function unscheduleBackup(){const L=layout(args.root),c=cfgOf(L);void L;try{ps(`Unregister-ScheduledTask -TaskName ${q(backupTaskName(c))} -TaskPath ${q(TASK_PATH)} -Confirm:$false -ErrorAction Stop`);return {unscheduled:true};}catch{return {unscheduled:false,note:'no backup task was registered'};}}
async function backupsList(){
 const L=layout(args.root),c=cfgOf(L);
 const index=await readJson(path.join(c.backupRoot??L.backups,'index.json'),[]);
 return {backupRoot:c.backupRoot??L.backups,count:index.length,backups:index.map(b=>({at:b.at,release:b.release,files:b.fileCount,path:b.backupBase,manifestSha256:b.manifestSha256})),lastBackupPath:c.lastBackupPath??null};
}
const dirBytes=dir=>{let n=0;const walk=d=>{for(const e of readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);if(e.isDirectory())walk(p);else n+=statSync(p).size;}};try{walk(dir);}catch{/* gone */}return n;};
/** Recovery drill: timed quiescent backup, verified restore into a quarantined database, then the drill copy is removed and the services restart.
 *  Nothing is activated and the live database is never overwritten. The numbers are measurements for RPO/RTO planning on THIS host, not guarantees. */
async function drDrill(){
 const L=layout(args.root),c=cfgOf(L),st=stateOf(L),ops=path.join(releaseDir(L,st.current.version),'ops');
 const t0=Date.now();const lap=()=>Math.round((Date.now()-t0)/100)/10;
 const backup=await takeBackup(L,c);const afterBackup=lap();
 const id=randomUUID().replaceAll('-',''),database='nipt_operational_restore_'+id.slice(0,24),destination=path.join(L.restores,id);
 psql(L,c,`CREATE DATABASE ${database}`,{db:'postgres'});
 const env=appEnv(L,c,st,{DATABASE_URL:readSecret(L,'migration-url'),RESTORE_DATABASE_URL:urlFor(L,c,'migration-url',database),RESTORE_TO_NEW_OPERATIONAL_DATABASE:'yes'});
 const r=nodeIn(L,ops,[path.join('tools','win-installer','ops-restore.mjs'),'restore',backup.backupBase,destination],env);
 const afterRestore=lap();
 let receipt=null,failure=null;
 if(r.status===0)receipt=JSON.parse(r.stdout.trim().split('\n').pop());else failure=(r.stderr||r.stdout).slice(-1200);
 const restoredBytes=dirBytes(destination);
 // the drill copy is removed; the live database and file store were never touched
 try{psql(L,c,`DROP DATABASE IF EXISTS ${database}`,{db:'postgres'});}catch{/* reported by the next backup */}
 rmSync(destination,{recursive:true,force:true});
 await startServices(L,c);const h=await waitHealthy(L,c);const afterStart=lap();
 if(failure)fail('DR_DRILL_RESTORE_FAILED',failure);
 return {drill:'COMPLETED_NOT_ACTIVATED',backupBase:backup.backupBase,backupBytes:dirBytes(backup.backupBase),restoredBytes,tables:receipt.tableCount,files:receipt.fileCount,restoreVerified:receipt.restoreVerified,
  seconds:{backup:afterBackup,restore:Math.round((afterRestore-afterBackup)*10)/10,restartAndHealthy:Math.round((afterStart-afterRestore)*10)/10,total:afterStart},
  healthAfter:h.ok,note:'RTO on this host is approximately restore + restart; a rebuilt host adds installation time. RPO is the interval between successful backups. Hospital targets are not defined by this tool.'};
}
async function photos(){
 const L=layout(args.root),c=cfgOf(L),st=stateOf(L),ops=path.join(releaseDir(L,st.current.version),'ops');
 const sub=args._.slice(1);if(!['verify','backup','relocate','restore'].includes(sub[0]))fail('USAGE_PHOTOS_VERIFY_BACKUP_RESTORE_RELOCATE');
 const env=appEnv(L,c,st,{DATABASE_URL:readSecret(L,'migration-url')});
 const r=nodeIn(L,ops,['--import','tsx','tools/run-photos.ts',...sub],env);
 let out;try{out=JSON.parse(r.stdout);}catch{out={raw:(r.stdout||'').slice(-800),stderr:(r.stderr||'').slice(-800)};}
 return {exit:r.status,...(Array.isArray(out)?{result:out}:out)};
}
/** Word + Excel proof in the CURRENT Windows session with the installed runtime (run it as the account that runs the NIPT startup task, and again after a reboot). */
function officeCheck(){
 const L=layout(args.root),c=cfgOf(L),st=stateOf(L),ops=path.join(releaseDir(L,st.current.version),'ops');
 const master=c.masterWorkbook?(c.masterPath??path.join(L.master,'approved-master.xlsx')):undefined;
 const extra=[...(args['report-master']?['--report-master',path.resolve(args['report-master'])]:[]),...(master&&existsSync(master)?['--excel-workbook',master]:[])];
 const r=nodeIn(L,ops,['--import','tsx','tools/win-installer/office-check.ts',...extra],appEnv(L,c,st));
 let out;try{out=JSON.parse(r.stdout.trim().split(String.fromCharCode(10)).pop());}catch{out={ok:false,error:'OFFICE_CHECK_FAILED',stderr:(r.stderr||'').slice(-800)};}
 return {exit:r.status,taskMode:c.taskMode,excelMode:c.excelMode??'direct',...out};
}
function hostCheck(){
 const script=path.join(path.dirname(fileURLToPath(import.meta.url)),'host-check.mjs');
 const r=spawnSync(process.execPath,[script,...process.argv.slice(3).filter(a=>a!=='--root'||true)],{encoding:'utf8',windowsHide:true});
 try{return JSON.parse(r.stdout.trim().split('\n').pop());}catch{return {ok:false,error:'HOST_CHECK_FAILED',stderr:r.stderr.slice(-500)};}
}

/** Schema version of the running database against the active release (read-only; PostgreSQL must be running). */
async function schemaReport(){
 const L=layout(args.root),c=cfgOf(L),st=stateOf(L);
 const release=await readJson(path.join(releaseDir(L,st.current.version),'release.json'));
 let ledger;try{ledger=ledgerOf(L,c);}catch{return {ok:false,error:'DATABASE_UNREACHABLE',environment:c.environment??null,release:st.current.version};}
 const compat=schemaCompatibility({ledger,releaseMigrations:release.migrations});
 return {ok:compat.compatibleWithDatabase&&compat.pending.length===0,environment:c.environment??null,database:c.database,release:st.current.version,revision:st.current.revision,
  releaseMigrationsSha256:release.migrationsSha256,releaseMigrationCount:release.migrationCount,applied:ledger.length,last:ledger.at(-1)?.name??null,ledger,...compat};
}

/** Staging only: replace the database with a freshly provisioned one (same UAT accounts) and set the synthetic file folders aside.
 *  Refuses unless configuration, stamp, profile AND the database's own marker all say Staging. Never deletes the old folders. */
async function resetStaging(){
 const L=layout(args.root),c=cfgOf(L),st=stateOf(L);
 if(c.environment!=='staging'||c.testEnvironmentOnly!==true||st.profile!=='test')fail('RESET_STAGING_ONLY');
 const stamp=await readJson(path.join(L.root,'environment.json'),null);
 if(stamp?.format!==ENVIRONMENT_STAMP_FORMAT||stamp.environment!=='staging')fail('RESET_STAGING_STAMP_REQUIRED');
 if(args.confirm!=='RESET STAGING')fail('RESET_CONFIRMATION_REQUIRED');
 await stopServices(L,{keepDatabase:true});pgStart(L,c);
 const marker=databaseEnvironment(L,c);
 if(marker!==DATABASE_MARKER(c)){await startServices(L,c);fail('RESET_DATABASE_NOT_MARKED_STAGING',{marker});}
 const aside=path.join(L.backups,'reset-'+new Date().toISOString().replace(/[:.]/g,'-'));
 psql(L,c,`DROP DATABASE IF EXISTS ${c.database} WITH (FORCE)`,{db:'postgres'});
 mkdirSync(aside,{recursive:true});
 const files=c.filesRoot??L.files;
 for(const d of [files,path.join(L.data,'integration')])if(existsSync(d))renameSync(d,path.join(aside,path.basename(d)));
 for(const d of [files,L.inbound,path.join(L.outbound,'res'),path.join(L.outbound,'pdf'),path.join(L.outbound,'backup'),path.join(L.data,'integration','results')])mkdirSync(d,{recursive:true});
 const r=nodeIn(L,path.join(releaseDir(L,st.current.version),'ops'),['--import','tsx','tools/win-installer/provision.ts','--root',L.root,'--phase','install','--profile','test'],appEnv(L,c,st));
 if(r.status!==0){history(L,st,'STAGING_RESET_FAILED',{aside});fail('RESET_PROVISION_FAILED',(r.stderr||r.stdout).slice(-2000));}
 markDatabase(L,c);
 history(L,st,'STAGING_RESET',{database:c.database,aside});
 await startServices(L,c);const health=await waitHealthy(L,c);
 return {reset:true,database:c.database,setAside:aside,provision:JSON.parse(r.stdout.trim().split('\n').pop()),health:{ok:health.ok}};
}

const commands={
 'verify-package':async()=>{const m=await verifyPackage(path.resolve(args.package),path.resolve(args['public-key']));return {ok:true,version:m.version,revision:m.revision,files:Object.keys(m.files).length};},
 preflight,install,
 start:async()=>{const L=layout(args.root),c=cfgOf(L);await startServices(L,c);return {started:true};},
 stop:async()=>{const L=layout(args.root);await stopServices(L,{keepDatabase:args['keep-database']===true});return {stopped:true};},
 restart:async()=>{const L=layout(args.root),c=cfgOf(L);await stopServices(L);await startServices(L,c);await waitHealthy(L,c);return {restarted:true};},
 status,
 health:async()=>{const L=layout(args.root);return healthReport(L,cfgOf(L));},
 backup,restore,upgrade,rollback,uninstall,schema:schemaReport,'reset-staging':resetStaging,
 'set-lan':setLan,'lan-status':lanStatus,'set-backup-root':setBackupRoot,'schedule-backup':scheduleBackup,'unschedule-backup':unscheduleBackup,'backups':backupsList,'dr-drill':drDrill,photos,'host-check':hostCheck,'office-check':officeCheck
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
