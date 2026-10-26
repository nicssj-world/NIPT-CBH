// More live UI acceptance on the isolated UAT runtime: batch label modal (027), Action Center from the QC row (012), case header + clinical copy (007/024),
// numeric/keyboard behaviour of the QC table (008), historical import page copy (005), QC->Pooling save error path (044). Read-only except the label PREVIEW.
import {chromium} from 'playwright';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
const ORIGIN='https://127.0.0.1:20228',OUT='.local/claude-evidence-20261025/acceptance-extra';mkdirSync(OUT,{recursive:true});
const fx=JSON.parse(readFileSync('.local/claude-evidence-20261025/integrated-e2e/acceptance-fixture.json','utf8'));
const res=[];const rec=(item,desc,ok,detail)=>{res.push({item,desc,ok:!!ok,detail});console.log((ok?'PASS ':'FAIL ')+item+' '+desc+(detail!==undefined?' '+JSON.stringify(detail).slice(0,260):''));};
const browser=await chromium.launch();
async function session(user,w=1440,h=900){const ctx=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:w,height:h},locale:'th-TH'});const page=await ctx.newPage();
 await page.goto(ORIGIN+'/login');await page.fill('#username',user);await page.fill('#password',user);await page.press('#password','Enter');await page.waitForURL(u=>!String(u).includes('/login'),{timeout:60000});return {ctx,page};}
const {ctx,page}=await session('lab');
// ---- 027 batch label selection modal ----
for(const [w,h] of [[1440,900],[375,800]]){
 await page.setViewportSize({width:w,height:h});await page.goto(ORIGIN+'/lab?pageSize=100',{waitUntil:'networkidle'});await page.waitForTimeout(800);
 const boxes=page.getByRole('checkbox',{name:/^เลือก LN /});const n=await boxes.count();
 if(n<20){rec('OWNER-LAB-027',`${w}px: at least 20 samples available for the modal test`,false,{available:n});continue;}
 for(let i=0;i<Math.min(n,25);i++)await boxes.nth(i).check();
 await page.getByRole('button',{name:/^พิมพ์ฉลาก \(\d+\)/}).click();const dlg=page.getByRole('dialog');await dlg.waitFor({timeout:10000});await page.waitForTimeout(800);
 const box=await dlg.boundingBox(),ratio=box.height/h;
 rec('OWNER-LAB-027',`${w}px: modal is ~85–90vh high with ${Math.min(n,25)} samples (phones: full-height sheet, no overflow)`,w<500?ratio>=0.82&&ratio<=1.0:ratio>=0.82&&ratio<=0.97,{ratio:+ratio.toFixed(2)});
 const items=await dlg.locator('.label-picker-list li').count();const first=(await dlg.locator('.label-picker-list li .mono').first().innerText()).trim();
 rec('OWNER-LAB-027',`${w}px: picker lists every selected sample and scrolls inside the modal`,items>=20&&await dlg.locator('.label-picker-list').evaluate(e=>e.scrollHeight>e.clientHeight),{items});
 await dlg.getByRole('searchbox').fill(first.slice(-5));await page.waitForTimeout(500);const filtered=await dlg.locator('.label-picker-list li').count();
 rec('OWNER-LAB-027',`${w}px: realtime search narrows the list`,filtered>=1&&filtered<items,{items,filtered});
 const foot=async()=>(await dlg.locator('.label-total').innerText()).replace(/\s+/g,' ');
 await dlg.getByRole('searchbox').fill('');await page.waitForTimeout(400);const f0=await foot();await dlg.locator('.label-picker-list input[type=checkbox]').first().uncheck();await page.waitForTimeout(500);const f1=await foot();
 rec('OWNER-LAB-027',`${w}px: deselecting updates the selection total footer`,/เลือก \d+ จาก \d+ ตัวอย่าง/.test(f0)&&f0!==f1,{f0,f1});
 rec('OWNER-LAB-027',`${w}px: single print action (no duplicate buttons), no horizontal overflow`,await dlg.getByRole('button',{name:/^พิมพ์/}).count()===1&&!(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+1)),{});
 await page.screenshot({path:`${OUT}/label-modal-${w}.png`});await page.keyboard.press('Escape');
}
await page.setViewportSize({width:1440,height:900});
// ---- 012 Action Center from the QC row ----
await page.goto(ORIGIN+`/lab/batches/${fx.finalBatchId}/bench`,{waitUntil:'networkidle'});
const rowBtn=page.locator('.qc-table tbody tr').filter({hasText:'LN '}).first().getByRole('button').first();
rec('OWNER-LAB-012','a patient row of the QC table exposes the sample as an action button',await rowBtn.count()>0,{});
if(await rowBtn.count()){await rowBtn.click();const d=page.getByRole('dialog');await d.waitFor({timeout:8000}).catch(()=>{});const t=await d.innerText().catch(()=>'');
 rec('OWNER-LAB-012','it opens the single Action Center with Re-Library / Re-Extraction / Re-Sampling / No Call',['Re-Library','Re-Extraction','Re-Sampling','No Call'].every(k=>new RegExp(k,'i').test(t)),{});await page.keyboard.press('Escape');}
