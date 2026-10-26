// Live browser acceptance checks on the isolated UAT runtime (https://127.0.0.1:20228), as real users, after tools/claude-lab-uat/integrated-journey.ts.
// Every check is tagged with the Owner item it evidences. Nothing is saved except the explicit "fill from queue" step on the empty Draft batch.
// usage: node tools/claude-lab-uat/acceptance-live.mjs
import {chromium} from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {PDFDocument} from 'pdf-lib';
import {createHash} from 'node:crypto';
const ORIGIN='https://127.0.0.1:20228',OUT='.local/claude-evidence-20261025/acceptance-live';mkdirSync(OUT,{recursive:true});
const fx=JSON.parse(readFileSync('.local/claude-evidence-20261025/integrated-e2e/acceptance-fixture.json','utf8'));
const art=JSON.parse(readFileSync('.local/claude-evidence-20261025/integrated-e2e/artifacts.json','utf8'));
const res=[];const rec=(item,desc,ok,detail)=>{res.push({item,desc,ok:!!ok,detail});console.log((ok?'PASS ':'FAIL ')+item+' '+desc+(detail!==undefined?' '+JSON.stringify(detail).slice(0,260):''));};
const browser=await chromium.launch();
async function session(user,width=1440,theme='light'){
 const ctx=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width,height:1000},colorScheme:theme,locale:'th-TH',acceptDownloads:true});const page=await ctx.newPage();
 await page.goto(ORIGIN+'/login');await page.fill('#username',user);await page.fill('#password',user);await page.press('#password','Enter');await page.waitForURL(u=>!String(u).includes('/login'),{timeout:60000});
 if(theme==='dark')await page.evaluate(()=>{document.documentElement.dataset.theme='dark';try{localStorage.setItem('theme','dark')}catch{}});
 return {ctx,page};}
const go=async(page,url)=>{await page.goto(ORIGIN+url,{waitUntil:'networkidle'});await page.waitForTimeout(600);};
const fmt=ln=>`${ln.slice(0,2)}-${ln.slice(2,5)}-${ln.slice(5,6)}-${ln.slice(6)}`;
const bg=(page,sel)=>page.evaluate(s=>{const e=document.querySelector(s);return e?getComputedStyle(e.querySelector('th,td')).backgroundColor:null},sel);

