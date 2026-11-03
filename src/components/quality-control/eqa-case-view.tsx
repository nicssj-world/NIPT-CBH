"use client";
import Link from "next/link";
import {useState} from "react";
import {api,Dialog,ErrorNotice,Field,Ln,message,Status,time,type CaseData} from "../p2/shared";
import {ThaiDateInput} from "../shared/thai-date-input";
import {displayBe} from "../../../packages/domain/thai-date";
import "./quality-control.css";

const MESSAGES:Record<string,string>={
 EQA_INFO_LOCKED_AFTER_REPORT:"ตัวอย่าง EQA นี้มีรายงานแล้ว จึงแก้ข้อมูลพื้นฐานไม่ได้",
 COLLECTION_DATE_FUTURE:"วันที่เก็บตัวอย่างเป็นวันในอนาคต"
};
const EVENT_LABEL:Record<string,string>={EQA_REGISTERED:"ลงทะเบียน EQA",EQA_INFO_EDITED:"แก้ข้อมูลพื้นฐาน EQA",LAB_RECEIVED:"รับตัวอย่าง"};
/**
 * The page of an EQA specimen (owner 2026-11-03). An EQA is not a patient: no consent, no request form, no HIS data. What the report prints about the specimen
 * (name, date of birth, gestational age, collection date, pregnancy type) is typed here and can be corrected until a report exists.
 */
