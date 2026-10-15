import {test,expect} from '@playwright/test';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {randomUUID,createHash} from 'node:crypto';
import path from 'node:path';

test('P8 signed installed candidate: login, registration, worklists, HOLD and session-bound PDF',async({page,browser})=>{
 test.skip(process.env.NIPT_P8_INSTALLED_SMOKE!=='yes','Explicit installed synthetic candidate only');
 test.setTimeout(120000);
 const root=path.resolve(process.env.NIPT_P8_INSTALLED_ROOT??'');
 if(!root.startsWith(path.resolve('.local/p8')+path.sep))throw Error('P8_OWNED_RUNTIME_REQUIRED');
 const state=JSON.parse(await readFile(path.join(root,'.nipt-runtime.json'),'utf8'));
 const base=new URL(process.env.E2E_BASE_URL??'');
 if(state.syntheticOnly!==true||state.status!=='STARTED_NOT_ACCEPTED'||state.project!==process.env.NIPT_P8_EXPECTED_PROJECT||!/^nipt-synthetic-p8-/.test(state.project)||base.protocol!=='https:'||base.hostname!=='localhost'||base.port!==String(state.port)||base.pathname!=='/'||base.search||base.hash)throw Error('P8_INSTALLED_TARGET_MISMATCH');
 const password=(await readFile(path.join(root,'data/secrets/seed-password'),'utf8')).trim();
 const login=async(p:typeof page,user:string)=>{await p.goto('/login');await p.getByLabel('ชื่อผู้ใช้',{exact:true}).fill(user);await p.getByLabel('รหัสผ่าน',{exact:true}).fill(password);await p.getByRole('button',{name:'เข้าสู่ระบบ',exact:true}).click();await expect(p).toHaveURL(/\/$/);};
 const evidence=path.resolve('.local/p8/installed-smoke-'+randomUUID().replaceAll('-',''));await mkdir(evidence);
 expect((await page.request.get('/api/me')).status()).toBe(401);
 await login(page,'synthetic.lab');
 await page.goto('/cases');await page.getByRole('button',{name:'ลงทะเบียนโดย Lab',exact:true}).click();
 const ln='00990'+String(Date.now()).slice(-9),hn='990'+String(Date.now()).slice(-9);
 await page.getByLabel('LN HIS จำลอง',{exact:false}).fill(ln);await page.getByLabel('HN จำลอง',{exact:false}).fill(hn);
 const unit=page.getByLabel('หน่วยงานลงทะเบียน',{exact:false});
 const unitId=await unit.locator('option').evaluateAll(options=>options.map(o=>(o as HTMLOptionElement).value).find(Boolean));
 if(!unitId)throw Error('SYNTHETIC_UNIT_MISSING');await unit.selectOption(unitId);
 await page.getByLabel('แหล่งของตัวระบุ',{exact:false}).selectOption('TUBE_LABEL');
 await page.getByRole('button',{name:'ตรวจและลงทะเบียน',exact:true}).click();await expect(page).toHaveURL(/\/cases\/[a-f0-9-]+$/);
 await expect(page.getByRole('heading',{name:/เคสจำลอง LN/})).toContainText(ln);
 const caseId=page.url().split('/').at(-1);
 for(const route of ['/lab','/lab/batches','/results','/health']){const response=await page.goto(route);expect(response?.ok()).toBe(true);await expect(page.locator('h1')).toBeVisible();}
 await page.goto('/results');await expect(page.getByText('ยังไม่ปล่อยผลจริง')).toBeVisible();await page.screenshot({path:path.join(evidence,'results-hold.png'),fullPage:true});
 await page.goto('/health');await page.getByRole('button',{name:'สร้าง PDF ทดสอบ',exact:true}).click();
 const link=page.getByRole('link',{name:'เปิด PDF ตัวอย่าง (แท็บใหม่)'});await expect(link).toBeVisible();const href=(await link.getAttribute('href'))!;
 const a=await page.request.get(href),b=await page.request.get(href);expect(a.ok()).toBe(true);const bytes=await a.body();expect(bytes.subarray(0,5).toString()).toBe('%PDF-');expect(bytes.equals(await b.body())).toBe(true);
 const other=await browser.newContext({baseURL:base.href,ignoreHTTPSErrors:true});
 try{const p=await other.newPage();await login(p,'synthetic.anc');expect((await other.request.get(new URL(href,base).href)).status()).toBe(403);}finally{await other.close();}
 await writeFile(path.join(evidence,'report.json'),JSON.stringify({syntheticOnly:true,sourceRevision:state.revision,project:state.project,caseId,leadingZeroLnPreserved:true,login:true,worklists:true,resultsHoldVisible:true,pdfHash:createHash('sha256').update(bytes).digest('hex'),pdfByteReuse:true,crossSessionDenied:true,clinicalAcceptance:false},null,2));
});
