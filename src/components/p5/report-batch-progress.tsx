'use client';
import Link from 'next/link';
import {useCallback,useEffect,useState,useEffectEvent} from 'react';
import {labApi,failureText,bkk} from '../p4/lab-api';

type Outcome={rowId:string;outcome:'FINAL'|'HOLD'|'ERROR';code?:string;details?:{failed?:string[];pending?:string[]};holds?:{code:string}[];versionId?:string;release?:string;text?:string};
export type ReportBatch={batchId:string;state:string;createdAt:string;total:number;completed:number;items:{rowId:string;state:string;outcome?:Outcome}[]};

// Report batches (Owner 2026-11-11): the poll lives in the page, not in a dialog, so the lists and the board refresh when the batch finishes even if the
// person closed the dialog and went on working. One run is shown as a progress bar with its percentage that ends at "Done".
/** Polls one batch every 2 s until it is COMPLETED, then calls onComplete once. */
export function useReportBatch(batchId:string,onComplete?:()=>void){
 const [batch,setBatch]=useState<ReportBatch|null>(null),[error,setError]=useState(''),[retry,setRetry]=useState(0);
 const completed=useEffectEvent(()=>onComplete?.());
 useEffect(()=>{let active=true,timer:ReturnType<typeof setTimeout>,notified=false;
  const read=async()=>{try{const next=await labApi<ReportBatch>(`/api/task3/batches/${batchId}`);if(!active)return;setBatch(next);setError('');
   if(next.state==='COMPLETED'){if(!notified){notified=true;completed();}}else timer=setTimeout(read,2000);
  }catch(e){if(active){setError(failureText(e));timer=setTimeout(read,5000);}}};void read();return()=>{active=false;clearTimeout(timer);};
 },[batchId,retry]);
 return {batch,error,retry:()=>setRetry(n=>n+1)};
}
export const batchPercent=(b:{state:string;total:number;completed:number})=>b.state==='COMPLETED'?100:b.total>0?Math.min(99,Math.floor(100*b.completed/b.total)):0;
const tally=(b:ReportBatch)=>({final:b.items.filter(i=>i.state==='FINAL').length,hold:b.items.filter(i=>i.state==='HOLD').length,error:b.items.filter(i=>i.state==='ERROR').length});

/** The bar: a native <progress> (reads correctly to a screen reader) with the percentage beside it; 100% reads "Done". */
export function BatchProgressBar({batch}:{batch:ReportBatch}){
 const pct=batchPercent(batch),done=batch.state==='COMPLETED';
 return <div className={`batch-bar${done?' done':''}`}>
  <progress value={pct} max={100} aria-label={`ความคืบหน้าการออกรายงาน ${pct}%`}/>
  <span className="batch-bar-text" aria-hidden="true">{done?'Done':`${pct}%`}</span>
 </div>;
}
const itemState=(item:ReportBatch['items'][number])=>item.outcome?.release==='PendingCertification'?'ออกรายงานแล้ว · พร้อมส่ง HIS — ยังไม่ส่งผลให้ ANC':item.state==='FINAL'?'สร้าง PDF แล้ว · ยังไม่ยืนยันผล':item.state==='HOLD'?'ระงับ':item.state==='ERROR'?'ไม่สำเร็จ':item.state==='QUEUED'?'รอดำเนินการ':'กำลังดำเนินการ';
/** Every item of a batch with its outcome, and the ZIP of the PDFs made so far. */
export function ReportBatchItems({batch}:{batch:ReportBatch}){
 return <div className="stack">
  <ul className="timeline">{batch.items.map(item=><li key={item.rowId}>{item.outcome?.versionId?<Link href={`/results/${item.outcome.versionId}`}>เปิดผลตรวจ</Link>:<span>{item.state==='QUEUED'?'รอดำเนินการ':item.state==='HOLD'||item.state==='ERROR'?'รายการที่ยังออกรายงานไม่ได้':'กำลังดำเนินการ'}</span>}
   {' · '}{itemState(item)}
   {item.outcome?.text&&<span className="notice-text" role="alert"> · {item.outcome.text}</span>}{item.outcome?.code&&<span className="help"> · {item.outcome.code}</span>}{item.outcome?.details?.failed?.length||item.outcome?.details?.pending?.length?<span className="help"> · ข้อที่ไม่ผ่าน: {[...(item.outcome.details.failed??[]),...(item.outcome.details.pending??[])].join(', ')}</span>:null}{item.outcome?.holds?.length?<span className="help"> · {item.outcome.holds.map(h=>h.code).join(', ')}</span>:null}</li>)}</ul>
  {!!batch.items.some(i=>i.state==='FINAL')&&<a className="button secondary" href={`/api/task3/batches/${batch.batchId}/zip`}>ดาวน์โหลด PDF ทั้งชุด (ZIP)</a>}
 </div>;
}

