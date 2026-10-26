// Live: Batch alert spacing (OWNER-LAB-040) at 375/768/1440 light+dark, and the bench Pooling manual-volume highlight (OWNER-LAB-013 "user-edited values highlighted").
import {chromium} from 'playwright';import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
const O='https://127.0.0.1:20228',OUT='.local/claude-evidence-20261025/acceptance-extra';mkdirSync(OUT,{recursive:true});
const fx=JSON.parse(readFileSync('.local/claude-evidence-20261025/integrated-e2e/acceptance-fixture.json','utf8'));
const res=[];const rec=(item,desc,ok,detail)=>{res.push({item,desc,ok:!!ok,detail});console.log((ok?'PASS ':'FAIL ')+item+' '+desc+(detail!==undefined?' '+JSON.stringify(detail).slice(0,240):''));};
const b=await chromium.launch();
async function login(w,theme){const c=await b.newContext({ignoreHTTPSErrors:true,viewport:{width:w,height:900},colorScheme:theme,locale:'th-TH'}),p=await c.newPage();
 await p.goto(O+'/login');await p.fill('#username','lab');await p.fill('#password','lab');await p.press('#password','Enter');await p.waitForURL(x=>!String(x).includes('/login'),{timeout:90000});return {c,p};}
for(const [w,theme] of [[375,'light'],[768,'light'],[1440,'light'],[1440,'dark'],[375,'dark']]){
 const {c,p}=await login(w,theme);await p.goto(`${O}/lab/batches/${fx.draftBatchId}?task=3`,{waitUntil:'networkidle'});if(theme==='dark')await p.evaluate(()=>{document.documentElement.dataset.theme='dark'});
 // Genuine alert: ask for the preview/print of an empty Task List (refused: the Task has no samples).
 const trigger=p.getByRole('button',{name:/ดูตัวอย่าง \/ พิมพ์ PDF Task List 3/});if(await trigger.count())await trigger.click();await p.waitForTimeout(1500);
 const a=p.locator('main [role="alert"].notice, main .notice[role="alert"]').first();
 if(!(await a.count())){rec('OWNER-LAB-040',`${w}${theme[0]}: an alert can be produced for the spacing measurement`,false,{});await c.close();continue;}
 const m=await p.evaluate(()=>{const a=document.querySelector('main [role="alert"].notice');const n=[...document.querySelectorAll('main .tabs, main .action-bar, main .task-tabs, main [role=tablist]')].find(e=>e.compareDocumentPosition(a)&Node.DOCUMENT_POSITION_PRECEDING);if(!n)return null;const ra=a.getBoundingClientRect(),rn=n.getBoundingClientRect();return {gap:Math.round(rn.top-ra.bottom),h:Math.round(ra.height),overflow:document.documentElement.scrollWidth>innerWidth+1,clipped:a.scrollHeight>a.clientHeight+1||a.scrollWidth>a.clientWidth+1,next:n.className||n.getAttribute('role')}});
 rec('OWNER-LAB-040',`${w}${theme[0]}: 16–20 px between the alert and the navigation below it, nothing clipped or overflowing`,!!m&&m.gap>=16&&m.gap<=20&&!m.overflow&&!m.clipped,m);
 await p.screenshot({path:`${OUT}/alert-spacing-${w}-${theme}.png`});await c.close();}
// manual volume highlight on the Pooling tab (not saved)
{const {c,p}=await login(1440,'light');await p.goto(`${O}/lab/batches/${fx.finalBatchId}/bench`,{waitUntil:'networkidle'});await p.getByRole('button',{name:/ขั้นที่ 2/}).click();await p.waitForTimeout(600);
 const pencil=p.getByRole('button',{name:/แก้ปริมาตรตำแหน่ง/}).first();await pencil.click();const d=p.getByRole('dialog');await d.waitFor({timeout:8000});const inp=d.getByRole('textbox').or(d.locator('input')).first();await inp.fill('1.22');
 await d.getByRole('button',{name:/ตกลง|ใช้|บันทึก|ยืนยัน/}).first().click();await p.waitForTimeout(500);
 const cell=await p.locator('td.bench-volume-override').first();const txt=(await cell.innerText().catch(()=>'')).replace(/\s+/g,' ');const low=await p.locator('td.bench-volume-low').count();
 rec('OWNER-LAB-013','a manually edited volume is highlighted and shows the calculated value it replaced',txt.includes('1.22')&&/แก้จาก/.test(txt),{txt});rec('OWNER-LAB-047','a volume below 2 µL is flagged red (calculated and edited values are shown separately)',low>=1,{low});
 await p.screenshot({path:OUT+'/pool-edited-volume-1440.png'});await p.reload({waitUntil:'networkidle'});await p.getByRole('button',{name:/ขั้นที่ 2/}).click();await p.waitForTimeout(500);
 rec('OWNER-LAB-047','the edit is not persisted until "บันทึก Pooling จริง" (reload returns the calculated value)',(await p.locator('td.bench-volume-override').count())===0,{});await c.close();}
await b.close();writeFileSync('.local/claude-evidence-20261025/acceptance-extra3.json',JSON.stringify(res,null,1));console.log(`\n${res.filter(r=>r.ok).length}/${res.length} checks passed`);
