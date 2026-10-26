import {chromium} from 'playwright';
const b=await chromium.launch();const c=await b.newContext({ignoreHTTPSErrors:true});const p=await c.newPage();
p.on('response',async r=>{if(r.url().includes('/api/')||r.status()>=400){console.log(r.status(),r.url(),r.request().postData()?.slice(0,200));if(process.env.BODY)console.log('  <=',(await r.text()).slice(0,Number(process.env.BODY)));if(r.status()>=400)console.log('  ->',(await r.text()).slice(0,500));}});
await p.goto('https://127.0.0.1:20228/login');await p.fill('#username',process.argv[2]??'lab');await p.fill('input[type=password]',process.argv[2]??'lab');await p.press('input[type=password]','Enter');await p.waitForURL(u=>!String(u).includes('/login'));
await p.goto('https://127.0.0.1:20228'+(process.argv[3]??'/sample-storage'),{waitUntil:'networkidle'});await p.waitForTimeout(3000);await b.close();
