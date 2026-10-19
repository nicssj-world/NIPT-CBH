/** Narrow real-package 1.0.0 -> 1.0.1 rehearsal. Never use the generic fault-injection rehearsal packages.
 * tsx tools/win-installer/verify-parity-upgrade.ts --baseline-package <dir> --baseline-key <pem>
 *   --new-package <dir> --new-key <pem> --root <fresh ASCII .local/p8-win/parity-upgrade-...>
 *   --ports <pg,web,https,renderer> [--new-exe <actual1.0.1.exe>] [--master-workbook <original>] [--new-journey] [--leave-running]
 * Actual EXE runs only through its opt-in /PARITYREHEARSAL isolation. Without --new-exe, evidence explicitly reports CLI level.
 */
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {existsSync} from 'node:fs';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {Pool} from 'pg';
import {chromium} from '@playwright/test';
import {PDFDocument} from 'pdf-lib';
import {layout,verifyPackage,portFree,directoryHashes,sha256Bytes} from './lib.mjs';

const arg=(name:string)=>{const i=process.argv.indexOf('--'+name);return i<0?undefined:process.argv[i+1];};
const flag=(name:string)=>process.argv.includes('--'+name);
const required=(name:string)=>arg(name)??(()=>{throw Error('ARGUMENT_REQUIRED_'+name);})();
const oldPkg=path.resolve(required('baseline-package')),oldKey=path.resolve(required('baseline-key'));
const newPkg=path.resolve(required('new-package')),newKey=path.resolve(required('new-key'));
const baselineSource=path.resolve(arg('baseline-source')??path.resolve(oldPkg,'../../../..')),candidateSource=path.resolve(arg('candidate-source')??'.');
const root=path.resolve(required('root')),L=layout(root),local=path.resolve('.local/p8-win');
const rel=path.relative(local,root);
assert.ok(rel&&!rel.startsWith('..')&&!path.isAbsolute(rel)&&/^parity-upgrade-[a-zA-Z0-9 -]+$/.test(rel),'FRESH_ISOLATED_PARITY_ROOT_REQUIRED');
assert.ok(/^[ -~]+$/.test(root)&&!existsSync(root),'FRESH_ASCII_ROOT_REQUIRED');
const ports=required('ports').split(',').map(Number);
assert.ok(ports.length===4&&new Set(ports).size===4&&ports.every(p=>Number.isInteger(p)&&p>1024&&p<65536),'FOUR_DISTINCT_NONPRIVILEGED_PORTS_REQUIRED');
for(const p of ports)assert.equal(await portFree(p),true,'PORT_BUSY_'+p);
const oldManifest=await verifyPackage(oldPkg,oldKey),nextManifest=await verifyPackage(newPkg,newKey);
assert.equal(oldManifest.version,'1.0.0');assert.equal(oldManifest.revision,'c57ced450fab13bfbaf247e0e65c4d51a11b741e');
assert.equal(oldManifest.runtimeIncluded,true);assert.equal(nextManifest.version,'1.0.1');
assert.equal(nextManifest.testFault??null,null);assert.ok(!JSON.parse(await readFile(path.join(newPkg,'payload/release/release.json'),'utf8')).extraTestMigration,'REAL_RELEASE_NO_REHEARSAL_MIGRATION_REQUIRED');
const tag=path.basename(root).slice('parity-upgrade-'.length);
assert.match(tag,/^[a-z0-9-]{6,60}$/,'ISOLATED_TAG_REQUIRED');
const instance='parity101-'+Date.now(),evidence=root+'-evidence',setupExe=arg('new-exe')?path.resolve(arg('new-exe')!):undefined;
assert.equal(existsSync(evidence),false,'FRESH_EVIDENCE_DIRECTORY_REQUIRED');
// Test harnesses intentionally remain outside the production release. In particular, the baseline package's journey
// imports tools/operational/positive-journey-steps.ts, which is not bundled. Run original source without patching either
// package or installed release; prove the full executable source closure matches the signed revision first.
async function harnessSource(source:string,manifest:typeof oldManifest){
 const tracked=['packages','apps','tools','tests','package.json','package-lock.json','tsconfig.json'];
 const git=(...args:string[])=>execFileSync('git',args,{cwd:source,encoding:'utf8'}).trim();
 assert.equal(git('status','--porcelain','--untracked-files=normal','--',...tracked),'','HARNESS_SOURCE_DIRTY_'+manifest.version);
 assert.equal(git('diff','--name-only',manifest.revision,'--',...tracked),'','HARNESS_SOURCE_DIFFERS_FROM_PACKAGE_'+manifest.version);
 const sourceLock=sha256Bytes(await readFile(path.join(source,'package-lock.json')));
 assert.equal(sourceLock,manifest.files['payload/release/ops/package-lock.json'],'HARNESS_LOCK_DIFFERS_FROM_PACKAGE');
 const require=createRequire(path.join(source,'package.json'));
 const dependencies=Object.fromEntries(['tsx','@playwright/test','pg','pdf-lib'].map(name=>[name,require.resolve(name)]));
 for(const file of ['installed-journey.ts','installed-photo-check.ts']){
  assert.equal(sha256Bytes(await readFile(path.join(source,'tools/win-installer',file))),manifest.files['payload/release/ops/tools/win-installer/'+file],'HARNESS_ENTRY_DIFFERS_FROM_SIGNED_PACKAGE');
 }
 return {source,head:git('rev-parse','HEAD'),packageRevision:manifest.revision,sourceClosureMatchesPackage:true,lockSha256:sourceLock,dependencies};
}
const harnesses={baseline:await harnessSource(baselineSource,oldManifest),candidate:await harnessSource(candidateSource,nextManifest)};
if(setupExe){
 const record=JSON.parse(await readFile(setupExe.replace(/\.exe$/i,'.record.json'),'utf8'));
 assert.equal(record.exe.sha256,sha256Bytes(await readFile(setupExe)),'EXE_RECORD_HASH_MISMATCH');
 assert.equal(record.source.head,nextManifest.revision,'EXE_REVISION_MISMATCH');
 assert.equal(record.package.manifestSha256,sha256Bytes(await readFile(path.join(newPkg,'manifest.json'))),'EXE_PACKAGE_MISMATCH');
}
await mkdir(evidence,{recursive:true});
const steps:{name:string;ok:boolean;detail?:unknown}[]=[];
let owned=false,passed=false;
const json=async(file:string)=>JSON.parse(await readFile(file,'utf8'));
const report=()=>({format:'NIPT_REAL_PARITY_UPGRADE_V1',passed,root,ports,instance,baseline:{package:oldPkg,version:oldManifest.version,revision:oldManifest.revision},candidate:{package:newPkg,version:nextManifest.version,revision:nextManifest.revision},
 verificationLevel:setupExe?'BASELINE_PACKAGE_INSTALL_ACTUAL_SETUP_EXE_UPGRADE':'SIGNED_OFFLINE_PACKAGE_ENGINE_INSTALL_AND_UPGRADE',setupExe:setupExe??'NOT_RUN_NO_EXE_SUPPLIED',harnesses,steps,hisConfirmed:false,clinicalAcceptance:false,hospitalAcceptance:false});
