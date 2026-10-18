import {NextResponse,type NextRequest} from "next/server";
import {ZodError} from "zod";
import {withTransaction} from "../../packages/db/connection";
import {appendAudit} from "../../packages/db/audit";
import {LabError,type Staff} from "../../packages/lab/core";
import {PhotoStorageError} from "../../packages/run-photos/store";
import {protect} from "./http";
import {p4Error,noStore} from "./p4";

export {noStore};
// Storage problems only ever affect photos; the wording says so, so staff know clinical work can continue.
const OFFLINE="ที่เก็บภาพเข้าถึงไม่ได้ขณะนี้ — งาน Run, Task List, QC, Pooling, ผลตรวจ และ HIS ทำต่อได้ตามปกติ กรุณาแจ้งผู้ดูแลระบบ แล้วลองอัปโหลดหรือเปิดภาพอีกครั้งภายหลัง";
const MESSAGES:Record<string,string>={
 FORBIDDEN:"ไม่มีสิทธิ์ทำรายการนี้",NOT_FOUND:"ไม่พบรายการ หรือไม่มีสิทธิ์เห็นรายการนี้",VERSION_CONFLICT:"ภาพนี้ถูกแก้จากอีกหน้าจอ กรุณาโหลดข้อมูลล่าสุดแล้วทำรายการอีกครั้ง",
 STORAGE_UNAVAILABLE:OFFLINE,STORAGE_TIMEOUT:OFFLINE,STORAGE_ACCESS_DENIED:"บัญชีที่ระบบใช้เก็บภาพไม่มีสิทธิ์เขียนหรืออ่านที่เก็บภาพ — งานหลักทำต่อได้ตามปกติ กรุณาแจ้งผู้ดูแลระบบ",STORAGE_FULL:"ที่เก็บภาพเต็ม — งานหลักทำต่อได้ตามปกติ กรุณาแจ้งผู้ดูแลระบบ",
 FILE_MISSING:"ไม่พบไฟล์ภาพในที่เก็บ (อาจถูกย้ายหรือที่เก็บเดิมไม่ได้เชื่อมต่อ) — ข้อมูลภาพยังอยู่ในระบบ กรุณาแจ้งผู้ดูแลระบบ",HASH_MISMATCH:"ไฟล์ภาพในที่เก็บไม่ตรงกับ SHA-256 ที่บันทึกตอนอัปโหลด ระบบจึงไม่แสดงไฟล์นี้ กรุณาแจ้งผู้ดูแลระบบ",
 WRITE_VERIFY_FAILED:"บันทึกไฟล์แล้วอ่านกลับไม่ตรงกัน ระบบไม่ได้บันทึกภาพนี้ กรุณาลองอีกครั้ง",IMMUTABLE_COLLISION:"ที่เก็บมีไฟล์ชื่อเดียวกันแต่เนื้อหาต่างกัน กรุณาแจ้งผู้ดูแลระบบ",
 EMPTY_FILE:"ไฟล์ว่าง",FILE_TOO_LARGE:"ไฟล์ใหญ่เกินกำหนด",UPLOAD_TOO_LARGE:"ไฟล์ใหญ่เกินกำหนด",FILE_REQUIRED:"กรุณาเลือกภาพ",UNSUPPORTED_IMAGE:"รับเฉพาะภาพ JPEG, PNG, WebP หรือ HEIC จากกล้อง",THUMBNAIL_INVALID:"ภาพย่อที่เบราว์เซอร์สร้างไม่ถูกต้อง กรุณาลองอีกครั้ง",THUMBNAIL_MISSING:"ภาพนี้ไม่มีภาพย่อ เปิดภาพต้นฉบับแทน",
 DUPLICATE_IN_RUN:"ภาพนี้ (ไฟล์เดียวกันทุกไบต์) มีอยู่แล้วใน Run นี้ — ไม่ได้บันทึกซ้ำ",IDEMPOTENCY_KEY_REUSED:"คำขอนี้ถูกใช้กับภาพอื่นแล้ว กรุณาโหลดหน้าใหม่",
 TAKEN_ON_FUTURE:"วันที่ถ่ายภาพอยู่ในอนาคต",TAKEN_ON_TOO_OLD:"วันที่ถ่ายภาพเก่าเกินไป กรุณาตรวจปี พ.ศ.",RUN_PHOTO_RETRACTED:"ภาพนี้ถูกถอนออกแล้ว แก้ไขต่อไม่ได้",RUN_PHOTO_SAME_RUN:"ภาพอยู่ใน Run นี้อยู่แล้ว",
 RUN_QUERY_INVALID:"กรอกเลข Run เช่น 12, Run012 หรือ 012/2026",LN_HALOS_QUERY_INVALID:"LN Halos มีรูปแบบ เช่น 26B261018001",LN_HIS_QUERY_INVALID:"LN HIS เป็นตัวเลขเท่านั้น",
 STORAGE_TEST_FAILED:"ทดสอบที่เก็บไม่ผ่าน จึงยังไม่เปลี่ยน Path — ดูรายการตรวจด้านล่าง",STORAGE_TEST_PATH_MISMATCH:"Path ที่ทดสอบไม่ตรงกับ Path ที่จะบันทึก",STORAGE_PATH_UNCHANGED:"Path นี้เป็นที่เก็บที่ใช้งานอยู่แล้ว",
 PATH_LENGTH:"Path ว่างหรือยาวเกิน 400 ตัวอักษร",PATH_CONTROL_CHARACTER:"Path มีอักขระควบคุม",PATH_DEVICE_NAMESPACE:"ไม่รับ Path แบบ \\\\?\\ หรือ \\\\.\\",PATH_NOT_ABSOLUTE:"ใช้ Path เต็ม เช่น D:\\NIPT-CBH\\RunPhotos หรือ \\\\LAB-SERVER\\NIPT-Photos",
 PATH_INVALID_CHARACTER:"Path มีอักขระที่ Windows ไม่รับ (< > \" | ? *)",PATH_TRAVERSAL:"Path ต้องไม่มี . หรือ ..",PATH_RESERVED_NAME:"Path มีชื่อที่ Windows สงวนไว้ หรือชื่อโฟลเดอร์ลงท้ายด้วยจุด/ช่องว่าง",PATH_DRIVE_ROOT:"เลือกโฟลเดอร์ย่อย ไม่ใช่รากของไดรฟ์",
 PATH_PUBLISHED_BY_WEB:"ห้ามใช้โฟลเดอร์ที่ Web Server เผยแพร่หรือ Build",PATH_OUTSIDE_ALLOWED_ROOTS:"Path อยู่นอกโฟลเดอร์ที่ผู้ติดตั้งอนุญาต (NIPT_RUN_PHOTO_ALLOWED_ROOTS)"
};
export function photoError(error:unknown){
 if(error instanceof ZodError){const m=error.issues.map(x=>x.message);
  const text=m.includes("SAMPLE_RANGE_INCOMPLETE")?"ระบุลำดับตัวอย่างให้ครบทั้ง \"ตั้งแต่\" และ \"ถึง\" หรือเว้นว่างทั้งคู่":m.includes("SAMPLE_RANGE_ORDER")?"ลำดับ \"ถึง\" ต้องไม่น้อยกว่า \"ตั้งแต่\"":m.includes("CAPTION_TEXT_INVALID")?"คำอธิบายต้องไม่มีเลข 13 หลักหรืออักขระควบคุม":
   m.includes("DATE_LIKELY_BUDDHIST_ERA")?"ปีของวันที่ดูเป็น พ.ศ. ที่ถูกส่งเป็น ค.ศ. — กรุณากรอกวันที่ใหม่":m.includes("INVALID_DATE")?"วันที่ไม่มีอยู่จริงในปฏิทิน":"ข้อมูลไม่ครบหรือไม่ถูกต้อง — เหตุผลต้องมีอย่างน้อย 8 ตัวอักษร";
  return NextResponse.json({code:"VALIDATION_ERROR",error:text,issues:error.issues.map(x=>({path:x.path.join("."),message:x.message}))},{status:422,headers:noStore});}
 const code=error instanceof LabError||error instanceof PhotoStorageError?error.code:error instanceof Error?error.message:"";
 if(MESSAGES[code]){const storage=/^(STORAGE_|FILE_MISSING|HASH_MISMATCH|WRITE_VERIFY|IMMUTABLE_COLLISION)/.test(code);
  const status=error instanceof LabError?error.status:storage?(code==="FILE_MISSING"?404:503):code==="FORBIDDEN"?403:code==="NOT_FOUND"?404:code.startsWith("PATH_")?422:409;
  return NextResponse.json({code,error:MESSAGES[code],...(error instanceof LabError&&error.details?{details:error.details}:{})},{status,headers:noStore});}
 return p4Error(error);
}
/** Failed mutations roll back; denials are audited in their own transaction. */
export async function photoMutation(request:NextRequest,operation:string,fn:(user:Staff)=>Promise<Response>){
 let user:Staff|undefined;
 try{user=await protect(request);return await fn(user);}
 catch(error){const code=error instanceof LabError?error.code:error instanceof Error?error.message:"";
  if(user&&code==="FORBIDDEN")await withTransaction(db=>appendAudit(db,{actorId:user!.id,action:"RUN_PHOTO_DENIED",resourceType:"RUN_PHOTO_OPERATION",details:{reasonCode:operation,outcome:code}})).catch(()=>undefined);
  return photoError(error);}
}
/** Reads a request body with a hard byte limit (the multipart upload route bypasses the proxy's 10 MB body buffer). */
export async function boundedBody(request:NextRequest,maxBytes:number){
 if(Number(request.headers.get("content-length")??0)>maxBytes)throw new LabError("UPLOAD_TOO_LARGE",413);
 const reader=request.body?.getReader();if(!reader)throw new LabError("FILE_REQUIRED",422);
 const parts:Uint8Array[]=[];let size=0;
 while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>maxBytes){await reader.cancel();throw new LabError("UPLOAD_TOO_LARGE",413);}parts.push(value);}
 return Buffer.concat(parts);
}
