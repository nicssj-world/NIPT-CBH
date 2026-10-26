/**
 * OWNER-LAB-055/059 mandatory end-to-end (07 §6–§7): wrong default PET/RES folders → Admin corrects them in
 * Settings → HIS Integration (browser UI, worker-identity test, Save/Apply) → the RUNNING scanner/worker uses the new
 * folders on the next job; A → B → A; failed test never applies; a release reserved on the wrong folder is delivered
 * exactly once to the corrected folder. Isolated synthetic UAT runtime only (ports 20227–20230); disposable folders.
 * No Owner database, no hospital path, no real HIS share, no restart/rebuild between steps.
 */
import {mkdir,writeFile,readFile,readdir,stat} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {chromium,type Page} from 'playwright';
import {client,setEnv} from './db-env';
setEnv();
const {proposeSetting,validateSetting,approveSetting,activateSetting}=await import('../../packages/settings/service');
const {lookbackFolders}=await import('../../packages/inbound/discovery');
const {operationalTestPetBytes}=await import('../operational/test-pet-fixture');

const ORIGIN='https://127.0.0.1:20228',ROOT='D:\\NIPT-UAT-HIS-E2E-20261026';
const EVIDENCE=path.resolve('.local/claude-evidence-20261025/his-path-e2e');await mkdir(EVIDENCE,{recursive:true});
const fixture=JSON.parse(await readFile('.local/claude-lab-uat-runtime/uat-fixture.json','utf8'));
const folders=(k:'A'|'B')=>({pet:path.join(ROOT,k,'Request'),res:path.join(ROOT,k,'Res'),cfsPdf:path.join(ROOT,k,'Cfs'),backup:path.join(ROOT,k,'Backup')});
for(const k of ['A','B'] as const)for(const d of Object.values(folders(k)))await mkdir(d,{recursive:true});
const log:{at:string;step:string;ok:boolean;detail?:unknown}[]=[];
const record=async(step:string,ok:boolean,detail?:unknown)=>{log.push({at:new Date().toISOString(),step,ok,detail});console.log(ok?'PASS':'FAIL',step,detail===undefined?'':JSON.stringify(detail).slice(0,400));
 await writeFile(path.join(EVIDENCE,'his-path-e2e-log.json'),JSON.stringify(log,null,2));if(!ok)throw Error('E2E_STEP_FAILED: '+step);};
const db=await client('migrator');
const q=async<T=Record<string,unknown>>(sql:string,args:unknown[]=[])=>(await db.query(sql,args)).rows as T[];
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
async function waitFor<T>(label:string,fn:()=>Promise<T|null|undefined|false>,timeout=150000){const end=Date.now()+timeout;while(Date.now()<end){const v=await fn();if(v)return v;await sleep(2000);}throw Error('TIMEOUT '+label);}
const users:Record<string,import('../../packages/security/policy').Principal>=Object.fromEntries((await q<{username:string;id:string;role:string}>("SELECT u.username,u.id,a.role FROM app_user u JOIN role_assignment a ON a.user_id=u.id WHERE u.username IN ('admin','approver','lab','certifier')")).map(u=>[u.username,{id:u.id,roles:[u.role],unitIds:[],permissions:[]} as never]));
const sha=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
const today=lookbackFolders(1,new Date())[0];
async function writePet(dir:string,ln:string,hn:string){const day=path.join(dir,today);await mkdir(day,{recursive:true});const bytes=operationalTestPetBytes({ln,hn,day:today});
 await writeFile(path.join(day,ln+'-7.pet'),bytes);await writeFile(path.join(day,ln+'-7.ok'),Buffer.alloc(0));return {file:path.join(day,ln+'-7.pet'),sha256:sha(bytes)};}
const received=async(ln:string)=>(await q<{id:string;state:string;created_at:Date}>("SELECT id,state,discovered_at created_at FROM his_inbound_file WHERE filename=$1",[ln+'-7.pet']))[0]??null;
const lastScan=async()=>(await q<{outcome:string;error_code:string|null;finished_at:Date}>('SELECT outcome,error_code,finished_at FROM his_inbound_scan_run ORDER BY finished_at DESC LIMIT 1'))[0]??null;
const activeRow=async(key:string)=>(await q<{id:string;version:number;value:Record<string,unknown>}>('SELECT r.id,r.version,r.value FROM setting_active a JOIN settings_revision r ON r.id=a.revision_id WHERE a.setting_key=$1',[key]))[0];

