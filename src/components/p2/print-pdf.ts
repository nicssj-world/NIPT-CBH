/** Print the already-rendered pages. No plugin, terminal, inline script or remote content. */
export async function printPdfPages(canvases:HTMLCanvasElement[],frame:HTMLIFrameElement,onInvoked:()=>void){
 const doc=frame.contentDocument,win=frame.contentWindow;if(!doc||!win||!canvases.length)throw Error('PRINT_FRAME_UNAVAILABLE');
 const nonce=document.querySelector<HTMLScriptElement>('script[nonce]')?.nonce??'';
 doc.open();doc.write(`<!doctype html><html lang="th"><head><title>เอกสาร NIPT</title><style nonce="${nonce}">@page{size:A4;margin:0}html,body{margin:0}img{display:block;width:210mm;height:297mm;object-fit:contain;break-after:page}img:last-child{break-after:auto}</style></head><body></body></html>`);doc.close();
 const images=canvases.map(canvas=>{const img=doc.createElement('img');img.alt=canvas.getAttribute('aria-label')??'';img.src=canvas.toDataURL('image/png');doc.body.append(img);return img;});await Promise.all(images.map(img=>img.decode()));
 let invoked=false;win.addEventListener('beforeprint',()=>{invoked=true;onInvoked();},{once:true});win.focus();win.print();return invoked;
}
/** Render authenticated certified bytes for printing without changing the report. */
export async function renderPdfForPrint(src:string,signal:AbortSignal){
 const response=await fetch(src,{credentials:'same-origin',cache:'no-store',signal});if(!response.ok||!response.headers.get('content-type')?.startsWith('application/pdf'))throw Error('PDF_UNAVAILABLE');
 const pdfjs=await import('pdfjs-dist'),bytes=new Uint8Array(await response.arrayBuffer());if(signal.aborted)throw Error('PDF_TIMEOUT');pdfjs.GlobalWorkerOptions.workerSrc='/api/pdf/worker';const task=pdfjs.getDocument({data:bytes,useSystemFonts:true,disableFontFace:true});
 const abort=()=>{void task.destroy();};signal.addEventListener('abort',abort,{once:true});
 try{const pdf=await task.promise,canvases:HTMLCanvasElement[]=[];for(let n=1;n<=pdf.numPages;n++){if(signal.aborted)throw Error('PDF_TIMEOUT');const page=await pdf.getPage(n),viewport=page.getViewport({scale:1.5}),canvas=document.createElement('canvas');canvas.width=viewport.width;canvas.height=viewport.height;canvas.setAttribute('aria-label',`หน้า ${n} จาก ${pdf.numPages}`);await page.render({canvas,viewport}).promise;canvases.push(canvas);}return canvases;}
 finally{signal.removeEventListener('abort',abort);await task.destroy();}
}
