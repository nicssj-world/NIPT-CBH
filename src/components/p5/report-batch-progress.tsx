'use client';
import Link from 'next/link';
import {useCallback,useEffect,useState,useEffectEvent} from 'react';
import {labApi,failureText,bkk} from '../p4/lab-api';

type Outcome={rowId:string;outcome:'FINAL'|'HOLD'|'ERROR';code?:string;holds?:{code:string}[];versionId?:string;release?:string};
export type ReportBatch={batchId:string;state:string;createdAt:string;total:number;completed:number;items:{rowId:string;state:string;outcome?:Outcome}[]};
export function ReportBatchProgress({batchId,onComplete}:{batchId:string;onComplete?:()=>void}){
 const [batch,setBatch]=useState<ReportBatch|null>(null),[error,setError]=useState(''),[retry,setRetry]=useState(0);
 const completed=useEffectEvent(()=>onComplete?.());
 useEffect(()=>{let active=true,timer:ReturnType<typeof setTimeout>;let notified=false;
  const read=async()=>{try{const next=await labApi<ReportBatch>(`/api/task3/batches/${batchId}`);if(!active)return;setBatch(next);setError('');
   if(next.state==='COMPLETED'){if(!notified){notified=true;completed();}}else timer=setTimeout(read,2000);
  }catch(e){if(active){setError(failureText(e));timer=setTimeout(read,5000);}}};void read();return()=>{active=false;clearTimeout(timer);};
 },[batchId,retry]);
 return <section className="result-batch-progress" aria-label="ความคืบหน้าการออกรายงาน">
  <p role="status">{batch?`${batch.state==='COMPLETED'?'ดำเนินการครบแล้ว':'กำลังออกรายงาน'} · ${batch.completed}/${batch.total} รายการ`:'กำลังโหลดงานออกรายงาน…'}</p>
  {batch&&<progress value={batch.completed} max={batch.total} aria-label="รายการที่ดำเนินการแล้ว"/>}
  {error&&<p role="alert">{error} <button type="button" className="button small secondary" onClick={()=>setRetry(n=>n+1)}>ลองใหม่</button></p>}
  {batch?.state!=='COMPLETED'&&<p className="help">ปิดหน้านี้ได้ ระบบทำต่อในคิว เปิดติดตามได้ที่ “งานออกรายงานของฉัน”</p>}
  {batch&&<ul className="timeline">{batch.items.map(item=><li key={item.rowId}>{item.outcome?.versionId?<Link href={`/results/${item.outcome.versionId}`}>เปิดผลตรวจ</Link>:<span>{item.state==='QUEUED'?'รอดำเนินการ':'รายการที่ยังออกรายงานไม่ได้'}</span>}
   {' · '}{item.outcome?.release==='CertifiedReleased'?'ออกรายงานและผูกผลแล้ว':item.state==='FINAL'?'สร้าง PDF แล้ว · ยังไม่ยืนยันผล':item.state==='HOLD'?'ระงับ':item.state==='ERROR'?'ไม่สำเร็จ':'กำลังดำเนินการ'}
   {item.outcome?.code&&<span className="help"> · {item.outcome.code}</span>}{item.outcome?.holds?.length? <span className="help"> · {item.outcome.holds.map(h=>h.code).join(', ')}</span>:null}</li>)}</ul>}
  {!!batch?.items.some(i=>i.state==='FINAL')&&<a className="button secondary" href={`/api/task3/batches/${batch.batchId}/zip`}>ดาวน์โหลด PDF ทั้งชุด (ZIP)</a>}
 </section>;
}
export function RecentReportBatches(){
 const [items,setItems]=useState<ReportBatch[]>([]),[selected,setSelected]=useState(''),[error,setError]=useState('');
 const load=useCallback(async()=>{try{setItems((await labApi<{items:ReportBatch[]}>('/api/task3/batches')).items);setError('');}catch(e){setError(failureText(e));}},[]);
 useEffect(()=>{void Promise.resolve().then(load);},[load]);
 return <details className="result-recent-jobs" onToggle={e=>{if(e.currentTarget.open)void load();}}><summary>งานออกรายงานของฉัน</summary>
  {error&&<p role="alert">{error}</p>}{!items.length&&!error&&<p className="help">เมื่อยืนยันออกรายงาน งานและความคืบหน้าจะอยู่ที่นี่</p>}
  <ul className="timeline">{items.map(item=><li key={item.batchId}><button type="button" className="button secondary" onClick={()=>setSelected(item.batchId)}>{bkk(item.createdAt)} · {item.completed}/{item.total} รายการ</button></li>)}</ul>
  {selected&&<ReportBatchProgress batchId={selected} onComplete={load}/>}
 </details>;
}
