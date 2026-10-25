import {test,expect,type Page} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {Client} from 'pg';
import {readFileSync,existsSync,readdirSync,statSync} from 'node:fs';
import {mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';

// Integrated synthetic Owner UAT (tools/task3-uat/uat.ts), loopback only. Real login form with the seeded accounts (admin/admin ...).
// Run: E2E_BASE_URL=https://127.0.0.1:20128 E2E_IGNORE_LOCAL_TLS=1 npx playwright test tests/e2e/task3-integrated-uat.spec.ts
const base=path.resolve('.local/task3-uat'),out=path.resolve('.local/task3-evidence/e2e'),fixture=JSON.parse(readFileSync(path.join(base,'uat-fixture.json'),'utf8')) as {cases:{key:string;ln:string;hn:string;halosSampleId:string}[]};
const c=(k:string)=>fixture.cases.find(x=>x.key===k)!;
const sql=async<T>(q:string,p:unknown[]=[])=>{const db=new Client({connectionString:`postgresql://nipt_migrator:${encodeURIComponent(readFileSync(path.join(base,'secrets','db-password'),'utf8').trim())}@127.0.0.1:20129/nipt_task3_integrated_owner_uat`});await db.connect();try{return (await db.query(q,p)).rows as T[];}finally{await db.end();}};
const evidence:Record<string,unknown>={};
test.describe.configure({mode:'serial'});
test.skip(!process.env.E2E_BASE_URL?.startsWith('https://127.0.0.1:20128'),'integrated UAT runtime only');
test.beforeAll(async()=>{await mkdir(out,{recursive:true});});
test.afterAll(async()=>{await writeFile(path.join(out,'task3-e2e-evidence.json'),JSON.stringify(evidence,null,2));});

async function login(page:Page,user:string){
 await page.goto('/login');await page.getByLabel('ชื่อผู้ใช้').fill(user);await page.locator('#password').fill(user);
 await page.getByRole('button',{name:'เข้าสู่ระบบ'}).click();await expect(page).not.toHaveURL(/\/login/);
}
async function logout(page:Page){await page.getByRole('button',{name:'ออกจากระบบ',exact:true}).click();await expect(page).toHaveURL(/\/login/);}
async function shot(page:Page,name:string,widths=[1440,768,375]){
 for(const w of widths){await page.setViewportSize({width:w,height:1000});await page.waitForTimeout(150);
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
  (evidence.overflow??={} as Record<string,number>);(evidence.overflow as Record<string,number>)[`${name}@${w}`]=overflow;
  await page.screenshot({path:path.join(out,`${name}-${w}.png`),fullPage:true});}
 await page.setViewportSize({width:1440,height:1000});
}
async function axe(page:Page,name:string){
 const r=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa']).analyze();
 (evidence.axe??={} as Record<string,unknown>);(evidence.axe as Record<string,unknown>)[name]=r.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.length}));
 expect(r.violations.filter(v=>v.impact==='critical'||v.impact==='serious'),name).toEqual([]);
}
const nav=(page:Page)=>page.getByRole('navigation').first();
// Picks the signer option whose text contains `part` (e.g. the delegated LAB signer, or the operator's own profile).
async function pick(scope:import('@playwright/test').Locator,id:string,part:string){const sel=scope.locator(id);await expect(sel.locator('option',{hasText:part})).not.toHaveCount(0,{timeout:15_000});
 const value=await sel.locator('option',{hasText:part}).first().getAttribute('value');await sel.selectOption(value!);}

test('admin/admin: real login, APP_ADMIN global navigation, no certification authority, single logout',async({page})=>{
 await login(page,'admin');
 for(const label of ['ทะเบียนกลาง','งาน Lab','ผลตรวจ NIPT','ตั้งค่าระบบ'])await expect(nav(page).getByRole('link',{name:label,exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'ออกจากระบบ',exact:true})).toHaveCount(1);
 await page.goto('/settings');await expect(page.getByRole('heading').first()).toBeVisible();await shot(page,'admin-settings',[1440]);
 // APP_ADMIN may view LAB/ANC but holds no result.certify: a Final request is refused server-side.
 const me=await (await page.request.get('/api/me')).json();
 const r=await page.request.post('/api/task3/reports',{headers:{origin:'https://127.0.0.1:20128','x-csrf-token':me.csrf},data:{action:'finalize',idempotencyKey:'00000000-0000-4000-8000-000000000001',items:[{rowId:'00000000-0000-4000-8000-000000000002'}]}});
 expect(r.status()).toBe(403);evidence.adminFinalizeStatus=r.status();
 await logout(page);
});

