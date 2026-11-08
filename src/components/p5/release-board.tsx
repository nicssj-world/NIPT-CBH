"use client";
import Link from "next/link";
import {useCallback,useEffect,useMemo,useRef,useState,type ReactNode} from "react";
import {labApi,failureText} from "../p4/lab-api";
import {Pager} from "../shared/pager";
import {PdfPreviewButton} from "../shared/pdf-preview";
import type {HisDeliveryStatus} from "../../../packages/results/his-status";
import {HisDeliveryBadge} from "./his-delivery-badge";
import {HOLD_TEXT} from "./native-reports";
import {BOARD_REASON_TEXT,reasonText} from "./labels";
import {batchSignature,canSend,needsAbnormalTick,needsReviewTick,outcomeText,outcomeTone,selectedRows,sendTicks,type BoardTab,type SendOutcome} from "./release-board-logic";
import {DiscardDialog,PickPatientDialog} from "./release-board-dialogs";

// One results board: Action needed / Waiting for HIS / Sent. The server (releaseQueue `board`) decides which tab a row belongs to and why;
// this component only lists, selects and calls the existing actions. A result is never shown as visible to ANC before "ส่ง HIS" succeeded.
export type BoardRow={key:string;source:"HALOS"|"READYGEN";versionId:string|null;halosRowId:string|null;rowVersion:number|null;ln:string|null;hn:string|null;lnHalos:string|null;sampleId:string|null;template:string|null;abnormal:boolean;reviewed:boolean;reasons:{code:string;fixHref?:string}[];hisDelivery?:HisDeliveryStatus;pdfHref:string|null};
type Board={rows:BoardRow[];counts:Record<BoardTab,number>;canRevise:boolean;truncated:boolean;page:{number:number;size:number;total:number;totalPages:number;hasNext:boolean}};
const TABS:[BoardTab,string][]=[["ACTION","ต้องจัดการ"],["READY","รอส่ง HIS"],["SENT","ส่งแล้ว"]];
const HELP:Record<BoardTab,string>={ACTION:"รายการที่ยังส่ง HIS ไม่ได้ — แก้ตามเหตุผลที่แสดง เลือกผู้ป่วย หรือทิ้งรายการ",READY:"ผลที่นำเข้าหรือออกรายงานแล้ว ยังไม่ถูกส่ง — ANC จะเห็นผลหลังกด “ส่ง HIS” สำเร็จเท่านั้น",SENT:"ผลที่ส่ง HIS แล้ว เรียงใหม่สุดก่อน"};
const TEMPLATE_TEXT:Record<string,string>={SINGLETON:"ครรภ์เดี่ยว",TWIN:"ครรภ์แฝด"};
export const reasonLabel=(code:string)=>HOLD_TEXT[code]??BOARD_REASON_TEXT[code]??reasonText(code);
const Status=({tone,children}:{tone?:string;children:ReactNode})=><span className={`status ${tone??""}`}>{children}</span>;
const who=(r:BoardRow)=><><span className="mono">{r.ln??"—"}</span>{r.lnHalos&&<span className="help"> · LN Halos {r.lnHalos}</span>}<br/><span className="mono">{r.hn??"—"}</span></>;
const source=(r:BoardRow)=><>{r.source==="HALOS"?"HALOS":"ReadyGen"}{r.template&&<div className="help">{TEMPLATE_TEXT[r.template]??r.template}</div>}{r.sampleId&&<div className="help mono">{r.sampleId}</div>}</>;

