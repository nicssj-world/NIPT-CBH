import {chromium} from '@playwright/test';
import {writeFile,mkdir} from 'node:fs/promises';
import {PDFDocument} from 'pdf-lib';
import {rasterizePdf} from '../forms/rasterize';
const out='docs/anc-owner-uat-20261025/pdf-evidence';await mkdir(out,{recursive:true});const checks:unknown[]=[];
const browser=await chromium.launch({headless:true});
try{const context=await browser.newContext({ignoreHTTPSErrors:true}),page=await context.newPage();await page.goto('https://127.0.0.1:20128/login');await page.getByLabel('ชื่อผู้ใช้').fill('anc');await page.getByLabel('รหัสผ่าน',{exact:true}).fill('anc');await page.getByRole('button',{name:'เข้าสู่ระบบ',exact:true}).click();await page.waitForURL(u=>u.pathname!='/login');const listing=await (await context.request.get('https://127.0.0.1:20128/api/p2/cases?pageSize=100')).json();const c=listing.cases.find((c:{registration_origin:string})=>c.registration_origin==='ANC');
for(const kind of ['request','consent','both'])for(let repeat=1;repeat<=2;repeat++){const start=Date.now();const r=await context.request.get(`https://127.0.0.1:20128/api/p2/cases/${c.id}/forms?kind=${kind}`,{timeout:45000});const bytes=Buffer.from(await r.body());if(!r.ok()||!bytes.subarray(0,5).equals(Buffer.from('%PDF-'))){checks.push({kind,repeat,status:r.status(),error:bytes.toString().slice(0,200)});continue;}const doc=await PDFDocument.load(bytes);checks.push({kind,repeat,status:r.status(),pages:doc.getPageCount(),elapsedMs:Date.now()-start,hash:r.headers()['x-content-sha256']});if(repeat===1){await writeFile(`${out}/${kind}.pdf`,bytes);const images=await rasterizePdf(bytes,1.5);for(const [i,img] of images.entries())await writeFile(`${out}/${kind}-${i+1}.png`,img);}}
for(const row of listing.cases){const details=await (await context.request.get(`https://127.0.0.1:20128/api/p2/cases/${row.id}`)).json();const results=await (await context.request.get(`https://127.0.0.1:20128/api/p5/cases/${row.id}/results`)).json();await writeFile(`${out}/${row.ln}-facts.json`,JSON.stringify({details,results},null,2));}
}finally{await browser.close();await writeFile(`${out}/checks.json`,JSON.stringify(checks,null,2));console.log(JSON.stringify(checks));}

