import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { pool } from "../../packages/db/connection";
import { assertSynthetic, configuredOrigin, secureCookie } from "../../packages/security/runtime";
import { readSession, validateCsrf } from "../../packages/security/session";
import { requirePermission, type ResourceScope, type Operation } from "../../packages/security/policy";
export const SESSION_COOKIE="nipt_session";
export const CSRF_COOKIE="nipt_csrf";
export async function currentUser() {
 assertSynthetic(); const jar=await cookies();const raw=jar.get(SESSION_COOKIE)?.value;
 return raw ? readSession(pool(),raw) : null;
}
export async function protect(request:NextRequest,action?:string,resource?:ResourceScope,operation:Operation="read") {
 const user=await currentUser();if(!user)throw new Error("UNAUTHENTICATED");
 if(action) requirePermission(user,action,resource,operation);
 if(!["GET","HEAD","OPTIONS"].includes(request.method)) validateCsrf(request.headers.get("origin"),configuredOrigin().origin,request.headers.get("x-csrf-token")??"",user.csrfHash);
 return user;
}
export function cookieOptions() {return {httpOnly:true,secure:secureCookie(),sameSite:"strict" as const,path:"/",maxAge:8*60*60};}
export function apiError(error:unknown) {
 const code=error instanceof Error?error.message:"INTERNAL_ERROR";
 const status=code==="UNAUTHENTICATED"?401:code==="FORBIDDEN"||code==="CSRF_REJECTED"?403:code.startsWith("P1_")?403:400;
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
