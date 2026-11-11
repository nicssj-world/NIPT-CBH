"use client";
import {useState} from "react";
import "./quality-control.css";

/** Opens the existing authorised report endpoint. Download and print use the same bytes; nothing is generated or stored here. */
export function PdfActions({versionId,certified}:{versionId:string;certified:boolean}){
 const href=`/api/p5/results/${versionId}/file`,[note,setNote]=useState("");
 async function print(){
  setNote("กำลังเตรียมเอกสาร…");
  try{
   const response=await fetch(href,{cache:"no-store"});if(!response.ok)throw Error("DENIED");
   const url=URL.createObjectURL(await response.blob()),frame=document.createElement("iframe");
   frame.className="qc-print-frame";frame.setAttribute("aria-hidden","true");frame.src=url;
   frame.onload=()=>{try{frame.contentWindow?.focus();frame.contentWindow?.print();}finally{setTimeout(()=>{URL.revokeObjectURL(url);frame.remove();},60_000);}};
   document.body.appendChild(frame);setNote("");
  }catch{setNote("เปิดเอกสารเพื่อพิมพ์ไม่สำเร็จ ตรวจสอบสิทธิ์หรือลองอีกครั้ง");}
 }
 return <div className="qc-actions" role="group" aria-label="รายงาน">
  <a className="button small secondary" href={href} target="_blank" rel="noopener">{certified?"ดูรายงาน":"ดูฉบับร่าง"}</a>
  <a className="button small secondary" href={href} download={`report-${versionId.slice(0,8)}.pdf`}>ดาวน์โหลด PDF</a>
  <button type="button" className="button small secondary" onClick={()=>void print()}>พิมพ์</button>
  {note&&<span role="status" className="help qc-actions-note">{note}</span>}
 </div>;
}
