import path from 'node:path';
import {FileStore} from '../../packages/storage';
import {exportTaskPdfs} from '../../packages/workbook/native-pdf';
import {loadRuntimeMaster} from '../../packages/workbook/runtime';
import {NextResponse} from 'next/server';
import {p4Error,noStore} from './p4';
export function workbookError(error:unknown) {
  const message=error instanceof Error?error.message:'';
  if(message.startsWith('TASK_PDF_PAGE_COUNT:'))return NextResponse.json({code:'TASK_PDF_PAGE_COUNT',error:'Excel ในเครื่องนี้แบ่งหน้าไม่ตรง Master ที่กำหนด 2 หน้า จึงยังออก PDF ไม่ได้ กรุณาตรวจ Print Preview และ Font บนเครื่อง Renderer โดยคง Master เดิม',details:message},{status:409,headers:noStore});
  if(message==='TASK_MASTER_PATH_REQUIRED')return NextResponse.json({code:message,error:'ยังไม่ได้กำหนดไฟล์ Excel Master ต้นฉบับให้ระบบ กรุณากำหนด NIPT_TASK_MASTER_PATH'},{status:409,headers:noStore});
  if(['TASK_MASTER_FILE_NOT_FOUND','TASK_MASTER_FILE_UNREADABLE','TASK_MASTER_LOCAL_PATH_REQUIRED'].includes(message))return NextResponse.json({code:message,error:'ไม่สามารถอ่าน Excel Master ที่กำหนดได้ กรุณาตรวจไฟล์ภายในเครื่องและสิทธิ์บริการ'},{status:409,headers:noStore});
  if(message==='TASK_MASTER_SHA256_MISMATCH')return NextResponse.json({code:message,error:'ไฟล์ Master ไม่ตรง SHA-256 ที่ Owner ล็อกไว้ กรุณาเลือกต้นฉบับที่ถูกต้อง'},{status:409,headers:noStore});
  if(message==='TASK_NATIVE_EXCEL_WINDOWS_REQUIRED')return NextResponse.json({code:message,error:'การออก PDF ต้องใช้เครื่อง Windows ที่มี Microsoft Excel และ Font ของ Master ครบ'},{status:409,headers:noStore});
  if(['TASK_NATIVE_EXCEL_TIMEOUT','TASK_NATIVE_EXCEL_FAILED','TASK_NATIVE_EXCEL_SPOOL_INVALID'].includes(message))return NextResponse.json({code:'TASK_NATIVE_EXCEL_UNAVAILABLE',error:'เครื่อง Excel สำหรับ Local UAT ยังไม่พร้อม กรุณาตรวจสถานะ Local Excel Bridge แล้วลองใหม่'},{status:503,headers:noStore});
  return p4Error(error);
}
export async function workbookDeps() {
  const master=await loadRuntimeMaster();
  return {master,store:new FileStore(path.resolve(process.env.FILE_STORE_ROOT||'data/files')),render:exportTaskPdfs};
}
