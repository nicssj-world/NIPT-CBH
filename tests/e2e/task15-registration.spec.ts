import {test,expect,type Page} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {Pool} from 'pg';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {browserFixtureDatabaseUrl} from '../helpers/browser-database';
import {signInSyntheticBrowser} from '../helpers/browser-auth';
import {writePet} from '../helpers/inbound';
import {FileStore} from '../../packages/storage';
import {runInboundCycle} from '../../packages/inbound/cycle';
import {registerP2} from '../../packages/p2/service';
import type {Principal} from '../../packages/security/policy';

const output=path.resolve('.local/integration-evidence/task15-browser'),suffix=String(Date.now()).slice(-5),ln=(n:number)=>`99000${suffix}${String(n).padStart(2,'0')}`,hn=(n:number)=>`9900${suffix}${String(n).padStart(2,'0')}`;
const values={ln:ln(1),hn:hn(1),multi:[ln(2),ln(3)],multiHn:hn(2),noOk:ln(4),conflict:ln(6),anc:ln(7),ancHn:hn(7)};
const day=new Date(Date.now()+7*3600000).toISOString().slice(0,10).replaceAll('-',''),receivedAt=day+'080910';let unit='';
const query=async(sql:string,params:unknown[]=[])=>{const db=new Pool({connectionString:browserFixtureDatabaseUrl()});try{return await db.query(sql,params);}finally{await db.end();}};
async function post(page:Page,body:unknown){const me=await page.request.get('/api/me'),profile=await me.json();return page.request.post('/api/p2/pet-registration',{headers:{origin:new URL(process.env.E2E_BASE_URL!).origin,'x-csrf-token':profile.csrf},data:body});}
async function open(page:Page){await page.goto('/cases');await page.getByRole('button',{name:'ลงทะเบียนโดย Lab',exact:true}).click();await page.getByRole('button',{name:'ลงทะเบียนตัวอย่างเพื่อตรวจตามระบบ',exact:true}).click();}
async function lookup(page:Page,kind:'LN HIS'|'HN',value:string){await open(page);await page.getByLabel(kind,{exact:true}).fill(value);await page.getByRole('button',{name:'ค้นหาข้อมูลจาก HIS',exact:true}).click();}
async function capture(page:Page,name:string){await mkdir(output,{recursive:true});await page.screenshot({path:path.join(output,name+'.png'),fullPage:true,animations:'disabled'});}
async function closeRegistration(page:Page){await page.getByRole('button',{name:'ปิด',exact:true}).click();const discard=page.getByRole('button',{name:'ทิ้งการเปลี่ยนแปลงและปิด',exact:true});if(await discard.isVisible())await discard.click();await expect(page.getByRole('dialog')).toHaveCount(0);}
test.beforeAll(async()=>{
 const url=browserFixtureDatabaseUrl();expect(new URL(url).port).toBe('20029');expect(new URL(url).pathname).toBe('/nipt_synthetic_p2_browser_integration');
 await mkdir(output,{recursive:true});const db=new Pool({connectionString:url}),key=await readFile(process.env.IDENTITY_LOOKUP_KEY_FILE!),store=new FileStore(process.env.FILE_STORE_ROOT!),root=process.env.SIMULATOR_ROOT!;
 try{
  unit=(await db.query("SELECT id FROM unit WHERE code='SYNTHETIC_ANC'")).rows[0].id;
  const lab=(await db.query("SELECT id FROM app_user WHERE username='synthetic.lab'")).rows[0];const user:Principal={id:lab.id,roles:['LAB_STAFF'],unitIds:[],permissions:[]};
  const client=await db.connect();try{await client.query('BEGIN');await registerP2(client,user,{ln:values.conflict,hn:hn(99),unitId:unit,origin:'LAB_DIRECT',identifierSource:'TUBE_LABEL',idempotencyKey:randomUUID()},key,{store});await client.query('COMMIT');}finally{client.release();}
  for(const [n,h,ok] of [[1,1,true],[2,2,true],[3,2,true],[4,4,false],[6,6,true]] as const)await writePet(root,day,{ln:ln(n),hn:hn(h),name:'SYNTHETIC^^นาง จำลอง Task15',receivedAt,ward:'SYNTHETIC-PET-WARD'}, {ok});
  await runInboundCycle(db,{root,store,lookupKey:key},{trigger:'MANUAL',lookbackDays:3,intervalSeconds:30});
  await writeFile(path.join(output,'fixtures.json'),JSON.stringify({values,unit,day,receivedAt},null,2));
 }finally{await db.end();}
});
test.beforeEach(async({context})=>{await context.setExtraHTTPHeaders({'x-real-ip':'synthetic-task15-'+randomUUID()});});

