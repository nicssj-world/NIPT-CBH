"use client";
import Link from "next/link";
import {useCallback,useEffect,useMemo,useRef,useState} from "react";
import {labApi,failureText,bkk,LabFailure} from "../p4/lab-api";
import {csrf,Dialog} from "../p2/shared";
import {FileDropInput} from "../shared/file-drop-input";
import {PdfPreview} from "../shared/pdf-preview";
import {Pager} from "../shared/pager";

// Task 3 pathway A on the existing Results page: HALOS result import, then one report per patient from the Owner's DOCX masters.
// Every HOLD reason comes from the server; nothing here decides eligibility, and no action is shown that the server would refuse.
type Issue={code:string;severity:"ERROR"|"WARNING";sheet?:string;row?:number;detail?:string};
type ImportRow={id:string;sheet:string;row:number;sample:string;sampleKey:string;chip:string|null;classification:string;reason:string;qc:string|null;advice:string|null;t21:string|null;ln:string|null;lnHalos:string|null;attemptNumber:number|null};
type HalosImport={id:string;name:string;sha256:string;size:number;state:string;rowVersion:number;chipIds:string[];counts:Record<string,number>;issues:Issue[];uploadedBy:string;uploadedAt:string;rows:ImportRow[];duplicate?:boolean};
type Hold={code:string;field?:string;raw?:string};
type Row={rowId:string;sampleId:string;classification:string;reason:string;status:"READY"|"HOLD"|"FINAL"|"RELEASED"|"NOT_REPORTABLE";holds:Hold[];template:string|null;ln:string|null;lnHalos:string|null;hn:string|null;importName:string;importedAt:string;
 internalReportId:string|null;versionId:string|null;versionState:string|null;releaseId:string|null;hisAttested:boolean};
type Worklist={rows:Row[];page:{number:number;size:number;total:number;totalPages:number;hasNext:boolean};counts:Record<string,number>;canFinalize:boolean};
type Signer={userId:string;legalName:string;license:string;displayName:string;usable:boolean;basis:string|null};
type Candidate={rowId:string;template:"SINGLETON"|"TWIN";templateCode:string;pregnancySource:string;holds:Hold[];eligible:boolean;values:Record<string,string>|null;
 interpretation:{trace:{rule:string;input:string;output:string}[];ruleset:{id:string;version:string}};productCode:string|null;sources:Record<string,unknown>;hisLn:string;lnHalos:string|null;hn:string|null;sampleId:string;
 approval:{approved:boolean;reference:string};canFinalize:boolean};
type Outcome={rowId:string;outcome:"FINAL"|"HOLD"|"ERROR";holds?:Hold[];code?:string;versionId?:string;versionState?:string;release?:string;downloadName?:string};

const CLASS_TEXT:Record<string,string>={PATIENT:"ผู้ป่วย — จับคู่กับไฟล์ส่งออกแล้ว",CONTROL:"Control (PC/NC)",UNMATCHED:"ไม่พบในไฟล์ส่งออก",AMBIGUOUS:"กำกวม",STALE_EXPORT:"ไฟล์ส่งออกไม่เป็นปัจจุบัน",SUPERSEDED_ATTEMPT:"Attempt ไม่ใช่รอบ/ครั้งล่าสุด",DUPLICATE_ENTRY:"ซ้ำกับชีต result",REPEAT_HISTORY:"ประวัติการตรวจซ้ำ",SAMPLE_INFO:"ข้อมูลตัวอย่าง",INVALID:"ข้อมูลไม่ถูกต้อง"};
const CLASS_TONE:Record<string,string>={PATIENT:"good",CONTROL:"",UNMATCHED:"bad",AMBIGUOUS:"bad",STALE_EXPORT:"bad",SUPERSEDED_ATTEMPT:"warning",DUPLICATE_ENTRY:"",REPEAT_HISTORY:"",INVALID:"bad"};
const REASON_TEXT:Record<string,string>={FROZEN_EXPORT_MEMBER:"ตรงกับสมาชิกในไฟล์ HALOS ที่ส่งออกจากระบบ",NOT_IN_ANY_FROZEN_EXPORT:"ไม่มีในไฟล์ส่งออกใดของระบบ — ตรวจว่าเป็นตัวอย่างจาก Run อื่นหรือพิมพ์รหัสผิด",
 CONTROL_ID_NOT_IN_FROZEN_EXPORT:"รหัสแบบ Control ที่ไม่มีในไฟล์ส่งออก",EXPORT_CONTROL_POSITION:"ตำแหน่ง Control ในไฟล์ส่งออก",SAMPLE_ID_MAPS_TO_DIFFERENT_MEMBERS:"รหัสเดียวกันชี้ไปหลาย Attempt — ต้องตรวจไฟล์ส่งออก",
 EXPORT_POOLING_NO_LONGER_CURRENT:"บันทึก Pooling เปลี่ยนหลังส่งออก — ส่งออกใหม่แล้วรอผลชุดใหม่",LATER_ATTEMPT_EXISTS:"มี Attempt ใหม่กว่า",ROUND_NOT_CURRENT:"ไม่ใช่รอบปัจจุบัน",ATTEMPT_REMOVED_FROM_BATCH:"ถูกนำออกจาก Batch",
 DUPLICATE_SAMPLE_IN_RESULT_SHEET:"รหัสซ้ำในชีต result",RESULT_AND_REPEAT_VALUES_DIFFER:"ค่าในชีต result และ repeat ไม่ตรงกัน",SAME_AS_RESULT_SHEET_ROW:"เหมือนแถวในชีต result",REPEAT_SHEET_ONLY:"มีเฉพาะในชีต repeat",
 SAMPLE_ID_MISSING:"ไม่มีรหัสตัวอย่าง",SAMPLE_ID_FORMAT_INVALID:"รูปแบบรหัสตัวอย่างไม่ถูกต้อง",EXPORT_MEMBER_LINEAGE_MISMATCH:"ข้อมูล Attempt ไม่ตรงกับไฟล์ส่งออก"};
