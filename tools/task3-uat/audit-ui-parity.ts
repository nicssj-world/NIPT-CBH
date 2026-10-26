import {chromium} from '@playwright/test';
import {readFileSync} from 'node:fs';
import path from 'node:path';
if(path.basename(process.cwd())!=='task3-readygen')throw Error('WRONG_WORKTREE');
const ORIGIN='https://127.0.0.1:20128';
const batch=JSON.parse(readFileSync('.local/task3-uat/uat-fixture.json','utf8')).batchId;
const adminRoutes=['/','/cases','/inbound','/lab','/lab/batches','/lab/batches/'+batch,'/lab/batches/'+batch+'/bench','/lab/batches/'+batch+'/pooling','/lab/batches/'+batch+'/sequencing','/lab/batches/'+batch+'/workbook','/sample-storage','/lab/photos','/results','/results/signers','/historical','/doctors','/settings','/settings/users','/settings/units','/settings/audit','/settings/backup','/settings/run-photos','/health'];
const ancRoutes=['/','/cases','/doctors'];
const forbidden=/TRAINING\s*\/\s*LOCAL UAT|NOT FOR CLINICAL USE|P1 Foundation|ข้อมูลจำลอง|ตัวจำลอง|ระบบจำลอง|SYNTHETIC\s*HOLD|ยังไม่ปล่อยผลจริง|OD-05|OD-07|AL-5/i;
const browser=await chromium.launch({headless:true}),records:{role:string;route:string;http:number;hits:string[];other:string[]}[]=[];
try{
 for(const role of ['admin','anc'] as const){
  const context=await browser.newContext({ignoreHTTPSErrors:true,serviceWorkers:'block'}),page=await context.newPage();
  await page.goto(ORIGIN+'/login');
  await page.getByLabel('ชื่อผู้ใช้').fill(role);
  await page.getByLabel('รหัสผ่าน',{exact:true}).fill(role);
  await page.getByRole('button',{name:'เข้าสู่ระบบ',exact:true}).click();
  await page.waitForURL(url=>url.pathname!=='/login',{timeout:20000});
  for(const route of (role==='admin'?adminRoutes:ancRoutes)){
   const response=await page.goto(ORIGIN+route,{waitUntil:'domcontentloaded',timeout:30000});
   await page.waitForTimeout(500);
   const body=await page.locator('body').innerText();
   const hits=body.split('\n').map(x=>x.trim()).filter(x=>forbidden.test(x)).map(x=>x.slice(0,180)).slice(0,12);
   const other=(body.includes('โหลดข้อมูลไม่ได้')?['LOAD_FAILED']:[]).concat(body.includes('Internal Server Error')?['SERVER_ERROR']:[]);
   records.push({role,route,http:response?.status()??0,hits,other});
  }
  await context.close();
 }
 const flagged=records.filter(x=>x.http>=500||x.hits.length||x.other.length);
 process.stdout.write(JSON.stringify({pages:records.length,flagged,summary:records.map(x=>({r:x.role+':'+x.route,h:x.http})),passed:!flagged.length})+'\n');
}finally{await browser.close();}