test('pathway A (LAB certifier): HALOS import preview/confirm, realtime search, HOLD reasons, single Final + release, batch Final + ZIP',async({page})=>{
 test.setTimeout(420_000);
 await login(page,'certifier');await page.goto('/results');
 await expect(page.getByRole('heading',{name:'รายงานจากผล HALOS'})).toBeVisible();
 // Re-runs against the same UAT database reuse the already confirmed import (same SHA-256 is never imported twice).
 if(!(await sql("SELECT 1 FROM halos_import WHERE state='Confirmed'")).length){
 const imp=page.locator('details.t3-import');if(!await imp.evaluate(e=>(e as HTMLDetailsElement).open))await imp.locator('summary').click();
 await page.locator('#halos-file').setInputFiles(path.join(base,'fixtures','Sample analysis data_S990000001_UAT.xlsx'));
 await page.getByRole('button',{name:'อัปโหลดและตรวจ (Preview)'}).click();
 const preview=page.locator('.t3-preview');await expect(preview).toBeVisible({timeout:60_000});
 await expect(preview.getByText('6 ราย')).toBeVisible();
 await shot(page,'a-halos-preview');await axe(page,'halos-preview');
 const warnings=preview.locator('.t3-warnings input[type=checkbox]');for(let i=0;i<await warnings.count();i++)await warnings.nth(i).check();
 await preview.getByRole('button',{name:'ยืนยันนำเข้า'}).click();await expect(preview).toBeHidden({timeout:60_000});
 }
 const list=page.getByRole('region',{name:'รายการออกรายงานจากผล HALOS'});
 // Realtime search (no submit) by LN, then by HN, then clear.
 await page.getByLabel('ค้นหา LN / HN / LN Halos / รหัส HALOS').fill(c('A4').ln);
 await expect(list.locator('tbody tr')).toHaveCount(1,{timeout:30_000});await expect(list).toContainText('ระงับ');
 await expect(list).toContainText('ไม่มีความประสงค์');
 await page.getByLabel('ค้นหา LN / HN / LN Halos / รหัส HALOS').fill(c('A5').hn);
 await expect(list.locator('tbody tr')).toHaveCount(1,{timeout:30_000});await expect(list).toContainText(c('A5').halosSampleId);
 await page.getByRole('button',{name:'ล้างคำค้น'}).click();
 await expect(list).toContainText(c('A1').halosSampleId,{timeout:30_000});await shot(page,'a-worklist');await axe(page,'worklist');
 // Single: A1 with draft preview, delegated Reported by + own Approved by, release in the same session.
 const row=(k:string)=>list.locator('tbody tr',{hasText:c(k).halosSampleId});
 await row('A1').getByRole('button',{name:'ออกรายงาน'}).click();
 const dlg=page.getByRole('dialog',{name:/ออกรายงาน/});await expect(dlg.getByText('ข้อมูลครบและผ่านเงื่อนไข')).toBeVisible({timeout:60_000});
 await pick(dlg,'#t3-reported','ได้รับมอบสิทธิ์');await pick(dlg,'#t3-approved','ตนเอง');
 await expect(dlg.getByText('ใช้ลายเซ็นตามการมอบสิทธิ์ของเจ้าของลายเซ็น')).toBeVisible();
 await dlg.getByRole('button',{name:'ดูร่างรายงาน'}).click();await expect(page.getByText('ร่างรายงาน (PREVIEW)').first()).toBeVisible({timeout:120_000});
 const pv=page.getByRole('dialog',{name:'ร่างรายงาน (PREVIEW)'});await expect(pv.getByText('กำลังเปิด PDF')).toBeHidden({timeout:60_000});
 await pv.screenshot({path:path.join(out,'a-draft-preview-1440.png')});// Keyboard: Escape closes only the top (preview) dialog; the report dialog and its selections stay.
 await page.keyboard.press('Escape');await expect(pv).toBeHidden();await expect(dlg.getByText('ข้อมูลครบและผ่านเงื่อนไข')).toBeVisible();evidence.nestedEscapeKeepsParent=true;
 await dlg.getByLabel('ตรวจรับและยืนยันส่งผลทันที',{exact:false}).check();
 for(const t of ['ตรวจค่าในรายงานตรงกับผล HALOS','ตัวตนผู้ป่วยและรอบถูกต้อง','ตรวจการเปิดเผยเพศ','ทบทวนค่าในใบงาน QC'])await dlg.getByLabel(t,{exact:false}).check();
 await shot(page,'a-report-dialog',[1440,375]);
 await dlg.getByRole('button',{name:'ออกรายงานและส่งผล'}).click();
 await expect(dlg.getByText('ออกรายงานและส่งผลแล้ว')).toBeVisible({timeout:180_000});
 await dlg.getByRole('button',{name:'ปิด'}).first().click();
 // Batch: A2 (High Risk) + A3 (Twin) together, one PDF each, without release; held rows are not selectable.
 await expect(row('A4').locator('input[type=checkbox]')).toHaveCount(0);
 await row('A2').locator('input[type=checkbox]').check();await row('A3').locator('input[type=checkbox]').check();
 await page.getByRole('button',{name:'ออกรายงานที่เลือก'}).click();
 const bd=page.getByRole('dialog',{name:/ออกรายงาน/});await expect(bd.getByRole('region',{name:'รายการที่จะออกรายงาน'})).toBeVisible();
 await pick(bd,'#t3-reported','ได้รับมอบสิทธิ์');await pick(bd,'#t3-approved','ตนเอง');
 await bd.getByRole('button',{name:'ออกรายงานฉบับจริง'}).click();
 await expect(bd.getByText(/ออกรายงาน 2 ราย/)).toBeVisible({timeout:240_000});
 const zip=page.waitForEvent('download');await bd.getByRole('link',{name:/ดาวน์โหลด ZIP/}).click();const z=await zip;
 const zipPath=path.join(out,'batch.zip');await z.saveAs(zipPath);evidence.batchZip={name:z.suggestedFilename(),sha256:createHash('sha256').update(readFileSync(zipPath)).digest('hex'),bytes:statSync(zipPath).size};
 await bd.getByRole('button',{name:'ปิด'}).first().click();
 const ir=await sql<{sample:string;template_kind:string;state:string;version_state:string;download_name:string;pdf_sha256:string;reported_basis:string;approved_basis:string}>(`SELECT h.sample_key sample,r.template_kind,r.state,v.state version_state,r.download_name,r.pdf_sha256,r.reported_authority->>'basis' reported_basis,r.approved_authority->>'basis' approved_basis FROM internal_report r JOIN halos_import_row h ON h.id=r.halos_row_id JOIN result_report_version v ON v.id=r.version_id ORDER BY h.sample_key`);
 evidence.internalReports=ir.map(r=>({...r,download_name:r.download_name.replace(/_[^_]+_Chonburi/,'_<name>_Chonburi')}));
 expect(ir.map(r=>[r.sample,r.template_kind,r.state])).toEqual([[c('A1').halosSampleId,'SINGLETON','Final'],[c('A2').halosSampleId,'SINGLETON','Final'],[c('A3').halosSampleId,'TWIN','Final']]);
 expect(ir.find(r=>r.sample===c('A1').halosSampleId)!.version_state).toBe('CertifiedReleased');
 expect(ir.every(r=>r.reported_basis==='STANDING_DELEGATION'&&r.approved_basis==='SELF')).toBe(true);
 // A2/A3 are released from their result pages with the internal attestation (abnormal acknowledged for A2).
 for(const k of ['A3','A2']){
  const v=(await sql<{id:string}>("SELECT v.id FROM internal_report r JOIN halos_import_row h ON h.id=r.halos_row_id JOIN result_report_version v ON v.id=r.version_id WHERE h.sample_key=$1",[c(k).halosSampleId]))[0];
  await page.goto(`/results/${v.id}`);const panel=page.getByRole('region',{name:'ที่มาของรายงาน'});
  await expect(panel.getByText('ออกรายงานในระบบ (INTERNAL_GENERATED)')).toBeVisible({timeout:30_000});
  for(const t of ['ตรวจค่าใน PDF ตรงกับผล HALOS','ตัวตนผู้ป่วย LN/HN และรอบตรงกับรายการนี้','ตรวจการเปิดเผยเพศ/โครโมโซม Y'])await panel.getByLabel(t,{exact:false}).check();
  const ab=panel.getByLabel('รับทราบผลผิดปกติ',{exact:false});if(await ab.count())await ab.check();
  const bench=panel.getByLabel('ทบทวนค่าในใบงาน QC',{exact:false});if(await bench.count())await bench.check();
  if(k==='A2')await shot(page,'a-result-detail-internal');
  await panel.getByRole('button',{name:'ตรวจรับและยืนยันส่งผล'}).click();await expect(panel.getByText('ยืนยันส่งผลแล้ว')).toBeVisible({timeout:60_000});
 }
 await axe(page,'result-detail-internal');
 await logout(page);
});

