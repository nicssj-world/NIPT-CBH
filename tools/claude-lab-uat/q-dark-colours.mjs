// Focused re-check of OWNER-LAB-036 in dark theme (the earlier failure was the check not re-applying data-theme after navigation).
import {chromium} from 'playwright';import {readFileSync,writeFileSync} from 'node:fs';
const O='https://127.0.0.1:20228',fx=JSON.parse(readFileSync('.local/claude-evidence-20261025/integrated-e2e/acceptance-fixture.json','utf8'));
const b=await chromium.launch(),c=await b.newContext({ignoreHTTPSErrors:true,viewport:{width:1440,height:1000},colorScheme:'dark',locale:'th-TH'}),p=await c.newPage();
await p.goto(O+'/login');await p.fill('#username','lab');await p.fill('#password','lab');await p.press('#password','Enter');await p.waitForURL(x=>!String(x).includes('/login'));
const col={};for(const [k,t] of [['pc',1],['nc',2],['blank',3]]){await p.goto(`${O}/lab/batches/${fx.draftBatchId}?task=${t}`,{waitUntil:'networkidle'});await p.evaluate(()=>{document.documentElement.dataset.theme='dark'});await p.waitForTimeout(300);
 col[k]=await p.evaluate(s=>{const e=document.querySelector(s);return e?getComputedStyle(e.querySelector('th,td')).backgroundColor:null},`tr.row-${k}`);if(k==='blank')await p.screenshot({path:'.local/claude-evidence-20261025/acceptance-live/task-list-1440-dark.png',fullPage:true});}
const ok=col.pc==='rgb(61, 34, 38)'&&col.nc==='rgb(28, 58, 42)'&&col.blank==='rgb(61, 48, 32)';console.log(ok?'PASS':'FAIL',JSON.stringify(col));
const r=JSON.parse(readFileSync('.local/claude-evidence-20261025/acceptance-live.json','utf8'));const x=r.find(y=>y.item==='OWNER-LAB-036'&&/dark/.test(y.desc));x.ok=ok;x.detail=col;x.note='re-run by tools/claude-lab-uat/q-dark-colours.mjs (data-theme re-applied after navigation)';writeFileSync('.local/claude-evidence-20261025/acceptance-live.json',JSON.stringify(r,null,1));
await b.close();
