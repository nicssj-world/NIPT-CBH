"use client";
import {useEffect,useId,useState} from "react";
import {Dialog,Ln,csrf} from "../p2/shared";
import {labApi,failureText} from "../p4/lab-api";
import {ThaiDateInput} from "../shared/thai-date-input";
import {Icon} from "../p2/anc-progress-view";
import {formatBe,formatBeDateTime} from "../../../packages/domain/thai-date";
import {STATUSES,STATUS_LABEL,METHODS,METHOD_LABEL,SPECIMENS,SPECIMEN_LABEL,OUTCOMES,OUTCOME_LABEL,SCREEN_LABEL,PDF_MAX_BYTES,hasResult,concordant,
 type ConfirmStatus,type Method,type Specimen,type Outcome,type FindingKey} from "../../../packages/confirm/model";
import type {ConfirmRow,ConfirmHistory} from "../../../packages/confirm/service";
import {StatusBadge,MatchBadge} from "./confirm-badges";
import "../shared/console.css";
import "./confirm.css";

type Detail={row:ConfirmRow;history:ConfirmHistory[]};
type Form={status:ConfirmStatus;method:Method|"";specimen:Specimen|"";outlabName:string;procedureDate:string;reportDate:string;resultText:string;note:string;findings:Partial<Record<FindingKey,Outcome>>};
const formOf=(r:ConfirmRow):Form=>{const x=r.record;return {status:r.status,method:x?.method??"",specimen:x?.specimen??"",outlabName:x?.outlabName??"",procedureDate:x?.procedureDate??"",
 reportDate:x?.reportDate??"",resultText:x?.resultText??"",note:x?.note??"",findings:{...(x?.findings??{})}};};
const be=(iso:string|null|undefined)=>{if(!iso)return "—";try{return formatBe(iso.slice(0,10));}catch{return "—";}};
const pdfUrl=(caseId:string,sequence?:number,screening?:boolean)=>`/api/confirm/report?caseId=${caseId}${sequence?`&sequence=${sequence}`:""}${screening?"&kind=screening":""}`;

