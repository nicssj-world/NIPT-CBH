"use client";
import {useEffect,useState} from "react";
import {Dialog,Ln} from "../p2/shared";
import {labApi,failureText} from "../p4/lab-api";
import {AncResults} from "../p5/anc-results";
import {CopyButton} from "../shared/copy-button";
import {formatBe,formatBeDateTime} from "../../../packages/domain/thai-date";
import {nationalIdCopy,nationalIdDisplay} from "../../../packages/results/nhso-format";
import type {NhsoDetail,NhsoRow,NhsoTab} from "../../../packages/results/nhso-entry";
import "./nhso.css";

const beDay=(iso:string|null)=>{if(!iso)return null;try{return formatBe(iso.slice(0,10));}catch{return null;}};
const text=(n:number|null)=>n===null?null:String(n);
type Item={key:string;label:string;shown:string|null;copy:string|null;unit?:string;missing:string};

/** The six values for the NHSO form, in the order the form asks for them. What is shown is what is copied, except the national ID (digits only). */
export function nhsoItems(p:NhsoDetail["patient"]):Item[]{
 return [
  {key:"id",label:"เลขบัตรประชาชน",shown:nationalIdDisplay(p.nationalId),copy:nationalIdCopy(p.nationalId),missing:"ไม่มีเลขบัตรในไฟล์ PET"},
  {key:"age",label:"อายุ",shown:text(p.ageYears),copy:text(p.ageYears),unit:"ปี",missing:"คำนวณไม่ได้ (ไม่มีวันเกิดหรือวันรับบริการ)"},
  {key:"gravida",label:"ครรภ์ที่",shown:text(p.gravida),copy:text(p.gravida),missing:"ไม่ได้บันทึกในใบ Request"},
  {key:"gaw",label:"อายุครรภ์ (สัปดาห์)",shown:text(p.gaWeeks),copy:text(p.gaWeeks),unit:"สัปดาห์",missing:"ไม่ได้บันทึกอายุครรภ์"},
  {key:"gad",label:"อายุครรภ์ (วัน)",shown:text(p.gaDays),copy:text(p.gaDays),unit:"วัน",missing:"ไม่ได้บันทึกอายุครรภ์"},
  {key:"service",label:"วันที่รับบริการคัดกรอง",shown:beDay(p.serviceDate),copy:beDay(p.serviceDate),missing:"ไม่มีวันที่รับตัวอย่าง"},
  {key:"test",label:"วันที่ตรวจ",shown:beDay(p.testDate),copy:beDay(p.testDate),missing:"ยังไม่มีวันที่ลงใน Task List"},
 ];
}

