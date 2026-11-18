import {readFile} from 'node:fs/promises';
import {NextResponse,type NextRequest} from 'next/server';
import {withTransaction} from '../../../../../packages/db/connection';
import {previewHisAnc,applyHisAnc} from '../../../../../packages/his-anc/import';
import {HisAncError} from '../../../../../packages/his-anc/parse';
import {task3Mutation,uploadedFile} from '../../../../server/task3';
import {noStore} from '../../../../server/p5';

// Owner 2026-11-18: every Lab staff member uploads the HIS ANC export; preview first, then confirm.
const MESSAGES:Record<string,string>={
 NOT_XLSX:'ไฟล์นี้ไม่ใช่ .xlsx ที่ export จาก HIS',EMPTY_FILE:'ไฟล์ไม่มีข้อมูล',
 TOO_MANY_ROWS:'ไฟล์มีเกิน 2,000 แถว กรุณา export จาก HIS เป็นช่วงวันที่สั้นลง',FILE_TOO_LARGE:'ไฟล์ใหญ่เกิน 8 MB',
 HEADER_MISMATCH:'คอลัมน์ในไฟล์ไม่ตรงกับไฟล์ export จาก HIS (ต้องมี 20 คอลัมน์ hospcode … nipt)',
 HIS_ANC_FILE_CHANGED:'ไฟล์ที่ยืนยันไม่ใช่ไฟล์เดียวกับที่ดูตัวอย่าง กรุณาเลือกไฟล์และดูตัวอย่างใหม่',
};
export async function POST(request:NextRequest){return task3Mutation(request,'HIS_ANC_IMPORT',async user=>{
 const {bytes,form}=await uploadedFile(request,'file',8*1024*1024),action=form.get('action');
 if(action!=='preview'&&action!=='apply')return NextResponse.json({code:'INVALID_ACTION'},{status:422,headers:noStore});
 const lookupKey=await readFile(/* turbopackIgnore: true */ process.env.IDENTITY_LOOKUP_KEY_FILE??'');
 try{
  const body=await withTransaction(db=>action==='preview'?previewHisAnc(db,user,bytes,lookupKey):applyHisAnc(db,user,bytes,lookupKey,String(form.get('sha256')??'')));
  return NextResponse.json(body,{headers:noStore});
 }catch(error){
  if(error instanceof HisAncError)return NextResponse.json({code:error.code,error:MESSAGES[error.code]??error.code},{status:422,headers:noStore});
  throw error;
 }
});}
