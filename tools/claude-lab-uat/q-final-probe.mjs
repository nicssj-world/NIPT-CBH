// Read-only probe on the isolated synthetic UAT runtime: finds the 400 on /results and the widest element on the batch page at 375.
import {chromium} from 'playwright';
import {readFile} from 'node:fs/promises';
const ORIGIN='https://127.0.0.1:20228';
const fixture=JSON.parse(await readFile('.local/claude-lab-uat-runtime/uat-fixture.json','utf8'));
const browser=await chromium.launch();
const ctx=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:375,height:900},locale:'th-TH'});
const page=await ctx.newPage();
await page.goto(ORIGIN+'/login');await page.fill('#username','lab');await page.fill('#password','lab');await page.press('#password','Enter');await page.waitForURL(u=>!String(u).includes('/login'));
page.on('response',async r=>{if(r.status()>=400)console.log('HTTP',r.status(),r.request().method(),r.url().replace(ORIGIN,''),(await r.text().catch(()=>'')).slice(0,300))});
await page.goto(ORIGIN+'/results',{waitUntil:'networkidle'});await page.waitForTimeout(1500);
await page.goto(ORIGIN+'/lab/batches/'+fixture.batchId+'/pooling',{waitUntil:'networkidle'});await page.waitForTimeout(1500);
const wide=await page.evaluate(()=>{const w=window.innerWidth;const clipped=e=>{if(getComputedStyle(e).position==='absolute')return false;for(let p=e.parentElement;p&&p!==document.body;p=p.parentElement){const o=getComputedStyle(p).overflowX;if(o!=='visible')return true}return false};return [...document.querySelectorAll('body *')].filter(e=>!clipped(e)).map(e=>{const r=e.getBoundingClientRect();return {tag:e.tagName.toLowerCase(),cls:String(e.className).slice(0,60),right:Math.round(r.right),w:Math.round(r.width)}}).filter(x=>x.right>w+1).sort((a,b)=>b.right-a.right).slice(0,8)});
console.log('scrollWidth',await page.evaluate(()=>[document.documentElement.scrollWidth,document.body.scrollWidth,window.innerWidth]));console.log(JSON.stringify(wide,null,1));
const anc=await page.evaluate(()=>{const o=[];let e=document.querySelector('.pool-table');while(e&&e!==document.documentElement){const r=e.getBoundingClientRect(),c=getComputedStyle(e);o.push([e.tagName.toLowerCase()+'.'+String(e.className).slice(0,40),Math.round(r.width),c.overflowX,c.display,c.minWidth]);e=e.parentElement;}return o});console.log(JSON.stringify(anc));await browser.close();
