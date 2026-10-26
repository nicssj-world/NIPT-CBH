// Read-only browser inventory of the ISOLATED synthetic LAB UAT (https://127.0.0.1:20228). Visits routes per role, saves screenshots + visible text.
// usage: node tools/claude-lab-uat/inventory.mjs <outDir> [width] [theme] [user,...] [routeFilter]
import {chromium} from 'playwright';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
const [out='.local/claude-evidence-20261025/inventory',width='1440',theme='light',users='admin,lab',filter='']=process.argv.slice(2);
const ORIGIN='https://127.0.0.1:20228';
const fixture=JSON.parse(await readFile('.local/claude-lab-uat-runtime/uat-fixture.json','utf8'));const b=fixture.batchId;
const routes=['/','/cases','/inbound','/lab','/lab/batches','/lab/batches/'+b,'/lab/batches/'+b+'/bench','/lab/batches/'+b+'/pooling','/lab/batches/'+b+'/sequencing','/lab/batches/'+b+'/workbook','/lab/photos','/sample-storage','/historical','/results','/results/signers','/doctors','/health','/settings','/settings/users','/settings/units','/settings/audit','/settings/backup','/settings/run-photos'].filter(r=>!filter||r.includes(filter));
await mkdir(out,{recursive:true});
const browser=await chromium.launch();const summary=[];
for(const user of users.split(',')){
 const ctx=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:Number(width),height:900},colorScheme:theme==='dark'?'dark':'light',locale:'th-TH'});
 const page=await ctx.newPage();const errors=[];page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.goto(ORIGIN+'/login');await page.fill('input[name=username], #username',user);await page.fill('input[type=password]',user);await page.press('input[type=password]','Enter');await page.waitForURL(u=>!String(u).includes('/login'),{timeout:30000});
 if(theme==='dark')await page.evaluate(()=>{document.documentElement.dataset.theme='dark';try{localStorage.setItem('theme','dark')}catch{}});
 for(const r of routes){errors.length=0;const resp=await page.goto(ORIGIN+r,{waitUntil:'networkidle'}).catch(()=>null);
  if(theme==='dark')await page.evaluate(()=>{document.documentElement.dataset.theme='dark'});await page.waitForTimeout(1500);
  const name=`${user}-${width}-${theme}${r.replaceAll('/','_').replace(b,'B')||'_home'}`;
  await page.screenshot({path:path.join(out,name+'.png'),fullPage:true});
  const text=await page.locator('main').innerText().catch(()=>page.locator('body').innerText());
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+1);
  await writeFile(path.join(out,name+'.txt'),text);summary.push({user,route:r,status:resp?.status()??null,url:page.url().replace(ORIGIN,''),overflow,errors:[...errors]});}
 await ctx.close();}
await browser.close();await writeFile(path.join(out,`summary-${width}-${theme}.json`),JSON.stringify(summary,null,1));
console.log(summary.map(s=>`${s.user} ${s.status} ${s.route} -> ${s.url}${s.overflow?' OVERFLOW':''}${s.errors.length?' ERR:'+s.errors[0].slice(0,80):''}`).join('\n'));