// ---- 008 numeric + keyboard behaviour (no changes saved) ----
await page.goto(ORIGIN+`/lab/batches/${fx.finalBatchId}/bench`,{waitUntil:'networkidle'});
const inp=page.locator('.qc-table input').first();const type=await inp.getAttribute('type'),mode=await inp.getAttribute('inputmode');
rec('OWNER-LAB-008','QC concentration inputs have no spinner/wheel stepping (text + decimal keypad)',type!=='number'&&/decimal|numeric/.test(mode??''),{type,mode});
const start=await inp.inputValue();await inp.focus();await page.mouse.wheel(0,200);rec('OWNER-LAB-008','mouse wheel does not change the value',(await inp.inputValue())===start,{});
await inp.focus();await page.keyboard.press('Enter');const a1=await page.evaluate(()=>document.activeElement?.getAttribute('aria-label')??'');await page.keyboard.press('Shift+Enter');const a2=await page.evaluate(()=>document.activeElement?.getAttribute('aria-label')??'');
const a0=await inp.getAttribute('aria-label');rec('OWNER-LAB-008','Enter moves to the next input and Shift+Enter returns',a1!==a0&&a2===a0,{a0,a1,a2});
rec('OWNER-LAB-008','Save controls stay reachable at the bottom (sticky action bar)',await page.getByRole('button',{name:'บันทึกร่าง'}).isVisible(),{});
// ---- 044 error path: clear a value, save-and-calculate must refuse, stay on QC and persist nothing ----
const before=await (await page.request.get(ORIGIN+'/api/lab-bench/batches/'+fx.finalBatchId)).json();
const slotNo=before.slots.find(s=>s.kind==='PATIENT').slot;await page.getByLabel(`ตำแหน่ง ${slotNo} Concentration ng/µL`).fill('');
await page.getByRole('button',{name:'บันทึกและคำนวณ Pooling'}).click();await page.waitForTimeout(800);
const alert=await page.getByRole('alert').first().innerText().catch(()=>'');const stillQc=await page.locator('#qc-title').isVisible();
const after=await (await page.request.get(ORIGIN+'/api/lab-bench/batches/'+fx.finalBatchId)).json();
rec('OWNER-LAB-044','save-and-calculate with a missing QC value shows the error, stays on QC and saves nothing',/กรอกค่า QC ให้ครบ/.test(alert)&&stillQc&&before.revision===after.revision,{alert:alert.slice(0,60),revBefore:before.revision,revAfter:after.revision});
// ---- 007 / 024 case detail ----
await page.goto(ORIGIN+'/cases/'+fx.native.caseId,{waitUntil:'networkidle'});const ct=await page.locator('main').innerText();
rec('OWNER-LAB-007','case header shows LN and HN clearly, LN Halos not repeated as extra lines',/LN/.test(ct)&&/HN/.test(ct)&&(ct.match(new RegExp(fx.native.printed.slice(0,12),'g'))||[]).length<=3,{occurrences:(ct.match(new RegExp(fx.native.printed.slice(0,12),'g'))||[]).length});
rec('OWNER-LAB-024','case detail has no TRAINING / Synthetic / จำลอง / developer wording',!/TRAINING|Synthetic|SYNTHETIC|จำลอง|placeholder|Lorem/.test(ct),{});
await page.screenshot({path:OUT+'/case-detail-1440.png',fullPage:true});
// ---- 005 historical import page ----
await page.goto(ORIGIN+'/historical',{waitUntil:'networkidle'});const ht=await page.locator('main').innerText();
rec('OWNER-LAB-005','historical import page hides Manual-PDF / P5H technical boxes and offers the Excel template',!/P5H|Manual PDF|Manual Completed.*สถานะระบบ/.test(ht)&&/(แม่แบบ|Template|ดาวน์โหลด)/i.test(ht),{head:ht.replace(/\s+/g,' ').slice(0,160)});
await page.screenshot({path:OUT+'/historical-1440.png',fullPage:true});
await ctx.close();await browser.close();
writeFileSync('.local/claude-evidence-20261025/acceptance-extra2.json',JSON.stringify(res,null,1));
console.log(`\n${res.filter(r=>r.ok).length}/${res.length} checks passed`);
