import {NextResponse,type NextRequest} from 'next/server';
import {ZodError} from 'zod';
import {cookies} from 'next/headers';
import {pool} from '../../../packages/db/connection';
import {readSession,validateCsrf} from '../../../packages/security/session';
import {configuredOrigin,assertSynthetic} from '../../../packages/security/runtime';
import {SESSION_COOKIE} from '../http';
import {P2Error} from '../../../packages/p2/service';
export const SIGNING_COOKIE='nipt_p2_signing';
export const SIGNING_CSRF='nipt_p2_signing_csrf';
export const noStore={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
export function p2Error(error:unknown){if(error instanceof ZodError)return NextResponse.json({code:'VALIDATION_ERROR',error:'ตรวจช่องข้อมูลที่ระบุและแก้ไขก่อนบันทึก',issues:error.issues.map(x=>({path:x.path.join('.'),message:x.message}))},{status:422,headers:noStore});const code=error instanceof P2Error?error.code:error instanceof Error?error.message:'INTERNAL_ERROR';const safe=['FORBIDDEN','CSRF_REJECTED','UNAUTHENTICATED'].includes(code);const status=error instanceof P2Error?error.status:code==='FORBIDDEN'||code==='CSRF_REJECTED'?403:code==='UNAUTHENTICATED'?401:400;return NextResponse.json({code:error instanceof P2Error||safe?code:'INVALID_REQUEST',error:code==='VERSION_CONFLICT'?'มีข้อมูลใหม่จากอีกหน้าจอ กรุณาเปรียบเทียบและเลือกข้อมูลก่อนบันทึก':code==='STAFF_SESSION_SUSPENDED'?'อุปกรณ์อยู่ในขั้นลงนาม กรุณาจบหรือยกเลิกและยืนยันตัวตนผู้จัดเตรียม':'ทำรายการไม่สำเร็จ กรุณาตรวจข้อมูล สิทธิ์ และสถานะเอกสาร',...(error instanceof P2Error&&error.details?{details:error.details}:{})},{status,headers:noStore});}
export async function returnUser(request:NextRequest){assertSynthetic();const jar=await cookies(),raw=jar.get(SESSION_COOKIE)?.value;const user=raw?await readSession(pool(),raw,new Date(),true):null;if(!user)throw new P2Error('UNAUTHENTICATED',401);validateCsrf(request.headers.get('origin'),configuredOrigin().origin,request.headers.get('x-csrf-token')??'',user.csrfHash);return user;}
