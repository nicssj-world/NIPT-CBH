// Dev/test helper: rasterize PDF pages to PNG with pdf.js inside the bundled Chromium (no external rasterizer on the target).
// Usage: npx tsx tools/forms/rasterize.ts <input.pdf> <output-prefix> [scale]
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright';

export async function rasterizePdf(bytes:Buffer,scale=2):Promise<Buffer[]>{
 const lib=path.resolve('node_modules/pdfjs-dist/legacy/build');
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();
  await page.route('http://pdf.local/**',async r=>{const name=new URL(r.request().url()).pathname.slice(1);
   if(name==='doc.pdf')return r.fulfill({body:bytes,contentType:'application/pdf'});
   if(name==='index.html')return r.fulfill({body:'<!doctype html><html><body style="margin:0;background:#fff"></body></html>',contentType:'text/html'});
   return r.fulfill({body:await readFile(path.join(lib,path.basename(name))),contentType:'text/javascript'});});
  await page.goto('http://pdf.local/index.html');
  const count=await page.evaluate(async([s])=>{
   const pdfjs=await import('http://pdf.local/pdf.mjs' as string);pdfjs.GlobalWorkerOptions.workerSrc='http://pdf.local/pdf.worker.mjs';
   const doc=await pdfjs.getDocument({url:'http://pdf.local/doc.pdf'}).promise;
   for(let n=1;n<=doc.numPages;n++){const p=await doc.getPage(n),vp=p.getViewport({scale:s as number});const c=document.createElement('canvas');c.id='p'+n;c.width=vp.width;c.height=vp.height;c.style.display='block';document.body.appendChild(c);
    await p.render({canvasContext:c.getContext('2d')!,viewport:vp}).promise;}
   return doc.numPages;},[scale]);
  const out:Buffer[]=[];for(let n=1;n<=count;n++)out.push(await page.locator('#p'+n).screenshot());
  return out;
 }finally{await browser.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const [input,prefix,scale]=process.argv.slice(2);const pages=await rasterizePdf(await readFile(input),Number(scale??2));
 for(const [i,p] of pages.entries())await writeFile(`${prefix}-${i+1}.png`,p);console.log(pages.length);
}