/** Record or read one case's confirmatory result (Owner 2026-11-23). Only Lab staff edit; everyone else sees the same values read-only. */
export function ConfirmEditor({caseId,canWrite,onClose,onSaved}:{caseId:string;canWrite:boolean;onClose:()=>void;onSaved:(message:string)=>void}){
 const [detail,setDetail]=useState<Detail|null>(null),[form,setForm]=useState<Form|null>(null),[file,setFile]=useState<File|null>(null);
 const [loadError,setLoadError]=useState(""),[error,setError]=useState(""),[busy,setBusy]=useState(false),[dirty,setDirty]=useState(false),[reload,setReload]=useState(0);
 const ids=useId();
 useEffect(()=>{let live=true;labApi<Detail>(`/api/confirm?caseId=${caseId}`).then(d=>{if(live){setDetail(d);setForm(formOf(d.row));setLoadError("");}},e=>{if(live)setLoadError(failureText(e));});return()=>{live=false;};},[caseId,reload]);
 const set=<K extends keyof Form>(k:K,v:Form[K])=>{setForm(f=>f&&{...f,[k]:v});setDirty(true);setError("");};
 const row=detail?.row,result=form?hasResult(form.status):false,editable=canWrite;
 const answered=row&&form?row.screen.every(k=>form.findings[k]):false;
 const previewMatch=row&&form&&result&&answered?concordant(form.findings,row.screen):null;
 const save=async()=>{if(!row||!form)return;
  if(file&&file.size>PDF_MAX_BYTES){setError("ไฟล์ใหญ่เกิน 8 MB");return;}
  setBusy(true);setError("");
  const data={caseId:row.caseId,versionId:row.versionId,expectedSequence:row.record?.sequence??null,status:form.status,
   method:result&&form.method?form.method:null,specimen:result&&form.specimen?form.specimen:null,outlabName:result?form.outlabName:"",
   procedureDate:result&&form.procedureDate?form.procedureDate:null,reportDate:result&&form.reportDate?form.reportDate:null,resultText:result?form.resultText:"",note:form.note,
   findings:result?Object.fromEntries(row.screen.flatMap(k=>form.findings[k]?[[k,form.findings[k]]]:[])):{}};
  const body=new FormData();body.set("data",JSON.stringify(data));if(result&&file)body.set("file",file);
  try{const r=await fetch("/api/confirm/save",{method:"POST",cache:"no-store",headers:{"x-csrf-token":csrf()},body});
   const d=await r.json().catch(()=>({}));
   if(!r.ok){setError(d.error??"บันทึกไม่สำเร็จ กรุณาลองอีกครั้ง");if(d.code==="CONFIRM_CHANGED"||d.code==="CONFIRM_SCREEN_CHANGED"){setDirty(false);setReload(n=>n+1);}return;}
   setDirty(false);onSaved(`บันทึก ${STATUS_LABEL[form.status]} ของ LN ${row.ln} แล้ว`);}
  catch{setError("เชื่อมต่อระบบไม่สำเร็จ กรุณาลองอีกครั้ง");}finally{setBusy(false);}};
 return <Dialog title="ผลตรวจยืนยัน" onClose={onClose} dirty={dirty} discardDescription="ข้อมูลผลยืนยันที่กรอกไว้ยังไม่ได้บันทึก">
  {loadError?<div className="notice" role="alert">{loadError} <button type="button" className="button small secondary" onClick={()=>setReload(n=>n+1)}>ลองใหม่</button></div>
  :!row||!form?<p className="help" role="status">กำลังโหลด…</p>
  :<form className="confirm-editor" onSubmit={e=>{e.preventDefault();void save();}}>
   <section className="confirm-case" aria-label="ผลคัดกรอง NIPT">
    <p className="confirm-who"><span>LN <Ln value={row.ln}/></span>{row.name&&<span>{row.name}</span>}{row.hn&&<span className="num">HN {row.hn}</span>}</p>
    <p className="confirm-screen"><span className="confirm-screen-label">ผลคัดกรอง NIPT ออกผล {be(row.releasedAt)}</span>
     {row.screen.map(k=><span key={k} className="progress-badge tone-high-risk"><Icon name="alert"/>{SCREEN_LABEL[k]}</span>)}</p>
    <a className="button secondary confirm-pdf" href={pdfUrl(row.caseId,undefined,true)} target="_blank" rel="noopener"><Icon name="doc"/>ดูผลตรวจเดิม (รายงานฉบับเต็ม)</a>
   </section>

   {editable&&<fieldset className="confirm-group" disabled={busy}>
    <legend>สถานะ</legend>
    <div className="confirm-choices" role="radiogroup" aria-label="สถานะผลยืนยัน">{STATUSES.map(s=><label key={s} className="confirm-choice">
     <input type="radio" name={ids+"status"} value={s} checked={form.status===s} onChange={()=>set("status",s)}/><span>{STATUS_LABEL[s]}</span></label>)}</div>
    {!result&&form.status!=="PENDING"&&<p className="help">สถานะนี้ไม่นำมาคิด % ผลตรงกัน</p>}
   </fieldset>}

   {!editable&&<section className="confirm-read" aria-label="ผลตรวจยืนยัน">
    <div className="confirm-read-top"><StatusBadge status={row.status}/>{previewMatch!==null&&<MatchBadge value={previewMatch}/>}</div>
    {result?<>
     <ul className="confirm-read-findings">{row.screen.map(k=><li key={k}><span className="confirm-finding-name">{SCREEN_LABEL[k]}</span>
      <span className="confirm-read-arrow" aria-hidden="true">→</span>
      <span className={"confirm-read-outcome is-"+(form.findings[k]??"none").toLowerCase()}>{form.findings[k]&&<Icon name={form.findings[k]==="TRUE_POSITIVE"?"done":form.findings[k]==="FALSE_POSITIVE"?"stop":"alert"}/>}{form.findings[k]?OUTCOME_LABEL[form.findings[k]!]:"ยังไม่มีผล"}</span></li>)}</ul>
     <dl className="confirm-read-list">
      {([["วิธีตรวจ",form.method?METHOD_LABEL[form.method]:"—"],["สิ่งส่งตรวจ",form.specimen?SPECIMEN_LABEL[form.specimen]:"—"],["ห้องปฏิบัติการ (outlab)",form.outlabName||"—"],
       ["วันเจาะ/เก็บสิ่งส่งตรวจ",be(form.procedureDate)],["วันออกผล outlab",be(form.reportDate)],["ผลรายงาน",form.resultText||"—"]] as [string,string][]).map(([k,v])=><div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
     </dl>
     {row.record?.hasReport&&<a className="button secondary confirm-pdf" href={pdfUrl(row.caseId)} target="_blank" rel="noopener"><Icon name="doc"/>เปิดไฟล์ PDF รายงานจาก outlab</a>}
    </>:null}
    {form.note&&<p className="confirm-read-note"><strong>หมายเหตุ</strong> {form.note}</p>}
   </section>}

   {editable&&result&&<>
    <fieldset className="confirm-group" disabled={!editable||busy}>
     <legend>ผลยืนยันแต่ละรายการ</legend>
     <p className="help">เทียบผลจาก outlab กับรายการที่ผลคัดกรองพบ · Mosaic-other นับเป็นผลไม่ตรง</p>
     <ul className="confirm-findings">{row.screen.map(k=><li key={k}>
      <span className="confirm-finding-name" id={`${ids}f-${k}`}>{SCREEN_LABEL[k]}</span>
      <div className="confirm-choices" role="radiogroup" aria-labelledby={`${ids}f-${k}`}>{OUTCOMES.map(o=><label key={o} className={"confirm-choice is-"+o.toLowerCase()}>
       <input type="radio" name={`${ids}o-${k}`} value={o} checked={form.findings[k]===o} onChange={()=>set("findings",{...form.findings,[k]:o})}/><span>{OUTCOME_LABEL[o]}</span></label>)}</div>
     </li>)}</ul>
     <p className="confirm-preview" aria-live="polite">{previewMatch===null?<span className="help">เลือกผลให้ครบทุกรายการ</span>:<>ผลเทียบ: <MatchBadge value={previewMatch}/></>}</p>
    </fieldset>

    <fieldset className="confirm-group confirm-grid" disabled={!editable||busy}>
     <legend>รายละเอียดการตรวจยืนยัน</legend>
     <div className="field"><label htmlFor={ids+"method"}>วิธีตรวจ <span className="required-mark">(จำเป็น)</span></label>
      <select id={ids+"method"} required value={form.method} onChange={e=>set("method",e.target.value as Method)}><option value="">เลือกวิธีตรวจ</option>{METHODS.map(m=><option key={m} value={m}>{METHOD_LABEL[m]}</option>)}</select></div>
     <div className="field"><label htmlFor={ids+"specimen"}>สิ่งส่งตรวจ</label>
      <select id={ids+"specimen"} value={form.specimen} onChange={e=>set("specimen",e.target.value as Specimen)}><option value="">ไม่ระบุ</option>{SPECIMENS.map(s=><option key={s} value={s}>{SPECIMEN_LABEL[s]}</option>)}</select></div>
     <div className="field"><label htmlFor={ids+"outlab"}>ห้องปฏิบัติการที่ส่งตรวจ (outlab)</label><input id={ids+"outlab"} maxLength={200} value={form.outlabName} onChange={e=>set("outlabName",e.target.value)}/></div>
     <div className="field"><label htmlFor={ids+"pdate"}>วันเจาะ/เก็บสิ่งส่งตรวจ</label><ThaiDateInput id={ids+"pdate"} value={form.procedureDate} onChange={v=>set("procedureDate",v)}/></div>
     <div className="field"><label htmlFor={ids+"rdate"}>วันออกผล outlab</label><ThaiDateInput id={ids+"rdate"} value={form.reportDate} onChange={v=>set("reportDate",v)}/></div>
     <div className="field confirm-wide"><label htmlFor={ids+"text"}>ผลรายงาน</label><input id={ids+"text"} maxLength={500} placeholder="เช่น 47,XX,+21" value={form.resultText} onChange={e=>set("resultText",e.target.value)}/></div>
     <div className="field confirm-wide"><label htmlFor={ids+"file"}>ไฟล์ PDF รายงานผลจาก outlab {!row.record?.hasReport&&<span className="required-mark">(จำเป็น)</span>}</label>
      {row.record?.hasReport&&<div><a className="button secondary confirm-pdf" href={pdfUrl(row.caseId)} target="_blank" rel="noopener"><Icon name="doc"/>เปิดไฟล์ PDF ที่บันทึกไว้</a></div>}
      <input id={ids+"file"} type="file" accept="application/pdf,.pdf" onChange={e=>{setFile(e.target.files?.[0]??null);setDirty(true);setError("");}}/>
      <p className="help">{row.record?.hasReport?"เลือกไฟล์ใหม่เมื่อต้องการแทนที่":"PDF ไม่เกิน 8 MB"}</p></div>
    </fieldset>
   </>}

   {editable&&<fieldset className="confirm-group" disabled={busy}>
    <legend className="sr-only">หมายเหตุ</legend>
    <div className="field"><label htmlFor={ids+"note"}>หมายเหตุ</label><textarea id={ids+"note"} rows={2} maxLength={1000} value={form.note} onChange={e=>set("note",e.target.value)}/></div>
   </fieldset>}

   {detail.history.length>0&&<details className="confirm-history"><summary>ประวัติการบันทึก ({detail.history.length})</summary>
    <ol>{detail.history.map(h=><li key={h.sequence}><StatusBadge status={h.status}/><span className="num">{formatBeDateTime(h.at)}</span><span>โดย {h.by??"—"}</span>
     {h.hasReport&&<a href={pdfUrl(row.caseId,h.sequence)} target="_blank" rel="noopener">PDF</a>}</li>)}</ol></details>}

   <div aria-live="assertive">{error&&<p className="notice" role="alert">{error}</p>}</div>
   <div className="row confirm-footer">
    {row.record&&<p className="help confirm-by">บันทึกล่าสุด {formatBeDateTime(row.record.at)} โดย {row.record.by??"—"}</p>}
    <button type="button" className="button secondary" onClick={onClose}>{editable?"ยกเลิก":"ปิด"}</button>
    {editable&&<button type="submit" className="button" disabled={busy}>{busy?"กำลังบันทึก…":"บันทึก"}</button>}
   </div>
  </form>}
 </Dialog>;
}
