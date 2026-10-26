// OWNER-LAB-059 functional proof in the real browser (isolated synthetic runtime): UI → API → saved revision → runtime consumer,
// plus per-role negative RBAC. Reuses saved sessions to respect the login throttle.
import {chromium} from 'playwright';
import {existsSync,mkdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
const ORIGIN='https://127.0.0.1:20228',OUT='.local/claude-evidence-20261025/settings/functional';mkdirSync(OUT,{recursive:true});
const AUTHDIR=path.join(process.env.TEMP??'.','nipt-claude-his-e2e-auth');mkdirSync(AUTHDIR,{recursive:true});
const log=[];const rec=(step,ok,detail)=>{log.push({step,ok,detail});console.log(ok?'PASS':'FAIL',step,detail===undefined?'':JSON.stringify(detail).slice(0,300));};
const until=async(fn,ms=30000)=>{const end=Date.now()+ms;while(Date.now()<end){if(await fn())return;await new Promise(r=>setTimeout(r,500));}throw Error('until timeout');};
const newest=async(p,key)=>{const r=(await api(p,'/api/settings')).data.revisions.filter(x=>x.setting_key===key);return r.sort((a,b)=>b.version-a.version)[0];};
const row=(p,v)=>p.locator('.timeline li',{hasText:new RegExp(`รุ่น ${v}(?!\d)`)});
const browser=await chromium.launch();
async function login(name){const state=path.join(AUTHDIR,name+'.json');
 let ctx=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:1440,height:1000},...(existsSync(state)?{storageState:state}:{})}),p=await ctx.newPage();
 await p.goto(ORIGIN+'/',{waitUntil:'commit'});await p.waitForLoadState('domcontentloaded');
 if(p.url().includes('/login')){await ctx.close();ctx=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:1440,height:1000}});p=await ctx.newPage();
  await p.goto(ORIGIN+'/login');await p.fill('#username',name);await p.fill('input[type=password]',name);await p.press('input[type=password]','Enter');await p.waitForURL(u=>!String(u).includes('/login'),{waitUntil:'commit',timeout:60000});await ctx.storageState({path:state});}
 return p;}
const api=(p,url,body)=>p.evaluate(async({url,body})=>{const me=body===undefined?null:await (await fetch('/api/me')).json();const r=await fetch(url,body===undefined?{cache:'no-store'}:{method:'POST',headers:{'content-type':'application/json','x-csrf-token':me.csrf},body:JSON.stringify(body)});return {status:r.status,data:await r.json().catch(()=>null)};},{url,body});

// ── 1. Per-role negative RBAC on the Settings API and pages ──
for(const [name,expectApi] of [['admin',200],['lab',403],['certifier',403],['approver',403],['anc',403]]){
 const p=await login(name);const g=await api(p,'/api/settings');
 const post=await api(p,'/api/settings',{operation:'propose',key:'general',value:{systemName:'RBAC probe',timezone:'Asia/Bangkok'},reason:'rbac negative probe'});
 await p.goto(ORIGIN+'/settings',{waitUntil:'networkidle'});
 const redirected=name==='admin'?false:!new URL(p.url()).pathname.startsWith('/settings');
 rec(`RBAC ${name}: GET /api/settings=${g.status}`,g.status===expectApi);
 if(name!=='admin'){rec(`RBAC ${name}: propose refused (${post.status}); /settings page redirects away`,post.status===403&&redirected,{post:post.data?.error});}
}
// Admin cannot propose a CLINICAL setting, cannot approve own INTEGRATION draft, cannot activate an unvalidated draft.
{const p=await login('admin');
 const dflt=(await api(p,'/api/settings')).data.catalog.find(c=>c.key==='laboratory').default;
 const clinical=await api(p,'/api/settings',{operation:'propose',key:'laboratory',value:dflt,reason:'rbac clinical probe'});
 rec('RBAC admin: a VALID CLINICAL proposal is refused for lack of authority',clinical.status===403,{s:clinical.status,e:clinical.data?.error});
 const cat=(await api(p,'/api/settings')).data;const risky=cat.catalog.filter(c=>['CLINICAL','INTEGRATION'].includes(c.risk));
 rec('RBAC admin: catalog says admin can propose only GENERAL + INTEGRATION; activate none of the regulated ones',risky.every(c=>c.canActivate===false)&&cat.catalog.filter(c=>c.risk==='CLINICAL').every(c=>!c.canPropose),{proposeable:cat.catalog.filter(c=>c.canPropose).map(c=>c.key)});}

