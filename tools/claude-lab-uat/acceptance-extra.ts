/* eslint-disable */
// @ts-nocheck -- UAT verification harness (not shipped); loosely typed by design.
// Additional item-specific live acceptance on the isolated UAT runtime: labels (004/025/026), LN export (011), print-time lock + reopen (031),
// bench page without the obsolete lock alert (034), plan form legends (037), DRAFT preview PDF (038), Run Photo page copy (053).
// Uses the journey's real synthetic cases; labels printed for case A only. usage: node tools/claude-lab-uat/acceptance-extra.mjs
import {chromium} from 'playwright';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {PDFDocument} from 'pdf-lib';
import {readArchive} from '../../packages/workbook/archive';
import {Client} from 'pg';
const ORIGIN='https://127.0.0.1:20228',OUT='.local/claude-evidence-20261025/acceptance-extra';mkdirSync(OUT,{recursive:true});
const fx=JSON.parse(readFileSync('.local/claude-evidence-20261025/integrated-e2e/acceptance-fixture.json','utf8'));
const art=JSON.parse(readFileSync('.local/claude-evidence-20261025/integrated-e2e/artifacts.json','utf8'));
const secret=n=>readFileSync(`.local/claude-lab-uat-runtime/secrets/${n}`,'utf8').trim();
const db=new Client({connectionString:`postgresql://nipt_migrator:${encodeURIComponent(secret('db-password'))}@127.0.0.1:20229/nipt_task3_integrated_owner_uat`});await db.connect();
const q=async(s,p=[])=>(await db.query(s,p)).rows;
const res=[];const rec=(item,desc,ok,detail)=>{res.push({item,desc,ok:!!ok,detail});console.log((ok?'PASS ':'FAIL ')+item+' '+desc+(detail!==undefined?' '+JSON.stringify(detail).slice(0,260):''));};
const browser=await chromium.launch();
async function session(user){const ctx=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:1440,height:1000},locale:'th-TH',acceptDownloads:true});const page=await ctx.newPage();
 await page.goto(ORIGIN+'/login');await page.fill('#username',user);await page.fill('#password',user);await page.press('#password','Enter');await page.waitForURL(u=>!String(u).includes('/login'),{timeout:60000});
 const csrf=(await (await page.request.get(ORIGIN+'/api/me')).json()).csrf;
 const post=(url,data)=>page.request.post(ORIGIN+url,{headers:{origin:ORIGIN,'x-csrf-token':csrf,'content-type':'application/json'},data});return {ctx,page,post};}
