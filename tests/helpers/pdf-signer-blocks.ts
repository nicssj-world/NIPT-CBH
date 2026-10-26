/* eslint-disable @typescript-eslint/no-explicit-any -- pdfjs text/operator items are untyped */
import sharp from 'sharp';
import {syntheticSignaturePng} from './signature-png';

type Item={s:string;x:number;y:number};
export type Block={name:string|null;license:string|null;signature:{region:{x:number;y:number;w:number;h:number};matches:'reporter'|'approver'|'unknown';iou:{reporter:number;approver:number}}|null};

const SEEDS={reporter:1,approver:2} as const;

/** Ink mask of the original synthetic signature, resampled to the size the PDF stores it at. */
async function ink(seed:number,w:number,h:number){
 const {data}=await sharp(syntheticSignaturePng(seed)).resize(w,h,{fit:'fill'}).ensureAlpha().raw().toBuffer({resolveWithObject:true});
 const out=new Uint8Array(w*h);for(let i=0;i<w*h;i++)out[i]=data[i*4+3]>100?1:0;return out;
}
function inkOf(img:{width:number;height:number;kind?:number;data:Uint8Array|Uint8ClampedArray}){
 const n=img.width*img.height,out=new Uint8Array(n),ch=Math.round(img.data.length/n);
 for(let i=0;i<n;i++){
  if(ch===4)out[i]=img.data[i*4+3]>100&&(img.data[i*4]+img.data[i*4+1]+img.data[i*4+2])<600?1:0;
  else if(ch===3)out[i]=(img.data[i*3]+img.data[i*3+1]+img.data[i*3+2])<600?1:0;
  else out[i]=img.data[i]<200?1:0;}
 return out;
}
const iou=(a:Uint8Array,b:Uint8Array)=>{let i=0,u=0;for(let k=0;k<a.length;k++){if(a[k]&&b[k])i++;if(a[k]||b[k])u++;}return u?i/u:0;};

/**
 * Reads the rendered FINAL PDF (not the form): for the Reported-by and Approved-by blocks returns the printed name, the printed professional
 * licence number and the signature image actually painted above that block, identified by comparing its pixels with the stored signatures.
 */
export async function analyzeSignerBlocks(pdf:Buffer):Promise<{reported:Block;approved:Block;images:number}>{
 const pdfjs=await import('pdfjs-dist/legacy/build/pdf.mjs');
 const doc=await pdfjs.getDocument({data:new Uint8Array(pdf),useSystemFonts:true,verbosity:0}).promise;
 if(doc.numPages!==1)throw new Error('PDF_PAGE_COUNT_'+doc.numPages);
 const page=await doc.getPage(1),vp=page.getViewport({scale:1});
 const tc=await page.getTextContent();
 const items:Item[]=tc.items.filter((i:any)=>i.str.trim()).map((i:any)=>({s:i.str,x:Math.round(i.transform[4]),y:Math.round(vp.height-i.transform[5])}));
 const lab=(re:RegExp)=>items.find(i=>re.test(i.s));
 const rl=lab(/^Reported by/),al=lab(/^Approved by/);
 if(!rl||!al)throw new Error('SIGNER_LABELS_NOT_FOUND');
 const side=(l:Item)=>(i:{x:number})=>l===rl?i.x<al.x-40:i.x>=al.x-30;
 const text=(l:Item)=>items.filter(i=>side(l)(i)&&i.y>=l.y-2&&i.y<=l.y+45).sort((a,b)=>a.y-b.y||a.x-b.x).map(i=>i.s).join(' ').replace(/\s+/g,' ');
 const parse=(t:string)=>({name:t.match(/\((?!Medical)([^)]+?)\)?\s*(?:\(Medical|\s*$)/)?.[1]?.trim()??null,license:t.match(/license\s*no\.?\s*(\d+)/i)?.[1]??null});
 const ops=await page.getOperatorList(),OPS=pdfjs.OPS;
 const mul=(m:number[],n:number[])=>[m[0]*n[0]+m[2]*n[1],m[1]*n[0]+m[3]*n[1],m[0]*n[2]+m[2]*n[3],m[1]*n[2]+m[3]*n[3],m[0]*n[4]+m[2]*n[5]+m[4],m[1]*n[4]+m[3]*n[5]+m[5]];
 let ctm=[1,0,0,1,0,0];const stack:number[][]=[];const found:{name:string;x:number;y:number;w:number;h:number}[]=[];
 for(let i=0;i<ops.fnArray.length;i++){const f=ops.fnArray[i],a=ops.argsArray[i];
  if(f===OPS.save)stack.push(ctm);else if(f===OPS.restore)ctm=stack.pop()??ctm;else if(f===OPS.transform)ctm=mul(ctm,a);
  else if(f===OPS.paintImageXObject){found.push({name:a[0],x:ctm[4],y:vp.height-ctm[5]-ctm[3],w:Math.abs(ctm[0]),h:Math.abs(ctm[3])});}}
 // Signature candidates: small images (not the page-wide header/footer art) sitting just above a signer label.
 const small=found.filter(f=>f.w>=20&&f.w<=200&&f.h>=8&&f.h<=80&&f.y>rl.y-120&&f.y<rl.y+5);
 const read=async(name:string)=>new Promise<any>((res,rej)=>{const t=setTimeout(()=>rej(new Error('IMG_TIMEOUT')),5000);page.objs.get(name,(o:any)=>{clearTimeout(t);res(o);});});
 const sigFor=async(l:Item):Promise<Block['signature']>=>{
  const near=small.filter(side(l)).sort((a,b)=>Math.abs(a.x-l.x)-Math.abs(b.x-l.x))[0];if(!near)return null;
  const img=await read(near.name),mask=inkOf(img),r=iou(mask,await ink(SEEDS.reporter,img.width,img.height)),ap=iou(mask,await ink(SEEDS.approver,img.width,img.height));
  return {region:{x:Math.round(near.x),y:Math.round(near.y),w:Math.round(near.w),h:Math.round(near.h)},matches:Math.max(r,ap)<0.3?'unknown':r>ap?'reporter':'approver',iou:{reporter:+r.toFixed(2),approver:+ap.toFixed(2)}};
 };
 return {reported:{...parse(text(rl)),signature:await sigFor(rl)},approved:{...parse(text(al)),signature:await sigFor(al)},images:found.length};
}
