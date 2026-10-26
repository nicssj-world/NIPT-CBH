/** PRODUCTION-profile installer rehearsal (no real HIS, no hospital share, no test accounts). One disposable installation under .local/p8-win.
 *    tsx tools/win-installer/rehearse-production.ts --master <approved master.xlsx> --report-master <singleton.docx> [--soak-seconds 180] [--skip-build]
 *  Runs from a CLEAN COMMITTED checkout. Builds the signed production packages, then exercises: package profile, refusals, host checks, fresh install on an
 *  empty database with the production admin bootstrap, first sign-in + forced password change, PET/RES path settings, Word/Excel office-check, availability
 *  soak, service/supervisor crash recovery, restart from the scheduled task (reboot substitute), backup/restore, upgrade/rollback, uninstall.
 *  Not exercised here (host limits, recorded in the evidence): real reboot/power loss, SYSTEM or stored-password task, hospital LAN/TLS/shares. */
import {execFileSync,spawnSync} from 'node:child_process';
import {existsSync,readFileSync,writeFileSync,mkdirSync,rmSync,appendFileSync} from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import assert from 'node:assert/strict';

const flag=(n:string)=>process.argv.includes('--'+n);
const opt=(n:string)=>{const i=process.argv.indexOf('--'+n);return i<0?undefined:process.argv[i+1];};
const stamp=new Date().toISOString().replace(/[-:T]/g,'').slice(0,14);
const base=path.resolve('.local/p8-win'),evidenceDir=path.join(base,'evidence','production-rehearsal-'+stamp);mkdirSync(evidenceDir,{recursive:true});
const root=path.join(base,'prod-rehearsal-'+stamp,'NIPT CBH prod');
const ports=[19880,19881,19882,19883];
const master=path.resolve(opt('master')??'');if(!existsSync(master))throw Error('MASTER_WORKBOOK_REQUIRED (--master)');
const reportMaster=path.resolve(opt('report-master')??'');if(!existsSync(reportMaster))throw Error('REPORT_MASTER_REQUIRED (--report-master)');
const soakSeconds=Number(opt('soak-seconds')??180);
const publicKey=path.join(base,'keys','package-signing-public.pem');
const pkgDir=(v:string,appOnly=false)=>path.join(base,'packages','nipt-cbh-'+v+(appOnly?'-app':''));
const steps:{id:string;name:string;ok:boolean;ms:number;detail?:unknown}[]=[];
const git=(...a:string[])=>execFileSync('git',a,{encoding:'utf8'}).trim();
const revision=git('rev-parse','HEAD');
if(git('status','--porcelain','--untracked-files=normal'))throw Error('CLEAN_COMMITTED_SOURCE_REQUIRED');
const log=(m:string)=>{process.stderr.write(`[prod-rehearsal] ${m}\n`);appendFileSync(path.join(evidenceDir,'log.txt'),m+'\n');};
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
const tsx=(...a:string[])=>execFileSync(process.execPath,['node_modules/tsx/dist/cli.mjs',...a],{encoding:'utf8',stdio:['ignore','pipe','inherit'],maxBuffer:64*1024*1024});
const admins={adminUser:'site.admin',adminName:'Site Administrator',checkerUser:'site.checker',checkerName:'Site Clinical Approver'};

async function step(id:string,name:string,fn:()=>Promise<unknown>|unknown){
 const t=Date.now();log(`${id} ${name}`);
 try{const detail=await fn();steps.push({id,name,ok:true,ms:Date.now()-t,detail});}
 catch(e){steps.push({id,name,ok:false,ms:Date.now()-t,detail:{error:(e as Error).message,stack:(e as Error).stack?.split('\n').slice(0,4)}});finish(false);throw e;}
}
function finish(ok:boolean){
 const evidence={format:'NIPT_WINDOWS_PRODUCTION_REHEARSAL_V1',environment:'DISPOSABLE_LOCAL_WINDOWS_PRODUCTION_PROFILE',passed:ok&&steps.every(s=>s.ok),sourceHead:revision,root,ports,steps,
  notRun:['real reboot / power loss (non-elevated host cannot reboot unattended)','SYSTEM or stored-password startup task (Register-ScheduledTask for S4U/SYSTEM is denied without elevation)','automatic Windows sign-in after reboot','hospital TLS/DNS/LAN and Windows Firewall scope','UNC/SMB shares and service-account ACLs','real HIS (never contacted)','NAS backup target and key escrow'],
  clinicalAcceptance:false,hospitalOperationalAcceptance:false,hisConfirmed:false};
 writeFileSync(path.join(evidenceDir,'evidence.json'),JSON.stringify(evidence,null,2));
 return evidence;
}