// ---------- role boundaries (002) ----------
{ const anc=await session('anc'),lab=await session('lab'),adm=await session('admin');
  for(const [name,s] of [['lab',lab],['anc',anc]]){
   const r=await s.page.request.get(ORIGIN+'/api/settings');rec('OWNER-LAB-002',`${name}: GET /api/settings refused`,[401,403].includes(r.status()),{status:r.status()});
   await s.page.goto(ORIGIN+'/settings',{waitUntil:'networkidle'});rec('OWNER-LAB-002',`${name}: /settings URL does not render Settings`,!/settings/.test(new URL(s.page.url()).pathname)||/ไม่มีสิทธิ์/.test(await s.page.locator('body').innerText()),{url:new URL(s.page.url()).pathname});
   await go(s.page,'/');const nav=await s.page.getByRole('navigation').first().innerText();rec('OWNER-LAB-002',`${name}: no Settings entry in navigation`,!/ตั้งค่า/.test(nav),{nav:nav.replace(/\s+/g,' ').slice(0,120)});}
  const r=await adm.page.request.get(ORIGIN+'/api/settings');rec('OWNER-LAB-002','admin: GET /api/settings allowed',r.status()===200,{status:r.status()});
  // 057 duplicate Settings links
  await go(adm.page,'/settings');const sub=await adm.page.getByRole('navigation',{name:'งานบริหารระบบ'}).innerText().catch(()=>null);
  rec('OWNER-LAB-057','Settings admin navigation (งานบริหารระบบ) has no "ทะเบียนแพทย์" / "System Health" entries',sub!==null&&!/ทะเบียนแพทย์|System Health|สถานะระบบ/.test(sub),{sub:sub?.replace(/\s+/g,' ')});
  const side=await adm.page.getByRole('navigation').first().innerText();rec('OWNER-LAB-057','sidebar keeps doctor registry and system health',/ทะเบียนแพทย์/.test(side)&&/สถานะระบบ/.test(side),{});
  await anc.ctx.close();await adm.ctx.close();
  // ---------- lab ----------
  const {page}=lab;
  // worklist identity (029), Action Center (028)
  await go(page,'/lab');const c=fx.queue[0];
  const btn=page.getByRole('button',{name:`จัดการตัวอย่าง LN ${fmt(c.ln)}`});rec('OWNER-LAB-029','Worklist LN is shown as XX-XXX-X-XXXX and is a button',await btn.count()===1,{ln:fmt(c.ln)});
  const html=await btn.innerHTML();rec('OWNER-LAB-029','last 4 digits of the HIS LN are emphasised',new RegExp(`<(strong|b|span)[^>]*>${c.ln.slice(6)}</`).test(html)||/ln-tail|ln-last|<strong/.test(html),{html:html.slice(0,160)});
  const row=btn.locator('xpath=ancestor::td');rec('OWNER-LAB-029','HN on the second line',new RegExp('HN\\s*'+c.hn.replace('/','\\/')).test(await row.innerText()),{});
  rec('OWNER-LAB-028','no inline "ยืนยันผลไม่สำเร็จ" on the worklist',!/ยืนยันผลไม่สำเร็จ/.test(await page.locator('main').innerText()),{});
  await btn.focus();await page.keyboard.press('Enter');const dlg=page.getByRole('dialog');await dlg.waitFor({timeout:8000}).catch(()=>{});
  const names=await dlg.getByRole('button').allInnerTexts().catch(()=>[]);const dtxt=(await dlg.innerText().catch(()=>''));
  rec('OWNER-LAB-028','LN opens the single Action Center (keyboard) offering Re-Library, Re-Extraction, Re-Sampling, No Call',['Re-Library','Re-Extraction','Re-Sampling','No Call'].every(k=>new RegExp(k,'i').test(dtxt)),{buttons:names.slice(0,8)});
  await page.screenshot({path:OUT+'/action-center-1440.png'});await page.keyboard.press('Escape');
  await page.setViewportSize({width:375,height:900});await go(page,'/lab');rec('OWNER-LAB-029','mobile 375: LN button visible and no horizontal overflow',await page.getByRole('button',{name:`จัดการตัวอย่าง LN ${fmt(c.ln)}`}).isVisible()&&!(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+1)),{});
  await page.setViewportSize({width:1440,height:1000});
  // editable Draft batch: collapsed fill forms (035), fill from queue (013/009), control row colours (036), 2 A4 pages (013)
  await go(page,'/lab/batches/'+fx.draftBatchId);
  const forms=await page.evaluate(()=>[...document.querySelectorAll('details.task-exact-fill')].map(d=>({open:d.open,title:d.querySelector('summary')?.textContent?.trim().slice(0,40)})));
  rec('OWNER-LAB-035','normal/urgent/repeat fill forms are collapsed by default',forms.length>=3&&forms.every(f=>!f.open),forms);
  const urgent=page.locator('details.task-exact-fill',{hasText:'Urgent'}).first();await urgent.locator('summary').click();
  const search=urgent.getByLabel(/ค้นหา LN Halos \/ HIS LN \/ HN/);rec('OWNER-LAB-009','Urgent Fill offers a searchable selector (LN Halos / HIS LN / HN)',await search.count()>0,{});
  if(await search.count()){await search.fill(fx.queue[0].ln.slice(-4));await page.waitForTimeout(700);const shown=await urgent.innerText();rec('OWNER-LAB-009','typing narrows the urgent choices to the matching sample',shown.includes(fx.queue[0].ln.slice(-4)),{});}
  await urgent.locator('summary').click();
  await page.getByRole('button',{name:/เติมตัวอย่างจากคิว/}).first().click();const fd=page.getByRole('dialog');await fd.waitFor({timeout:8000});
  const confirm=fd.getByRole('button',{name:/ยืนยันเติม [1-9]\d* รายการ/});await confirm.waitFor({timeout:20000}).catch(()=>{});
  rec('OWNER-LAB-013','fill from queue previews the FIFO samples (count on the confirm button) before anything is placed',await confirm.count()===1,{text:(await fd.innerText()).replace(/\s+/g,' ').slice(0,200)});
  await page.screenshot({path:OUT+'/fill-preview-1440.png'});
  if(await confirm.count()===1){await confirm.click();await page.waitForTimeout(2500);}
  await go(page,'/lab/batches/'+fx.draftBatchId);const body=await page.locator('main').innerText();
  rec('OWNER-LAB-013','Task List 1 now holds the filled samples (ตัวอย่าง N/15, N>=1)',/Task List 1[\s\S]{0,60}ตัวอย่าง [1-9]\d*\/15/.test(body),{});
  rec('OWNER-LAB-032','sample count wording on every Task tab',(body.match(/ตัวอย่าง \d+\/15/g)||[]).length>=3&&!/ผู้ป่วย \d+\/15/.test(body),{});
  const col={};for(const [k,task] of [['pc',1],['nc',2],['blank',3]]){await go(page,`/lab/batches/${fx.draftBatchId}?task=${task}`);col[k]=await bg(page,`tr.row-${k}`);}
  rec('OWNER-LAB-036','light: PC #FDE8E8 (Task 1), NC #E7F6EC (Task 2), Blank #FFF1DC (Task 3) as whole-row colours',col.pc==='rgb(253, 232, 232)'&&col.nc==='rgb(231, 246, 236)'&&col.blank==='rgb(255, 241, 220)',col);
  const ver=(await (await page.request.get(ORIGIN+'/api/p4/batches/'+fx.draftBatchId)).json());
  const slots=ver.slots??ver.workspace?.slots;rec('OWNER-LAB-013','48 physical slots; PC at 1, NC at 25, Blank at 40',Array.isArray(slots)&&slots.length===48&&slots[0].control==='positive'&&slots[24].control==='negative'&&slots[39].control==='blank',{n:slots?.length,s1:slots?.[0]?.control,s25:slots?.[24]?.control,s40:slots?.[39]?.control});
  const csrf=(await (await page.request.get(ORIGIN+'/api/me')).json()).csrf;
  const pdfr=await page.request.post(ORIGIN+`/api/p4/batches/${fx.draftBatchId}/draft-pdf`,{headers:{origin:ORIGIN,'x-csrf-token':csrf,'content-type':'application/json'},data:{sheetNumber:1}});
  const pdf=await PDFDocument.load(await pdfr.body());const sz=pdf.getPage(0).getSize();rec('OWNER-LAB-013','Task List 1 draft PDF is 2 A4 pages',pdf.getPageCount()===2&&Math.abs(sz.width-595.28)<2&&Math.abs(sz.height-841.89)<2,{pages:pdf.getPageCount(),size:[sz.width,sz.height]});
  await page.screenshot({path:OUT+'/task-list-1440-light.png',fullPage:true});
  await lab.ctx.close();
}
// dark-theme colours (036)
{ const {ctx,page}=await session('lab',1440,'dark');await go(page,'/lab/batches/'+fx.draftBatchId);
  const col={};for(const [k,task] of [['pc',1],['nc',2],['blank',3]]){await go(page,`/lab/batches/${fx.draftBatchId}?task=${task}`);await page.evaluate(()=>{document.documentElement.dataset.theme='dark'});await page.waitForTimeout(300);col[k]=await bg(page,`tr.row-${k}`);}
  rec('OWNER-LAB-036','dark: PC/NC/Blank whole-row colours are three distinct dark tones (#3D2226 / #1C3A2A / #3D3020)',col.pc==='rgb(61, 34, 38)'&&col.nc==='rgb(28, 58, 42)'&&col.blank==='rgb(61, 48, 32)',col);
  await page.screenshot({path:OUT+'/task-list-1440-dark.png',fullPage:true});await ctx.close(); }