export function NhsoDialog({row,tab,onClose,onChanged}:{row:NhsoRow;tab:NhsoTab;onClose:()=>void;onChanged:(message:string)=>void}){
 const [detail,setDetail]=useState<NhsoDetail|null>(null),[error,setError]=useState(""),[busy,setBusy]=useState(false),[copiedCount,setCopiedCount]=useState(0),[reload,setReload]=useState(0);
 useEffect(()=>{let live=true;
  void labApi<NhsoDetail>(`/api/nhso?resultId=${encodeURIComponent(row.resultId)}`).then(d=>{if(live){setDetail(d);setError("");}}).catch(e=>{if(live){setDetail(null);setError(failureText(e));}});
  return()=>{live=false;};},[row.resultId,reload]);
 const act=async(action:"confirm"|"notNhso"|"cancel")=>{
  setBusy(true);setError("");
  const done={confirm:`ยืนยันการลงผลสปสช. LN ${row.ln} แล้ว — ย้ายไปที่ “ลงผลแล้ว”`,notNhso:`ระบุว่า LN ${row.ln} ไม่ใช่สิทธิ สปสช. แล้ว — ย้ายไปที่ “ไม่ใช่สิทธิ สปสช.”`,cancel:`ยกเลิก LN ${row.ln} แล้ว — กลับไปที่ “ต้องลงผล”`}[action];
  try{await labApi("/api/nhso",{action,resultId:row.resultId});onChanged(done);}
  catch(e){setError(failureText(e));setBusy(false);}
 };
 const items=detail?nhsoItems(detail.patient):[],total=items.filter(i=>i.copy!==null).length;
 return <Dialog title="ลงผลสปสช." onClose={onClose}><div className="nhso-popup">
  <p className="nhso-id">{row.name&&<strong>{row.name}</strong>}{row.name&&" · "}HN {row.hn??"ยังไม่ยืนยัน"} · LN <Ln value={row.ln}/>{row.reissued&&<span className="badge warning">ผลถูกแก้ไข ต้องลงใหม่</span>}</p>
  {tab==="PENDING"&&row.entitlement==="UNSPECIFIED"&&<p className="notice warning-notice" role="note">ใบ Request ไม่ได้ระบุสิทธิ จึงถือเป็นสิทธิ สปสช. — ถ้าไม่ใช่สิทธิ สปสช. กด “ไม่ใช่สิทธิ สปสช.” ด้านล่าง</p>}
  {error&&<div className="notice" role="alert">{error} <button type="button" className="button small secondary" onClick={()=>setReload(n=>n+1)}>ลองใหม่</button></div>}
  <section aria-labelledby="nhso-patient-h" className="nhso-section">
   <h3 id="nhso-patient-h">1. ข้อมูลคนไข้ <span className="help">กดไอคอนเพื่อคัดลอกทีละค่า</span></h3>
   {!detail&&!error&&<p className="help" role="status">กำลังโหลด…</p>}
   {detail&&<><dl className="nhso-fields">{items.map(i=><div className="nhso-field" key={i.key}>
    <dt id={`nhso-${i.key}`}>{i.label}</dt>
    <dd aria-labelledby={`nhso-${i.key}`}>{i.shown!==null?<span className="nhso-value num">{i.shown}{i.unit&&<span className="nhso-unit"> {i.unit}</span>}</span>:<span className="nhso-missing">{i.missing}</span>}</dd>
    <CopyButton label={i.label} value={i.copy} onCopied={()=>setCopiedCount(n=>n+1)}/>
   </div>)}</dl>
   <p className="help" aria-live="polite">คัดลอกแล้ว {Math.min(copiedCount,total)} จาก {total} ค่าในรอบนี้ · เลขบัตรจะคัดลอกเป็นตัวเลข 13 หลักไม่มีขีด</p></>}
  </section>
  <section aria-labelledby="nhso-result-h" className="nhso-section">
   <h3 id="nhso-result-h">2. ผลตรวจ</h3>
   <AncResults caseId={row.caseId}/>
  </section>
  <footer className="nhso-footer action-bar">
   {tab==="PENDING"
    ?<><button type="button" className="button secondary" disabled={busy} onClick={()=>void act("notNhso")}>ไม่ใช่สิทธิ สปสช.</button>
     <button type="button" className="button" disabled={busy||!detail} onClick={()=>void act("confirm")}>{busy?"กำลังบันทึก…":"ยืนยันการลงผล"}</button></>
    :<><p className="help nhso-by">{tab==="DONE"?"ยืนยันแล้วโดย":"ระบุว่าไม่ใช่สิทธิ สปสช. โดย"} {row.entry?.by??"—"}{row.entry&&` · ${formatBeDateTime(row.entry.at)}`}</p>
     <button type="button" className="button secondary danger" disabled={busy} onClick={()=>void act("cancel")}>{busy?"กำลังบันทึก…":tab==="DONE"?"ยกเลิกการลงผล":"ยกเลิก — กลับไปที่ต้องลงผล"}</button></>}
   <button type="button" className="button secondary" onClick={onClose}>ปิด</button>
  </footer>
 </div></Dialog>;
}
