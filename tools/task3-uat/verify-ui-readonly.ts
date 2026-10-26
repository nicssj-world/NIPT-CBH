import {chromium,expect} from '@playwright/test';
import path from 'node:path';
const ORIGIN='https://127.0.0.1:20128';
if(path.basename(process.cwd())!=='task3-readygen') throw Error('WORKTREE_REQUIRED');
const browser=await chromium.launch({headless:true});
const checks:string[]=[];
try {
  async function login(role:'admin'|'anc'){
    const context=await browser.newContext({ignoreHTTPSErrors:true,serviceWorkers:'block'});
    const page=await context.newPage();
    await page.goto(ORIGIN+'/login');
    await page.getByLabel('ชื่อผู้ใช้').fill(role);
    await page.getByLabel('รหัสผ่าน',{exact:true}).fill(role);
    await page.getByRole('button',{name:'เข้าสู่ระบบ',exact:true}).click();
    await page.waitForURL(url=>url.pathname!=='/login',{timeout:20000});
    return page;
  }
  const admin=await login('admin');
  const api=await admin.evaluate(async()=>{
    const r=await fetch('/api/admin?search=uat_anc_',{cache:'no-store'});
    return {status:r.status,data:await r.json()};
  });
  if(api.status!==200||api.data.users.rows.filter((r:{username:string;roles:string[]})=>r.username.startsWith('uat_anc_')&&r.roles.includes('ANC_NURSE')).length<1)
    throw Error('ADMIN_ANC_CREATED_USERS_UNAVAILABLE_'+api.status);
  checks.push('ADMIN_API_AND_PERSISTED_ANC_ROLE');
  for(const [url,button] of [['/settings/users','เพิ่มผู้ใช้'],['/settings/units','เพิ่มหน่วยงาน']] as const){
    await admin.goto(ORIGIN+url);
    await expect(admin.getByRole('button',{name:button,exact:true})).toBeVisible();
    await expect(admin.getByText('โหลดข้อมูลไม่ได้ กรุณาตรวจสิทธิ์แล้วลองอีกครั้ง')).toHaveCount(0);
    checks.push('ADMIN_'+url);
  }
  await admin.goto(ORIGIN+'/results');
  const copy=await admin.locator('body').innerText();
  if(copy.includes('TRAINING / LOCAL UAT')||copy.includes('ยังไม่ปล่อยผลจริง — ระบบทำได้ถึงการตรวจทานและประเมิน Gate'))throw Error('OBSOLETE_BANNER_REMAINS');
  checks.push('RESULT_UI_NO_OBSOLETE_BANNER');
  const anc=await login('anc');
  await anc.goto(ORIGIN+'/');
  await expect(anc.locator('main')).toContainText('ANC',{timeout:30000});
  const dashboard=await anc.locator('main').innerText();
  if(!dashboard.includes('ANC')){ const me=await anc.evaluate(async()=>{const r=await fetch('/api/me');return {status:r.status,data:await r.json()};});throw Error('ANC_DASHBOARD_MISSING url='+anc.url()+' me='+JSON.stringify({status:me.status,roles:me.data?.roles})+' snippet='+dashboard.slice(0,330)); }
  if((await anc.locator('body').innerText()).includes('TRAINING / LOCAL UAT'))throw Error('ANC_TRAINING_BANNER_REMAINS');
  checks.push('ANC_LOGIN_AND_DASHBOARD');
  process.stdout.write(JSON.stringify({passed:true,checks})+'\n');
}catch(e){process.stderr.write(JSON.stringify({passed:false,checks,error:String(e)})+'\n');process.exitCode=1;}
finally{await browser.close();}
