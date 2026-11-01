"use client";
import {useState} from "react";
import {Dialog} from "../p2/shared";
import {labApi,failureText} from "./lab-api";
import {LabIcon,type LabIconName} from "../shared/lab-icons";
import {formatHisLn} from "./his-ln";
import "./action-center.css";

/** OWNER-LAB-012/028: one Sample Action Center from the Worklist LN or the QC row Sample ID.
 *  Availability mirrors the server guards (packages/lab/intake.ts actionCenter); the server remains the authority. */
export type ActionCenterSubject={attemptId:string;caseId:string;roundId:string;hisLn:string;hn?:string|null;roundNumber:number;sampleId?:string|null;
 attemptState:string;overallOrdinal:number|null;attemptNumber:number|null;outcomeStatus?:string|null};
type Kind="RE_LIBRARY"|"RE_EXTRACTION"|"RE_SAMPLING"|"NO_CALL";
const REPEAT_REASONS:[string,string][]=[["QC1_LOW","QC1 ต่ำกว่าเกณฑ์"],["LIBRARY_FAILURE","Library ล้มเหลว"],["BATCH_CANCELLED","Batch ถูกยกเลิก"],["STOPPED_BY_LAB","Lab หยุดงาน"],["OTHER","อื่น ๆ"]];
const REDRAW_REASONS:[string,string][]=[["QC1_FAILED","QC1 ไม่ผ่าน"],["QC_SAMPLE_FAILED","QC ระดับตัวอย่างไม่ผ่าน"],["FETAL_FRACTION_LOW","FF ต่ำ"],["SPECIMEN_PROBLEM","ปัญหาสิ่งส่งตรวจ"],["OTHER","อื่น ๆ"]];
const STAGES=["QC1","QC2","QC3","QC4","SEQUENCING"] as const;
const LIVE=["Assigned","InProgress"],FAILED=["QcFailed","Stopped","BatchCancelled"];

