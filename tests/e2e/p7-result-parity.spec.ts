import {test,expect,type Page} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {readFileSync} from 'node:fs';
import {mkdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {Client} from 'pg';
import {browserFixtureDatabaseUrl} from '../helpers/browser-database';
import type {Queryable} from '../../packages/db/connection';
import {tx} from '../helpers/lab';
import {FileStore} from '../../packages/storage';
import {registerIntake,parseIntake} from '../../packages/results/intake';
import {confirmImport} from '../../packages/results/service';
import {syntheticReportPdf} from '../../tools/his-simulator/result-pdf';
import type {Principal} from '../../packages/security/policy';
const password=()=>process.env.SYNTHETIC_SEED_PASSWORD??readFileSync(process.env.SYNTHETIC_SEED_PASSWORD_FILE??'data/secrets/seed-password','utf8').trim();
async function login(page:Page,user:string){await page.goto('/login');await page.getByLabel('ชื่อผู้ใช้',{exact:true}).fill(user);await page.getByLabel('รหัสผ่าน',{exact:true}).fill(password());await page.getByRole('button',{name:'เข้าสู่ระบบ',exact:true}).click();await expect(page).toHaveURL(/\/$/);}
test.beforeEach(async({context})=>{await context.setExtraHTTPHeaders({'x-real-ip':'synthetic-p7-'+randomUUID()});});
test('P7 result filters, bounded CSV, certifier diagnostic reparse and mobile accessibility',async({page,browser})=>{
 test.setTimeout(90000);
 const db=new Client({connectionString:browserFixtureDatabaseUrl()});await db.connect();
 let id='';const suffix=randomUUID().slice(0,8),name=`SYNTHETIC-P7-${suffix}.pdf`;
 try{
  const actor=(await db.query<{id:string}>("SELECT id FROM app_user WHERE username='synthetic.lab'")).rows[0].id;
  const u={id:actor,roles:['LAB_STAFF'],unitIds:[],permissions:[]} as Principal,q=db as unknown as Queryable,store=new FileStore(process.env.FILE_STORE_ROOT??'data/files');
  const bytes=syntheticReportPdf({kind:'SINGLETON',labNumber:'000123',hn:'000000000123',collection:'10-Oct-2026',name:`SYNTHETIC P7 ${suffix}`});
  const intake=await tx(q,t=>registerIntake(t,store,{source:'UPLOAD',relativePath:null,originalName:name,actorId:actor,jobId:null},bytes));
  await tx(q,t=>parseIntake(t,store,intake,{maxBytes:10*1024*1024,acceptZip:true}));id=(await tx(q,t=>confirmImport(t,u,{intakeIds:[intake]})))[0].versionId!;
  await login(page,'synthetic.lab');
  const queryRequests:{url:string;method:string;body:Record<string,unknown>|null}[]=[];
  page.on('request',r=>{if(r.url().includes('/api/p5/results')){let body:Record<string,unknown>|null=null;try{body=r.postDataJSON();}catch{}queryRequests.push({url:r.url(),method:r.method(),body});}});
  await page.goto('/results');await expect(page.getByLabel('กรองตามวันที่')).toHaveValue('REPORTED');
  await page.getByLabel('ตั้งแต่วันที่',{exact:true}).fill('2026-10-20');await page.getByLabel('ถึงวันที่',{exact:true}).fill('2026-10-20');
  await page.getByLabel('ค้นหา HN / เลข Lab / ชื่อที่อ่านได้',{exact:true}).fill(suffix);
  await page.getByLabel('เพศตามค่าที่อ่าน',{exact:true}).selectOption('Female');await page.getByLabel('QC ตามค่าที่อ่าน',{exact:true}).selectOption('PASS');
  await page.getByLabel('ความเสี่ยงตามค่าที่อ่าน').selectOption('LOW');await page.getByRole('button',{name:'ใช้ตัวกรอง',exact:true}).click();
  const region=page.getByRole('region',{name:'รายการรายงาน',exact:true});await expect(region).toContainText(name);await expect(page.getByText(/CSV หน้านี้ \d+ \/ \d+ รายการ/)).toBeVisible(); // 5d4e45d: same page count / filtered total, shorter wording
  const [download]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'ส่งออก CSV เฉพาะหน้านี้'}).click()]);
  const stream=await download.createReadStream();const chunks:Buffer[]=[];for await(const part of stream!)chunks.push(Buffer.from(part));const csv=Buffer.concat(chunks).toString('utf8');expect(csv).toContain(id);expect(csv).toContain("'000000000123");for(const v of ['2026-10-20','Low Risk','Not Detected','12.4','PASS','SYNTHETIC_PARSED_NOT_CERTIFIED'])expect(csv).toContain(v);
  expect(queryRequests.some(r=>r.method==='POST'&&r.body?.q===suffix&&r.body?.action==='query')).toBe(true);
  expect(queryRequests.some(r=>r.method==='POST'&&r.url.endsWith('/csv')&&r.body?.q===suffix)).toBe(true);
  expect(queryRequests.every(r=>!new URL(r.url).searchParams.has('q')&&!r.url.includes(suffix))).toBe(true);expect(page.url()).not.toContain(suffix);
  await page.getByLabel('ตั้งแต่วันที่',{exact:true}).fill('1999-01-01');await page.getByLabel('ถึงวันที่',{exact:true}).fill('2000-01-01');await page.getByRole('button',{name:'ใช้ตัวกรอง',exact:true}).click();await expect(region).toContainText('ไม่มีรายการในสถานะนี้');
  await page.getByRole('button',{name:'ล้างตัวกรอง',exact:true}).click();await expect(region).toContainText(name);
  const screenDir=process.env.NIPT_E2E_SCREEN_DIR??'.local/p7/browser';await mkdir(screenDir,{recursive:true});
  for(const width of [1280,768,375]){await page.setViewportSize({width,height:812});await expect(page.getByRole('button',{name:'ใช้ตัวกรอง',exact:true})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);await page.screenshot({path:path.join(screenDir,`results-${width}.png`),fullPage:true});}
  expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']).analyze()).violations).toEqual([]);
  await page.goto(`/results/${id}`);await expect(page.getByRole('heading',{name:'อ่านต้นฉบับซ้ำเพื่อวินิจฉัย Parser'})).toHaveCount(0);
  const privateGet=await page.request.get('/api/p5/results?q=SYNTHETIC');expect(privateGet.status()).toBe(400);
  const privateCsvGet=await page.request.get('/api/p5/results/csv?q=SYNTHETIC');expect(privateCsvGet.status()).toBe(400);
  const noCsrf=await page.request.post('/api/p5/results/csv',{data:{q:'SYNTHETIC'}});expect(noCsrf.status()).toBe(403);
  const denied=await page.request.get('/api/p5/results/csv?risk=BAD');expect(denied.status()).toBe(422);expect(denied.headers()['cache-control']).toContain('no-store');
  const context=await browser.newContext({baseURL:process.env.E2E_BASE_URL??'http://127.0.0.1:3000',ignoreHTTPSErrors:process.env.E2E_IGNORE_LOCAL_TLS==='1',extraHTTPHeaders:{'x-real-ip':'synthetic-p7-'+randomUUID()}});
  try{const cert=await context.newPage();await login(cert,'synthetic.certifier');await cert.goto(`/results/${id}`);await cert.getByLabel('เหตุผลการอ่านซ้ำ (อย่างน้อย 8 ตัวอักษร)').fill('จำลอง ตรวจ parser จากต้นฉบับเดิม');await cert.getByRole('button',{name:'สร้างหลักฐานอ่านซ้ำ',exact:true}).click();await expect(cert.locator('[role=status]:not([popover])')).toContainText('สร้างหลักฐานอ่านซ้ำแล้ว');await cert.getByText('หลักฐานอ่านซ้ำล่าสุด (สูงสุด 50 รายการ)',{exact:true}).click();await expect(cert.getByText('อ่านได้ (หลักฐานวินิจฉัยเท่านั้น)')).toBeVisible();
   expect((await db.query('SELECT state,case_id,round_id,attempt_id FROM result_report_version WHERE id=$1',[id])).rows[0]).toEqual({state:'Unlinked',case_id:null,round_id:null,attempt_id:null});expect((await db.query<{n:number}>('SELECT count(*)::int n FROM result_release')).rows[0].n).toBe(0);
  }finally{await context.close();}
 }finally{await db.end();}
});