// ── Browser sessions (real UI and the same-origin APIs it calls) ──
const browser=await chromium.launch(),pages:Record<string,Page>={};
// Sessions are kept outside the repo (scratch) and reused across re-runs, so re-runs do not trip the login throttle.
const AUTH=path.join(process.env.TEMP??'.','nipt-claude-his-e2e-auth');await mkdir(AUTH,{recursive:true});
for(const name of ['admin','lab','certifier']){const state=path.join(AUTH,name+'.json');
 let ctx=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:1440,height:1000},...(existsSync(state)?{storageState:state}:{})}),p=await ctx.newPage();
 await p.goto(ORIGIN+'/',{waitUntil:'commit'});await p.waitForLoadState('domcontentloaded');
 if(p.url().includes('/login')){await ctx.close();ctx=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:1440,height:1000}});p=await ctx.newPage();
  await p.goto(ORIGIN+'/login');await p.fill('#username',name);await p.fill('input[type=password]',name);await p.press('input[type=password]','Enter');await p.waitForURL(u=>!String(u).includes('/login'),{waitUntil:'commit',timeout:60000});
  await ctx.storageState({path:state});}
 pages[name]=p;}
const api=async(page:Page,url:string,body?:unknown)=>page.evaluate(async({url,body})=>{const token=document.cookie.split('; ').find(x=>x.startsWith('nipt_csrf='))?.split('=').slice(1).join('=')??'';
 const r=await fetch(url,body===undefined?{cache:'no-store'}:{method:'POST',headers:{'content-type':'application/json','x-csrf-token':token},body:JSON.stringify(body)});return {status:r.status,data:await r.json().catch(()=>null)};},{url,body});

/** Admin UI: Settings → HIS Integration. Fill folders, test with the worker, then Save/Apply (or expect the refusal). */
async function adminChangePaths(label:string,paths:Partial<Record<'pet'|'res'|'cfsPdf'|'backup',string>>,expectPass:boolean){
 const p=pages.admin;await p.goto(ORIGIN+'/settings/his',{waitUntil:'networkidle'});await p.getByRole('heading',{name:'เส้นทางไฟล์ HIS'}).waitFor();
 for(const [name,v] of Object.entries(paths))await p.fill('#his-'+name,v!);
 type O={keys:Record<string,{pending:null|{id:string;test:{state:string;errorCode?:string}}}>};
 const pendingIds=async()=>Object.values(((await api(p,'/api/settings/his-paths')).data as O).keys).map(k=>k.pending?.id).filter(Boolean).join();
 const previous=await pendingIds();
 await p.fill('#his-reason',`E2E ${label}`);await p.getByRole('button',{name:'ทดสอบเส้นทาง'}).click();
 await waitFor(label+' new proposal',async()=>(await pendingIds())!==previous);
 const outcome=await waitFor(label+' worker test',async()=>{const o=(await api(p,'/api/settings/his-paths')).data as O;
  const tests=Object.values(o.keys).map(k=>k.pending?.test).filter(Boolean) as {state:string;errorCode?:string}[];
  return tests.length&&tests.every(t=>t.state==='PASSED'||t.state==='FAILED')?tests:null;});
 await p.reload({waitUntil:'networkidle'});await p.getByRole('heading',{name:'เส้นทางไฟล์ HIS'}).waitFor();
 await p.screenshot({path:path.join(EVIDENCE,`${label}-tested.png`),fullPage:true});
 const passed=outcome.every(t=>t.state==='PASSED');
 const apply=p.getByRole('button',{name:'บันทึกและใช้งาน'});
 if(!expectPass){await record(`${label}: worker test reports failure (no false green)`,!passed&&await apply.isDisabled(),outcome);
  const forced=await api(p,'/api/settings/his-paths',{operation:'apply',ids:Object.values(((await api(p,'/api/settings/his-paths')).data as {keys:Record<string,{pending:null|{id:string}}>}).keys).map(k=>k.pending?.id).filter(Boolean)});
  await record(`${label}: direct apply refused by server (test not passed)`,forced.status>=400&&forced.data?.code==='HIS_PATH_TEST_NOT_PASSED',forced);return null;}
 await record(`${label}: worker test PASSED`,passed,outcome);
 const before=new Date();await apply.click();await p.getByText(/บันทึกและใช้งานแล้ว/).waitFor();
 await p.screenshot({path:path.join(EVIDENCE,`${label}-applied.png`),fullPage:true});return before;
}

