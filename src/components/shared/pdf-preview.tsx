'use client';
import {useEffect,useState} from 'react';
import {Dialog} from '../p2/shared';
/** LAB-UAT-025: authenticated response validation, retry, multi-page native PDF viewer. */
export function PdfPreview({src,title='ตัวอย่าง PDF',onClose}:{src:string;title?:string;onClose:()=>void}){
 const [url,setUrl]=useState(''),[error,setError]=useState(''),[attempt,setAttempt]=useState(0),[expanded,setExpanded]=useState(false);
 useEffect(()=>{const controller=new AbortController();let objectUrl='';
  // Worksheet exports already supplied a validated PDF blob; no blob fetch (CSP).
  if(src.startsWith('blob:'))return()=>controller.abort();
  fetch(src,{credentials:'same-origin',cache:'no-store',signal:controller.signal}).then(async r=>{if(!r.ok)throw Error(r.status===401?'กรุณาเข้าสู่ระบบอีกครั้ง':r.status===403?'ไม่มีสิทธิ์เปิดเอกสาร':'เปิด PDF ไม่สำเร็จ กรุณาลองอีกครั้ง');if(!r.headers.get('content-type')?.includes('application/pdf'))throw Error('เอกสารตอบกลับไม่ใช่ PDF');const bytes=await r.blob();objectUrl=URL.createObjectURL(bytes);setUrl(objectUrl);setError('');}).catch(e=>{if(!controller.signal.aborted)setError(e.message);});
  return()=>{controller.abort();if(objectUrl)URL.revokeObjectURL(objectUrl);};
 },[src,attempt]);
 const displayUrl=src.startsWith('blob:')?src:url;
 return <Dialog title={title} onClose={onClose}><div className={expanded?'pdf-preview expanded':'pdf-preview'}>
  <div className="action-bar"><button type="button" className="button secondary" onClick={()=>setExpanded(v=>!v)}>{expanded?'ย่อขนาด':'ขยาย'}</button><button type="button" className="button secondary" onClick={()=>{setUrl('');setError('');setAttempt(v=>v+1);}}>ลองใหม่</button></div>
  {error?<p className="form-error" role="alert">{error}</p>:displayUrl?<iframe key={attempt} title={title} className="pdf-frame" src={displayUrl}/>:<p role="status">กำลังเปิด PDF…</p>}
 </div></Dialog>;
}
export function PdfPreviewButton({src,title='ตัวอย่าง PDF'}:{src:string;title?:string}){
 const [open,setOpen]=useState(false);return <><button type="button" className="button secondary" onClick={()=>setOpen(true)}>{title}</button>{open&&<PdfPreview src={src} title={title} onClose={()=>setOpen(false)}/>}</>;
}
