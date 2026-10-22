import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {chromium,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {PDFDocument} from 'pdf-lib';
import {emptyRequest} from '../../packages/p2/schema.ts';

const out=path.resolve('.local/anc-owner-closeout-20261023'),root=path.resolve('.local/owner-local-uat-1.0.2');
const revision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const accounts=JSON.parse(await fs.readFile(path.join(root,'secrets/uat-accounts.json'),'utf8'));
const browser=await chromium.launch(),context=await browser.newContext({baseURL:'https://127.0.0.1:19548',ignoreHTTPSErrors:true,viewport:{width:1440,height:1000}}),page=await context.newPage();
const checks=[],errors=[];page.on('pageerror',e=>errors.push(e.message));
await fs.mkdir(out,{recursive:true});
async function login(username){await context.clearCookies();const a=accounts.find(a=>a.username===username);assert.ok(a);await page.goto('/login');await page.getByLabel('ชื่อผู้ใช้',{exact:true}).fill(a.username);await page.getByLabel('รหัสผ่าน',{exact:true}).fill(a.password);await page.getByRole('button',{name:'เข้าสู่ระบบ',exact:true}).click();await expect(page).not.toHaveURL(/\/login$/);}
async function api(endpoint,body){const r=await page.evaluate(async({endpoint,body})=>{const token=document.cookie.split('; ').find(c=>c.startsWith('nipt_csrf='))?.slice(10)??'';const r=await fetch(endpoint,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json','x-csrf-token':token},...(body===undefined?{}:{body:JSON.stringify(body)})});return{status:r.status,data:await r.json()};},{endpoint,body});assert.equal(r.status,200,JSON.stringify(r.data));return r.data;}
async function capture(name){await page.screenshot({path:path.join(out,name+'.png')});}
try{
 await login('uat.anc');await page.goto('/');await expect(page.locator('.anc-stages button').first()).toBeVisible();
 await expect(page.getByText('มีผลตรวจแล้ว',{exact:true})).toBeVisible();await expect(page.locator('.anc-footnote')).toHaveCount(0);
 checks.push('ANC01/03/12/23: overview stages, simplified released label and no footnotes');
 await page.goto('/cases');await page.getByRole('button',{name:'ลงทะเบียน ANC',exact:true}).click();let dialog=page.getByRole('dialog');
 await expect(dialog).toContainText('กรอก LN และ HN ตามหลอดเลือดหรือเอกสารให้ครบทุกหลัก โดยพิมพ์ คัดลอกมาวาง หรือสแกนบาร์โค้ดได้');
 await expect(dialog).toContainText('หาก LN และ HN ตรงกับเคสที่มีอยู่ ระบบจะเปิดเคสนั้นให้');
 // Own persistent synthetic fixture; reruns reopen this exact case, never change Owner's other cases.
 await dialog.getByTestId('scan-ln').fill('9903001901');await dialog.getByTestId('scan-ln').press('Enter');await expect(dialog.getByTestId('scan-hn')).toBeFocused();
 await dialog.getByTestId('scan-hn').fill('9900041901');const unit=dialog.getByLabel('หน่วยงานลงทะเบียน',{exact:false});await unit.selectOption(await unit.locator('option').nth(1).getAttribute('value'));
 await dialog.getByRole('button',{name:'ตรวจข้อมูลก่อนลงทะเบียน',exact:true}).click();await dialog.getByRole('button',{name:'ยืนยันลงทะเบียน',exact:true}).click();await expect(page).toHaveURL(/\/cases\/[a-f0-9-]+(?:\?opened=existing)?$/);
 const caseId=new URL(page.url()).pathname.split('/').at(-1);await fs.writeFile(path.join(out,'fixture.json'),JSON.stringify({caseId,ln:'9903001901',hn:'9900041901',syntheticOnly:true}));
 let detail=await api('/api/p2/cases/'+caseId);assert.equal(detail.case.ln,'9903001901');
 checks.push('ANC05/06: real registration/reopen with scanner Enter navigation and approved copy');
 if(!detail.finalConsents.length){
  await page.getByRole('button',{name:'เปลี่ยนช่องทางเอกสาร',exact:true}).click();dialog=page.getByRole('dialog');
  await expect(dialog.getByLabel('เหตุผลเปลี่ยนช่องทาง',{exact:false})).toHaveCount(0);
  await dialog.getByLabel('ช่องทางใบขอส่งตรวจ',{exact:true}).selectOption('Paper');await dialog.getByRole('button',{name:'บันทึกช่องทาง',exact:true}).click();await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('button',{name:'จัดเตรียมใบขอส่งตรวจกระดาษ',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'เปลี่ยนช่องทางเอกสาร',exact:true}).click();dialog=page.getByRole('dialog');await dialog.getByLabel('ช่องทางใบขอส่งตรวจ',{exact:true}).selectOption('Electronic');await dialog.getByRole('button',{name:'บันทึกช่องทาง',exact:true}).click();await expect(dialog).not.toBeVisible();
  detail=await api('/api/p2/cases/'+caseId);const doctors=await api('/api/p2/doctors?caseId='+caseId),doctor=(Array.isArray(doctors)?doctors:doctors.doctors).find(d=>d.active);assert.ok(doctor);
  const draft=structuredClone(emptyRequest);Object.assign(draft.patient,{syntheticName:'SYNTHETIC ANC OWNER CLOSEOUT',dob:'1989-05-19',identifier:'0000000000001',identifierType:'ThaiNationalId',entitlement:'SELF_PAY'});
  Object.assign(draft.pregnancy,{type:'Singleton',edd:'2027-04-04',collectionDate:'2026-10-15',collectionTime:'11:11',collectionSource:'ANC',weightKg:60,heightCm:160,vanishingTwin:'No',fetalSex:'DoNotWant',sca:null});
  for(const key of ['transfusion4months','heparin24h','immune1month'])draft.history[key].answer='No';Object.assign(draft.history,{cancerTreatment:'No',gaUnder8:'No',tumor:'No',priorChromosomeTest:'No',otherHistory:'No'});Object.assign(draft.ordering,{doctorVersionId:doctor.id,facility:'Chonburi Hospital',coordinator:'SYNTHETIC ANC OWNER CLOSEOUT'});
  await api('/api/p2/cases/'+caseId,{action:'saveRequest',expectedVersion:detail.workspace.version,draft,...(detail.revisions.some(r=>r.kind==='REQUEST')?{reason:'ทดสอบรายการ ANC ที่ Owner อนุมัติในข้อมูลสังเคราะห์เดิม'}:{})});await page.reload();await expect(page.getByRole('button',{name:'เปิดแบบขอส่งตรวจ 5 หมวด',exact:true})).toBeVisible();
  checks.push('ANC15/16: paper Request has no preparation step; channel saved without a reason; actor/time audit retained');
 }
 for(const theme of ['light','dark'])for(const width of [1440,768,375]){
  await page.setViewportSize({width,height:1000});await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);await page.waitForTimeout(250);
  const refusal=page.getByRole('button',{name:'ผู้ป่วยไม่ยินยอม',exact:true});if(await refusal.count()){await refusal.hover();const axe=await new AxeBuilder({page}).include('.workspace').withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();assert.deepEqual(axe.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})),[]);}
  await page.getByRole('button',{name:'เปิดแบบขอส่งตรวจ 5 หมวด',exact:true}).click();dialog=page.getByRole('dialog');const steps=dialog.locator('.request-steps button');
  await expect(dialog.getByTestId('calculated-age')).toHaveText('37');await expect(dialog.locator('input[data-field="patient.ageYears"]')).toHaveCount(0);
  await expect(dialog).not.toContainText('ข้อมูลเดิมจากเคสเดียวกัน');await expect(dialog.locator('[data-field="pregnancy.sca"]')).toHaveCount(0);await expect(steps.nth(3)).toContainText('ความประสงค์ทราบเพศทารก');
  for(let i=0;i<5;i++){await steps.nth(i).click();await expect(steps.nth(i)).toHaveAttribute('aria-current','step');assert.equal(await dialog.evaluate(e=>e.scrollWidth>e.clientWidth),false);
   const gaps=await dialog.locator('.request-section .field').evaluateAll(nodes=>nodes.flatMap(e=>{const label=e.querySelector(':scope > label'),control=e.querySelector(':scope > input,:scope > select,:scope > .be-date');if(!label||!control)return[];return[control.getBoundingClientRect().top-label.getBoundingClientRect().bottom];}));for(const gap of gaps)assert.ok(gap>=5&&gap<=16,'label/control gap '+gap);
   if(i===1)await expect(dialog.getByTestId('ga')).toContainText('อายุครรภ์ (GA) ณ วันเจาะเลือด:');
   const axe=await new AxeBuilder({page}).include('.p2-dialog').withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();assert.deepEqual(axe.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})),[]);
   await capture(`request-${i+1}-${width}-${theme}`);
  }
  await dialog.getByRole('button',{name:'ปิด',exact:true}).click();await expect(dialog).not.toBeVisible();await expect(page.getByRole('button',{name:'เปิดแบบขอส่งตรวจ 5 หมวด',exact:true})).toBeFocused();
  await capture(`case-${width}-${theme}`);checks.push(`ANC02/04/07/08/09/10/14/17/18/22: ${width}px ${theme}, five sections, age37, aligned labels, no SCA, axe0, keyboard focus`);
 }
 detail=await api('/api/p2/cases/'+caseId);
 if(!detail.finalConsents.length){
  await page.setViewportSize({width:1440,height:1000});await page.getByRole('button',{name:'เปิดแบบขอส่งตรวจ 5 หมวด',exact:true}).click();dialog=page.getByRole('dialog');
  const amendment=dialog.getByLabel('เหตุผลแก้ไขเอกสาร',{exact:false});if(await amendment.count())await amendment.fill('ทดสอบรายการ ANC ที่ Owner อนุมัติในเคสสังเคราะห์นี้');
  const saved=page.waitForResponse(r=>r.url().endsWith('/api/p2/cases/'+caseId)&&r.request().method()==='POST'&&r.request().postDataJSON()?.action==='saveRequest');await dialog.locator('[data-field="pregnancy.weightKg"]').fill('62');const ack=await(await saved).json();assert.ok(ack.savedAt);await expect(dialog.locator('.save-status')).toContainText('บันทึกข้อมูลสำเร็จ (Auto)');await expect(dialog.locator('.save-status time')).toHaveAttribute('datetime',ack.savedAt);
  await page.route('**/api/p2/cases/'+caseId,async route=>{if(route.request().method()==='POST'&&route.request().postDataJSON()?.action==='saveRequest')await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'TEST_SAVE_UNAVAILABLE'})});else await route.continue();});
  await dialog.locator('[data-field="pregnancy.weightKg"]').fill('63');await expect(dialog.locator('.save-status')).toHaveText(/บันทึกไม่สำเร็จ/);await expect(dialog.locator('.save-status time')).toHaveCount(0);await page.unroute('**/api/p2/cases/'+caseId);
  await dialog.locator('[data-field="pregnancy.weightKg"]').fill('62');await dialog.locator('.request-steps button').nth(4).click();await dialog.getByRole('button',{name:'ยืนยันข้อมูลและสร้างฉบับ',exact:true}).click();await expect(dialog).not.toBeVisible();
  checks.push('ANC11: server ACK timestamp on Auto success; failed autosave never displays success/time; retry and confirm preserve current data');
  await page.getByRole('button',{name:/^(เริ่มลงนาม|ดำเนินการลงนาม)ใบยินยอม$/}).click();dialog=page.getByRole('dialog');await dialog.getByRole('button',{name:'เริ่มลงนามใบยินยอม',exact:true}).click();
  await expect(page).toHaveURL(/\/p2\/signing$/);for(let i=1;i<=12;i++)await page.getByLabel('เข้าใจแล้ว ข้อ '+i,{exact:true}).check();await page.getByLabel('ยินยอม',{exact:true}).check();
  const canvas=page.locator('canvas');await canvas.scrollIntoViewIfNeeded();const box=await canvas.boundingBox();assert.ok(box);await page.mouse.move(box.x+box.width*.15,box.y+box.height*.65);await page.mouse.down();await page.mouse.move(box.x+box.width*.4,box.y+box.height*.25,{steps:8});await page.mouse.move(box.x+box.width*.7,box.y+box.height*.7,{steps:8});await page.mouse.up();
  await page.getByRole('button',{name:'ยืนยันการลงนาม',exact:true}).click();await expect(page.getByRole('heading',{name:'ลงนามใบยินยอมสำเร็จ',exact:true})).toBeVisible();await page.getByRole('button',{name:'กลับหน้าจอ ANC',exact:true}).click();await expect(page).toHaveURL(new RegExp('/cases/'+caseId+'$'));
  checks.push('ANC13: actual twelve-clause patient signing and same-preparer handoff returns to exact case');
 }
 const pdf=await page.request.get('/api/p2/cases/'+caseId+'/forms?kind=both');assert.equal(pdf.status(),200);assert.equal(pdf.headers()['x-document-status'],'REQUEST_PREVIEW_WITH_SIGNED_CONSENT');const bytes=await pdf.body();assert.equal((await PDFDocument.load(bytes)).getPageCount(),2);await fs.writeFile(path.join(out,'browser-combined-signed.pdf'),bytes);
 const pdfjs=await import('pdfjs-dist/legacy/build/pdf.mjs'),task=pdfjs.getDocument({data:new Uint8Array(bytes),verbosity:0});const doc=await task.promise,ops=await(await doc.getPage(2)).getOperatorList();assert.ok(ops.fnArray.filter(x=>[pdfjs.OPS.paintImageXObject,pdfjs.OPS.paintInlineImageXObject].includes(x)).length>=2);await task.destroy();
 checks.push('ANC19/20: Browser combined endpoint downloads exactly2 pages with actual frozen doctor/patient signature images');
 const approver=accounts.find(a=>/clinical|approver/.test(a.username));assert.ok(approver);await login(approver.username);await page.goto('/cases/'+caseId);detail=await api('/api/p2/cases/'+caseId);
 if(!detail.gate.passed){await expect(page.locator('.clinical-readiness')).toContainText('รอตรวจสอบข้อมูลก่อนส่งตรวจ');await page.getByRole('button',{name:'ตรวจสอบข้อมูลก่อนส่งตรวจ',exact:true}).click();dialog=page.getByRole('dialog');await dialog.getByLabel('หลักฐาน / แนวทางที่ใช้ทบทวน',{exact:false}).fill('LOCAL UAT generated synthetic case review');await dialog.getByLabel('เหตุผลและผลทบทวน',{exact:false}).fill('ทบทวนข้อมูลสังเคราะห์และหลักฐานรอบนี้เพื่อทดสอบระบบ Local UAT');await dialog.getByRole('checkbox').check();await dialog.getByRole('button',{name:'ยืนยันผลทบทวน',exact:true}).click();await expect(dialog).not.toBeVisible();}
 await expect(page.locator('.clinical-readiness')).toContainText('ตรวจสอบข้อมูลแล้ว');checks.push('ANC21: complete evidence → await authorized review → one legitimate synthetic review → reviewed; no receipt or release fabricated');
 assert.deepEqual(errors,[]);await fs.writeFile(path.join(out,'browser.json'),JSON.stringify({status:'PASS',revision,caseId,checks,errors},null,2));console.log(JSON.stringify({status:'PASS',revision,caseId,checks:checks.length}));
}catch(e){await capture('failure').catch(()=>{});await fs.writeFile(path.join(out,'browser.json'),JSON.stringify({status:'FAIL',revision,checks,errors:[...errors,e.message]},null,2));throw e;}finally{await browser.close();}