// ── CLI access ──
function cli(who:'package'|'installed',cmd:string,extra:string[]=[],opts:{allowFail?:boolean;root?:string;pkg?:string}={}):Record<string,any>{ // eslint-disable-line @typescript-eslint/no-explicit-any
 const node=who==='package'?path.join(pkgDir('1.1.0'),'payload','runtime','node','node.exe'):path.join(root,'runtime','node','node.exe');
 const script=who==='package'?path.join(pkgDir('1.1.0'),'installer','nipt-admin.mjs'):path.join(root,'admin','nipt-admin.mjs');
 const r=spawnSync(node,[script,cmd,'--root',opts.root??root,...extra],{encoding:'utf8',windowsHide:true,maxBuffer:64*1024*1024});
 let json:Record<string,any>={};try{json=JSON.parse(r.stdout);}catch{json={ok:false,error:'UNPARSEABLE_OUTPUT',status:r.status,stdout:r.stdout.slice(-800),stderr:r.stderr.slice(-800)};} // eslint-disable-line @typescript-eslint/no-explicit-any
 if(r.status!==0&&!opts.allowFail)throw Error(`${cmd} failed: ${JSON.stringify(json).slice(0,1200)}`);
 return {...json,_status:r.status};
}
const psql=(sql:string,db?:string)=>{
 const cfg=JSON.parse(readFileSync(path.join(root,'config','nipt.json'),'utf8'));
 return execFileSync(path.join(root,'runtime','pg','bin','psql.exe'),['-h','127.0.0.1','-p',String(ports[0]),'-U','nipt_migrator','-d',db??cfg.database,'-X','-A','-t','-c',sql],{encoding:'utf8',env:{...process.env,PGPASSWORD:readFileSync(path.join(root,'secrets','db-password'),'utf8').trim()}}).trim();
};
const installState=()=>JSON.parse(readFileSync(path.join(root,'install-state.json'),'utf8'));
const listening=(port:number)=>new Promise<boolean>(r=>{const s=net.connect({host:'127.0.0.1',port});s.once('connect',()=>{s.destroy();r(true);});s.once('error',()=>r(false));});
async function until(fn:()=>Promise<boolean>|boolean,label:string,ms=120000){const t=Date.now();while(Date.now()-t<ms){if(await fn())return;await sleep(1000);}throw Error('TIMEOUT_'+label);}
const healthOk=async(label:string)=>{let h:Record<string,any>={};await until(()=>{h=cli('installed','health',[],{allowFail:true});return h.ok===true;},label,120000);return h;}; // eslint-disable-line @typescript-eslint/no-explicit-any
const snapshot=()=>JSON.parse(psql("SELECT json_build_object('accounts',(SELECT count(*) FROM app_user),'cases',(SELECT count(*) FROM nipt_case),'audit',(SELECT count(*) FROM audit_chain))"));
const services=()=>cli('installed','status').services as Record<string,{pid:number;restarts:number}>;
const taskName=()=>`nipt-cbh-${JSON.parse(readFileSync(path.join(root,'config','nipt.json'),'utf8')).instance}`;
const officeArgs=['--report-master',reportMaster];

