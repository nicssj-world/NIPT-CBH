"use client";
import {useEffect,useState} from "react";
import {labApi,failureText} from "../p4/lab-api";
import {Dialog} from "../p2/shared";
import {attestErrorText} from "./release-board-logic";
import type {BoardRow} from "./release-board";

// Action-needed dialogs of the results board. The server decides everything (state, permission, row version); these only collect a choice and a reason.
type Candidate={caseId:string;ln:string;hn:string|null;lnHalos:string|null;matchedOn:string[];round:{id:string;number:number;current:boolean;collectionDate:string|null};attempt:{id:string;number:number;printedSampleId:string|null;latest:boolean}};
type Detail={candidates:Candidate[];version:{rowVersion:number};parsed?:{abnormal?:boolean}};

/** "เลือกผู้ป่วย": the candidates come from the version detail (the same list the result page uses); `pick` links and reviews in one step. */
export function PickPatientDialog({row,onClose,onDone}:{row:BoardRow;onClose:()=>void;onDone:(message:string)=>void}){
 const [detail,setDetail]=useState<Detail|null>(null),[choice,setChoice]=useState(""),[hisPresent,setHisPresent]=useState(false),[error,setError]=useState(""),[busy,setBusy]=useState(false);
 useEffect(()=>{let active=true;void labApi<Detail>(`/api/p5/results/${row.versionId}`).then(d=>{if(active)setDetail(d);}).catch(e=>{if(active)setError(failureText(e));});return()=>{active=false;};},[row.versionId]);
 const picked=detail?.candidates.find(c=>c.attempt.id===choice);
 const submit=async()=>{if(!detail||!picked)return;setBusy(true);setError("");
  try{const r=await labApi<{state:string;reviewSkipped?:string;shownToAnc?:true;attestFailed?:string}>(`/api/p5/results/${row.versionId}`,{action:"pick",expectedRowVersion:detail.version.rowVersion,caseId:picked.caseId,roundId:picked.round.id,attemptId:picked.attempt.id,...(hisPresent?{hisPresent:true}:{})});
   if(r.shownToAnc){onDone("เลือกผู้ป่วยแล้ว — แสดงผลในหน้าคนไข้แล้ว (ไม่ส่ง HIS)");return;}
   if(r.attestFailed){onDone(`เลือกผู้ป่วยแล้ว แต่ระบุว่ามีผลใน HIS แล้วไม่ได้: ${attestErrorText(r.attestFailed)}`);return;}
   onDone(r.reviewSkipped?"เลือกผู้ป่วยแล้ว — ยังไม่ตรวจรับ จะตรวจตอนส่ง HIS":"เลือกผู้ป่วยแล้ว");}
  catch(e){setError(failureText(e));}finally{setBusy(false);}};
 const ready=!!picked;
 return <Dialog title={`เลือกผู้ป่วย ${row.ln??row.hn??"PDF"}`} onClose={onClose} dirty={!!choice||hisPresent}>
  <div className="stack board-dialog">
   {error&&<p className="notice" role="alert">{error}</p>}
   {!detail&&!error&&<div className="skeleton" aria-busy="true" aria-label="กำลังโหลดตัวเลือกผู้ป่วย"/>}
   {detail&&<fieldset className="p5-candidates"><legend>เลือกรอบและ Attempt ({detail.candidates.length} ตัวเลือก)</legend>
    {detail.candidates.length?<div className="table-wrap" role="region" aria-label="ตัวเลือกผู้ป่วย" tabIndex={0}><table className="data-table"><thead><tr><th scope="col"><span className="sr-only">เลือก</span></th><th scope="col">LN · HN</th><th scope="col">รอบ · Attempt</th><th scope="col">พบจาก</th></tr></thead>
     <tbody>{detail.candidates.map(c=><tr key={c.attempt.id} className={choice===c.attempt.id?"selected":""}>
      <td><input type="radio" name="pick-candidate" aria-label={`เลือก ${c.ln} รอบที่ ${c.round.number} Attempt ${c.attempt.number}`} checked={choice===c.attempt.id} onChange={()=>setChoice(c.attempt.id)}/></td>
      <td className="mono">{c.ln}{c.lnHalos&&<> · {c.lnHalos}</>}<br/>{c.hn??"—"}</td>
      <td>รอบที่ {c.round.number}{c.round.current?"":" (ไม่ใช่รอบปัจจุบัน)"} · Attempt {c.attempt.number}{c.attempt.latest?"":" (ไม่ใช่ล่าสุด)"}{c.attempt.printedSampleId&&<div className="help mono">{c.attempt.printedSampleId}</div>}</td>
      <td>{c.matchedOn.join(", ")||"—"}</td></tr>)}</tbody></table></div>
     :<p className="help">ไม่พบผู้ป่วยที่ตรงกับ HN / LN ใน PDF นี้ — ตรวจข้อมูลเคสก่อน หรือทิ้งรายการนี้</p>}
   </fieldset>}
   <label className="check-label"><input type="checkbox" checked={hisPresent} onChange={e=>setHisPresent(e.target.checked)}/> ผลนี้<strong> มีใน HIS แล้ว</strong> — แสดงผลในหน้าคนไข้อย่างเดียว ไม่ส่ง HIS</label>
   <p className="help">{hisPresent?"หลังเลือก ผลจะแสดงในหน้าคนไข้ให้ ANC เห็นทันที และไม่ถูกส่ง HIS ซ้ำ":"หลังเลือก รายการจะไปที่ “รอส่ง HIS” ถ้าผ่านเงื่อนไข ผลยังไม่ถูกส่งให้ ANC จนกว่าจะกด “ส่ง HIS”"}</p>
   <div className="action-bar"><button type="button" className="button secondary" onClick={onClose} disabled={busy}>ยกเลิก</button><button type="button" className="button" disabled={busy||!ready} onClick={submit}>{busy?"กำลังบันทึก…":"เลือกผู้ป่วยนี้"}</button></div>
  </div>
 </Dialog>;
}

