"use client";
import {useState} from 'react';
import {labApi,failureText} from '../p4/lab-api';
import {hisSendErrorText,type HisDeliveryStatus} from '../../../packages/results/his-status';

export function HisDeliveryBadge({status,showError=false}:{status?:HisDeliveryStatus|null;showError?:boolean}){
 if(!status)return null;
 const when=status.updatedAt?`อัปเดต ${new Date(status.updatedAt).toLocaleString('th-TH',{timeZone:'Asia/Bangkok'})}`:undefined;
 const why=status.error?hisSendErrorText(status.error):undefined;
 return <><span className={`status ${status.tone}`} title={[why,when].filter(Boolean).join(' · ')||undefined}>{status.label}</span>{showError&&why&&<span className="help his-send-error">{why}</span>}</>;
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
