/**
 * ISOLATED synthetic LAB Owner UAT candidate (Claude takeover 2026-10-25). Clone of tools/task3-uat/uat.ts with its own Compose project,
 *   npx tsx tools/task3-uat/uat.ts start | status | stop
 * Loopback only: https://127.0.0.1:20128 (TLS proxy) -> web 127.0.0.1:20127, renderer 20130, PostgreSQL 20129 (own Compose project
 * and volume). Web, worker and renderer run natively so Microsoft Word/Excel render the Owner masters. Synthetic data only.
 * Nothing here touches another UAT, a hospital path, a real HIS share or Production; "stop" keeps the database volume.
 */
import {spawn,execFileSync,spawnSync} from 'node:child_process';
import {randomBytes,generateKeyPairSync,createHash} from 'node:crypto';
import {cp,mkdir,readFile,writeFile,copyFile,access,chmod} from 'node:fs/promises';
import {openSync,closeSync,readFileSync} from 'node:fs';
import path from 'node:path';
import {Client} from 'pg';
import {PgBoss} from 'pg-boss';
import {sourceInventory} from '../source-inventory.mjs';

const repo=process.cwd(),base=path.join(repo,'.local','claude-lab-uat-runtime'),project='nipt-claude-lab-uat-20261025',compose='tools/claude-lab-uat/compose.yaml';
const PORTS={https:20228,web:20227,db:20229,renderer:20230},DATABASE='nipt_task3_integrated_owner_uat',ORIGIN=`https://127.0.0.1:${PORTS.https}`;
const dir={base,secrets:path.join(base,'secrets'),keys:path.join(base,'keys'),files:path.join(base,'data','files'),simulator:path.join(base,'data','simulator'),share:path.join(base,'his-share'),
 fixtures:path.join(base,'fixtures'),approved:path.join(base,'approved'),forms:path.join(base,'forms'),logs:path.join(base,'logs'),tls:path.join(base,'tls')};
const exists=async(f:string)=>{try{await access(f);return true;}catch{return false;}};
const once=async(f:string,v:string|Buffer)=>{if(!await exists(f))await writeFile(f,v,{flag:'wx'});};
// Protected copies are read-only: copy once, and again only if the bytes differ.
const digestOf=async(f:string)=>createHash('sha256').update(await readFile(f)).digest('hex');
const copyExact=async(from:string,to:string)=>{if(await exists(to)){if(await digestOf(to)===await digestOf(from))return;await chmod(to,0o666);}await copyFile(from,to);};
const secret=(n:string)=>readFileSync(path.join(dir.secrets,n),'utf8').trim();
const docker=(...args:string[])=>execFileSync('docker',['compose','--project-directory',repo,'-p',project,'-f',compose,...args],{cwd:repo,encoding:'utf8',windowsHide:true});
const url=(user:string,pw:string)=>`postgresql://${user}:${encodeURIComponent(pw)}@127.0.0.1:${PORTS.db}/${DATABASE}`;