// ── HALOS import + native Final/Release (the real Task 3 web endpoints) ──
let imported:{id:string;rows:{id:string;sheet:string;sampleKey:string}[]}|null=null;
async function releaseCase(key:string){
 if(!imported){const list=(await api(pages.lab,'/api/task3/halos')).data as {imports:{id:string;state:string;name:string}[]};
  const prior=list.imports.find(i=>i.name===fixture.fixtures[0]&&i.state==='Confirmed');if(prior)imported=(await api(pages.lab,'/api/task3/halos/'+prior.id)).data;}
 if(!imported){const bytes=await readFile(path.join('.local/claude-lab-uat-runtime/fixtures',fixture.fixtures[0]));
  const up=await pages.lab.evaluate(async({bytes,name})=>{const token=document.cookie.split('; ').find(x=>x.startsWith('nipt_csrf='))?.split('=').slice(1).join('=')??'',form=new FormData();form.append('file',new File([new Uint8Array(bytes)],name));
   const r=await fetch('/api/task3/halos',{method:'POST',headers:{'x-csrf-token':token},body:form});return {status:r.status,data:await r.json()};},{bytes:Array.from(bytes),name:fixture.fixtures[0]});
  if(up.status!==200)throw Error('HALOS_PREVIEW '+JSON.stringify(up));
  const ack=[...new Set(((up.data.issues??[]) as {code?:string;severity?:string}[]).filter(i=>i.severity!=='ERROR').map(i=>i.code).filter(Boolean))] as string[];
  const dec=await api(pages.lab,'/api/task3/halos/'+up.data.id,{decision:'CONFIRM',expectedRowVersion:up.data.rowVersion,acknowledgeWarnings:ack});
  if(dec.status!==200)throw Error('HALOS_CONFIRM '+JSON.stringify(dec));imported=up.data;}
 const c=fixture.cases.find((x:{key:string})=>x.key===key),row=imported!.rows.find(r=>r.sheet==='result'&&r.sampleKey===c.halosSampleId);
 if(!row)throw Error('HALOS_ROW_NOT_FOUND '+key);
 const fin=await api(pages.certifier,'/api/task3/reports',{action:'finalize',idempotencyKey:randomUUID(),defaults:{reportedBy:users.lab.id,approvedBy:users.certifier.id},release:true,
  releaseConfirmations:{reportContentVerified:true,identityAndValuesMatchReport:true,disclosureReviewed:true,abnormalAcknowledged:true,benchMeasurementsReviewed:true},items:[{rowId:row.id}]});
 const item=fin.data?.items?.[0];
 // Re-run: the report was finalized and released earlier; use that same release (never a second one).
 if(fin.status===200&&item?.holds?.some((h:{code:string})=>h.code==='INTERNAL_REPORT_ALREADY_FINAL'))
  return (await q<{id:string}>("SELECT r.id FROM result_release r JOIN specimen_round s ON s.id=r.round_id JOIN case_ln l ON l.id=s.case_ln_id WHERE l.ln=$1 AND r.state='Active'",[c.ln]))[0].id;
 if(fin.status!==200||item?.versionState!=='CertifiedReleased')throw Error('FINALIZE '+JSON.stringify(fin).slice(0,800));
 return (await q<{id:string}>('SELECT id FROM result_release WHERE version_id=$1',[item.versionId]))[0].id;
}
const transfers=async(releaseId:string)=>q<{id:string;state:string;res_name:string;ok_name:string;settings:string;created_at:Date;access:string|null;attempts:number}>(`SELECT id,model->>'state' state,res_name,plan->>'okName' ok_name,plan->>'settingsVersion' settings,created_at,(model->>'attempts')::int attempts,
 (SELECT event->>'accessCode' FROM p6_transfer_event e WHERE e.transfer_id=t.id AND e.event?'accessCode' ORDER BY e.revision DESC LIMIT 1) access FROM p6_transfer t WHERE clinical_release_id=$1 ORDER BY created_at`,[releaseId]);
