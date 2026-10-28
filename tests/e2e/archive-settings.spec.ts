import {test,expect,type Page} from '@playwright/test';
import {randomUUID} from 'node:crypto';

const root=process.env.NIPT_ARCHIVE_BROWSER_ROOT,password=process.env.SYNTHETIC_SEED_PASSWORD;
test.skip(!root||!password,'Requires the isolated loopback archive fixture');
async function login(page:Page,name:string){
 await page.goto('/login');await page.getByLabel('ชื่อผู้ใช้',{exact:true}).fill(name);await page.getByLabel('รหัสผ่าน',{exact:true}).fill(password!);
 await page.getByRole('button',{name:'เข้าสู่ระบบ',exact:true}).click();await expect(page).toHaveURL(/\/$/);
}
test('administrator probes, enables and disables the archive; LAB cannot read settings',async({page,browser})=>{
 test.setTimeout(90000);await login(page,'synthetic.admin');await page.goto('/settings');
 await page.getByLabel('NAS UNC Path').fill(root!);await page.getByRole('button',{name:'Test Connection'}).click();
 await expect(page.getByText(/ผลทดสอบ: PASSED/)).toBeVisible({timeout:40000});
 await page.getByRole('button',{name:'Save & Enable'}).click();await expect(page.getByText('เปิดใช้งานแล้ว',{exact:false}).first()).toBeVisible();
 const lab=await browser.newContext({baseURL:process.env.E2E_BASE_URL}),labPage=await lab.newPage();
 try{await login(labPage,'synthetic.lab');const response=await lab.request.get('/api/settings/pdf-archive');expect(response.status()).toBe(403);expect(await response.text()).not.toContain(root!);
  const missing=await lab.request.get(`/api/p5/results/${randomUUID()}/archive`);expect(missing.status()).toBe(404);
 }finally{await lab.close();}
 await page.getByRole('button',{name:'ปิดใช้งาน'}).click();await expect(page.getByText('ปิดใช้งานแล้ว',{exact:false}).first()).toBeVisible();
});
