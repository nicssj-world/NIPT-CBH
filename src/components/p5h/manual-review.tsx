'use client';
import {useEffect,useState} from 'react';
import {labApi,failureText} from '../p4/lab-api';
import {PdfPreviewButton} from '../shared/pdf-preview';
import {Dialog} from '../p2/shared';
type Review={current:boolean;version:number;canReview:boolean;review:{id:string;recorded_at:string}|null};
export function ManualFinalReview({batchId,draftId,pdfFileId,onDone}:{batchId:string;draftId:string;pdfFileId?:string;onDone?:()=>Promise<void>}){
 const [open,setOpen]=useState(false),[data,setData]=useState<Review|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[checks,setChecks]=useState({ln:false,identity:false,pdf:false});
 const endpoint='/api/p5h/manual-review/'+draftId;
 useEffect(()=>{if(!open)return;let active=true;labApi<Review>(endpoint).then(r=>{if(active){setData(r);setError('');}}).catch(e=>{if(active)setError(failureText(e));});return()=>{active=false;};},[open,endpoint]);
 return <><button className="button secondary small" type="button" onClick={()=>{setChecks({ln:false,identity:false,pdf:false});setOpen(true);}}>ตรวจสอบและบันทึกเสร็จสิ้น</button>{open&&<Dialog title="ตรวจสอบข้อมูลนำเข้าย้อนหลัง" onClose={()=>setOpen(false)}>
  <p>สำหรับงาน Manual ที่ตรวจเสร็จแล้วและมี Final PDF เท่านั้น ตรวจรายงานต้นฉบับและตัวตนผู้ป่วย โดยไม่สร้าง PET, QC หรือการรับรองผลใหม่</p>
  {pdfFileId&&<p><PdfPreviewButton src={'/api/p5h/batches/'+batchId+'/files/'+pdfFileId} title="เปิด PDF ต้นฉบับ"/></p>}
  {error&&<p role="alert" className="form-error">{error}</p>}
  {data?.current?<p role="status" className="status good">บันทึกเสร็จสิ้นแล้ว — Manual · คงรายงานต้นฉบับ ไม่มีการส่ง HIS</p>:data?.review?<p role="status">ข้อมูลเปลี่ยนหลังทบทวน ต้องตรวจต้นฉบับฉบับปัจจุบันอีกครั้ง</p>:null}
  {data?.canReview&&!data.current?<><div className="stack">
   <label className="check-label"><input type="checkbox" checked={checks.ln} onChange={e=>setChecks(v=>({...v,ln:e.target.checked}))}/>LN ตรงกับ PDF และต้นฉบับ</label>
   <label className="check-label"><input type="checkbox" checked={checks.identity} onChange={e=>setChecks(v=>({...v,identity:e.target.checked}))}/>ตรวจ HN ชื่อ และวันเกิดที่มี เทียบกับ PDF และต้นฉบับแล้ว</label>
   <label className="check-label"><input type="checkbox" checked={checks.pdf} onChange={e=>setChecks(v=>({...v,pdf:e.target.checked}))}/>รายงานนี้เป็น Final PDF ของงาน Manual ที่ตรวจเสร็จแล้ว</label>
  </div><button className="button" disabled={busy||!pdfFileId||!checks.ln||!checks.identity||!checks.pdf} onClick={async()=>{setBusy(true);setError('');try{setData(await labApi<Review>(endpoint,{version:data.version,lnMatchesOriginal:true,pdfBindingMatchesOriginal:true,identityMatchesOriginal:true,identityIdentifiersChecked:['HN','NAME'],finalPdfReviewed:true}));await onDone?.();}catch(e){setError(failureText(e));}finally{setBusy(false);}}}>{busy?'กำลังบันทึก…':'บันทึกการตรวจสอบและบันทึกเสร็จสิ้น'}</button></>:data&&!data.current?<p>ไม่มีสิทธิ์บันทึกรายการนี้</p>:null}

 </Dialog>}</>;
}
