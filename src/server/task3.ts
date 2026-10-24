import {NextResponse,type NextRequest} from "next/server";
import {LabError} from "../../packages/lab/core";
import {withTransaction} from "../../packages/db/connection";
import {appendAudit} from "../../packages/db/audit";
import type {ReportDeps} from "../../packages/readygen/reports";
import {protect} from "./http";
import {p5Error,noStore,resultStore} from "./p5";

// Task 3 (ReadyGen integration) API helpers: the same authentication, CSRF, no-store and audited-denial rules as P5.
export const reportDeps=():ReportDeps=>({store:resultStore()});
const MESSAGES:Record<string,string>={
 HALOS_REQUIRED_HEADER_MISSING:"ไฟล์นี้ไม่มีคอลัมน์ที่ HALOS ต้องมี — ตรวจว่าเป็นไฟล์ \"Sample analysis data\" ฉบับจริงจาก HALOS",HALOS_RESULT_SHEET_MISSING:"ไม่พบชีต result ในไฟล์ HALOS",HALOS_SAMPLEINFO_SHEET_MISSING:"ไม่พบชีต sampleinfo ในไฟล์ HALOS",
 HALOS_RESULT_SHEET_HAS_NO_ROWS:"ชีต result ไม่มีข้อมูลตัวอย่าง",HALOS_HEADER_DUPLICATE:"หัวคอลัมน์ซ้ำในไฟล์ HALOS",HALOS_SHEET_DUPLICATE:"ชื่อชีตซ้ำในไฟล์ HALOS",XLSX_ACTIVE_CONTENT_REFUSED:"ไฟล์มี Macro/ลิงก์ภายนอก — ปฏิเสธเพื่อความปลอดภัย",
 ZIP_SIGNATURE:"ไฟล์นี้ไม่ใช่ .xlsx ที่ถูกต้อง",FILE_TOO_LARGE:"ไฟล์ใหญ่เกินกำหนด (8 MB)",EMPTY_FILE:"ไฟล์ว่าง",HALOS_WARNINGS_ACK_REQUIRED:"มีคำเตือนที่ต้องรับทราบก่อนยืนยันนำเข้า",HALOS_IMPORT_ALREADY_DECIDED:"ไฟล์นี้ยืนยันหรือยกเลิกไปแล้ว",
 REPORT_VALUES_INCOMPLETE:"ข้อมูลยังไม่ครบสำหรับสร้างร่าง — ดูเหตุผลที่ระงับ",REPORT_MASTER_NOT_INSTALLED:"ยังไม่ได้ติดตั้งแบบฟอร์มรายงาน (DOCX) ที่ตรวจ SHA-256 แล้ว",REPORT_NATIVE_WORD_WINDOWS_REQUIRED:"เครื่องแม่ข่ายต้องมี Microsoft Word สำหรับสร้าง PDF",
 REPORTED_BY_REQUIRED:"กรุณาเลือกผู้รายงาน (Reported by)",APPROVED_BY_REQUIRED:"กรุณาเลือกผู้อนุมัติ (Approved by)",SIGNER_NOT_ELIGIBLE:"ผู้ลงนามที่เลือกไม่มีสิทธิ์ลงนามในบทบาทนี้",SIGNER_PROFILE_NOT_VERIFIED:"ผู้ลงนามยังไม่มีโปรไฟล์ลายเซ็นที่ผ่านการตรวจ หรือถูกเพิกถอนแล้ว",
 SIGNATURE_DELEGATION_REQUIRED:"ใช้ลายเซ็นของผู้อื่นได้เฉพาะเมื่อเจ้าของลายเซ็นมอบสิทธิ์ให้ท่านแล้ว",SIGNER_LICENSE_OR_SIGNATURE_MISSING:"ผู้ลงนามยังไม่มีเลขใบอนุญาตหรือภาพลายเซ็น",SIGNER_ROLE_REQUIRED:"เฉพาะเจ้าหน้าที่ห้องปฏิบัติการที่มีสิทธิ์ลงนามเท่านั้น",
 SIGNATURE_IMAGE_FORMAT_INVALID:"ภาพลายเซ็นต้องเป็น PNG หรือ JPEG",SIGNATURE_IMAGE_SIZE_INVALID:"ภาพลายเซ็นต้องไม่เกิน 512 KB",SIGNATURE_IMAGE_DIMENSIONS_INVALID:"ขนาดภาพลายเซ็นไม่เหมาะสม",SIGNER_VERIFICATION_INVALID:"ตรวจโปรไฟล์นี้ไปแล้ว หรือไม่สามารถตรวจโปรไฟล์ของตนเองได้",
 DELEGATION_TO_SELF_INVALID:"มอบสิทธิ์ให้ตนเองไม่ได้",DELEGATE_NOT_ELIGIBLE:"ผู้รับมอบสิทธิ์ต้องเป็นเจ้าหน้าที่ห้องปฏิบัติการที่ใช้งานอยู่",SIGNER_NAME_TOO_LONG_FOR_TEMPLATE:"ชื่อผู้ลงนามยาวเกินพื้นที่ในแบบฟอร์ม — ใช้ชื่อตามใบอนุญาตที่สั้นกว่านี้",
 PATIENT_NAME_TOO_LONG_FOR_TEMPLATE:"ชื่อผู้ป่วยยาวเกินพื้นที่ในแบบฟอร์ม — ระงับไว้ให้ตรวจ",REPORT_RENDER_VERIFICATION_FAILED:"PDF ที่สร้างอ่านกลับไม่ตรงกับข้อมูลที่ผูกไว้ — ไม่ได้ออกรายงาน",PREGNANCY_OVERRIDE_REASON_REQUIRED:"การเปลี่ยนชนิดครรภ์ต้องระบุเหตุผลอย่างน้อย 8 ตัวอักษร",
 DUPLICATE_ROW_IN_BATCH:"มีรายการซ้ำในชุดเดียวกัน",IDEMPOTENCY_KEY_REUSED:"คำขอนี้ถูกใช้แล้ว กรุณาโหลดหน้าใหม่",INTERNAL_RELEASE_REQUIRES_INTERNAL_REPORT:"ใช้ได้กับรายงานที่ออกในระบบเท่านั้น",EXTERNAL_ATTESTATION_NOT_FOR_INTERNAL_REPORT:"รายงานที่ออกในระบบใช้การรับรองของรายงานภายนอกไม่ได้",
 INTERNAL_REPORT_AUTHORITY_REQUIRED:"รายงานนี้ไม่ใช่ฉบับปัจจุบันที่ได้รับอนุมัติ — ส่งผลไม่ได้",HIS_ATTESTATION_TRANSFER_EXISTS:"ระบบเริ่มส่งผลเข้า HIS แล้ว — ใช้การกระทบยอด HIS แทน",HIS_ATTESTATION_EXISTS:"บันทึก \"มีผลใน HIS แล้ว\" ไว้แล้ว",
 HIS_ATTESTATION_LINKED_RESULT_REQUIRED:"บันทึกได้เฉพาะผลตรวจที่เชื่อมโยงกับรอบแล้ว",HIS_ATTESTATION_ALREADY_WITHDRAWN:"ยกเลิกการบันทึกนี้ไปแล้ว",FALLBACK_ALREADY_RECORDED:"บันทึกข้อมูลช่วงระบบขัดข้องไว้แล้ว",FALLBACK_REQUIRES_EXTERNAL_VERSION:"ใช้ได้กับ PDF จาก ReadyGen เท่านั้น",
 READYGEN_INPUT_ROW_COUNT_MISMATCH:"สร้างสำเนาสำหรับ ReadyGen ไม่ได้ (จำนวนแถวไม่ตรง)",DOWNLOAD_NAME_TEMPLATE_INVALID:"รูปแบบชื่อไฟล์ไม่ถูกต้อง"
};
export function task3Error(error:unknown){
 const code=error instanceof LabError?error.code:error instanceof Error?error.message:"";
 if(MESSAGES[code])return NextResponse.json({code,error:MESSAGES[code],...(error instanceof LabError&&error.details?{details:error.details}:{})},{status:error instanceof LabError?error.status:409,headers:noStore});
 return p5Error(error);
}
export async function task3Mutation(request:NextRequest,operation:string,fn:(user:Awaited<ReturnType<typeof protect>>)=>Promise<Response>){
 let user:Awaited<ReturnType<typeof protect>>|undefined;
 try{user=await protect(request);return await fn(user);}
 catch(error){const code=error instanceof LabError?error.code:error instanceof Error?error.message:"";
  if(user&&/^(FORBIDDEN|SECOND_PERSON_REQUIRED|SIGNATURE_DELEGATION_REQUIRED|SIGNER_NOT_ELIGIBLE)$/.test(code))await withTransaction(db=>appendAudit(db,{actorId:user!.id,action:"TASK3_MUTATION_DENIED",resourceType:"TASK3_OPERATION",details:{reasonCode:operation,outcome:code}})).catch(()=>undefined);
  return task3Error(error);}
}
/** One uploaded file from multipart form data, bounded before it is read into memory. */
export async function uploadedFile(request:NextRequest,field:string,maxBytes:number){
 if(Number(request.headers.get("content-length")??0)>maxBytes+64*1024)throw new LabError("FILE_TOO_LARGE",413);
 const form=await request.formData(),file=form.get(field);
 if(!file||typeof file==="string")throw new LabError("FILE_REQUIRED",422);
 const bytes=Buffer.from(await file.arrayBuffer());if(bytes.length>maxBytes)throw new LabError("FILE_TOO_LARGE",413);
 return {name:file.name,bytes,form};
}
export const fileResponse=(bytes:Buffer,type:string,name:string,inline=false)=>new NextResponse(new Uint8Array(bytes),{headers:{...noStore,"Content-Type":type,"Content-Length":String(bytes.length),
 "Content-Disposition":`${inline?"inline":"attachment"}; filename="${name.normalize("NFC").replace(/[^A-Za-z0-9._ -]/g,"_").slice(0,150)}"; filename*=UTF-8''${encodeURIComponent(name.normalize("NFC"))}`,"Cache-Control":"private, no-store"}});