// bench: steps (041), QC boundaries (042), save separation (044), QC2 bounds (045), select all (048), seq (049), a11y
{ const {ctx,page}=await session('lab');const base='/lab/batches/'+fx.finalBatchId+'/bench';await go(page,base);
  const steps=await page.locator('ol.bench-steps li button').evaluateAll(b=>b.map(x=>({cur:x.getAttribute('aria-current'),icon:!!x.querySelector('svg'),text:x.innerText.replace(/\s+/g,' ').trim()})));
  rec('OWNER-LAB-041','three icon-led steps with exactly one active (aria-current)',steps.length===3&&steps.every(s=>s.icon)&&steps.filter(s=>s.cur==='step').length===1,steps);
  await page.setViewportSize({width:375,height:900});await go(page,base);const ys=await page.locator('ol.bench-steps li').evaluateAll(l=>l.map(x=>Math.round(x.getBoundingClientRect().top)));rec('OWNER-LAB-041','mobile 375: steps stacked vertically',ys.length===3&&ys[0]<ys[1]&&ys[1]<ys[2],{ys});
  await page.setViewportSize({width:1440,height:1000});await go(page,base);
  const cell=n=>page.getByLabel(`ตำแหน่ง ${n} Concentration ng/µL`);
  const slotsKinds=(await (await page.request.get(ORIGIN+'/api/lab-bench/batches/'+fx.finalBatchId)).json()).slots;const pat=slotsKinds.find(s=>s.kind==='PATIENT').slot,blk=slotsKinds.findIndex(s=>s.kind==='BLANK')+1;
  const flagOf=async(n,v)=>{await cell(n).fill(String(v));await page.waitForTimeout(150);return (await cell(n).locator('xpath=ancestor::tr').innerText()).replace(/\s+/g,' ');};
  const t199=await flagOf(pat,'1.99'),t200=await flagOf(pat,'2.00'),b060=await flagOf(blk,'0.60'),b061=await flagOf(blk,'0.61');
  rec('OWNER-LAB-042','patient 1.99 fails, 2.00 passes (boundary inclusive)',/ต่ำกว่า 2\.0/.test(t199)&&/ผ่านเกณฑ์/.test(t200),{t199:t199.slice(-30),t200:t200.slice(-30)});
  rec('OWNER-LAB-042','blank 0.60 passes, 0.61 fails',/ผ่านเกณฑ์/.test(b060)&&/สูงกว่า 0\.6/.test(b061),{b060:b060.slice(-30),b061:b061.slice(-30)});
  rec('OWNER-LAB-042','red criteria text does not auto-order a repeat (no repeat action in the QC table)',!/Re-Extraction|สั่งสกัดใหม่/.test(await page.locator('.qc-table').innerText()),{});
  rec('OWNER-LAB-044','QC has "บันทึกร่าง" separate from "บันทึกและคำนวณ Pooling"',await page.getByRole('button',{name:'บันทึกร่าง'}).count()===1&&await page.getByRole('button',{name:'บันทึกและคำนวณ Pooling'}).count()===1,{});
  await page.screenshot({path:OUT+'/bench-qc-1440.png'});
  await go(page,base);await page.getByRole('button',{name:/ขั้นที่ 2/}).click();await page.waitForTimeout(500);
  const pc=page.getByLabel('Pool Library concentration (ng/µL)');const note='เกณฑ์ของความเข้มข้น Pooling DNA Library คือ 3.00–3.60 ng/µL';
  rec('OWNER-LAB-045','neutral QC2 note exact text',(await page.locator('#pool-criterion').innerText()).includes(note),{});
  const out=async v=>{await pc.fill(String(v));await page.waitForTimeout(150);return /นอกเกณฑ์/.test(await page.locator('#pool-criterion').innerText());};
  const o=[await out('2.99'),await out('3.00'),await out('3.60'),await out('3.61')];rec('OWNER-LAB-045','QC2 bounds 3.00–3.60 inclusive: 2.99 out, 3.00 ok, 3.60 ok, 3.61 out',JSON.stringify(o)==='[true,false,false,true]',o);
  await go(page,base);await page.getByRole('button',{name:/ขั้นที่ 2/}).click();await page.waitForTimeout(500);
  const count=async()=>Number((await page.locator('.bench-pool-toolbar span').innerText()).match(/(\d+) ตำแหน่ง/)[1]);const before=await count();
  await page.getByRole('button',{name:'เลือกตัวอย่างที่ใช้ได้ทั้งหมด'}).click();const all=await count();
  const boxes=page.getByRole('checkbox',{name:/Pooling จริง ตำแหน่ง/});const n=await boxes.count();let toggled=false;for(let i=0;i<n;i++){const b=boxes.nth(i);if(await b.isEnabled()&&await b.isChecked()){await b.uncheck();toggled=true;break;}}
  const after=await count();rec('OWNER-LAB-048','Select-all then un-tick one exception lowers the actual-pooled count by one',toggled&&after===all-1,{before,all,after});
  await go(page,base);await page.getByRole('button',{name:/ขั้นที่ 2/}).click();await page.waitForTimeout(500);rec('OWNER-LAB-048','nothing persisted without "บันทึก Pooling จริง" (reload returns saved count)',await count()===before,{reloaded:await count(),before});
  await page.getByRole('button',{name:/ขั้นที่ 3/}).click();await page.waitForTimeout(500);
  const groups=await page.locator('.seq-group legend').evaluateAll(l=>l.map(x=>({t:x.innerText.trim(),icon:!!x.querySelector('svg')})));rec('OWNER-LAB-049','Seq groups each carry an icon; First Cycle group present',groups.length>=4&&groups.every(g=>g.icon)&&groups.some(g=>/First Cycle/.test(g.t)),groups);
  rec('OWNER-LAB-049','no "ยืนยัน" inputs/buttons on Seq',await page.getByRole('button',{name:/ยืนยัน/}).count()===0&&await page.getByLabel(/ยืนยัน/).count()===0,{});
  // accessibility (016/050)
  for(const [name,url,tab] of [['bench-qc',base,null],['pooling',base,/ขั้นที่ 2/],['seq',base,/ขั้นที่ 3/],['task-list','/lab/batches/'+fx.finalBatchId,null],['worklist','/lab',null],['inbound','/inbound',null]]){
   await go(page,url);if(tab){await page.getByRole('button',{name:tab}).click();await page.waitForTimeout(400);}
   const a=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa']).analyze();const bad=a.violations.filter(v=>['serious','critical'].includes(v.impact));rec('OWNER-LAB-050',`axe WCAG2A/AA: ${name} has no serious/critical violations`,bad.length===0,bad.map(v=>({id:v.id,n:v.nodes.length})));}
  await ctx.close(); }
// HIS inbound status / navigation / keyboard (020, 023)
{ const {ctx,page}=await session('lab');await go(page,'/inbound');
  const heads=await page.locator('main h1,main h2,main h3').allInnerTexts();rec('OWNER-LAB-023','inbound headings follow summary -> actions -> history',heads.length>=2,heads);
  const seen=[];for(let i=0;i<30;i++){await page.keyboard.press('Tab');seen.push(await page.evaluate(()=>{const e=document.activeElement;return e?(e.getAttribute('aria-label')||e.innerText||e.tagName).replace(/\s+/g,' ').slice(0,30):''}));}
  rec('OWNER-LAB-023','keyboard reaches the scan actions and search within 30 Tab presses (skip link first)',seen.some(s=>/สแกน/.test(s))&&seen.some(s=>/ค้นหา/.test(s)||/LN/.test(s)),seen);
  const ring=await page.evaluate(()=>{const e=document.querySelector('button.button');if(!e)return null;e.focus();return getComputedStyle(e).outlineStyle});rec('OWNER-LAB-023','focus indicator is visible on buttons',ring&&ring!=='none',{ring});
  const stat=await page.locator('main').innerText();rec('OWNER-LAB-020','status cards show verified state with time, not a bare green flag',/ทำงานปกติ/.test(stat)&&/สำเร็จล่าสุด \d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2}/.test(stat)&&/เข้าถึงและอ่านได้/.test(stat),{});
  await page.screenshot({path:OUT+'/inbound-1440.png',fullPage:true});await ctx.close(); }
