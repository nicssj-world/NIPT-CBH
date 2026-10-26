"use client";
import {useRef,useState} from "react";
import {useRouter} from "next/navigation";
import {csrf} from "../p2/shared";
import {LabFailure,failureText} from "../p4/lab-api";
import {FileDropInput} from "../shared/file-drop-input";
import {TABLE_COLUMNS} from "../../../packages/historical/columns";

/** OWNER-LAB-005 single-patient historical import: the form writes one row in the canonical template columns and sends it
 *  through the same batch upload, so identity, PDF matching, date and completion rules are exactly those of a table import. */
type Row=Partial<Record<(typeof TABLE_COLUMNS)[number]["key"],string>>;
const cell=(v:string)=>/[",\r\n]/.test(v)?`"${v.replaceAll('"','""')}"`:v;
export function singlePatientCsv(row:Row){return "﻿"+TABLE_COLUMNS.map(c=>c.key).join(",")+"\r\n"+TABLE_COLUMNS.map(c=>cell((row[c.key]??"").trim())).join(",")+"\r\n";}

export function SinglePatientImport(){
 const router=useRouter(),pdf=useRef<HTMLInputElement>(null);
 const [row,setRow]=useState<Row>({pregnancy_type:"Singleton"}),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const set=(k:keyof Row)=>(e:React.ChangeEvent<HTMLInputElement|HTMLSelectElement>)=>setRow(r=>({...r,[k]:e.target.value}));
 const ready=!!row.ln?.trim()&&!!row.hn?.trim()&&!!row.name?.trim()&&!!row.original_location?.trim();
 async function submit(){
  setBusy(true);setError("");
  try{
   const file=pdf.current?.files?.[0],values={...row,...(file?{pdf_file:file.name}:{})};
   const form=new FormData();form.set("table",new File([singlePatientCsv(values)],`single-patient-${(row.ln??"").replace(/\W/g,"")}.csv`,{type:"text/csv"}));
   if(file)form.append("files",file);form.set("idempotencyKey",crypto.randomUUID());
   const r=await fetch("/api/p5h/batches",{method:"POST",headers:{"x-csrf-token":csrf()},body:form});
   const d=await r.json().catch(()=>({}));
   if(!r.ok)throw new LabFailure(d.code??"REQUEST_FAILED",d.error??"บันทึกไม่สำเร็จ กรุณาลองอีกครั้ง",d.details,r.status);
   router.push(`/historical/${d.batchId}`);
  }catch(e){setError(failureText(e));setBusy(false);}
 }
 const field=(k:keyof Row,label:string,type="text",required=false)=><div className="field"><label htmlFor={`sp-${k}`}>{label}{required&&<span className="required"> *</span>}</label><input id={`sp-${k}`} type={type} value={row[k]??""} onChange={set(k)} maxLength={120} required={required}/></div>;
 return <details className="single-patient"><summary>เพิ่มผู้ป่วยรายเดียว</summary>
  <div className="form-grid">
   {field("ln","LN ตามเอกสาร","text",true)}{field("hn","HN","text",true)}{field("name","ชื่อ-สกุล","text",true)}{field("dob","วันเกิด (ค.ศ.)","date")}
   {field("collection_date","วันที่เจาะเลือด (ค.ศ.)","date")}{field("receipt_date","วันที่รับตัวอย่าง (ค.ศ.)","date")}{field("report_date","วันที่รายงานผล (ค.ศ.)","date")}
   <div className="field"><label htmlFor="sp-pregnancy_type">ประเภทครรภ์</label><select id="sp-pregnancy_type" value={row.pregnancy_type??""} onChange={set("pregnancy_type")}><option value="Singleton">ครรภ์เดี่ยว</option><option value="Twins">ครรภ์แฝด</option></select></div>
   {field("original_location","ที่เก็บเอกสารต้นฉบับ","text",true)}
   <div className="field"><label htmlFor="sp-pdf">PDF ผลเดิม</label><FileDropInput id="sp-pdf" ref={pdf} type="file" accept=".pdf"/></div>
  </div>
  {error&&<p className="form-error" role="alert">{error}</p>}
  <div className="action-bar historical-actions"><button type="button" className="button" disabled={busy||!ready} onClick={()=>void submit()}>{busy?"กำลังตรวจสอบ…":"ตรวจสอบและบันทึก"}</button></div>
 </details>;
}
