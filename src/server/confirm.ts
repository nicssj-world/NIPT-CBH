import {NextResponse} from "next/server";
import {LabError} from "../../packages/lab/core";
import {p5Error,noStore} from "./p5";

// ผลตรวจยืนยัน: Thai messages of the module's refusals; everything else falls through to the shared P5 messages.
const MESSAGES:Record<string,string>={
 CONFIRM_CHANGED:"มีผู้บันทึกเคสนี้ไปก่อนแล้ว กรุณาเปิดเคสใหม่เพื่อดูข้อมูลล่าสุด",
 CONFIRM_SCREEN_CHANGED:"ผลคัดกรองของเคสนี้เปลี่ยนไปแล้ว กรุณาเปิดเคสใหม่",
 CONFIRM_FINDINGS_INCOMPLETE:"กรุณาเลือกผลยืนยันให้ครบทุกรายการที่ผลคัดกรองผิดปกติ",
 CONFIRM_METHOD_REQUIRED:"กรุณาเลือกวิธีตรวจยืนยัน",
 CONFIRM_PDF_REQUIRED:"กรุณาแนบไฟล์ PDF รายงานผลจาก outlab",
 CONFIRM_PDF_ONLY_WITH_RESULT:"แนบ PDF ได้เฉพาะสถานะ มีผลแล้ว หรือ ใช้ผลหลังคลอด",
 CONFIRM_NOT_PDF:"ไฟล์นี้ไม่ใช่ PDF",
 FILE_TOO_LARGE:"ไฟล์ใหญ่เกิน 8 MB",
 NOT_FOUND:"ไม่พบเคสนี้ในรายการติดตามผลยืนยัน",
};
export function confirmError(error:unknown){
 const code=error instanceof LabError?error.code:error instanceof Error?error.message:"";
 if(code==="CONFIRM_DATE_ORDER"||(error instanceof Error&&/CONFIRM_DATE_ORDER/.test(error.message)))return NextResponse.json({code:"CONFIRM_DATE_ORDER",error:"วันออกผลต้องไม่ก่อนวันเจาะ/เก็บสิ่งส่งตรวจ"},{status:422,headers:noStore});
 if(MESSAGES[code])return NextResponse.json({code,error:MESSAGES[code]},{status:error instanceof LabError?error.status:409,headers:noStore});
 return p5Error(error);
}
