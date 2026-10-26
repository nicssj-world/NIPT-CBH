import {chromium} from 'playwright';
const b=await chromium.launch();
for(const n of process.argv.slice(2)){const c=await b.newContext({ignoreHTTPSErrors:true}),p=await c.newPage();
 await p.goto('https://127.0.0.1:20228/login');await p.fill('#username',n);await p.fill('input[type=password]',n);await p.press('input[type=password]','Enter');
 await p.waitForTimeout(4000);console.log(n,p.url(),(await p.locator('[role=alert],.notice').allTextContents()).join(' | ').slice(0,300));await c.close();}
await b.close();