// ── 2. Admin UI round-trip: notifications (GENERAL, one person): draft → test → activate → Health consumer ──
const admin=await login('admin');
const stale=307,backlog=77;
await admin.goto(ORIGIN+'/settings?key=notifications',{waitUntil:'networkidle'});
await admin.fill('#setting-staleSeconds',String(stale));await admin.fill('#setting-backlogWarning',String(backlog));await admin.fill('#setting-reason','059 functional round-trip (synthetic)');
await admin.getByRole('button',{name:'บันทึกร่าง'}).click();await admin.getByText(/บันทึกร่างแล้ว/).waitFor({timeout:30000});
rec('notifications: draft saved from UI',true);
await admin.screenshot({path:path.join(OUT,'notifications-draft.png'),fullPage:true});
const d1=await newest(admin,'notifications');await row(admin,d1.version).getByRole('button',{name:'ทดสอบร่าง',exact:true}).click();await admin.getByText(/ทดสอบร่างแล้ว/).waitFor({timeout:30000});
rec('notifications: draft tested from UI',true,{version:d1.version});
await row(admin,d1.version).getByRole('button',{name:'เปิดใช้',exact:true}).click();await until(async()=>(await api(admin,'/api/settings')).data.active.notifications?.staleSeconds===stale);
const active=(await api(admin,'/api/settings')).data.active.notifications;
rec('notifications: activated; saved revision holds the typed values',active.staleSeconds===stale&&active.backlogWarning===backlog,active);
await admin.goto(ORIGIN+'/health',{waitUntil:'networkidle'});
const healthText=await admin.locator('main').innerText();
rec('Health (runtime consumer) now shows the new thresholds',healthText.includes(`เกณฑ์ ${stale}`)&&healthText.includes(`${backlog} งาน / ${stale} วินาที`),{found:healthText.match(/เกณฑ์[^\n]{0,40}/g)?.slice(0,3)});
await admin.screenshot({path:path.join(OUT,'health-new-thresholds.png'),fullPage:true});
// Out-of-range value is refused with a clear message and creates no draft.
await admin.goto(ORIGIN+'/settings?key=notifications',{waitUntil:'networkidle'});
const before=(await api(admin,'/api/settings')).data.revisions.filter(r=>r.setting_key==='notifications').length;
const bad=await api(admin,'/api/settings',{operation:'propose',key:'notifications',value:{staleSeconds:5,backlogWarning:77},reason:'range probe'});
const after=(await api(admin,'/api/settings')).data.revisions.filter(r=>r.setting_key==='notifications').length;
rec('notifications: out-of-range refused (no draft created)',bad.status>=400&&after===before,{s:bad.status,e:bad.data?.error});
// Restore the previous defaults through the same UI path (new audited version).
await admin.fill('#setting-staleSeconds','120');await admin.fill('#setting-backlogWarning','50');await admin.fill('#setting-reason','059 restore thresholds');
await admin.getByRole('button',{name:'บันทึกร่าง'}).click();await admin.getByText(/บันทึกร่างแล้ว/).waitFor({timeout:30000});
const d2=await newest(admin,'notifications');await row(admin,d2.version).getByRole('button',{name:'ทดสอบร่าง',exact:true}).click();await admin.getByText(/ทดสอบร่างแล้ว/).waitFor({timeout:30000});
await row(admin,d2.version).getByRole('button',{name:'เปิดใช้',exact:true}).click();await until(async()=>(await api(admin,'/api/settings')).data.active.notifications?.staleSeconds===120);
rec('notifications: restored (versioned, audited)',(await api(admin,'/api/settings')).data.active.notifications.staleSeconds===120);

// ── 3. report_output (GENERAL): invalid template refused, valid saved/activated ──
const badTpl=await api(admin,'/api/settings',{operation:'propose',key:'report_output',value:{downloadNameTemplate:'{patientName}.pdf'},reason:'template probe'});
{const bv=await api(admin,'/api/settings',{operation:'validate',id:badTpl.data.id,key:'report_output'});
 const st=(await api(admin,'/api/settings')).data.revisions.find(r=>r.id===badTpl.data.id);
 const act=await api(admin,'/api/settings',{operation:'activate',id:badTpl.data.id,key:'report_output'});
 rec('report_output: template without {hisLn}/{sampleId} fails its test, stays Draft, and activation is refused',st.state==='Draft'&&st.test_passed===false&&act.status>=400,{validate:bv.status,state:st.state,tested:st.test_passed,activate:act.status});}
const dr=await api(admin,'/api/settings',{operation:'propose',key:'report_output',value:{downloadNameTemplate:'{hisLn}_{patientName}_UAT'},reason:'059 template round-trip'});
rec('report_output: draft with required {hisLn}/{sampleId} placeholder accepted',dr.status===200,{s:dr.status,badStatus:badTpl.status,bad:badTpl.data?.error});
if(dr.status===200){const id=dr.data.id;const v=await api(admin,'/api/settings',{operation:'validate',id,key:'report_output'});
 rec('report_output: test passes for a valid template; invalid template cannot be validated',v.status===200,{validate:v.status});
 await api(admin,'/api/settings',{operation:'activate',id,key:'report_output'});
 const a=(await api(admin,'/api/settings')).data.active.report_output;rec('report_output: activated value is what was typed',a?.downloadNameTemplate==='{hisLn}_{patientName}_UAT',a);
 // restore default template through the same flow
 const r2=await api(admin,'/api/settings',{operation:'propose',key:'report_output',value:{downloadNameTemplate:'{hisLn}_{patientName}_Chonburi hospital'},reason:'059 restore template'});
 await api(admin,'/api/settings',{operation:'validate',id:r2.data.id,key:'report_output'});await api(admin,'/api/settings',{operation:'activate',id:r2.data.id,key:'report_output'});
 rec('report_output: restored',(await api(admin,'/api/settings')).data.active.report_output.downloadNameTemplate.endsWith('Chonburi hospital'));}

await browser.close();
writeFileSync(path.join(OUT,'functional.json'),JSON.stringify(log,null,2));
const fails=log.filter(l=>!l.ok);console.log(`DONE total=${log.length} fail=${fails.length}`);process.exit(fails.length?1:0);
