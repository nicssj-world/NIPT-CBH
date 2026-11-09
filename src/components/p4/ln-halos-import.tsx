'use client';
import {useState} from 'react';
import {csrf} from '../p2/shared';

type Item={row:number;ln:string;lnHalos:string;status:string;pendingPet:boolean;issues:string[]};
type Preview={source:{sha256:string};rows:Item[]};
type Result={imported:number;replayed:boolean;held:number;matching:{matched:number;pending:number;issues:{ln:string;code:string}[]}};
const labels:Record<string,string>={NEW:'นำเข้าใหม่',EXISTING:'มีคู่เลขนี้แล้ว',EXISTING_CASE:'มีคู่เลขในเคสแล้ว',DUPLICATE:'คู่เลขซ้ำในไฟล์ ข้าม',CONFLICT:'เลขขัดแย้ง',INVALID:'ข้อมูลไม่ถูกต้อง'};
const issueText:Record<string,string>={LN_ALREADY_LINKED:'LN นี้มีคู่เลขหรือเคสอื่นแล้ว',HALOS_ALREADY_LINKED:'LN Halos นี้ผูกกับ LN อื่นแล้ว',MONTH_SEQUENCE_USED:'ลำดับเดือนนี้ถูกใช้แล้ว',MAPPING_DUPLICATE_LN:'LN จับคู่หลายเลขในไฟล์',MAPPING_DUPLICATE_HALOS:'LN Halos จับคู่หลาย LN ในไฟล์',DUPLICATE_MONTHLY_SEQUENCE:'ลำดับเดือนซ้ำในไฟล์'};
const errors:Record<string,string>={MAPPING_REVIEW_REQUIRED:'มีเลขขัดแย้งหรือข้อมูลไม่ถูกต้อง กรุณาแก้รายการในไฟล์แล้วตรวจอีกครั้ง',MAPPING_CHANGED_SINCE_PREVIEW:'ไฟล์เปลี่ยนหลังตรวจ กรุณาตรวจใหม่',SOURCE_ALLOCATION_NOT_FROZEN:'ต้องหยุดออกเลขจากระบบเดิมก่อน',VERIFIED_BACKUP_REQUIRED:'ยังไม่มีหลักฐานสำรองข้อมูลที่ตรวจสอบแล้ว',VERIFIED_BACKUP_TOO_OLD_OR_UNDATED:'หลักฐานสำรองข้อมูลไม่อยู่ในช่วง 24 ชั่วโมง',IMPORT_CONFIGURATION_REQUIRED:'ยังตั้งค่าระบบสำหรับนำเข้าไม่ครบ'};

