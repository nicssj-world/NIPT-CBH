import path from 'node:path';
import {FileStore} from '../../packages/storage';
import {exportTaskPdfs} from '../../packages/workbook/native-pdf';
import {loadRuntimeMaster} from '../../packages/workbook/runtime';
import {NextResponse} from 'next/server';
import {p4Error,noStore} from './p4';
export function workbookError(error:unknown) {
  const message=error instanceof Error?error.message:'';
  const labMessages:Record<string,string>={ACTUAL_POOLING_REQUIRED:'ยังไม่มีบันทึก Pooling จริงที่ตรงกับ QC ปัจจุบัน กรุณาบันทึกในหน้า Pooling ก่อน Export',ACTUAL_POOLING_POSITIONS_REQUIRED:'ระบุสถานะ Pooling ให้ครบ 48 ตำแหน่งโดยไม่ซ้ำ',ACTUAL_POOLING_EMPTY_POSITION:'ตำแหน่งที่ว่างไม่สามารถบันทึกว่า Pooling แล้วได้',ACTUAL_TRANSFER_VOLUME_EVIDENCE_REQUIRED:'ตำแหน่งที่ CSV เป็น 0 ต้องมีปริมาตร Transfer จริงและเหตุผลจากการปฏิบัติงาน',ACTUAL_POOLING_MAPPING_STALE:'ตำแหน่งหรือข้อมูล QC เปลี่ยน กรุณาตรวจบันทึก Pooling จริงกับใบงานล่าสุด',TASK_IMPORT_TEMPLATE_REQUIRED:'ยังไม่ได้กำหนด Template HALOS Task Import',TASK_IMPORT_TEMPLATE_SHA256_MISMATCH:'Template HALOS Task Import ไม่ตรงกับต้นฉบับที่อนุมัติ',SEQ_EXPORT_NOT_FOUND:'ไม่พบไฟล์ส่งออกในขอบเขตสิทธิ์'};
  if(labMessages[message])return NextResponse.json({code:message,error:labMessages[message]},{status:message==='SEQ_EXPORT_NOT_FOUND'?404:409,headers:noStore});
  const stderr=error&&typeof error==='object'&&'stderr' in error&&typeof error.stderr==='string'?error.stderr:'';
  if(/Get-PrintConfiguration[\s\S]*Access denied/i.test(stderr)||/Get-PrintConfiguration[\s\S]*Access denied/i.test(message))return NextResponse.json({code:'TASK_NATIVE_EXCEL_PRINTER_ACCESS_DENIED',error:'เครื่องออก PDF ยังไม่มีสิทธิ์อ่านการตั้งค่าเครื่องพิมพ์ จึงยังออกเอกสารไม่ได้ กรุณาติดต่อผู้ดูแลเครื่อง'},{status:503,headers:noStore});
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
