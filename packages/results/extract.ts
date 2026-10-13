import {isZip,zipEntries,zipRead,memberBasename,ZipError} from './zip';

// Quarantine and text extraction (Plan §11.1–§11.2). Magic bytes decide the container, never the file extension:
// real PDFs ('%PDF'), NIPTY ZIP-as-PDF (manifest.json + 1.txt) and batch ZIPs that hold several result PDFs.
export type Container='PDF'|'ZIP_AS_PDF'|'ZIP_BATCH';
export type Extracted={container:'PDF'|'ZIP_AS_PDF';text:string;pages:number}|{container:'ZIP_BATCH';members:{name:string;bytes:Buffer}[]};
export class QuarantineError extends Error{}
const reject=(code:string):never=>{throw new QuarantineError(code);};
export const isPdf=(b:Uint8Array)=>b.length>=5&&b[0]===0x25&&b[1]===0x50&&b[2]===0x44&&b[3]===0x46&&b[4]===0x2d;
export const MAX_PAGES=20;

/** Size and magic-byte screening that runs before anything else reads the bytes. */
export function screen(bytes:Buffer,maxBytes:number){
 if(bytes.length===0)reject('EMPTY_FILE');
 if(bytes.length>maxBytes)reject('FILE_TOO_LARGE');
 if(!isPdf(bytes)&&!isZip(bytes))reject('NOT_PDF_OR_ZIP');
}

/** Text lines in reading order: pdf.js items grouped by baseline, top to bottom, left to right. No scripting or font loading. */
export async function pdfText(bytes:Buffer):Promise<{text:string;pages:number}>{
 const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');
 const task=getDocument({data:new Uint8Array(bytes),disableFontFace:true,useSystemFonts:false,stopAtErrors:true,verbosity:0});let doc;try{doc=await task.promise;}
 catch(e){return reject(e instanceof Error&&e.name==='PasswordException'?'PDF_ENCRYPTED':'PDF_UNREADABLE');}
 try{
  if(doc.numPages<1||doc.numPages>MAX_PAGES)reject('PDF_PAGE_COUNT_UNSUPPORTED');
  const lines:string[]=[];
  for(let n=1;n<=doc.numPages;n++){
   const page=await doc.getPage(n),content=await page.getTextContent();
   const rows=new Map<number,{x:number;s:string}[]>();
   for(const item of content.items){if(!('str' in item)||!item.str.trim())continue;const y=Math.round(item.transform[5]/2)*2;const row=rows.get(y)??[];row.push({x:item.transform[4],s:item.str.trim()});rows.set(y,row);}
   for(const y of [...rows.keys()].sort((a,b)=>b-a))lines.push(rows.get(y)!.sort((a,b)=>a.x-b.x).map(i=>i.s).join(' '));
  }
  return {text:lines.join('\n'),pages:doc.numPages};
 }finally{await task.destroy();}
}

export async function extract(bytes:Buffer):Promise<Extracted>{
 if(isPdf(bytes)){const r=await pdfText(bytes);if(!r.text.trim())reject('TEXT_NOT_EXTRACTABLE');return {container:'PDF',...r};}
 let entries;try{entries=zipEntries(bytes);}catch(e){return reject(e instanceof ZipError?e.message:'ZIP_UNREADABLE');}
 const pdfs=entries.filter(e=>/\.pdf$/i.test(e.name));
 try{
  if(pdfs.length){
   // Batch ZIP: each PDF member becomes its own intake row with its own hash. Nested ZIP-as-PDF members are screened again later.
   return {container:'ZIP_BATCH',members:pdfs.filter(e=>!/ \(\d+\)\.pdf$/i.test(e.name)).map(e=>({name:memberBasename(e.name),bytes:zipRead(bytes,e)}))};
  }
  const manifest=entries.find(e=>e.name==='manifest.json');
  let textEntry=undefined as typeof entries[number]|undefined;
  if(manifest){try{const m=JSON.parse(zipRead(bytes,manifest).toString('utf8'));const p=m?.pages?.[0]?.text?.path;if(typeof p==='string')textEntry=entries.find(e=>e.name===p);}catch{/* fall back to the first text member */}}
  textEntry??=entries.find(e=>/\.txt$/i.test(e.name));
  if(!textEntry)reject('ZIP_HAS_NO_REPORT_TEXT');
  const text=zipRead(bytes,textEntry!).toString('utf8');if(!text.trim())reject('TEXT_NOT_EXTRACTABLE');
  return {container:'ZIP_AS_PDF',text,pages:1};
 }catch(e){if(e instanceof QuarantineError)throw e;return reject(e instanceof ZipError?e.message:'ZIP_UNREADABLE');}
}
