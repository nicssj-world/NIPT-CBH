import {test,expect,type Page} from '@playwright/test';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {Client} from 'pg';
import AxeBuilder from '@axe-core/playwright';
import {developmentEnvironment} from '../../tools/migration/runtime-launch';
const enabled=process.env.E2E_BASE_URL==='https://127.0.0.1:20368';
test.skip(!enabled,'isolated Migration synthetic runtime only');
const out='.local/migration-evidence/browser';
type Account={key:string;username:string;password:string};
let accounts:Account[],caseId:string,inProgressCaseId:string,releaseId:string,sha:string;
test.beforeAll(async()=>{
 if(!enabled)return;
 accounts=JSON.parse(await readFile('.local/migration-runtime/private/clean-journey-actors.json','utf8'));
 const db=new Client({connectionString:(await developmentEnvironment('owner')).DATABASE_URL});await db.connect();
 try{await db.query('BEGIN READ ONLY');const row=(await db.query<{case_id:string;release_id:string;sha256:string}>("SELECT m.case_id,r.id release_id,v.sha256 FROM migration_record m JOIN result_report_version v ON (v.case_id,v.round_id,v.attempt_id)=(m.case_id,m.round_id,m.attempt_id) JOIN result_release r ON r.version_id=v.id AND r.state='Active' WHERE m.ln='990000002001'")).rows[0];expect(row).toBeTruthy();caseId=row.case_id;releaseId=row.release_id;sha=row.sha256;
  const progress=(await db.query<{case_id:string}>("SELECT case_id FROM migration_record WHERE classification='NO_HALOS' AND case_id IS NOT NULL AND ln='990000002003'")).rows[0];expect(progress).toBeTruthy();inProgressCaseId=progress.case_id;await db.query('COMMIT');}finally{await db.end();}
 await mkdir(out,{recursive:true});
});
async function login(page:Page,key:string){const a=accounts.find(a=>a.key===key)!;expect(a).toBeTruthy();await page.goto('/login');await page.getByLabel('ชื่อผู้ใช้').fill(a.username);await page.locator('#password').fill(a.password);await page.getByRole('button',{name:'เข้าสู่ระบบ',exact:true}).click();await expect(page).not.toHaveURL(/\/login/);}
test('LAB and ANC show official values before PDF actions, scoped certified bytes and responsive screenshots',async({page})=>{
 test.setTimeout(180000);
 for(const key of ['lab','anc']){
  await login(page,key);await page.goto(`/cases/${caseId}`);
  const card=page.locator('.anc-result');await expect(card.getByText('Trisomy 21',{exact:true})).toBeVisible();await expect(card.getByText('Low Risk',{exact:false}).first()).toBeVisible();
  // A Historical case whose result was already issued is not asked for request/consent evidence again, and none is invented.
  await expect(page.getByText('ระบบไม่สร้างใบขอส่งตรวจหรือใบยินยอมย้อนหลัง')).toBeVisible();
  for(const name of ['เริ่มลงนามใบยินยอม','ดำเนินการลงนามใบยินยอม','ใช้ Paper Consent','ผู้ป่วยไม่ยินยอม','เปิดแบบขอส่งตรวจ 5 หมวด'])await expect(page.getByRole('button',{name})).toHaveCount(0);
  const actions=card.locator('.nipt-actions');await expect(actions.getByRole('link',{name:'เปิดรายงาน PDF'})).toBeVisible();await expect(actions.getByRole('link',{name:'ดาวน์โหลด PDF'})).toBeVisible();await expect(actions.getByRole('button',{name:'พิมพ์',exact:true})).toBeVisible();
  expect(await card.locator('.nipt-table').evaluate(e=>e.getBoundingClientRect().top)).toBeLessThan(await actions.evaluate(e=>e.getBoundingClientRect().top));
  for(const width of [1440,768,375]){await page.setViewportSize({width,height:1000});await page.screenshot({path:`${out}/${key}-${width}.png`,fullPage:true});expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);}
  const axe=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa']).analyze();await writeFile(`${out}/${key}-axe.json`,JSON.stringify(axe.violations,null,2));expect(axe.violations.filter(v=>v.impact==='critical'||v.impact==='serious')).toEqual([]);
  for(const mode of ['', '?mode=download','?mode=print']){const response=await page.request.get(`/api/p5/releases/${releaseId}/file${mode}`);expect(response.status()).toBe(200);expect(createHash('sha256').update(await response.body()).digest('hex')).toBe(sha);}
  await page.setViewportSize({width:1440,height:1000});await page.getByRole('button',{name:'ออกจากระบบ',exact:true}).click();await expect(page).toHaveURL(/\/login/);
 }
});
test('wrong ward receives no summary or certified PDF',async({page})=>{
 await login(page,'wrongAnc');
 expect((await page.request.get(`/api/p5/cases/${caseId}/results`)).status()).toBe(404);
 expect((await page.request.get(`/api/p5/releases/${releaseId}/file`)).status()).toBe(404);
});
test('an in-progress migrated case keeps the ordinary request/consent workflow',async({page})=>{
 await login(page,'anc');await page.goto(`/cases/${inProgressCaseId}`);
 await expect(page.getByText('ระบบไม่สร้างใบขอส่งตรวจหรือใบยินยอมย้อนหลัง')).toHaveCount(0);
 await expect(page.getByRole('button',{name:'เริ่มลงนามใบยินยอม'})).toBeVisible();
});