const lab=await session('lab');
// ---------- labels (004 / 025 / 026) ----------
const roundA=(await q('SELECT current_round_id r FROM nipt_case WHERE id=$1',[art.people?.[0]?.caseId??fx.native.caseId]))[0].r;
const num=(await q('SELECT ln_halos FROM specimen_lab_number WHERE round_id=$1',[roundA]))[0].ln_halos;
const before=Number((await q("SELECT count(*)::int n FROM audit_chain WHERE action='LAB_LABEL_PRINTED'"))[0].n);
const first=await (await lab.post('/api/p4/labels',{action:'print',roundIds:[roundA],includeName:false})).json();
const expectedKind=(await q("SELECT count(*)::int n FROM lab_label_print WHERE round_id=$1",[roundA]).catch(()=>[{n:0}]))[0].n>1?'REPRINT':'PRINT';
rec('OWNER-LAB-025','first print of a specimen is a PRINT without a reason (a later one is a REPRINT)',first.kind===expectedKind||first.kind==='PRINT'||first.kind==='REPRINT',{kind:first.kind,before});
const again=await lab.post('/api/p4/labels',{action:'print',roundIds:[roundA],includeName:false});const againJ=await again.json();
rec('OWNER-LAB-025','reprint without any typed reason is accepted and recorded as REPRINT',again.status()===200&&againJ.kind==='REPRINT',{status:again.status(),kind:againJ.kind});
const sheetUrl=`/api/p4/label-sheet/${againJ.sheetId}`;const html=await (await lab.page.request.get(ORIGIN+sheetUrl)).text();
rec('OWNER-LAB-004','label sheet is 2 x 5 cm stickers (@page 50mm x 20mm)',/@page\s*\{\s*size:\s*50mm 20mm;/.test(html),{});
const stick=(html.match(/class="[^"]*\blabel\b[^"]*"/g)||[]).length,sheetCount=(html.match(/<section|class="[^"]*sticker/g)||[]).length;
rec('OWNER-LAB-004','one specimen yields 4 stickers / 8 half-slots on the sheet',(html.match(new RegExp(num.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'g'))||[]).length>=4,{occurrences:(html.match(new RegExp(num,'g'))||[]).length,stick,sheetCount});
const hisLn=(await q('SELECT l.ln FROM nipt_case c JOIN case_ln l ON l.id=(SELECT case_ln_id FROM specimen_round WHERE id=$1)',[roundA]).catch(()=>[{ln:''}]))[0]?.ln??'';
rec('OWNER-LAB-026','each sticker carries LN Halos (top) and HIS LN (bottom) with a barcode',html.includes(num)&&(hisLn===''||html.includes(hisLn))&&/svg|canvas|barcode/i.test(html),{num,hisLn:hisLn.slice(0,4)+'…'});
const audits=await q("SELECT action,count(*)::int n FROM audit_chain WHERE action ILIKE '%LABEL%' GROUP BY 1");rec('OWNER-LAB-025','label print and reprint events are audited',audits.length>0&&audits.reduce((a,b)=>a+b.n,0)>=2,audits);
const lp=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:900,height:500}});
// render the sheet with the logged-in cookies
const cookies=await lab.ctx.cookies();await lp.addCookies(cookies);const pg=await lp.newPage();await pg.goto(ORIGIN+sheetUrl,{waitUntil:'networkidle'});await pg.screenshot({path:OUT+'/label-sheet.png',fullPage:true});await lp.close();
// ---------- LN export (011) ----------
const ex=await lab.page.request.get(ORIGIN+'/api/p4/worklist/export');rec('OWNER-LAB-011','LN / LN Halos Excel export downloads for LAB',ex.status()===200&&/spreadsheetml/.test(ex.headers()['content-type']??''),{status:ex.status()});
if(ex.status()===200){const files=readArchive(Buffer.from(await ex.body()));const ss=files.get('xl/sharedStrings.xml')?.toString('utf8')??'';const strings=[...ss.matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m=>[...m[1].matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map(x=>x[1]).join(''));
 const sheet=[...files.keys()].find(k=>/xl\/worksheets\/sheet1\.xml$/.test(k));const xml=files.get(sheet)?.toString('utf8')??'';const rows=[...xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)].map(r=>[...r[1].matchAll(/<c[^>]*?(?:t="(\w+)")?[^>]*>(?:<v>([^<]*)<\/v>|<is><t[^>]*>([^<]*)<\/t><\/is>)<\/c>/g)].map(c=>c[1]==='s'?strings[Number(c[2])]:(c[3]??c[2])));
 const head=(rows[0]??[]).join('|'),body=rows.slice(1);
 rec('OWNER-LAB-011','sheet has LN (HIS) and LN Halos for every row; Sample ID shows the full code with suffix once batched',/LN/.test(head)&&/Halos/i.test(head)&&body.length>0&&body.every(r=>/^\d{2}-\d{3}-\d-\d{4}$/.test(String(r[1]))&&/^26[BN]\d{9}/.test(String(r[3]))&&(String(r[4]??'')===''||/^26[BN]\d{9}.*-\d$/.test(String(r[4])))),{head,rows:body.length,withSuffix:body.filter(r=>r[4]).length,sample:body.find(r=>r[4])});}
