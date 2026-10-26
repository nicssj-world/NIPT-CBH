// Owner file 13 + HIS panel changes, verified on released UAT cases (A1 Low Risk Singleton, A2 abnormal, A3 Twin) in the isolated runtime.
// Read-only: opens case pages, fetches the release PDF twice (open + download) and compares bytes.
import {chromium} from 'playwright';
import {existsSync,mkdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
const ORIGIN='https://127.0.0.1:20228',OUT='.local/claude-evidence-20261025/anc-result-ui';mkdirSync(OUT,{recursive:true});
const AUTH=path.join(process.env.TEMP??'.','nipt-claude-his-e2e-auth');
const CASES={A1:'ad9d948a-2960-4c75-9a71-83f9857f26d4',A2:'69ba893b-ce2f-4de5-be93-d2e706513af9',A3:'7576eec1-9e27-4152-9b57-3f073daaa580'};
const log=[];const rec=(id,ok,detail)=>{log.push({id,ok,detail});console.log(ok?'PASS':'FAIL',id,detail===undefined?'':JSON.stringify(detail).slice(0,300));};
const browser=await chromium.launch();
async function open(width,theme){const state=path.join(AUTH,'lab.json');
 let ctx=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width,height:1100},colorScheme:theme,...(existsSync(state)?{storageState:state}:{})}),p=await ctx.newPage();
 await p.goto(ORIGIN+'/',{waitUntil:'commit'});await p.waitForLoadState('domcontentloaded');
 if(p.url().includes('/login')){await ctx.close();ctx=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width,height:1100},colorScheme:theme});p=await ctx.newPage();
  await p.goto(ORIGIN+'/login');await p.fill('#username','lab');await p.fill('#password','lab');await p.getByRole('button',{name:'เข้าสู่ระบบ',exact:true}).click();await p.waitForURL(u=>!String(u).includes('/login'),{waitUntil:'commit',timeout:60000});await ctx.storageState({path:state});}
 return {ctx,p};}
