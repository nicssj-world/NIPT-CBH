// Owner 2026-10-26 UI-01..05 verification on the isolated synthetic runtime: DOM geometry + real interactions + screenshots
// at 375/768/1440/1920, light and dark. No data is changed (login/logout only).
import {chromium} from 'playwright';
import {mkdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
const ORIGIN='https://127.0.0.1:20228',OUT='.local/claude-evidence-20261025/ui-login-anc';mkdirSync(OUT,{recursive:true});
const AUTH=path.join(process.env.TEMP??'.','nipt-claude-his-e2e-auth');mkdirSync(AUTH,{recursive:true});
const log=[];const rec=(id,ok,detail)=>{log.push({id,ok,detail});console.log(ok?'PASS':'FAIL',id,detail===undefined?'':JSON.stringify(detail).slice(0,260));};
const browser=await chromium.launch();
const WIDTHS=[375,768,1440,1920],THEMES=['light','dark'];
const near=(a,b,t=1.5)=>Math.abs(a-b)<=t;
const setTheme=async(page,theme)=>{await page.evaluate(t=>{document.documentElement.dataset.theme=t;try{localStorage.setItem('theme',t);}catch{}},theme);};
const lum=c=>{const [r,g,b]=c.match(/\d+(\.\d+)?/g).slice(0,3).map(Number).map(v=>{v/=255;return v<=.03928?v/12.92:((v+.055)/1.055)**2.4;});return .2126*r+.7152*g+.0722*b;};
const contrast=(a,b)=>{const [x,y]=[lum(a),lum(b)].sort((p,q)=>q-p);return (x+.05)/(y+.05);};

// ── Login page (unauthenticated) ──
for(const width of WIDTHS)for(const theme of THEMES){
 const ctx=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width,height:900},colorScheme:theme}),page=await ctx.newPage();
 await page.goto(ORIGIN+'/login',{waitUntil:'networkidle'});await setTheme(page,theme);await page.waitForTimeout(250);
 const m=await page.evaluate(()=>{const r=e=>{const b=e?.getBoundingClientRect();return b?{l:b.left,r:b.right,t:b.top,b:b.bottom,w:b.width,h:b.height}:null;};
  const art=document.querySelector('.login-art'),img=art?.querySelector('img'),h2=art?.querySelector('h2'),p=art?.querySelector('p');
  const artVisible=!!art&&getComputedStyle(art).display!=='none'&&art.getBoundingClientRect().width>0;
  const parts=[img,h2,p].filter(Boolean).map(r),lock=parts.length?{l:Math.min(...parts.map(x=>x.l)),r:Math.max(...parts.map(x=>x.r)),t:Math.min(...parts.map(x=>x.t)),b:Math.max(...parts.map(x=>x.b))}:null;
  const ph=document.querySelector('.hospital-logo'),pl=document.querySelector('.login-logo-row .product-logo'),input=document.querySelector('#password'),toggle=document.querySelector('.password-toggle'),title=document.querySelector('.login-title-row'),theme=title?.querySelector('.theme-button');
  const ib=r(input),tb=r(toggle),iStyle=input?getComputedStyle(input):null;
  return {artVisible,art:r(art),lock,hospital:r(ph),product:r(pl),hospitalNat:ph?{w:ph.naturalWidth,h:ph.naturalHeight}:null,input:ib,toggle:tb,padRight:parseFloat(iStyle?.paddingRight??'0'),
   oldCheckbox:!!document.querySelector('#password ~ .check-label, .login-panel input[type=checkbox]'),oldThemeRow:!!document.querySelector('.login-theme'),themeInTitle:!!theme,title:r(title),themeBtn:r(theme),
   overflowX:document.documentElement.scrollWidth>document.documentElement.clientWidth+1,bodyBg:getComputedStyle(document.body).backgroundColor,toggleColor:toggle?getComputedStyle(toggle).color:null,inputBg:iStyle?.backgroundColor};});
 const tag=`login@${width}${theme[0]}`;
 if(m.artVisible){const cx=(m.art.l+m.art.r)/2,cy=(m.art.t+m.art.b)/2,lx=(m.lock.l+m.lock.r)/2,ly=(m.lock.t+m.lock.b)/2;
  rec(`UI-01 ${tag} lockup centred in left pane`,near(cx,lx,6)&&near(cy,ly,Math.max(8,m.art.h*0.02)),{paneCenter:[cx,cy].map(Math.round),lockCenter:[lx,ly].map(Math.round)});}
 else rec(`UI-01 ${tag} left pane hidden on small screen; login remains usable`,width<=900&&m.input!==null);
 const hRatio=m.hospital.h/m.product.h;rec(`UI-02 ${tag} hospital mark optically balanced with NIPT mark`,hRatio>=0.9&&hRatio<=1.3&&near(m.hospital.w/m.hospital.h,m.hospitalNat.w/m.hospitalNat.h,0.03),{hospital:[m.hospital.w,m.hospital.h].map(Math.round),product:[m.product.w,m.product.h].map(Math.round)});
 rec(`UI-03 ${tag} eye button inside the password field, right-inset, ≥44px, no overlap with text`,!m.oldCheckbox&&m.toggle.l>=m.input.l&&m.toggle.r<=m.input.r+0.5&&m.toggle.w>=43.5&&m.toggle.h>=43.5&&m.padRight>=m.toggle.w+4-2,{toggle:[m.toggle.w,m.toggle.h].map(Math.round),padRight:m.padRight});
 rec(`UI-04 ${tag} theme button integrated on the title row (no detached row)`,m.themeInTitle&&!m.oldThemeRow&&m.themeBtn.r<=m.title.r+0.5&&m.themeBtn.w>=43.5,{title:[Math.round(m.title.l),Math.round(m.title.r)],theme:[Math.round(m.themeBtn.l),Math.round(m.themeBtn.r)]});
 rec(`${tag} no horizontal overflow`,!m.overflowX);
 if(theme==='dark')rec(`UI-03 ${tag} eye icon contrast ≥3:1 on the field`,contrast(m.toggleColor,m.inputBg.startsWith('rgba(0, 0, 0, 0)')?m.bodyBg:m.inputBg)>=3,{ratio:+contrast(m.toggleColor,m.inputBg.startsWith('rgba(0, 0, 0, 0)')?m.bodyBg:m.inputBg).toFixed(2)});
 await page.screenshot({path:path.join(OUT,`login-${width}-${theme}.png`)});await ctx.close();
}

