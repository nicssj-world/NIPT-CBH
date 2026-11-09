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
// Pooling tab (Owner 2026-11-09): no tick, no select-all and no per-position volume edit any more; a volume below 2 µL is still flagged red
{const {c,p}=await login(1440,'light');await p.goto(`${O}/lab/batches/${fx.finalBatchId}/bench`,{waitUntil:'networkidle'});await p.getByRole('button',{name:'Pooling',exact:true}).click();await p.waitForTimeout(600);
 rec('OWNER-LAB-013','Pooling rows no longer offer a volume pencil or a tick (superseded 2026-11-09)',(await p.getByRole('button',{name:/แก้ปริมาตรตำแหน่ง/}).count())===0&&(await p.getByRole('checkbox',{name:/Pooling จริง/}).count())===0,{});
 rec('OWNER-LAB-047','a volume below 2 µL is flagged red',(await p.locator('td.bench-volume-low').count())>=1,{});
 await p.screenshot({path:OUT+'/pool-volumes-1440.png'});await c.close();}
await b.close();writeFileSync('.local/claude-evidence-20261025/acceptance-extra3.json',JSON.stringify(res,null,1));console.log(`\n${res.filter(r=>r.ok).length}/${res.length} checks passed`);
