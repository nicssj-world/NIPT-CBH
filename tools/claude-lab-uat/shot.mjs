// One screenshot of a route for a user: node shot.mjs <user> <route> <out.png> [width] [theme]
import {chromium} from 'playwright';
const [user,route,out,width='1440',theme='light']=process.argv.slice(2);
const b=await chromium.launch();const c=await b.newContext({ignoreHTTPSErrors:true,viewport:{width:Number(width),height:900}});const p=await c.newPage();
await p.goto('https://127.0.0.1:20228/login');await p.fill('#username',user);await p.fill('input[type=password]',user);await p.press('input[type=password]','Enter');await p.waitForURL(u=>!String(u).includes('/login'));
await p.goto('https://127.0.0.1:20228'+route,{waitUntil:'networkidle'});if(theme==='dark')await p.evaluate(()=>{document.documentElement.dataset.theme='dark'});await p.waitForTimeout(1200);
await p.screenshot({path:out,fullPage:true});console.log((await p.locator('main').innerText()).slice(0,1500));await b.close();