export function EqaCaseView({caseId,data,reload}:{caseId:string;data:CaseData;reload:()=>Promise<void>}){
 const eqa=data.eqa!,c=data.case;
 const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const [f,setF]=useState({surname:eqa.surname,firstName:eqa.firstName,dob:eqa.dob,collectionDate:eqa.collectionDate,gaWeeks:String(eqa.gaWeeks),gaDays:String(eqa.gaDays),pregnancy:eqa.pregnancy,note:eqa.note??""});
 const set=(k:keyof typeof f)=>(v:string)=>setF(s=>({...s,[k]:v}));
 const input=(k:keyof typeof f,id:string,extra:Record<string,unknown>={})=><input id={id} className="input" value={f[k]} disabled={busy} onChange={e=>set(k)(e.target.value)} {...extra}/>;
 const ready=!!(f.surname.trim()&&f.firstName.trim()&&f.dob&&f.collectionDate&&f.gaWeeks!==""&&f.gaDays!=="");
 const close=()=>{if(!busy){setOpen(false);setError("");}};
 async function save(e:React.FormEvent){
  e.preventDefault();setBusy(true);setError("");
  try{
   await api("/api/eqa/update",{caseId,surname:f.surname.trim(),firstName:f.firstName.trim(),dob:f.dob,collectionDate:f.collectionDate,gaWeeks:Number(f.gaWeeks),gaDays:Number(f.gaDays),pregnancy:f.pregnancy,note:f.note.trim()});
   await reload();setOpen(false);
  }catch(x){const text=message(x);setError(MESSAGES[(x as {code?:string}).code??""]??MESSAGES[text]??text);}finally{setBusy(false);}
 }
 const events=data.history.events;
 return <div className="eqa-case">
  <header className="page-header"><div>
   <h1>{data.operational?"LN ":"LN จำลอง "}<Ln value={c.ln}/></h1>
   <p><span className="badge">EQA</span> <Status operational={data.operational} value={c.analysis_started?"เริ่มตรวจวิเคราะห์":c.state}/></p>
   <p className="muted">HN {c.hn??eqa.sampleRef} · {eqa.organizer} ปี {eqa.programYear}</p>
  </div><div className="row"><Link className="button secondary" href="/quality-control">← กลับ Quality Control</Link></div></header>
  <section className="panel" aria-labelledby="eqa-info-h">
   <div className="case-section-header"><h2 id="eqa-info-h">ข้อมูลพื้นฐานของตัวอย่าง EQA</h2>
    {eqa.editable?<button className="button secondary" type="button" onClick={()=>setOpen(true)}>แก้ไขข้อมูล</button>:<span className="help">มีรายงานแล้ว — แก้ไขไม่ได้</span>}</div>
   <p className="help">ข้อมูลนี้ถูกนำไปแสดงในรายงาน กรอกตามบัตร Referral ของผู้จัด ไม่มีการส่งไป HIS และไม่มีใบยินยอม</p>
   <dl className="compact-facts">
    <div><dt>ชื่อ–นามสกุล</dt><dd>{eqa.firstName} {eqa.surname}</dd></div>
    <div><dt>วันเกิด</dt><dd>{displayBe(eqa.dob)}</dd></div>
    <div><dt>อายุครรภ์ตามสแกน</dt><dd>{eqa.gaWeeks} สัปดาห์ {eqa.gaDays} วัน</dd></div>
    <div><dt>วันที่เก็บตัวอย่าง</dt><dd>{displayBe(eqa.collectionDate)}</dd></div>
    <div><dt>ชนิดครรภ์</dt><dd>{eqa.pregnancy==="Twins"?"ครรภ์แฝด":"ครรภ์เดี่ยว"}</dd></div>
    <div><dt>หมายเหตุ</dt><dd>{eqa.note?.trim()||"—"}</dd></div>
   </dl>
  </section>
  <section className="panel" aria-labelledby="eqa-lab-h">
   <h2 id="eqa-lab-h">ตัวอย่างในห้องปฏิบัติการ</h2>
   <dl className="compact-facts">
    <div><dt>สถานะ</dt><dd><Status operational={data.operational} value={c.analysis_started?"เริ่มตรวจวิเคราะห์":c.state}/></dd></div>
    <div><dt>วันที่/เวลารับ</dt><dd>{data.roundReceipt.receivedAt?time(data.roundReceipt.receivedAt):"ยังไม่รับ"}</dd></div>
   </dl>
   <p className="help">การจัดเข้า Task List และการออกรายงานทำจากคิวงาน Lab และหน้า Quality Control</p>
  </section>
  <details className="panel case-activity-details">
   <summary>ประวัติการทำรายการ <span className="muted">({events.length} รายการ)</span></summary>
   <div className="case-activity-body">{events.length?<ul className="timeline">{events.map((e,i)=><li key={i}><strong>{EVENT_LABEL[e.event_type]??e.event_type}</strong> · {time(e.created_at)}</li>)}</ul>:<p>ยังไม่มีประวัติการทำรายการ</p>}</div>
  </details>
  {open&&<Dialog title="แก้ไขข้อมูลพื้นฐาน EQA" onClose={close} dirty>
   <form className="stack" onSubmit={e=>void save(e)}>
    <ErrorNotice error={error}/>
    <div className="qc-form-grid">
     <Field label="นามสกุล (Surname)" required>{id=>input("surname",id,{maxLength:120})}</Field>
     <Field label="ชื่อ (First name)" required>{id=>input("firstName",id,{maxLength:120})}</Field>
     <Field label="วันเกิด" required>{id=><ThaiDateInput id={id} value={f.dob} onChange={set("dob")} disabled={busy}/>}</Field>
     <Field label="วันที่เก็บตัวอย่าง" required>{id=><ThaiDateInput id={id} value={f.collectionDate} onChange={set("collectionDate")} disabled={busy}/>}</Field>
     <Field label="อายุครรภ์ตามสแกน (สัปดาห์)" required>{id=>input("gaWeeks",id,{inputMode:"numeric",maxLength:2})}</Field>
     <Field label="อายุครรภ์ตามสแกน (วัน)" required>{id=>input("gaDays",id,{inputMode:"numeric",maxLength:1})}</Field>
     <Field label="ชนิดครรภ์" required>{id=><select id={id} className="input" value={f.pregnancy} disabled={busy} onChange={e=>set("pregnancy")(e.target.value)}><option value="Singleton">ครรภ์เดี่ยว (Singleton)</option><option value="Twins">ครรภ์แฝด (Twins)</option></select>}</Field>
     <Field label="หมายเหตุ (ไม่บังคับ)">{id=>input("note",id,{maxLength:200})}</Field>
    </div>
    <div className="dialog-actions"><button type="submit" className="button" disabled={!ready||busy}>{busy?"กำลังบันทึก…":"บันทึก"}</button><button type="button" className="button secondary" onClick={close} disabled={busy}>ยกเลิก</button></div>
   </form>
  </Dialog>}
 </div>;
}
