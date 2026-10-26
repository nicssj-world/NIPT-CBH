// Renders page 1 of PDFs to PNG (full + signer-area crop) with the repo's pdfjs-dist inside Chromium. usage: node pdf-render.mjs outDir a.pdf b.pdf
import {chromium} from 'playwright';
import http from 'node:http';
import {readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
const [out,...pdfs]=process.argv.slice(2);
const lib=path.resolve('node_modules/pdfjs-dist/legacy/build');
const srv=http.createServer((q,r)=>{const u=decodeURIComponent(q.url.split('?')[0]);
 if(u==='/'){r.setHeader('content-type','text/html');return r.end('<canvas id=c></canvas>');}
 if(u.startsWith('/lib/')){r.setHeader('content-type','text/javascript');return r.end(readFileSync(path.join(lib,u.slice(5))));}
 if(u.startsWith('/pdf/')){return r.end(readFileSync(pdfs[Number(u.slice(5))]));}r.statusCode=404;r.end();}).listen(0);
const port=srv.address().port,b=await chromium.launch(),p=await b.newPage({viewport:{width:1300,height:1800}});
await p.goto(`http://127.0.0.1:${port}/`);
for(let i=0;i<pdfs.length;i++){
 const png=await p.evaluate(async([port,i])=>{const m=await import(`http://127.0.0.1:${port}/lib/pdf.mjs`);m.GlobalWorkerOptions.workerSrc=`http://127.0.0.1:${port}/lib/pdf.worker.mjs`;
  const d=await m.getDocument({url:`http://127.0.0.1:${port}/pdf/${i}`}).promise,pg=await d.getPage(1),vp=pg.getViewport({scale:2}),c=document.getElementById('c');c.width=vp.width;c.height=vp.height;
  await pg.render({canvasContext:c.getContext('2d'),viewport:vp}).promise;return c.toDataURL('image/png');},[port,i]);
 const name=path.basename(pdfs[i],'.pdf');writeFileSync(path.join(out,name+'-page.png'),Buffer.from(png.split(',')[1],'base64'));
 await p.evaluate(()=>{});
 const crop=await p.evaluate(()=>{const c=document.getElementById('c'),t=document.createElement('canvas');t.width=c.width;t.height=Math.round(c.height*0.2);t.getContext('2d').drawImage(c,0,Math.round(c.height*0.78),c.width,t.height,0,0,c.width,t.height);return t.toDataURL('image/png');});
 writeFileSync(path.join(out,name+'-signers.png'),Buffer.from(crop.split(',')[1],'base64'));
}
await b.close();srv.close();
