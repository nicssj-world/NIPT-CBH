"use client";
import Link from "next/link";
import {useCallback,useEffect,useMemo,useRef,useState,type ReactNode} from "react";
import {labApi,failureText} from "../p4/lab-api";
import {Pager} from "../shared/pager";
import {PdfPreviewButton} from "../shared/pdf-preview";
import type {HisDeliveryStatus} from "../../../packages/results/his-status";
import {HisDeliveryBadge,ResendHisButton} from "./his-delivery-badge";
import {hisSendErrorText} from "../../../packages/results/his-status";
import {HOLD_TEXT} from "./native-reports";
import {BOARD_REASON_TEXT,reasonText} from "./labels";
import {attestErrorText,batchSignature,canShowOnPatient,canSend,needsAbnormalTick,needsReviewTick,outcomeText,outcomeTone,selectedRows,sendTicks,type BoardTab,type SendOutcome} from "./release-board-logic";
import {BulkDiscardDialog,DiscardDialog,PickPatientDialog} from "./release-board-dialogs";

// One results board: Action needed / Waiting for HIS / Sent. The server (releaseQueue `board`) decides which tab a row belongs to and why;
// this component only lists, selects and calls the existing actions. A result is never shown as visible to ANC before "ส่ง HIS" succeeded.
export type BoardRow={key:string;source:"HALOS"|"READYGEN";versionId:string|null;halosRowId:string|null;rowVersion:number|null;ln:string|null;hn:string|null;lnHalos:string|null;sampleId:string|null;template:string|null;abnormal:boolean;reviewed:boolean;reasons:{code:string;fixHref?:string}[];hisDelivery?:HisDeliveryStatus;pdfHref:string|null};
type Board={rows:BoardRow[];counts:Record<BoardTab,number>;canRevise:boolean;truncated:boolean;page:{number:number;size:number;total:number;totalPages:number;hasNext:boolean}};
const TABS:[BoardTab,string][]=[["ACTION","ต้องจัดการ"],["READY","รอส่ง HIS"],["SENT","ส่งแล้ว"]];
const HELP:Record<BoardTab,string>={ACTION:"รายการที่ยังส่ง HIS ไม่ได้หรือส่งไฟล์ไม่สำเร็จ — แก้ตามเหตุผลที่แสดง เลือกผู้ป่วย ทิ้งรายการ หรือกดไอคอนส่ง HIS อีกครั้ง",READY:"ผลที่นำเข้าหรือออกรายงานแล้ว ยังไม่ถูกส่ง และผลที่กำลังเขียนไฟล์ไป HIS — ANC จะเห็นผลหลังกด “ส่ง HIS” สำเร็จเท่านั้น",SENT:"ผลที่เขียน PDF, .res และ .ok ลงโฟลเดอร์ HIS สำเร็จแล้ว เรียงใหม่สุดก่อน"};
const TEMPLATE_TEXT:Record<string,string>={SINGLETON:"ครรภ์เดี่ยว",TWIN:"ครรภ์แฝด"};
export const reasonLabel=(code:string)=>code.startsWith("HIS_SEND:")?hisSendErrorText(code.slice(9)):HOLD_TEXT[code]??BOARD_REASON_TEXT[code]??reasonText(code);
const Status=({tone,children}:{tone?:string;children:ReactNode})=><span className={`status ${tone??""}`}>{children}</span>;
const who=(r:BoardRow)=><><span className="mono">{r.ln??"—"}</span>{r.lnHalos&&<span className="help"> · LN Halos {r.lnHalos}</span>}<br/><span className="mono">{r.hn??"—"}</span></>;
const source=(r:BoardRow)=><>{r.source==="HALOS"?"HALOS":"ReadyGen"}{r.template&&<div className="help">{TEMPLATE_TEXT[r.template]??r.template}</div>}{r.sampleId&&<div className="help mono">{r.sampleId}</div>}</>;