const filesIn=async(dir:string)=>existsSync(dir)?(await readdir(dir)).filter(n=>!n.startsWith('.')):[];
async function expectDelivered(label:string,releaseId:string,k:'A'|'B'){
 const t=await waitFor(label+' RES+OK',async()=>{const all=await transfers(releaseId),last=all.at(-1);return last&&['AWAITING_CONFIRMATION','PICKED_UP_UNCONFIRMED'].includes(last.state)?all:null;},240000);
 const last=t.at(-1)!,f=folders(k),res=await filesIn(f.res);
 const okBytes=await readFile(path.join(f.res,last.ok_name)).catch(()=>null),resBytes=await readFile(path.join(f.res,last.res_name)).catch(()=>null);
 await record(`${label}: RES then OK published in ${k}\\Res, PDF in ${k}\\Cfs, backup in ${k}\\Backup`,!!resBytes&&!!okBytes&&okBytes.equals(Buffer.from([255,254]))&&(await filesIn(f.cfsPdf)).length>0&&(await filesIn(f.backup)).length>0,
  {transfers:t.map(x=>({state:x.state,res:x.res_name,access:x.access,attempts:x.attempts})),resFolder:res,resHeader:resBytes?.subarray(0,120).toString('latin1')});
 const oks=t.filter(x=>['AWAITING_CONFIRMATION','PICKED_UP_UNCONFIRMED','OK_OBSERVED','RECONCILIATION_REQUIRED'].includes(x.state));
 await record(`${label}: exactly one OK-bearing transfer for the release; HIS acknowledgement not claimed`,oks.length===1&&(await q('SELECT 1 FROM p6_transfer WHERE clinical_release_id=$1 AND model->>\'hisConfirmed\'<>\'false\'',[releaseId])).length===0,{oks:oks.length});
 return last;
}

