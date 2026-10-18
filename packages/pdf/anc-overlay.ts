import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {z} from 'zod';
import {chromium} from 'playwright';
import {PDFDocument} from 'pdf-lib';
import type {OverlayPage} from '../forms/layout';

// ANC form preview = the unchanged DCC PDF page (embedded as a vector form XObject) + a transparent overlay page carrying only the
// recorded values. The overlay is typeset by Chromium (correct Thai shaping) from structured items, never from caller HTML.
const num=z.number().finite().min(0).max(900);
const item=z.discriminatedUnion('kind',[
 z.strictObject({kind:z.literal('text'),x:num,y:num,w:num.min(1),size:z.number().min(4).max(14),text:z.string().min(1).max(500),align:z.enum(['left','center']).optional(),lines:z.number().int().min(1).max(2).optional()}),
 z.strictObject({kind:z.literal('digit'),x:num,y:num,text:z.string().regex(/^[0-9]$/)}),
 z.strictObject({kind:z.literal('check'),x:num,y:num}),
]);
export const overlaySchema=z.strictObject({pages:z.array(z.strictObject({width:num,height:num,items:z.array(item).max(200),banner:z.string().max(360),watermark:z.string().max(80)})).min(1).max(2)});
const escape=(v:string)=>v.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const MARKS=/[ัิ-ฺ็-๎]/g;
/** Font size that keeps the text inside its printed space (estimated advance 0.56 em per spacing character), never below 5.5 pt. */
export function fitSize(text:string,width:number,size:number){const n=text.replace(MARKS,'').length;return Math.max(5.5,Math.min(size,width/(Math.max(1,n)*0.56)));}
export const fits=(text:string,width:number,size:number)=>text.replace(MARKS,'').length*size*0.56<=width+0.01;
/** One line when it stays at 8 pt or more; otherwise two lines if the field allows it. */
export function textLayout(i:{text:string;w:number;size:number;lines?:number}){const one=fitSize(i.text,i.w,i.size);if(one>=Math.min(8,i.size)||(i.lines??1)<2)return {size:one,lines:1};return {size:fitSize(i.text,i.w*2,Math.min(i.size,8.5)),lines:2};}
function pageHtml(p:OverlayPage,font:string){
 const H=p.height,pt=(v:number)=>`${v.toFixed(2)}pt`;
 const items=p.items.map(i=>{
  if(i.kind==='check')return `<svg style="position:absolute;left:${pt(i.x-4.6)};top:${pt(H-i.y-4.6)}" width="9.2pt" height="9.2pt" viewBox="0 0 10 10"><path d="M1.4 5.3 L4 8 L8.8 1.8" fill="none" stroke="#0b3d91" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  if(i.kind==='digit')return `<div style="position:absolute;left:${pt(i.x-3.9)};top:${pt(H-i.y-7.6)};width:7.8pt;height:9.4pt;background:#fff;font-size:8.8pt;line-height:9.4pt;text-align:center;color:#0b3d91">${escape(i.text)}</div>`;
  const {size,lines}=textLayout(i);
  const style=`position:absolute;left:${pt(i.x)};width:${pt(i.w)};font-size:${pt(size)};line-height:${pt(size*1.12)};color:#0b3d91;text-align:${i.align??'left'};`;
  return lines>1
   ?`<div style="${style}top:${pt(H-i.y-size*2.2)};white-space:normal;overflow-wrap:anywhere">${escape(i.text)}</div>`
   :`<div style="${style}top:${pt(H-i.y-size*0.98-1.5)};white-space:nowrap">${escape(i.text)}</div>`;
 }).join('');
 return `<!doctype html><html lang="th"><head><meta charset="utf-8"><style>@font-face{font-family:Thai;src:url(data:font/woff2;base64,${font})}html,body{margin:0;padding:0;background:transparent}
 .page{position:relative;width:${pt(p.width)};height:${pt(H)};overflow:hidden;font-family:Tahoma,"Leelawadee UI",Thai,sans-serif}
 .banner{position:absolute;left:18pt;right:18pt;top:1pt;font-size:6pt;line-height:6.8pt;max-height:13.6pt;color:#b00020;white-space:normal;overflow:hidden}
 .wm{position:absolute;left:0;top:${pt(H/2-20)};width:100%;text-align:center;font-size:30pt;color:rgba(176,0,32,.10);transform:rotate(-32deg);white-space:nowrap}</style></head>
 <body><div class="page"><div class="wm">${escape(p.watermark)}</div><div class="banner">${escape(p.banner)}</div>${items}</div></body></html>`;
}
export async function renderAncOverlay(input:z.infer<typeof overlaySchema>):Promise<Buffer[]>{
 const s=overlaySchema.parse(input);
 const font=(await readFile(path.resolve('node_modules/@fontsource/noto-sans-thai/files/noto-sans-thai-thai-400-normal.woff2'))).toString('base64');
 const browser=await chromium.launch({headless:true,args:process.env.CHROMIUM_NO_SANDBOX==='true'?['--no-sandbox']:[]});
 try{
  const out:Buffer[]=[];
  for(const p of s.pages as OverlayPage[]){
   const page=await browser.newPage({javaScriptEnabled:false});await page.route('**/*',r=>r.abort());
   await page.setContent(pageHtml(p,font),{waitUntil:'load'});
   out.push(await page.pdf({width:`${p.width/72}in`,height:`${p.height/72}in`,margin:{top:'0',right:'0',bottom:'0',left:'0'},printBackground:true,pageRanges:'1'}));
   await page.close();
  }
  return out;
 }finally{await browser.close();}
}
/** Renderer service call (the web process does not run Chromium itself). Returns one PDF per page, concatenated. */
export async function requestAncOverlay(input:z.infer<typeof overlaySchema>):Promise<Buffer[]>{
 const doc=overlaySchema.parse(input),token=process.env.RENDERER_TOKEN_FILE?(await readFile(process.env.RENDERER_TOKEN_FILE,'utf8')).trim():process.env.RENDERER_TOKEN;
 if(!token||token.length<32)throw Error('RENDERER_TOKEN_REQUIRED');
 const url=new URL(process.env.RENDERER_URL||'http://127.0.0.1:3001');if(!['127.0.0.1','localhost','renderer'].includes(url.hostname)||url.protocol!=='http:')throw Error('RENDERER_INTERNAL_REQUIRED');
 const r=await fetch(new URL('/render/anc-overlay',url),{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(doc)});
 if(!r.ok)throw Error('RENDERER_FAILED');const all=Buffer.from(await r.arrayBuffer());
 // Multi-page overlay arrives as one PDF; split by page with pdf-lib.
 const src=await PDFDocument.load(all),parts:Buffer[]=[];
 for(let i=0;i<src.getPageCount();i++){const d=await PDFDocument.create();const [pg]=await d.copyPages(src,[i]);d.addPage(pg);parts.push(Buffer.from(await d.save()));}
 return parts;
}
export async function joinPdfs(parts:Buffer[]){const d=await PDFDocument.create();for(const b of parts){const s=await PDFDocument.load(b);for(const p of await d.copyPages(s,s.getPageIndices()))d.addPage(p);}return Buffer.from(await d.save());}
/** Template page (vector, unchanged) with the overlay page drawn on top, page by page, at the template's own size. */
export async function composeForms(pages:{template:Buffer;overlay:Buffer;width:number;height:number}[],title:string){
 const out=await PDFDocument.create();out.setTitle(title);out.setCreator('NIPT-CBH ANC form preview');out.setProducer('NIPT-CBH');
 for(const p of pages){
  const [bg]=await out.embedPdf(p.template,[0]),[ov]=await out.embedPdf(p.overlay,[0]);
  const page=out.addPage([p.width,p.height]);page.drawPage(bg,{x:0,y:0,width:p.width,height:p.height});page.drawPage(ov,{x:0,y:0,width:p.width,height:p.height});
 }
 return Buffer.from(await out.save());
}