/** The run that is being made now (or has just finished), shown at the top of the HALOS panel. */
export function ReportRunCard({batchId,onComplete,onClose,onViewResults}:{batchId:string;onComplete?:()=>void;onClose:()=>void;onViewResults:()=>void}){
 const {batch,error,retry}=useReportBatch(batchId,onComplete);
 const done=batch?.state==='COMPLETED',t=batch?tally(batch):{final:0,hold:0,error:0};
 return <section className={`report-run-card${done?' done':''}`} aria-label="การออกรายงาน" aria-live="polite">
  <div className="report-run-head"><strong>{done?'ออกรายงานเสร็จแล้ว':'กำลังออกรายงาน'}{batch?` · ${batch.total} ราย`:''}</strong>
   {done&&<button type="button" className="button small secondary" onClick={onClose}>ปิด</button>}</div>
  {batch?<BatchProgressBar batch={batch}/>:<p className="help" role="status">กำลังโหลดงานออกรายงาน…</p>}
  {batch&&<p className="help" role="status">{done
   ?`ออกรายงานแล้ว ${t.final} ราย${t.hold?` · ระงับ ${t.hold} ราย`:''}${t.error?` · ไม่สำเร็จ ${t.error} ราย`:''} — ผลที่ออกแล้วอยู่ที่ “รอส่ง HIS” ยังไม่ส่งให้ ANC จนกว่าจะกด “ส่ง HIS”`
   :`ดำเนินการแล้ว ${batch.completed} จาก ${batch.total} ราย — ปิดหน้านี้หรือทำงานอื่นต่อได้ ระบบทำต่อในคิว`}</p>}
  {error&&<p role="alert" className="notice">{error} <button type="button" className="button small secondary" onClick={retry}>ลองใหม่</button></p>}
  {done&&<div className="action-bar"><button type="button" className="button small" onClick={onViewResults}>ดูในรายการ “รอส่ง HIS”</button></div>}
  {batch&&<details><summary>รายละเอียดแต่ละรายการ ({batch.items.length})</summary><ReportBatchItems batch={batch}/></details>}
 </section>;
}

/** My report runs, newest first. A run opens in place under its own row. `refreshKey` reloads the list when something changed elsewhere on the page. */
export function RecentReportBatches({refreshKey=0,activeBatchId=''}:{refreshKey?:number;activeBatchId?:string}){
 const [items,setItems]=useState<ReportBatch[]>([]),[open,setOpen]=useState(''),[all,setAll]=useState(false),[error,setError]=useState(''),[loaded,setLoaded]=useState(false);
 const load=useCallback(async()=>{try{setItems((await labApi<{items:ReportBatch[]}>('/api/task3/batches')).items);setError('');}catch(e){setError(failureText(e));}finally{setLoaded(true);}},[]);
 useEffect(()=>{void Promise.resolve().then(load);},[load,refreshKey]);
 const shown=all?items:items.slice(0,5);
 return <section className="halos-history" aria-labelledby="recent-runs-h">
  <h3 id="recent-runs-h">งานออกรายงานของฉัน</h3>
  {error&&<p role="alert" className="notice">{error} <button type="button" className="button small secondary" onClick={()=>void load()}>ลองใหม่</button></p>}
  {loaded&&!items.length&&!error&&<p className="help">ยังไม่มีงาน — เมื่อยืนยันออกรายงาน งานและผลของแต่ละรายการจะอยู่ที่นี่</p>}
  <ul className="halos-runs">{shown.map(item=>{const isOpen=open===item.batchId,done=item.state==='COMPLETED';
   return <li key={item.batchId}>
    <button type="button" className="halos-run-row" aria-expanded={isOpen} aria-controls={`run-${item.batchId}`} onClick={()=>setOpen(isOpen?'':item.batchId)}>
     <span className="mono">{bkk(item.createdAt)}</span><span>{item.total} ราย</span>
     <span className={`status ${done?'good':'info'}`}>{done?'เสร็จสิ้น':`กำลังทำ ${batchPercent(item)}%`}</span>
     <span className="halos-run-chevron" aria-hidden="true">{isOpen?'▾':'▸'}</span></button>
    {isOpen&&<div id={`run-${item.batchId}`} className="halos-run-detail">{item.batchId===activeBatchId?<p className="help">กำลังดูที่แถบความคืบหน้าด้านบน</p>:<RunDetail batchId={item.batchId} onComplete={load}/>}</div>}
   </li>;})}</ul>
  {items.length>5&&<button type="button" className="button small secondary" onClick={()=>setAll(v=>!v)}>{all?'แสดงเฉพาะล่าสุด':`แสดงทั้งหมด (${items.length})`}</button>}
 </section>;
}
function RunDetail({batchId,onComplete}:{batchId:string;onComplete?:()=>void}){
 const {batch,error,retry}=useReportBatch(batchId,onComplete);
 return <>{error&&<p role="alert" className="notice">{error} <button type="button" className="button small secondary" onClick={retry}>ลองใหม่</button></p>}
  {!batch&&!error&&<p className="help" role="status">กำลังโหลด…</p>}{batch&&<><BatchProgressBar batch={batch}/><ReportBatchItems batch={batch}/></>}</>;
}