const ISSUE_TEXT:Record<string,string>={MIXED_CHIP_IN_RESULT_SHEET:"ชีต result มีหลาย Chip",NAME_COLLISION_DIFFERENT_CONTENT:"ชื่อไฟล์ซ้ำกับไฟล์ที่นำเข้าแล้ว แต่เนื้อหาต่างกัน",REPEAT_SHEET_ABSENT:"ไม่มีชีต repeat",UNKNOWN_SHEET_IGNORED:"มีชีตอื่นที่ระบบไม่ได้ใช้",CHIP_ID_MISSING:"ไม่มี Chip ID",SAMPLE_ID_MISSING:"แถวไม่มีรหัสตัวอย่าง",SAMPLE_ID_FORMAT_INVALID:"รหัสตัวอย่างผิดรูปแบบ"};
export const HOLD_TEXT:Record<string,string>={
 INTERPRETATION_RULESET_NOT_APPROVED:"ชุดกฎการแปลผลยังไม่ได้รับอนุมัติทางคลินิก (ตั้งค่า “การแปลผลรายงานที่ออกในระบบ”)",RULESET_VERSION_MISMATCH:"ชุดกฎที่อนุมัติไม่ตรงกับรุ่นที่ติดตั้ง",
 PRODUCT_TEMPLATE_COMBINATION_NOT_APPROVED:"ผลิตภัณฑ์ NIFTY นี้ยังไม่ได้รับอนุมัติให้ใช้กับแบบฟอร์มรายงาน (เช่น HNZ0011 กับแบบฟอร์ม HNZ0051)",REPORT_MASTER_NOT_INSTALLED:"ยังไม่ได้ติดตั้งแบบฟอร์ม DOCX ที่ตรวจ SHA-256",
 FETAL_SEX_DISCLOSURE_NOT_PERMITTED:"แบบฟอร์มครรภ์เดี่ยวแสดงเพศทารกเสมอ แต่ไม่มีความประสงค์ “ต้องการทราบเพศ” ที่บันทึกไว้",Y_CHROMOSOME_DISCLOSURE_NOT_PERMITTED:"ผู้รับบริการไม่ประสงค์ทราบผลโครโมโซม Y",
 QC_RERUN_ADVISED:"HALOS แนะนำให้ตรวจซ้ำ (Rerun) — ออกรายงานสุดท้ายไม่ได้",QC_NOT_PASS:"QC ไม่ผ่าน",QC_STATUS_UNRECOGNIZED:"สถานะ QC ไม่รู้จัก",
 T21_TOKEN_UNRECOGNIZED:"ผล T21 เป็นรหัสที่ชุดกฎไม่รู้จัก (เช่น ML21) — ต้องตรวจทางคลินิก",T18_TOKEN_UNRECOGNIZED:"ผล T18 เป็นรหัสที่ชุดกฎไม่รู้จัก",T13_TOKEN_UNRECOGNIZED:"ผล T13 เป็นรหัสที่ชุดกฎไม่รู้จัก",
 T21_MISSING:"ไม่มีผล T21",T18_MISSING:"ไม่มีผล T18",T13_MISSING:"ไม่มีผล T13",T21_RISK_INDEX_INVALID:"Probability T21 ไม่ถูกต้อง",T18_RISK_INDEX_INVALID:"Probability T18 ไม่ถูกต้อง",T13_RISK_INDEX_INVALID:"Probability T13 ไม่ถูกต้อง",
 SCA_TOKEN_UNRECOGNIZED:"ผลโครโมโซมเพศไม่รู้จักหรือผิดรูปแบบ",SCA_MISSING:"ไม่มีผลโครโมโซมเพศ",TWIN_SCA_FINDING_HAS_NO_TEMPLATE_SECTION:"ครรภ์แฝดมีผลโครโมโซมเพศ แต่แบบฟอร์มแฝดไม่มีส่วนนี้",
 GENDER_TOKEN_UNRECOGNIZED:"ค่าเพศไม่รู้จัก",GENDER_MISSING:"ไม่มีค่าเพศ",FETAL_FRACTION_INVALID:"Fetal fraction ไม่ถูกต้อง",FETAL_FRACTION_BELOW_TEMPLATE_REFERENCE:"Fetal fraction ต่ำกว่าเกณฑ์ที่แบบฟอร์มระบุ (3.5%)",
 TESTOTHER_FINDING_REQUIRES_REVIEW:"มีผลโครโมโซมอื่น (เช่น T22/T10) ที่แบบฟอร์มไม่มีส่วนรองรับ — ต้องตรวจทางคลินิก",DISEASE_FINDING_REQUIRES_REVIEW:"มีผล Disease ที่ต้องตรวจทางคลินิก",TESTCNV_FINDING_REQUIRES_REVIEW:"มีผล CNV ที่ต้องตรวจทางคลินิก",
 HALOS_IMPORT_NOT_CONFIRMED:"ยังไม่ยืนยันการนำเข้าไฟล์ HALOS",ROW_NOT_REPORTABLE:"แถวนี้ไม่ใช่ผู้ป่วยที่ออกรายงานได้",MATCH_CHANGED_SINCE_IMPORT:"การจับคู่เปลี่ยนหลังนำเข้า (เช่น Pooling ใหม่) — นำเข้าผลชุดใหม่",NEWER_HALOS_RESULT_EXISTS:"มีผล HALOS ที่ใหม่กว่าสำหรับ Attempt นี้",
 SAMPLE_ID_DIFFERS_FROM_ATTEMPT_PRINTED_ID:"รหัสใน HALOS ไม่ตรงกับรหัสที่พิมพ์ของ Attempt",NO_CALL_ATTEMPT_REQUIRES_NO_CALL_REPORT:"Attempt นี้เป็น No Call — ใช้รายงาน No Call",ATTEMPT_ON_QC_HOLD:"Attempt ถูกระงับ (QC Hold)",
 CONSENT_REVOKED:"ถอนความยินยอมแล้ว",CLINICAL_DATA_NOT_READY:"ข้อมูลทางคลินิก/ความยินยอมยังไม่พร้อม",ROUND_NOT_CURRENT:"ไม่ใช่รอบปัจจุบัน",INTERNAL_REPORT_ALREADY_FINAL:"มีรายงานฉบับจริงแล้ว",POST_RELEASE_REVISION_PENDING_OD17:"ส่งผลแล้ว — การออกฉบับแก้ไขหลังส่งผลรอนโยบาย OD-17",
 OPEN_REPORT_EXISTS_FOR_ROUND:"รอบนี้มีรายงาน (เช่น PDF ภายนอก) ที่เปิดอยู่แล้ว",ACTIVE_RELEASE_EXISTS_FOR_ROUND:"รอบนี้ส่งผลแล้ว (เช่น จาก ReadyGen)",PET_EVIDENCE_REQUIRED:"ไม่มี PET จาก HIS ของรอบนี้",PET_EVIDENCE_UNVERIFIED:"ตรวจ PET ไม่ผ่าน",
 HN_SOURCES_DISAGREE:"HN ใน PET ไม่ตรงกับเคส",PET_CLOCKS_REQUIRED:"ไม่มีเวลาเจาะ/รับจาก PET",COLLECTION_DATE_SOURCES_DISAGREE:"วันที่เจาะไม่ตรงกันระหว่างแหล่งข้อมูล",DOB_SOURCES_DISAGREE:"วันเกิดไม่ตรงกันระหว่างแหล่งข้อมูล",
 SAMPLEINFO_ROW_MISSING:"ไม่พบข้อมูลตัวอย่าง (sampleinfo) ที่ตรงกับไฟล์ NIFTY",PREGNANCY_TYPE_NOT_RECORDED:"ยังไม่บันทึกชนิดครรภ์ (เดี่ยว/แฝด) — บันทึกที่หน้าเคส",PREGNANCY_TYPE_SOURCES_DISAGREE:"ชนิดครรภ์ใน HALOS ไม่ตรงกับที่บันทึก",
 EDD_REQUIRED_FOR_GA:"ยังไม่บันทึก EDD — บันทึกที่หน้าเคส",GA_OUT_OF_RANGE:"อายุครรภ์อยู่นอกช่วง",GA_SOURCES_DISAGREE:"อายุครรภ์ใน HALOS ไม่ตรงกับที่คำนวณจาก EDD",PRODUCT_UNRECOGNIZED:"ไม่รู้จักผลิตภัณฑ์ใน sampleinfo",ROW_NOT_AVAILABLE:"เปิดรายการนี้ไม่ได้"};