/** "ทิ้งรายการนี้": a version is voided, a HALOS-only row is dismissed; both need a reason and neither can touch a result that was already sent. */
export function DiscardDialog({row,onClose,onDone}:{row:BoardRow;onClose:()=>void;onDone:(message:string)=>void}){
 const [reason,setReason]=useState(""),[error,setError]=useState(""),[busy,setBusy]=useState(false);
 const submit=async()=>{setBusy(true);setError("");
  try{
   if(row.versionId&&row.rowVersion!==null)await labApi(`/api/p5/results/${row.versionId}`,{action:"void",expectedRowVersion:row.rowVersion,reason:reason.trim()});
   else if(row.halosRowId)await labApi(`/api/task3/halos/rows/${row.halosRowId}`,{reason:reason.trim()});
   else throw new Error("NO_TARGET");
   onDone("ทิ้งรายการแล้ว");}
  catch(e){setError(failureText(e));}finally{setBusy(false);}};
 return <Dialog title={`ทิ้งรายการ ${row.ln??row.hn??row.sampleId??""}`} onClose={onClose} dirty={!!reason}>
  <div className="stack board-dialog">
   {error&&<p className="notice" role="alert">{error}</p>}
   <p>{row.versionId?"รายการนี้จะถูกยกเลิก (Void) และไม่ถูกส่ง HIS":"แถวผล HALOS นี้จะถูกซ่อน และไม่ถูกออกรายงาน"} — บันทึกเหตุผลไว้ในประวัติ</p>
   <div className="field"><label htmlFor="discard-reason">เหตุผล (ไม่บังคับ)</label><input id="discard-reason" value={reason} maxLength={500} onChange={e=>setReason(e.target.value)}/></div>
   <div className="action-bar"><button type="button" className="button secondary" onClick={onClose} disabled={busy}>ยกเลิก</button><button type="button" className="button danger" disabled={busy} onClick={submit}>{busy?"กำลังทิ้ง…":"ทิ้งรายการนี้"}</button></div>
  </div>
 </Dialog>;
}