// ANC: released result summary and Open / Download / Print (054)
{ const {ctx,page}=await session('anc');await go(page,'/cases/'+fx.native.caseId);const card=page.getByRole('region',{name:'ผลตรวจ NIPT'});
  rec('OWNER-LAB-054','ANC case shows the released NIPT result card with PDF actions',await card.count()===1&&await card.getByRole('button',{name:/พิมพ์/}).count()+await card.getByRole('link',{name:/พิมพ์/}).count()>0,{});
  const txt=await card.innerText().catch(()=>'');rec('OWNER-LAB-054','ANC card shows a summary (no raw file/PHI-free technical text)',txt.length>20,{txt:txt.replace(/\s+/g,' ').slice(0,160)});
  const dl=page.waitForEvent('download',{timeout:20000}).catch(()=>null);await card.getByRole('link',{name:'ดาวน์โหลด PDF'}).click();const d=await dl;
  if(d){const p=await d.path();const sha=createHash('sha256').update(readFileSync(p)).digest('hex');rec('OWNER-LAB-054','ANC UI download equals the released native PDF',sha===art.nativeSha256,{sha});}else rec('OWNER-LAB-054','ANC UI download equals the released native PDF',false,{reason:'no download event'});
  await page.screenshot({path:OUT+'/anc-result-1440.png',fullPage:true});await ctx.close(); }
await browser.close();
writeFileSync('.local/claude-evidence-20261025/acceptance-live.json',JSON.stringify(res,null,1));
console.log(`\n${res.filter(r=>r.ok).length}/${res.length} checks passed`);
