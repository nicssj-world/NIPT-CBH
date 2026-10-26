"use client";
import {useEffect,useRef,useState} from 'react';
import {Dialog,ErrorNotice,csrf,time} from './shared';
import {printPdfPages} from './print-pdf';
type Asset={id:string;hash:string;expiresAt:string};
export function PdfPreview({caseId,documentId,onClose}:{caseId:string;documentId:string;onClose:()=>void;operational:boolean}){
 const [url,setUrl]=useState(''),[asset,setAsset]=useState<Asset|null>(null),[error,setError]=useState(''),[attempt,setAttempt]=useState(0),[pages,setPages]=useState(0),[printStatus,setPrintStatus]=useState('');
 const container=useRef<HTMLDivElement>(null),printFrame=useRef<HTMLIFrameElement|null>(null);
 const kind=documentId.startsWith('form:')?documentId.slice(5):null;
 useEffect(()=>{const controller=new AbortController();let objectUrl='',task:import('pdfjs-dist').PDFDocumentLoadingTask|undefined;let live=true;const timer=setTimeout(()=>controller.abort(),45000);
  async function load(){setError('');setUrl('');setPages(0);setAsset(null);setPrintStatus('');container.current?.replaceChildren();try{
   let target=kind?`/api/p2/cases/${caseId}/forms?kind=${kind}`:'';
   if(!kind){const response=await fetch('/api/p2/documents',{method:'POST',headers:{'content-type':'application/json','x-csrf-token':csrf()},body:JSON.stringify({caseId,documentId}),signal:controller.signal});if(!response.ok)throw Error('สร้าง PDF ไม่สำเร็จ กรุณาตรวจสิทธิ์และลองใหม่');const next:Asset=await response.json();if(!live)return;setAsset(next);target=`/api/p2/documents?id=${next.id}&intent=preview`;}
   const response=await fetch(target,{cache:'no-store',signal:controller.signal});if(!response.ok||!response.headers.get('content-type')?.startsWith('application/pdf'))throw Error('เปิด PDF ไม่สำเร็จ กรุณาตรวจบริการเอกสารและลองใหม่');
   const blob=await response.blob();if((await blob.slice(0,5).text())!=='%PDF-')throw Error('ไฟล์ที่ได้รับไม่ใช่ PDF');
   const pdfjs=await import('pdfjs-dist');if(!live)return;if(controller.signal.aborted)throw Error('PDF_TIMEOUT');objectUrl=URL.createObjectURL(blob);setUrl(objectUrl);pdfjs.GlobalWorkerOptions.workerSrc='/api/pdf/worker';
   task=pdfjs.getDocument({data:new Uint8Array(await blob.arrayBuffer()),useSystemFonts:true,disableFontFace:true});
   controller.signal.addEventListener('abort',()=>{void task?.destroy();},{once:true});
   const pdf=await task.promise;
   for(let n=1;n<=pdf.numPages;n++){
    if(!live)return;if(controller.signal.aborted)throw Error('PDF_TIMEOUT');const page=await pdf.getPage(n),viewport=page.getViewport({scale:1.5}),canvas=document.createElement('canvas');canvas.width=viewport.width;canvas.height=viewport.height;canvas.setAttribute('role','img');canvas.setAttribute('aria-label',`หน้า ${n} จาก ${pdf.numPages}`);canvas.dataset.pdfPage=String(n);container.current?.append(canvas);await page.render({canvas,viewport}).promise;
    const content=await page.getTextContent(),text=document.createElement('p');text.className='sr-only';text.textContent=content.items.flatMap(i=>'str'in i?[i.str]:[]).join(' ');container.current?.append(text);
   }
   if(live&&!controller.signal.aborted)setPages(pdf.numPages);
  }catch(e){if(live)setError(controller.signal.aborted?'สร้าง PDF เกินเวลา กรุณาลองใหม่':(e as Error).message);}finally{clearTimeout(timer);}}
  void load();return()=>{live=false;controller.abort();clearTimeout(timer);void task?.destroy();if(objectUrl)URL.revokeObjectURL(objectUrl);printFrame.current?.remove();};
 },[caseId,documentId,kind,attempt]);
 async function print(){
  if(!pages)return;setPrintStatus('');printFrame.current?.remove();const frame=document.createElement('iframe');frame.title='เอกสารสำหรับพิมพ์';frame.className='anc-pdf-print-frame';document.body.append(frame);printFrame.current=frame;
  try{
   const invoked=await printPdfPages([...container.current!.querySelectorAll('canvas')],frame,()=>setPrintStatus('เปิดคำสั่งพิมพ์ของเบราว์เซอร์แล้ว'));
   if(!invoked)setPrintStatus('หากหน้าต่างพิมพ์ไม่เปิด ให้เปิด PDF ในแท็บใหม่แล้วใช้คำสั่งพิมพ์ของเบราว์เซอร์');
  }catch{setError('เปิดคำสั่งพิมพ์ไม่สำเร็จ กรุณาเปิด PDF ในแท็บใหม่แล้วพิมพ์');}
 }
 return <Dialog title="ตัวอย่าง PDF" onClose={onClose}><ErrorNotice error={error}/>{error&&<button className="button secondary" onClick={()=>setAttempt(n=>n+1)}>ลองสร้าง PDF ใหม่</button>}<p role="status">{pages?`${pages} หน้า`:error?'':'กำลังเปิด PDF…'}</p><div ref={container} className="pdf-frame pdf-pages" role="region" aria-label="ตัวอย่างเอกสาร PDF" tabIndex={0}/>{url&&<div className="action-bar"><a className="button secondary" href={url} target="_blank" rel="noopener">เปิด PDF ในแท็บใหม่</a><a className="button secondary" href={url} download={`NIPT-${kind??'document'}.pdf`}>ดาวน์โหลด PDF</a><button className="button secondary" disabled={!pages} onClick={()=>void print()}>พิมพ์ PDF</button></div>}{printStatus&&<p role="status">{printStatus}</p>}{asset&&<p className="help">SHA-256 {asset.hash.slice(0,16)} · หมดอายุ {time(asset.expiresAt)}</p>}</Dialog>;
}
