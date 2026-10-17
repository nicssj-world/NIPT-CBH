import {NextResponse,type NextRequest} from "next/server";
import path from "node:path";
import {randomUUID} from "node:crypto";
import {ZodError} from "zod";
import {withTransaction} from "../../packages/db/connection";
import {appendAudit} from "../../packages/db/audit";
import {FileStore} from "../../packages/storage";
import {requestP4Pdf} from "../../packages/pdf/p4";
import {LabError} from "../../packages/lab/core";
import {protect} from "./http";

export const noStore={"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"};
export const labDeps=()=>({render:requestP4Pdf,store:new FileStore(path.resolve(/* turbopackIgnore: true */ process.env.FILE_STORE_ROOT||"data/files")),native:async(db:import('../../packages/db/connection').Queryable,user:import('../../packages/lab/core').Staff,input:import('../../packages/workbook/controlled').NativeIssueInput)=>{
 const [{workbookDeps},{issueNativeWorkbook}]=await Promise.all([import('./workbook'),import('../../packages/workbook/controlled')]);return issueNativeWorkbook(db,user,input,await workbookDeps());
}});
const MESSAGES:Record<string,string>={
 TASK_PDF_ONE_PAGE_A4_REQUIRED:"PDF ของ QC/Pooling/Seq ยังไม่ตรงข้อกำหนด 1 หน้า A4 ระบบจึงยังไม่ออกเอกสารนี้",TASK_PDF_DRIVER_COORDINATES_MISMATCH:"ขนาดหน้าจากเครื่อง Render ไม่ตรงกับ Print Settings ที่อนุมัติ กรุณาตรวจเครื่อง Render ก่อนออกเอกสาร",
 TASK_PREWORK_ACTUALS_PRESENT:"ใบงานนี้มีค่าปฏิบัติที่บันทึกแล้ว จึงออก Pre-work ที่ต้องเว้นช่องปฏิบัติไม่ได้ กรุณาตรวจ Draft หรือออกฉบับ Completed ตามขั้นตอน โดยข้อมูลเดิมยังถูกเก็บไว้",
 TASK_POOL_CONCENTRATION_REQUIRED:"กรอกความเข้มข้นก่อนเจือจางที่มากกว่าศูนย์ในใบงาน Master ก่อนออก Pooling ฉบับสมบูรณ์",TASK_CURRENT_POOL_REQUIRED:"Pool ที่เลือกไม่ตรงกับข้อมูลปัจจุบันของใบงาน กรุณาตรวจ Pool และ DNB ที่ใช้งาน",TASK_CURRENT_DNB_REQUIRED:"DNB ที่เลือกไม่ใช่ฉบับปัจจุบันของใบงาน",TASK_NATIVE_CONTROLLED_RENDERER_REQUIRED:"ยังไม่ได้เชื่อมการออกเอกสารกับ Excel Master ที่ล็อกไว้ จึงยังออกเอกสารฉบับปฏิบัติงานไม่ได้",
 FORBIDDEN:"ไม่มีสิทธิ์ทำรายการนี้",VERSION_CONFLICT:"มีผู้ใช้อื่นแก้ Batch นี้ก่อนหน้า กรุณาโหลดข้อมูลล่าสุดแล้วทำรายการอีกครั้ง",NOT_FOUND:"ไม่พบรายการ หรือไม่มีสิทธิ์เห็นรายการนี้",
 QUEUE_OVERRIDE_REASON_REQUIRED:"รายการที่เลือกแซงลำดับ FIFO ของตัวอย่างที่พร้อมก่อน ต้องระบุเหตุผล",CONTROL_SLOT_PROTECTED:"ตำแหน่ง Control (PC 1, NC 25, Blank 40) ย้ายหรือวางทับไม่ได้",
 PLACEMENT_LOCKED:"Sheet นี้ล็อกแผนตำแหน่งแล้ว — แก้ได้ผ่าน Controlled amendment ก่อนเริ่มปฏิบัติเท่านั้น",REASON_REQUIRED_AFTER_PLAN_CHECK:"แผนนี้ยืนยันแล้ว การเปลี่ยนต้องระบุเหตุผล",
 PLANNED_WORK_DATE_REQUIRED_FOR_CONTROL_CODES:"ระบุวันที่ปฏิบัติงานที่วางแผนก่อน เพราะรหัส Control สร้างจากวันที่ของ Sheet",SHEET_HAS_NO_SAMPLES:"Sheet นี้ยังไม่มีตัวอย่าง",
 PLAN_CHECK_REQUIRED:"ต้องยืนยันแผนตำแหน่งของ Version ปัจจุบันก่อน Finalize",FINALIZE_GATE_FAILED:"Finalize ไม่สำเร็จทั้ง Sheet — มีตัวอย่างที่ไม่ผ่าน Finalize Gate (ดูรายการด้านล่าง)",
 PRE_WORK_REQUIRED_BEFORE_EXECUTION:"ต้องออกใบงาน Pre-work ก่อนเริ่มปฏิบัติ",RECALL_PENDING:"มีสำเนาใช้งานของฉบับที่ระงับใช้ยังไม่ถูกเรียกคืน",EXECUTION_NOT_STARTED:"ยังไม่ได้บันทึกเริ่มปฏิบัติของ Sheet นี้ — ห้ามบันทึก ✓ ล่วงหน้า",
 EVENT_BEFORE_EXECUTION_ANCHOR:"เวลาเหตุการณ์ก่อนเวลาเริ่มปฏิบัติที่ Server บันทึก",EXECUTION_EVIDENCE_INCOMPLETE:"หลักฐานการปฏิบัติยังไม่ครบหรือยังไม่ทวนสอบ",SECOND_PERSON_REQUIRED:"ต้องให้ผู้อื่นทวนสอบ ผู้บันทึกยืนยันรายการของตนเองไม่ได้",
 OBSERVATION_EXISTS_USE_CORRECTION:"มีค่านี้แล้ว — ใช้การแก้ไขพร้อมเหตุผล ระบบไม่เขียนทับค่าเดิม",QC1_BEFORE_LIBRARY_PRODUCT:"ยังไม่ได้บันทึกจบการปฏิบัติของ Sheet — ยังวัด QC1 ไม่ได้",
 STAGE_QC_REQUIRES_VERIFIED_VALUE:"ต้องมีค่า QC1 ที่ทวนสอบแล้วก่อนตัดสิน",QC1_RECORD_INCOMPLETE:"QC1 ยังบันทึกไม่ครบ (ทุกตำแหน่งต้องมีค่าและการตัดสิน หรือ Disposition ที่ยืนยันแล้ว)",
 REPRINT_REASON_REQUIRED:"เคยพิมพ์ฉลากแล้ว — การพิมพ์ซ้ำต้องระบุเหตุผล (ไม่ออกเลขใหม่)",PREGNANCY_TYPE_UNCONFIRMED:"ยังไม่ยืนยันประเภทครรภ์ใน Request — ครรภ์แฝดต้องมี D ตาม Genomic-CBH จึงยังพิมพ์ฉลากไม่ได้",
 LN_HALOS_NOT_ISSUED_OR_NOT_VISIBLE:"ยังไม่มี LN Halos (ออกเมื่อรับสิ่งส่งตรวจจริงเท่านั้น)",S1_RECEIVED_IN_HIS_ONLY:"รอบที่ 1 รับผ่าน HIS เท่านั้น",ROUND_NOT_EXPECTED:"รอบนี้ไม่ได้อยู่ในสถานะรอรับ",
 COLLECTION_DATE_FUTURE:"วันที่เจาะเลือดอยู่ในอนาคต",COLLECTION_DATE_BEFORE_PREVIOUS_ROUND:"วันที่เจาะต้องไม่ก่อนวันที่เจาะของรอบก่อน",REDRAW_REQUIRES_RECEIVED_CURRENT_ROUND:"สั่งเก็บตัวอย่างใหม่ได้เฉพาะรอบปัจจุบันที่รับแล้ว",
 REPEAT_REQUIRES_FAILED_OR_STOPPED_ATTEMPT:"สั่งตรวจซ้ำได้เมื่อ Attempt ไม่ผ่าน QC ถูกหยุด หรือ Batch ถูกยกเลิก",REDRAW_CANCEL_ONLY_BEFORE_RECEIPT:"ยกเลิกคำสั่งได้เฉพาะก่อนรับตัวอย่างรอบใหม่",
 CANCEL_ONLY_BEFORE_EXECUTION:"ยกเลิก Batch ได้เฉพาะก่อนเริ่มปฏิบัติ",AMEND_ONLY_BEFORE_EXECUTION:"แก้แผนได้เฉพาะหลัง Finalize และก่อนเริ่มปฏิบัติ",SLOT_NOT_IN_USE:"ตำแหน่งนี้ไม่มีตัวอย่างหรือ Control",
 WORKING_COPY_ONLY_FROM_ISSUED_PRE_WORK:"พิมพ์สำเนาใช้งานได้จากใบงาน Pre-work ที่ยังมีผลเท่านั้น",LN_HALOS_REQUIRES_RECEIPT:"ออก LN Halos ได้เฉพาะรอบที่รับสิ่งส่งตรวจจริงแล้ว",BATCH_CANCELLED:"Batch นี้ถูกยกเลิกแล้ว"
};
export function p4Error(error:unknown){
 if(error instanceof ZodError){
  // Date guard (Plan Rev 3.4 §7.2) gets its own wording; every other validation message is unchanged.
  const dateIssue=error.issues.find(x=>x.message==="DATE_LIKELY_BUDDHIST_ERA"||x.message==="INVALID_DATE")?.message;
  const text=dateIssue==="DATE_LIKELY_BUDDHIST_ERA"?"ปีของวันที่ดูเป็น พ.ศ. ที่ถูกส่งเป็น ค.ศ. — กรุณากรอกวันที่ใหม่เป็น วว/ดด/ปปปป (พ.ศ.)":dateIssue==="INVALID_DATE"?"วันที่ไม่มีอยู่จริงในปฏิทิน — กรุณาตรวจวันและเดือน":"ข้อมูลไม่ครบหรือไม่ถูกต้อง — เหตุผลต้องมีอย่างน้อย 8 ตัวอักษร";
  return NextResponse.json({code:dateIssue??"VALIDATION_ERROR",error:text,issues:error.issues.map(x=>({path:x.path.join("."),message:x.message}))},{status:422,headers:noStore});
 }
 const code=error instanceof LabError?error.code:error instanceof Error?error.message:"INTERNAL_ERROR";
 const db=/^[A-Z][A-Z0-9_]+$/.test(code)?code:null;
 const status=error instanceof LabError?error.status:code==="UNAUTHENTICATED"?401:code==="FORBIDDEN"||code==="CSRF_REJECTED"?403:db?409:400;
 return NextResponse.json({code:db??"INVALID_REQUEST",error:MESSAGES[code]??(status===401?"กรุณาเข้าสู่ระบบอีกครั้ง":status===403?"ไม่มีสิทธิ์ทำรายการนี้":"ทำรายการไม่สำเร็จ กรุณาตรวจข้อมูลแล้วลองอีกครั้ง"),...(error instanceof LabError&&error.details?{details:error.details}:{})},{status,headers:noStore});
}
/** The failed operation has rolled back; denials are then audited in an independent transaction (same rule as P2). */
export async function p4Mutation(request:NextRequest,operation:string,fn:(user:Awaited<ReturnType<typeof protect>>)=>Promise<Response>){
 let user:Awaited<ReturnType<typeof protect>>|undefined;
 try{user=await protect(request);return await fn(user);}
 catch(error){const code=error instanceof LabError?error.code:error instanceof Error?error.message:"";
  if(user&&/^(FORBIDDEN|SECOND_PERSON_REQUIRED|FINALIZE_GATE_FAILED)$/.test(code))await withTransaction(db=>appendAudit(db,{actorId:user!.id,action:"P4_MUTATION_DENIED",resourceType:"P4_OPERATION",details:{reasonCode:operation,outcome:code,synthetic:true}})).catch(()=>undefined);
  return p4Error(error);}
}
// Label sheets are served by /api/p4/label-sheet/[id] under their own strict CSP (no script, inline style only); entries are
// bound to the staff session, held in process memory for 10 minutes and never written to disk.
type Sheet={html:string;sessionId:string;expiresAt:number};
const sheets=new Map<string,Sheet>();
export function putLabelSheet(html:string,sessionId:string){const now=Date.now();for(const [k,v] of sheets)if(v.expiresAt<=now)sheets.delete(k);while(sheets.size>=64)sheets.delete(sheets.keys().next().value!);const id=randomUUID();sheets.set(id,{html,sessionId,expiresAt:now+600000});return id;}
export function getLabelSheet(id:string,sessionId:string){const s=sheets.get(id);if(!s||s.sessionId!==sessionId||s.expiresAt<=Date.now())return null;return s.html;}