export const holdText=(h:Hold)=>`${HOLD_TEXT[h.code]??h.code}${h.raw&&!HOLD_TEXT[h.code]?.includes(h.raw)?` (${h.raw})`:""}`;
const STATUS_TEXT:Record<Row["status"],string>={READY:"พร้อมออกรายงาน",HOLD:"ระงับ",FINAL:"ออกรายงานแล้ว — รอตรวจรับ",RELEASED:"ส่งผลแล้ว",NOT_REPORTABLE:"ไม่ใช่รายการออกรายงาน"};
const STATUS_TONE:Record<Row["status"],string>={READY:"good",HOLD:"warning",FINAL:"info",RELEASED:"good",NOT_REPORTABLE:""};
const TABS:[string,string][]=[["ALL","ทั้งหมด"],["READY","พร้อมออกรายงาน"],["HOLD","ระงับ"],["FINAL","รอตรวจรับ"],["RELEASED","ส่งผลแล้ว"],["NOT_REPORTABLE","ไม่ใช่ผู้ป่วย"]];
const Status=({tone,children}:{tone?:string;children:React.ReactNode})=><span className={`status ${tone??""}`}>{children}</span>;

function HalosImport({onConfirmed}:{onConfirmed:()=>void}){
 const [busy,setBusy]=useState(""),[error,setError]=useState(""),[preview,setPreview]=useState<HalosImport|null>(null),[acks,setAcks]=useState<Set<string>>(new Set()),[list,setList]=useState<{id:string;name:string;state:string;uploadedAt:string;uploadedBy:string;counts:Record<string,number>}[]>([]);
 const input=useRef<HTMLInputElement>(null);
 const loadList=useCallback(async()=>{try{setList((await labApi<{imports:typeof list}>("/api/task3/halos")).imports);}catch{/* list is secondary to the upload */}},[]);
 useEffect(()=>{void Promise.resolve().then(loadList);},[loadList]);
 const upload=async()=>{const file=input.current?.files?.[0];if(!file){setError("กรุณาเลือกไฟล์ HALOS (.xlsx)");input.current?.focus();return;}
  setBusy("upload");setError("");try{const form=new FormData();form.append("file",file);const r=await fetch("/api/task3/halos",{method:"POST",headers:{"x-csrf-token":csrf()},body:form});const d=await r.json().catch(()=>({}));
   if(!r.ok){setError(d.error??"อ่านไฟล์ไม่สำเร็จ");return;}setPreview(d);setAcks(new Set());if(input.current)input.current.value="";await loadList();}finally{setBusy("");}};
 const decide=async(decision:"CONFIRM"|"CANCEL")=>{if(!preview)return;setBusy(decision);setError("");try{const d=await labApi<HalosImport>(`/api/task3/halos/${preview.id}`,{decision,expectedRowVersion:preview.rowVersion,acknowledgeWarnings:[...acks]});setPreview(d.state==="Previewed"?d:null);await loadList();if(decision==="CONFIRM")onConfirmed();}catch(e){setError(failureText(e));}finally{setBusy("");}};
 const warnings=[...new Set((preview?.issues??[]).filter(i=>i.severity==="WARNING").map(i=>i.code))];
 const result=(preview?.rows??[]).filter(r=>r.sheet!=="sampleinfo");
 const c=preview?.counts??{};
 return <div className="stack">
  <div className="field"><label htmlFor="halos-file">ไฟล์ผล HALOS “Sample analysis data” (.xlsx)</label><FileDropInput id="halos-file" ref={input} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" aria-describedby="halos-file-help"/>
   <p id="halos-file-help" className="help">ระบบเก็บไฟล์ต้นฉบับไว้ไม่แก้ไข (SHA-256) แล้วอ่านชีต result / repeat / sampleinfo และจับคู่กับไฟล์ HALOS ที่ระบบส่งออกเท่านั้น — ไม่ต้องนำเข้าไฟล์ NIFTY ซ้ำ</p></div>
  <div className="action-bar"><button type="button" className="button" disabled={!!busy} onClick={upload}>{busy==="upload"?"กำลังอ่านไฟล์…":"อัปโหลดและตรวจ (Preview)"}</button></div>
  {error&&<p className="notice" role="alert">{error}</p>}
  {preview&&<div className="stack t3-preview" aria-labelledby="halos-preview-h">
   <h3 id="halos-preview-h">ตรวจก่อนยืนยัน — {preview.name}</h3>
   {preview.duplicate&&<p className="notice warning-notice" role="status">ไฟล์นี้ (เนื้อหาเดียวกัน) นำเข้าไว้แล้ว — แสดงรายการเดิม ไม่สร้างซ้ำ</p>}
   <dl className="compact-facts plan-dl t3-counts">
    <div><dt>แถวในไฟล์</dt><dd>result {c.result??0} · repeat {c.repeat??0} · sampleinfo {c.sampleinfo??0}</dd></div>
    <div><dt>ผู้ป่วยที่จับคู่ได้</dt><dd><Status tone="good">{c.PATIENT??0} ราย</Status></dd></div>
    <div><dt>Control</dt><dd>{c.CONTROL??0}</dd></div>
    <div><dt>ตรวจซ้ำ / ซ้ำซ้อน</dt><dd>{c.REPEAT_HISTORY??0} ประวัติ · {c.DUPLICATE_ENTRY??0} ซ้ำกับ result</dd></div>
    <div><dt>ต้องแก้ไข</dt><dd><Status tone={(c.UNMATCHED??0)+(c.AMBIGUOUS??0)+(c.STALE_EXPORT??0)+(c.INVALID??0)?"bad":"good"}>{(c.UNMATCHED??0)+(c.AMBIGUOUS??0)+(c.STALE_EXPORT??0)+(c.INVALID??0)+(c.SUPERSEDED_ATTEMPT??0)} รายการ</Status></dd></div>
    <div><dt>Chip</dt><dd className="mono">{preview.chipIds.join(", ")||"—"}</dd></div>
   </dl>
   {warnings.length>0&&<fieldset className="stack t3-warnings"><legend>คำเตือนที่ต้องรับทราบก่อนยืนยัน</legend>{warnings.map(w=><label key={w} className="check-label"><input type="checkbox" checked={acks.has(w)} onChange={e=>setAcks(s=>{const n=new Set(s);if(e.target.checked)n.add(w);else n.delete(w);return n;})}/> {ISSUE_TEXT[w]??w}</label>)}</fieldset>}
   <div className="table-wrap" role="region" aria-label="แถวผล HALOS และการจับคู่" tabIndex={0}>
    <table className="data-table t3-rows"><caption>แถวผลทั้งหมด {result.length} — แถวที่ไม่ใช่ผู้ป่วยจะไม่ถูกออกรายงาน</caption>
     <thead><tr><th scope="col">ชีต · แถว</th><th scope="col">รหัสตัวอย่าง (ตามไฟล์)</th><th scope="col">LN · LN Halos</th><th scope="col">QC / คำแนะนำ</th><th scope="col">T21</th><th scope="col">การจับคู่</th></tr></thead>
     <tbody>{result.map(r=><tr key={r.id}><td>{r.sheet} · {r.row}</td><td className="mono">{r.sampleKey}{r.sample!==r.sampleKey&&<span className="badge warning">มีช่องว่าง/แท็บในไฟล์</span>}</td><td className="mono">{r.ln??"—"}<br/>{r.lnHalos??""}</td>
      <td>{r.qc??"—"} / {r.advice??"—"}</td><td>{r.t21??"—"}</td><td><Status tone={CLASS_TONE[r.classification]}>{CLASS_TEXT[r.classification]??r.classification}</Status><div className="help">{REASON_TEXT[r.reason]??r.reason}</div></td></tr>)}</tbody></table>
   </div>
   <div className="bulk-bar"><span>ยืนยันแล้วไฟล์และการจับคู่นี้จะแก้ไขไม่ได้</span>
    <button type="button" className="button secondary" disabled={!!busy} onClick={()=>decide("CANCEL")}>ยกเลิก</button>
    <button type="button" className="button" disabled={!!busy||preview.state!=="Previewed"||warnings.some(w=>!acks.has(w))} onClick={()=>decide("CONFIRM")}>{busy==="CONFIRM"?"กำลังยืนยัน…":"ยืนยันนำเข้า"}</button></div>
  </div>}
  {list.length>0&&<details><summary>ไฟล์ HALOS ที่นำเข้าแล้ว ({list.length})</summary>
   <ul className="timeline">{list.map(i=><li key={i.id}><div className="row"><strong className="p5-file">{i.name}</strong><span>{i.state==="Confirmed"?"ยืนยันแล้ว":i.state==="Cancelled"?"ยกเลิก":"รอยืนยัน"}</span></div>
    <div className="help">{bkk(i.uploadedAt)} · {i.uploadedBy} · ผู้ป่วย {i.counts.PATIENT??0} · <a href={`/api/task3/halos/${i.id}/file`}>ดาวน์โหลดไฟล์ต้นฉบับ</a></div></li>)}</ul></details>}
 </div>;
}