async function command(exe:string,args:string[],cwd:string,outputJson=true){
 const child=spawn(exe,args,{cwd,windowsHide:true,env:{...process.env,NIPT_ANC_FORM_REGISTRY:undefined},stdio:['ignore','pipe','pipe']});
 let stdout='',stderr='';child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);
 const code=await new Promise<number|null>((resolve,reject)=>{child.on('error',reject);child.on('exit',resolve);});
 await writeFile(path.join(evidence,`command-${steps.length}.log`),stderr+'\n'+stdout);
 if(code!==0)throw Error('CHILD_FAILED_'+code+'_'+stderr.slice(-1200)+'_'+stdout.slice(-1200));
 if(!outputJson)return {exitCode:code};
 let result:unknown;try{result=JSON.parse(stdout);}catch{result=JSON.parse(stdout.trim().split('\n').at(-1)!);}return result as Record<string,unknown>;
}
const engine=(pkg:string,action:string,args:string[]=[])=>command(path.join(oldPkg,'payload/runtime/node/node.exe'),[path.join(pkg,'installer/nipt-admin.mjs'),action,'--root',root,...args],pkg);
const installed=(action:string,args:string[]=[])=>command(L.node,[path.join(root,'admin/nipt-admin.mjs'),action,'--root',root,...args],root);
async function tool(release:string,name:string,args:string[]){
 const harness=release==='1.0.0'?harnesses.baseline:harnesses.candidate;
 return command(L.node,['--import',pathToFileURL(harness.dependencies.tsx).href,path.join(harness.source,'tools/win-installer',name),...args],harness.source);
}
async function step(name:string,fn:()=>Promise<unknown>){try{const detail=await fn();steps.push({name,ok:true,detail});await writeFile(path.join(evidence,'evidence.json'),JSON.stringify(report(),null,2));return detail;}catch(e){steps.push({name,ok:false,detail:e instanceof Error?e.message:String(e)});throw e;}}
async function snapshot(){
 const db=new Pool({connectionString:(await readFile(path.join(L.secrets,'migration-url'),'utf8')).trim()});
 try{
  const tables=['nipt_case','specimen_round','analytical_attempt','result_release','p6_transfer','app_user','p2_document_revision','p2_final_consent','run_photo'];
  const records:Record<string,{count:number;ids:string}>= {};
  for(const table of tables)records[table]=(await db.query(`SELECT count(*)::int count,md5(coalesce(string_agg(id::text,',' ORDER BY id),'')) ids FROM ${table}`)).rows[0];
  return {records,files:await directoryHashes(L.files)};
 }finally{await db.end();}
}
async function forms(){
 const cfg=await json(L.configFile),accounts=await json(path.join(L.secrets,'uat-accounts.json')) as {username:string;password:string}[],anc=accounts.find(a=>a.username==='uat.anc')!;
 const db=new Pool({connectionString:(await readFile(path.join(L.secrets,'migration-url'),'utf8')).trim()});
 const browser=await chromium.launch({headless:true});
 try{
  const id=(await db.query("SELECT id FROM nipt_case WHERE registration_origin='ANC' ORDER BY created_at LIMIT 1")).rows[0]?.id;assert.ok(id,'ANC_BASELINE_CASE_REQUIRED');
  const context=await browser.newContext({baseURL:cfg.origin,ignoreHTTPSErrors:true}),page=await context.newPage();
  await page.goto('/login');await page.getByLabel('ชื่อผู้ใช้',{exact:true}).fill(anc.username);await page.getByLabel('รหัสผ่าน',{exact:true}).fill(anc.password);await page.getByRole('button',{name:'เข้าสู่ระบบ',exact:true}).click();await page.waitForURL(u=>!u.pathname.startsWith('/login'));
  const outputs=[];
  for(const [kind,pages] of [['request',1],['consent',1],['both',2]] as const){
   const res=await context.request.get(`/api/p2/cases/${id}/forms?kind=${kind}&intent=preview`);assert.equal(res.status(),200,await res.text());
   const bytes=await res.body();assert.equal((await PDFDocument.load(bytes)).getPageCount(),pages);assert.equal(res.headers()['x-dcc-status'],'REFERENCE_NOT_DCC_APPROVED');
   assert.equal(res.headers()['x-content-sha256'],sha256Bytes(bytes));await writeFile(path.join(evidence,'installed-'+kind+'.pdf'),bytes);
   outputs.push({kind,pages,sha256:sha256Bytes(bytes),dccStatus:res.headers()['x-dcc-status'],templateSet:res.headers()['x-template-set']});
  }
  return {caseId:id,outputs,manualAssetCopy:false};
 }finally{await browser.close();await db.end();}
}
try{
 await step('baseline install',async()=>{
  owned=true;
  return engine(oldPkg,'install',['--package',oldPkg,'--public-key',oldKey,'--ports',ports.join(','),'--instance',instance,'--task-mode','user','--excel-mode','direct',...(arg('master-workbook')?['--master-workbook',arg('master-workbook')!]:[])]);
 });
 await step('baseline installed ANC workflow',()=>tool('1.0.0','installed-journey.ts',['--root',root,'--out',path.join(evidence,'baseline-journey'),'--workflow-only','--anc']));
 const photoState=path.join(evidence,'photo-state.json');
 await step('baseline synthetic photo upload',()=>tool('1.0.0','installed-photo-check.ts',['upload','--root',root,'--out',photoState]));
 await step('baseline photo fetch',()=>tool('1.0.0','installed-photo-check.ts',['fetch','--root',root,'--state',photoState]));
 const before=await snapshot();await writeFile(path.join(evidence,'before.json'),JSON.stringify(before,null,2));
 await step(setupExe?'actual1.0.1 Setup EXE upgrade':'actual signed1.0.1 package CLI upgrade',async()=>{
  const result=setupExe?await command(setupExe,['/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/CURRENTUSER',`/PARITYREHEARSAL=${tag}`,`/ROOT=${root}`,`/DIR=${path.join(root,'setup-wrapper')}`,'/LAN=no','/TASKMODE=user','/NOTRUST=1',`/LOG=${path.join(evidence,'setup-exe.log')}`],path.dirname(setupExe),false):await engine(newPkg,'upgrade',['--package',newPkg,'--public-key',newKey]);
  const state=await json(L.installState);assert.equal(state.current.version,'1.0.1');assert.equal(state.current.revision,nextManifest.revision);return result;
 });
 await step('preserved records and file bytes',async()=>{
  const after=await snapshot();assert.deepEqual(after.records,before.records);
  for(const [name,hash] of Object.entries(before.files))assert.equal(after.files[name],hash,'RETAINED_FILE_'+name);
  await writeFile(path.join(evidence,'after.json'),JSON.stringify(after,null,2));return {records:after.records,retainedFiles:Object.keys(before.files).length};
 });
 await step('photo original after upgrade',()=>tool('1.0.1','installed-photo-check.ts',['fetch','--root',root,'--state',photoState]));
 await step('photo storage consistency',async()=>{const result=await installed('photos',['verify']);assert.equal(result.consistent,true);return result;});
 await step('installed renderer request consent combined preview routes',forms);
 if(flag('new-journey'))await step('new contract installed ANC workflow',()=>tool('1.0.1','installed-journey.ts',['--root',root,'--out',path.join(evidence,'new-journey'),'--workflow-only','--anc','--patient-start','8801']));
 await step('installed health',async()=>{const health=await installed('health');assert.equal(health.ok,true);return health;});passed=true;
}catch(error){process.exitCode=1;steps.push({name:'rehearsal failed',ok:false,detail:error instanceof Error?error.stack:String(error)});}
finally{
 if(owned&&!flag('leave-running'))await step('stop only owned isolated services',async()=>{const state=await json(L.installState);assert.equal(state.instance,instance);return installed('stop');}).catch(()=>{passed=false;process.exitCode=1;});
 await writeFile(path.join(evidence,'evidence.json'),JSON.stringify(report(),null,2));process.stdout.write(JSON.stringify({passed,evidence:path.join(evidence,'evidence.json'),root,servicesLeftRunning:owned&&flag('leave-running')})+'\n');
}