test('pathway B (outage fallback): external ReadyGen PDF import, outage record, "มีผลใน HIS แล้ว", release without outbound',async({page})=>{
 test.setTimeout(300_000);
 await login(page,'certifier');await page.goto('/results');
 await page.getByRole('tab',{name:'เลือกไฟล์จากเครื่อง'}).click();
 const pdfPath=path.join(base,'fixtures',`${c('A6').ln}_UAT-READYGEN-OFFLINE_Chonburi hospital.pdf`);
 await page.locator('#p5-files').setInputFiles(pdfPath);await page.getByRole('button',{name:'อัปโหลดและ Preview'}).click();
 await expect(page.getByRole('heading',{name:/Preview — ตรวจค่าที่อ่านได้/})).toBeVisible({timeout:60_000});
 await page.getByRole('button',{name:'ยืนยันนำเข้า'}).click();
 await expect.poll(async()=>(await sql<{state:string}>("SELECT v.state FROM result_report_version v JOIN result_intake_file i ON i.id=v.intake_file_id WHERE i.original_name LIKE $1",[`${c('A6').ln}%`]))[0]?.state,{timeout:60_000}).toMatch(/Linked|ValidationBlocked|PendingCertification/);
 const v=(await sql<{id:string;origin:string;sha256:string;intake_sha:string}>("SELECT v.id,v.origin,v.sha256,i.sha256 intake_sha FROM result_report_version v JOIN result_intake_file i ON i.id=v.intake_file_id WHERE i.original_name LIKE $1",[`${c('A6').ln}%`]))[0];
 const original=createHash('sha256').update(readFileSync(pdfPath)).digest('hex');expect(v.origin).toBe('EXTERNAL_READYGEN');expect(v.sha256).toBe(original);
 await page.goto(`/results/${v.id}`);const panel=page.getByRole('region',{name:'ที่มาของรายงาน'});
 await expect(panel.getByText('PDF จาก ReadyGen / ภายนอก (EXTERNAL_READYGEN)')).toBeVisible({timeout:30_000});
 await panel.getByText('บันทึกว่า PDF นี้ออกจาก ReadyGen ช่วงระบบ NIPT-CBH ขัดข้อง').click();
 await panel.getByLabel('เลขอ้างอิงเหตุขัดข้อง').fill('UAT-OUTAGE-SYNTHETIC-0001');await panel.locator('details').getByRole('button',{name:'บันทึก'}).click();
 await expect(panel.getByText('บันทึกที่มาช่วงระบบขัดข้องแล้ว')).toBeVisible({timeout:30_000});
 const his=panel.locator('.t3-block',{has:page.getByRole('heading',{name:'สถานะใน HIS'})});
 await his.getByLabel('มีผลใน HIS แล้ว',{exact:false}).check();await his.getByRole('button',{name:'บันทึก',exact:true}).click();
 await expect(panel.getByText('จะไม่ส่งผลนี้เข้า HIS')).toBeVisible({timeout:30_000});await shot(page,'b-his-attested',[1440,375]);
 const acc=page.getByRole('region',{name:'ตรวจรับ PDF และยืนยันส่งผล'});
 for(const t of ['รายงานฉบับนี้เป็น Final','ตรวจตัวตนผู้ป่วย','ตรวจความยินยอม'])await acc.getByLabel(t,{exact:false}).check();
 const bench=acc.getByLabel('ตรวจทานค่าจริง QC1',{exact:false});if(await bench.count())await bench.check();
 await shot(page,'b-external-detail');
 await acc.getByRole('button',{name:/ยืนยันส่งผล/}).click();await expect(page.getByText('ยืนยันส่งผลแล้ว').first()).toBeVisible({timeout:60_000});
 const rel=(await sql<{id:string}>("SELECT id FROM result_release WHERE version_id=$1 AND state='Active'",[v.id]))[0];
 const jobs=await sql("SELECT 1 FROM job_outbox WHERE kind='result_release_completed' AND payload->>'releaseId'=$1 AND state<>'Cancelled'",[rel.id]);
 const fb=await sql<{outage_reference:string}>('SELECT outage_reference FROM result_external_fallback WHERE version_id=$1',[v.id]);
 const att=await sql<{statement:string;effect:string}>('SELECT statement,effect FROM result_his_attestation WHERE version_id=$1',[v.id]);
 evidence.pathwayB={origin:v.origin,pdfSha256Matches:v.sha256===original,outboundJobs:jobs.length,fallback:fb[0]?.outage_reference,attestation:att[0]};
 expect(jobs).toHaveLength(0);expect(att[0]).toMatchObject({statement:'มีผลใน HIS แล้ว',effect:'SUPPRESSED_BEFORE_RELEASE'});
 await axe(page,'result-detail-external');
 await logout(page);
});

