// Project-wide UX audit in real Chromium against the local synthetic runtime (tools/ux-audit/serve.ts).
// Read-only: it logs in per role, follows same-origin page links (never clicks actions), and measures every discovered route
// at 1440/1280/768/390/375 px: horizontal overflow and its offenders, overlapping controls, small touch targets, BE date
// field geometry, axe WCAG 2.2 AA violations and console/page errors. Writes .local/ux-audit/<label>/report.json + screenshots.
import {chromium,type Page} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import * as fs from 'node:fs/promises';
import path from 'node:path';
const origin=process.env.NIPT_UX_AUDIT_ORIGIN??'http://127.0.0.1:19928';
const label=process.argv[2]??'baseline',out=path.resolve('.local/ux-audit',label);
const widths=(process.env.NIPT_UX_AUDIT_WIDTHS??'1440,1280,768,390,375').split(',').map(Number);
const password=(await fs.readFile(path.resolve('.local/ux-audit/data/secrets/seed-password'),'utf8')).trim();
const AA=['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa'];
// Role that audits each area (first match wins); every role still crawls so role-only pages are found.
const roles=['synthetic.lab','synthetic.anc','synthetic.admin','synthetic.approver','synthetic.certifier','synthetic.auditor'];
const seeds=['/','/cases','/inbound','/lab','/lab/batches','/lab/photos','/results','/historical','/doctors','/health','/settings','/settings/users','/settings/units','/settings/audit','/settings/backup','/settings/run-photos','/password'];
const UUID=/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
const pattern=(u:string)=>{const x=new URL(u,origin);return x.pathname.replace(UUID,':id')+(x.searchParams.get('task')?`?task=${x.searchParams.get('task')}`:'');};
await fs.rm(out,{recursive:true,force:true});await fs.mkdir(path.join(out,'shots'),{recursive:true});
const browser=await chromium.launch();
async function session(user:string){const ctx=await browser.newContext({baseURL:origin,viewport:{width:1440,height:900},locale:'th-TH'});await ctx.addInitScript('window.__name=(f)=>f'); // tsx keepNames helper inside page.evaluate bodies
 const page=await ctx.newPage();
 await page.goto('/login');await page.getByLabel('ชื่อผู้ใช้',{exact:true}).fill(user);await page.getByLabel('รหัสผ่าน',{exact:true}).fill(password);
 await page.getByRole('button',{name:'เข้าสู่ระบบ',exact:true}).click();const ok=await page.waitForURL(u=>!u.pathname.startsWith('/login'),{timeout:15000}).then(()=>true,()=>false);
 if(!ok){console.error(`[ux-audit] login failed for ${user}: ${(await page.locator('[role=alert]').allTextContents()).join(' ')}`);await ctx.close();return null;}return {ctx,page};}
