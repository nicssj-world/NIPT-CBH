'use client';
import {useState} from 'react';
import Link from 'next/link';
import {csrf} from '../p2/shared';
import type {HisAncItem,HisAncOutcome,HisAncPlan,HisAncFills} from '../../../packages/his-anc/import';

// Owner 2026-11-18: Lab staff upload the HIS ANC export on งาน Lab; preview first, then confirm. Wording chosen by the Owner.
type Result=HisAncPlan&{applied:number;failed:{rowNo:number;code:string}[]};
const OUTCOME:Record<HisAncOutcome,string>={FILL:'จะเติมข้อมูล',NOT_MATCHED:'ไม่พบเคสในระบบ',ALREADY_CHECKED:'ตรวจใบขอส่งตรวจแล้ว — ข้าม',ELECTRONIC_REQUEST:'ใบขอส่งตรวจอิเล็กทรอนิกส์ (ANC) — ข้าม',NOT_A_DOCTOR:'ผู้ให้บริการไม่ใช่แพทย์ (พญ./นพ.) — ข้าม',HIS_INCOMPLETE:'ข้อมูล HIS ไม่ครบ — ข้าม',DUPLICATE_IN_FILE:'แถวซ้ำ (ใช้วันฝากครรภ์ล่าสุด) — ข้าม'};
const ORDER:HisAncOutcome[]=['FILL','NOT_MATCHED','ALREADY_CHECKED','ELECTRONIC_REQUEST','NOT_A_DOCTOR','HIS_INCOMPLETE','DUPLICATE_IN_FILE'];
const REASON:Record<string,string>={G_ZERO:'G = 0',EDC_GA_MISMATCH:'EDC ไม่ตรงกับ GA',BAD_GA:'GA ไม่ถูกต้อง',BAD_DATE:'วันที่ไม่ถูกต้อง',BAD_IDENTIFIER:'CID หรือ HN ไม่ถูกต้อง',NO_COLLECTION_DATE:'ยังไม่มีวันเจาะเลือด',AMBIGUOUS:'พบหลายเคสของผู้รับบริการคนนี้ — ตรวจใบขอส่งตรวจเอง',GA_OUT_OF_RANGE:'GA วันเจาะเลือดไม่อยู่ในช่วง 8–45 สัปดาห์ — ตรวจใบขอส่งตรวจเอง'};
const FAILED:Record<string,string>={CHECK_NOT_VERIFIED:'ข้อมูลไม่ผ่านการตรวจใบขอส่งตรวจ — ตรวจเอง',SAVE_FAILED:'บันทึกไม่สำเร็จ — ตรวจใบขอส่งตรวจเอง'};
const ERRORS:Record<string,string>={FILE_TOO_LARGE:'ไฟล์ใหญ่เกิน 8 MB',FILE_REQUIRED:'กรุณาเลือกไฟล์'};
function fillText(x:HisAncFills){
 return [x.doctor&&`แพทย์ ${x.doctor.name}${x.doctor.versionId?'':' (เพิ่มเข้าทะเบียนแพทย์)'}`,x.gaWeeks!==undefined&&`GA ${x.gaWeeks}+${x.gaDays}`,x.gravida!==undefined&&`ครรภ์ที่ ${x.gravida}`,x.pregnancyType&&'Singleton',
  x.weightKg!==undefined&&`น้ำหนัก ${x.weightKg} กก.`,x.heightCm!==undefined&&`ส่วนสูง ${x.heightCm} ซม.`].filter(Boolean).join(' · ');
}
function Row({item,failed}:{item:HisAncItem;failed?:string}){
 return <tr><td>{item.rowNo}</td><td>{item.hn}</td><td>{item.caseId&&item.ln?<Link href={`/cases/${item.caseId}`}>{item.ln}</Link>:'—'}</td>
  <td>{failed?FAILED[failed]??`บันทึกไม่สำเร็จ (${failed})`:OUTCOME[item.outcome]}{item.reason?` · ${REASON[item.reason]??item.reason}`:''}</td><td>{item.outcome==='FILL'?fillText(item.fills):''}</td></tr>;
}

export function HisAncImport(){
 const [file,setFile]=useState<File|null>(null),[plan,setPlan]=useState<HisAncPlan|null>(null),[result,setResult]=useState<Result|null>(null),[busy,setBusy]=useState<'preview'|'apply'|null>(null),[error,setError]=useState('');
 const send=async(action:'preview'|'apply')=>{
  if(!file)return;setBusy(action);setError('');
  try{
   const form=new FormData();form.set('file',file);form.set('action',action);if(action==='apply'&&plan)form.set('sha256',plan.fileSha256);
   const response=await fetch('/api/lab/his-anc-import',{method:'POST',headers:{'x-csrf-token':csrf()},body:form,cache:'no-store'});
   const data=await response.json();if(!response.ok)throw Object.assign(Error(data.code??'IMPORT_FAILED'),{text:data.error});
   if(action==='apply')setResult(data as Result);else{setPlan(data as HisAncPlan);setResult(null);}
  }catch(e){const code=e instanceof Error?e.message:'IMPORT_FAILED';setError((e as {text?:string}).text??ERRORS[code]??`ทำรายการไม่สำเร็จ (${code})`);}finally{setBusy(null);}
 };
 const shown=result??plan,failed=new Map(result?.failed.map(f=>[f.rowNo,f.code])??[]);
 return <details className="panel stack"><summary>นำเข้าข้อมูลฝากครรภ์จาก HIS</summary>
  <p>เลือกไฟล์ .xlsx ที่ export จาก HIS ระบบจะเติมข้อมูลเฉพาะเคสที่มีในระบบและยังไม่ได้ตรวจใบขอส่งตรวจ เติมเฉพาะช่องที่ว่าง และแก้ไขภายหลังได้ตามปกติ</p>
  <label>ไฟล์ Excel <input type="file" accept=".xlsx" onChange={e=>{setFile(e.target.files?.[0]??null);setPlan(null);setResult(null);setError('');}}/></label>
  <button className="button" type="button" disabled={!file||!!busy} onClick={()=>void send('preview')}>{busy==='preview'?'กำลังตรวจไฟล์…':'ดูตัวอย่าง'}</button>
  {error&&<p role="alert">{error}</p>}
  {shown&&<div className="stack">
   {result?<p role="status">เติมข้อมูลแล้ว {result.applied} ราย{result.failed.length?` · บันทึกไม่สำเร็จ ${result.failed.length} ราย`:''}</p>
    :<p>ทั้งหมด {shown.items.length} แถว · {ORDER.filter(o=>shown.counts[o]).map(o=>`${OUTCOME[o].replace(/ — ข้าม$/,'')} ${shown.counts[o]}`).join(' · ')}</p>}
   <div className="table-wrap"><table className="data-table"><thead><tr><th>แถว</th><th>HN</th><th>LN</th><th>สถานะ</th><th>ข้อมูลที่จะเติม</th></tr></thead>
    <tbody>{[...shown.items].sort((a,b)=>ORDER.indexOf(a.outcome)-ORDER.indexOf(b.outcome)||a.rowNo-b.rowNo).map(i=><Row key={i.rowNo} item={i} failed={failed.get(i.rowNo)}/>)}</tbody></table></div>
   {!result&&<button className="button" type="button" disabled={!!busy||!plan?.counts.FILL} onClick={()=>void send('apply')}>{busy==='apply'?'กำลังเติมข้อมูล…':`ยืนยันเติมข้อมูล ${plan?.counts.FILL??0} ราย`}</button>}
  </div>}
 </details>;
}
