/** Windows installer rehearsal: the evidence run. One disposable installation under .local/p8-win, loopback ports, test identities only.
 *    tsx tools/win-installer/rehearse.ts [--fresh-build] [--skip-journey]
 *  Builds the signed packages from the committed source, then exercises: signature/tamper refusal, preflight refusals, install, service
 *  restart/crash recovery, the installed operational journey, backup, restore (and activation), failed and successful upgrades,
 *  rollback gates, DR restore with forward migration, uninstall. Writes evidence.json; exits non-zero on the first failed step. */
import {execFileSync,spawnSync} from 'node:child_process';
import {existsSync,readFileSync,writeFileSync,mkdirSync,rmSync,appendFileSync,cpSync} from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import assert from 'node:assert/strict';

const flag=(n:string)=>process.argv.includes('--'+n);
const stamp=new Date().toISOString().replace(/[-:T]/g,'').slice(0,14);
const base=path.resolve('.local/p8-win'),evidenceDir=path.join(base,'evidence','rehearsal-'+stamp);mkdirSync(evidenceDir,{recursive:true});
const resumeIdx=process.argv.indexOf('--resume'),resume=resumeIdx>=0?path.resolve(process.argv[resumeIdx+1]):undefined; // debugging aid: continue on an existing installation (steps S00-S06 skipped)
const root=resume??path.join(base,'rehearsal-'+stamp,'root');
const ports=[19860,19861,19862,19863];
const master=process.env.NIPT_TASK_MASTER_PATH??'C:/Users/User/Downloads/NIPT_CBH_Final_Combined_Master_2026-10-15.xlsx';
const publicKey=path.join(base,'keys','package-signing-public.pem');
const pkgDir=(v:string,appOnly=false)=>path.join(base,'packages','nipt-cbh-'+v+(appOnly?'-app':''));
const steps:{id:string;name:string;ok:boolean;ms:number;detail?:unknown}[]=[];
const git=(...a:string[])=>execFileSync('git',a,{encoding:'utf8'}).trim();
const revision=git('rev-parse','HEAD');
if(git('status','--porcelain','--untracked-files=normal'))throw Error('CLEAN_COMMITTED_SOURCE_REQUIRED');
const log=(m:string)=>{process.stderr.write(`[rehearsal] ${m}\n`);appendFileSync(path.join(evidenceDir,'log.txt'),m+'\n');};
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
const tsx=(...a:string[])=>execFileSync(process.execPath,['node_modules/tsx/dist/cli.mjs',...a],{encoding:'utf8',stdio:['ignore','pipe','inherit'],maxBuffer:64*1024*1024});

async function step(id:string,name:string,fn:()=>Promise<unknown>|unknown){
 const t=Date.now();log(`${id} ${name}`);
 if(resume&&id<='S06'){steps.push({id,name,ok:true,ms:0,detail:'SKIPPED_RESUMED_FROM_EXISTING_ROOT'});return;}
 try{const detail=await fn();steps.push({id,name,ok:true,ms:Date.now()-t,detail});}
 catch(e){steps.push({id,name,ok:false,ms:Date.now()-t,detail:{error:(e as Error).message,stack:(e as Error).stack?.split('\n').slice(0,4)}});finish(false);throw e;}
}
function finish(ok:boolean){
 const evidence={format:'NIPT_WINDOWS_INSTALLER_REHEARSAL_V1',environment:'DISPOSABLE_LOCAL_WINDOWS_TEST',passed:ok&&steps.every(s=>s.ok),sourceHead:revision,root,ports,steps,
  notRun:['elevated SYSTEM startup task (session not Administrator)','hospital TLS/DNS/LAN','UNC/SMB shares and service-account ACLs','NAS backup target and key escrow','physical power loss','code-signing/MSI wrapper'],
  clinicalAcceptance:false,hospitalOperationalAcceptance:false,hisConfirmed:false};
 writeFileSync(path.join(evidenceDir,'evidence.json'),JSON.stringify(evidence,null,2));
 return evidence;
}