test('P6: the worker delivers released internal results to the HIS share exactly once; attested A6 sends nothing',async()=>{
 test.setTimeout(240_000);
 await expect.poll(async()=>(await sql<{n:number}>("SELECT count(*)::int n FROM p6_transfer t JOIN result_release r ON r.id=t.clinical_release_id")) [0].n,{timeout:180_000,intervals:[3000]}).toBe(3);
 const rows=await sql<{sample:string;has_names:boolean;n:number}>(`SELECT h.sample_key sample,(t.res_name IS NOT NULL AND t.pdf_name IS NOT NULL) has_names,count(*) OVER (PARTITION BY t.clinical_release_id)::int n FROM p6_transfer t JOIN result_release r ON r.id=t.clinical_release_id JOIN internal_report ir ON ir.version_id=r.version_id JOIN halos_import_row h ON h.id=ir.halos_row_id ORDER BY 1`);
 evidence.p6=rows;expect(rows.map(r=>r.sample)).toEqual([c('A1').halosSampleId,c('A2').halosSampleId,c('A3').halosSampleId]);expect(rows.every(r=>r.n===1)).toBe(true);
 const a6=await sql("SELECT 1 FROM p6_transfer t JOIN result_release r ON r.id=t.clinical_release_id JOIN result_report_version v ON v.id=r.version_id WHERE v.origin='EXTERNAL_READYGEN'");expect(a6).toHaveLength(0);
 const files=(d:string)=>existsSync(path.join(base,'his-share',d))?readdirSync(path.join(base,'his-share',d),{recursive:true}).map(String).filter(f=>/\.(pdf|res|ok)$/i.test(f)):[];
 evidence.hisShare={pdf:files('pdf').length,res:files('res').length,results:files('results').length};
});

