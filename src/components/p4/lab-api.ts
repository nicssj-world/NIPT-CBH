"use client";
import {csrf} from "../p2/shared";
import {displayBeDateTime} from "../../../packages/domain/thai-date";
export class LabFailure extends Error{constructor(public code:string,public text:string,public details?:unknown,public status=400){super(code);}}
/** JSON API call that keeps the server's Thai explanation and structured details (e.g. Finalize Gate failures). */
export async function labApi<T>(path:string,body?:unknown):Promise<T>{
 const r=await fetch(path,{method:body===undefined?"GET":"POST",cache:"no-store",headers:body===undefined?{}:{"content-type":"application/json","x-csrf-token":csrf()},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const d=await r.json().catch(()=>({}));if(!r.ok)throw new LabFailure(d.code??"REQUEST_FAILED",d.error??"ทำรายการไม่สำเร็จ กรุณาลองอีกครั้ง",d.details,r.status);return d as T;
}
/** POST that returns a PDF; opens it in a new tab for preview/print from the browser's PDF viewer. */
export async function labPdf(path:string,body:unknown){
 const r=await fetch(path,{method:"POST",cache:"no-store",headers:{"content-type":"application/json","x-csrf-token":csrf()},body:JSON.stringify(body)});
 if(!r.ok){const d=await r.json().catch(()=>({}));throw new LabFailure(d.code??"REQUEST_FAILED",d.error??"พิมพ์เอกสารไม่สำเร็จ",d.details,r.status);}
 const url=URL.createObjectURL(await r.blob());window.open(url,"_blank","noopener");setTimeout(()=>URL.revokeObjectURL(url),60000);
}
export const failureText=(e:unknown)=>e instanceof LabFailure?e.text:"ทำรายการไม่สำเร็จ กรุณาลองอีกครั้ง";
/** Asia/Bangkok date-time with a 4-digit BE year (Owner date standard), e.g. 17/10/2569 11:54. */
export const bkk=(v:string|Date|null|undefined)=>displayBeDateTime(v);
export const GATE_TEXT:Record<string,string>={
 NOT_CURRENT_ROUND:"ไม่ใช่รอบปัจจุบัน",REDRAW_BEYOND_S2_PENDING_OD_R2:"ยังไม่มีขั้นตอนรับรอบเจาะซ้ำครั้งที่ 3 ขึ้นไปจาก HIS (รอ Owner ตัดสิน OD-R2) ระบบจึงไม่สร้างรอบที่รับไม่ได้ — ปรึกษาผู้รับผิดชอบก่อนสั่งเจาะซ้ำอีกครั้ง",REDRAW_REQUIRES_NEW_HIS_PET:"รอบเจาะซ้ำรับจาก PET ใหม่ของ HIS เท่านั้น — ให้รับสิ่งส่งตรวจใน HIS ตามปกติ",NOT_RECEIVED:"ยังไม่รับสิ่งส่งตรวจ",REDRAW_REQUESTED:"สั่งเก็บตัวอย่างใหม่แล้ว",ANALYSIS_STARTED_REQUIRES_REPEAT_LINEAGE:"รอบนี้เริ่มวิเคราะห์แล้ว — ต้องสั่งตรวจซ้ำ (Repeat)",
 IDENTITY_ISSUE_OPEN:"มีปัญหาตัวตนจาก HIS ค้าง",LN_NOT_VERIFIED:"LN ยังไม่ยืนยันด้วย .pet",RECEIPT_CHECK_INCOMPLETE:"การตรวจรับรอบเจาะซ้ำไม่ครบ",CONSENT_REVOKED:"ถอนความยินยอมแล้ว",CONSENT_DECLINED:"ผู้รับบริการไม่ยินยอม",
 PAPER_CONSENT_SELECTED:"เลือกใช้ Paper Consent (ไม่ใช่หลักฐานการลงนาม)",CONSENT_NOT_GRANTED:"ยังไม่มีความยินยอมที่ยืนยันแล้ว",REQUEST_NOT_VERIFIED:"Request ยังไม่ยืนยัน",CLINICAL_NOT_ASSESSED:"ยังไม่ประเมิน Clinical Gate",COLLECTION_DATE_MISSING:"ไม่มีวันที่เจาะเลือด",COLLECTION_DATE_CONFLICT:"วันที่เจาะเลือดขัดแย้งกัน",
 ATTEMPT_ON_HOLD:"ถูกระงับ (Hold)",RESUME_DECISION_REQUIRED:"รอการตัดสินใจหลังยกเลิกคำสั่งเจาะซ้ำ",PREGNANCY_TYPE_UNCONFIRMED:"ยังไม่ยืนยันประเภทครรภ์ (เดี่ยว/แฝด)",PRINTED_ID_FORMAT_PENDING_OD03:"ยังไม่มีรูปแบบ Printed Sample ID ที่อนุมัติ (OD-03)",
 ACTIVE_SLOT_EXISTS:"อยู่ใน Batch แล้ว",REPEAT_ORDER_NOT_PENDING_BATCH:"คำสั่งตรวจซ้ำไม่อยู่ในสถานะรอจัด",BATCH_FULL:"Batch เต็ม",SLOT_NOT_EXACT:"ตำแหน่งไม่ตรงแผน",PLAN_CHECK_STALE:"แผนเปลี่ยนหลังยืนยัน",REPEAT_ORDER_NOT_IN_PROGRESS:"คำสั่งตรวจซ้ำไม่อยู่ในสถานะกำลังทำ",
 "OD-01:SPECIMEN_ACCEPTANCE_POLICY":"รอนโยบายการยอมรับตัวอย่าง (OD-01)","OD-08:CLINICAL_RULES_NOT_APPROVED":"เกณฑ์ Clinical Gate ยังไม่รับรอง (OD-08)",
 "OD-16:REDRAW_CONSENT_APPLICABILITY":"การใช้ Consent กับรอบเจาะซ้ำยังรอตัดสิน (OD-16)","OD-16:REDRAW_REQUEST_APPLICABILITY":"การใช้ Request กับรอบเจาะซ้ำยังรอตัดสิน (OD-16)"
};
export const gateText=(code:string)=>GATE_TEXT[code]??(code.startsWith("CLINICAL_")?"Clinical Gate ไม่ผ่าน ("+code.slice(9)+")":code.startsWith("ATTEMPT_")?"สถานะงาน: "+code.slice(8):code);
