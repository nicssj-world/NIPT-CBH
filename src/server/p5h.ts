import {NextResponse,type NextRequest} from "next/server";
import {readFile} from "node:fs/promises";
import {ZodError} from "zod";
import {withTransaction} from "../../packages/db/connection";
import {appendAudit} from "../../packages/db/audit";
import {LabError,type Staff} from "../../packages/lab/core";
import {protect} from "./http";
import {p4Error,noStore} from "./p4";

export {noStore};
const MESSAGES:Record<string,string>={
 FORBIDDEN:"ไม่มีสิทธิ์ทำรายการนี้",NOT_FOUND:"ไม่พบรายการ หรือไม่มีสิทธิ์เห็นรายการนี้",
 TABLE_TYPE_NOT_SUPPORTED:"ตารางต้องเป็นไฟล์ .xlsx หรือ .csv",TABLE_EMPTY:"ไฟล์ตารางว่าง",TABLE_TOO_LARGE:"ไฟล์ตารางใหญ่เกิน 5 MB",UPLOAD_TOO_LARGE:"ไฟล์ที่อัปโหลดรวมกันใหญ่เกินกำหนด",TOO_MANY_FILES:"จำนวนไฟล์มากเกินกำหนด (สูงสุด 150 ไฟล์)",
 IDEMPOTENCY_KEY_INVALID:"รหัสป้องกันการส่งซ้ำไม่ถูกต้อง",IDEMPOTENCY_KEY_REUSED:"คำขอนี้ถูกใช้กับรายการอื่นแล้ว กรุณาโหลดหน้าใหม่",
 ROW_NOT_EDITABLE:"แถวนี้อยู่ในสถานะที่แก้ไขไม่ได้แล้ว",COLUMN_NOT_EDITABLE:"คอลัมน์นี้แก้ไขไม่ได้",REASON_REQUIRED:"ต้องระบุเหตุผลอย่างน้อย 8 ตัวอักษร",
 HISTORICAL_POLICY_NOT_CONFIGURED:"ยังยืนยันเป็นชุดไม่ได้: Owner ยังไม่อนุมัติชนิดหลักฐาน Anchor (OD-18) หรือวันตัดระบบ (go_live_cutoff) — ระบบหยุดแบบ Fail Closed",
 BATCH_NOT_STAGED:"ชุดนำเข้ายังตรวจไม่เสร็จ หรือประมวลผลไม่สำเร็จ",DUPLICATE_ROW_IN_REQUEST:"มีแถวซ้ำในคำขอ",LOOKUP_KEY_REQUIRED:"ยังไม่ได้ตั้งค่ากุญแจตัวตนของระบบ",
 UNAUTHENTICATED:"กรุณาเข้าสู่ระบบอีกครั้ง",
};
export function p5hError(error:unknown){
 if(error instanceof ZodError)return NextResponse.json({code:"VALIDATION_ERROR",error:"ข้อมูลไม่ครบหรือไม่ถูกต้อง",issues:error.issues.map(x=>({path:x.path.join("."),message:x.message}))},{status:400,headers:noStore});
 const code=error instanceof LabError?error.code:error instanceof Error?error.message:"";
 if(MESSAGES[code]){const status=error instanceof LabError?error.status:code==="FORBIDDEN"?403:code==="NOT_FOUND"?404:code==="UNAUTHENTICATED"?401:409;return NextResponse.json({code,error:MESSAGES[code]},{status,headers:noStore});}
 return p4Error(error);
}
/** Failed mutations roll back; denials are then audited in their own transaction. */
export async function p5hMutation(request:NextRequest,operation:string,fn:(user:Staff)=>Promise<Response>){
 let user:Staff|undefined;
 try{user=await protect(request);return await fn(user);}
 catch(error){const code=error instanceof LabError?error.code:error instanceof Error?error.message:"";
  if(user&&code==="FORBIDDEN")await withTransaction(db=>appendAudit(db,{actorId:user!.id,action:"P5H_MUTATION_DENIED",resourceType:"P5H_OPERATION",details:{reasonCode:operation,outcome:code,synthetic:true}})).catch(()=>undefined);
  return p5hError(error);}
}
let keyCache:Buffer|undefined;
export async function identityLookupKey(){
 if(!keyCache){if(!process.env.IDENTITY_LOOKUP_KEY_FILE)throw new LabError("LOOKUP_KEY_REQUIRED",500);keyCache=await readFile(process.env.IDENTITY_LOOKUP_KEY_FILE);}
 if(keyCache.length!==32)throw new LabError("LOOKUP_KEY_REQUIRED",500);return keyCache;
}