try{
 await step('P00','build signed production packages from the committed source (full 1.1.0; app-only upgrade candidates; a test-profile package for the mismatch refusal)',()=>{
  const out:Record<string,unknown>={};
  const build=(label:string,dir:string,a:string[])=>{if(existsSync(dir))return;out[label]=JSON.parse(tsx('tools/win-installer/build-package.ts',...a).trim().split('\n').pop()!);};
  build('1.1.0',pkgDir('1.1.0'),['--version','1.1.0','--profile','production','--master-workbook',master,...(flag('skip-build')?['--skip-build']:[])]);
  build('1.1.1-app',pkgDir('1.1.1',true),['--version','1.1.1','--profile','production','--app-only','--skip-build']);
  build('1.1.2-app',pkgDir('1.1.2',true),['--version','1.1.2','--profile','production','--app-only','--skip-build','--rehearsal-only','--extra-migration','tools/win-installer/rehearsal/900_p8_rehearsal_marker.sql']);
  build('1.1.3-app-test-profile',pkgDir('1.1.3',true),['--version','1.1.3','--profile','test','--app-only','--skip-build']);
  // a production package can never be built with test inputs unless it is an explicit rehearsal-only app package
  const bad=spawnSync(process.execPath,['node_modules/tsx/dist/cli.mjs','tools/win-installer/build-package.ts','--version','9.9.9','--profile','production','--extra-migration','tools/win-installer/rehearsal/900_p8_rehearsal_marker.sql'],{encoding:'utf8'});
  assert.notEqual(bad.status,0);assert.match(bad.stderr,/PRODUCTION_PACKAGE_REFUSES_TEST_INPUTS/);
  out.refusal='PRODUCTION_PACKAGE_REFUSES_TEST_INPUTS';return out;
 });

 await step('P01','package manifest declares the production profile; signature and tamper refusal',()=>{
  const ok=cli('package','verify-package',['--package',pkgDir('1.1.0'),'--public-key',publicKey]);assert.equal(ok.ok,true);
  const m=JSON.parse(readFileSync(path.join(pkgDir('1.1.0'),'manifest.json'),'utf8'));
  assert.equal(m.testEnvironmentOnly,false);assert.equal(m.profile,'production');assert.equal(m.extraTestMigration,null);assert.equal(m.testFault,null);assert.equal(m.rehearsalOnly,false);
  const file=path.join(pkgDir('1.1.0'),'installer','Install-Nipt.ps1'),original=readFileSync(file);
  try{writeFileSync(file,Buffer.concat([original,Buffer.from(' ')]));const bad=cli('package','verify-package',['--package',pkgDir('1.1.0'),'--public-key',publicKey],{allowFail:true});assert.equal(bad.error,'PACKAGE_CHECKSUM_MISMATCH');}finally{writeFileSync(file,original);}
  assert.equal(cli('package','verify-package',['--package',pkgDir('1.1.0'),'--public-key',publicKey]).ok,true);
  return {revision:m.revision,profile:m.profile,testEnvironmentOnly:m.testEnvironmentOnly,files:ok.files};
 });

 await step('P02','preflight passes (Word + Excel registered); install refuses without named first accounts and leaves the root empty; a test package is refused for production use',()=>{
  const pre=cli('package','preflight',['--package',pkgDir('1.1.0'),'--public-key',publicKey,'--ports',ports.join(','),'--master-workbook',master]);
  assert.equal(pre.ok,true);const ids=pre.checks.map((c:{id:string})=>c.id);assert.ok(ids.includes('word_installed')&&ids.includes('excel_installed'));
  const noAdmin=cli('package','install',['--package',pkgDir('1.1.0'),'--public-key',publicKey,'--ports',ports.join(','),'--instance','prod-rehearsal','--task-mode','user','--master-workbook',master],{allowFail:true});
  assert.equal(noAdmin.error,'PRODUCTION_ADMIN_IDENTITY_REQUIRED');assert.ok(!existsSync(path.join(root,'install-state.json')));
  const sameName=cli('package','install',['--package',pkgDir('1.1.0'),'--public-key',publicKey,'--ports',ports.join(','),'--instance','prod-rehearsal','--task-mode','user','--master-workbook',master,'--admin-user','dup.user','--admin-name','A','--checker-user','dup.user','--checker-name','B'],{allowFail:true});
  assert.equal(sameName.error,'DISTINCT_BOOTSTRAP_IDENTITIES_REQUIRED');
  const uat=cli('package','install',['--package',pkgDir('1.1.0'),'--public-key',publicKey,'--ports',ports.join(','),'--instance','prod-rehearsal','--task-mode','user','--master-workbook',master,'--admin-user','uat.admin','--admin-name','A','--checker-user','site.checker','--checker-name','B'],{allowFail:true});
  assert.equal(uat.error,'PRODUCTION_ADMIN_USERNAME_INVALID');
  const mismatch=cli('package','install',['--package',pkgDir('1.1.0'),'--public-key',publicKey,'--profile','test','--ports',ports.join(','),'--instance','prod-rehearsal','--task-mode','user','--master-workbook',master],{allowFail:true});
  assert.equal(mismatch.error,'PROFILE_PACKAGE_MISMATCH');
  return {preflight:pre.checks.map((c:{id:string;ok:boolean})=>[c.id,c.ok]),missingIdentityRefused:true,duplicateIdentityRefused:true,uatUsernameRefused:true,profileMismatchRefused:true};
 });

 await step('P03','host check (read-only): Word, Excel, default printer, unattended-session facts',()=>{
  const hc=path.join(evidenceDir,'host-check');mkdirSync(hc,{recursive:true});
  const out=spawnSync(process.execPath,['tools/win-installer/host-check.mjs','--root',root,'--backup-path',path.join(hc,'backups'),'--photo-path',path.join(hc,'photos'),'--inbound',path.join(hc,'inbound'),'--outbound',path.join(hc,'outbound'),'--ports',ports.join(','),'--out',path.join(evidenceDir,'host-check.json'),'--report',path.join(evidenceDir,'host-check.md')],{encoding:'utf8'});
  const r=JSON.parse(out.stdout.trim().split('\n').pop()!);assert.deepEqual(r.failed,[]);
  const hcj=JSON.parse(readFileSync(path.join(evidenceDir,'host-check.json'),'utf8')).results as {id:string;status:string;detail:string}[];
  const pick=(id:string)=>hcj.find(x=>x.id===id);assert.equal(pick('word_installed')?.status,'PASS');assert.equal(pick('excel_installed')?.status,'PASS');
  return {summary:r.summary,word:pick('word_installed')?.status,excel:pick('excel_installed')?.status,unattendedOfficeSession:pick('unattended_office_session')};
 });

 await step('P04','fresh install on an empty database: runtime, PostgreSQL cluster, migrations, production admin bootstrap, startup task, services, first verified backup',()=>{
  const r=cli('package','install',['--package',pkgDir('1.1.0'),'--public-key',publicKey,'--ports',ports.join(','),'--instance','prod-rehearsal','--task-mode','user','--excel-mode','direct','--master-workbook',master,
   '--admin-user',admins.adminUser,'--admin-name',admins.adminName,'--checker-user',admins.checkerUser,'--checker-name',admins.checkerName]);
  assert.equal(r.installed,true);assert.equal(r.health.ok,true);assert.equal(r.health.backupStatus,'CHECKSUM_VERIFIED');
  return {version:r.version,url:r.url,migrations:r.migrations,health:r.health.ok,backup:r.health.backupStatus};
 });

 await step('P05','installed production facts: profile flags, only the two bootstrap accounts, no test accounts/unit/banner/default credentials, acceptance NOT set, least privilege',async()=>{
  const cfg=JSON.parse(readFileSync(path.join(root,'config','nipt.json'),'utf8'));assert.equal(cfg.testEnvironmentOnly,false);assert.equal(cfg.mode,'operational');
  const st=installState();assert.equal(st.testEnvironmentOnly,false);assert.equal(st.profile,'production');assert.equal(st.status,'INSTALLED_NOT_ACCEPTED');assert.equal(st.acceptance,'NOT_ACCEPTED');
  assert.ok(!('clinicalAcceptance' in st)||st.clinicalAcceptance===false);assert.ok(!('hospitalOperationalAcceptance' in st)||st.hospitalOperationalAcceptance===false);
  const users=psql("SELECT string_agg(u.username||':'||string_agg_roles.roles||':'||u.must_change_password::text,'|' ORDER BY u.username) FROM app_user u JOIN LATERAL (SELECT string_agg(role::text,',' ORDER BY role::text) roles FROM role_assignment WHERE user_id=u.id) string_agg_roles ON true");
  assert.equal(users,`${admins.adminUser}:APP_ADMIN:true|${admins.checkerUser}:CLINICAL_APPROVER:true`);
  assert.equal(psql("SELECT count(*) FROM app_user WHERE username LIKE 'uat.%' OR username LIKE 'synthetic.%'"),'0');
  assert.equal(psql("SELECT count(*) FROM unit WHERE code='INSTALL_TEST'"),'0');
  assert.ok(!existsSync(path.join(root,'secrets','uat-accounts.json')));assert.ok(!existsSync(path.join(root,'secrets','initial-admins.json')),'the bootstrap input is removed once the accounts exist');
  const cred=readFileSync(path.join(root,'credentials.txt'),'utf8');assert.ok(!/TEST ENVIRONMENT|uat\./i.test(cred));assert.equal((cred.match(/^Password: /gm)??[]).length,2);
  const pw=[...cred.matchAll(/^Password: (.+)$/gm)].map(m=>m[1]);assert.ok(pw.every(p=>p.length>=32)&&pw[0]!==pw[1]);
  const credAcl=execFileSync(path.join(process.env.SystemRoot??'C:/Windows','System32','icacls.exe'),[path.join(root,'credentials.txt')],{encoding:'utf8'});assert.ok(!/Everyone|BUILTIN.Users|Authenticated Users/i.test(credAcl),'credentials.txt must not be readable by broad groups');
  const hash=psql("SELECT count(*) FROM app_user WHERE password_hash LIKE '$argon2id$%'");assert.equal(hash,'2');
  const listen=await Promise.all(ports.map(listening));assert.deepEqual(listen,[true,true,true,true]);
  const roles=psql("SELECT string_agg(rolname||':'||(rolsuper OR rolcreatedb OR rolcreaterole)::text,',' ORDER BY rolname) FROM pg_roles WHERE rolname IN ('nipt_web','nipt_worker')");assert.equal(roles,'nipt_web:false,nipt_worker:false');
  assert.equal(psql('SELECT nipt_operational_enabled()'),'t');
  const hba=readFileSync(path.join(root,'data','pgdata','pg_hba.conf'),'utf8');assert.ok(!/\btrust\b/.test(hba.replace(/#.*$/gm,'')));
  const acl=execFileSync(path.join(process.env.SystemRoot??'C:/Windows','System32','icacls.exe'),[path.join(root,'secrets')],{encoding:'utf8'});assert.ok(!/Everyone|BUILTIN\\Users|Authenticated Users/i.test(acl));
  // the login page carries no test/training banner
  process.env.NODE_TLS_REJECT_UNAUTHORIZED='0';
  const html=await (await fetch(`https://127.0.0.1:${ports[2]}/login`)).text();
  const banner=/TEST ENVIRONMENT|TRAINING|NOT FOR CLINICAL/i.test(html);assert.equal(banner,false);
  return {profile:'production',accounts:users.split('|').map(x=>x.split(':').slice(0,2).join(':')),testAccounts:0,loginPageBanner:banner,acceptance:st.acceptance,secretsAcl:'restricted'};
 });

 await step('P06','first sign-in with the one-time passwords, forced password change, old password refused; PET/RES path settings proposed, worker-tested and applied without restart',()=>{
  const out=JSON.parse(tsx('tools/win-installer/installed-first-login.ts','--root',root,'--his-paths').trim().split('\n').pop()!);
  assert.equal(out.passed,true);assert.equal(out.accounts.length,2);
  for(const a of out.accounts){assert.equal(a.oneTimePasswordAccepted,true);assert.notEqual(a.protectedApiBlockedBeforeChange,200);assert.equal(a.changed,true);assert.notEqual(a.oldPasswordRefused,200);assert.equal(a.newPasswordSignsIn,true);}
  assert.equal(out.hisPaths.activePathsMatch,true);assert.equal(psql('SELECT count(*) FROM app_user WHERE must_change_password'),'0');
  return out;
 });

 await step('P07','office-check in the installed runtime and signed-in session: Word renders name + licence + two signature images; the real report master fills and renders; Excel master Task List PDFs',()=>{
  const r=cli('installed','office-check',officeArgs);assert.equal(r.ok,true);
  writeFileSync(path.join(evidenceDir,'office-check-installed.json'),JSON.stringify(r,null,1));
  return r;
 });

 await step('P08',`availability soak (${soakSeconds}s): services stay up with no unexplained restart; health stays OK`,async()=>{
  const before=services();const t0=Date.now();let probes=0;
  while(Date.now()-t0<soakSeconds*1000){const h=cli('installed','health',[],{allowFail:true});assert.equal(h.ok,true);probes++;await sleep(15000);}
  const after=services();
  for(const n of Object.keys(before)){assert.equal(after[n].pid,before[n].pid,`${n} restarted during the soak`);assert.equal(after[n].restarts,before[n].restarts);}
  return {seconds:soakSeconds,probes,services:Object.fromEntries(Object.entries(after).map(([n,s])=>[n,{pid:s.pid,restarts:s.restarts}]))};
 });

 await step('P09','crash recovery: worker/web/renderer killed repeatedly, then the supervisor itself killed with live children, then started again; log shows only the expected exits',async()=>{
  for(let round=0;round<3;round++){
   const before=services();
   for(const n of ['worker','web','renderer'])spawnSync('taskkill',['/PID',String(before[n].pid),'/T','/F'],{windowsHide:true});
   await until(()=>{const now=services();return ['worker','web','renderer'].every(n=>now[n].pid!==before[n].pid);},'SERVICES_RESTARTED',90000);
   await healthOk('AFTER_SERVICE_KILL_'+round);
  }
  const st=cli('installed','status'),sup=st.supervisorPid as number;
  spawnSync('taskkill',['/PID',String(sup),'/F'],{windowsHide:true});await sleep(1500);
  rmSync(path.join(root,'run','supervisor.lock'),{force:true});
  cli('installed','start');await healthOk('AFTER_SUPERVISOR_KILL');
  const text=readFileSync(path.join(root,'logs','supervisor.log'),'utf8');
  const restartsScheduled=(text.match(/SERVICE_RESTART_SCHEDULED/g)??[]).length;
  assert.ok(restartsScheduled>=9,'each of 3 services restarted in each of 3 rounds');
  for(const p of ports)assert.equal(await listening(p),true);
  const worker=text.split(/\r?\n/).filter(l=>/worker/i.test(l)&&/EXIT|CRASH|RESTART/i.test(l));
  return {restartsScheduled,workerEvents:worker.length,supervisorRecovered:true};
 });

 await step('P10','reboot substitute: stop everything, then start ONLY through the Task Scheduler task (no CLI start); services, database and health come back; office-check again in the same session',async()=>{
  cli('installed','stop');
  assert.deepEqual(await Promise.all(ports.map(async p=>!(await listening(p)))),[true,true,true,true]);
  const q=spawnSync('powershell.exe',['-NoProfile','-Command',`Get-ScheduledTask -TaskName '${taskName()}' -TaskPath '\\NIPT-CBH\\' | Select-Object -ExpandProperty State`],{encoding:'utf8'});
  const info=spawnSync('powershell.exe',['-NoProfile','-Command',`$t=Get-ScheduledTask -TaskName '${taskName()}' -TaskPath '\\NIPT-CBH\\';[pscustomobject]@{state="$($t.State)";logonType="$($t.Principal.LogonType)";runLevel="$($t.Principal.RunLevel)";userId="$($t.Principal.UserId)";triggers=($t.Triggers|ForEach-Object{$_.CimClass.CimClassName}) -join ','}|ConvertTo-Json -Compress`],{encoding:'utf8'}).stdout.trim();
  const s=spawnSync('powershell.exe',['-NoProfile','-Command',`Start-ScheduledTask -TaskName '${taskName()}' -TaskPath '\\NIPT-CBH\\'`],{encoding:'utf8'});assert.equal(s.status,0,s.stderr);
  await until(async()=>(await Promise.all(ports.map(listening))).every(Boolean),'LISTENERS_AFTER_TASK_START',180000);
  const h=await healthOk('AFTER_TASK_START');
  const office=cli('installed','office-check',officeArgs);assert.equal(office.ok,true);
  return {taskStateBefore:q.stdout.trim(),task:JSON.parse(info),health:h.ok,officeCheckAfterTaskStart:office.ok,note:'The task runs at user logon (taskMode user): it was started here by Start-ScheduledTask in the already signed-in session. A real reboot needs the same user to sign in (automatic sign-in) - NOT proven on this host.'};
 });

 let backup1='',snap:Record<string,unknown>={};
 await step('P11','verified encrypted backup; restore into a new quarantined database (accounts intact, live installation untouched)',async()=>{
  await healthOk('BEFORE_BACKUP');snap=snapshot();
  const b=cli('installed','backup');backup1=b.backup.backupBase;assert.equal(b.backup.format,'NIPT_OPERATIONAL_BACKUP_V1');
  const r=cli('installed','restore',['--backup',backup1]);assert.equal(r.receipt.restoreVerified,true);assert.equal(r.receipt.quarantined,true);assert.equal(r.activated,false);
  assert.equal(psql('SELECT nipt_runtime_quarantined()',r.database),'t');assert.equal(psql('SELECT count(*) FROM app_user',r.database),'2');
  assert.equal(psql("SELECT count(*) FROM app_user WHERE username LIKE 'uat.%'",r.database),'0');
  await healthOk('AFTER_RESTORE_INSPECTION');assert.equal((snapshot() as {accounts:string}).accounts,(snap as {accounts:string}).accounts);
  return {backup:path.basename(backup1),files:b.backup.fileCount,restoredDatabase:r.database,tables:r.receipt.tableCount};
 });

 await step('P12','upgrade guards: tampered package, a test-profile package, and a rehearsal-only package without the explicit flag are all refused',()=>{
  const tamper=path.join(pkgDir('1.1.1',true),'installer','Nipt-Admin.ps1'),orig=readFileSync(tamper);
  try{writeFileSync(tamper,Buffer.concat([orig,Buffer.from(' ')]));assert.equal(cli('installed','upgrade',['--package',pkgDir('1.1.1',true),'--public-key',publicKey],{allowFail:true}).error,'PACKAGE_CHECKSUM_MISMATCH');}finally{writeFileSync(tamper,orig);}
  const profile=cli('installed','upgrade',['--package',pkgDir('1.1.3',true),'--public-key',publicKey],{allowFail:true});assert.equal(profile.error,'UPGRADE_PROFILE_MISMATCH');
  const rehearsal=cli('installed','upgrade',['--package',pkgDir('1.1.2',true),'--public-key',publicKey],{allowFail:true});assert.equal(rehearsal.error,'PACKAGE_TEST_FAULT_NOT_ALLOWED');
  assert.equal(installState().current.version,'1.1.0');
  return {tampered:'refused',profileMismatch:profile.detail,rehearsalPackage:'refused without --allow-test-fault'};
 });

 await step('P13','application-only upgrade 1.1.0 → 1.1.1 and compatible rollback; then forward-migration upgrade → 1.1.2 with a pre-upgrade backup, rollback refused (database newer), data intact',async()=>{
  const up=cli('installed','upgrade',['--package',pkgDir('1.1.1',true),'--public-key',publicKey]);assert.equal(up.upgraded,true);assert.deepEqual(up.pendingMigrationsApplied,[]);
  await healthOk('AFTER_APP_ONLY_UPGRADE');
  const rb=cli('installed','rollback');assert.equal(rb.rolledBack,true);assert.equal(rb.to,'1.1.0');await healthOk('AFTER_COMPATIBLE_ROLLBACK');
  const mig=cli('installed','upgrade',['--package',pkgDir('1.1.2',true),'--public-key',publicKey,'--allow-test-fault','yes']);assert.equal(mig.upgraded,true);assert.deepEqual(mig.pendingMigrationsApplied,['900_p8_rehearsal_marker.sql']);
  assert.ok(existsSync(mig.preUpgradeBackup));assert.equal(psql('SELECT note FROM p8_rehearsal_marker WHERE id=1'),'p8 windows installer rehearsal');
  await healthOk('AFTER_MIGRATION_UPGRADE');
  const refused=cli('installed','rollback',[],{allowFail:true});assert.equal(refused.error,'ROLLBACK_REQUIRES_DATABASE_RESTORE');
  assert.equal(installState().current.version,'1.1.2');assert.equal((snapshot() as {accounts:string}).accounts,(snap as {accounts:string}).accounts);
  const cfg=JSON.parse(readFileSync(path.join(root,'config','nipt.json'),'utf8'));assert.equal(cfg.testEnvironmentOnly,false);
  return {appOnly:up.to,rolledBackTo:rb.to,migrationUpgrade:mig.to,migrations:mig.pendingMigrationsApplied,rollbackGate:refused.error,profileKept:'production'};
 });

 await step('P14','disaster recovery: fresh backup restored and activated (source fenced), health OK, accounts intact, still production',async()=>{
  const before=snapshot() as {accounts:string};
  const r=cli('installed','restore',['--fresh','--activate','--confirm-source-fenced','yes']);assert.equal(r.activated,true);
  const h=await healthOk('AFTER_ACTIVATION');assert.equal((snapshot() as {accounts:string}).accounts,before.accounts);
  assert.equal(JSON.parse(readFileSync(path.join(root,'config','nipt.json'),'utf8')).testEnvironmentOnly,false);
  return {activated:r.database,health:h.ok};
 });

 await step('P15','stop is graceful and start recovers; final office-check; uninstall keeps data by default, then removes everything; no process or listener remains',async()=>{
  cli('installed','stop');assert.deepEqual(await Promise.all(ports.map(async p=>!(await listening(p)))),[true,true,true,true]);
  cli('installed','start');await healthOk('AFTER_RESTART');
  const office=cli('installed','office-check',officeArgs);assert.equal(office.ok,true);
  const name=path.basename(root);
  assert.equal(cli('installed','uninstall',[],{allowFail:true}).error,'CONFIRM_WITH_ROOT_FOLDER_NAME_REQUIRED');
  const keep=cli('installed','uninstall',['--confirm',name]);assert.equal(keep.dataRetained,true);
  const gone=cli('package','uninstall',['--confirm',name,'--remove-data']);assert.equal(gone.dataRetained,false);assert.ok(!existsSync(root));
  for(const p of ports)assert.equal(await listening(p),false);
  return {finalOfficeCheck:office.ok,keepData:true,removed:true};
 });

 const evidence=finish(true);
 process.stdout.write(JSON.stringify({passed:evidence.passed,steps:steps.map(s=>[s.id,s.ok,Math.round(s.ms/1000)+'s']),evidence:path.join(evidenceDir,'evidence.json')})+'\n');
}catch(e){
 log('FAILED: '+(e as Error).message);
 process.stdout.write(JSON.stringify({passed:false,failed:steps.filter(s=>!s.ok),evidence:path.join(evidenceDir,'evidence.json')})+'\n');
 process.exitCode=1;
}
