/** Update rehearsal on a disposable root: install the real previous Setup EXE, apply the real Update EXE on top of it, prove the administrator-settings behaviour,
 *  that nothing of the installation was lost, and that an installation of a different source refuses the update. No real HIS, no hospital share.
 *    tsx tools/win-installer/update-rehearsal.ts --old-exe <installed Setup EXE> --update-exe <Update EXE> --other-exe <Setup EXE of a different source> --out <evidence.json>
 *  Everything runs as the current user (/CURRENTUSER) and is removed with the product's own uninstaller. */
import {spawnSync} from 'node:child_process';
import {existsSync,readFileSync,writeFileSync,mkdirSync,rmSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';

const opt=(n:string)=>{const i=process.argv.indexOf('--'+n);return i<0?undefined:process.argv[i+1];};
const need=(n:string)=>{const v=opt(n);if(!v||!existsSync(v))throw Error(`${n.toUpperCase()}_REQUIRED`);return path.resolve(v);};
const oldExe=need('old-exe'),updateExe=need('update-exe'),otherExe=need('other-exe');
const out=path.resolve(opt('out')??'.local/p8-win/evidence/update-rehearsal.json');mkdirSync(path.dirname(out),{recursive:true});
const tag='upd'+Date.now().toString(36).slice(-6);
const base=path.resolve('.local/p8-win');
const root=path.join(base,'upd-rehearsal-'+tag,'NIPT CBH');
const second=path.join(base,'upd-rehearsal-'+tag,'other');
const pwFile=path.join(base,'upd-rehearsal-'+tag+'.passwords.json');
const names=['/ADMINUSER=site.admin','/ADMINNAME=Site Administrator','/CHECKERUSER=site.checker','/CHECKERNAME=Site Clinical Approver'];
const steps:{id:string;ok:boolean;detail?:unknown}[]=[];
const registered=()=>{const r=spawnSync('reg.exe',['query','HKCU\\SOFTWARE\\NIPT-CBH','/v','InstallRoot'],{encoding:'utf8'});return r.status===0?(r.stdout.match(/REG_SZ\s+(.+)/)?.[1]??'').trim():null;};
const otherSetupRunning=()=>spawnSync('powershell.exe',['-NoProfile','-Command',"(Get-Process | Where-Object {$_.Name -like 'NIPT-CBH-Setup*' -or $_.Name -like 'NIPT-CBH-Update*' -or $_.Name -like 'unins*'} | Measure-Object).Count"],{encoding:'utf8'}).stdout.trim()!=='0';
// this rehearsal owns the per-user NIPT-CBH registration while it runs; it refuses to start next to anyone else's and only ever uninstalls its own root
if(registered()!==null||otherSetupRunning()){process.stderr.write('REFUSED: another NIPT-CBH installation or Setup exists on this machine; run this rehearsal in an isolated environment. Nothing was changed.\n');process.exit(3);}
const norm=(v:string|null|undefined)=>(v??'').toLowerCase().replace(/\\+$/,'');
const uninstallOwn=()=>norm(registered())===norm(root)?uninstall():null;
const tsx=(...a:string[])=>{const r=spawnSync(process.execPath,['node_modules/tsx/dist/cli.mjs',...a],{encoding:'utf8',maxBuffer:64*1024*1024});if(r.status!==0)throw Error('tsx '+a[0]+' exit '+r.status+' stdout: '+(r.stdout??'').slice(-2500)+' stderr: '+(r.stderr??'').slice(-1500));return r.stdout;};
const sha=(f:string)=>createHash('sha256').update(readFileSync(f)).digest('hex');
let currentRoot=root;
const cli=(cmd:string,extra:string[]=[],allowFail=false):Record<string,any>=>{ // eslint-disable-line @typescript-eslint/no-explicit-any
 const r=spawnSync(path.join(currentRoot,'runtime','node','node.exe'),[path.join(currentRoot,'admin','nipt-admin.mjs'),cmd,'--root',currentRoot,...extra],{encoding:'utf8',windowsHide:true,maxBuffer:64*1024*1024});
 let json:Record<string,any>={};try{json=JSON.parse(r.stdout);}catch{json={ok:false,error:'UNPARSEABLE_OUTPUT',stdout:r.stdout.slice(-400),stderr:r.stderr.slice(-400)};} // eslint-disable-line @typescript-eslint/no-explicit-any
 if(r.status!==0&&!allowFail)throw Error(`${cmd} failed: ${JSON.stringify(json).slice(0,600)}`);
 return {...json,_status:r.status};
};
const sql=(q:string)=>{const cfg=JSON.parse(readFileSync(path.join(currentRoot,'config','nipt.json'),'utf8'));const r=spawnSync(path.join(currentRoot,'runtime','pg','bin','psql.exe'),['-h','127.0.0.1','-p',String(cfg.ports.postgres),'-U','nipt_migrator','-d',cfg.database,'-X','-A','-t','-c',q],{encoding:'utf8',env:{...process.env,PGPASSWORD:readFileSync(path.join(currentRoot,'secrets','db-password'),'utf8').trim()}});if(r.status!==0)throw Error('SQL_FAILED:'+r.stderr.slice(-200));return r.stdout.trim();};
const state=()=>JSON.parse(readFileSync(path.join(currentRoot,'install-state.json'),'utf8'));
const logFile=path.join(base,'upd-'+tag+'.setup.log');
const runExe=(exe:string,args:string[],timeout=50*60*1000)=>spawnSync(exe,['/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/CURRENTUSER','/LOG='+logFile,...args],{encoding:'utf8',windowsHide:true,timeout});
const uninstall=()=>{const u=path.join(process.env.LOCALAPPDATA??'','Programs','NIPT-CBH','unins000.exe');return existsSync(u)?spawnSync(u,['/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/DELETEDATA=1'],{encoding:'utf8',timeout:20*60*1000}).status:null;};
async function step(id:string,fn:()=>Promise<unknown>|unknown){try{steps.push({id,ok:true,detail:await fn()});}catch(e){steps.push({id,ok:false,detail:(e as Error).message});throw e;}}
const tree=(dir:string):Record<string,string>=>Object.fromEntries(readdirSync(dir,{recursive:true,withFileTypes:true}).filter(e=>e.isFile()).map(e=>{const f=path.join(e.parentPath,e.name);return [path.relative(dir,f),sha(f)];}));
const settingsOf=()=>sql("SELECT coalesce(json_agg(json_build_object('k',r.setting_key,'v',r.version,'value',r.value) ORDER BY r.setting_key),'[]') FROM setting_active a JOIN settings_revision r ON r.id=a.revision_id");

let snapshot:Record<string,unknown>={};let markers:Record<string,string>={};
try{
 await step('U0 inputs',()=>({oldExe:{path:oldExe,sha256:sha(oldExe)},updateExe:{path:updateExe,bytes:readFileSync(updateExe).length,sha256:sha(updateExe)},otherExe:{path:otherExe,sha256:sha(otherExe)}}));
 await step('U1 install the previous release from its real Setup EXE (production profile, named first accounts)',()=>{
  const r=runExe(oldExe,[`/ROOT=${root}`,'/LAN=no','/NOTRUST=1','/TASKMODE=user',`/INSTANCE=${tag}`,...names]);
  assert.equal(r.status,0,'old EXE exit '+r.status);const s=state();
  return {version:s.current.version,revision:s.current.revision,profile:s.profile,status:s.status};
 });
 await step('U2 first sign-in (password change) and HIS folders set the OLD way; PET/RES marker files put in the folders',()=>{
  const r=JSON.parse(tsx('tools/win-installer/installed-first-login.ts','--root',root,'--his-paths','--save-passwords',pwFile).trim().split('\n').pop()!);assert.equal(r.passed,true);
  const cfg=JSON.parse(readFileSync(path.join(root,'config','nipt.json'),'utf8'));
  const inbound=path.join(root,'data','integration','inbound','pet-local'),res=path.join(root,'data','integration','outbound','res-local');
  mkdirSync(path.join(inbound,'20261027'),{recursive:true});
  writeFileSync(path.join(inbound,'20261027','REHEARSAL-NOT-A-PET.txt'),'marker pet');writeFileSync(path.join(res,'REHEARSAL-RES.txt'),'marker res');
  markers={...Object.fromEntries(Object.entries(tree(inbound)).map(([k,v])=>['pet/'+k,v])),...Object.fromEntries(Object.entries(tree(res)).map(([k,v])=>['res/'+k,v]))};
  snapshot={settings:sql("SELECT count(*) FROM settings_revision"),accounts:sql('SELECT count(*) FROM app_user'),hashes:sql("SELECT string_agg(md5(password_hash),',' ORDER BY username) FROM app_user"),database:cfg.database,ports:cfg.ports};
  return {hisPaths:r.hisPaths,markers:Object.keys(markers).length};
 });
 await step('U3 reproduce the reported behaviour on the OLD release',()=>{
  const r=JSON.parse(tsx('tools/win-installer/installed-settings-check.ts','--root',root,'--passwords',pwFile,'--phase','before').trim().split('\n').pop()!);
  assert.equal(r.passed,true,JSON.stringify(r.steps));return r.steps;
 });
 const activeBefore=settingsOf();const backupsBefore=(cli('backups').count as number)??0;
 await step('U4 apply the real Update EXE on top (no root given: it finds the installation itself)',()=>{
  const r=runExe(updateExe,[]);assert.equal(r.status,0,'update EXE exit '+r.status+' '+(existsSync(logFile)?readFileSync(logFile,'utf8').split(/\r?\n/).filter(l=>/Initializ|Setup|Exception|Abort|Error|NIPT/i.test(l)).slice(-12).join(' | '):''));
  const s=state();assert.equal(s.current.version,opt('expect-version')??'1.1.1');assert.equal(s.previous.version,opt('expect-previous')??'1.1.0');assert.equal(s.status.startsWith('INSTALLED'),true);
  return {from:s.previous.version,to:s.current.version,toRevision:s.current.revision,history:s.history.slice(-2).map((h:{event:string})=>h.event)};
 });
 await step('U5 nothing was lost: data, accounts and passwords, HIS folders and PET/RES files, settings, migration ledger, health',()=>{
  const cfg=JSON.parse(readFileSync(path.join(root,'config','nipt.json'),'utf8'));
  assert.equal(cfg.database,snapshot.database);assert.deepEqual(cfg.ports,snapshot.ports);assert.equal(sql('SELECT count(*) FROM app_user'),snapshot.accounts);
  assert.equal(sql("SELECT string_agg(md5(password_hash),',' ORDER BY username) FROM app_user"),snapshot.hashes);                  // no password reset, no second bootstrap
  assert.equal(settingsOf(),activeBefore);                                                                                          // every active setting (incl. HIS folders) identical
  const inbound=path.join(root,'data','integration','inbound','pet-local'),res=path.join(root,'data','integration','outbound','res-local');
  const nowMarkers={...Object.fromEntries(Object.entries(tree(inbound)).map(([k,v])=>['pet/'+k,v])),...Object.fromEntries(Object.entries(tree(res)).map(([k,v])=>['res/'+k,v]))};
  assert.deepEqual(nowMarkers,markers);
  assert.equal(sql("SELECT count(*) FROM schema_migration WHERE name='157_admin_direct_system_settings.sql'"),'1');
  const backups=cli('backups');assert.ok((backups.count as number)>backupsBefore,'a pre-update backup was taken');
  const h=cli('health');assert.equal(h.ok,true);const st=cli('status');assert.equal(st.postgresRunning,true);
  return {settingsRevisions:{before:snapshot.settings,after:sql('SELECT count(*) FROM settings_revision')},backups:backups.count,health:h.ok,migration157:true,releases:readdirSync(path.join(root,'releases'))};
 });
 await step('U6 Owner acceptance behaviour on the UPDATED system (Auto Scan, no reason, no approver, no queue, reload, restart, RBAC, audit)',()=>{
  const r=JSON.parse(tsx('tools/win-installer/installed-settings-check.ts','--root',root,'--passwords',pwFile,'--phase','after').trim().split('\n').pop()!);
  assert.equal(r.passed,true,JSON.stringify(r.steps.filter((s:{ok:boolean})=>!s.ok)));return r.steps;
 });
 await step('U7 recovery: rollback is refused after the forward migration, and the pre-update backup restores into a quarantined database for inspection',()=>{
  const rb=cli('rollback',[],true);assert.equal(rb.error,'ROLLBACK_REQUIRES_DATABASE_RESTORE');
  const list=cli('backups');const all=(list.backups as {path:string}[]).map(b=>b.path).sort();const pre={path:all.at(-1)!};
  const restore=cli('restore',['--backup',pre.path]);
  assert.equal(restore.receipt.restoreVerified,true);assert.equal(restore.receipt.quarantined,true);assert.equal(restore.activated,false);
  assert.equal(cli('health').ok,true);
  return {rollback:rb.error,preUpdateBackup:path.basename(pre?.path??''),restoreVerified:restore.receipt.restoreVerified,quarantined:restore.receipt.quarantined};
 });
 await step('U7b a tampered update package is refused by the engine and the installation is untouched',()=>{
  const pkg=path.join(base,'setup-packages','nipt-cbh-'+(opt('expect-version')??'1.1.1')+'-update'),bad=path.join(base,'upd-rehearsal-'+tag,'tampered');mkdirSync(bad,{recursive:true});
  for(const e of readdirSync(pkg,{withFileTypes:true}))if(e.isFile())writeFileSync(path.join(bad,e.name),readFileSync(path.join(pkg,e.name)));
  const mf=path.join(bad,'package-manifest.json');assert.ok(existsSync(mf),'manifest present');writeFileSync(mf,readFileSync(mf,'utf8').replace(/"version":\s*"[^"]+"/,'"version": "9.9.9"'));
  const before=JSON.stringify({s:state().current,set:settingsOf(),u:sql('SELECT count(*) FROM app_user')});
  const r=cli('upgrade',['--package',bad,'--public-key',path.join(base,'keys','package-signing-public.pem')],true);
  assert.notEqual(r._status,0,'tampered package must be refused');
  assert.equal(JSON.stringify({s:state().current,set:settingsOf(),u:sql('SELECT count(*) FROM app_user')}),before);assert.equal(cli('health').ok,true);
  return {refused:r.error??'non-zero exit',unchanged:true,healthy:true};
 });
 await step('U8 running the same Update EXE again changes nothing',()=>{
  const before=JSON.stringify({s:state().current,b:cli('backups').count,set:settingsOf()});
  const r=runExe(updateExe,[]);assert.equal(r.status,0);
  assert.equal(JSON.stringify({s:state().current,b:cli('backups').count,set:settingsOf()}),before);
  return 'no change';
 });
 await step('U9 uninstall the updated rehearsal system with the product uninstaller',()=>{
  const code=uninstallOwn();for(let i=0;i<30&&existsSync(root);i++)spawnSync('powershell.exe',['-NoProfile','-Command','Start-Sleep 1']);
  assert.equal(code,0);assert.ok(!existsSync(root));return {exitCode:code};
 });
 await step('U10 a system built from a DIFFERENT source refuses the update and stays exactly as it was',()=>{
  const r=runExe(otherExe,[`/ROOT=${second}`,'/LAN=no','/NOTRUST=1','/TASKMODE=user',`/INSTANCE=${tag}b`,...names]);assert.equal(r.status,0,'other EXE exit '+r.status);
  currentRoot=second;const before=state().current;const set=settingsOf();const accounts=sql('SELECT count(*) FROM app_user');
  const u=runExe(updateExe,[]);assert.notEqual(u.status,0,'the update must be refused');
  const s=state();assert.equal(s.current.version,before.version);assert.equal(s.current.revision,before.revision);assert.equal(settingsOf(),set);assert.equal(sql('SELECT count(*) FROM app_user'),accounts);
  assert.equal(cli('health').ok,true);
  const logs=readdirSync(path.join(process.env.ProgramData??'C:/ProgramData','NIPT-CBH','setup-logs')).sort();
  const log=readFileSync(path.join(process.env.ProgramData??'C:/ProgramData','NIPT-CBH','setup-logs',logs.at(-1)!),'utf8');
  assert.match(log,/UPGRADE_BASE_REVISION_MISMATCH/);
  return {installed:before.version,installedRevision:before.revision,updateExit:u.status,refusal:'UPGRADE_BASE_REVISION_MISMATCH',stillHealthy:true};
 });
}catch(e){process.stderr.write('FAILED: '+(e as Error).message+'\n');process.exitCode=1;}
finally{
 try{if(existsSync(currentRoot)&&norm(registered())===norm(currentRoot))uninstall();}catch{/* best effort */}
 rmSync(pwFile,{force:true});
 const evidence={format:'NIPT_UPDATE_REHEARSAL_V1',tag,passed:steps.length>0&&steps.every(s=>s.ok),steps,notRun:['hospital server (never touched)','real HIS (never contacted)','real reboot / unattended Office']};
 writeFileSync(out,JSON.stringify(evidence,null,2));
 process.stdout.write(JSON.stringify({passed:evidence.passed,evidence:out,steps:steps.map(s=>[s.id,s.ok])})+'\n');
}
