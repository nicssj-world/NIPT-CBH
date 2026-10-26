import {chromium,expect} from '@playwright/test';
import {randomBytes} from 'node:crypto';
import path from 'node:path';

const ORIGIN='https://127.0.0.1:20128';
if (path.basename(process.cwd())!=='task3-readygen') throw Error('WRONG_UAT_WORKTREE');
const result:{checks:string[];created?:{unitCode:string;username:string};error?:string}={checks:[]};
const browser=await chromium.launch({headless:true});
try {
  const ctx=await browser.newContext({ignoreHTTPSErrors:true,serviceWorkers:'block'});
  const page=await ctx.newPage();
  async function login(page:import('@playwright/test').Page,username:string,password:string){
    await page.goto(ORIGIN+'/login',{waitUntil:'domcontentloaded'});
    await page.getByLabel('ชื่อผู้ใช้').fill(username);
    await page.getByLabel('รหัสผ่าน',{exact:true}).fill(password);
    await page.getByRole('button',{name:'เข้าสู่ระบบ',exact:true}).click();
    await page.waitForURL(url=>url.pathname!=='/login',{timeout:20000});
    const role=await page.evaluate(async()=>{const r=await fetch('/api/me',{cache:'no-store'});return {status:r.status,data:await r.json()};});
    if(role.status!==200)throw Error('ME_FAILED_'+role.status);
    return role.data as {csrf:string;roles:string[]};
  }
  const session=await login(page,'admin','admin');
  if(!session.roles.includes('APP_ADMIN'))throw Error('APP_ADMIN_ROLE_MISSING');
  result.checks.push('ADMIN_LOGIN');
  async function getAdmin(q=''){
    return await page.evaluate(async q=>{const r=await fetch('/api/admin'+q,{cache:'no-store'});return {status:r.status,data:await r.json()};},q);
  }
  const first=await getAdmin();
  if(first.status!==200)throw Error('ADMIN_GET_HTTP_'+first.status+'_'+JSON.stringify(first.data).slice(0,180));
  result.checks.push('ADMIN_API_GET_200');
  await page.goto(ORIGIN+'/settings/users');
  await expect(page.getByRole('button',{name:'เพิ่มผู้ใช้'})).toBeVisible();
  await expect(page.getByText('โหลดข้อมูลไม่ได้ กรุณาตรวจสิทธิ์แล้วลองอีกครั้ง')).toHaveCount(0);
  await page.goto(ORIGIN+'/settings/units');
  await expect(page.getByRole('button',{name:'เพิ่มหน่วยงาน'})).toBeVisible();
  result.checks.push('ADMIN_USERS_AND_UNITS_UI');
  const suffix=Date.now().toString(36)+randomBytes(2).toString('hex');
  const unitCode='UAT_ANC_'+suffix,unitName='ตรวจสอบ ANC '+suffix,username='uat_anc_'+suffix;
  const password=randomBytes(24).toString('base64url');
  async function post(input:unknown){
    return await page.evaluate(async input=>{
      const me=await fetch('/api/me').then(r=>r.json());
      const r=await fetch('/api/admin',{method:'POST',headers:{'Content-Type':'application/json','x-csrf-token':me.csrf},body:JSON.stringify(input)});
      return {status:r.status,data:await r.json()};
    },input);
  }
  const u=await post({operation:'saveUnit',code:unitCode,name:unitName,active:true});
  if(u.status!==200||!u.data.id)throw Error('SAVE_UNIT_HTTP_'+u.status+'_'+JSON.stringify(u.data).slice(0,180));
  const unitId=u.data.id;
  const v=await post({operation:'saveUser',username,displayName:'ANC UAT '+suffix,jobPosition:'พยาบาลวิชาชีพ',phone:'',password,unitId,enabled:true,roles:['ANC_NURSE'],unitIds:[unitId],permissions:[]});
  if(v.status!==200||!v.data.id)throw Error('SAVE_USER_HTTP_'+v.status+'_'+JSON.stringify(v.data).slice(0,180));
  result.created={unitCode,username};
  result.checks.push('UNIT_AND_ANC_USER_CREATED');
  const verify=await getAdmin('?search='+encodeURIComponent(username));
  if(verify.status!==200||!verify.data.users?.rows?.some((r:{username:string;roles:string[];unit_id:string})=>r.username===username&&r.roles.includes('ANC_NURSE')&&r.unit_id===unitId)) throw Error('USER_ROLE_PERSISTENCE_FAILED');
  result.checks.push('ANC_USER_PERSISTENCE');
  const fresh=await browser.newContext({ignoreHTTPSErrors:true,serviceWorkers:'block'}),freshPage=await fresh.newPage();
  const newSession=await login(freshPage,username,password);
  if(!newSession.roles.includes('ANC_NURSE'))throw Error('NEW_ANC_LOGIN_ROLE_MISSING');
  if(!freshPage.url().endsWith('/password'))throw Error('NEW_ANC_PASSWORD_CHANGE_NOT_REQUIRED');
  result.checks.push('ANC_NEW_LOGIN_AND_PASSWORD_GATE');
  const ancCtx=await browser.newContext({ignoreHTTPSErrors:true,serviceWorkers:'block'}),ancPage=await ancCtx.newPage();
  const ancSession=await login(ancPage,'anc','anc');
  if(!ancSession.roles.includes('ANC_NURSE'))throw Error('BUILTIN_ANC_ROLE_MISSING');
  await ancPage.goto(ORIGIN+'/');
  if(!(await ancPage.locator('main').innerText()).includes('ANC'))throw Error('ANC_DASHBOARD_MISSING');
  result.checks.push('ANC_DASHBOARD');
  await page.goto(ORIGIN+'/results');
  const copy=await page.locator('body').innerText();
  for(const bad of ['TRAINING / LOCAL UAT — NOT FOR CLINICAL USE','ยังไม่ปล่อยผลจริง — ระบบทำได้ถึงการตรวจทานและประเมิน Gate']) if(copy.includes(bad))throw Error('OBSOLETE_BANNER_REMAINS');
  result.checks.push('PRODUCTION_STYLE_COPY');
  process.stdout.write(JSON.stringify({passed:true,...result})+'\n');
} catch(error){
  process.stderr.write(JSON.stringify({passed:false,...result,error:String(error)})+'\n');
  process.exitCode=1;
} finally {await browser.close();}
