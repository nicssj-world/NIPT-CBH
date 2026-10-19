// One-click Setup backend. The Inno Setup wizard extracts the verified package to a temporary folder and runs this script with the package's own Node.
// It decides between fresh install / reinstall on retained data / upgrade / already-installed, picks free ports and the server's LAN address, calls the
// unchanged installer engine (nipt-admin.mjs), verifies the LAN URL from the server itself, and writes a small result file the wizard can read.
// Nothing here downloads anything, touches Production or connects a HIS. Node built-ins only.
import {spawn,execFileSync} from 'node:child_process';
import {existsSync,readFileSync,writeFileSync,appendFileSync,mkdirSync,rmSync,readdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {compareVersions,layout,verifyPackage,normalizeLanProfiles} from './lib.mjs';
import {thaiError,thaiStep,thaiLanWarnings,THAI_WARNING} from './setup-messages.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
const argv=process.argv.slice(2);
const arg=(n,d)=>{const i=argv.indexOf('--'+n);return i<0?d:(argv[i+1]&&!argv[i+1].startsWith('--')?argv[i+1]:'true');};
const packageDir=path.resolve(arg('package',path.resolve(here,'..'))),publicKey=path.resolve(arg('public-key',path.join(here,'package-signing-public.pem')));
const root=path.resolve(arg('root','C:\\NIPT-CBH')),resultFile=arg('result'),progressFile=arg('progress'),logDir=path.resolve(arg('log-dir',path.join(root,'..')));
const L=layout(root);
const SYS=process.env.SystemRoot??'C:\\Windows';
mkdirSync(logDir,{recursive:true});
const logFile=path.join(logDir,`setup-${new Date().toISOString().replace(/[:.]/g,'-')}.log`);
const log=m=>{try{appendFileSync(logFile,`${new Date().toISOString()} ${m}\n`);}catch{/* never stop the install for a log write */}};
let lastPercent=0;
const progress=(percent,text)=>{lastPercent=Math.max(lastPercent,percent);log(`PROGRESS ${lastPercent} ${text}`);if(progressFile)try{writeFileSync(progressFile,`\uFEFF${lastPercent}|${text}\r\n`,'utf8');}catch{/* wizard polls this */}};
const ps=script=>{try{return execFileSync(path.join(SYS,'System32','WindowsPowerShell','v1.0','powershell.exe'),['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-Command',script],{encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']}).trim();}catch{return null;}};
const isAdmin=()=>{try{execFileSync(path.join(SYS,'System32','net.exe'),['session'],{windowsHide:true,stdio:'ignore'});return true;}catch{return false;}};
const whoami=()=>execFileSync(path.join(SYS,'System32','whoami.exe'),[],{encoding:'utf8',windowsHide:true}).trim();
const excelInstalled=()=>{try{execFileSync(path.join(SYS,'System32','reg.exe'),['query','HKCR\\Excel.Application\\CurVer'],{windowsHide:true,stdio:'ignore'});return true;}catch{return false;}};

function finish(result){
 const flat=v=>String(v??'').replace(/\r?\n/g,' | ');
 const lines=Object.entries({ok:result.ok?'yes':'no',action:result.action,version:result.version,root,url:result.url,urlVerified:result.urlVerified?'yes':'no',lanEnabled:result.lanEnabled?'yes':'no',
  credentials:result.credentials,excelInstalled:result.excelInstalled?'yes':'no',taskMode:result.taskMode,message:result.message,warnings:(result.warnings??[]).join(' | '),log:logFile,certificateDownload:result.certificateDownload,firewall:result.firewall}).map(([k,v])=>`${k}=${flat(v)}`);
 log('RESULT '+JSON.stringify(result));
 if(resultFile)writeFileSync(resultFile,'\uFEFF'+lines.join('\r\n')+'\r\n','utf8'); // BOM: Inno Setup reads UTF-8 only with it
 process.stdout.write(JSON.stringify(result)+'\n');
 process.exit(result.ok?0:1);
}

/** Run the engine; stream its progress lines to the wizard; return the parsed JSON it prints. */
function engine(cmd,extra){
 return new Promise(resolve=>{
  const cli=path.join(here,'nipt-admin.mjs');
  const child=spawn(process.execPath,[cli,cmd,'--root',root,...extra],{windowsHide:true,stdio:['ignore','pipe','pipe']});
  let out='';
  child.stdout.on('data',d=>out+=d);
  let buf='';
  child.stderr.on('data',d=>{buf+=d;let i;while((i=buf.indexOf('\n'))>=0){const line=buf.slice(0,i).trim();buf=buf.slice(i+1);if(!line)continue;log('ENGINE '+line);const s=thaiStep(line);if(s)progress(s.percent,s.text);}});
  child.on('exit',()=>{let json;try{json=JSON.parse(out);}catch{json={ok:false,error:'ENGINE_OUTPUT_UNREADABLE',detail:out.slice(-800)};}resolve(json);});
 });
}

const stateOf=()=>{try{return JSON.parse(readFileSync(L.installState,'utf8'));}catch{return null;}};
const wantLan=arg('lan','yes')==='yes';
const host=arg('host');
const taskMode=arg('task-mode','user');
const trust=arg('trust','auto');
const profiles=normalizeLanProfiles(arg('lan-profiles',arg('allow-public')==='yes'?'Domain,Private,Public':'Domain,Private'));
const admin=isAdmin();
const excel=excelInstalled();
const warnings=[];
progress(2,'กำลังเริ่มการติดตั้ง');
log(`START package=${packageDir} root=${root} admin=${admin} excel=${excel} lan=${wantLan} host=${host??'auto'} taskMode=${taskMode}`);

try{
 // 1. integrity before anything is written
 progress(4,'กำลังตรวจความสมบูรณ์ของชุดติดตั้ง');
 let manifest;
 try{manifest=await verifyPackage(packageDir,publicKey);}catch(e){log('VERIFY_FAILED '+e.message);finish({ok:false,action:'VERIFY',message:thaiError(e.message)});}
 const state=stateOf();
 const base=path.basename(root);

 // 2. what is there already?
 if(state&&state.status!=='UNINSTALLED_DATA_RETAINED'){
  const cmp=compareVersions(manifest.version,state.current.version);
  if(cmp<0)finish({ok:false,action:'REFUSED',version:state.current.version,message:thaiError('INSTALLED_VERSION_IS_NEWER')});
  if(cmp===0){
   // opening the Setup again never recreates anything: make sure the services are up and report the real address
   progress(60,'ติดตั้งเวอร์ชันนี้อยู่แล้ว กำลังตรวจสถานะ');
   await engine('start',[]);
   const lan=await engine('lan-status',[]);
   finish({ok:true,action:'ALREADY_INSTALLED',version:state.current.version,url:lan.url,urlVerified:!!lan.probe?.reachableFromThisServer,lanEnabled:lan.enabled,credentials:L.credentials,excelInstalled:excel,warnings:thaiLanWarnings(lan,{admin}),certificateDownload:lan.certificateDownload,message:'มีการติดตั้งเวอร์ชันนี้อยู่แล้ว ไม่มีการเปลี่ยนแปลงข้อมูล'});
  }
  // upgrade (data is kept; a verified pre-upgrade backup is taken by the engine)
  progress(10,'พบเวอร์ชันเดิม กำลังอัปเกรดโดยรักษาข้อมูลเดิม');
  const r=await engine('upgrade',['--package',packageDir,'--public-key',publicKey,'--health-timeout-seconds','240']);
  if(r.ok===false||r.error){log('UPGRADE_FAILED '+JSON.stringify(r));finish({ok:false,action:'UPGRADE',version:state.current.version,message:thaiError(r.error,r.detail)});}
  progress(95,'กำลังตรวจที่อยู่สำหรับเครื่องอื่นใน LAN');
  const lan=await engine('lan-status',[]);
  finish({ok:true,action:'UPGRADED',version:manifest.version,url:lan.url,urlVerified:!!lan.probe?.reachableFromThisServer,lanEnabled:lan.enabled,credentials:L.credentials,excelInstalled:excel,warnings:thaiLanWarnings(lan,{admin}),certificateDownload:lan.certificateDownload,message:`อัปเกรดเป็นเวอร์ชัน ${manifest.version} สำเร็จ ข้อมูลเดิมอยู่ครบ`});
 }

 // 3. fresh install, or reinstall onto data kept by an earlier uninstall (never recreated)
 const retained=state?.status==='UNINSTALLED_DATA_RETAINED';
 const rootExisted=existsSync(root)&&readdirSync(root).length>0;
 if(taskMode==='user'){
  // the startup task must run as the person who is signed in to Windows (Excel and the printer belong to that session)
  const console=ps('(Get-CimInstance Win32_ComputerSystem).UserName');
  if(console&&console.toLowerCase()!==whoami().toLowerCase()){log(`USER_MISMATCH console=${console} installer=${whoami()}`);finish({ok:false,action:'INSTALL',message:thaiError('INSTALL_USER_IS_NOT_THE_LOGGED_ON_USER')});}
 }
 if(!excel)warnings.push(THAI_WARNING.EXCEL_MISSING);
 else if(!ps("(Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows NT\\CurrentVersion\\Windows' -Name Device -ErrorAction SilentlyContinue).Device"))warnings.push(THAI_WARNING.PRINTER_MISSING);
 if(taskMode==='user')warnings.push(THAI_WARNING.RESTART_NOT_TESTED);
 const args=['--package',packageDir,'--public-key',publicKey,'--instance','nipt-cbh','--task-mode',taskMode,'--excel-mode',taskMode==='system'?'bridge':'direct','--allow-no-excel','yes',
  ...(retained?['--ports','auto']:['--ports','auto']),'--lan',wantLan?'yes':'no','--lan-profiles',profiles,'--lan-allow',arg('lan-allow','LocalSubnet'),
  ...(host?['--host',host]:[]),...(arg('origin')?['--origin',arg('origin')]:[]),
  ...(trust==='yes'||(trust==='auto'&&admin)?['--trust-certificate','yes']:[]),
  ...(taskMode==='system'?['--excel-user',ps('(Get-CimInstance Win32_ComputerSystem).UserName')??whoami()]:[])];
 progress(8,'กำลังตรวจความพร้อมของเครื่อง');
 const r=await engine('install',args);
 if(r.ok===false||r.error){
  log('INSTALL_FAILED '+JSON.stringify(r).slice(0,4000));
  // a failed fresh install must not leave a half-installation behind; retained data is never deleted
  try{
   if(existsSync(L.configFile)||existsSync(L.installState)){await engine('uninstall',['--confirm',base,...(retained?[]:['--remove-data'])]);}
   if(!retained&&!rootExisted&&existsSync(root))for(let i=0;i<5&&existsSync(root);i++){try{rmSync(root,{recursive:true,force:true});}catch{await new Promise(res=>setTimeout(res,1500));}}
  }catch(e){log('CLEANUP_FAILED '+e.message);}
  finish({ok:false,action:retained?'REINSTALL':'INSTALL',message:thaiError(r.error,r.detail)});
 }
 const lan=r.lan;
 warnings.push(...thaiLanWarnings(lan,{admin}));
 progress(100,'ติดตั้งเสร็จสมบูรณ์');
 finish({ok:true,action:retained?'REINSTALLED_ON_RETAINED_DATA':'INSTALLED',version:manifest.version,url:lan.url,urlVerified:!!lan.probe?.reachableFromThisServer,lanEnabled:lan.enabled,credentials:retained?L.credentials:r.credentials,excelInstalled:excel,taskMode,
  firewall:lan.firewall?.exists?'created':(admin?'missing':'not created (needs administrator)'),certificateDownload:lan.certificateDownload,warnings:[...new Set(warnings)],message:'ติดตั้งสำเร็จ'});
}catch(e){
 log('UNEXPECTED '+(e?.stack??e));
 finish({ok:false,action:'UNEXPECTED',message:thaiError('UNEXPECTED')});
}