function SignerPicker({role,label,value,onChange,id}:{role:"REPORTED"|"APPROVED";label:string;value:string;onChange:(v:string)=>void;id:string}){
 const [q,setQ]=useState(""),[options,setOptions]=useState<Signer[]>([]),[error,setError]=useState("");
 useEffect(()=>{const t=setTimeout(()=>{labApi<{signers:Signer[]}>(`/api/task3/signers?role=${role}&q=${encodeURIComponent(q)}`).then(r=>{setOptions(r.signers);setError("");}).catch(e=>setError(failureText(e)));},250);return()=>clearTimeout(t);},[q,role]);
 const chosen=options.find(o=>o.userId===value);
 return <div className="field t3-signer"><label htmlFor={id}>{label}</label>
  <div className="search-form t3-signer-search"><input id={id+"-q"} type="search" aria-label={`ค้นหา ${label}`} placeholder="พิมพ์ชื่อหรือเลขใบอนุญาต" value={q} onChange={e=>setQ(e.target.value)}/>{q&&<button type="button" className="button small secondary" onClick={()=>setQ("")}>ล้าง</button>}</div>
  <select id={id} value={value} onChange={e=>onChange(e.target.value)} aria-describedby={id+"-help"}>
   <option value="">— เลือก —</option>{options.map(o=><option key={o.userId} value={o.userId} disabled={!o.usable}>{o.legalName} · ใบอนุญาต {o.license}{o.usable?(o.basis==="SELF"?" (ตนเอง)":" (ได้รับมอบสิทธิ์)"):" — ยังไม่ได้รับมอบสิทธิ์"}</option>)}</select>
  <p id={id+"-help"} className="help">{error||(chosen?(chosen.basis==="SELF"?"ลงนามด้วยลายเซ็นของท่านเอง":"ใช้ลายเซ็นตามการมอบสิทธิ์ของเจ้าของลายเซ็น — ระบบบันทึกว่าท่านเป็นผู้ออกรายงาน"):"แสดงเฉพาะผู้ลงนามที่มีโปรไฟล์ผ่านการตรวจและมีสิทธิ์ในบทบาทนี้")}</p></div>;
}

