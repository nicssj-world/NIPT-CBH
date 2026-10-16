/** Persistent Combined Preview only. All mutations use the authenticated browser UI/API. */
import {execFileSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import {chromium,expect,type BrowserContext,type Page} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const origin='https://127.0.0.1:19448';
const repo=process.cwd();
if(path.basename(repo)!=='NIPT-CBH-INTEGRATED-UAT')throw Error('INTEGRATED_WORKTREE_REQUIRED');
const base=path.resolve('.local/integrated-admin');
const runId=new Date().toISOString().replace(/\D/g,'')+'-'+randomBytes(4).toString('hex');
const screenshots:string[]=[],events:{name:string;at:string;detail?:unknown}[]=[],pageErrors:string[]=[],blockedOrigins=new Set<string>();
const event=(name:string,detail?:unknown)=>events.push({name,at:new Date().toISOString(),...(detail===undefined?{}:{detail})});
const sourceHead=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8',windowsHide:true}).trim();
const unitCode='IUAT-'+runId,unitName='Integrated Admin UAT '+runId,username='iuat.'+runId;
let browser:Awaited<ReturnType<typeof chromium.launch>>|undefined,admin:Page|undefined,originalName:string|undefined;
let identityMayHaveChanged=false,restored=false,passed=false,failure:string|undefined;
let phase='INITIALIZE';
await fs.mkdir(path.join(base,runId),{recursive:true});
async function context():Promise<BrowserContext>{
 const ctx=await browser!.newContext({ignoreHTTPSErrors:true,serviceWorkers:'block'});
 await ctx.route('**/*',async route=>{const target=new URL(route.request().url());if(target.origin===origin)await route.continue();else{blockedOrigins.add(target.origin);await route.abort('blockedbyclient');}});
 ctx.on('page',page=>page.on('pageerror',()=>pageErrors.push('PAGE_ERROR:'+new URL(page.url()).pathname)));
 return ctx;
}
async function login(page:Page,name:string,password:string){
 await page.goto(origin+'/login');await page.getByLabel('ชื่อผู้ใช้').fill(name);await page.getByLabel('รหัสผ่าน',{exact:true}).fill(password);
 await page.getByRole('button',{name:'เข้าสู่ระบบ',exact:true}).click();await expect(page).not.toHaveURL(/\/login(?:\?.*)?$/);
 const me=await page.evaluate(async()=>{const r=await fetch('/api/me');return {status:r.status,data:await r.json()};});
 expect(me.status).toBe(200);return me.data as {id:string;roles:string[]};
}
async function get(page:Page,route:string){return page.evaluate(async route=>{const r=await fetch(route,{cache:'no-store'});return {status:r.status,data:await r.json()};},route);}
async function post(page:Page,route:string,input:unknown,csrf=true){return page.evaluate(async({route,input,csrf})=>{
 const me=await fetch('/api/me').then(r=>r.json());const r=await fetch(route,{method:'POST',headers:{'Content-Type':'application/json',...(csrf?{'x-csrf-token':me.csrf}:{})},body:JSON.stringify(input)});
 return {status:r.status,data:await r.json()};
},{route,input,csrf});}
async function uiCommand(page:Page,api:string,operation:string,click:()=>Promise<void>){
 const response=page.waitForResponse(r=>r.url()===origin+api&&r.request().method()==='POST'&&(r.request().postDataJSON() as {operation?:string}).operation===operation);
 await click();const result=await response;expect(result.status()).toBe(200);return result.json();
}
async function identity(name:string,reason:string){
 const page=admin!;await page.goto(origin+'/settings?key=general');await page.getByLabel(/^ชื่อระบบ/).fill(name);await page.getByLabel('เหตุผลที่เปลี่ยน').fill(reason);
 const draft=await uiCommand(page,'/api/settings','propose',()=>page.getByRole('button',{name:'บันทึกร่าง',exact:true}).click());
 // Scope by the new revision ID via API metadata, then its UI version; never act on another pending draft.
 const settings=await get(page,'/api/settings');expect(settings.status).toBe(200);
 const revision=(settings.data.revisions as {id:string;version:number}[]).find(r=>r.id===draft.id);if(!revision)throw Error('NEW_GENERAL_REVISION_NOT_FOUND');
 const row=page.locator('li').filter({has:page.getByText('รุ่น '+revision.version,{exact:true})});
 await uiCommand(page,'/api/settings','validate',()=>row.getByRole('button',{name:'ทดสอบร่าง',exact:true}).click());
 await uiCommand(page,'/api/settings','activate',()=>row.getByRole('button',{name:'เปิดใช้',exact:true}).click());
 await page.reload();await expect(page.locator('.brand')).toHaveText(name);
 const active=await get(page,'/api/settings');expect(active.data.active.general.systemName).toBe(name);
 event('GENERAL_DRAFT_VALIDATE_ACTIVATE_RUNTIME',{revisionId:draft.id,restoration:name===originalName});
}
try{
 phase='ACCOUNT_FILE';
 const accounts=JSON.parse(await fs.readFile(path.resolve('.local/integrated-owner-uat/secrets/uat-accounts.json'),'utf8')) as {username:string;password:string;role:string}[];
 const required=[['uat.admin','APP_ADMIN'],['uat.lab','LAB_STAFF'],['uat.certifier','LAB_CERTIFIER'],['uat.clinical-approver','CLINICAL_APPROVER'],['uat.auditor','AUDITOR'],['uat.anc','ANC_NURSE']];
 if(accounts.length!==6||required.some(([name,role])=>!accounts.some(a=>a.username===name&&a.role===role&&typeof a.password==='string'&&a.password.length>=10)))throw Error('EXPECTED_SIX_ISOLATED_UAT_ACCOUNTS');
 browser=await chromium.launch({headless:true});
 const pages=new Map<string,Page>();
 phase='SIX_ROLE_LOGINS_AND_RBAC';
 for(const [name,role] of required){
  const account=accounts.find(a=>a.username===name)!;const page=await (await context()).newPage();pages.set(name,page);
  const me=await login(page,name,account.password);expect(me.roles).toEqual([role]);await expect(page).not.toHaveURL(/\/password$/);
  event('ROLE_LOGIN',{username:name,role});
  if(role!=='APP_ADMIN'){
   expect((await post(page,'/api/admin',{operation:'saveUnit',code:'DENIED-'+runId,name:'RBAC denial',active:true})).status).toBe(403);
   expect((await post(page,'/api/settings',{operation:'propose',key:'general',value:{systemName:'Denied',timezone:'Asia/Bangkok'},reason:'RBAC denial'})).status).toBe(403);
   event('SERVER_RBAC_DENIED',{role,operations:['saveUnit','general.propose']});
  }
 }
 admin=pages.get('uat.admin')!;const checker=pages.get('uat.clinical-approver')!;
 expect((await post(admin,'/api/admin',{operation:'saveUnit',code:'CSRF-'+runId,name:'CSRF denial',active:true},false)).status).toBe(403);event('CSRF_DENIED');
 phase='CREATE_UNIT_AND_USER';
 await admin.goto(origin+'/settings/units');await admin.getByRole('button',{name:'เพิ่มหน่วยงาน',exact:true}).click();await admin.getByLabel('รหัสหน่วยงาน').fill(unitCode);await admin.getByLabel(/^ชื่อหน่วยงาน/).fill(unitName);
 const unit=await uiCommand(admin,'/api/admin','saveUnit',()=>admin!.getByRole('button',{name:'บันทึกข้อมูล',exact:true}).click());event('UNIT_CREATE',{id:unit.id,code:unitCode});
 await admin.goto(origin+'/settings/users');await admin.getByRole('button',{name:'เพิ่มผู้ใช้',exact:true}).click();await admin.getByLabel('ชื่อ-นามสกุล').fill('Integrated UAT '+runId);await admin.getByLabel(/^Username/).fill(username);
 const temporaryPassword=randomBytes(32).toString('base64url');await admin.getByLabel('รหัสผ่านเริ่มต้น').fill(temporaryPassword);
 const user=await uiCommand(admin,'/api/admin','createUser',()=>admin!.getByRole('button',{name:'บันทึกข้อมูล',exact:true}).click());event('USER_CREATE',{id:user.id,username});
 await admin.getByLabel('ค้นหาชื่อ / Username').fill(username);
 await admin.getByRole('row').filter({hasText:username}).getByRole('button',{name:'รายละเอียด / แก้ไข'}).click();await admin.getByLabel('LAB_STAFF',{exact:true}).check();await admin.getByLabel(unitCode+' · '+unitName,{exact:true}).check();await admin.getByLabel(/^เหตุผลเปลี่ยนสิทธิ์/).fill('Combined Preview admin UAT '+runId);
 phase='INDEPENDENT_ROLE_APPROVAL';
 const request=await uiCommand(admin,'/api/admin','requestAccess',()=>admin!.getByRole('button',{name:'ส่งคำขอเปลี่ยนสิทธิ์',exact:true}).click());event('ACCESS_REQUEST',{id:request.id});
 expect((await post(admin,'/api/admin',{operation:'approveAccess',id:request.id})).status).toBe(403);event('MAKER_SELF_APPROVAL_DENIED');
 await checker.goto(origin+'/settings/users');const pending=checker.locator('article').filter({hasText:username});await expect(pending).toContainText(request.id);
 await uiCommand(checker,'/api/admin','approveAccess',()=>pending.getByRole('button',{name:'อนุมัติสิทธิ์',exact:true}).click());event('INDEPENDENT_APPROVAL',{requestId:request.id});
 phase='FORCED_PASSWORD_CHANGE';
 const fresh=await (await context()).newPage();const me=await login(fresh,username,temporaryPassword);expect(me.roles).toEqual(['LAB_STAFF']);await expect(fresh).toHaveURL(/\/password$/);
 expect((await get(fresh,'/api/admin')).status).toBe(403);
 await fresh.getByLabel('รหัสผ่านปัจจุบัน').fill(temporaryPassword);const nextPassword=randomBytes(32).toString('base64url');await fresh.getByLabel(/^รหัสผ่านใหม่/).fill(nextPassword);await fresh.getByLabel('ยืนยันรหัสผ่านใหม่').fill(nextPassword);
 await fresh.getByRole('button',{name:'เปลี่ยนรหัสผ่าน',exact:true}).click();await expect(fresh.getByRole('status')).toContainText('เปลี่ยนรหัสผ่านแล้ว');expect((await get(fresh,'/api/me')).status).toBe(401);event('PASSWORD_ROTATION_OLD_SESSION_REJECTED');
 await login(fresh,username,nextPassword);expect((await get(fresh,'/api/admin')).status).toBe(403);event('FRESH_LAB_STAFF_LOGIN_SERVER_ADMIN_DENIED');
 phase='GENERAL_RUNTIME_SETTING';
 await admin.goto(origin+'/settings?key=general');await expect(admin.getByLabel(/^ชื่อระบบ/)).toBeVisible();originalName=await admin.getByLabel(/^ชื่อระบบ/).inputValue();identityMayHaveChanged=true;
 await identity('NIPT Combined UAT '+runId,'Combined Preview runtime identity verification '+runId);
 await identity(originalName,'Restore normal system identity after Combined Preview UAT '+runId);restored=true;
 phase='HEALTH_AND_AUDIT';
 const health=await get(admin,'/api/health');expect(health.status).toBe(200);expect(health.data.mode).toBe('operational');
 await admin.goto(origin+'/health');const worker=admin.locator('dt').filter({hasText:'Worker Identity / Service Alive'}).locator('xpath=following-sibling::dd[1]');await expect(worker).toHaveText('operational-worker · ALIVE');await expect(admin.locator('main')).not.toContainText('synthetic-worker');
 event('OPERATIONAL_HEALTH_BROWSER',{syntheticWorkerAbsence:'UI_SELECTED_IDENTITY_ONLY; process/database absence not observable through browser'});
 const auditor=pages.get('uat.auditor')!;await auditor.goto(origin+'/settings/audit');await expect(auditor.locator('h1')).toBeVisible();expect((await get(auditor,'/api/admin/audit')).status).toBe(200);event('AUDITOR_READ_VIEW');
 phase='RESPONSIVE_ACCESSIBILITY';
 for(const width of [375,768,1440])for(const route of ['/settings/users','/settings/units','/settings/audit','/settings','/health','/settings/backup']){
  await admin.setViewportSize({width,height:900});await admin.goto(origin+route);await expect(admin.locator('h1')).toBeVisible();
  if(route==='/settings')await expect(admin.getByLabel(/^ชื่อระบบ/)).toBeVisible();
  if(route==='/settings/users')await expect(admin.getByRole('region',{name:'รายชื่อผู้ใช้',exact:true})).toBeVisible();
  if(route==='/settings/units')await expect(admin.getByRole('region',{name:'หน่วยงาน',exact:true})).toBeVisible();
  if(route==='/settings/audit')await expect(admin.getByRole('region',{name:'เหตุการณ์ Audit',exact:true})).toBeVisible();
  await expect(admin.getByText('กำลังโหลด…',{exact:true})).toHaveCount(0);
  expect(await admin.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  const axe=await new AxeBuilder({page:admin}).withTags(['wcag2a','wcag2aa']).analyze();
  const screenshot=path.join(base,runId,route.replaceAll('/','-')+'-'+width+'.png');await admin.screenshot({path:screenshot,fullPage:true});screenshots.push(path.relative(repo,screenshot));
  event('RESPONSIVE_AXE',{route,width,violations:axe.violations.map(v=>({id:v.id,targets:v.nodes.map(n=>n.target)}))});expect(axe.violations).toHaveLength(0);
 }
 expect(pageErrors).toEqual([]);event('NO_PAGE_ERRORS');passed=true;
}catch{
 // Assertion messages may include rendered form values. Persist a safe phase marker only.
 failure='INTEGRATED_ADMIN_FAILED_AT_'+phase;process.exitCode=1;
}finally{
 if(identityMayHaveChanged&&!restored&&admin&&originalName!==undefined){try{await identity(originalName,'Restore system identity after interrupted Combined Preview UAT '+runId);restored=true;}catch{event('GENERAL_RESTORE_FAILED');failure='GENERAL_IDENTITY_RESTORE_REQUIRED';passed=false;process.exitCode=1;}}
 await browser?.close();
 const evidence={passed,runId,sourceHead,origin,database:'nipt_operational_integrated_owner_uat',publishedDatabasePort:19449,databaseTarget:'DECLARED_PREVIEW_TARGET_NOT_DIRECTLY_QUERIED',environment:'PERSISTENT_LOOPBACK_COMBINED_PREVIEW_BROWSER_ONLY',events,eventCount:events.length,screenshots,screenshotCount:screenshots.length,pageErrors,blockedOrigins:[...blockedOrigins],generalIdentityRestored:restored,created:{username,unitCode},failure,externalAcceptance:false};
 await fs.writeFile(path.join(base,runId,'evidence.json'),JSON.stringify(evidence,null,2));await fs.writeFile(path.join(base,'evidence.json'),JSON.stringify(evidence,null,2));
 process.stdout.write(JSON.stringify({passed,runId,artifact:path.join(base,'evidence.json'),eventCount:events.length,screenshotCount:screenshots.length,failure})+'\n');
}