export function ReleaseBoard({tab,onTab,refreshKey=0,sentExtras,scope="PATIENT"}:{tab:BoardTab;onTab:(t:BoardTab)=>void;refreshKey?:number;sentExtras?:ReactNode;scope?:"PATIENT"|"EQA"}){
 const [q,setQ]=useState(""),[term,setTerm]=useState(""),[page,setPage]=useState(1),[pageSize,setPageSize]=useState(50);
 const [data,setData]=useState<Board|null>(null),[counts,setCounts]=useState<Board["counts"]|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState(""),[notice,setNotice]=useState("");
 const [selected,setSelected]=useState<Set<string>>(new Set()),[ticks,setTicks]=useState({reviewConfirmed:false,abnormalAcknowledged:false});
 const [sending,setSending]=useState(false),[outcomes,setOutcomes]=useState<{row:BoardRow;outcome:SendOutcome}[]|null>(null),[sendError,setSendError]=useState("");
 const [dialog,setDialog]=useState<{kind:"pick"|"discard";row:BoardRow}|null>(null);
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
 const selectable=useMemo(()=>rows.filter(r=>r.versionId),[rows]);
 const toggle=(key:string,on:boolean)=>{const n=new Set(selected);if(on)n.add(key);else n.delete(key);changeSelection(n);};
 const changeTab=(t:BoardTab)=>{clearSelection();setOutcomes(null);setSendError("");setNotice("");setPage(1);onTab(t);};

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
 const done=async(message:string)=>{setDialog(null);setNotice(message);await load();};

 const empty=q?"ไม่พบรายการที่ตรงกับคำค้น":tab==="ACTION"?"ไม่มีรายการที่ต้องจัดการ":tab==="READY"?"ไม่มีผลที่รอส่ง HIS":"ยังไม่มีผลที่ส่งแล้ว";
 const cols=tab==="READY"?7:6;
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
   {outcomes&&<div className="stack board-outcomes" role="status" aria-label="ผลการส่ง HIS"><strong>ส่ง HIS สำเร็จ {outcomes.filter(o=>o.outcome.outcome==="CertifiedReleased").length} จาก {outcomes.length} รายการ</strong>
    <ul className="timeline">{outcomes.map(({row,outcome})=><li key={outcome.versionId}><Status tone={outcomeTone(outcome)}>{outcome.outcome==="CertifiedReleased"?"ส่งแล้ว":outcome.outcome==="BLOCKED"?"ส่งไม่ได้":"ไม่สำเร็จ"}</Status> <span className="mono">{row?.ln??row?.hn??outcome.versionId}</span> · {outcomeText(outcome,reasonLabel)}</li>)}</ul></div>}
   {!error&&<div className="table-wrap" role="region" aria-label={`รายการ${TABS.find(t=>t[0]===tab)![1]}`} tabIndex={0}>
    <table className="data-table board-table"><thead><tr>
     {tab==="READY"&&<th scope="col"><label className="table-check-target"><input type="checkbox" aria-label="เลือกทั้งหมดที่พร้อมในหน้านี้" disabled={!selectable.length} checked={selectable.length>0&&selectable.every(r=>selected.has(r.key))} onChange={e=>changeSelection(e.target.checked?new Set(selectable.map(r=>r.key)):new Set())}/></label></th>}
     <th scope="col">LN · HN</th><th scope="col">ที่มา</th><th scope="col">{tab==="ACTION"?"เหตุผลที่ยังส่งไม่ได้":"สถานะ"}</th><th scope="col">ไฟล์</th><th scope="col">{tab==="SENT"?"เปิด":"ดำเนินการ"}</th></tr></thead>
     <tbody>{rows.length?rows.map(r=><tr key={r.key} className={selected.has(r.key)?"selected":""}>
      {tab==="READY"&&<td><label className="table-check-target"><input type="checkbox" aria-label={`เลือก ${r.ln??r.hn??r.key}`} checked={selected.has(r.key)} onChange={e=>toggle(r.key,e.target.checked)}/></label></td>}
      <td>{who(r)}</td><td>{source(r)}</td>
      <td>{tab==="ACTION"?<ul className="help board-reasons">{r.reasons.map(x=><li key={x.code}>{reasonLabel(x.code)}{x.fixHref&&<> · <Link href={x.fixHref}>แก้ที่นี่</Link></>}</li>)}</ul>
       :tab==="READY"?<><Status tone="warning">รอส่ง HIS</Status>{r.abnormal&&<span className="badge danger">ผิดปกติ</span>}{!r.reviewed&&<span className="badge warning">ยังไม่ตรวจรับ</span>}</>
       :<><Status tone="good">ส่งแล้ว</Status><HisDeliveryBadge status={r.hisDelivery}/>{r.abnormal&&<span className="badge danger">ผิดปกติ</span>}</>}</td>
      <td>{r.pdfHref?<PdfPreviewButton src={r.pdfHref} title="เปิด PDF"/>:<span className="muted">—</span>}</td>
      <td><span className="action-bar">
       {tab==="READY"&&r.versionId&&<button type="button" className="button small" disabled={sending} onClick={()=>sendRow(r)}>ส่ง HIS</button>}
       {tab==="ACTION"&&r.versionId&&r.reasons.some(x=>x.code==="UNLINKED")&&<button type="button" className="button small" onClick={()=>setDialog({kind:"pick",row:r})}>เลือกผู้ป่วย</button>}
       {tab==="ACTION"&&data?.canRevise&&<button type="button" className="button small secondary" onClick={()=>setDialog({kind:"discard",row:r})}>ทิ้งรายการนี้</button>}
       {r.versionId&&<Link className="button small secondary" href={`/results/${r.versionId}`}>รายละเอียด</Link>}
      </span></td></tr>)
      :<tr><td colSpan={cols} className="empty-row">{loading?"กำลังโหลด…":empty}</td></tr>}</tbody></table></div>}
   {tab==="READY"&&rows.length>0&&<fieldset className="stack board-send" aria-label="ส่งผลเข้า HIS">
    {showReview&&<label className="check-label"><input type="checkbox" checked={ticks.reviewConfirmed} onChange={e=>setTicks(t=>({...t,reviewConfirmed:e.target.checked}))}/> ตรวจผลรายการที่เลือกแล้ว</label>}
    {showAbnormal&&<label className="check-label"><input type="checkbox" checked={ticks.abnormalAcknowledged} onChange={e=>setTicks(t=>({...t,abnormalAcknowledged:e.target.checked}))}/> รับทราบผลผิดปกติ (High Risk / Detected)</label>}
    <div className="bulk-bar"><span>เลือก {sel.length} รายการ</span>
     <button type="button" className="button secondary" disabled={sending} onClick={()=>changeSelection(new Set(selectable.map(r=>r.key)))}>เลือกทั้งหมดที่พร้อม</button>
     <button type="button" className="button" disabled={sending||!canSend(sel,ticks)} onClick={()=>void send(sel)}>{sending?"กำลังส่ง HIS…":`ส่งที่เลือก (${sel.length})`}</button></div>
    <p className="help">กด “ส่ง HIS” แล้วระบบจึงรับรองผลและให้ ANC เห็นผล ก่อนหน้านั้นผลยังไม่ถูกส่งให้ ANC</p>
   </fieldset>}
   {data&&data.page.total>0&&<Pager label="รายการผลตรวจ" page={data.page.number} pageSize={data.page.size} total={data.page.total} totalPages={data.page.totalPages} busy={loading} onPage={n=>{clearSelection();setPage(n);}} onSize={n=>{clearSelection();setPageSize(n);setPage(1);}}/>}
   {tab==="SENT"&&sentExtras}
  </div>
  {dialog?.kind==="pick"&&<PickPatientDialog row={dialog.row} onClose={()=>setDialog(null)} onDone={m=>void done(m)}/>}
  {dialog?.kind==="discard"&&<DiscardDialog row={dialog.row} onClose={()=>setDialog(null)} onDone={m=>void done(m)}/>}
 </section>;
}
