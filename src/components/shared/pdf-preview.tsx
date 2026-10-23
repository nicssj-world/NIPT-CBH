'use client';
import {useEffect,useRef,useState} from 'react';
import {Dialog} from '../p2/shared';
/** LAB-UAT-025: render actual PDF pages without depending on a browser PDF plugin. */
export function PdfPreview({src,title='ตัวอย่าง PDF',onClose}:{src:string;title?:string;onClose:()=>void}){
 const [url,setUrl]=useState(''),[error,setError]=useState(''),[attempt,setAttempt]=useState(0),[expanded,setExpanded]=useState(false),[pages,setPages]=useState(0);
 const container=useRef<HTMLDivElement>(null);
 useEffect(()=>{const controller=new AbortController();let objectUrl='',task:import('pdfjs-dist').PDFDocumentLoadingTask|undefined;
  const render=async()=>{
   const response=await fetch(src,{credentials:'same-origin',cache:'no-store',signal:controller.signal});
   if(!response.ok)throw Error(response.status===401?'กรุณาเข้าสู่ระบบอีกครั้ง':response.status===403?'ไม่มีสิทธิ์เปิดเอกสาร':'เปิด PDF ไม่สำเร็จ กรุณาลองอีกครั้ง');
   if(!response.headers.get('content-type')?.includes('application/pdf'))throw Error('เอกสารตอบกลับไม่ใช่ PDF');
   const blob=await response.blob(),pdfjs=await import('pdfjs-dist');if(controller.signal.aborted)return;
   objectUrl=URL.createObjectURL(blob);setUrl(objectUrl);setError('');pdfjs.GlobalWorkerOptions.workerSrc='/api/pdf/worker';
   task=pdfjs.getDocument({data:new Uint8Array(await blob.arrayBuffer()),useSystemFonts:true,disableFontFace:true});
   const pdf=await task.promise;if(controller.signal.aborted)return;container.current?.replaceChildren();
   for(let n=1;n<=pdf.numPages;n++){
    if(controller.signal.aborted)return;const page=await pdf.getPage(n),viewport=page.getViewport({scale:1.5}),canvas=document.createElement('canvas');
    canvas.width=viewport.width;canvas.height=viewport.height;canvas.setAttribute('role','img');canvas.setAttribute('aria-label',`หน้า ${n} จาก ${pdf.numPages}`);canvas.dataset.pdfPage=String(n);container.current?.append(canvas);
    await page.render({canvas,viewport}).promise;
    const content=await page.getTextContent(),text=document.createElement('p');text.className='sr-only';text.textContent=content.items.flatMap(i=>'str'in i?[i.str]:[]).join(' ');container.current?.append(text);
   }
   if(!controller.signal.aborted)setPages(pdf.numPages);
  };
  void render().catch(e=>{if(!controller.signal.aborted)setError(e instanceof Error?e.message:'เปิด PDF ไม่สำเร็จ');});
  return()=>{controller.abort();void task?.destroy();if(objectUrl)URL.revokeObjectURL(objectUrl);};
 },[src,attempt]);
 return <Dialog title={title} onClose={onClose}><div className={expanded?'pdf-preview expanded':'pdf-preview'}>
  <div className="action-bar"><button type="button" className="button secondary" onClick={()=>setExpanded(v=>!v)}>{expanded?'ย่อขนาด':'ขยาย'}</button><button type="button" className="button secondary" onClick={()=>{setUrl('');setPages(0);setError('');setAttempt(v=>v+1);}}>ลองใหม่</button>{url&&<a className="button secondary" href={url} target="_blank" rel="noreferrer">เปิด PDF สำหรับพิมพ์</a>}</div>
  {error?<p className="form-error" role="alert">{error}</p>:<p role="status">{pages?`${pages} หน้า`:'กำลังเปิด PDF…'}</p>}
  <div ref={container} role="region" aria-label={title} tabIndex={0} className="pdf-frame pdf-pages"/>
 </div></Dialog>;
}
export function PdfPreviewButton({src,title='ตัวอย่าง PDF'}:{src:string;title?:string}){
 const [open,setOpen]=useState(false);return <><button type="button" className="button secondary" onClick={()=>setOpen(true)}>{title}</button>{open&&<PdfPreview src={src} title={title} onClose={()=>setOpen(false)}/>}</>;
}