export function ReleaseBoard({tab,onTab,refreshKey=0,sentExtras,scope="PATIENT"}:{tab:BoardTab;onTab:(t:BoardTab)=>void;refreshKey?:number;sentExtras?:ReactNode;scope?:"PATIENT"|"EQA"}){
 const [q,setQ]=useState(""),[term,setTerm]=useState(""),[page,setPage]=useState(1),[pageSize,setPageSize]=useState(50);
 const [data,setData]=useState<Board|null>(null),[counts,setCounts]=useState<Board["counts"]|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState(""),[notice,setNotice]=useState("");
 const [selected,setSelected]=useState<Set<string>>(new Set()),[ticks,setTicks]=useState({reviewConfirmed:false,abnormalAcknowledged:false});
 const [shownTick,setShownTick]=useState(false),[showing,setShowing]=useState(false),[shownResult,setShownResult]=useState<{ok:number;failed:{row:BoardRow;code:string;linked:boolean}[]}|null>(null);
 const [sending,setSending]=useState(false),[outcomes,setOutcomes]=useState<{row:BoardRow;outcome:SendOutcome}[]|null>(null),[sendError,setSendError]=useState("");
 const [dialog,setDialog]=useState<{kind:"pick"|"discard";row:BoardRow}|{kind:"bulk";rows:BoardRow[]}|null>(null);
 const seq=useRef(0),sendKey=useRef<{sig:string;key:string}|null>(null);
 const load=useCallback(async()=>{const n=++seq.current;setLoading(true);
  try{const d=await labApi<Board>("/api/p5/results",{action:"board",tab,page,pageSize,scope,...(term?{q:term}:{})});if(n===seq.current){setData(d);setCounts(d.counts);setError("");}}
  catch(e){if(n===seq.current){setData(null);setError(failureText(e));}}finally{if(n===seq.current)setLoading(false);}},[tab,page,pageSize,term,scope]);
 useEffect(()=>{void Promise.resolve().then(load);},[load,refreshKey]);
 // Realtime search: typing filters after a short pause (same behaviour as the HALOS worklist it replaces).
 useEffect(()=>{const t=setTimeout(()=>{setTerm(q.trim());setPage(1);},q?300:0);return()=>clearTimeout(t);},[q]);
 const clearSelection=()=>{setSelected(new Set());setTicks({reviewConfirmed:false,abnormalAcknowledged:false});};
 const rows=useMemo(()=>data?.rows??[],[data]);
 const sel=useMemo(()=>selectedRows(rows,selected),[rows,selected]);
 const showReview=needsReviewTick(sel),showAbnormal=needsAbnormalTick(sel);
 // The ticks belong to the selection they were given for: any change of selection clears them.
 const changeSelection=(next:Set<string>)=>{setSelected(next);setTicks({reviewConfirmed:false,abnormalAcknowledged:false});};
 const selectable=useMemo(()=>rows.filter(r=>canShowOnPatient(r)),[rows]);
 // ACTION: a row can be ticked if it can be shown on the patient (has a PDF version) or, for people who may revise, if it can be discarded (a HALOS-only row too).
 const canDiscard=!!data?.canRevise;
 const discardable=(r:BoardRow)=>canDiscard&&!r.hisDelivery&&((!!r.versionId&&r.rowVersion!==null)||!!r.halosRowId);
 const checkable=useMemo(()=>tab==="ACTION"?rows.filter(r=>canShowOnPatient(r)||discardable(r)):selectable,[tab,rows,selectable,canDiscard]);// eslint-disable-line react-hooks/exhaustive-deps
 const discardSel=useMemo(()=>rows.filter(r=>selected.has(r.key)&&discardable(r)),[rows,selected,canDiscard]);// eslint-disable-line react-hooks/exhaustive-deps
 const toggle=(key:string,on:boolean)=>{const n=new Set(selected);if(on)n.add(key);else n.delete(key);changeSelection(n);};
 const changeTab=(t:BoardTab)=>{clearSelection();setShownResult(null);setShownTick(false);setOutcomes(null);setSendError("");setNotice("");setPage(1);onTab(t);};

 const send=async(batch:BoardRow[])=>{
  const given=sendTicks(batch,ticks),sig=batchSignature(batch,ticks);
  // A new key for each new click-batch; the same key only when an unchanged batch is retried (e.g. after a network error).
  if(sendKey.current?.sig!==sig)sendKey.current={sig,key:crypto.randomUUID()};
  setSending(true);setSendError("");setNotice("");setOutcomes(null);
  try{const r=await labApi<{items:SendOutcome[]}>("/api/p5/results",{action:"send",idempotencyKey:sendKey.current.key,...given,items:batch.map(b=>({versionId:b.versionId,expectedRowVersion:b.rowVersion}))});
   setOutcomes(r.items.map(o=>({outcome:o,row:batch.find(b=>b.versionId===o.versionId)!})));sendKey.current=null;clearSelection();}
  catch(e){setSendError(failureText(e));setSending(false);return;}
  setSending(false);await load();};
 const sendRow=(r:BoardRow)=>{if(!canSend([r],ticks)){changeSelection(new Set(selected).add(r.key));setNotice("ติ๊กยืนยันด้านล่างตาราง แล้วกด “ส่งที่เลือก”");return;}void send([r]);};
 // "มีผลใน HIS แล้ว" for the selected rows: shown on the patient, off this list, never sent again. One confirmation covers the list; each row is reported.
 const showOnPatient=async()=>{const batch=selectedRows(rows,selected).filter(canShowOnPatient);if(!batch.length||!shownTick)return;setShowing(true);setSendError("");setShownResult(null);
  try{const r=await labApi<{items:{versionId:string;outcome:"SHOWN"|"LINKED_AND_SHOWN"|"LINKED_NOT_SHOWN"|"NOT_CHANGED";reason:string|null}[]}>("/api/p5/results",{action:"attestBatch",confirmed:true,items:batch.map(b=>({versionId:b.versionId}))});
   setShownResult({ok:r.items.filter(i=>i.outcome==="SHOWN"||i.outcome==="LINKED_AND_SHOWN").length,failed:r.items.filter(i=>i.outcome==="NOT_CHANGED"||i.outcome==="LINKED_NOT_SHOWN").map(i=>({row:batch.find(b=>b.versionId===i.versionId)!,code:i.reason??"ERROR",linked:i.outcome==="LINKED_NOT_SHOWN"}))});clearSelection();setShownTick(false);}
  catch(e){setSendError(failureText(e));setShowing(false);return;}
  setShowing(false);await load();window.setTimeout(()=>document.getElementById("board-shown-result")?.scrollIntoView({block:"center",behavior:"smooth"}),50);};
 const done=async(message:string)=>{setDialog(null);setNotice(message);await load();};

 const empty=q?"ไม่พบรายการที่ตรงกับคำค้น":tab==="ACTION"?"ไม่มีรายการที่ต้องจัดการ":tab==="READY"?"ไม่มีผลที่รอส่ง HIS":"ยังไม่มีผลที่ส่งแล้ว";
 const cols=tab==="READY"||tab==="ACTION"?7:6;
 return <section className="panel release-board" aria-labelledby="board-h">
  <h2 id="board-h">{scope==="EQA"?"รับรองรายงาน EQA":"ผลตรวจ NIPT"}</h2>
  <form className="search-form" role="search" aria-label="ค้นหารายการผลตรวจ" onSubmit={e=>e.preventDefault()}>
   <div className="field"><label htmlFor="board-q">ค้นหา LN / HN / LN Halos / รหัสตัวอย่าง</label><input id="board-q" type="search" autoComplete="off" maxLength={40} value={q} onChange={e=>{setQ(e.target.value);clearSelection();}}/></div>
   {q&&<button type="button" className="button secondary" onClick={()=>{setQ("");clearSelection();}}>ล้างคำค้น</button>}
  </form>
  <div className="tabs result-status-filters" role="tablist" aria-label="สถานะผลตรวจ">{TABS.map(([k,label])=><button key={k} type="button" role="tab" className="tab" id={`board-tab-${k}`} aria-selected={tab===k} aria-controls="board-panel" onClick={()=>changeTab(k)}>{label}{counts?` (${counts[k]})`:""}</button>)}</div>
  <div role="tabpanel" id="board-panel" aria-labelledby={`board-tab-${tab}`} className="stack">
   <p className="help">{HELP[tab]}</p>
   <div aria-live="polite">
    {loading&&<p className="help" role="status">กำลังโหลด…</p>}
    {notice&&<p className="notice success" role="status">{notice}</p>}
    {error&&<div className="notice" role="alert">{error} <button type="button" className="button small secondary" onClick={()=>void load()}>ลองใหม่</button></div>}
    {sendError&&<p className="notice" role="alert">{sendError}</p>}
    {data?.truncated&&<p className="notice warning-notice" role="status">แสดงเฉพาะรายการล่าสุด — ใช้ช่องค้นหา</p>}
   </div>
   {shownResult&&<div id="board-shown-result" className="stack board-outcomes" role="status" tabIndex={-1}><strong>แสดงผลในหน้าคนไข้แล้ว {shownResult.ok} รายการ{shownResult.failed.length?` · ทำไม่สำเร็จ ${shownResult.failed.length} รายการ`:""}</strong>{shownResult.failed.length>0&&<ul className="timeline">{shownResult.failed.map(f=><li key={f.row.key}><Status tone="warning">ยังไม่ได้ทำ</Status> <span className="mono">{f.row.ln??f.row.hn??f.row.key}</span> · {f.linked?"เชื่อมผู้ป่วยแล้ว แต่ยังระบุไม่ได้: ":""}{attestErrorText(f.code)}</li>)}</ul>}</div>}
   {outcomes&&<div role="status" className="stack board-outcomes" aria-label="ผลการส่ง HIS"><strong>ส่ง HIS สำเร็จ {outcomes.filter(o=>o.outcome.outcome==="CertifiedReleased").length} จาก {outcomes.length} รายการ</strong>
    <ul className="timeline">{outcomes.map(({row,outcome})=><li key={outcome.versionId}><Status tone={outcomeTone(outcome)}>{outcome.outcome==="CertifiedReleased"?"ส่งแล้ว":outcome.outcome==="BLOCKED"?"ส่งไม่ได้":"ไม่สำเร็จ"}</Status> <span className="mono">{row?.ln??row?.hn??outcome.versionId}</span> · {outcomeText(outcome,reasonLabel)}</li>)}</ul></div>}
   {!error&&<div className="table-wrap" role="region" aria-label={`รายการ${TABS.find(t=>t[0]===tab)![1]}`} tabIndex={0}>
    <table className="data-table board-table"><thead><tr>
     {(tab==="READY"||tab==="ACTION")&&<th scope="col"><label className="table-check-target"><input type="checkbox" aria-label="เลือกทั้งหมดที่พร้อมในหน้านี้" disabled={!checkable.length} checked={checkable.length>0&&checkable.every(r=>selected.has(r.key))} onChange={e=>changeSelection(e.target.checked?new Set(checkable.map(r=>r.key)):new Set())}/></label></th>}
     <th scope="col">LN · HN</th><th scope="col">ที่มา</th><th scope="col">{tab==="ACTION"?"เหตุผลที่ยังส่งไม่ได้":"สถานะ"}</th><th scope="col">ไฟล์</th><th scope="col">{tab==="SENT"?"เปิด":"ดำเนินการ"}</th></tr></thead>
     <tbody>{rows.length?rows.map(r=><tr key={r.key} className={selected.has(r.key)?"selected":""}>
      {(tab==="READY"||tab==="ACTION")&&<td>{(canShowOnPatient(r)||(tab==="ACTION"&&discardable(r)))&&<label className="table-check-target"><input type="checkbox" aria-label={`เลือก ${r.ln??r.hn??r.key}`} checked={selected.has(r.key)} onChange={e=>toggle(r.key,e.target.checked)}/></label>}</td>}
      <td>{who(r)}</td><td>{source(r)}</td>
      <td>{tab==="ACTION"?<ul className="help board-reasons">{r.reasons.map(x=><li key={x.code}>{reasonLabel(x.code)}{x.fixHref&&<> · <Link href={x.fixHref}>แก้ที่นี่</Link></>}</li>)}</ul>
       :tab==="READY"?<span className="board-status">{r.hisDelivery?<HisDeliveryBadge status={r.hisDelivery}/>:<Status tone="warning">รอส่ง HIS</Status>}{r.abnormal&&<span className="badge danger">ผิดปกติ</span>}{!r.reviewed&&<span className="badge warning">ยังไม่ตรวจรับ</span>}</span>
       :<span className="board-status">{r.hisDelivery?<HisDeliveryBadge status={r.hisDelivery} showError/>:<Status tone="good">ส่งแล้ว</Status>}{r.abnormal&&<span className="badge danger">ผิดปกติ</span>}</span>}</td>
      <td>{r.pdfHref?<PdfPreviewButton src={r.pdfHref} title="เปิด PDF"/>:<span className="muted">—</span>}</td>
      <td><span className="action-bar">
       {tab==="READY"&&r.versionId&&!r.hisDelivery&&<button type="button" className="button small" disabled={sending} onClick={()=>sendRow(r)}>ส่ง HIS</button>}
       {tab==="ACTION"&&r.versionId&&r.reasons.some(x=>x.code==="UNLINKED")&&<button type="button" className="button small" onClick={()=>setDialog({kind:"pick",row:r})}>เลือกผู้ป่วย</button>}
       {tab==="ACTION"&&data?.canRevise&&!r.hisDelivery&&<button type="button" className="button small secondary" onClick={()=>setDialog({kind:"discard",row:r})}>ทิ้งรายการนี้</button>}
       {tab!=="READY"&&r.versionId&&r.hisDelivery&&!["ATTESTED","NOT_APPLICABLE"].includes(r.hisDelivery.code)&&<ResendHisButton versionId={r.versionId} onQueued={m=>{setNotice(m);void load();}} onError={setSendError}/>}
       {r.versionId&&<Link className="button small secondary" href={`/results/${r.versionId}`}>รายละเอียด</Link>}
      </span></td></tr>)
      :<tr><td colSpan={cols} className="empty-row">{loading?"กำลังโหลด…":empty}</td></tr>}</tbody></table></div>}
   {tab==="READY"&&rows.length>0&&<fieldset className="stack board-send" aria-label="ส่งผลเข้า HIS">
    {showReview&&<label className="check-label"><input type="checkbox" checked={ticks.reviewConfirmed} onChange={e=>setTicks(t=>({...t,reviewConfirmed:e.target.checked}))}/> ตรวจผลรายการที่เลือกแล้ว</label>}
    {showAbnormal&&<label className="check-label"><input type="checkbox" checked={ticks.abnormalAcknowledged} onChange={e=>setTicks(t=>({...t,abnormalAcknowledged:e.target.checked}))}/> รับทราบผลผิดปกติ (High Risk / Detected)</label>}
    <div className="bulk-bar"><span>เลือก {sel.length} รายการ</span>
     <button type="button" className="button secondary" disabled={sending} onClick={()=>changeSelection(new Set(selectable.map(r=>r.key)))}>เลือกทั้งหมดที่พร้อม</button>
     <button type="button" className="button" disabled={sending||!canSend(sel,ticks)} onClick={()=>void send(sel)}>{sending?"กำลังส่ง HIS…":`ส่งที่เลือก (${sel.length})`}</button></div>
    <div className="bulk-bar"><label className="check-label"><input type="checkbox" checked={shownTick} onChange={e=>setShownTick(e.target.checked)}/> ผลที่เลือก<strong> มีใน HIS แล้ว</strong> (ไม่ต้องส่งซ้ำ)</label>
     <button type="button" className="button secondary" disabled={showing||!shownTick||!sel.length} onClick={()=>void showOnPatient()}>{showing?"กำลังบันทึก…":`ไม่ส่ง — แสดงผลในหน้าคนไข้ (${sel.length})`}</button></div>
    <p className="help">กด “ส่ง HIS” แล้วระบบจึงรับรองผลและให้ ANC เห็นผล ก่อนหน้านั้นผลยังไม่ถูกส่งให้ ANC</p>
   </fieldset>}
   {tab==="ACTION"&&selectable.length>0&&<fieldset className="stack board-send" aria-label="แสดงผลในหน้าคนไข้ สำหรับผลที่มีใน HIS แล้ว">
    <label className="check-label"><input type="checkbox" checked={shownTick} onChange={e=>setShownTick(e.target.checked)}/> ยืนยันว่าผลที่เลือก<strong> มีใน HIS แล้ว</strong> (ระบบเดิมหรือผู้ใช้ส่งไปแล้ว)</label>
    <div className="bulk-bar"><span>เลือก {sel.length} รายการ</span>
     <button type="button" className="button secondary" disabled={showing} onClick={()=>changeSelection(new Set(selectable.map(r=>r.key)))}>เลือกทั้งหมดที่ทำได้</button>
     <button type="button" className="button" disabled={showing||!shownTick||!sel.length} onClick={()=>void showOnPatient()}>{showing?"กำลังบันทึก…":`ผูกกับคนไข้และแสดงผล (${sel.length})`}</button></div>
    <p className="help">ANC จะเห็นผลจาก PDF ฉบับจริงในหน้าคนไข้ รายการจะออกจากแท็บนี้ และ <strong>ไม่ส่ง HIS ซ้ำ</strong> · PDF ที่ยังไม่เลือกผู้ป่วยจะถูกผูกให้เมื่อ HN และเลข Lab ตรงกับ Attempt เดียวเท่านั้น ที่เหลือจะแจ้งเหตุผล แล้วกด “เลือกผู้ป่วย” และติ๊ก “มีผลใน HIS แล้ว”</p>
   </fieldset>}
   {tab==="ACTION"&&canDiscard&&checkable.length>0&&<div className="bulk-bar" role="group" aria-label="ทิ้งรายการที่เลือก">
    <span>เลือกทิ้งได้ {discardSel.length} รายการ</span>
    <button type="button" className="button secondary" onClick={()=>changeSelection(new Set(checkable.map(r=>r.key)))}>เลือกทั้งหมดในหน้านี้</button>
    <button type="button" className="button danger" disabled={!discardSel.length} onClick={()=>setDialog({kind:"bulk",rows:discardSel})}>ทิ้งที่เลือก ({discardSel.length})</button></div>}
   {data&&data.page.total>0&&<Pager label="รายการผลตรวจ" page={data.page.number} pageSize={data.page.size} total={data.page.total} totalPages={data.page.totalPages} busy={loading} onPage={n=>{clearSelection();setPage(n);}} onSize={n=>{clearSelection();setPageSize(n);setPage(1);}}/>}
   {tab==="SENT"&&sentExtras}
  </div>
  {dialog?.kind==="pick"&&<PickPatientDialog row={dialog.row} onClose={()=>setDialog(null)} onDone={m=>void done(m)}/>}
  {dialog?.kind==="discard"&&<DiscardDialog row={dialog.row} onClose={()=>setDialog(null)} onDone={m=>void done(m)}/>}
  {dialog?.kind==="bulk"&&<BulkDiscardDialog rows={dialog.rows} onClose={()=>{setDialog(null);clearSelection();}} onDone={m=>{clearSelection();void done(m);}} onChanged={()=>{clearSelection();void load();}}/>}
 </section>;
}