test('LN-only: PET autofill, paper marker, automatic LN Halos, later clinical edit, refresh and Storage deep link',async({page})=>{
 await signInSyntheticBrowser(page,'synthetic.lab');await lookup(page,'LN HIS',values.ln);
 const facts=page.getByRole('region',{name:'ข้อมูลยืนยันจาก HIS PET'});await expect(facts).toContainText(values.hn);await expect(facts).toContainText('SYNTHETIC-PET-WARD');await expect(page.getByRole('combobox')).toHaveCount(0);
 await page.getByRole('radio',{name:'Paper Consent',exact:true}).check();const saved=page.waitForResponse(r=>r.url().endsWith('/api/p2/pet-registration')&&r.request().postDataJSON()?.action==='register');await page.getByRole('button',{name:'ลงทะเบียนตัวอย่าง',exact:true}).click();expect((await saved).status()).toBe(200);await expect(page).toHaveURL(/\/cases\/[a-f0-9-]+$/);
 const caseId=page.url().split('/').at(-1)!;await expect(page.getByRole('region',{name:'ข้อมูลจาก HIS'})).toContainText('SYNTHETIC-PET-WARD');await expect(page.getByRole('region',{name:'ข้อมูลจาก HIS'})).not.toContainText('รอหลักฐานรับจาก HIS');
 await page.getByRole('button',{name:'กรอกข้อมูลทางคลินิกภายหลัง',exact:true}).click();await page.getByLabel('วันกำหนดคลอด',{exact:false}).fill('18/03/2570');await page.getByRole('radiogroup',{name:'ประเภทครรภ์',exact:false}).locator('input[value="Singleton"]').check();await page.getByRole('button',{name:'บันทึก',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);await page.reload();
 const metadata=(await query('SELECT w.draft,w.consent_mode,(SELECT count(*) FROM p2_consent_signature s JOIN p2_document_revision d ON d.id=s.document_id WHERE d.case_id=w.case_id)::int signatures FROM p2_workspace w WHERE w.case_id=$1',[caseId])).rows[0];expect(metadata.draft.pregnancy.type).toBe('Singleton');expect(metadata.consent_mode).toBe('Paper');expect(metadata.signatures).toBe(0);
 await capture(page,'lab-detail');await page.goto('/sample-storage');await page.getByLabel('ค้นหา LN / HN / LN Halos / Box ID').fill(values.ln);await expect(page.locator('[aria-label="รายการตัวอย่างค้นหา"]')).toContainText(values.ln);await capture(page,'registration-storage-association');
});
test('HN-only explicit LN selection; Electronic consent and concurrent retry preserve one case/number',async({page})=>{
 await signInSyntheticBrowser(page,'synthetic.admin');await lookup(page,'HN',values.multiHn);await expect(page.getByRole('group',{name:'พบหลาย LN — เลือกรายการตรวจที่ถูกต้อง'})).toBeVisible();await expect(page.getByRole('region',{name:'ข้อมูลยืนยันจาก HIS PET'})).toHaveCount(0);
 const missing=await post(page,{action:'register',hn:values.multiHn,unitId:unit,consentMode:'Electronic',idempotencyKey:randomUUID()});expect(missing.status()).toBe(409);expect((await missing.json()).code).toBe('PET_SELECTION_REQUIRED');
 await page.getByRole('radio',{name:new RegExp('LN '+values.multi[1])}).check();await page.getByRole('radio',{name:'Electronic Consent',exact:true}).check();const saved=page.waitForResponse(r=>r.url().endsWith('/api/p2/pet-registration')&&r.request().postDataJSON()?.action==='register');await page.getByRole('button',{name:'ลงทะเบียนตัวอย่าง',exact:true}).click();const result=await (await saved).json();await expect(page).toHaveURL(/\/cases\/[a-f0-9-]+$/);
 const found=await (await post(page,{action:'lookup',hn:values.multiHn})).json(),fileId=found.candidates.find((p:{ln:string})=>p.ln===values.multi[1]).fileId,key=randomUUID(),body={action:'register',hn:values.multiHn,fileId,unitId:unit,consentMode:'Electronic',idempotencyKey:key};
 // CSRF is read once so the two real authenticated requests race only at registration.
 const me=await (await page.request.get('/api/me')).json(),headers={origin:new URL(process.env.E2E_BASE_URL!).origin,'x-csrf-token':me.csrf};const retries=await Promise.all([page.request.post('/api/p2/pet-registration',{headers,data:body}),page.request.post('/api/p2/pet-registration',{headers,data:body})]);expect(retries.map(r=>r.status())).toEqual([200,200]);
 const counts=(await query('SELECT (SELECT count(*) FROM case_ln WHERE ln=$1)::int cases,(SELECT count(*) FROM specimen_lab_number WHERE case_id=$2)::int numbers,(SELECT consent_mode FROM p2_workspace WHERE case_id=$2) consent',[values.multi[1],result.caseId])).rows[0];expect(counts).toEqual({cases:1,numbers:1,consent:'Electronic'});await capture(page,'hn-selected-electronic');
});
test('missing OK, absent PET, identity conflict and ANC unauthorized lookup fail closed',async({page})=>{
 await signInSyntheticBrowser(page,'synthetic.lab');for(const number of [values.noOk,ln(5)]){await lookup(page,'LN HIS',number);await expect(page.getByRole('status').filter({hasText:'ยังไม่พบ PET'})).toBeVisible();await expect(page.getByRole('button',{name:'ลงทะเบียนตัวอย่าง',exact:true})).toHaveCount(0);await closeRegistration(page);}
 const conflict=await post(page,{action:'lookup',ln:values.conflict});expect(conflict.status()).toBe(409);const blocked=await conflict.json();expect(blocked.code).toBe('PET_IDENTITY_CONFLICT');expect(JSON.stringify(blocked)).not.toContain('SYNTHETIC-PET-WARD');
 await signInSyntheticBrowser(page,'synthetic.anc');const denied=await post(page,{action:'lookup',hn:values.hn});expect(denied.status()).toBe(403);expect((await query('SELECT count(*)::int n FROM case_ln WHERE ln=ANY($1)',[[values.noOk,ln(5)]])).rows[0].n).toBe(0);
});
test('ANC pre-PET registration and Paper Consent preserve Request; arrival fills HIS Ward without a department selector',async({page})=>{
 await signInSyntheticBrowser(page,'synthetic.anc');await page.goto('/cases');await page.getByRole('button',{name:'ลงทะเบียน ANC',exact:true}).click();await expect(page.getByRole('dialog').getByRole('combobox')).toHaveCount(0);await page.getByLabel('LN HIS จำลอง',{exact:false}).fill(values.anc);await page.getByLabel('HN จำลอง',{exact:false}).fill(values.ancHn);await page.getByRole('button',{name:'ตรวจข้อมูลก่อนลงทะเบียน',exact:true}).click();await expect(page.getByRole('dialog')).toContainText('รอข้อมูลจาก HIS');await page.getByRole('button',{name:'ยืนยันลงทะเบียน',exact:true}).click();await expect(page).toHaveURL(/\/cases\/[a-f0-9-]+$/);const caseId=page.url().split('/').at(-1)!;await expect(page.getByRole('region',{name:'ข้อมูลจาก HIS'})).toContainText('รอข้อมูลจาก HIS');
 await page.getByRole('button',{name:'ใช้ Paper Consent',exact:true}).click();await expect(page.locator('main')).toContainText('ไม่ใช่หลักฐานการลงนาม');await page.getByRole('button',{name:'กรอกข้อมูลทางคลินิกภายหลัง',exact:true}).click();await expect(page.getByRole('dialog')).toBeVisible();await page.getByRole('button',{name:'ปิด',exact:true}).click();
 const db=new Pool({connectionString:browserFixtureDatabaseUrl()});try{await writePet(process.env.SIMULATOR_ROOT!,day,{ln:values.anc,hn:values.ancHn,receivedAt,ward:'SYNTHETIC-ANC-HIS-WARD'});await runInboundCycle(db,{root:process.env.SIMULATOR_ROOT!,store:new FileStore(process.env.FILE_STORE_ROOT!),lookupKey:await readFile(process.env.IDENTITY_LOOKUP_KEY_FILE!)},{trigger:'MANUAL',lookbackDays:3,intervalSeconds:30});}finally{await db.end();}
 await page.reload();await expect(page.getByRole('region',{name:'ข้อมูลจาก HIS'})).toContainText('SYNTHETIC-ANC-HIS-WARD');expect((await query('SELECT count(*)::int n FROM case_ln WHERE ln=$1',[values.anc])).rows[0].n).toBe(1);await capture(page,'anc-pet-arrival');await writeFile(path.join(output,'anc-case.json'),JSON.stringify({caseId,ln:values.anc,ward:'SYNTHETIC-ANC-HIS-WARD'}));
});
test('registration keyboard, responsive layout and light/dark accessibility at all required widths',async({page})=>{
 await signInSyntheticBrowser(page,'synthetic.lab');const checks=[];
 for(const width of [1440,1280,768,375])for(const dark of [false,true]){await page.setViewportSize({width,height:1000});await lookup(page,'HN',values.multiHn);await page.getByRole('radio',{name:new RegExp('LN '+values.multi[0])}).focus();await page.keyboard.press('Space');await expect(page.getByRole('region',{name:'ข้อมูลยืนยันจาก HIS PET'})).toBeVisible();const active=await page.evaluate(()=>document.documentElement.dataset.theme==='dark');if(active!==dark)await page.getByRole('button',{name:/เปลี่ยนเป็นธีม/}).click();await page.getByRole('radio',{name:'Paper Consent',exact:true}).focus();await page.keyboard.press('Space');const axe=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']).analyze();expect(axe.violations).toEqual([]);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await capture(page,`registration-${width}-${dark?'dark':'light'}`);checks.push({width,dark,axeViolations:axe.violations.length});await closeRegistration(page);}
 await writeFile(path.join(output,'responsive.json'),JSON.stringify(checks,null,2));
});