function ReportDialog({rows,onClose,onDone}:{rows:Row[];onClose:()=>void;onDone:()=>void}){
 const single=rows.length===1?rows[0]:null;
 const [cand,setCand]=useState<Candidate|null>(null),[error,setError]=useState(""),[busy,setBusy]=useState("");
 const [reportedBy,setReportedBy]=useState(""),[approvedBy,setApprovedBy]=useState(""),[override,setOverride]=useState<""|"Singleton"|"Twins">(""),[overrideReason,setOverrideReason]=useState("");
 const [release,setRelease]=useState(false),[confirm,setConfirm]=useState({content:false,identity:false,disclosure:false,abnormal:false,bench:false});
 const [previewUrl,setPreviewUrl]=useState(""),[outcome,setOutcome]=useState<{batchId:string;items:Outcome[]}|null>(null),[key]=useState(()=>crypto.randomUUID());
 const [rowSigners,setRowSigners]=useState<Record<string,{reportedBy:string;approvedBy:string}>>({}),[opts,setOpts]=useState<{REPORTED:Signer[];APPROVED:Signer[]}>({REPORTED:[],APPROVED:[]});
 useEffect(()=>{if(single)return;void Promise.all((["REPORTED","APPROVED"] as const).map(r=>labApi<{signers:Signer[]}>(`/api/task3/signers?role=${r}`).then(x=>x.signers))).then(([REPORTED,APPROVED])=>setOpts({REPORTED,APPROVED})).catch(e=>setError(failureText(e)));},[single]);
 const setRow=(rowId:string,role:"reportedBy"|"approvedBy",value:string)=>setRowSigners(s=>({...s,[rowId]:{reportedBy:s[rowId]?.reportedBy??"",approvedBy:s[rowId]?.approvedBy??"",[role]:value}}));
 const loadCandidate=useCallback(async()=>{if(!single)return;try{setCand(await labApi<Candidate>("/api/task3/reports",{action:"candidate",rowId:single.rowId,...(override?{pregnancyOverride:override,overrideReason}:{})}));setError("");}catch(e){setError(failureText(e));}},[single,override,overrideReason]);
 useEffect(()=>{void Promise.resolve().then(loadCandidate);},[loadCandidate]);
 useEffect(()=>()=>{if(previewUrl)URL.revokeObjectURL(previewUrl);},[previewUrl]);
 const abnormal=!!cand?.values&&[cand.values.trisomy21_ra,cand.values.trisomy18_ra,cand.values.trisomy13_ra,cand.values.XO_NEW,cand.values.XXX_NEW,cand.values.XXY_NEW,cand.values.XYY_NEW].some(v=>v==="High Risk"||v==="Detected");
 const preview=async()=>{if(!single)return;setBusy("preview");setError("");
  try{const r=await fetch("/api/task3/reports/preview",{method:"POST",cache:"no-store",headers:{"content-type":"application/json","x-csrf-token":csrf()},body:JSON.stringify({rowId:single.rowId,...(override?{pregnancyOverride:override,overrideReason}:{}),reportedBy:reportedBy||null,approvedBy:approvedBy||null})});
   if(!r.ok){const d=await r.json().catch(()=>({}));setError(d.error??"สร้างร่างไม่สำเร็จ");return;}setPreviewUrl(URL.createObjectURL(await r.blob()));}finally{setBusy("");}};
 const finalize=async()=>{setBusy("final");setError("");
  try{const items=rows.map(r=>({rowId:r.rowId,...(single&&override?{pregnancyOverride:override,overrideReason}:{}),...(rowSigners[r.rowId]?.reportedBy?{reportedBy:rowSigners[r.rowId].reportedBy}:{}),...(rowSigners[r.rowId]?.approvedBy?{approvedBy:rowSigners[r.rowId].approvedBy}:{})}));
   const res=await labApi<{batchId:string;items:Outcome[]}>("/api/task3/reports",{action:"finalize",idempotencyKey:key,defaults:{reportedBy:reportedBy||null,approvedBy:approvedBy||null},items,
    ...(release?{release:true,releaseConfirmations:{reportContentVerified:true,identityAndValuesMatchReport:true,disclosureReviewed:true,abnormalAcknowledged:confirm.abnormal,...(confirm.bench?{benchMeasurementsReviewed:true}:{})}}:{})});
   setOutcome(res);onDone();}catch(e){setError(failureText(e));if(e instanceof LabFailure&&e.code==="IDEMPOTENCY_KEY_REUSED")onClose();}finally{setBusy("");}};
 const releaseReady=!release||(confirm.content&&confirm.identity&&confirm.disclosure&&(!abnormal||confirm.abnormal));
 const holds=single?cand?.holds??[]:[];
 const canSubmit=!!reportedBy&&!!approvedBy&&releaseReady&&(!single||cand?.eligible===true)&&(!override||overrideReason.trim().length>=8);
 const dirty=!!(reportedBy||approvedBy||override||release)&&!outcome;
 return <Dialog title={single?`ออกรายงาน ${single.ln??single.sampleId}`:`ออกรายงาน ${rows.length} ราย (หนึ่ง PDF ต่อผู้ป่วย)`} onClose={onClose} dirty={dirty}>
  <div className="stack t3-dialog">
   {error&&<p className="notice" role="alert">{error}</p>}
   {outcome?<div className="stack" role="status">
     <p className="notice success">บันทึกแล้ว — ออกรายงาน {outcome.items.filter(i=>i.outcome==="FINAL").length} ราย · ระงับ {outcome.items.filter(i=>i.outcome==="HOLD").length} · ผิดพลาด {outcome.items.filter(i=>i.outcome==="ERROR").length}</p>
     <ul className="timeline">{outcome.items.map(i=>{const r=rows.find(x=>x.rowId===i.rowId);return <li key={i.rowId}><div className="row"><strong className="mono">{r?.ln??r?.sampleId}</strong><Status tone={i.outcome==="FINAL"?"good":i.outcome==="HOLD"?"warning":"bad"}>{i.outcome==="FINAL"?(i.release==="CertifiedReleased"?"ออกรายงานและส่งผลแล้ว":"ออกรายงานแล้ว"):i.outcome==="HOLD"?"ระงับ":"ไม่สำเร็จ"}</Status></div>
      {i.holds&&<ul className="help">{i.holds.map(h=><li key={h.code}>{holdText(h)}</li>)}</ul>}{i.code&&<div className="help">{i.code}</div>}
      {i.versionId&&<div className="action-bar"><Link className="button small secondary" href={`/results/${i.versionId}`}>เปิดผลตรวจ</Link></div>}</li>;})}</ul>
     {outcome.items.some(i=>i.outcome==="FINAL")&&<div className="action-bar"><a className="button secondary" href={`/api/task3/batches/${outcome.batchId}/zip`}>ดาวน์โหลด ZIP (PDF แยกรายผู้ป่วย)</a><button type="button" className="button" onClick={onClose}>ปิด</button></div>}
    </div>:<>
   {single&&(!cand?<div className="skeleton" aria-busy="true" aria-label="กำลังโหลดข้อมูลรายงาน"/>:<>
    <dl className="compact-facts plan-dl t3-facts">
     <div><dt>ผู้ป่วย</dt><dd>{cand.values?.patientName??"—"} · HN <span className="mono">{cand.hn??"—"}</span> · LN <span className="mono">{cand.hisLn}</span></dd></div>
     <div><dt>รหัสตัวอย่าง HALOS</dt><dd className="mono">{cand.sampleId}</dd></div>
     <div><dt>แบบฟอร์ม</dt><dd>{cand.templateCode} — {cand.template==="TWIN"?"ครรภ์แฝด":"ครรภ์เดี่ยว"} ({cand.pregnancySource==="AUTHORIZED_OVERRIDE"?"เปลี่ยนโดยผู้มีสิทธิ์":"ตามข้อมูล ANC / หน้าเคส"})</dd></div>
     <div><dt>ผล</dt><dd>{cand.values?<>T21 {cand.values.trisomy21_ra} · T18 {cand.values.trisomy18_ra} · T13 {cand.values.trisomy13_ra} · QC {cand.values.qc}{cand.template==="SINGLETON"?<> · FF {cand.values.fetalFaction_2}% · เพศ {cand.values.gender}</>:<> · Y {cand.values.gender_cbh}</>}</>:"ยังสร้างค่าไม่ครบ"}</dd></div>
     <div><dt>ผลิตภัณฑ์ · ชุดกฎ</dt><dd>{cand.productCode??"—"} · {cand.interpretation.ruleset.id} {cand.interpretation.ruleset.version} · {cand.approval.approved?"อนุมัติแล้ว":"ยังไม่อนุมัติ"}</dd></div>
    </dl>
    {holds.length>0?<div className="notice warning-notice" role="status"><strong>ระงับ — ยังออกรายงานฉบับจริงไม่ได้</strong><ul>{holds.map(h=><li key={h.code+(h.field??"")}>{holdText(h)}</li>)}</ul></div>
     :<p className="notice success" role="status">ข้อมูลครบและผ่านเงื่อนไข — เลือกผู้ลงนามแล้วออกรายงานได้</p>}
    <details><summary>ที่มาของค่าแต่ละช่อง (การแปลผล)</summary><table className="data-table"><thead><tr><th scope="col">กฎ</th><th scope="col">ค่าจาก HALOS</th><th scope="col">ผลที่พิมพ์</th></tr></thead><tbody>{cand.interpretation.trace.map(t=><tr key={t.rule}><td>{t.rule}</td><td className="mono">{t.input||"(ว่าง)"}</td><td>{t.output}</td></tr>)}</tbody></table></details>
    {cand.canFinalize&&<details><summary>เปลี่ยนชนิดครรภ์ (เฉพาะกรณีข้อมูลผิด)</summary><div className="form-grid">
     <div className="field"><label htmlFor="t3-override">ใช้แบบฟอร์ม</label><select id="t3-override" value={override} onChange={e=>setOverride(e.target.value as typeof override)}><option value="">ตามข้อมูลที่บันทึก</option><option value="Singleton">ครรภ์เดี่ยว</option><option value="Twins">ครรภ์แฝด</option></select></div>
     <div className="field"><label htmlFor="t3-override-reason">เหตุผล (บันทึกในประวัติ)</label><input id="t3-override-reason" value={overrideReason} maxLength={500} onChange={e=>setOverrideReason(e.target.value)}/></div></div></details>}
   </>)}
   {!single&&<div className="table-wrap" role="region" aria-label="รายการที่จะออกรายงาน" tabIndex={0}><table className="data-table"><thead><tr><th scope="col">LN</th><th scope="col">รหัส HALOS</th><th scope="col">ผู้รายงาน (ถ้าต่างจากค่าเริ่มต้น)</th><th scope="col">ผู้อนุมัติ (ถ้าต่างจากค่าเริ่มต้น)</th></tr></thead>
    <tbody>{rows.map(r=><tr key={r.rowId}><td className="mono">{r.ln}</td><td className="mono">{r.sampleId}</td>
     {(["reportedBy","approvedBy"] as const).map(role=><td key={role}><select aria-label={`${role==="reportedBy"?"ผู้รายงาน":"ผู้อนุมัติ"}ของ ${r.ln??r.sampleId}`} value={rowSigners[r.rowId]?.[role]??""} onChange={e=>setRow(r.rowId,role,e.target.value)}>
      <option value="">ตามค่าเริ่มต้นของชุด</option>{opts[role==="reportedBy"?"REPORTED":"APPROVED"].filter(o=>o.usable).map(o=><option key={o.userId} value={o.userId}>{o.legalName} · {o.license}</option>)}</select></td>)}</tr>)}</tbody></table></div>}
   <div className="form-grid">
    <SignerPicker id="t3-reported" role="REPORTED" label={single?"Reported by":"Reported by (ค่าเริ่มต้นของชุด)"} value={reportedBy} onChange={setReportedBy}/>
    <SignerPicker id="t3-approved" role="APPROVED" label={single?"Approved by":"Approved by (ค่าเริ่มต้นของชุด)"} value={approvedBy} onChange={setApprovedBy}/>
   </div>
   {single&&<div className="action-bar"><button type="button" className="button secondary" disabled={!!busy||!cand?.values} onClick={preview}>{busy==="preview"?"กำลังสร้างร่าง…":"ดูร่างรายงาน"}</button><span className="help">ร่างมีลายน้ำ “PREVIEW” และไม่ถูกบันทึกเป็นรายงาน</span></div>}
   <fieldset className="stack"><legend>ส่งผลหลังออกรายงาน</legend>
    <label className="check-label"><input type="checkbox" checked={release} onChange={e=>setRelease(e.target.checked)}/> ตรวจรับและยืนยันส่งผลทันที (ผ่าน Gate ชุดเดียวกับการส่งผลปกติ)</label>
    {release&&<div className="stack t3-confirm">
     <label className="check-label"><input type="checkbox" checked={confirm.content} onChange={e=>setConfirm(c=>({...c,content:e.target.checked}))}/> ตรวจค่าในรายงานตรงกับผล HALOS และการแปลผลที่อนุมัติแล้ว</label>
     <label className="check-label"><input type="checkbox" checked={confirm.identity} onChange={e=>setConfirm(c=>({...c,identity:e.target.checked}))}/> ตัวตนผู้ป่วยและรอบถูกต้อง</label>
     <label className="check-label"><input type="checkbox" checked={confirm.disclosure} onChange={e=>setConfirm(c=>({...c,disclosure:e.target.checked}))}/> ตรวจการเปิดเผยเพศ/โครโมโซม Y แล้ว</label>
     <label className="check-label"><input type="checkbox" checked={confirm.abnormal} onChange={e=>setConfirm(c=>({...c,abnormal:e.target.checked}))}/> รับทราบผลผิดปกติ (ถ้ามี)</label>
     <label className="check-label"><input type="checkbox" checked={confirm.bench} onChange={e=>setConfirm(c=>({...c,bench:e.target.checked}))}/> ทบทวนค่าในใบงาน QC / Sequencing ฉบับล่าสุดแล้ว</label></div>}
   </fieldset>
   <div className="action-bar"><button type="button" className="button secondary" onClick={onClose} disabled={!!busy}>ยกเลิก</button>
    <button type="button" className="button" disabled={!!busy||!canSubmit} onClick={finalize}>{busy==="final"?"กำลังสร้าง PDF ด้วย Microsoft Word…":release?"ออกรายงานและส่งผล":"ออกรายงานฉบับจริง"}</button></div>
   {!canSubmit&&!busy&&<p className="help">{!reportedBy||!approvedBy?"เลือก Reported by และ Approved by ก่อน":single&&cand&&!cand.eligible?"รายการนี้ถูกระงับ — แก้ที่ต้นเหตุตามรายการด้านบน":release&&!releaseReady?"ติ๊กการยืนยันการส่งผลให้ครบ":""}</p>}
   </>}
  </div>
  {previewUrl&&<PdfPreview src={previewUrl} title="ร่างรายงาน (PREVIEW)" onClose={()=>{URL.revokeObjectURL(previewUrl);setPreviewUrl("");}}/>}
 </Dialog>;
}

