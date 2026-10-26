import {chromium} from 'playwright';
const O='https://127.0.0.1:20228',b=await chromium.launch(),c=await b.newContext({ignoreHTTPSErrors:true,viewport:{width:1440,height:1000},locale:'th-TH'}),p=await c.newPage();
await p.goto(O+'/login');await p.fill('#username','lab');await p.fill('#password','lab');await p.press('#password','Enter');await p.waitForURL(x=>!String(x).includes('/login'));
await p.goto(O+'/sample-storage',{waitUntil:'networkidle'});
console.log('BUTTONS',await p.getByRole('button').allInnerTexts());
console.log('LABELS',await p.locator('main [aria-label]').evaluateAll(e=>e.map(x=>x.getAttribute('aria-label')).filter(Boolean).slice(0,30)));
await b.close();
