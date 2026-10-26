/** Proof that the delivered Setup EXE installs a usable PRODUCTION system. Runs the real EXE silently in the opt-in isolation mode
 *  (/PARITYREHEARSAL: no uninstall entry, no shortcuts, loopback only), then checks the installation and removes it.
 *    tsx tools/win-installer/exe-install-check.ts --exe <NIPT-CBH-Setup-x.y.z.exe> --report-master <singleton.docx> [--out <evidence.json>] [--keep]
 *  Admin-ready path: fresh install -> first administrator + clinical approver created from the names given on the command line -> one-time
 *  password sign-in -> forced change -> old password refused -> administrator API/Settings reachable. No SQL, no developer CLI. */
import {spawnSync,execFileSync} from 'node:child_process';
import {existsSync,readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';

const opt=(n:string)=>{const i=process.argv.indexOf('--'+n);return i<0?undefined:process.argv[i+1];};
const exe=path.resolve(opt('exe')??'');if(!existsSync(exe))throw Error('EXE_REQUIRED (--exe)');
const reportMaster=path.resolve(opt('report-master')??'');if(!existsSync(reportMaster))throw Error('REPORT_MASTER_REQUIRED');
const tag='prodexe'+Date.now().toString(36).slice(-6);
const base=path.resolve('.local/p8-win');
const root=path.join(base,'parity-upgrade-'+tag);
const out=path.resolve(opt('out')??path.join(base,'evidence',`exe-install-${tag}.json`));mkdirSync(path.dirname(out),{recursive:true});
const steps:{id:string;ok:boolean;detail?:unknown}[]=[];
const tsx=(...a:string[])=>execFileSync(process.execPath,['node_modules/tsx/dist/cli.mjs',...a],{encoding:'utf8',stdio:['ignore','pipe','inherit'],maxBuffer:64*1024*1024});
const sys32=(f:string)=>path.join(process.env.SystemRoot??'C:/Windows','System32',f);
function cli(cmd:string,extra:string[]=[],allowFail=false):Record<string,any>{ // eslint-disable-line @typescript-eslint/no-explicit-any
 const r=spawnSync(path.join(root,'runtime','node','node.exe'),[path.join(root,'admin','nipt-admin.mjs'),cmd,'--root',root,...extra],{encoding:'utf8',windowsHide:true,maxBuffer:64*1024*1024});
 let json:Record<string,any>={};try{json=JSON.parse(r.stdout);}catch{json={ok:false,error:'UNPARSEABLE_OUTPUT',stdout:r.stdout.slice(-500),stderr:r.stderr.slice(-500)};} // eslint-disable-line @typescript-eslint/no-explicit-any
 if(r.status!==0&&!allowFail)throw Error(`${cmd} failed: ${JSON.stringify(json).slice(0,800)}`);
 return json;
}
const psql=(sql:string)=>{
 const cfg=JSON.parse(readFileSync(path.join(root,'config','nipt.json'),'utf8'));
 return execFileSync(path.join(root,'runtime','pg','bin','psql.exe'),['-h','127.0.0.1','-p',String(cfg.ports.postgres),'-U','nipt_migrator','-d',cfg.database,'-X','-A','-t','-c',sql],{encoding:'utf8',env:{...process.env,PGPASSWORD:readFileSync(path.join(root,'secrets','db-password'),'utf8').trim()}}).trim();
};
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
async function step(id:string,fn:()=>Promise<unknown>|unknown){try{steps.push({id,ok:true,detail:await fn()});}catch(e){steps.push({id,ok:false,detail:(e as Error).message});throw e;}}
const ps=(script:string)=>spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{encoding:'utf8',windowsHide:true}).stdout.trim();
let installed=false;
try{
 await step('E00 EXE file',()=>{const bytes=readFileSync(exe);return {path:exe,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};});
 await step('E01 silent install of the production EXE (names on the command line, isolation mode, loopback, no certificate trust)',()=>{
  const r=spawnSync(exe,['/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/CURRENTUSER',`/PARITYREHEARSAL=${tag}`,`/ROOT=${root}`,`/DIR=${path.join(root,'setup-wrapper')}`,'/LAN=no','/NOTRUST=1','/TASKMODE=user',`/INSTANCE=${tag}`,
   '/ADMINUSER=site.admin','/ADMINNAME=Site Administrator','/CHECKERUSER=site.checker','/CHECKERNAME=Site Clinical Approver'],{encoding:'utf8',windowsHide:true,timeout:50*60*1000});
  installed=existsSync(path.join(root,'install-state.json'));
  assert.equal(r.status,0,`EXE exit ${r.status}`);assert.ok(installed);
  return {exitCode:r.status};
 });
 await step('E02 production profile, only the two named accounts, no test account/unit/banner, acceptance not set, credential file protected',async()=>{
  const cfg=JSON.parse(readFileSync(path.join(root,'config','nipt.json'),'utf8'));assert.equal(cfg.testEnvironmentOnly,false);
  const st=JSON.parse(readFileSync(path.join(root,'install-state.json'),'utf8'));assert.equal(st.profile,'production');assert.equal(st.testEnvironmentOnly,false);assert.equal(st.acceptance,'NOT_ACCEPTED');
  assert.equal(psql("SELECT string_agg(u.username||':'||r.role::text,'|' ORDER BY u.username) FROM app_user u JOIN role_assignment r ON r.user_id=u.id"),'site.admin:APP_ADMIN|site.checker:CLINICAL_APPROVER');
  assert.equal(psql("SELECT count(*) FROM app_user WHERE must_change_password"),'2');
  assert.equal(psql("SELECT count(*) FROM unit WHERE code='INSTALL_TEST'"),'0');
  assert.ok(!existsSync(path.join(root,'secrets','uat-accounts.json'))&&!existsSync(path.join(root,'secrets','initial-admins.json')));
  const cred=readFileSync(path.join(root,'credentials.txt'),'utf8');assert.ok(!/TEST ENVIRONMENT|uat\./i.test(cred));
  const acl=execFileSync(sys32('icacls.exe'),[path.join(root,'credentials.txt')],{encoding:'utf8'});assert.ok(!/Everyone|BUILTIN.Users|Authenticated Users/i.test(acl));
  process.env.NODE_TLS_REJECT_UNAUTHORIZED='0';
  const html=await (await fetch(`https://127.0.0.1:${cfg.ports.https}/login`)).text();assert.equal(/TEST ENVIRONMENT|TRAINING|NOT FOR CLINICAL/i.test(html),false);
  return {profile:'production',testAccounts:0,credentialFileAcl:'restricted',loginPageBanner:false,acceptance:st.acceptance};
 });
 await step('E03 first sign-in with the one-time passwords, forced change, old refused, new works, administrator API reachable',()=>{
  const r=JSON.parse(tsx('tools/win-installer/installed-first-login.ts','--root',root,'--his-paths').trim().split('\n').pop()!);
  assert.equal(r.passed,true);assert.equal(r.accounts.length,2);
  const admin=r.accounts.find((a:{role:string})=>a.role==='APP_ADMIN');assert.equal(admin.adminApiAfterChange,200);assert.equal(r.hisPaths.activePathsMatch,true);
  return r;
 });
 await step('E04 health, Word + Excel office-check in the installed runtime, scheduled-task trigger and logon type',()=>{
  const h=cli('health');assert.equal(h.ok,true);
  const office=cli('office-check',['--report-master',reportMaster]);assert.equal(office.ok,true);
  const task=JSON.parse(ps(`$t=Get-ScheduledTask -TaskName 'nipt-cbh-${tag}' -TaskPath '\\NIPT-CBH\\';[pscustomobject]@{state="$($t.State)";logonType="$($t.Principal.LogonType)";runLevel="$($t.Principal.RunLevel)";userId="$($t.Principal.UserId)";triggers=@($t.Triggers|ForEach-Object{$_.CimClass.CimClassName})}|ConvertTo-Json -Compress`));
  const winlogon=ps("(Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Winlogon' -ErrorAction SilentlyContinue).AutoAdminLogon");
  writeFileSync(out.replace(/\.json$/,'.office-check.json'),JSON.stringify(office,null,1));
  return {healthOk:h.ok,officeCheckOk:office.ok,officeSteps:office.steps?.map((s:{id:string;ok:boolean})=>[s.id,s.ok]),scheduledTask:task,automaticSignIn:winlogon==='1'?'configured':'not configured',
   unattendedOfficeAfterRealReboot:'NOT PROVEN: the task is an interactive-logon task; Office needs the signed-in session (see OFFICE-UNATTENDED-ASSESSMENT)'};
 });
 await step('E05 stop / task-scheduler start (reboot substitute) / health, and accounts survive a same-version Setup run',async()=>{
  cli('stop');
  ps(`Start-ScheduledTask -TaskName 'nipt-cbh-${tag}' -TaskPath '\\NIPT-CBH\\'`);
  let h:Record<string,any>={};for(let i=0;i<90;i++){h=cli('health',[],true);if(h.ok)break;await sleep(2000);} // eslint-disable-line @typescript-eslint/no-explicit-any
  assert.equal(h.ok,true);
  const again=spawnSync(exe,['/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/CURRENTUSER',`/PARITYREHEARSAL=${tag}`,`/ROOT=${root}`,`/DIR=${path.join(root,'setup-wrapper')}`,'/LAN=no','/NOTRUST=1','/TASKMODE=user',`/INSTANCE=${tag}`],{encoding:'utf8',windowsHide:true,timeout:30*60*1000});
  assert.equal(again.status,0);
  assert.equal(psql("SELECT count(*) FROM app_user WHERE username IN ('site.admin','site.checker') AND NOT must_change_password"),'2');
  return {restartViaTaskScheduler:true,sameVersionSetupAgain:'no re-bootstrap, passwords kept (both accounts still have their changed password)'};
 });
}catch(e){process.stderr.write('FAILED: '+(e as Error).message+'\n');process.exitCode=1;}
finally{
 if(installed&&!process.argv.includes('--keep')){
  try{cli('uninstall',['--confirm',path.basename(root),'--remove-data'],true);
  }catch{/* cleanup is best effort; the evidence still records the outcome */}
 }
 const evidence={format:'NIPT_SETUP_EXE_INSTALL_CHECK_V1',tag,root,passed:steps.length>0&&steps.every(s=>s.ok),steps};
 writeFileSync(out,JSON.stringify(evidence,null,2));
 process.stdout.write(JSON.stringify({passed:evidence.passed,evidence:out,steps:steps.map(s=>[s.id,s.ok])})+'\n');
}