export function NativeReports({canImport}:{canImport:boolean}){
 const [q,setQ]=useState(""),[status,setStatus]=useState("ALL"),[page,setPage]=useState(1),[pageSize,setPageSize]=useState(50);
 const [data,setData]=useState<Worklist|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState("");
 const [selected,setSelected]=useState<Set<string>>(new Set()),[dialog,setDialog]=useState<Row[]|null>(null);
 const seq=useRef(0);
 const load=useCallback(async()=>{const n=++seq.current;setLoading(true);try{const d=await labApi<Worklist>(`/api/task3/reports?q=${encodeURIComponent(q)}&status=${status}&page=${page}&pageSize=${pageSize}`);if(n===seq.current){setData(d);setError("");}}
  catch(e){if(n===seq.current)setError(failureText(e));}finally{if(n===seq.current)setLoading(false);}},[q,status,page,pageSize]);
 // Realtime search: typing filters after a short pause; no submit button needed.
 useEffect(()=>{const t=setTimeout(()=>{void load();},q?300:0);return()=>clearTimeout(t);},[load,q]);
 const ready=useMemo(()=>(data?.rows??[]).filter(r=>r.status==="READY"),[data]);
 const toggle=(id:string,on:boolean)=>setSelected(s=>{const n=new Set(s);if(on)n.add(id);else n.delete(id);return n;});
 return <section className="panel" aria-labelledby="native-h">
  <h2 id="native-h">รายงานจากผล HALOS</h2>
  <p className="help">นำเข้าไฟล์ผลจาก HALOS แล้วออกรายงานตามแบบฟอร์มของโรงพยาบาล (FM-WI-T-BM-17-07 ครรภ์เดี่ยว / FM-WI-T-BM-17-08 ครรภ์แฝด) — หนึ่ง PDF ต่อผู้ป่วย ผ่านการตรวจรับและส่งผลชุดเดียวกับ PDF ภายนอก
   {" "}· <Link href="/results/signers">ผู้ลงนามรายงาน</Link></p>
  {canImport&&<details className="t3-import" open={!data||(data.page.total===0)}><summary>นำเข้าไฟล์ผล HALOS</summary><HalosImport onConfirmed={()=>{setStatus("ALL");setPage(1);void load();}}/></details>}
  <form className="search-form t3-search" role="search" aria-label="ค้นหารายการออกรายงาน" onSubmit={e=>e.preventDefault()}>
   <div className="field"><label htmlFor="t3-q">ค้นหา LN / HN / LN Halos / รหัส HALOS</label><input id="t3-q" type="search" autoComplete="off" maxLength={40} value={q} onChange={e=>{setQ(e.target.value);setPage(1);}}/></div>
   {q&&<button type="button" className="button secondary" onClick={()=>{setQ("");setPage(1);}}>ล้างคำค้น</button>}
  </form>
  <div className="tabs result-status-filters" role="tablist" aria-label="สถานะการออกรายงาน">{TABS.map(([k,label])=><button key={k} type="button" role="tab" className="tab" aria-selected={status===k} onClick={()=>{setStatus(k);setPage(1);setSelected(new Set());}}>
   {label}{k!=="ALL"&&data?.counts[k]!==undefined&&status==="ALL"?` (${data.counts[k]})`:""}</button>)}</div>
  <div aria-live="polite">{loading&&<p className="help" role="status">กำลังโหลด…</p>}{error&&<div className="notice" role="alert">{error} <button type="button" className="button small secondary" onClick={()=>void load()}>ลองใหม่</button></div>}</div>
  {!error&&<div className="table-wrap" role="region" aria-label="รายการออกรายงานจากผล HALOS" tabIndex={0}>
   <table className="data-table t3-worklist"><thead><tr><th scope="col">{data?.canFinalize&&<label className="table-check-target"><input type="checkbox" aria-label="เลือกทุกรายการที่พร้อม" disabled={!ready.length} checked={ready.length>0&&ready.every(r=>selected.has(r.rowId))} onChange={e=>setSelected(e.target.checked?new Set(ready.map(r=>r.rowId)):new Set())}/></label>}</th>
    <th scope="col">LN · HN</th><th scope="col">รหัส HALOS</th><th scope="col">แบบฟอร์ม</th><th scope="col">สถานะ</th><th scope="col">ขั้นตอนถัดไป</th></tr></thead>
    <tbody>{!data?<tr><td colSpan={6} className="empty-row">{loading?"กำลังโหลด…":"—"}</td></tr>:data.rows.length?data.rows.map(r=><tr key={r.rowId} className={selected.has(r.rowId)?"selected":""}>
     <td>{data.canFinalize&&r.status==="READY"&&<label className="table-check-target"><input type="checkbox" aria-label={`เลือก ${r.ln??r.sampleId}`} checked={selected.has(r.rowId)} onChange={e=>toggle(r.rowId,e.target.checked)}/></label>}</td>
     <td className="mono">{r.ln??"—"}<br/>{r.hn??""}</td><td className="mono">{r.sampleId}</td><td>{r.template==="TWIN"?"แฝด (17-08)":r.template==="SINGLETON"?"เดี่ยว (17-07)":"—"}</td>
     <td><Status tone={STATUS_TONE[r.status]}>{STATUS_TEXT[r.status]}</Status>{r.hisAttested&&<span className="badge info">มีผลใน HIS แล้ว</span>}
      {r.status==="HOLD"&&<ul className="help t3-holds">{r.holds.slice(0,3).map(h=><li key={h.code}>{holdText(h)}</li>)}{r.holds.length>3&&<li>และอีก {r.holds.length-3} เหตุผล</li>}</ul>}
      {r.status==="NOT_REPORTABLE"&&<div className="help">{CLASS_TEXT[r.classification]??r.classification}</div>}</td>
     <td>{r.status==="READY"&&data.canFinalize?<button type="button" className="button small" onClick={()=>setDialog([r])}>ออกรายงาน</button>
      :r.status==="READY"||r.status==="HOLD"?<button type="button" className="button small secondary" onClick={()=>setDialog([r])}>{r.status==="HOLD"?"ดูเหตุผล":"ดูรายละเอียด"}</button>
      :r.versionId?<Link className="button small secondary" href={`/results/${r.versionId}`}>{r.status==="FINAL"?"ตรวจรับและส่งผล":"ดูผล"}</Link>:null}</td></tr>)
     :<tr><td colSpan={6} className="empty-row">{q?"ไม่พบรายการที่ตรงกับคำค้น":"ยังไม่มีผล HALOS ที่ยืนยันนำเข้า"}</td></tr>}</tbody></table></div>}
  {data&&data.page.total>0&&<Pager label="รายการออกรายงาน" page={data.page.number} pageSize={data.page.size} total={data.page.total} totalPages={data.page.totalPages} busy={loading} onPage={setPage} onSize={n=>{setPageSize(n);setPage(1);}}/>}
  {selected.size>0&&<div className="bulk-bar"><span>เลือก {selected.size} ราย</span><button type="button" className="button" onClick={()=>setDialog((data?.rows??[]).filter(r=>selected.has(r.rowId)))}>ออกรายงานที่เลือก</button></div>}
  {dialog&&<ReportDialog rows={dialog} onClose={()=>setDialog(null)} onDone={()=>{setSelected(new Set());void load();}}/>}
 </section>;
}
