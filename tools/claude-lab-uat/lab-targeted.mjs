// Targeted LAB verification on the isolated synthetic runtime (read-only; PDFs are generated, nothing is issued):
// 046 PDF modal (real bytes, forced failure → Retry), 016 specimen card accents, 021 LN visibility per role.
import {chromium} from 'playwright';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
const ORIGIN='https://127.0.0.1:20228',OUT='.local/claude-evidence-20261025/lab-targeted';mkdirSync(OUT,{recursive:true});
const AUTH=path.join(process.env.TEMP??'.','nipt-claude-his-e2e-auth');mkdirSync(AUTH,{recursive:true});
const fixture=JSON.parse(readFileSync('.local/claude-lab-uat-runtime/uat-fixture.json','utf8')),BATCH=fixture.batchId;
const log=[];const rec=(id,ok,detail)=>{log.push({id,ok,detail});console.log(ok?'PASS':'FAIL',id,detail===undefined?'':JSON.stringify(detail).slice(0,280));};
const browser=await chromium.launch();
async function ctxFor(name,width=1440,theme='light'){const state=path.join(AUTH,name+'.json');
 let ctx=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width,height:1000},colorScheme:theme,...(existsSync(state)?{storageState:state}:{})}),p=await ctx.newPage();
 await p.goto(ORIGIN+'/',{waitUntil:'commit'});await p.waitForLoadState('domcontentloaded');
 if(p.url().includes('/login')){await ctx.close();ctx=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width,height:1000},colorScheme:theme});p=await ctx.newPage();
  await p.goto(ORIGIN+'/login');await p.fill('#username',name);await p.fill('#password',name);await p.getByRole('button',{name:'เข้าสู่ระบบ',exact:true}).click();await p.waitForURL(u=>!String(u).includes('/login'),{waitUntil:'commit',timeout:60000});await ctx.storageState({path:state});}
 return {ctx,p};}

