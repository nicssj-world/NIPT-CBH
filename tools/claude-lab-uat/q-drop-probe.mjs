import {chromium} from 'playwright';
const O='https://127.0.0.1:20228',b=await chromium.launch(),c=await b.newContext({ignoreHTTPSErrors:true,viewport:{width:1440,height:1000},locale:'th-TH'}),p=await c.newPage();
await p.goto(O+'/login');await p.fill('#username','lab');await p.fill('#password','lab');await p.press('#password','Enter');await p.waitForURL(x=>!String(x).includes('/login'));
await p.goto(O+'/results',{waitUntil:'networkidle'});
console.log('buttons',(await p.getByRole('button').allInnerTexts()).slice(0,14));console.log('summaries',await p.locator('summary').allInnerTexts());console.log('details open',await p.locator('details').evaluateAll(d=>d.map(x=>[x.open,x.innerText.slice(0,40)])));
await p.screenshot({path:'.local/claude-evidence-20261025/acceptance-final5/results-1440.png'});await b.close();