// ── Login interactions: eye toggle, theme button, a real login with the toggle used, logout ──
{const ctx=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:1440,height:900}}),page=await ctx.newPage();
 await page.goto(ORIGIN+'/login',{waitUntil:'networkidle'});
 await page.fill('#username','anc');await page.fill('#password','anc');
 const t=page.locator('.password-toggle'),pw=page.locator('#password');
 rec('UI-03 password hidden by default',await pw.getAttribute('type')==='password'&&await t.getAttribute('aria-label')==='แสดงรหัสผ่าน'&&await t.getAttribute('aria-pressed')==='false');
 await t.click();rec('UI-03 click shows password; aria-label/pressed toggle',await pw.getAttribute('type')==='text'&&await t.getAttribute('aria-label')==='ซ่อนรหัสผ่าน'&&await t.getAttribute('aria-pressed')==='true'&&await pw.inputValue()==='anc');
 await t.focus();await page.keyboard.press('Enter');rec('UI-03 keyboard (Enter on focused eye) hides again and does not submit the form',await pw.getAttribute('type')==='password'&&page.url().includes('/login'));
 await page.keyboard.press('Space');rec('UI-03 keyboard Space toggles',await pw.getAttribute('type')==='text');
 const before=await page.evaluate(()=>document.documentElement.dataset.theme);await page.locator('.login-title-row .theme-button').click();const after=await page.evaluate(()=>document.documentElement.dataset.theme);
 rec('UI-04 theme button still switches theme from its new place',before!==after,{before,after});
 await page.locator('.login-title-row .theme-button').click();
 await page.getByRole('button',{name:'เข้าสู่ระบบ',exact:true}).click();await page.waitForURL(u=>!String(u).includes('/login'),{waitUntil:'commit',timeout:60000});
 rec('login still works after using the eye (autoComplete/CSRF intact)',!page.url().includes('/login'),{url:page.url().replace(ORIGIN,'')});
 await ctx.storageState({path:path.join(AUTH,'anc.json')});await ctx.close();}