async function settle(page:Page){await page.waitForLoadState('networkidle',{timeout:15000}).catch(()=>{});await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(300);}
// 1. Discover routes per role.
const routes=new Map<string,{url:string;role:string}>();
for(const role of roles){
const s=await session(role);if(!s)continue;const {ctx,page}=s;const queue=[...seeds],seen=new Set<string>();
 while(queue.length&&seen.size<80){const next=queue.shift()!;const p=pattern(next);if(seen.has(p))continue;seen.add(p);
  const res=await page.goto(next).catch(()=>null);if(!res||res.status()>=400||page.url().includes('/login'))continue;await settle(page);
  const final=pattern(page.url());if(final!==p&&routes.has(final))continue;
  if(!routes.has(final))routes.set(final,{url:new URL(page.url()).pathname+new URL(page.url()).search,role});
  const links=await page.$$eval('a[href]',as=>as.map(a=>(a as HTMLAnchorElement).href));
  for(const l of links){const u=new URL(l);if(u.origin!==new URL(origin).origin||u.pathname.startsWith('/api')||u.pathname==='/login')continue;
   const pp=pattern(u.toString());if(!seen.has(pp)&&queue.every(q=>pattern(q)!==pp))queue.push(u.pathname+(u.searchParams.get('task')?`?task=${u.searchParams.get('task')}`:''));}
 }
 await ctx.close();
}
// Home and registry differ per role: measure them for ANC and Admin too.
const extra:[string,string][]=[['/','synthetic.anc'],['/','synthetic.admin'],['/cases','synthetic.anc']];
const dark=process.env.NIPT_UX_AUDIT_DARK==='1';
// 2. Measure each route at each width.
type Finding={route:string;role:string;width:number;status:number;overflowPx:number;offenders:string[];overlaps:string[];smallTargets:number;tinyTargets:string[];dateFields:{row:number;input:number;button:number}[];axe:{id:string;impact:string|null;nodes:number;sample:string}[];console:string[];shot:string};
const findings:Finding[]=[];
const byRole=new Map<string,string[]>();for(const [r,v] of routes){byRole.set(v.role,[...(byRole.get(v.role)??[]),r]);}
for(const [r,role] of extra)if(routes.has(r)&&routes.get(r)!.role!==role)byRole.set(role,[...(byRole.get(role)??[]),r]);
for(const [role,list] of byRole){
 const s=await session(role);if(!s)continue;const {ctx,page}=s;const logs:string[]=[];
 page.on('console',m=>{if(m.type()==='error')logs.push(m.text().slice(0,200));});page.on('pageerror',e=>logs.push('pageerror: '+e.message.slice(0,200)));
 for(const r of list){for(const width of widths){
  logs.length=0;await page.setViewportSize({width,height:width<800?844:900});
  const res=await page.goto(routes.get(r)!.url).catch(()=>null);await settle(page);
  if(dark){await page.evaluate(()=>{document.documentElement.dataset.theme='dark';});await page.waitForTimeout(150);}
  const m=await page.evaluate(()=>{
   const W=window.innerWidth,vis=(e:Element)=>{const s=getComputedStyle(e),b=e.getBoundingClientRect();return s.visibility!=='hidden'&&s.display!=='none'&&b.width>0&&b.height>0&&!e.closest('dialog:not([open]),[hidden]')&&!(e.closest('details:not([open])')&&!e.closest('summary'));}; // closed <details> content still reports boxes in Chromium
   const name=(e:Element)=>{const id=e.id?`#${e.id}`:'';const c=(e.getAttribute('class')??'').split(/\s+/).filter(Boolean).slice(0,2).map(x=>'.'+x).join('');const t=(e.textContent??'').trim().replace(/\s+/g,' ').slice(0,30);return `${e.tagName.toLowerCase()}${id}${c}${t?` "${t}"`:''}`;};
   const clipped=(e:Element)=>{for(let p=e.parentElement;p&&p!==document.body;p=p.parentElement){const s=getComputedStyle(p);if(/(auto|scroll|hidden|clip)/.test(s.overflowX))return true;}return false;};
   const offenders=[...document.body.querySelectorAll('*')].filter(e=>vis(e)&&e.getBoundingClientRect().right>W+1&&!clipped(e)).filter((e,_,all)=>!all.some(o=>o!==e&&o.contains(e))).slice(0,6).map(name);
   const ctrls=[...document.querySelectorAll('button,a.button,input:not([type=hidden]),select,textarea,[role=tab]')].filter(vis);
   const rects=ctrls.map(e=>e.getBoundingClientRect());const overlaps:string[]=[];
   for(let i=0;i<ctrls.length&&overlaps.length<6;i++)for(let j=i+1;j<ctrls.length;j++){const a=rects[i],b=rects[j];const x=Math.min(a.right,b.right)-Math.max(a.left,b.left),y=Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top);
    if(x>2&&y>2&&!ctrls[i].contains(ctrls[j])&&!ctrls[j].contains(ctrls[i])){overlaps.push(`${name(ctrls[i])} × ${name(ctrls[j])}`);break;}}
   const targets=ctrls.filter(e=>!(e instanceof HTMLInputElement&&['checkbox','radio'].includes(e.type)));
   const small=targets.filter(e=>{const b=e.getBoundingClientRect();return b.height<44||b.width<44;});
   const tiny=targets.filter(e=>{const b=e.getBoundingClientRect();return b.height<24||b.width<24;}).slice(0,5).map(name);
   const dateFields=[...document.querySelectorAll('.be-date-row')].filter(vis).map(r=>({row:Math.round(r.getBoundingClientRect().width),input:Math.round(r.querySelector('input')?.getBoundingClientRect().width??0),button:Math.round(r.querySelector('button')?.getBoundingClientRect().width??0)}));
   return {overflowPx:document.documentElement.scrollWidth-W,offenders,overlaps,smallTargets:small.length,tinyTargets:tiny,dateFields};
  });
  const axe=(await new AxeBuilder({page}).withTags(AA).analyze().catch(()=>({violations:[]}))).violations.map(v=>({id:v.id,impact:v.impact??null,nodes:v.nodes.length,sample:v.nodes[0]?.target.join(' ')??''}));
  const shot=`${r.replace(/[/:?=]+/g,'_').replace(/^_|_$/g,'')||'home'}-${role.split('.')[1]}-${width}${dark?'-dark':''}.jpg`;
  await page.screenshot({path:path.join(out,'shots',shot),fullPage:true,type:'jpeg',quality:55}).catch(()=>{});
  findings.push({route:r,role,width,status:res?.status()??0,...m,axe,console:[...logs],shot});
 }}
 await ctx.close();
}
{const ctx=await browser.newContext({baseURL:origin,locale:'th-TH'});await ctx.addInitScript('window.__name=(f)=>f');const page=await ctx.newPage();
 for(const width of widths){await page.setViewportSize({width,height:width<800?844:900});const res=await page.goto('/login');await settle(page);
  if(dark)await page.evaluate(()=>{document.documentElement.dataset.theme='dark';});
  const overflowPx=await page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth);
  const axe=(await new AxeBuilder({page}).withTags(AA).analyze()).violations.map(v=>({id:v.id,impact:v.impact??null,nodes:v.nodes.length,sample:v.nodes[0]?.target.join(' ')??''}));
  const shot=`login-anon-${width}${dark?'-dark':''}.jpg`;await page.screenshot({path:path.join(out,'shots',shot),fullPage:true,type:'jpeg',quality:55});
  findings.push({route:'/login',role:'anonymous',width,status:res?.status()??0,overflowPx,offenders:[],overlaps:[],smallTargets:0,tinyTargets:[],dateFields:[],axe,console:[],shot});}
 await ctx.close();}
await browser.close();
await fs.writeFile(path.join(out,'report.json'),JSON.stringify({origin,label,widths,routes:[...routes].map(([r,v])=>({route:r,...v})),findings},null,1));
const bad=findings.filter(f=>f.overflowPx>0||f.overlaps.length||f.axe.length||f.console.length||f.dateFields.some(d=>d.input<d.row*0.5));
console.log(JSON.stringify({routes:routes.size,measurements:findings.length,withIssues:bad.length,out}));
