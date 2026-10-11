import {NextResponse,type NextRequest} from "next/server";
import {withTransaction} from "../../../../../packages/db/connection";
import {appendAudit} from "../../../../../packages/db/audit";
import {authenticate,digest,throttleLogin,validateCsrf} from "../../../../../packages/security/session";
import {assertSynthetic,configuredOrigin} from "../../../../../packages/security/runtime";
import {apiError,cookieOptions,readJson,SESSION_COOKIE,CSRF_COOKIE} from "../../../../server/http";
export async function POST(request:NextRequest){try{
 assertSynthetic(); const input=await readJson(request);
 validateCsrf(request.headers.get("origin"),configuredOrigin().origin,String(input.csrf??""),digest(request.cookies.get(CSRF_COOKIE)?.value??""));
 if(typeof input.username!=="string"||typeof input.password!=="string"||input.username.length>64)throw new Error("INVALID_LOGIN");
 const result=await withTransaction(async db=>{
   // Trust only the reverse proxy's overwritten address header in LAN deployment.
   const permitted=await throttleLogin(db,request.headers.get("x-real-ip")??"loopback-client");
   if(!permitted)return null;
   const login=await authenticate(db,input.username as string,input.password as string);
   await appendAudit(db,{actorId:login?.userId,action:login?"AUTH_LOGIN_SUCCESS":"AUTH_LOGIN_FAILED",resourceType:"SESSION",details:{outcome:login?"SUCCESS":"DENIED",synthetic:true}});return login;
 });
 if(!result)return NextResponse.json({error:"ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง หรือบัญชีถูกพักชั่วคราว กรุณาตรวจข้อมูลและลองอีกครั้งหลัง 15 นาที"},{status:401});
 const response=NextResponse.json({ok:true,csrf:result.csrf});response.cookies.set(SESSION_COOKIE,result.token,cookieOptions());response.cookies.set(CSRF_COOKIE,result.csrf,{...cookieOptions(),httpOnly:false});return response;
}catch(error){return apiError(error);}}
