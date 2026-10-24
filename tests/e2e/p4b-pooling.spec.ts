import {test,expect,type Page} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {Client} from 'pg';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {browserFixtureDatabaseUrl} from '../helpers/browser-database';
import {poolingFixture} from '../helpers/pooling';
import {docDeps} from '../helpers/lab';
import type {Principal} from '../../packages/security/policy';
test.beforeEach(async({context})=>context.setExtraHTTPHeaders({'x-real-ip':'synthetic-p4b-'+randomUUID()}));
async function login(page:Page,name='synthetic.lab'){
 await page.goto('/login');await page.getByLabel('ชื่อผู้ใช้',{exact:true}).fill(name);await page.getByLabel('รหัสผ่าน',{exact:true}).fill(readFileSync(process.env.SYNTHETIC_SEED_PASSWORD_FILE??'data/secrets/seed-password','utf8').trim());await page.getByRole('button',{name:'เข้าสู่ระบบ',exact:true}).click();await expect(page).toHaveURL(/\/$/);
}
async function fixture(){
 const db=new Client({connectionString:browserFixtureDatabaseUrl()});await db.connect();const docs=await docDeps();
 try{
  const p=async(name:string,role:Principal['roles'][number]):Promise<Principal>=>({id:(await db.query<{id:string}>('SELECT id FROM app_user WHERE username=$1',[name])).rows[0].id,roles:[role],permissions:[],unitIds:[]});
  const staff=await p('synthetic.lab','LAB_STAFF'),certifier=await p('synthetic.certifier','LAB_CERTIFIER'),approver=await p('synthetic.approver','CLINICAL_APPROVER');
  const unit=(await db.query<{id:string}>("SELECT id FROM unit WHERE code='SYNTHETIC_ANC'")).rows[0].id;
  await db.query("UPDATE lab_batch SET state='Cancelled',cancelled_by=$1,cancelled_at=now(),cancel_reason='SYNTHETIC P4b browser isolation' WHERE state='Draft'",[staff.id]);
  return await poolingFixture(db,{staff,certifier,approver,unit},docs.deps);
 }finally{await db.end();await docs.close();}
}
const axe=async(page:Page)=>expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']).analyze()).violations).toEqual([]);
for(const width of [375,768,1280,1440])test(`P4b pooling accessible at ${width}px; default clinical HOLD`,async({page})=>{
 const f=await fixture();await page.setViewportSize({width,height:1000});await login(page);await page.goto(`/lab/batches/${f.batchId}/pooling`);
 await expect(page.getByRole('heading',{name:'Pooling / QC2 / F4',exact:true})).toBeVisible();await expect(page.getByText(/Acceptance: HOLD/)).toBeVisible();
 await expect(page.getByRole('form',{name:'สร้าง Pool จำลอง'})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await axe(page);
});
test('P4b browser journey: blind check → preview → F4 simulation → verified QC2 → immutable snapshot, acceptance blocked',async({page,browser})=>{
 test.setTimeout(180000);const f=await fixture(),url=`/lab/batches/${f.batchId}/pooling`;await login(page);await page.goto(url);
 await page.getByRole('form',{name:'สร้าง Pool จำลอง'}).getByLabel('เหตุผล',{exact:true}).fill('จำลอง browser pooling workflow');await page.getByRole('button',{name:'สร้าง Pool จำลองจาก QC1 Verified'}).click();
 await expect(page.getByRole('heading',{name:/Pool attempt 1 · DRAFT/})).toBeVisible();
 await expect(page.getByRole('button',{name:'สร้าง F4 Pre-work จำลอง'})).toHaveCount(0);
 for(const slot of [2,3])await page.getByLabel('ค่าคำนวณมือ ตำแหน่ง '+slot).fill('128');await page.getByRole('button',{name:'ส่งผลคำนวณมือ'}).click();
 for(const width of [375,768,1280,1440]){await page.setViewportSize({width,height:1000});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await axe(page);}
 await expect(page.getByRole('button',{name:'Preview ก่อนออก Pre-work'})).toBeVisible();await page.getByRole('button',{name:'Preview ก่อนออก Pre-work'}).click();
 const dialog=page.getByRole('dialog',{name:'Preview F4 — แบบจำลอง ห้ามใช้จริง'});await expect(dialog).toBeVisible();await expect(dialog.getByTitle('F4 PDF')).toBeVisible();await dialog.getByRole('button',{name:'ปิด',exact:true}).click();
 await page.getByRole('button',{name:'สร้าง F4 Pre-work จำลอง'}).click();await expect(page.getByRole('heading',{name:/· PRE_WORK/})).toBeVisible();
 await page.getByRole('button',{name:'เริ่มปฏิบัติจำลอง'}).click();await expect(page.getByRole('heading',{name:/· IN_EXECUTION/})).toBeVisible();
 const form=page.getByRole('form',{name:'บันทึกหลักฐาน Pool'});
 const record=async(field:string,value?:string,slot?:number)=>{
  await form.getByRole('combobox',{name:'ฟิลด์',exact:true}).selectOption(field);if(value)await form.getByLabel('ค่าที่วัด / ปริมาตรจริง').fill(value);if(slot)await form.getByRole('combobox',{name:'ตำแหน่ง (เฉพาะ Transfer)',exact:true}).selectOption(String(slot));
  const response=page.waitForResponse(r=>r.url().endsWith('/api/p4b/batches/'+f.batchId)&&r.request().method()==='POST');await form.getByRole('button',{name:'บันทึกหลักฐาน',exact:true}).click();expect((await response).status()).toBe(200);await expect(form.getByRole('button',{name:'บันทึกหลักฐาน',exact:true})).toBeEnabled();await expect(page.locator('[role="status"]:not([popover])')).toContainText('บันทึกข้อมูลสังเคราะห์แล้ว');
 };
 await record('TRANSFER',undefined,2);await record('TRANSFER',undefined,3);await record('BUFFER','512');await page.getByRole('button',{name:'จบปฏิบัติจำลอง'}).click();await expect(page.getByRole('heading',{name:/· QC2/})).toBeVisible();
 for(const field of ['QC2','STD1','STD2'])await record(field,'3.3');
 const context=await browser.newContext({baseURL:process.env.E2E_BASE_URL??'http://127.0.0.1:3000',extraHTTPHeaders:{'x-real-ip':'synthetic-p4b-review-'+randomUUID()}});
 try{const reviewer=await context.newPage();await login(reviewer,'synthetic.certifier');await reviewer.goto(url);
  for(const label of ['TRANSFER 2','TRANSFER 3','BUFFER','QC2','STD1','STD2']){await reviewer.getByRole('button',{name:'ยืนยัน '+label,exact:true}).click();await expect(reviewer.getByRole('button',{name:'ยืนยัน '+label,exact:true})).toHaveCount(0);}
  await reviewer.getByRole('button',{name:'SyntheticReviewed',exact:true}).click();await expect(reviewer.locator('[role="status"]:not([popover])')).toContainText('บันทึกข้อมูลสังเคราะห์แล้ว');
  const me=await (await reviewer.request.get('/api/me')).json(),w=await (await reviewer.request.get(`/api/p4b/batches/${f.batchId}`)).json();
  for(const action of ['accept','export','issueOperational']){const r=await reviewer.request.post(`/api/p4b/batches/${f.batchId}`,{headers:{origin:process.env.APP_ORIGIN??'http://127.0.0.1:3000','x-csrf-token':me.csrf},data:{action,poolId:w.current.id,expectedVersion:w.version}});expect(r.status()).toBe(423);expect((await r.json()).code).toBe('OWNER_DECISIONS_HOLD');}
 }finally{await context.close();}
 await page.reload();await page.getByRole('button',{name:'Preview ก่อนออก Completed'}).click();await expect(dialog).toBeVisible();await dialog.getByRole('button',{name:'ปิด',exact:true}).click();await page.getByRole('button',{name:'สร้าง F4 Completed จำลอง'}).click();
 await expect(page.getByRole('heading',{name:/· SYNTHETIC_COMPLETED/})).toBeVisible();await expect(page.getByRole('button',{name:'Preview COMPLETED',exact:true})).toBeVisible();await axe(page);
 const db=new Client({connectionString:browserFixtureDatabaseUrl()});await db.connect();try{const snapshot=(await db.query<{payload:{acceptance:string;exportAllowed:boolean}}>('SELECT s.payload FROM p4b_pool_snapshot s JOIN p4b_pool_attempt p ON p.id=s.pool_id WHERE p.batch_id=$1',[f.batchId])).rows[0];expect(snapshot.payload).toMatchObject({acceptance:'HOLD',exportAllowed:false});}finally{await db.end();}
});
test('P4b ANC cannot see workflow, auditor is read-only and anonymous document read is rejected',async({page})=>{
 const f=await fixture();await login(page,'synthetic.auditor');await page.goto(`/lab/batches/${f.batchId}/pooling`);await expect(page.getByRole('form',{name:'สร้าง Pool จำลอง'})).toHaveCount(0);
 const me=await (await page.request.get('/api/me')).json();const r=await page.request.post(`/api/p4b/batches/${f.batchId}`,{headers:{origin:process.env.APP_ORIGIN??'http://127.0.0.1:3000','x-csrf-token':me.csrf},data:{action:'create',expectedVersion:0,scenario:{controls:'PATIENT_ONLY',targetPmol:'16',ngPerPmol:'160',desiredVolume:'768',buffer:'TE',pipetteDecimals:2},reason:'จำลอง Auditor write denied'}});expect(r.status()).toBe(403);
 await page.context().clearCookies();expect((await page.request.get('/api/p4b/documents/'+randomUUID())).status()).toBe(401);
 await login(page,'synthetic.anc');expect((await page.request.get(`/api/p4b/batches/${f.batchId}`)).status()).toBe(403);
});
