"use client";
import {useState} from 'react';
import {labApi,failureText} from '../p4/lab-api';
import {hisSendErrorText,type HisDeliveryStatus} from '../../../packages/results/his-status';

const IN_PROGRESS=['QUEUED','SENDING','RETRY'];
export function HisDeliveryBadge({status,showError=false}:{status?:HisDeliveryStatus|null;showError?:boolean}){
 if(!status)return null;
 const working=IN_PROGRESS.includes(status.code);
 const when=status.updatedAt?`อัปเดต ${new Date(status.updatedAt).toLocaleString('th-TH',{timeZone:'Asia/Bangkok'})}`:undefined;
 const why=status.error?hisSendErrorText(status.error):undefined;
 return <><span className={`status ${status.tone}${working?' his-working':''}`} title={[why,when].filter(Boolean).join(' · ')||undefined}>{working&&<svg className="his-spinner" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-6.2-8.55"/></svg>}{status.label}{working&&<span className="sr-only"> — กำลังดำเนินการ ระบบจะอัปเดตเอง</span>}</span>{showError&&why&&<span className="help his-send-error">{why}</span>}</>;
}

/** Owner 2026-11-12: how far the HIS files have got. The board refreshes itself while rows are still being written by the Worker. */
export function HisSendProgress({total,left,stalled,onDismiss}:{total:number;left:number;stalled:boolean;onDismiss:()=>void}){
 const done=total-left,finished=left===0;
 return <div className={`his-progress${finished?' done':''}`} role="status" aria-live="polite">
  <div className="his-progress-text"><strong>{finished?`ส่ง HIS ครบ ${total} รายการ`:stalled?`ยังส่งไม่ครบ ${left} จาก ${total} รายการ`:`กำลังส่ง HIS ${done} จาก ${total} รายการ`}</strong>
   <span className="help">{finished?'ผลพร้อมให้ ANC เห็นแล้ว':stalled?'ใช้เวลานานผิดปกติ — ตรวจ Worker และโฟลเดอร์ HIS แล้วกดส่งอีกครั้ง หรือรีเฟรชหน้านี้':'หน้านี้อัปเดตเอง ไม่ต้องรีเฟรช'}</span></div>
  <progress max={total} value={done} aria-label="ความคืบหน้าการส่ง HIS"/>
  {(finished||stalled)&&<button type="button" className="button small secondary" onClick={onDismiss}>ปิด</button>}
 </div>;
}

const RESEND_ICON='M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6';
/** "ส่ง HIS อีกครั้ง" (Owner 2026-11-11): the worker writes PDF -> CFS and RES + OK -> RES folder again for this certified result. */
export function ResendHisButton({versionId,onQueued,onError}:{versionId:string;onQueued:(message:string)=>void;onError:(message:string)=>void}){
 const [busy,setBusy]=useState(false);
 const resend=async()=>{setBusy(true);onError("");
  try{await labApi("/api/p5/results",{action:"resendHis",versionId});onQueued("เข้าคิวส่ง HIS อีกครั้งแล้ว — ระบบเขียน PDF / .res / .ok ใหม่ไปยังโฟลเดอร์ปลายทาง");}
  catch(e){onError(failureText(e));}finally{setBusy(false);}};
 return <button type="button" className="button small secondary icon-button" aria-label="ส่ง HIS อีกครั้ง" title="ส่ง HIS อีกครั้ง" disabled={busy} onClick={()=>void resend()}>
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={busy?"spin":undefined}><path d={RESEND_ICON}/></svg>
 </button>;
}
