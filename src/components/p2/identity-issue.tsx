"use client";
import {useState} from "react";
import {api} from "./shared";
import "../anc/dashboard.css";

/**
 * An open HIS identity issue on a case, with its reasons on demand (moved from the ANC overview queue to the central registry, Owner 2026-11-14).
 * The reasons come from /api/anc/identity-issues (ANC roles); field names only, never the HIS values.
 */
const IDENTITY_LABEL='ข้อมูลตัวตนรอตรวจสอบ';
type IdentityIssue={id:string;kind:string;state:string;fields:string[];createdAt:string};
const IDENTITY_KIND:Record<string,string>={IDENTITY_MISMATCH:"ข้อมูลระบุตัวตนไม่ตรงกัน",IDENTITY_UNVERIFIED:"ข้อมูลตัวตนยังตรวจสอบไม่ครบ",LN_REUSED_OR_CHANGED:"ข้อมูลจาก HIS เปลี่ยนหลังรับตัวอย่าง",LN_REUSED_DIFFERENT_PATIENT:"LN อาจผูกกับคนละ HN",UNLINKED:"ไม่พบเคสที่เชื่อมกับ LN",S1_INTEGRITY_EVENT:"ข้อมูลรับตัวอย่างเดิมเปลี่ยน",HISTORICAL_LN_INTAKE:"ข้อมูลจากเคสย้อนหลัง"};
const IDENTITY_FIELD:Record<string,string>={hn:"HN",name:"ชื่อ",dob:"วันเกิด",sex:"เพศ",identity:"เลขประจำตัว",receivedAt:"เวลารับจาก HIS",specimenAt:"เวลาเก็บตัวอย่าง",ward:"หน่วยงานส่งตรวจ"};
export function IdentityIssueDetails({caseId}:{caseId:string}){
 const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(""),[items,setItems]=useState<IdentityIssue[]|null>(null);
 const toggle=async()=>{if(open){setOpen(false);return;}setOpen(true);setBusy(true);setError("");try{const d=await api<{issues:IdentityIssue[]}>("/api/anc/identity-issues",{caseId});setItems(d.issues);}catch{setError("โหลดรายละเอียดปัญหาจาก HIS ไม่สำเร็จ กรุณาลองอีกครั้ง");}finally{setBusy(false);}};
 return <div className="anc-identity-issue"><button type="button" className="badge attention warning anc-issue-trigger" onClick={()=>void toggle()} aria-expanded={open} aria-label="ข้อมูลตัวตนรอตรวจสอบ เปิดดูสาเหตุ">{IDENTITY_LABEL} <span aria-hidden="true">{open?"▴":"▾"}</span></button>
  {open&&<div className="anc-issue-detail" role="region" aria-label="รายละเอียดข้อมูลตัวตนที่ต้องตรวจสอบ">
   {busy?<p role="status">กำลังโหลดรายละเอียด…</p>:error?<><p role="alert">{error}</p><button className="anc-text" onClick={()=>void toggle()}>ปิดแล้วเปิดอีกครั้ง</button></>:items?.length?items.map(i=><div key={i.id}><strong>{IDENTITY_KIND[i.kind]??"ข้อมูลจาก HIS ต้องตรวจสอบ"}</strong><p>สถานะ: {i.state==="Open"?"รอตรวจสอบ":i.state==="Proposed"?"มีข้อเสนอเดิมค้างอยู่":i.state}</p>{i.fields.length>0&&<p>ข้อมูลที่เกี่ยวข้อง: {i.fields.map(v=>IDENTITY_FIELD[v]??v).join(" · ")}</p>}</div>):<p>ไม่มีรายการตัวตนที่ค้างอยู่แล้ว โปรดรีเฟรชรายการเพื่อปรับคำเตือน</p>}
   <p className="help">ตรวจสอบหลักฐาน HIS และแจ้งเจ้าหน้าที่ผู้มีสิทธิ์แก้ไขรายการก่อนดำเนินการต่อ</p>
  </div>}
 </div>;
}