export function LnHalosImport(){
 const [file,setFile]=useState<File|null>(null),[preview,setPreview]=useState<Preview|null>(null),[result,setResult]=useState<Result|null>(null),[frozen,setFrozen]=useState(false),[busy,setBusy]=useState(false),[busyAction,setBusyAction]=useState<'preview'|'confirm'|null>(null),[loadingHeld,setLoadingHeld]=useState(false),[error,setError]=useState(''),[pastHeld,setPastHeld]=useState<{created_at:string;row:Item}[]|null>(null);
 const loadHeld=async()=>{setLoadingHeld(true);setError('');try{const response=await fetch('/api/ln-halos-import/held',{cache:'no-store'});if(!response.ok)throw Error();setPastHeld((await response.json()).rows);}catch{setError('ไม่สามารถโหลดรายการพักก่อนหน้า');}finally{setLoadingHeld(false);}};
 const send=async(confirm:boolean)=>{
  if(!file)return;setBusy(true);setBusyAction(confirm?'confirm':'preview');setError('');
  try{
   const form=new FormData();form.set('file',file);
   if(confirm&&preview){form.set('sha256',preview.source.sha256);form.set('sourceFrozen',String(frozen));}
   const response=await fetch(`/api/ln-halos-import/${confirm?'confirm':'preview'}`,{method:'POST',headers:{'x-csrf-token':csrf()},body:form,cache:'no-store'});
   const data=await response.json();if(!response.ok)throw Error(data.code??'IMPORT_FAILED');
   if(confirm)setResult(data as Result);else {setPreview(data as Preview);setResult(null);}
  }catch(e){const code=e instanceof Error?e.message:'IMPORT_FAILED';setError(errors[code]??`ทำรายการไม่สำเร็จ (${code})`);}finally{setBusy(false);setBusyAction(null);}
 };
 const bad=preview?.rows.filter(r=>r.status==='INVALID').length??0;
 const held=preview?.rows.filter(r=>r.status==='CONFLICT')??[];
 return <details className="panel stack"><summary>นำเข้า LN Halos จากไฟล์ Excel</summary>
  <p>ตรวจคู่ LN และ LN Halos ก่อนนำเข้า ระบบจะจับคู่ PET ที่รับไว้ และให้รายการที่ยังไม่มี PET รอจับคู่</p>
  <label>ไฟล์ Excel <input type="file" accept=".xlsx" onChange={e=>{setFile(e.target.files?.[0]??null);setPreview(null);setResult(null);setFrozen(false);setError('');}} /></label>
  <button className="button" type="button" disabled={!file||busy} onClick={()=>void send(false)}>{busyAction==='preview'?'กำลังตรวจไฟล์…':'ตรวจไฟล์'}</button>
  {error&&<p role="alert">{error}</p>}
  {preview&&<div className="stack"><p>ทั้งหมด {preview.rows.length} รายการ · ใหม่ {preview.rows.filter(r=>r.status==='NEW').length} · มีแล้ว {preview.rows.filter(r=>r.status==='EXISTING'||r.status==='EXISTING_CASE').length} · ขัดแย้ง {held.length} · ข้อมูลไม่ถูกต้อง {bad} · พบ PET รอ {preview.rows.filter(r=>r.pendingPet).length}</p>
   {held.length>0&&<div role="alert"><p>รายการขัดแย้งต่อไปนี้จะไม่ถูกนำเข้า</p><ul>{held.map(r=><li key={r.row}>แถว {r.row} · {r.ln} · {r.lnHalos}: {r.issues.map(i=>issueText[i]??i).join(', ')}</li>)}</ul></div>}
   {bad>0&&<div role="alert"><p>รายการข้อมูลไม่ถูกต้องต่อไปนี้จะไม่ถูกนำเข้า (แก้ในไฟล์แล้วนำเข้าอีกครั้งได้)</p><ul>{preview.rows.filter(r=>r.status==='INVALID').map(r=><li key={r.row}>แถว {r.row} · {r.ln} · {r.lnHalos}: {r.issues.map(i=>issueText[i]??i).join(', ')}</li>)}</ul></div>}
   <div className="table-wrap"><table className="data-table"><thead><tr><th>แถว</th><th>LN</th><th>LN Halos</th><th>ผลตรวจ</th></tr></thead><tbody>{preview.rows.slice(0,100).map(r=><tr key={r.row}><td>{r.row}</td><td>{r.ln}</td><td>{r.lnHalos}</td><td>{labels[r.status]??r.status}{r.pendingPet?' · มี PET รอ':''}{r.issues.length?` · ${r.issues.join(', ')}`:''}</td></tr>)}</tbody></table></div>
   {preview.rows.length>100&&<p>แสดง 100 รายการแรก จาก {preview.rows.length} รายการ</p>}
   <label><input type="checkbox" checked={frozen} onChange={e=>setFrozen(e.target.checked)} /> ยืนยันว่าหยุดออกเลขจากระบบเดิมแล้ว และไฟล์นี้มีเลขที่ออกล่าสุด</label>
   <button className="button" type="button" disabled={busy||!frozen||preview.rows.length===0||!!result} onClick={()=>void send(true)}>{busyAction==='confirm'?'กำลังนำเข้า…':'ยืนยันนำเข้า'}</button>
  </div>}
  {result&&<p role="status">{result.replayed?'ไฟล์นี้นำเข้าแล้ว':`นำเข้าใหม่ ${result.imported} รายการ`} · ขัดแย้งและไม่นำเข้า {result.held} · จับคู่ PET สำเร็จ {result.matching.matched} · รอ PET หรือรอตรวจสอบ {result.matching.pending}{result.matching.issues.length?` · มีรายการต้องตรวจ ${result.matching.issues.length}`:''}</p>}
  {result&&result.matching.issues.length>0&&<ul>{result.matching.issues.map(i=><li key={i.ln}>{i.ln}: {i.code}</li>)}</ul>}
  <button className="button secondary" type="button" disabled={loadingHeld} onClick={()=>void loadHeld()}>{loadingHeld?'กำลังโหลดรายการ…':'ดูรายการขัดแย้งจากการนำเข้าก่อนหน้า'}</button>
  {pastHeld&&<div><p>รายการที่เคยพักไว้ {pastHeld.length} รายการ — แก้ข้อมูลแล้วนำไฟล์มาตรวจซ้ำได้</p><ul>{pastHeld.map((h,i)=><li key={`${h.created_at}-${h.row.row}-${i}`}>แถว {h.row.row} · {h.row.ln} · {h.row.lnHalos}: {h.row.issues.map(x=>issueText[x]??x).join(', ')}</li>)}</ul></div>}
 </details>;
}