export function SampleActionCenter({subject:s,can,onClose,onDone}:{subject:ActionCenterSubject;can:{repeat:boolean;redraw:boolean;noCall:boolean};onClose:()=>void;onDone:(message:string)=>Promise<void>|void}){
 const ordinal=s.overallOrdinal??1,afterFour=ordinal>=4,waitingNoCall=s.outcomeStatus==="รอรับ PDF No Call";
 const repeatable=([...LIVE,...FAILED].includes(s.attemptState)||s.outcomeStatus==='HALOS แนะนำตรวจซ้ำ')&&!(s.roundNumber===1&&(s.attemptNumber??1)>=2);
 const options:{kind:Kind;icon:LabIconName;label:string;detail:string;enabled:boolean;why?:string}[]=[
  {kind:"RE_LIBRARY",icon:"refresh",label:"Re-Library",detail:afterFour?`ครั้งที่ ${ordinal+1} — ต้องระบุเหตุผล`:"สิ่งส่งตรวจเดิม · ทำ Library ใหม่",enabled:can.repeat&&repeatable,why:s.roundNumber===1&&(s.attemptNumber??1)>=2?"รอบที่ 1 ตรวจซ้ำครบแล้ว ให้ Re-Sampling":undefined},
  {kind:"RE_EXTRACTION",icon:"flask",label:"Re-Extraction",detail:afterFour?`ครั้งที่ ${ordinal+1} — ต้องระบุเหตุผล`:"สิ่งส่งตรวจเดิม · สกัดใหม่",enabled:can.repeat&&repeatable,why:s.roundNumber===1&&(s.attemptNumber??1)>=2?"รอบที่ 1 ตรวจซ้ำครบแล้ว ให้ Re-Sampling":undefined},
  {kind:"RE_SAMPLING",icon:"dna",label:"Re-Sampling",detail:"เก็บตัวอย่างใหม่ใต้ HIS LN เดิม",enabled:can.redraw},
  {kind:"NO_CALL",icon:"file",label:"No Call",detail:"รอรับ PDF No Call",enabled:can.noCall&&afterFour,why:afterFour?undefined:"ใช้ได้เมื่อตรวจครบ 4 ครั้ง"},
 ];
 const [kind,setKind]=useState<Kind|null>(()=>afterFour&&can.noCall?"NO_CALL":null),[stage,setStage]=useState<string>("QC1"),[reason,setReason]=useState(""),[note,setNote]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const live=LIVE.includes(s.attemptState),override=(kind==="RE_LIBRARY"||kind==="RE_EXTRACTION")&&afterFour;
 const reasons=kind==="RE_SAMPLING"?REDRAW_REASONS:REPEAT_REASONS;
 const valid=!!kind&&(kind==="NO_CALL"||!!reason)&&(!override||note.trim().length>=8);
 async function submit(){if(!kind)return;setBusy(true);setError("");try{
  const r=await labApi<Record<string,unknown>>("/api/p4/worklist",{action:"actionCenter",attemptId:s.attemptId,kind,...(live&&kind!=="RE_SAMPLING"?{stage}:{}),...(kind!=="NO_CALL"?{reasonCode:reason}:{}),...(note.trim()?{note:note.trim()}:{})});
  await onDone(kind==="RE_SAMPLING"?`สั่ง Re-Sampling แล้ว — รอบที่ ${String(r.newRoundNumber)}`:kind==="NO_CALL"?"บันทึก No Call แล้ว — รอรับ PDF No Call":`สั่ง ${kind==="RE_LIBRARY"?"Re-Library":"Re-Extraction"} แล้ว${r.printedSampleId?` — ${String(r.printedSampleId)}`:""}`);onClose();
 }catch(e){setError(failureText(e));}finally{setBusy(false);}}
 return <Dialog title="จัดการตัวอย่าง" onClose={onClose}><div className="action-center">
  <div className="action-center-identity">
   <strong className="mono">{s.sampleId??"—"}</strong>
   <span>LN {formatHisLn(s.hisLn)} · HN {s.hn??"—"} · รอบที่ {s.roundNumber} · ตรวจครั้งที่ {ordinal}</span>
  </div>
  {waitingNoCall?<p className="notice" role="status">รอรับ PDF No Call — ไม่มีการดำเนินการเพิ่มที่ตัวอย่างนี้</p>:<>
  {afterFour&&<p className="notice warning-notice" role="note">ตรวจครบ 4 ครั้งแล้ว ค่าเริ่มต้นคือ No Call · หากต้องตรวจครั้งที่ {ordinal+1} ให้เลือกการตรวจซ้ำและระบุเหตุผล</p>}
  <fieldset className="action-center-options"><legend>เลือกการดำเนินการ</legend>
   {options.map(o=><label key={o.kind} className={`action-center-option${kind===o.kind?" selected":""}${o.enabled?"":" disabled"}`}>
    <input type="radio" name="action-center" value={o.kind} checked={kind===o.kind} disabled={!o.enabled||busy} onChange={()=>{setKind(o.kind);setReason("");}}/>
    <LabIcon name={o.icon} size={22}/><span><strong>{o.label}</strong><small>{o.enabled?o.detail:o.why??"ไม่มีสิทธิ์หรือไม่อยู่ในสถานะที่ทำได้"}</small></span>
   </label>)}
  </fieldset>
  {kind&&<div className="form-grid">
   {live&&kind!=="RE_SAMPLING"&&<div className="field"><label htmlFor="ac-stage">ขั้นตอนที่ไม่สำเร็จ</label><select id="ac-stage" value={stage} onChange={e=>setStage(e.target.value)}>{STAGES.map(v=><option key={v} value={v}>{v==="SEQUENCING"?"Sequencing":v}</option>)}</select></div>}
   {kind!=="NO_CALL"&&<div className="field"><label htmlFor="ac-reason">เหตุผล</label><select id="ac-reason" value={reason} onChange={e=>setReason(e.target.value)}><option value="">เลือกเหตุผล</option>{reasons.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></div>}
   {(override||kind!=="NO_CALL")&&<div className="field action-center-note"><label htmlFor="ac-note">{override?"เหตุผลการตรวจเกิน 4 ครั้ง (อย่างน้อย 8 ตัวอักษร)":"หมายเหตุ (ถ้ามี)"}</label><textarea id="ac-note" rows={2} maxLength={500} value={note} onChange={e=>setNote(e.target.value)}/></div>}
  </div>}
  {live&&kind&&kind!=="RE_SAMPLING"&&<p className="help">บันทึกว่าขั้นตอนนี้ไม่สำเร็จจากการปฏิบัติงานจริง แล้วดำเนินการตามที่เลือกในครั้งเดียว</p>}</>}
  {error&&<p className="notice" role="alert">{error}</p>}
  <div className="dialog-actions">{!waitingNoCall&&<button className="button" type="button" disabled={busy||!valid} onClick={()=>void submit()}>{busy?"กำลังบันทึก…":"ยืนยัน"}</button>}<button className="button secondary" type="button" onClick={onClose}>{waitingNoCall?"ปิด":"ยกเลิก"}</button></div>
 </div></Dialog>;
}