try{
 // START_AT=S5 resumes after S1–S4 already passed (evidence kept in his-path-e2e-log-run9-S1-S4.json); the folders/releases persist.
 const resume=process.env.START_AT==='S5';
 let wrongAt=(await q<{at:Date}>("SELECT max(created_at) at FROM settings_revision WHERE reason LIKE 'E2E installer preloaded%'"))[0]?.at??new Date();
 if(resume)await record('resume at S5: active inbound is folder A from S4',(await activeRow('his_inbound')).value.basePath===folders('A').pet);
 if(!resume){
 // 0. Baseline
 const base={inbound:await activeRow('his_inbound'),outbound:await activeRow('his_outbound')};
 await record('baseline active HIS settings captured',!!base.inbound&&!!base.outbound,{inbound:{v:base.inbound.version,path:base.inbound.value.basePath},outbound:{v:base.outbound.version,res:base.outbound.value.resDestinationPath}});
 for(const d of ['X:\\','Y:\\','Z:\\'])await record(`wrong default ${d} is not reachable on this host`,!existsSync(d));

 // 1. Installation with the legacy NIPTY drive letters, which this server's worker cannot see (two-person activation, as at commissioning).
 if(base.inbound.value.basePath!=='X:\\')for(const [key,value] of [['his_inbound',{...base.inbound.value,basePath:'X:\\'}],['his_outbound',{...base.outbound.value,resDestinationPath:'Y:\\',pdfDestinationPath:'Z:\\',backupPath:'W:\\NIPT-Backup'}]] as const){
  await db.query('BEGIN');try{const id=await proposeSetting(db,users.admin,key,value,'E2E installer preloaded NIPTY drive letters (wrong on this server)');await validateSetting(db,users.admin,id,async()=>true);
   await approveSetting(db,users.approver,id);await activateSetting(db,users.approver,id);await db.query('COMMIT');}catch(e){await db.query('ROLLBACK');throw e;}}
 wrongAt=new Date();
 const pet1=await writePet(folders('A').pet,'2629870301','6999030100');
 const scan=await waitFor('scanner error on wrong default',async()=>{const s=await lastScan();return s&&s.finished_at>wrongAt?s:null;});
 const lastReal=(await q<{outcome:string;error_code:string|null;finished_at:Date}>("SELECT outcome,error_code,finished_at FROM his_inbound_scan_run WHERE outcome<>'SKIPPED_BACKOFF' ORDER BY finished_at DESC LIMIT 1"))[0];
 await record('wrong default PET folder: running scanner reports an explicit error (then backs off), nothing received',['SHARE_UNAVAILABLE','SKIPPED_BACKOFF'].includes(scan.outcome)&&lastReal?.outcome==='SHARE_UNAVAILABLE'&&!!lastReal.error_code&&!await received('2629870301'),{latest:scan,lastReal});
 const health=await api(pages.admin,'/api/settings/his');await writeFile(path.join(EVIDENCE,'monitor-wrong-default.json'),JSON.stringify(health.data,null,2));
 await pages.admin.goto(ORIGIN+'/health',{waitUntil:'networkidle'});await pages.admin.screenshot({path:path.join(EVIDENCE,'health-wrong-default.png'),fullPage:true});

 // 2. A result released while RES points at the wrong default waits (no retries burnt, no false success).
 const rel1=await releaseCase('A1');
 const waiting=await waitFor('transfer waits on wrong RES folder',async()=>{const t=(await transfers(rel1))[0];return t&&t.state==='RETRY_PENDING'&&t.access?t:null;});
 await sleep(30000);const still=(await transfers(rel1))[0];
 await record('release on wrong RES default: RETRY_PENDING with explicit access error; retry budget not consumed while unreachable',still.state==='RETRY_PENDING'&&still.attempts===waiting.attempts&&!!still.access,{first:waiting,after30s:still});

 // 3. Admin tests a wrong path in Settings → failed test is never applied.
 await adminChangePaths('S3-wrong-path-rejected',{pet:'X:\\Request',res:'Y:\\Res'},false);
 await record('active settings unchanged after rejected test',(await activeRow('his_inbound')).value.basePath==='X:\\');

 // 4. Admin corrects ALL folders to A in Settings → Save/Apply. No restart/rebuild/redeploy.
 const pidsBefore=JSON.parse(await readFile('.local/claude-lab-uat-runtime/runtime.json','utf8'));
 const appliedA=await adminChangePaths('S4-correct-to-A',folders('A'),true);
 const gotA=await waitFor('PET received from A',async()=>received('2629870301'));
 await record('scanner received PET+OK from the corrected folder A on its next run',!!gotA&&gotA.created_at>appliedA!,gotA);
 await record('HIS inbound files untouched (read-only)',sha(await readFile(pet1.file))===pet1.sha256&&existsSync(pet1.file.replace(/\.pet$/,'.ok')));
 const used=(await q<{resource_id:string}>("SELECT resource_id FROM audit_chain WHERE action='INBOUND_CONFIGURATION_USED' ORDER BY sequence DESC LIMIT 1"))[0];
 await record('worker audit shows it used the newly applied inbound revision',used?.resource_id===(await activeRow('his_inbound')).id);
 await expectDelivered('S4 wrong-default release rerouted to A',rel1,'A');
 const t1=await transfers(rel1);
 await record('original wrong-folder transfer CANCELLED by configuration change, replaced once (audited reroute)',t1.length===2&&t1[0].state==='CANCELLED'&&(await q("SELECT 1 FROM audit_chain WHERE action='P6_RELEASE_REROUTED' AND resource_id=$1",[t1[1].id])).length===1,t1.map(x=>x.state));
 await record('no web/worker restart happened',JSON.stringify(JSON.parse(await readFile('.local/claude-lab-uat-runtime/runtime.json','utf8')))===JSON.stringify(pidsBefore));
 }

 // 5. A → B: a PET left in A is no longer read; B is read; the next release goes to B.
 const appliedB=await adminChangePaths('S5-switch-to-B',folders('B'),true);
 await writePet(folders('A').pet,'2629870302','6999030200');await writePet(folders('B').pet,'2629870303','6999030300');
 const gotB=await waitFor('PET received from B',async()=>received('2629870303'));
 await sleep(20000);
 await record('after A→B: PET in B received, PET left in A not read',!!gotB&&gotB.created_at>appliedB!&&!await received('2629870302'));
 const rel2=await releaseCase('A2');await expectDelivered('S5 release delivered to B',rel2,'B');

 // 6. B → A: the waiting PET in A is now received; the next release goes to A.
 const appliedA2=await adminChangePaths('S6-switch-back-to-A',folders('A'),true);
 const gotA2=await waitFor('PET in A received after switching back',async()=>received('2629870302'));
 await record('after B→A: PET waiting in A received',!!gotA2&&gotA2.created_at>appliedA2!);
 const rel3=await releaseCase('A3');await expectDelivered('S6 release delivered to A',rel3,'A');

 // 7. Versioned/audited history.
 const hist=await q<{setting_key:string;version:number;state:string;reason:string}>("SELECT setting_key,version,state,reason FROM settings_revision WHERE setting_key IN ('his_inbound','his_outbound') ORDER BY setting_key,version");
 const applied=(await q<{n:number}>("SELECT count(*)::int n FROM audit_chain WHERE action='HIS_PATH_CHANGE_APPLIED' AND created_at>$1",[wrongAt]))[0].n;
 await record('every applied change is a new version with audit; previous versions archived',applied===6&&hist.filter(h=>h.state==='Active').length===2,{applied,hist});
 for(const k of ['A','B'] as const)await writeFile(path.join(EVIDENCE,`folder-${k}.json`),JSON.stringify(Object.fromEntries(await Promise.all(Object.entries(folders(k)).map(async([n,d])=>[n,await Promise.all((await filesIn(d)).map(async f=>({f,bytes:(await stat(path.join(d,f))).size})))]))),null,2));
 console.log('E2E_COMPLETE');
}finally{await browser.close();await db.end();}