// ── 046: PDF modals ──
{const {ctx}=await ctxFor('lab');
 const page=await ctx.newPage();const errors=[];page.on('pageerror',e=>errors.push(String(e).slice(0,160)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text().slice(0,160));});
 await page.goto(`${ORIGIN}/lab/batches/${BATCH}/pooling`,{waitUntil:'networkidle',timeout:60000});
 await page.goto(`${ORIGIN}/lab/batches/${BATCH}/bench`,{waitUntil:'networkidle',timeout:60000});
 const buttons=await page.getByRole('button',{name:/ดูตัวอย่าง \/ พิมพ์/}).allTextContents();rec('046 PDF buttons present on the bench page',buttons.length>=1,buttons);
 for(const label of [...new Set(buttons)]){
  const btn=page.getByRole('button',{name:label,exact:true}).first();if(await btn.isDisabled()){rec(`046 button "${label}" enabled`,false,{disabled:true});continue;}
  const respP=page.waitForResponse(r=>r.request().method()==='POST'&&/\/api\/(workbook|p4b|lab-bench)\//.test(r.url())&&(r.request().postData()??'').includes('PDF'),{timeout:60000}).catch(()=>null);
  await btn.click();const resp=await respP;
  const dialog=page.getByRole('dialog');await dialog.waitFor({timeout:30000});
  await dialog.locator('canvas,iframe,object,embed').first().waitFor({timeout:60000}).catch(()=>{});
  // Playwright cannot read the body of a response the page consumed as a blob, so the bytes are measured by replaying the identical request in-page.
  const req=resp?JSON.parse(resp.request().postData()??'{}'):{};
  const replay=await page.evaluate(async({url,body})=>{const me=await (await fetch('/api/me')).json();const r=await fetch(url,{method:'POST',headers:{'content-type':'application/json','x-csrf-token':me.csrf},body:JSON.stringify(body)});const b=new Uint8Array(await r.arrayBuffer());return {status:r.status,type:r.headers.get('content-type'),bytes:b.length,head:String.fromCharCode(...b.slice(0,5)),eof:String.fromCharCode(...b.slice(-6)).includes('%%EOF')};},{url:resp?resp.url():'',body:req});
  const meta=await dialog.evaluate(d=>({canvases:d.querySelectorAll('canvas').length,frames:d.querySelectorAll('iframe,object,embed').length,alert:d.querySelector('[role=alert]')?.textContent??null,text:d.innerText.slice(0,120)}));
  rec(`046 "${label}" opens with real PDF bytes and renders pages`,!!resp&&resp.status()===200&&(resp.headers()['content-type']??'').includes('pdf')&&replay.head==='%PDF-'&&replay.eof&&replay.bytes>5000&&!meta.alert&&meta.canvases>0,{status:resp?.status(),replay,...meta});
  await page.screenshot({path:path.join(OUT,`pdf-modal-${label.replace(/[^A-Za-z]+/g,'-')}.png`)});
  await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden',timeout:10000}).catch(()=>{});
 }
 // Forced failure → explicit error with Retry → retry succeeds (no stale blob, no silent failure).
 const unexpected=errors.slice();   // anything logged so far was not caused by the deliberate network abort below
 const first=page.getByRole('button',{name:/ดูตัวอย่าง \/ พิมพ์ QC/}).first();
 let blockOnce=true;await page.route(/\/api\/workbook\//,route=>{if(blockOnce&&route.request().method()==='POST'&&(route.request().postData()??'').includes('PDF')){blockOnce=false;return route.abort('failed');}return route.continue();});
 await first.click();const dlg=page.getByRole('dialog');await dlg.getByRole('alert').waitFor({timeout:20000});
 rec('046 network failure shows an explicit error inside the modal with Retry',await dlg.getByRole('button',{name:/ลองอีกครั้ง|Retry/}).count()>0,{alert:(await dlg.getByRole('alert').innerText()).slice(0,120)});
 await dlg.getByRole('button',{name:/ลองอีกครั้ง|Retry/}).first().click();await dlg.locator('canvas,iframe,object,embed').first().waitFor({timeout:60000});
 rec('046 Retry loads the PDF',true);await page.unroute(/\/api\/workbook\//);
 rec('046 no page errors / console errors during the normal PDF flows (the one logged after is the deliberate abort)',unexpected.length===0&&errors.slice(unexpected.length).every(e=>/ERR_FAILED|Failed to fetch/.test(e)),{normal:unexpected.slice(0,3),afterAbort:errors.slice(unexpected.length)});
 await ctx.close();}

// ── 016: specimen row accent (worklist, "อยู่ใน Batch / กำลังทำ" tab has rows in the UAT data) ──
for(const [width,theme] of [[1440,'light'],[1440,'dark'],[768,'light'],[375,'light']]){
 const {ctx,p}=await ctxFor('lab',width,theme);await p.goto(ORIGIN+'/lab',{waitUntil:'networkidle',timeout:60000});
 await p.getByRole('button',{name:/อยู่ใน Batch/}).click().catch(()=>p.getByText(/อยู่ใน Batch/).first().click());await p.waitForTimeout(1200);
 const m=await p.evaluate(()=>{const rows=[...document.querySelectorAll('tr.spec-row')];const first=rows.map(r=>({cls:[...r.classList].find(c=>c.startsWith('spec-')&&c!=='spec-row'),shadow:getComputedStyle(r.querySelector('td')).boxShadow,status:r.querySelector('.status')?.textContent?.trim()}));
  return {rows:rows.length,accented:first.filter(x=>x.shadow&&x.shadow!=='none').length,sample:first.slice(0,3),overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1};});
 rec(`016 /lab@${width}${theme[0]} every specimen row carries a state accent AND a status label; no overflow`,m.rows>0&&m.accented===m.rows&&m.sample.every(x=>x.status)&&!m.overflow,m);
 await p.screenshot({path:path.join(OUT,`lab-rows-${width}-${theme}.png`)});await ctx.close();}

// ── 021: full LN for authorized LAB/IT/Admin on the HIS-receipt page; masking for roles without LN privilege is asserted by
//    tests/contracts/p3-inbound.test.ts + tests/db/inbound-paging.test.ts (a role without LN privilege reads '••••0001'). ──
const lnFull=fixture.registrationPet[0].ln;
for(const user of ['admin','lab']){
 const {ctx}=await ctxFor(user);const page=await ctx.newPage();
 await page.goto(ORIGIN+'/inbound',{waitUntil:'networkidle',timeout:60000});
 const text=await page.evaluate(()=>document.body.innerText);const full=text.includes(lnFull),masked=/••••\d{4}/.test(text);
 rec(`021 ${user}: full LN visible on รับตัวอย่างจาก HIS (no masking)`,new URL(page.url()).pathname==='/inbound'&&full&&!masked,{path:new URL(page.url()).pathname,full,masked});
 await ctx.close();}
{const {ctx}=await ctxFor('approver');const page=await ctx.newPage();await page.goto(ORIGIN+'/inbound',{waitUntil:'networkidle',timeout:60000});
 rec('021 role without his.scan is redirected away from the inbound page (no LN list exposed there)',new URL(page.url()).pathname!=='/inbound',{path:new URL(page.url()).pathname});await ctx.close();}
await browser.close();
writeFileSync(path.join(OUT,'lab-targeted.json'),JSON.stringify(log,null,2));
const fails=log.filter(l=>!l.ok);console.log(`DONE total=${log.length} fail=${fails.length}`);process.exit(fails.length?1:0);