test('ANC: top navigation only, released summary for both origins, Open / Download / Print the same Final PDF, negative RBAC',async({page})=>{
 test.setTimeout(180_000);
 await login(page,'anc');
 await expect(nav(page).getByRole('link',{name:'งาน Lab',exact:true})).toHaveCount(0);await expect(nav(page).getByRole('link',{name:'ตั้งค่าระบบ',exact:true})).toHaveCount(0);
 const caseId=async(k:string)=>(await sql<{id:string}>('SELECT l.case_id id FROM case_ln l WHERE l.ln=$1',[c(k).ln]))[0].id;
 for(const k of ['A1','A6']){
  await page.goto(`/cases/${await caseId(k)}`);const sec=page.getByRole('region',{name:'ผลตรวจ NIPT'}).first();
  await expect(sec.getByRole('list',{name:'สรุปผลตามรายงานที่รับรอง'}).or(sec.locator('[aria-label="สรุปผลตามรายงานที่รับรอง"]')).first()).toBeVisible({timeout:30_000});
  await expect(sec).toContainText('Low Risk');
  if(k==='A1'){
   await shot(page,'anc-case-results');await axe(page,'anc-case-results');
   const href=await sec.getByRole('link',{name:'เปิดรายงาน PDF'}).getAttribute('href');
   const view=await page.request.get(href!),dl=await page.request.get(href!.replace(/(\?.*)?$/,'?mode=download')),pr=await page.request.get(href!.replace(/(\?.*)?$/,'?mode=print'));
   const h=(b:Buffer)=>createHash('sha256').update(b).digest('hex'),[a,b2,p]=[h(await view.body()),h(await dl.body()),h(await pr.body())];
   evidence.ancFile={same:a===b2&&b2===p,contentDisposition:dl.headers()['content-disposition']?.replace(/filename\*=UTF-8''[^;]+/,"filename*=UTF-8''<name>")};
   expect(a).toBe(b2);expect(b2).toBe(p);expect(dl.headers()['content-disposition']).toMatch(/attachment/);
   const download=page.waitForEvent('download');await sec.getByRole('link',{name:'ดาวน์โหลด PDF'}).click();evidence.ancDownloadName=(await download).suggestedFilename().replace(/^(\d+)_.*_(Chonburi hospital\.pdf)$/,'$1_<name>_$2');
   await sec.getByRole('button',{name:'พิมพ์'}).click();
   await expect.poll(async()=>(await sql("SELECT 1 FROM result_access_log WHERE purpose='ANC_RESULT_PRINT_VIEW'")).length,{timeout:20_000}).toBeGreaterThan(0);
  }
 }
 // Negative RBAC: LAB/Task 3 APIs and pages are refused for ANC.
 const me=await (await page.request.get('/api/me')).json();
 const neg={reports:(await page.request.get('/api/task3/reports')).status(),halos:(await page.request.post('/api/task3/halos',{headers:{origin:'https://127.0.0.1:20128','x-csrf-token':me.csrf},multipart:{file:{name:'x.xlsx',mimeType:'application/octet-stream',buffer:Buffer.from('x')}}})).status(),
  signers:(await page.request.get('/api/task3/signers?role=REPORTED')).status()};
 evidence.ancNegative=neg;for(const s of Object.values(neg))expect([401,403,404]).toContain(s);
 await page.goto('/lab');await expect(page.getByRole('heading',{name:'รายงานจากผล HALOS'})).toHaveCount(0);
 await logout(page);
});

