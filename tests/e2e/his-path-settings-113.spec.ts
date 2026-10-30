import {test,expect,type Page} from '@playwright/test';
import {readFileSync} from 'node:fs';
import path from 'node:path';

const backup=process.env.NIPT_E2E_HIS_SHARE_ROOT?path.join(process.env.NIPT_E2E_HIS_SHARE_ROOT,'backup'):undefined;
test.skip(!backup,'Requires isolated loopback synthetic HIS share from the local browser runner');
const password=()=>process.env.SYNTHETIC_SEED_PASSWORD??readFileSync(process.env.SYNTHETIC_SEED_PASSWORD_FILE??'data/secrets/seed-password','utf8').trim();
async function login(page:Page,user:string){await page.goto('/login');await page.getByLabel('ชื่อผู้ใช้',{exact:true}).fill(user);await page.getByLabel('รหัสผ่าน',{exact:true}).fill(password());await page.getByRole('button',{name:'เข้าสู่ระบบ',exact:true}).click();await expect(page).toHaveURL(/\/$/);}

test('P0 HIS Path settings: backup-only saves, invalid backup is safe, non-admin cannot save',async({page,browser})=>{
 test.setTimeout(90000);
 await login(page,'synthetic.admin');await page.goto('/settings/his');
 const res=page.getByLabel('RES + OK ขาออกไป HIS'),cfs=page.getByLabel('PDF ผลสำหรับ CFS'),backupInput=page.getByLabel('สำรองไฟล์ที่ส่ง HIS');
 // Leave unchanged RES/CFS values untouched: they need not be accessible to save only Backup.
 await backupInput.fill(backup!);
 const responsePromise=page.waitForResponse(r=>r.url().includes('/api/settings/his-paths')&&r.request().method()==='POST');
 await page.getByRole('button',{name:'บันทึกและใช้งาน',exact:true}).click();
 const response=await responsePromise;expect(response.ok(),await response.text()).toBeTruthy();
 await expect(page.getByRole('status')).toContainText(/บันทึก|สำเร็จ/);
 expect(await res.inputValue()).toBe('');expect(await cfs.inputValue()).toBe('');
 const before=await page.request.get('/api/settings/his-paths');expect(before.ok()).toBeTruthy();
 const beforeBody=await before.json() as {keys:Record<string,{activeRevision:{version:number}|null;paths:Record<string,string>}>};
 const active=beforeBody.keys.his_outbound.activeRevision?.version;
 const savedBackup=backup!;
 expect(beforeBody.keys.his_outbound.paths.backup).toBe(savedBackup);
 await backupInput.fill(path.join(path.dirname(backup!), 'missing-synthetic-backup'));
 const invalidWait=page.waitForResponse(r=>r.url().includes('/api/settings/his-paths')&&r.request().method()==='POST');
 await page.getByRole('button',{name:'บันทึกและใช้งาน',exact:true}).click();
 const invalid=await invalidWait;expect(invalid.status()).toBeGreaterThanOrEqual(400);expect(invalid.status()).toBeLessThan(500);
 await expect(page.locator('.his-paths .notice[role="alert"]')).toContainText('ไม่พบโฟลเดอร์');
 const after=await page.request.get('/api/settings/his-paths').then(r=>r.json()) as typeof beforeBody;
 expect(after.keys.his_outbound.activeRevision?.version).toBe(active);
 expect(after.keys.his_outbound.paths.backup).toBe(savedBackup);
 const lab=await browser.newPage();try{await login(lab,'synthetic.lab');await lab.goto('/settings/his');
   await expect(lab.getByLabel('สำรองไฟล์ที่ส่ง HIS')).toHaveCount(0);
   const denied=await lab.request.post('/api/settings/his-paths',{data:{paths:{backup:backup+'-nonadmin'}}});
   expect(denied.status()).toBe(403);
 }finally{await lab.close();}
});