for(const width of [375,768,1440,1920])for(const theme of ['light','dark']){
 const {ctx,p}=await open(width,theme);
 for(const [key,id] of Object.entries(CASES)){
  if((width===768||width===375)&&key==='A2')continue;
  await p.goto(`${ORIGIN}/cases/${id}`,{waitUntil:'networkidle',timeout:60000});await p.evaluate(t=>{document.documentElement.dataset.theme=t;},theme);await p.locator('.anc-result').first().waitFor({timeout:30000});await p.waitForTimeout(300);
  const m=await p.evaluate(()=>{const f=(sel)=>{const e=document.querySelector(sel);return e?parseFloat(getComputedStyle(e).fontSize):null;};   const card=document.querySelector('.anc-result'),cw=card.getBoundingClientRect().width;
   const rows=[...document.querySelectorAll('.anc-result .nipt-table tbody tr')].map(x=>x.getBoundingClientRect().height);
   const buttons=[...document.querySelectorAll('.anc-result .nipt-button')].map(b=>{const x=b.getBoundingClientRect();return {w:x.width,h:x.height,fs:parseFloat(getComputedStyle(b).fontSize)};});
   const his=document.querySelector('.case-his'),edit=document.querySelector('.case-his-edit'),hb=his?.getBoundingClientRect(),eb=edit?.getBoundingClientRect(),hs=his?getComputedStyle(his):null;
   return {cardW:cw,h2:f('.anc-result h2'),meta:f('.anc-result .nipt-result-header p'),qc:f('.anc-result .nipt-qc'),th:f('.anc-result .nipt-table thead th'),rowLabel:f('.anc-result .nipt-table tbody th'),risk:f('.anc-result .nipt-risk'),summary:f('.anc-result .nipt-risk-summary'),
    dt:f('.anc-result .nipt-supplement dt'),dd:f('.anc-result .nipt-supplement dd'),rowH:rows,buttons,cardH:card.getBoundingClientRect().height,
    overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1,cardOverflow:card.scrollWidth>card.clientWidth+1,
    qcText:document.querySelector('.anc-result .nipt-qc')?.textContent?.trim(),riskText:[...document.querySelectorAll('.anc-result .nipt-risk')].map(x=>x.textContent.trim()),
    hisHas:!!his,editText:edit?.textContent?.trim(),editRightGap:hb&&eb?Math.round(hb.right-parseFloat(hs.paddingRight)-eb.right):null,editTopGap:hb&&eb?Math.round(eb.top-hb.top-parseFloat(hs.paddingTop)):null,editH:eb?.height,
    ageLabel:[...document.querySelectorAll('.case-his dt')].map(x=>x.textContent.trim()),oldLabel:document.body.innerText.includes('อายุเต็มปี')||document.body.innerText.includes('กรอกข้อมูลทางคลินิกภายหลัง')};});
  const tag=`${key}@${width}${theme[0]}`,wide=m.cardW>=801;
  if(wide){
   const inRange=(v,lo,hi)=>v>=lo&&v<=hi;
   rec(`13 ${tag} desktop fonts within Owner ranges`,inRange(m.h2,26,28)&&inRange(m.meta,15,16)&&inRange(m.qc,15,16)&&inRange(m.th,15,16)&&inRange(m.rowLabel,16,17)&&inRange(m.risk,14,15)&&inRange(m.summary,14,15)&&m.dt===14&&inRange(m.dd,16,17)&&m.buttons.every(b=>b.fs===15),{h2:m.h2,meta:m.meta,qc:m.qc,th:m.th,rowLabel:m.rowLabel,risk:m.risk,summary:m.summary,dt:m.dt,dd:m.dd,btn:m.buttons[0]?.fs});
   rec(`13 ${tag} compact rows (≤ 62px) and no oversized card`,Math.max(...m.rowH)<=62&&m.cardH<620,{rowH:m.rowH.map(Math.round),cardH:Math.round(m.cardH)});
  }else rec(`13 ${tag} narrow layout keeps readable minimums (≥14px) and 44px targets`,[m.h2,m.th,m.rowLabel,m.risk,m.summary,m.dt,m.dd].every(v=>v>=14)&&m.buttons.every(b=>b.h>=44&&b.fs>=15),{h2:m.h2,btn:m.buttons[0]});
  rec(`13 ${tag} status is text + icon, no overflow/clipping`,/QC\s+(PASS|FAIL)/i.test(m.qcText??'')&&m.riskText.every(t=>t.length>3)&&!m.overflow&&!m.cardOverflow,{qc:m.qcText,risk:m.riskText});
  rec(`13 ${tag} three actions ≥44px high`,m.buttons.length===3&&m.buttons.every(b=>b.h>=44),m.buttons.map(b=>Math.round(b.h)));
  if(m.hisHas){rec(`HIS ${tag} labels: "อายุ (ปี)" present, old labels gone; button "แก้ไขข้อมูล"`,m.ageLabel.includes('อายุ (ปี)')&&!m.oldLabel&&(m.editText==='แก้ไขข้อมูล'||m.editText==null),{dts:m.ageLabel,edit:m.editText});
   if(m.editText&&width>600)rec(`HIS ${tag} edit button sits at the panel's top-right corner`,Math.abs(m.editRightGap)<=2&&Math.abs(m.editTopGap)<=4&&m.editH>=44,{rightGap:m.editRightGap,topGap:m.editTopGap,h:m.editH});}
  else rec(`HIS ${tag} panel present`,false);
  if(width===1440||width===375||(width===1920&&theme==='light'))await p.screenshot({path:path.join(OUT,`case-${key}-${width}-${theme}.png`),fullPage:true});
 }
 await ctx.close();
}
// Functional: open / download return the identical final PDF bytes; the print control exists and responds.
{const {ctx,p}=await open(1440,'light');await p.goto(`${ORIGIN}/cases/${CASES.A1}`,{waitUntil:'networkidle'});await p.locator('.anc-result').first().waitFor();
 const href=await p.locator('.anc-result a.nipt-button.primary').getAttribute('href');
 const res=await p.evaluate(async h=>{const a=await fetch(h);const b=await fetch(h+'?mode=download');const ab=new Uint8Array(await a.arrayBuffer()),bb=new Uint8Array(await b.arrayBuffer());return {a:{s:a.status,t:a.headers.get('content-type'),n:ab.length},b:{s:b.status,d:b.headers.get('content-disposition'),n:bb.length},same:ab.length===bb.length&&ab.every((x,i)=>x===bb[i]),head:String.fromCharCode(...ab.slice(0,5)),hash:Array.from(ab.slice(0,16)).join(',')};},href);
 rec('13 open/download return identical final PDF bytes',res.a.s===200&&res.b.s===200&&res.same&&res.head==='%PDF-'&&/attachment/i.test(res.b.d??''),res);
 await p.locator('.anc-result button.nipt-button').click();await p.getByRole('status').filter({hasText:/พิมพ์|เตรียม/}).first().waitFor({timeout:30000}).then(()=>rec('13 print control responds with a status message',true),()=>rec('13 print control responds with a status message',false));
 await ctx.close();}
await browser.close();
writeFileSync(path.join(OUT,'anc-result-ui.json'),JSON.stringify(log,null,2));
const fails=log.filter(l=>!l.ok);console.log(`DONE total=${log.length} fail=${fails.length}`);process.exit(fails.length?1:0);