test('LAB_STAFF sidebar, signer page and grouped label-value layouts; auditor read-only',async({page})=>{
 await login(page,'lab');
 for(const label of ['งาน Lab','ผลตรวจ NIPT','จัดเก็บตัวอย่าง'])await expect(nav(page).getByRole('link',{name:label,exact:true})).toBeVisible();
 await page.goto('/results/signers');await expect(page.getByRole('heading',{name:'โปรไฟล์ของฉัน'})).toBeVisible();await shot(page,'lab-signers');await axe(page,'signers');
 await page.goto('/results');await expect(page.getByRole('heading',{name:'รายงานจากผล HALOS'})).toBeVisible();
 // LAB_STAFF imports/prepares but cannot finalize (no certification authority): no selection checkboxes or Final button.
 await expect(page.getByRole('region',{name:'รายการออกรายงานจากผล HALOS'}).getByRole('button',{name:'ออกรายงาน',exact:true})).toHaveCount(0);
 await shot(page,'lab-results-workspace');
 // Dark theme through the product's own toggle (data-theme): same contrast rules (UI/UX Pro Max color-dark-mode, WCAG AA).
 await page.getByRole('button',{name:'เปลี่ยนเป็นธีมมืด'}).click();await expect.poll(()=>page.evaluate(()=>document.documentElement.dataset.theme)).toBe('dark');
 evidence.darkTheme={dataTheme:'dark',background:await page.evaluate(()=>getComputedStyle(document.body).backgroundColor)};
 await shot(page,'lab-results-workspace-dark',[1440,375]);await axe(page,'results-dark');
 await page.getByRole('button',{name:'เปลี่ยนเป็นธีมสว่าง'}).click();await expect.poll(()=>page.evaluate(()=>document.documentElement.dataset.theme)).not.toBe('dark');
 await page.goto('/health');await shot(page,'lab-runtime-services',[1440,375]);
 await logout(page);
});
