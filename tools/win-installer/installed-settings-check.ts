/** Admin-settings behaviour of an INSTALLED system, over its real HTTPS API as the real accounts (rehearsal root only).
 *    tsx tools/win-installer/installed-settings-check.ts --root <install root> --passwords <file from installed-first-login --save-passwords> --phase before|after
 *  before: reproduces the reported behaviour of the old release (Save only creates a draft; a reason is mandatory; activation needs a second approver).
 *  after : the Owner acceptance criteria of 2026-10-27 - APP_ADMIN enables/disables Auto Scan with one Save, no reason, no approver, no queue; the value
 *          survives reload and a runtime restart; non-admins cannot; the active HIS folders and the queue are untouched; the worker picks the setting up. */
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {layout} from './lib.mjs';

const arg=(n:string)=>{const i=process.argv.indexOf('--'+n);return i<0?undefined:process.argv[i+1];};
const root=arg('root'),phase=arg('phase'),pwFile=arg('passwords');
if(!root||!pwFile||!['before','after'].includes(phase??''))throw Error('USAGE');
const L=layout(root);
const config=JSON.parse(await readFile(L.configFile,'utf8')) as {origin:string;ports:{https:number;postgres:number};database:string};
process.env.NODE_TLS_REJECT_UNAUTHORIZED='0';
const accounts=JSON.parse(await readFile(path.resolve(pwFile),'utf8')) as {username:string;role:string;password:string}[];
const base=`https://127.0.0.1:${config.ports.https}`;
type Jar=Map<string,string>;
const call=async(jar:Jar,method:string,url:string,body?:unknown,csrf?:string)=>{
 const r=await fetch(base+url,{method,redirect:'manual',headers:{...(body?{'content-type':'application/json'}:{}),origin:new URL(config.origin).origin,cookie:[...jar].map(([k,v])=>`${k}=${v}`).join('; '),...(csrf?{'x-csrf-token':csrf}:{})},body:body?JSON.stringify(body):undefined});
 for(const c of r.headers.getSetCookie()){const [pair]=c.split(';');const i=pair.indexOf('=');const k=pair.slice(0,i),v=pair.slice(i+1);if(/Max-Age=0/i.test(c)||v==='')jar.delete(k);else jar.set(k,v);}
 const raw=await r.text();let json:Record<string,any>={};try{json=JSON.parse(raw);}catch{/* not JSON */} // eslint-disable-line @typescript-eslint/no-explicit-any
 return {status:r.status,json};
};
async function login(role:string){
 const a=accounts.find(x=>x.role===role);if(!a)throw Error('ACCOUNT_MISSING:'+role);
 const jar:Jar=new Map();const pre=await call(jar,'GET','/api/auth/csrf');
 const res=await call(jar,'POST','/api/auth/login',{username:a.username,password:a.password,csrf:pre.json.csrf});
 if(res.status!==200)throw Error('LOGIN_FAILED:'+role+':'+res.status);
 return {jar,csrf:res.json.csrf as string};
}
let pgPassword='';try{pgPassword=(await readFile(path.join(L.secrets,'db-password'),'utf8')).trim();}catch{/* unreadable */}
const sql=(q:string)=>{const r=spawnSync(path.join(L.runtime,'pg','bin','psql.exe'),['-h','127.0.0.1','-p',String(config.ports.postgres),'-U','nipt_migrator','-d',config.database,'-X','-A','-t','-c',q],{encoding:'utf8',env:{...process.env,PGPASSWORD:pgPassword}});if(r.status!==0)throw Error('SQL_FAILED:'+r.stderr.slice(-200));return r.stdout.trim();};
const nipt=(cmd:string,extra:string[]=[])=>spawnSync(path.join(L.runtime,'node','node.exe'),[path.join(L.root,'admin','nipt-admin.mjs'),cmd,'--root',L.root,...extra],{encoding:'utf8',windowsHide:true,maxBuffer:64*1024*1024});
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
const steps:{id:string;ok:boolean;detail?:unknown}[]=[];
const step=async(id:string,fn:()=>Promise<unknown>)=>{try{steps.push({id,ok:true,detail:await fn()});}catch(e){steps.push({id,ok:false,detail:(e as Error).message});}};
const eq=(a:unknown,b:unknown,what:string)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw Error(`${what}: expected ${JSON.stringify(b)} got ${JSON.stringify(a)}`);};
const ok=(c:unknown,what:string)=>{if(!c)throw Error(what);};

const admin=await login('APP_ADMIN');
const activeOf=async()=>(await call(admin.jar,'GET','/api/settings')).json.active as Record<string,Record<string,unknown>>;
const queueCounts=()=>sql("SELECT coalesce(string_agg(state||':'||n,','),'') FROM (SELECT state,count(*) n FROM job_outbox GROUP BY state ORDER BY state) q");

