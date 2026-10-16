import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { pool,assertDatabaseMode } from "../../packages/db/connection";
import { assertRuntime, configuredOrigin, secureCookie } from "../../packages/security/runtime";
import { readSession, validateCsrf } from "../../packages/security/session";
import { requirePermission, type ResourceScope, type Operation } from "../../packages/security/policy";
export const SESSION_COOKIE="nipt_session";
export const CSRF_COOKIE="nipt_csrf";
export async function currentUser() {
 assertRuntime(); await assertDatabaseMode(pool()); const jar=await cookies();const raw=jar.get(SESSION_COOKIE)?.value;
 return raw ? readSession(pool(),raw) : null;
}
export async function protect(request:NextRequest,action?:string,resource?:ResourceScope,operation:Operation="read") {
 const user=await currentUser();if(!user)throw new Error("UNAUTHENTICATED");
 if(user.mustChangePassword&&!["/api/auth/password","/api/auth/logout","/api/me"].includes(request.nextUrl.pathname))throw new Error("FORBIDDEN");
 if(action) requirePermission(user,action,resource,operation);
 if(!["GET","HEAD","OPTIONS"].includes(request.method)) validateCsrf(request.headers.get("origin"),configuredOrigin().origin,request.headers.get("x-csrf-token")??"",user.csrfHash);
 return user;
}
export function cookieOptions() {return {httpOnly:true,secure:secureCookie(),sameSite:"strict" as const,path:"/",maxAge:8*60*60};}
export function apiError(error:unknown) {
 const code=error instanceof Error?error.message:"INTERNAL_ERROR";
 const status=code==="UNAUTHENTICATED"?401:code==="FORBIDDEN"||code==="CSRF_REJECTED"?403:code.startsWith("P1_")?403:400;
 const messages:Record<string,string>={STALE_VERSION:'ข้อมูลเปลี่ยนไปแล้ว กรุณาโหลดข้อมูลใหม่ก่อนบันทึก',UNIT_CODE_IN_USE:'รหัสหน่วยงานนี้มีข้อมูลอ้างอิงแล้ว จึงเปลี่ยนไม่ได้ ใช้การแก้ชื่อหรือ Inactive แทน',INDEPENDENT_RECOVERY_REQUIRED:'บัญชีสิทธิ์สูงต้องขอกู้คืนโดยผู้ตรวจอีกคน แล้วลงทะเบียนรหัสผ่านเฉพาะเจ้าของบัญชีผ่านผู้ติดตั้ง',ACTIVE_UNIT_REQUIRED:'หน่วยงานที่เลือกต้องยังเปิดใช้งาน กรุณาโหลดรายการใหม่',SETTING_RUNTIME_CONSUMER_UNAVAILABLE:'ค่านี้ยังไม่มี Runtime Consumer จึงเป็นข้อมูลอ่านอย่างเดียว',INSTALLATION_OWNED_SETTING:'ค่านี้อยู่ในการดูแลของผู้ติดตั้ง ไม่เปลี่ยนผ่าน Web',CONTROLLED_METADATA_READ_ONLY:'ชื่อรุ่น Template/สูตรเป็น Metadata ควบคุม ไม่ใช่ช่องเปลี่ยน Template หรือการคำนวณ',CURRENT_PASSWORD_INVALID:'รหัสผ่านปัจจุบันไม่ถูกต้องหรือบัญชีถูกล็อก กรุณาตรวจข้อมูลแล้วลองภายหลัง'};
 const databaseCode=typeof error==='object'&&error!==null&&'code' in error?error.code:undefined;
 if(status===400&&(messages[code]||databaseCode==='55P03'))return NextResponse.json({error:messages[code]??'มี Signing Session หรือการทำงานบัญชีนี้อยู่ กรุณารอให้จบแล้วลองใหม่'},{status,headers:{'Cache-Control':'no-store'}});
 return NextResponse.json({error:status===401?"กรุณาเข้าสู่ระบบอีกครั้ง":status===403?"ไม่มีสิทธิ์ทำรายการนี้ หรือการยืนยันหมดอายุ กรุณาตรวจสิทธิ์และลองใหม่":"ทำรายการไม่สำเร็จ กรุณาตรวจข้อมูลแล้วลองอีกครั้ง"},{status,headers:{"Cache-Control":"no-store"}});
}
export async function readJson(request:NextRequest,maxBytes=16_384):Promise<Record<string,unknown>> {
 if(!request.headers.get("content-type")?.startsWith("application/json"))throw new Error("JSON_REQUIRED");
 const reader=request.body?.getReader();if(!reader)throw new Error("BODY_REQUIRED");
 const parts:Uint8Array[]=[];let size=0;
 while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>maxBytes){await reader.cancel();throw new Error("BODY_TOO_LARGE");}parts.push(value);}
 const value:unknown=JSON.parse(Buffer.concat(parts).toString("utf8"));
 if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("OBJECT_REQUIRED");
 return value as Record<string,unknown>;
}