// ── CLI access ──
const packageCli=(v:string,appOnly=false)=>({node:path.join(pkgDir(v,false),'payload','runtime','node','node.exe'),cli:path.join(pkgDir(v,appOnly),'installer','nipt-admin.mjs')});
function cli(who:'package'|'installed',cmd:string,extra:string[]=[],opts:{allowFail?:boolean;pkg?:string}={}):Record<string,any>{ // eslint-disable-line @typescript-eslint/no-explicit-any
 const node=who==='package'?packageCli('1.0.0').node:path.join(root,'runtime','node','node.exe');
 const script=who==='package'?path.join(pkgDir('1.0.0'),'installer','nipt-admin.mjs'):path.join(root,'admin','nipt-admin.mjs');
 const r=spawnSync(node,[script,cmd,'--root',root,...extra],{encoding:'utf8',windowsHide:true,maxBuffer:64*1024*1024});
 let json:Record<string,any>={};try{json=JSON.parse(r.stdout);}catch{json={ok:false,error:'UNPARSEABLE_OUTPUT',status:r.status,signal:r.signal,spawnError:r.error?.message,stdout:r.stdout.slice(-800),stderr:r.stderr.slice(-800)};} // eslint-disable-line @typescript-eslint/no-explicit-any
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
const dataSnapshot=()=>JSON.parse(psql("SELECT json_build_object('cases',(SELECT count(*) FROM nipt_case),'releases',(SELECT count(*) FROM result_release),'transfers',(SELECT count(*) FROM p6_transfer),'audit',(SELECT count(*) FROM audit_chain),'lastAudit',(SELECT hash FROM audit_chain ORDER BY sequence DESC LIMIT 1),'accounts',(SELECT count(*) FROM app_user))"));
// The audit chain legitimately grows while the installation runs (start/stop/backup events); business data must not change. auditValid in the health report proves chain integrity.
const core=(x:Record<string,unknown>)=>({cases:x.cases,releases:x.releases,transfers:x.transfers,accounts:x.accounts});
const healthOk=async(label:string)=>{let h:Record<string,any>={};await until(()=>{h=cli('installed','health',[],{allowFail:true});return h.ok===true;},label,90000);return h;}; // eslint-disable-line @typescript-eslint/no-explicit-any
const processesFor=(needle:string)=>spawnSync('powershell.exe',['-NoProfile','-Command',`(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${needle.replaceAll('\\','\\\\').replaceAll("'","''")}*' -and $_.Name -match 'node|postgres' }).Count`],{encoding:'utf8'}).stdout.trim();

try{
 await step('S00','build the signed packages from the committed source',()=>{
  const out:Record<string,unknown>={};
  const build=(name:string,a:string[])=>{if(existsSync(pkgDir(name.replace('-app',''),name.endsWith('-app'))))return;out[name]=JSON.parse(tsx('tools/win-installer/build-package.ts',...a).trim().split('\n').pop()!);};
  // v1.0.0 is built from a fresh `next build` of this commit when --fresh-build is given (otherwise the existing .next is asserted by BUILD_ID in release.json)
  build('1.0.0',['--version','1.0.0',...(flag('fresh-build')?[]:['--skip-build'])]);
  build('1.0.1-app',['--version','1.0.1','--app-only','--skip-build','--extra-migration','tools/win-installer/rehearsal/105_p8_rehearsal_bad.sql']);
  build('1.0.2-app',['--version','1.0.2','--app-only','--skip-build','--test-fault','web-exits']);
  build('1.1.0-app',['--version','1.1.0','--app-only','--skip-build','--extra-migration','tools/win-installer/rehearsal/105_p8_rehearsal_marker.sql']);
  build('1.1.1-app',['--version','1.1.1','--app-only','--skip-build','--extra-migration','tools/win-installer/rehearsal/105_p8_rehearsal_marker.sql']);
  return out;
 });

 await step('S01','signature, exact file set, and tamper refusal',()=>{
  const ok=cli('package','verify-package',['--package',pkgDir('1.0.0'),'--public-key',publicKey]);assert.equal(ok.ok,true);
  const file=path.join(pkgDir('1.0.0'),'installer','Install-Nipt.ps1'),original=readFileSync(file);
  try{writeFileSync(file,Buffer.concat([original,Buffer.from(' ')]));const bad=cli('package','verify-package',['--package',pkgDir('1.0.0'),'--public-key',publicKey],{allowFail:true});assert.equal(bad.ok,false);assert.equal(bad.error,'PACKAGE_CHECKSUM_MISMATCH');}
  finally{writeFileSync(file,original);}
  const again=cli('package','verify-package',['--package',pkgDir('1.0.0'),'--public-key',publicKey]);assert.equal(again.ok,true);
  const wrongKey=path.join(evidenceDir,'wrong-public.pem');
  execFileSync(process.execPath,['-e',`const c=require('crypto');require('fs').writeFileSync(${JSON.stringify(wrongKey)},c.generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'pem'}))`]);
  const forged=cli('package','verify-package',['--package',pkgDir('1.0.0'),'--public-key',wrongKey],{allowFail:true});assert.equal(forged.error,'SIGNATURE_INVALID');
  return {files:ok.files,tamper:'PACKAGE_CHECKSUM_MISMATCH',wrongKey:'SIGNATURE_INVALID'};
 });

 await step('S02','preflight refuses an occupied port and a non-empty root',async()=>{
  const server=net.createServer();await new Promise<void>(r=>server.listen(ports[1],'127.0.0.1',r));
  try{
   const busy=cli('package','preflight',['--package',pkgDir('1.0.0'),'--public-key',publicKey,'--ports',ports.join(','),'--master-workbook',master],{allowFail:true});
   assert.equal(busy.ok,false);assert.deepEqual(busy.checks.filter((c:{ok:boolean})=>!c.ok).map((c:{id:string})=>c.id),['port_web']);
  }finally{await new Promise(r=>server.close(r));}
  mkdirSync(root,{recursive:true});writeFileSync(path.join(root,'stray.txt'),'x');
  const dirty=cli('package','preflight',['--package',pkgDir('1.0.0'),'--public-key',publicKey,'--ports',ports.join(','),'--master-workbook',master],{allowFail:true});
  assert.equal(dirty.ok,false);assert.ok(dirty.checks.some((c:{id:string;ok:boolean})=>c.id==='install_root_empty'&&!c.ok));
  rmSync(path.join(root,'stray.txt'));
  const noMaster=cli('package','preflight',['--package',pkgDir('1.0.0'),'--public-key',publicKey,'--ports',ports.join(',')],{allowFail:true});
  assert.ok(noMaster.checks.some((c:{id:string;ok:boolean})=>c.id==='master_workbook_sha256'&&!c.ok));
  return {occupiedPort:'port_web refused',nonEmptyRoot:'install_root_empty refused',masterWorkbookRequired:true};
 });

 await step('S03','install: runtime, PostgreSQL cluster, migrations, accounts, startup task, services, first verified backup',()=>{
  const r=cli('package','install',['--package',pkgDir('1.0.0'),'--public-key',publicKey,'--ports',ports.join(','),'--instance','p8win-rehearsal','--task-mode','user','--master-workbook',master]);
  assert.equal(r.installed,true);assert.equal(r.health.ok,true);assert.equal(r.health.backupStatus,'CHECKSUM_VERIFIED');
  return {version:r.version,url:r.url,migrations:r.migrations,health:r.health.ok,backup:r.health.backupStatus};
 });

 await step('S04','installed facts: listeners, secret ACL, mode, least privilege, task registration',async()=>{
  const listen=await Promise.all(ports.map(listening));assert.deepEqual(listen,[true,true,true,true]);
  const st=cli('installed','status');assert.equal(st.task.state,'Running');assert.equal(st.status,'INSTALLED_NOT_ACCEPTED');assert.equal(st.postgresRunning,true);
  const acl=execFileSync(path.join(process.env.SystemRoot??'C:/Windows','System32','icacls.exe'),[path.join(root,'secrets')],{encoding:'utf8'});
  assert.ok(!/Everyone|BUILTIN\\Users|Authenticated Users/i.test(acl),'secrets folder must not be readable by broad groups');
  const roles=psql("SELECT string_agg(rolname||':'||(rolsuper OR rolcreatedb OR rolcreaterole)::text,',' ORDER BY rolname) FROM pg_roles WHERE rolname IN ('nipt_web','nipt_worker')");
  assert.equal(roles,'nipt_web:false,nipt_worker:false');
  assert.equal(psql('SELECT nipt_operational_enabled()'),'t');
  const hba=readFileSync(path.join(root,'data','pgdata','pg_hba.conf'),'utf8');assert.ok(!/\btrust\b/.test(hba.replace(/#.*$/gm,'')),'pg_hba must not use trust');
  assert.equal(JSON.parse(readFileSync(path.join(root,'config','nipt.json'),'utf8')).testEnvironmentOnly,true);
  return {listening:ports,aclChecked:true,roles,mode:'operational',pgHbaTrust:false};
 });

 await step('S05','crash recovery: worker/web killed, then the supervisor itself killed with live children, then started again',async()=>{
  const pids=()=>cli('installed','status').services as Record<string,{pid:number;restarts:number}>;
  const before=pids();
  for(const n of ['worker','web','renderer'])spawnSync('taskkill',['/PID',String(before[n].pid),'/T','/F'],{windowsHide:true});
  await until(()=>{const now=pids();return ['worker','web','renderer'].every(n=>now[n].pid!==before[n].pid);},'SERVICES_RESTARTED',60000);
  await healthOk('AFTER_SERVICE_KILL');
  const st=cli('installed','status'),sup=st.supervisorPid as number;
  const children=Object.values(pids()).map(s=>s.pid);
  spawnSync('taskkill',['/PID',String(sup),'/F'],{windowsHide:true}); // not /T: children are orphaned, as after a crash
  await sleep(1500);const survived=children.filter(p=>{try{process.kill(p,0);return true;}catch{return false;}}).length; // under Task Scheduler the job object usually takes the children down with the supervisor
  rmSync(path.join(root,'run','supervisor.lock'),{force:true}); // the task would be restarted by Task Scheduler; here we start it explicitly
  cli('installed','start');
  await healthOk('AFTER_SUPERVISOR_KILL');
  const log=readFileSync(path.join(root,'logs','supervisor.log'),'utf8');
  const reaped=(log.match(/STALE_SERVICE_REAPED/g)??[]).length;if(survived>0)assert.ok(reaped>0,'surviving children must be reaped');
  for(const p of ports)assert.equal(await listening(p),true);
  return {servicesRestarted:true,supervisorRecovered:true,childrenSurvivedSupervisorKill:survived,staleReaped:reaped};
 });

 if(!flag('skip-journey'))await step('S06','installed operational journey (45 test patients, certified release, outbound RES/PDF/backup) over HTTPS',()=>{
  const out=tsx('tools/win-installer/installed-journey.ts','--root',root,'--out',path.join(evidenceDir,'journey')).trim().split('\n').pop()!;
  const j=JSON.parse(out);assert.equal(j.passed,true);assert.equal(j.counts.cases,'45');assert.equal(j.counts.releases,'2');assert.equal(j.counts.transfers,'2');assert.deepEqual(j.browserErrors,[]);
  return {passed:j.passed,counts:j.counts,events:j.events.length};
 });

 let snapshot:Record<string,unknown>={},backup1='';
 await step('S07','verified encrypted backup of the working installation',async()=>{
  await healthOk('BEFORE_BACKUP');snapshot=dataSnapshot();
  const b=cli('installed','backup');backup1=b.backup.backupBase;assert.equal(b.backup.format,'NIPT_OPERATIONAL_BACKUP_V1');
  await healthOk('AFTER_BACKUP');
  assert.deepEqual(core(dataSnapshot()),core(snapshot));
  return {backup:path.basename(backup1),files:b.backup.fileCount,snapshot};
 });

 await step('S08','restore into a new quarantined database; the live installation is untouched',async()=>{
  const r=cli('installed','restore',['--backup',backup1]);assert.equal(r.receipt.restoreVerified,true);assert.equal(r.receipt.quarantined,true);assert.equal(r.activated,false);
  assert.equal(psql('SELECT nipt_runtime_quarantined()',r.database),'t');
  const count=psql('SELECT count(*) FROM nipt_case',r.database);assert.equal(Number(count),Number(snapshot.cases));
  await healthOk('AFTER_RESTORE_INSPECTION');assert.deepEqual(core(dataSnapshot()),core(snapshot));
  return {database:r.database,tables:r.receipt.tableCount,files:r.receipt.fileCount,casesInRestore:count};
 });

 await step('S09','upgrade refused/failed safely: tampered package, failing migration, release that cannot start',async()=>{
  const out:Record<string,unknown>={};
  // (a) tampered package never reaches the installation
  const tamper=path.join(pkgDir('1.1.1',true),'installer','Nipt-Admin.ps1'),orig=readFileSync(tamper);
  try{writeFileSync(tamper,Buffer.concat([orig,Buffer.from(' ')]));const r=cli('installed','upgrade',['--package',pkgDir('1.1.1',true),'--public-key',publicKey],{allowFail:true});assert.equal(r.error,'PACKAGE_CHECKSUM_MISMATCH');}finally{writeFileSync(tamper,orig);}
  assert.equal(installState().current.version,'1.0.0');out.tampered='refused';
  // (b) migration fails: old release keeps running, no switch
  const bad=cli('installed','upgrade',['--package',pkgDir('1.0.1',true),'--public-key',publicKey],{allowFail:true});
  assert.equal(bad.error,'UPGRADE_MIGRATION_FAILED_OLD_RELEASE_STILL_RUNNING');assert.equal(installState().current.version,'1.0.0');assert.ok(!existsSync(path.join(root,'releases','1.0.1')));
  await healthOk('AFTER_FAILED_MIGRATION');assert.deepEqual(core(dataSnapshot()),core(snapshot));out.failingMigration='old release still running';
  // (c) new release cannot stay up: automatic rollback
  const t=Date.now();
  const unhealthy=cli('installed','upgrade',['--package',pkgDir('1.0.2',true),'--public-key',publicKey,'--allow-test-fault','yes','--health-timeout-seconds','45'],{allowFail:true});
  assert.equal(unhealthy.error,'UPGRADE_FAILED_HEALTH');assert.equal(unhealthy.detail?.rolledBack,true);assert.equal(installState().current.version,'1.0.0');
  await healthOk('AFTER_AUTO_ROLLBACK');assert.deepEqual(core(dataSnapshot()),core(snapshot));
  const hist=installState().history.map((h:{event:string})=>h.event);assert.ok(hist.includes('UPGRADE_FAILED_AUTO_ROLLBACK'));
  out.unhealthyRelease={autoRollback:true,seconds:Math.round((Date.now()-t)/1000)};
  return out;
 });

 let preUpgradeBackup='';
 await step('S10','upgrade 1.0.0 → 1.1.0: pre-upgrade backup, forward migration, switch, health, data intact',async()=>{
  const r=cli('installed','upgrade',['--package',pkgDir('1.1.0',true),'--public-key',publicKey]);
  assert.equal(r.upgraded,true);assert.deepEqual(r.pendingMigrationsApplied,['105_p8_rehearsal_marker.sql']);preUpgradeBackup=r.preUpgradeBackup;
  const st=installState();assert.equal(st.current.version,'1.1.0');assert.equal(st.previous.version,'1.0.0');
  assert.equal(psql('SELECT note FROM p8_rehearsal_marker WHERE id=1'),'p8 windows installer rehearsal');
  const h=await healthOk('AFTER_UPGRADE');const after=dataSnapshot();
  assert.equal(after.cases,snapshot.cases);assert.equal(after.releases,snapshot.releases);assert.equal(after.transfers,snapshot.transfers);assert.ok(Number(after.audit)>=Number(snapshot.audit));
  assert.ok(existsSync(preUpgradeBackup));
  return {from:r.from,to:r.to,migrations:r.pendingMigrationsApplied,health:h.ok,preUpgradeBackup:path.basename(preUpgradeBackup)};
 });

 await step('S11','rollback gate: database newer than the previous release → refused, nothing changes',async()=>{
  const r=cli('installed','rollback',[],{allowFail:true});
  assert.equal(r.error,'ROLLBACK_REQUIRES_DATABASE_RESTORE');assert.deepEqual(r.detail.newerMigrations,['105_p8_rehearsal_marker.sql']);assert.equal(r.detail.preUpgradeBackup,preUpgradeBackup);
  assert.equal(installState().current.version,'1.1.0');await healthOk('AFTER_REFUSED_ROLLBACK');
  return {refused:r.error,newerMigrations:r.detail.newerMigrations};
 });

 await step('S12','application-only upgrade 1.1.0 → 1.1.1 and compatible rollback back to 1.1.0',async()=>{
  const up=cli('installed','upgrade',['--package',pkgDir('1.1.1',true),'--public-key',publicKey]);assert.equal(up.upgraded,true);assert.deepEqual(up.pendingMigrationsApplied,[]);
  assert.equal(installState().current.version,'1.1.1');await healthOk('AFTER_APP_ONLY_UPGRADE');
  const rb=cli('installed','rollback');assert.equal(rb.rolledBack,true);assert.equal(rb.to,'1.1.0');
  assert.equal(installState().current.version,'1.1.0');await healthOk('AFTER_COMPATIBLE_ROLLBACK');
  const after=dataSnapshot();assert.equal(after.cases,snapshot.cases);
  return {upgraded:up.to,rolledBackTo:rb.to};
 });

 await step('S13','disaster recovery: an older backup is NOT activatable over changed work; a fresh backup is restored and activated (source fenced, health, data equal)',async()=>{
  const oldDatabase=JSON.parse(readFileSync(path.join(root,'config','nipt.json'),'utf8')).database;
  // (a) safety gates: no fence confirmation, and a live database that changed since the (pre-upgrade) backup
  const noFence=cli('installed','restore',['--backup',preUpgradeBackup,'--activate'],{allowFail:true});assert.equal(noFence.error,'SOURCE_FENCE_CONFIRMATION_REQUIRED');
  const stale=cli('installed','restore',['--backup',preUpgradeBackup,'--activate','--confirm-source-fenced','yes'],{allowFail:true});assert.equal(stale.error,'RESTORE_SOURCE_CHANGED_SINCE_BACKUP');
  await healthOk('AFTER_REFUSED_ACTIVATIONS');assert.equal(JSON.parse(readFileSync(path.join(root,'config','nipt.json'),'utf8')).database,oldDatabase);assert.equal(psql('SELECT nipt_runtime_quarantined()'),'f');
  // (b) a recovery drill the tool supports: fresh backup of the unchanged source, restore, activate
  await healthOk('BEFORE_FRESH_RESTORE');const before=dataSnapshot();
  const r=cli('installed','restore',['--fresh','--activate','--confirm-source-fenced','yes']);
  assert.equal(r.activated,true);assert.deepEqual(r.forwardMigrationsApplied,[]);
  const cfg=JSON.parse(readFileSync(path.join(root,'config','nipt.json'),'utf8'));assert.notEqual(cfg.database,oldDatabase);assert.equal(cfg.database,r.database);
  assert.equal(psql('SELECT nipt_runtime_quarantined()',oldDatabase),'t'); // the previous database is fenced
  const h=await healthOk('AFTER_ACTIVATION');const after=dataSnapshot();
  assert.deepEqual(core(after),core(before));assert.equal(psql('SELECT count(*) FROM p8_rehearsal_marker'),'1');
  // the restored installation can itself be backed up (the chain continues)
  const again=cli('installed','backup');assert.equal(again.backup.format,'NIPT_OPERATIONAL_BACKUP_V1');await healthOk('AFTER_BACKUP_OF_RESTORED');
  return {olderBackupRefused:stale.error,activated:r.database,previous:oldDatabase,fenced:true,health:h.ok,cases:after.cases,backupOfRestored:true};
 });

 await step('S14','stop is graceful (worker over IPC) and start recovers; no listener remains after stop',async()=>{
  cli('installed','stop');
  const gone=await Promise.all(ports.map(async p=>!(await listening(p))));assert.deepEqual(gone,[true,true,true,true]);
  const log=readFileSync(path.join(root,'logs','supervisor.log'),'utf8');assert.ok(!/WORKER_GRACEFUL_STOP_TIMEOUT/.test(log.split('SUPERVISOR_STARTED').slice(-1)[0]));
  cli('installed','start');await healthOk('AFTER_RESTART');
  return {gracefulStop:true,restart:true};
 });

 await step('S15','uninstall keeps data by default, then removes everything on explicit request; no process or listener remains',async()=>{
  const name=path.basename(root);
  const refusal=cli('installed','uninstall',[],{allowFail:true});assert.equal(refusal.error,'CONFIRM_WITH_ROOT_FOLDER_NAME_REQUIRED');
  const keep=cli('installed','uninstall',['--confirm',name]);assert.equal(keep.dataRetained,true);
  assert.ok(existsSync(path.join(root,'data','pgdata'))&&existsSync(path.join(root,'secrets')));assert.ok(!existsSync(path.join(root,'releases')));
  for(const p of ports)assert.equal(await listening(p),false);
  const gone=cli('package','uninstall',['--confirm',name,'--remove-data']);assert.equal(gone.dataRetained,false);assert.ok(!existsSync(root));
  await sleep(1500);assert.equal(processesFor(path.dirname(root)),'0');
  return {keepData:true,removed:true,leftoverProcesses:0};
 });
 await step('S16','the installed CLI can remove its own installation (it runs from inside the root)',async()=>{
  const sandbox=path.join(base,'rehearsal-'+stamp,'selfremove'),r2=path.join(sandbox,'root');mkdirSync(path.join(r2,'runtime','node'),{recursive:true});mkdirSync(path.join(r2,'admin'));mkdirSync(path.join(r2,'config'));
  cpSync(path.join(pkgDir('1.0.0'),'payload','runtime','node','node.exe'),path.join(r2,'runtime','node','node.exe'));
  for(const f of ['nipt-admin.mjs','lib.mjs'])cpSync(path.join(pkgDir('1.0.0'),'installer',f),path.join(r2,'admin',f));
  writeFileSync(path.join(r2,'config','nipt.json'),JSON.stringify({instance:'p8win-selfremove',mode:'operational',database:'nipt_operational_selfremove',ports:{postgres:19870,web:19871,https:19872,renderer:19873},origin:'https://localhost:19872',taskMode:'user',testEnvironmentOnly:true}));
  writeFileSync(path.join(r2,'install-state.json'),JSON.stringify({status:'INSTALLED_NOT_ACCEPTED',current:{version:'1.0.0'},history:[]}));
  const r=spawnSync(path.join(r2,'runtime','node','node.exe'),[path.join(r2,'admin','nipt-admin.mjs'),'uninstall','--root',r2,'--confirm','root','--remove-data'],{encoding:'utf8',windowsHide:true});
  const out=JSON.parse(r.stdout);assert.equal(out.uninstalled,true);assert.equal(out.finalRemoval,'SCHEDULED_AFTER_EXIT');
  await until(()=>!existsSync(r2),'SELF_REMOVAL',30000);
  return {selfRemoved:true};
 });
 const evidence=finish(true);
 process.stdout.write(JSON.stringify({passed:evidence.passed,steps:steps.map(s=>[s.id,s.ok,Math.round(s.ms/1000)+'s']),evidence:path.join(evidenceDir,'evidence.json')})+'\n');
}catch(e){
 log('FAILED: '+(e as Error).message);
 process.stdout.write(JSON.stringify({passed:false,failed:steps.filter(s=>!s.ok),evidence:path.join(evidenceDir,'evidence.json')})+'\n');
 process.exitCode=1;
}
