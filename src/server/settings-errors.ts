import {ZodError} from "zod";
import {NextResponse} from "next/server";
import {apiError} from "./http";
import {SETTING_FORMS} from "../../packages/settings/fields";
import type {SettingKey} from "../../packages/settings/catalog";

// Settings acceptance (2026-10-18): a refused save, test, approval or activation says what to fix instead of one generic message.
// Permission (403) and session (401) answers stay with apiError.
export const SETTINGS_MESSAGES:Record<string,string>={
 REASON_REQUIRED:"กรุณาระบุเหตุผลที่เปลี่ยน (ไม่เกิน 250 ตัวอักษร)",
 SETTING_DRAFT_REQUIRED:"ทดสอบได้เฉพาะร่างที่คุณบันทึกเองและยังเป็นร่างอยู่",
 SETTING_NOT_VALIDATED:"ต้องทดสอบร่างให้ผ่านก่อนจึงจะอนุมัติได้",
 SETTING_APPROVAL_REQUIRED:"ยังเปิดใช้ไม่ได้: ต้องทดสอบผ่าน และหมวดคลินิก/Integration ต้องได้รับอนุมัติจากผู้ตรวจอีกคนก่อน",
 SETTING_NOT_FOUND:"ไม่พบรุ่นการตั้งค่านี้ กรุณาโหลดหน้าใหม่",
 REVISION_REQUIRED:"ไม่พบรุ่นการตั้งค่าที่เลือก กรุณาโหลดหน้าใหม่",
 PREVIOUS_ACTIVE_REVISION_REQUIRED:"คืนค่าได้เฉพาะรุ่นที่เคยเปิดใช้งานแล้ว",
 UNKNOWN_OR_LOCKED_SETTING:"หมวดการตั้งค่านี้แก้ไขไม่ได้",
 HIS_MIXED_DESTINATIONS_PROHIBITED:"ปลายทาง RES / PDF / Backup ต้องเป็นตัวจำลองทั้งหมด หรือเป็น Share ที่อนุญาตทั้งหมด ห้ามผสมกัน",
 HIS_ACTIVE_SETTINGS_REQUIRED:"ยังไม่มีรุ่นที่เปิดใช้งานสำหรับ HIS หมวดนี้",
 HIS_CONFIGURATION_CHANGED:"รุ่นการตั้งค่าเปลี่ยนไปแล้ว กรุณาโหลดหน้าใหม่แล้วทดสอบอีกครั้ง",
 INVALID_OPERATION:"คำสั่งไม่ถูกต้อง",
 CONSENT_MODE_PENDING_OD06:"ช่องทางใบขอส่งตรวจ/ความยินยอมยังรอการตัดสินใจ OD-06 — เปลี่ยนได้เฉพาะชุดแบบฟอร์ม",
 SCHEDULED_SCAN_DISABLED_OWNER:"การสแกนโฟลเดอร์ผล PDF ตามรอบเวลาถูกปิดตาม Owner — สแกนเมื่อกดปุ่ม สแกนไฟล์ PDF เท่านั้น ค่าต้องเป็น 0",
};
/** Thai message for a settings failure, naming the labelled fields of a schema error; null when another handler owns it. */
export function settingsErrorMessage(error:unknown,key?:string):string|null{
 if(error instanceof ZodError){
  const form=key&&key in SETTING_FORMS?SETTING_FORMS[key as SettingKey]:undefined;
  const fields=[...new Set(error.issues.map(i=>{const name=String(i.path[0]??"");return form?.fields.find(f=>f.name===name)?.label??name;}))].filter(Boolean);
  return `ค่าที่กรอกไม่ถูกต้อง: ${fields.length?fields.join(", "):"รูปแบบข้อมูล"} — ตรวจช่วงค่าและรูปแบบที่ระบุใต้ช่อง แล้วบันทึกร่างใหม่`;
 }
 const code=error instanceof Error?error.message:"";return SETTINGS_MESSAGES[code]??null;
}
export function settingsError(error:unknown,key?:string){
 const message=settingsErrorMessage(error,key);
 if(message)return NextResponse.json({error:message,code:error instanceof ZodError?"INVALID_SETTING_VALUE":(error as Error).message},{status:400,headers:{"Cache-Control":"no-store"}});
 return apiError(error);
}