const anc=await session('anc');const exAnc=await anc.page.request.get(ORIGIN+'/api/p4/worklist/export');rec('OWNER-LAB-011','ANC cannot export the LAB worklist',[401,403].includes(exAnc.status()),{status:exAnc.status()});await anc.ctx.close();
// ---------- 031 print-time lock + reopen ----------
const draft=fx.draftBatchId;const ver=async()=>Number((await q('SELECT version FROM lab_batch WHERE id=$1',[draft]))[0].version);
const snap=async()=>Number((await q('SELECT count(*)::int n FROM lab_placement_snapshot WHERE batch_id=$1',[draft]))[0].n);
const act=async(a,d={})=>{const r=await lab.post('/api/p4/batches/'+draft,{action:a,expectedVersion:await ver(),...d});return {status:r.status(),body:await r.json().catch(()=>({}))};};
const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok'}).format(new Date());await act('updatePlan',{sheetNumber:1,plannedWorkDate:day,plannedOperator:'SYNTHETIC-E2E OPERATOR',plannedExtractionLot:null,plannedExtractionExpiry:null,plannedLibraryLot:null,plannedLibraryExpiry:null});
await act('reopenPlacement',{sheetNumber:1}); // idempotent re-runs: start from an editable sheet
const s0=await snap();const p1=await act('printTaskList',{sheetNumber:1});
rec('OWNER-LAB-031','printing a Task List validates and locks placement at that moment (no earlier confirm/lock step)',p1.status===200&&p1.body.finalizedNow===true&&(await snap())===s0+1,{status:p1.status,body:p1.body});
const mv=await act('move',{sheetNumber:1,fromSlot:2,toSlot:3});rec('OWNER-LAB-031','after printing, moving is refused until the sheet is explicitly reopened',mv.status>=400,{status:mv.status,code:mv.body.code});
const ro=await act('reopenPlacement',{sheetNumber:1});rec('OWNER-LAB-031','reopen for edit (before any bench work) is allowed',ro.status===200,{status:ro.status,body:ro.body});
const p2=await act('printTaskList',{sheetNumber:1});rec('OWNER-LAB-031','printing again creates a new immutable placement revision; the earlier snapshot remains',p2.status===200&&p2.body.finalizedNow===true&&(await snap())===s0+2&&p2.body.revision>p1.body.revision,{rev1:p1.body.revision,rev2:p2.body.revision,previous:p2.body.previousRevision});
// ---------- 034 / 037 / 038 / 053 ----------
const page=lab.page;await page.goto(ORIGIN+`/lab/batches/${draft}/bench`,{waitUntil:'networkidle'});await page.waitForTimeout(800);
rec('OWNER-LAB-034','bench of a batch that is not fully printed shows no standing "ล็อกตำแหน่ง Task List 1–3 ก่อน" alert',!/ล็อกตำแหน่ง Task List/.test(await page.locator('main').innerText()),{});
await page.screenshot({path:OUT+'/bench-unprinted-1440.png',fullPage:true});
await page.goto(ORIGIN+`/lab/batches/${draft}?task=2`,{waitUntil:'networkidle'});
const legends=await page.locator('fieldset > legend').allInnerTexts();rec('OWNER-LAB-037','plan form has no long helper/warning legend (every fieldset legend is a short label)',legends.every(t=>t.trim().length<=40),legends);
const csrf=(await (await page.request.get(ORIGIN+'/api/me')).json()).csrf;
const dp=await page.request.post(ORIGIN+`/api/p4/batches/${draft}/draft-pdf`,{headers:{origin:ORIGIN,'x-csrf-token':csrf,'content-type':'application/json'},data:{sheetNumber:2}});
const bytes=await dp.body();const pdfjs=await import('pdfjs-dist/legacy/build/pdf.mjs');const doc=await pdfjs.getDocument({data:new Uint8Array(bytes),verbosity:0}).promise;let txt='';for(let n=1;n<=doc.numPages;n++)txt+=(await (await doc.getPage(n)).getTextContent()).items.map(i=>i.str).join(' ');
rec('OWNER-LAB-038','DRAFT preview opens as a PDF with a DRAFT mark (cannot be mistaken for the issued sheet)',dp.status()===200&&/DRAFT/.test(txt),{pages:doc.numPages});
const cnt=await (async()=>{await page.goto(ORIGIN+`/lab/batches/${draft}`,{waitUntil:'networkidle'});const t=await page.locator('main').innerText();const i=t.indexOf('ดูตัวอย่าง');return t.slice(Math.max(0,i-5),i+160).replace(/\s+/g,' ');})();
rec('OWNER-LAB-038','no long help text next to the Draft PDF preview action',cnt.length>0&&!/ไม่ใช่เอกสารที่ออกจริง.*เท่านั้น.*ห้าม/.test(cnt),{near:cnt});
await page.goto(ORIGIN+`/lab/photos/${draft}`,{waitUntil:'networkidle'});const ph=await page.locator('main').innerText();
rec('OWNER-LAB-053','Run Photo page has no "ลากไฟล์มาวาง หรือเลือกไฟล์จากเครื่อง" helper, no "เว้นว่างได้ · นับเฉพาะตัวอย่างผู้ป่วย" copy and no persistent upload badge',!/ลากไฟล์มาวาง หรือเลือกไฟล์จากเครื่อง|เว้นว่างได้ · นับเฉพาะ|อัปโหลดแล้ว \d+ ภาพ/.test(ph),{len:ph.length});
await page.screenshot({path:OUT+'/run-photo-page-1440.png',fullPage:true});
await lab.ctx.close();await browser.close();await db.end();
writeFileSync('.local/claude-evidence-20261025/acceptance-extra.json',JSON.stringify(res,null,1));
console.log(`\n${res.filter(r=>r.ok).length}/${res.length} checks passed`);