// Windows PowerShell 5.1 started from PowerShell 7 inherits its module path and then cannot load its own modules (PKI, Cert: drive).
const windowsPowerShellEnv=()=>Object.fromEntries(Object.entries(process.env).filter(([k])=>k.toLowerCase()!=='psmodulepath')) as NodeJS.ProcessEnv;
async function prepareFiles(){
 for(const d of Object.values(dir))await mkdir(d,{recursive:true});
 for(const n of ['db-password','web-password','worker-password','tls-passphrase'])await once(path.join(dir.secrets,n),randomBytes(24).toString('hex'));
 if(!await exists(path.join(dir.keys,'integration-public.pem'))){const pair=generateKeyPairSync('rsa',{modulusLength:3072,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});
  await once(path.join(dir.keys,'integration-private.pem'),pair.privateKey);await once(path.join(dir.keys,'integration-public.pem'),pair.publicKey);}
 for(const n of ['identity','lookup','backup'])await once(path.join(dir.keys,n+'.key'),randomBytes(32));
 await once(path.join(dir.keys,'renderer-token'),randomBytes(32).toString('base64url'));
 // Approved Owner masters (local protected copies, verified by SHA-256 where they are used) — never committed.
 for(const f of ['master.xlsx','pooling.csv','nifty.xlsx','halos-task.xlsx'])await copyExact(path.join(repo,'.local','approved',f),path.join(dir.approved,f));
 for(const f of ['singleton.docx','twin.docx'])await copyExact(path.join(repo,'.local','task3-sources',f),path.join(dir.approved,f));
 await cp(path.join(repo,'..','owner-local-uat-1.0.2','forms'),dir.forms,{recursive:true,force:true});
 await mkdir(path.join(dir.simulator,'results'),{recursive:true});await once(path.join(dir.simulator,'.nipt-synthetic-root'),'NIPT_SYNTHETIC_ONLY_V1');
 const account=execFileSync(path.join(process.env.SystemRoot??'C:\\Windows','System32','whoami.exe'),[],{encoding:'utf8',windowsHide:true}).trim();
 await writeFile(path.join(base,'share-policy.json'),JSON.stringify({version:1,grants:[{root:dir.share,purposes:['INBOUND','OUTBOUND','RESULTS'],serviceAccount:account,secretRef:null,mode:'operational'}]},null,2));
 // Loopback TLS certificate (self-signed, CN=127.0.0.1) created by Windows; the browser shows a local-certificate warning once.
 const pfx=path.join(dir.tls,'uat.pfx');
 if(!await exists(pfx))execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',
  `$c=New-SelfSignedCertificate -Subject 'CN=127.0.0.1' -TextExtension @('2.5.29.17={text}IPAddress=127.0.0.1&DNS=localhost') -CertStoreLocation Cert:\\CurrentUser\\My -NotAfter (Get-Date).AddDays(60) -KeyExportPolicy Exportable;`+
  `Export-PfxCertificate -Cert $c -FilePath '${pfx}' -Password (ConvertTo-SecureString -String '${secret('tls-passphrase')}' -AsPlainText -Force) | Out-Null; Remove-Item -LiteralPath ('Cert:\\CurrentUser\\My\\'+$c.Thumbprint)`],{windowsHide:true,env:windowsPowerShellEnv()});
}
function env(role:'web'|'worker'|'renderer'|'owner'):NodeJS.ProcessEnv{
 const dbUrl=role==='web'?url('nipt_web',secret('web-password')):role==='worker'?url('nipt_worker',secret('worker-password')):url('nipt_migrator',secret('db-password'));
 return {...process.env,NIPT_MODE:'operational',NIPT_OPERATIONAL_DATABASE:DATABASE,DATABASE_URL:dbUrl,APP_ORIGIN:ORIGIN,HOSTNAME:'127.0.0.1',PORT:String(PORTS.web),NEXT_TELEMETRY_DISABLED:'1',
  FILE_STORE_ROOT:dir.files,SIMULATOR_ROOT:dir.simulator,RENDERER_URL:`http://127.0.0.1:${PORTS.renderer}`,RENDERER_PORT:String(PORTS.renderer),RENDERER_HOST:'127.0.0.1',RENDERER_TOKEN_FILE:path.join(dir.keys,'renderer-token'),
  INTEGRATION_PUBLIC_KEY_FILE:path.join(dir.keys,'integration-public.pem'),INTEGRATION_PRIVATE_KEY_FILE:path.join(dir.keys,'integration-private.pem'),IDENTITY_ENCRYPTION_KEY_FILE:path.join(dir.keys,'identity.key'),
  IDENTITY_LOOKUP_KEY_FILE:path.join(dir.keys,'lookup.key'),BACKUP_KEY_FILE:path.join(dir.keys,'backup.key'),NIPT_HIS_SHARE_POLICY_FILE:path.join(base,'share-policy.json'),NIPT_LOCAL_UAT_BANNER:'1',
  NIPT_TASK_MASTER_PATH:path.join(dir.approved,'master.xlsx'),NIPT_POOL_CSV_TEMPLATE:path.join(dir.approved,'pooling.csv'),NIPT_NIFTY_XLSX_TEMPLATE:path.join(dir.approved,'nifty.xlsx'),
  NIPT_HALOS_TASK_TEMPLATE:path.join(dir.approved,'halos-task.xlsx'),NIPT_REPORT_TEMPLATE_SINGLETON:path.join(dir.approved,'singleton.docx'),NIPT_REPORT_TEMPLATE_TWIN:path.join(dir.approved,'twin.docx'),
  NIPT_ANC_FORM_REGISTRY:path.join(dir.forms,'registry.json')};
}
async function prepareDatabase(){
 docker('up','-d','--wait');
 // The image's first-start initialisation restarts the server after the health check passes; a pg Client cannot retry
 // connect() after a failure, so each attempt uses a new client.
 let owner:Client|null=null;
 for(let i=0;i<120&&!owner;i++){const c=new Client({connectionString:url('nipt_migrator',secret('db-password'))});try{await c.connect();await c.query('SELECT 1');owner=c;}catch{await c.end().catch(()=>undefined);await new Promise(r=>setTimeout(r,500));}}
 if(!owner)throw Error('UAT_DATABASE_UNREACHABLE');
 try{
  Object.assign(process.env,env('owner'));
  const {migrate}=await import('../migrate');const {configureOperational}=await import('../configure-operational');
  await migrate(owner);await configureOperational(owner);
  const boss=new PgBoss(url('nipt_migrator',secret('db-password')));await boss.start();await boss.stop();
  await owner.query(await readFile('packages/db/roles.sql','utf8'));await owner.query(await readFile('packages/p6/grants.sql','utf8'));
  for(const [name,group,pw] of [['nipt_web','app_rw','web-password'],['nipt_worker','worker_rw','worker-password']] as const){
   if(!(await owner.query('SELECT 1 FROM pg_roles WHERE rolname=$1',[name])).rows.length)await owner.query(`CREATE ROLE ${name} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '${secret(pw)}'`);
   await owner.query(`GRANT ${group} TO ${name}`);}
  await owner.query(`GRANT CREATE ON DATABASE ${DATABASE} TO nipt_worker`);
  await owner.query('GRANT USAGE ON SCHEMA pgboss TO worker_rw; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA pgboss TO worker_rw; GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA pgboss TO worker_rw');
  await owner.query('GRANT SELECT,INSERT ON file_asset,case_event TO worker_rw');
  const {seedUat}=await import('../task3-uat/seed');
  return await seedUat(owner,{base,files:dir.files,share:dir.share,fixtures:dir.fixtures,approved:dir.approved});
 }finally{await owner.end();}
}
async function build(){
 const inventory=await sourceInventory(repo),runtimeFiles=Object.fromEntries(Object.entries(inventory.files).filter(([name])=>!name.startsWith('docs/'))),runtimeSourceSha256=createHash('sha256').update(JSON.stringify(runtimeFiles)).digest('hex'),stampFile=path.join(base,'build-source.json');
 const previous=await exists(stampFile)?JSON.parse(await readFile(stampFile,'utf8')) as {sha256:string}:null;
 if(previous?.sha256!==inventory.sha256||!await exists(path.join(repo,'.next','standalone','server.js'))){
  const r=spawnSync(process.env.ComSpec??'cmd.exe',['/d','/s','/c','npm.cmd run build'],{cwd:repo,stdio:'inherit',windowsHide:true,env:{...env('web'),NODE_ENV:'production'}});
  if(r.status!==0)throw Error('UAT_BUILD_FAILED');
  const standalone=path.join(repo,'.next','standalone');
  await cp(path.join(repo,'public'),path.join(standalone,'public'),{recursive:true,force:true});await cp(path.join(repo,'.next','static'),path.join(standalone,'.next','static'),{recursive:true,force:true});
  await writeFile(stampFile,JSON.stringify({sha256:inventory.sha256,runtimeSourceSha256,runtimeFiles,buildId:(await readFile(path.join(repo,'.next','BUILD_ID'),'utf8')).trim(),builtAt:new Date().toISOString()},null,2));
 }
 return JSON.parse(await readFile(stampFile,'utf8')) as {sha256:string;runtimeSourceSha256:string;runtimeFiles:Record<string,string>;buildId:string};
}
function launch(name:string,args:string[],cwd:string,e:NodeJS.ProcessEnv){
 const log=openSync(path.join(dir.logs,name+'.log'),'a'),child=spawn(process.execPath,args,{cwd,env:e,detached:true,windowsHide:true,stdio:['ignore',log,log]});closeSync(log);child.unref();
 if(!child.pid)throw Error('UAT_PROCESS_START_FAILED:'+name);return child.pid;
}
const kill=(pid?:number)=>{if(!pid)return;try{execFileSync('taskkill',['/PID',String(pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});}catch{/* already stopped */}};
async function waitHttp(target:string){
 for(let i=0;i<240;i++){try{const r=await fetch(target);if(r.status<500)return r.status;}catch{/* starting */}await new Promise(r=>setTimeout(r,500));}
 throw Error('UAT_NOT_REACHABLE:'+target);
}
async function stop(){
 const runtime=await exists(path.join(base,'runtime.json'))?JSON.parse(await readFile(path.join(base,'runtime.json'),'utf8')) as {pids?:Record<string,number>}:{};
 for(const pid of Object.values(runtime.pids??{}))kill(pid);
 try{docker('stop');}catch{/* not running */}
 process.stdout.write('TASK3_UAT_STOPPED (database volume kept)\n');
}
async function start(){
 await prepareFiles();await stop().catch(()=>undefined);
 const seed=await prepareDatabase();const stamp=await build();
 const tsx=['--import','tsx'];
 const pids={renderer:launch('renderer',[...tsx,'apps/renderer/main.ts'],repo,env('renderer')),worker:launch('worker',[...tsx,'apps/worker/main.ts'],repo,env('worker')),
  web:launch('web',['server.js'],path.join(repo,'.next','standalone'),env('web')),
  tls:launch('tls',['tools/task3-uat/tls-proxy.mjs',path.join(dir.tls,'uat.pfx'),path.join(dir.secrets,'tls-passphrase'),String(PORTS.https),String(PORTS.web)],repo,process.env)};
 await waitHttp(`http://127.0.0.1:${PORTS.web}/login`);
 const head=execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim(),dirty=execFileSync('git',['status','--porcelain'],{cwd:repo,encoding:'utf8'}).trim().length>0;
 const runtime={url:ORIGIN+'/login',project,database:DATABASE,ports:PORTS,pids,sourceSha256:stamp.sha256,runtimeSourceSha256:stamp.runtimeSourceSha256,buildId:stamp.buildId,gitHead:head,gitDirty:dirty,serverSha256:createHash('sha256').update(await readFile(path.join(repo,'.next','standalone','server.js'))).digest('hex'),
  startedAt:new Date().toISOString(),seededNow:seed.seeded,accounts:'admin/admin, lab/lab, lab2/lab2, certifier/certifier, approver/approver, anc/anc, auditor/auditor (loopback synthetic UAT only)'};
 await writeFile(path.join(base,'runtime.json'),JSON.stringify(runtime,null,2));
 process.stdout.write(JSON.stringify({status:'TASK3_UAT_READY',url:runtime.url,database:DATABASE,buildId:stamp.buildId,gitHead:head})+'\n');
}
// ANC Owner update: preserve the existing database/fixtures, and do not invoke any seed or template-copy step.
async function restartPreserved(){
 const previous=JSON.parse(await readFile(path.join(base,'runtime.json'),'utf8'));
 if(previous.database!==DATABASE||previous.project!==project)throw Error('UAT_TARGET_MISMATCH');
 for(const pid of Object.values(previous.pids??{}))kill(Number(pid));
 const owner=new Client({connectionString:url('nipt_migrator',secret('db-password'))});await owner.connect();
 try{await owner.query('SELECT 1');const {migrate}=await import('../migrate');await migrate(owner);
  // Same grant step as a first start: new migrations add tables/functions whose privileges live in roles.sql (idempotent).
  await owner.query(await readFile('packages/db/roles.sql','utf8'));await owner.query(await readFile('packages/p6/grants.sql','utf8'));}finally{await owner.end();}
 const stamp=await build();
 const tsx=['--import','tsx'];
 const pids={renderer:launch('renderer',[...tsx,'apps/renderer/main.ts'],repo,env('renderer')),worker:launch('worker',[...tsx,'apps/worker/main.ts'],repo,env('worker')),web:launch('web',['server.js'],path.join(repo,'.next','standalone'),env('web')),tls:launch('tls',['tools/task3-uat/tls-proxy.mjs',path.join(dir.tls,'uat.pfx'),path.join(dir.secrets,'tls-passphrase'),String(PORTS.https),String(PORTS.web)],repo,process.env)};
 await waitHttp(`http://127.0.0.1:${PORTS.web}/login`);
 const runtime={...previous,pids,sourceSha256:stamp.sha256,runtimeSourceSha256:stamp.runtimeSourceSha256,buildId:stamp.buildId,gitHead:execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim(),gitDirty:true,serverSha256:createHash('sha256').update(await readFile(path.join(repo,'.next','standalone','server.js'))).digest('hex'),startedAt:new Date().toISOString(),seededNow:false,updateMode:'ANC_PRESERVE_NO_SEED'};
 await writeFile(path.join(base,'runtime.json'),JSON.stringify(runtime,null,2));process.stdout.write(JSON.stringify({status:'PRESERVED_RESTART_READY',url:runtime.url,buildId:stamp.buildId})+'\n');
}
const command=process.argv[2];
if(command==='restart-preserved')await restartPreserved();else if(command==='start')await start();else if(command==='stop')await stop();
else if(command==='status')process.stdout.write(await readFile(path.join(base,'runtime.json'),'utf8').catch(()=>'not started')+'\n');
else{process.stderr.write('usage: tsx tools/task3-uat/uat.ts start|status|stop\n');process.exitCode=2;}
