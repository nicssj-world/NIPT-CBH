// Read-only debug dump used while writing acceptance-live.mjs (settings nav, draft batch state, ANC card).
import {chromium} from 'playwright';import {readFileSync} from 'node:fs';
const O='https://127.0.0.1:20228',fx=JSON.parse(readFileSync('.local/claude-evidence-20261025/integrated-e2e/acceptance-fixture.json','utf8'));
const b=await chromium.launch();
async function s(u){const c=await b.newContext({ignoreHTTPSErrors:true,viewport:{width:1440,height:1000},locale:'th-TH'});const p=await c.newPage();await p.goto(O+'/login');await p.fill('#username',u);await p.fill('#password',u);await p.press('#password','Enter');await p.waitForURL(x=>!String(x).includes('/login'));return p;}
let p=await s('admin');await p.goto(O+'/settings',{waitUntil:'networkidle'});console.log('SETTINGS NAV:',(await p.getByRole('navigation',{name:/หมวดการตั้งค่า/}).innerText()).replace(/\s+/g,' '));
p=await s('lab');const w=await (await p.request.get(O+'/api/p4/batches/'+fx.draftBatchId)).json();console.log('DRAFT SLOTS FILLED:',(w.slots??[]).filter(x=>x.assignment).length);
await p.goto(O+'/lab/batches/'+fx.draftBatchId,{waitUntil:'networkidle'});console.log('FILL BUTTONS:',await p.getByRole('button',{name:/เติมตัวอย่างจากคิว/}).evaluateAll(e=>e.map(x=>x.disabled)));
p=await s('anc');await p.goto(O+'/cases/'+fx.native.caseId,{waitUntil:'networkidle'});const c=p.getByRole('region',{name:'ผลตรวจ NIPT'});console.log('ANC CARD ACTIONS:',await c.locator('a,button').evaluateAll(e=>e.map(x=>x.tagName+':'+x.innerText.trim()+':'+(x.getAttribute('href')||'')+':'+(x.getAttribute('download')??''))));
await b.close();