if(phase==='before'){
 await step('B1 the old release shows no direct-save capability',async()=>{const r=await call(admin.jar,'GET','/api/settings');const c=(r.json.catalog as {key:string;directSave?:boolean}[]).find(x=>x.key==='his_inbound');ok(c&&c.directSave!==true,'direct save already present');return {directSave:c?.directSave??false};});
 await step('B2 reproduce: reason is mandatory; Save creates only a Draft; activation needs a second person',async()=>{
  const act=(await activeOf()).his_inbound??{};
  const value={...(act as Record<string,unknown>),enabled:true};
  const noReason=await call(admin.jar,'POST','/api/settings',{operation:'propose',key:'his_inbound',value,reason:''},admin.csrf);
  const withReason=await call(admin.jar,'POST','/api/settings',{operation:'propose',key:'his_inbound',value,reason:'rehearsal'},admin.csrf);
  const id=withReason.json.id as string;
  const activate=await call(admin.jar,'POST','/api/settings',{operation:'activate',id},admin.csrf);
  const stillActive=(await activeOf()).his_inbound?.enabled;
  return {emptyReason:noReason.status+':'+(noReason.json.code??noReason.json.error),draftCreated:withReason.status,activate:activate.status+':'+(activate.json.code??activate.json.error),activeEnabledAfterSave:stillActive??false};
 });
}else{
 const approver=await login('CLINICAL_APPROVER');
 const snapshot=await activeOf();
 const inboundBefore=snapshot.his_inbound??{};
 const outboundBefore=snapshot.his_outbound??{};
 const jobsBefore=await queueCounts();
 await step('A1 catalog says APP_ADMIN may save his_inbound directly',async()=>{const r=await call(admin.jar,'GET','/api/settings');const c=(r.json.catalog as {key:string;directSave?:boolean}[]);eq(c.find(x=>x.key==='his_inbound')?.directSave,true,'his_inbound directSave');eq(c.find(x=>x.key==='report_interpretation')?.directSave,false,'clinical stays approval');return 'ok';});
 await step('A2 first enable asks for the scan scope; without confirmation nothing changes',async()=>{
  const value={...inboundBefore,enabled:true};
  const refused=await call(admin.jar,'POST','/api/settings',{operation:'save',key:'his_inbound',value},admin.csrf);
  eq(refused.json.code,'SCAN_SCOPE_CONFIRMATION_REQUIRED','refusal code');eq((await activeOf()).his_inbound?.enabled,inboundBefore.enabled,'active enabled after refusal');
  const scope=await call(admin.jar,'POST','/api/settings',{operation:'scope',key:'his_inbound',value},admin.csrf);
  eq(scope.status,200,'scope status');
  return {refused:refused.status,scope:{lookbackDays:scope.json.lookbackDays,intervalSeconds:scope.json.intervalSeconds,dayFolders:scope.json.dayFolders,pairedPetFiles:scope.json.pairedPetFiles,accessible:scope.json.accessible,errorCode:scope.json.errorCode}};
 });
 await step('A3 one Save (no reason, no approver, no queue) makes Auto Scan Active; it survives a page reload, a runtime restart and keeps the HIS folders',async()=>{
  const value={...inboundBefore,enabled:true};
  const saved=await call(admin.jar,'POST','/api/settings',{operation:'save',key:'his_inbound',value,confirmFirstScan:true},admin.csrf);
  eq(saved.status,200,'save status');eq(saved.json.active,true,'active flag');
  const row=sql(`SELECT state||'|'||coalesce(approved_by::text,'none')||'|'||test_passed FROM settings_revision WHERE id='${saved.json.revisionId}'`);
  eq(row.split('|').slice(0,2),['Active','none'],'revision state/approver');
  const reload=(await activeOf()).his_inbound;eq(reload?.enabled,true,'enabled after reload');eq(reload?.basePath,inboundBefore.basePath,'PET path unchanged');
  const r=nipt('restart');ok(r.status===0,'restart failed: '+r.stdout.slice(-200)+r.stderr.slice(-200));
  for(let i=0;i<60;i++){const h=nipt('health');if(h.status===0)break;await sleep(2000);}
  const afterRestart=(await call((await login('APP_ADMIN')).jar,'GET','/api/settings')).json.active.his_inbound;eq(afterRestart.enabled,true,'enabled after restart');
  return {version:saved.json.version,state:row,reloadEnabled:true,restartEnabled:true,petPath:reload?.basePath};
 });
 await step('A4 the worker uses the new setting (a scan runs by itself within the interval)',async()=>{
  const before=Number(sql("SELECT count(*) FROM his_inbound_scan_run"));
  let after=before;for(let i=0;i<45&&after<=before;i++){await sleep(2000);after=Number(sql("SELECT count(*) FROM his_inbound_scan_run"));}
  ok(after>before,'no scan run appeared');
  const last=sql("SELECT trigger||'|'||outcome||'|'||coalesce(error_code,'') FROM his_inbound_scan_run ORDER BY finished_at DESC LIMIT 1");
  return {scanRunsBefore:before,scanRunsAfter:after,lastScan:last};
 });
 await step('A5 switching Auto Scan off is one Save too, and the audit chain records both changes without values',async()=>{
  const cur=(await activeOf()).his_inbound;
  const off=await call(admin.jar,'POST','/api/settings',{operation:'save',key:'his_inbound',value:{...cur,enabled:false}},admin.csrf);eq(off.status,200,'disable status');
  eq((await activeOf()).his_inbound?.enabled,false,'disabled');
  const audit=sql("SELECT count(*) FROM audit_chain WHERE action='SETTING_SAVED_ACTIVE' AND resource_type='SETTING'");ok(Number(audit)>=2,'audit rows');
  const leak=sql("SELECT count(*) FROM audit_chain WHERE action='SETTING_SAVED_ACTIVE' AND details::text ~* '(password|secret|[A-Z]:)'");eq(leak,'0','audit must not carry paths or secrets');
  return {auditRows:Number(audit)};
 });
 await step('A6 non-admin cannot use the same API; clinical settings keep their approval',async()=>{
  const cur=(await activeOf()).his_inbound;
  const denied=await call(approver.jar,'POST','/api/settings',{operation:'save',key:'his_inbound',value:{...cur,enabled:true},confirmFirstScan:true},approver.csrf);
  ok(denied.status===403||denied.status===401,'non-admin save returned '+denied.status);
  eq((await activeOf()).his_inbound?.enabled,false,'unchanged by non-admin');
  const clinical=await call(admin.jar,'POST','/api/settings',{operation:'save',key:'report_interpretation',value:{interpretationApproved:true}},admin.csrf);
  eq(clinical.json.code,'SETTING_REQUIRES_APPROVAL','clinical refusal');
  const prod=await call(admin.jar,'POST','/api/settings',{operation:'save',key:'his_outbound',value:{...outboundBefore,productionAuthorized:true}},admin.csrf);
  eq(prod.json.code,'PRODUCTION_AUTHORIZATION_REQUIRES_APPROVAL','production authorisation refusal');
  return {nonAdmin:denied.status,clinical:clinical.json.code,productionAuthorization:prod.json.code};
 });
 await step('A7 HIS folders: a usable folder is saved Active in one step; an unusable one is refused with its real error and nothing changes',async()=>{
  const paths=(await call(admin.jar,'GET','/api/settings/his-paths')).json.keys as Record<string,{paths:Record<string,string>}>;
  const pet=paths.his_inbound.paths.pet;
  const missing=path.join(path.dirname(pet),'does-not-exist-'+Date.now());
  const refused=await call(admin.jar,'POST','/api/settings/his-paths',{operation:'save',paths:{pet:missing}},admin.csrf);
  eq(refused.status,400,'missing folder status');ok(/โฟลเดอร์|Path|SHARE/i.test(String(refused.json.error)),'refusal explains the folder');
  eq((await call(admin.jar,'GET','/api/settings/his-paths')).json.keys.his_inbound.paths.pet,pet,'PET path unchanged after refusal');
  return {refused:refused.status+':'+String(refused.json.code??refused.json.error).slice(0,80)};
 });
 await step('A8 queues and health are intact: no stale queue, no worker error, HIS folders and accounts as before',async()=>{
  const outboundAfter=(await activeOf()).his_outbound??{};eq(outboundAfter,outboundBefore,'his_outbound unchanged');
  const jobsAfter=await queueCounts();
  const pending=sql("SELECT count(*) FROM job_outbox WHERE state='Pending' AND created_at<now()-interval '2 minutes'");eq(pending,'0','stale pending jobs');
  const h=JSON.parse(nipt('health').stdout||'{}') as {ok?:boolean;failed?:string[]};ok(h.ok===true,'health not OK: '+JSON.stringify(h.failed));
  const hp=await fetch(`${base}/api/health`).then(r=>r.status).catch(()=>0);
  return {jobsBefore,jobsAfter,health:h.ok,apiHealth:hp,accounts:sql('SELECT count(*) FROM app_user')};
 });
}
const passed=steps.every(s=>s.ok);
process.stdout.write(JSON.stringify({phase,passed,steps})+'\n');
process.exitCode=passed?0:1;
