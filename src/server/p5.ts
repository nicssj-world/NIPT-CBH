import {NextResponse,type NextRequest} from "next/server";
import path from "node:path";
import {ZodError} from "zod";
import {withTransaction,type Queryable} from "../../packages/db/connection";
import {appendAudit} from "../../packages/db/audit";
import {FileStore} from "../../packages/storage";
import {LabError,type Staff} from "../../packages/lab/core";
import {resultSettings} from "../../packages/results/service";
import {protect} from "./http";
import {p4Error,noStore} from "./p4";

export {noStore};
export const resultStore=()=>new FileStore(path.resolve(/* turbopackIgnore: true */ process.env.FILE_STORE_ROOT||"data/files"));
const MESSAGES:Record<string,string>={
 FORBIDDEN:"ไม่มีสิทธิ์ทำรายการนี้",NOT_FOUND:"ไม่พบรายการ หรือไม่มีสิทธิ์เห็นรายการนี้",VERSION_CONFLICT:"มีผู้ใช้อื่นเปลี่ยนรายการนี้ก่อนหน้า กรุณาโหลดข้อมูลล่าสุดแล้วทำรายการอีกครั้ง",
 IDENTITY_CONFLICT_WITH_SELECTED_CASE:"ข้อมูลใน PDF ไม่ตรงกับผู้ป่วย/รอบที่เลือก — ไม่ได้แนบไฟล์",IDENTITY_NOT_VERIFIABLE:"PDF ไม่มีข้อมูลระบุตัวตนครบพอจะยืนยันกับรายการนี้",UPLOAD_NOT_READY:"ไฟล์นี้ยังไม่พร้อมยืนยัน หรือถูกปฏิเสธแล้ว — อัปโหลดใหม่",AUTO_LINK_TARGET_DIFFERS:"ระบบจับคู่ไฟล์นี้กับรายการอื่น — ไม่ได้แนบ",FILE_REQUIRED:"กรุณาเลือกไฟล์ PDF",EMPTY_FILE:"ไฟล์ว่าง",FILE_TOO_LARGE:"ไฟล์ใหญ่เกินกำหนด",
 AUTO_MATCH_NOT_UNAMBIGUOUS:"ระบบจับคู่ไม่ได้ชัดเจนเพียงรายการเดียว — เลือกรอบและ Attempt เอง",OPERATIONAL_MODE_REQUIRED:"ใช้ได้ในโหมดใช้งานจริงเท่านั้น",
 SECOND_PERSON_REQUIRED:"ผู้เสนอการเชื่อมโยงยืนยันรายการของตนเองไม่ได้ ต้องให้ผู้รับรองอีกคนตัดสิน",LINK_PROPOSAL_REQUIRED:"ยังไม่มีข้อเสนอการเชื่อมโยงให้ตัดสิน",LINK_PROPOSAL_OPEN:"มีข้อเสนอที่รอตัดสินอยู่แล้ว",
 LINK_REQUIRES_UNLINKED:"รายการนี้เชื่อมโยงแล้ว หรือไม่อยู่ในสถานะรอเชื่อมโยง",ATTEMPT_REQUIRED_FOR_RESULT:"ผลตรวจต้องเชื่อมกับ Attempt ที่ระบุ ไม่ใช่เพียงรอบ",ATTEMPT_NOT_IN_ROUND:"Attempt ที่เลือกไม่อยู่ในรอบนี้",
 REVISION_DETAILS_REQUIRED:"รอบนี้มีรายงานที่เปิดอยู่แล้ว — ต้องระบุข้อมูลการแก้ไข (วันที่รับเรื่อง ผู้ขอ เหตุผล) เพื่อทำเป็นฉบับแก้ไข",NO_VERSION_TO_REVISE:"รอบนี้ยังไม่มีรายงานที่จะแก้ไข",
 SERIES_CHANGED_SINCE_PROPOSAL:"รายงานของรอบนี้เปลี่ยนไปหลังการเสนอ กรุณาปฏิเสธข้อเสนอแล้วเสนอใหม่",HISTORICAL_LINK_PROHIBITED:"เคสย้อนหลังใช้ช่องทางนี้ไม่ได้",
 UNLINK_NOT_ALLOWED:"ถอดการเชื่อมโยงได้เฉพาะรายการที่เชื่อมแล้วและยังไม่ปล่อยผล",UNLINK_REVISION_PROHIBITED:"ฉบับแก้ไขที่แทนฉบับเดิมแล้วถอดการเชื่อมโยงไม่ได้ — ให้นำเข้าฉบับใหม่แทน",
 REVIEW_REQUIRES_LINKED:"ตรวจทานได้หลังเชื่อมโยงกับรอบ/Attempt แล้วเท่านั้น",VALIDATION_REQUIRES_LINKED:"ประเมิน Gate ได้หลังเชื่อมโยงแล้วเท่านั้น",ABNORMAL_ACK_REQUIRED:"ผลผิดปกติ (High risk / Detected) ต้องติ๊กรับทราบก่อน",
 IDEMPOTENCY_KEY_REUSED:"คำขอนี้ถูกใช้กับรายการอื่นแล้ว กรุณาโหลดหน้าใหม่",VOID_REQUIRES_UNLINKED:"ยกเลิกได้เฉพาะรายการนำเข้าที่ยังไม่เชื่อมโยง",
 RELEASE_HOLD_AL5:"การปล่อยผลจริงยังถูกระงับ (AL-5 / OD-05 / OD-07)",
 NAME_CONFLICT_ACK_REQUIRED:"มีไฟล์ชื่อซ้ำกับรายงานที่มีอยู่แต่เนื้อหาต่างกัน — ติ๊กรับทราบในแถวที่เตือนก่อนนำเข้า แล้วจึงตรวจว่าเป็นรายงานใหม่หรือฉบับแก้ไข",
 NAME_REVIEW_REQUIRED:"ไฟล์นี้ชื่อซ้ำกับรายงานอื่นแต่เนื้อหาต่างกัน — ต้องระบุว่าเป็นรายงานใหม่หรือฉบับแก้ไขก่อนเสนอการเชื่อมโยง",NAME_REVIEW_MISMATCH:"เลือก รายงานใหม่ แล้ว จึงระบุข้อมูลคำขอแก้ไขไม่ได้",FILE_COUNT_INVALID:"เลือกได้ 1–20 ไฟล์ต่อครั้ง",UPLOAD_TOO_LARGE:"ไฟล์รวมใหญ่เกินกำหนด",INVALID_REQUEST:"คำขอไม่ถูกต้อง"
};
export function p5Error(error:unknown){
 if(error instanceof ZodError)return NextResponse.json({code:"VALIDATION_ERROR",error:"ข้อมูลไม่ครบหรือไม่ถูกต้อง — เหตุผลต้องมีอย่างน้อย 8 ตัวอักษร",issues:error.issues.map(x=>({path:x.path.join("."),message:x.message}))},{status:422,headers:noStore});
 const code=error instanceof LabError?error.code:error instanceof Error?error.message:"";
 if(MESSAGES[code]){const status=error instanceof LabError?error.status:code==="FORBIDDEN"?403:code==="NOT_FOUND"?404:409;return NextResponse.json({code,error:MESSAGES[code],...(error instanceof LabError&&error.details?{details:error.details}:{})},{status,headers:noStore});}
 return p4Error(error);
}
/** Failed mutations roll back; denials and second-person refusals are then audited in their own transaction. */
export async function p5Mutation(request:NextRequest,operation:string,fn:(user:Staff)=>Promise<Response>){
 let user:Staff|undefined;
 try{user=await protect(request);return await fn(user);}
 catch(error){const code=error instanceof LabError?error.code:error instanceof Error?error.message:"";
  if(user&&/^(FORBIDDEN|SECOND_PERSON_REQUIRED)$/.test(code))await withTransaction(db=>appendAudit(db,{actorId:user!.id,action:"P5_MUTATION_DENIED",resourceType:"P5_OPERATION",details:{reasonCode:operation,outcome:code,synthetic:true}})).catch(()=>undefined);
  return p5Error(error);}
}
/** Intake page header: folder setting, limits, and this user's latest Test Path / Scan receipts (worker output). */
export async function intakeContext(db:Queryable,user:Staff){
 const s=await resultSettings(db);
 const jobs=(await db.query<{kind:string;id:string;result:Record<string,unknown>|null;created_at:Date;completed_at:Date|null}>(
  "SELECT DISTINCT ON(o.kind) o.kind,o.id,r.result,o.created_at,r.completed_at FROM job_outbox o LEFT JOIN integration_job_receipt r ON r.outbox_id=o.id WHERE o.kind IN ('synthetic_result_test_path','synthetic_result_scan') AND o.payload->>'actorId'=$1 ORDER BY o.kind,o.created_at DESC",[user.id])).rows;
 // A23: the latest completed listing-only scheduled scan, shared by everyone allowed to import (it contains no parsed values).
 const scheduled=(await db.query<{result:Record<string,unknown>;completed_at:Date}>("SELECT r.result,r.completed_at FROM job_outbox o JOIN integration_job_receipt r ON r.outbox_id=o.id WHERE o.kind='synthetic_result_scan' AND o.payload->>'trigger'='SCHEDULED' ORDER BY r.completed_at DESC LIMIT 1")).rows[0]??null;
 return {folder:s.pdfSourcePath,scanSubfolders:s.scanSubfolders,acceptZip:s.acceptZip,maxUploadMb:s.maxUploadMb,maxFilesPerScan:s.maxFilesPerScan,picVersion:s.picVersion,scheduledScanMinutes:s.scheduledScanMinutes,lastScheduled:scheduled,
  lastTest:jobs.find(j=>j.kind==='synthetic_result_test_path')??null,lastScan:jobs.find(j=>j.kind==='synthetic_result_scan')??null};
}
export const pdfResponse=(bytes:Buffer,sha:string,inline:boolean,name:string)=>new NextResponse(new Uint8Array(bytes),{headers:{"Content-Type":inline?"application/pdf":"application/octet-stream",
 "Content-Disposition":`${inline?"inline":"attachment"}; filename="${name.replace(/[^A-Za-z0-9._-]/g,"_")}"`,"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff","X-Document-SHA256":sha}});
