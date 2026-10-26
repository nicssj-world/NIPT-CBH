// OWNER-LAB-059 browser sweep (isolated synthetic runtime only): every Settings tab + Health, per viewport and theme.
// Records console errors, failed/4xx/5xx responses, horizontal overflow, and for the settings editor: for every catalog key,
// whether each field control is enabled/disabled and matches settings-field-matrix.json (locked/read-only must be disabled).
import {chromium} from 'playwright';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
const ORIGIN='https://127.0.0.1:20228',OUT=process.argv[2]??'.local/claude-evidence-20261025/settings/browser';mkdirSync(OUT,{recursive:true});
const AUTH=path.join(process.env.TEMP??'.','nipt-claude-his-e2e-auth','admin.json');
const matrix=JSON.parse(readFileSync('.local/claude-evidence-20261025/settings/settings-field-matrix.json','utf8')).rows;
const browser=await chromium.launch();const findings=[];const note=(k,v)=>{findings.push({k,...v});console.log(v.ok===false?'FAIL':'PASS',k,v.detail??'');};
async function session(width,theme){
 let ctx=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width,height:900},colorScheme:theme,...(existsSync(AUTH)?{storageState:AUTH}:{})});let p=await ctx.newPage();
 await p.goto(ORIGIN+'/settings',{waitUntil:'domcontentloaded'});
 if(p.url().includes('/login')){await ctx.close();ctx=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width,height:900},colorScheme:theme});p=await ctx.newPage();
  await p.goto(ORIGIN+'/login');await p.fill('#username','admin');await p.fill('input[type=password]','admin');await p.press('input[type=password]','Enter');await p.waitForURL(u=>!String(u).includes('/login'),{waitUntil:'commit',timeout:60000});await ctx.storageState({path:AUTH});}
 return {ctx,p};
}
const PAGES=[['settings','/settings'],['his','/settings/his'],['users','/settings/users'],['units','/settings/units'],['audit','/settings/audit'],['backup','/settings/backup'],['run-photos','/settings/run-photos'],['health','/health']];
for(const [width,theme] of [[1440,'light'],[768,'light'],[375,'light'],[1440,'dark'],[375,'dark']]){
 const {ctx,p}=await session(width,theme);const errors=[],bad=[];
 p.on('console',m=>{if(m.type()==='error')errors.push(m.text().slice(0,200));});
 p.on('response',r=>{if(r.status()>=400&&!r.url().includes('/_next/'))bad.push(r.status()+' '+r.url().replace(ORIGIN,''));});
 p.on('pageerror',e=>errors.push('pageerror '+String(e).slice(0,200)));
 for(const [name,url] of PAGES){
  errors.length=0;bad.length=0;
  await p.goto(ORIGIN+url,{waitUntil:'networkidle',timeout:60000});await p.waitForTimeout(600);
  const m=await p.evaluate(()=>({overflowX:document.documentElement.scrollWidth>document.documentElement.clientWidth+1,h1:document.querySelector('h1')?.textContent?.trim()??null,buttons:[...document.querySelectorAll('main button, main a.button')].map(b=>({t:(b.textContent||b.getAttribute('aria-label')||'').trim().slice(0,40),d:b.disabled===true})).length,unlabeled:[...document.querySelectorAll('main button, main input:not([type=hidden]), main select, main textarea')].filter(e=>!(e.getAttribute('aria-label')||e.getAttribute('aria-labelledby')||(e.id&&document.querySelector(`label[for="${e.id}"]`))||e.closest('label')||(e.textContent||'').trim()||e.getAttribute('title'))).length}));
  note(`${name}@${width}${theme[0]}`,{ok:!errors.length&&!bad.length&&!m.overflowX&&m.unlabeled===0,detail:JSON.stringify({...m,errors:errors.slice(0,3),bad:bad.slice(0,3)})});
  if(width===1440&&theme==='light'||width===375)await p.screenshot({path:path.join(OUT,`${name}-${width}-${theme}.png`),fullPage:true});
 }
 await ctx.close();
}
// Settings editor: every catalog key, field control enabled-state vs matrix verdict.
{const {ctx,p}=await session(1440,'light');
 const catalog=await p.evaluate(async()=>(await (await fetch('/api/settings')).json()).catalog);
 const canPropose=Object.fromEntries(catalog.map(c=>[c.key,c.canPropose]));
 const COMPOSITE={resProfile:'รูปแบบไฟล์ RES',certifierHisMappings:'รหัสผู้รับรองผลใน HIS'};
 for(const key of [...new Set(matrix.map(r=>r.key))]){
  await p.goto(`${ORIGIN}/settings?key=${key}`,{waitUntil:'networkidle',timeout:60000});await p.waitForTimeout(500);
  for(const r of matrix.filter(x=>x.key===key)){
   // Inspect the REAL rendering of this field: locked/metadata/read-only blocks vs enabled controls.
   const info=await p.evaluate(({label})=>{
    const fields=[...document.querySelectorAll('.setting-fields .field, .setting-fields fieldset, .setting-fields section')];
    const box=fields.find(f=>(f.textContent||'').includes(label));if(!box)return {rendered:false};
    const lockedBlock=box.classList.contains('locked')||!!box.querySelector('.locked-tag');
    const tag=box.querySelector('.locked-tag')?.textContent?.trim()??null;
    const ctl=[...box.querySelectorAll('input,select,textarea')];
    const editable=ctl.some(c=>!(c.disabled||c.readOnly));
    return {rendered:true,lockedBlock,tag,controls:ctl.length,editable};
   },{label:COMPOSITE[r.field]??r.control});
   const lockedVerdict=/LOCKED|NOT IMPLEMENTED|INSTALLATION|FROZEN/.test(r.verdict);
   let ok,detail;
   if(!info.rendered){ok=false;detail=`${r.verdict}; NOT RENDERED in editor`;}
   else if(lockedVerdict){ok=info.lockedBlock&&!info.editable;detail=`${r.verdict}; ${info.lockedBlock?'locked block':'NOT a locked block'}${info.tag?` [${info.tag.slice(0,60)}]`:''}; editable=${info.editable}`;}
   else if(!canPropose[key]){const viewOnly=await p.getByText('สิทธิ์ของคุณใช้ดูข้อมูล').count()>0;ok=!info.editable&&viewOnly;detail=`${r.verdict}; ROLE-GATED for APP_ADMIN (view-only notice shown=${viewOnly}; editable=${info.editable})`;}
   else {ok=(info.controls>0||COMPOSITE[r.field])&&(info.editable||(COMPOSITE[r.field]&&info.controls===0));detail=`${r.verdict}; ${info.controls} control(s) editable=${info.editable}`;}
   note(`editor ${key}.${r.field}`,{ok,detail});
  }
  await p.screenshot({path:path.join(OUT,`editor-${key}.png`),fullPage:true});
 }
 await ctx.close();}
await browser.close();
writeFileSync(path.join(OUT,'sweep.json'),JSON.stringify(findings,null,2));
const fails=findings.filter(f=>f.ok===false);console.log(`DONE total=${findings.length} fail=${fails.length}`);process.exit(fails.length?1:0);