// ── ANC header: geometry on Overview / Central Registry / Doctor Registry ──
const PAGES=[['overview','/'],['cases','/cases'],['doctors','/doctors']];
for(const width of WIDTHS)for(const theme of THEMES){
 const ctx=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width,height:900},colorScheme:theme,storageState:path.join(AUTH,'anc.json')}),page=await ctx.newPage();
 for(const [name,url] of PAGES){
  await page.goto(ORIGIN+url,{waitUntil:'networkidle',timeout:60000});await setTheme(page,theme);await page.waitForTimeout(300);
  const m=await page.evaluate(()=>{const R=e=>{const b=e?.getBoundingClientRect();return b?{l:b.left,r:b.right,t:b.top,b:b.bottom,w:b.width,h:b.height,cy:(b.top+b.bottom)/2}:null;};
   const ws=document.querySelector('.anc-shell .workspace'),cs=getComputedStyle(ws),wsr=R(ws),contentL=wsr.l+parseFloat(cs.paddingLeft),contentR=wsr.r-parseFloat(cs.paddingRight);
   const brand=R(document.querySelector('.anc-brand')),links=[...document.querySelectorAll('.anc-navigation a')].map(a=>({...R(a),label:a.textContent.trim(),vis:getComputedStyle(a).visibility!=='hidden'&&a.getBoundingClientRect().width>0})),
    acct=R(document.querySelector('.anc-account')),theme=R(document.querySelector('.anc-account .theme-button')),logout=R([...document.querySelectorAll('.anc-account button')].find(b=>/ออกจากระบบ/.test(b.textContent))),identity=R(document.querySelector('.anc-identity')),
    bar=R(document.querySelector('.anc-topbar'));
   return {contentL,contentR,brand,links,acct,theme,logout,identity,bar,vw:innerWidth,overflowX:document.documentElement.scrollWidth>document.documentElement.clientWidth+1,hasInner:!!document.querySelector('.anc-topbar-inner')};});
  const tag=`ANC ${name}@${width}${theme[0]}`;
  const order=m.links.map(l=>l.label);rec(`UI-05 ${tag} nav items and order`,JSON.stringify(order)===JSON.stringify(['ภาพรวม','ทะเบียนกลาง','ทะเบียนแพทย์'])||JSON.stringify(order)===JSON.stringify(['ภาพรวม','ทะเบียนกลาง']),order);
  rec(`UI-05 ${tag} all links visible, no horizontal overflow`,m.links.every(l=>l.vis)&&!m.overflowX&&m.hasInner);
  if(width>900){
   rec(`UI-05 ${tag} brand left edge = content left edge`,near(m.brand.l,m.contentL),{brand:Math.round(m.brand.l),content:Math.round(m.contentL)});
   rec(`UI-05 ${tag} logout right edge = content right edge`,near(m.logout.r,m.contentR),{logout:Math.round(m.logout.r),content:Math.round(m.contentR)});
   rec(`UI-05 ${tag} nav directly after brand (not centred in the window)`,m.links[0].l>m.brand.r&&m.links[0].l-m.brand.r<80&&m.links.at(-1).r<m.acct.l,{gap:Math.round(m.links[0].l-m.brand.r)});
   rec(`UI-05 ${tag} account order identity → theme → logout, anchored right`,m.identity.l<m.theme.l&&m.theme.l<m.logout.l,{});
   const cys=[m.brand,...m.links,m.theme,m.logout].map(e=>e.cy);rec(`UI-05 ${tag} single row, vertically aligned`,Math.max(...cys)-Math.min(...cys)<=6,{spread:Math.round(Math.max(...cys)-Math.min(...cys))});
   rec(`UI-05 ${tag} not anchored to browser edges`,m.brand.l>(m.vw-1360)/2-1&&m.logout.r<m.vw-(m.vw-1360)/2+1||m.vw<=1400,{});
  }else{
   rec(`UI-05 ${tag} reflows: brand+account on row 1, navigation on its own row, nothing clipped`,m.links[0].t>m.brand.b-1&&m.logout.r<=m.vw+0.5&&m.brand.l>=0&&m.links.every(l=>l.r<=m.vw+0.5&&l.h>=40),{navTop:Math.round(m.links[0].t),brandBottom:Math.round(m.brand.b)});
   rec(`UI-05 ${tag} brand and logout aligned to content gutters`,near(m.brand.l,m.contentL)&&near(m.logout.r,m.contentR),{brand:Math.round(m.brand.l),content:Math.round(m.contentL)});
  }
  if(name==='overview'||width===1440||width===375)await page.screenshot({path:path.join(OUT,`anc-${name}-${width}-${theme}.png`),clip:{x:0,y:0,width,height:Math.min(260,900)}});
 }
 await ctx.close();
}
// ── Navigation, profile, logout still work ──
{const ctx=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:1440,height:900},storageState:path.join(AUTH,'anc.json')}),page=await ctx.newPage();
 await page.goto(ORIGIN+'/',{waitUntil:'networkidle'});
 await page.locator('.anc-navigation').getByRole('link',{name:'ทะเบียนกลาง'}).click();await page.waitForURL(/\/cases/,{waitUntil:'commit'});rec('ANC nav → ทะเบียนกลาง works',page.url().includes('/cases'));
 await page.locator('.anc-navigation').getByRole('link',{name:'ภาพรวม'}).click();await page.waitForURL(u=>new URL(String(u)).pathname==='/',{waitUntil:'commit'});rec('ANC nav → ภาพรวม works',true);
 const prof=page.locator('.anc-identity button, .anc-identity a').first();rec('profile control present in header',await prof.count()>0);
 await page.getByRole('button',{name:'ออกจากระบบ'}).click();await page.waitForURL(/\/login/,{waitUntil:'commit',timeout:30000});rec('logout returns to login',page.url().includes('/login'));
 await ctx.close();}
await browser.close();
writeFileSync(path.join(OUT,'ui-results.json'),JSON.stringify(log,null,2));
const fails=log.filter(l=>!l.ok);console.log(`DONE total=${log.length} fail=${fails.length}`);process.exit(fails.length?1:0);
