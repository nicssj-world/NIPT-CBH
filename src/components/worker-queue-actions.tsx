'use client';
import {useRef,useState} from 'react';
import {useRouter} from 'next/navigation';
import {csrf} from './p2/shared';
import {STATUS_LABEL,CLEARABLE,RETRYABLE,statusTone} from './worker-queue-labels';


type Row={id:string;kind:string;status:string};
export function WorkerQueueActions({scope,rows,counts}:{scope:'OUTBOX'|'ARCHIVE'|'HIS_TRANSFER';rows:Row[];counts:Record<string,number>}){
 const router=useRouter(),dialog=useRef<HTMLDialogElement>(null);
 const [selected,setSelected]=useState<string[]>([]);
 const [mode,setMode]=useState<'SELECTED'|'ALL'>('SELECTED');
 const [busy,setBusy]=useState(false),[message,setMessage]=useState<{ok:boolean;text:string}|null>(null);
 const canClear=scope!=='HIS_TRANSFER';   // a HIS transmission is never cleared from here
 const clearable=canClear?rows.filter(r=>CLEARABLE.includes(r.status)):[];
 const retryOk=(r:Row)=>RETRYABLE[scope].includes(r.status);
 const retryable=rows.filter(r=>retryOk(r)&&selected.includes(r.id));
 const allCount=canClear?CLEARABLE.reduce((n,s)=>n+(counts[s]??0),0):0;
 const toggle=(id:string)=>setSelected(s=>s.includes(id)?s.filter(x=>x!==id):[...s,id]);
 const open=(m:'SELECTED'|'ALL')=>{setMode(m);dialog.current?.showModal();};
 async function post(body:unknown,success:(r:Record<string,number>)=>string){
  setBusy(true);setMessage(null);
  try{
   const response=await fetch('/api/settings/worker-queue',{method:'POST',headers:{'content-type':'application/json','x-csrf-token':csrf()},cache:'no-store',body:JSON.stringify(body)});
   const result=await response.json();
   if(!response.ok)throw Error(result.error??'ดำเนินการไม่สำเร็จ');
   setMessage({ok:true,text:success(result)});setSelected([]);router.refresh();
  }catch(e){setMessage({ok:false,text:e instanceof Error?e.message:'ดำเนินการไม่สำเร็จ'});}
  finally{setBusy(false);dialog.current?.close();}
 }
 const confirm=()=>post(mode==='ALL'?{action:'CLEAR_ALL',scope}:{action:'CLEAR_SELECTED',scope,ids:selected},
  r=>`บันทึกคำขอเคลียร์ ${r.requested} รายการ${r.alreadyRequested?` (มีคำขออยู่แล้ว ${r.alreadyRequested})`:''} — Worker จะตรวจแต่ละรายการและบันทึกผล ยังไม่ถือว่ายกเลิกสำเร็จจนกว่าสถานะจะเปลี่ยน`);
 const retry=()=>post({action:'RETRY_SELECTED',scope,ids:retryable.map(r=>r.id)},
  r=>scope==='ARCHIVE'?`ขอให้ Worker ทดสอบ NAS ก่อน Retry ${r.requested} รายการ — ยังไม่ถือว่าจัดเก็บสำเร็จจนกว่า Worker ตรวจจริง`
   :`บันทึกคำขอ Retry ${r.requested} รายการ${r.alreadyRequested?` (มีคำขออยู่แล้ว ${r.alreadyRequested})`:''} — Worker จะตรวจก่อน และปฏิเสธหากอาจมีการส่งออกไปแล้ว`);
 const count=mode==='ALL'?allCount:selected.length;
 return <>
  <div className="row" role="toolbar" aria-label="จัดการคิว">
   {canClear&&<button type="button" className="button secondary" disabled={busy||selected.length===0} onClick={()=>open('SELECTED')}>ขอเคลียร์ที่เลือก ({selected.length})</button>}
   {canClear&&<button type="button" className="button secondary" disabled={busy||allCount===0} onClick={()=>open('ALL')}>ขอเคลียร์ทั้งหมดในหมวดนี้ ({allCount})</button>}
   <button type="button" className="button secondary" disabled={busy||retryable.length===0||retryable.length!==selected.length} onClick={()=>void retry()}>{scope==='ARCHIVE'?'ตรวจ NAS แล้ว Retry':'Retry'} ({retryable.length})</button>
  </div>
  {message&&<p role="status" className={message.ok?'notice success':'notice'}>{message.text}</p>}
  <div className="table-wrap"><table className="table data-table">
   <caption className="sr-only">รายการงานในคิว</caption>
   <thead><tr><th scope="col"><span className="sr-only">เลือก</span></th><th scope="col">ประเภท</th><th scope="col">สถานะ</th><th scope="col">รหัสงาน</th></tr></thead>
   <tbody>{rows.length===0?<tr><td colSpan={4} className="muted">ไม่มีรายการตามตัวกรองนี้</td></tr>:rows.map(r=>{
    const can=(canClear&&CLEARABLE.includes(r.status))||retryOk(r);
    return <tr key={r.id}>
     <td><input type="checkbox" aria-label={`เลือกงาน ${r.id.slice(0,8)}`} disabled={busy||!can} checked={selected.includes(r.id)} onChange={()=>toggle(r.id)}/></td>
     <td>{r.kind}</td>
     <td><span className={'badge '+statusTone(r.status)}>{STATUS_LABEL[r.status]??r.status}</span></td>
     <td><code>{r.id.slice(0,8)}…</code></td></tr>;})}</tbody>
  </table></div>
  <dialog ref={dialog} aria-labelledby="queue-clear-title" onClose={()=>setBusy(false)}>
   <div className="dialog-header"><h2 id="queue-clear-title">ยืนยันขอเคลียร์ {count} รายการ</h2></div>
   <p>ระบบบันทึกคำขอเท่านั้น Worker จะตรวจแต่ละรายการ:</p>
   <ul>
    <li>งานที่ยังไม่เริ่ม → ยกเลิก</li>
    <li>งานที่ส่งเข้าคิวหรือกำลังทำ → ยกเลิกเฉพาะเมื่อมีหลักฐานว่ายังไม่เริ่ม ไม่เช่นนั้นเป็น “ต้องตรวจสอบปลายทาง”</li>
    <li>งานที่เสร็จแล้ว ใบรับ HIS ผลตรวจ และไฟล์ PDF ไม่ถูกแก้หรือลบ</li>
   </ul>
   <div className="dialog-actions">
    <button type="button" className="button" disabled={busy||count===0} onClick={()=>void confirm()}>ยืนยันขอเคลียร์</button>
    <button type="button" className="button secondary" onClick={()=>dialog.current?.close()}>ยกเลิก</button>
   </div>
  </dialog>
  {clearable.length===0&&rows.length>0&&<p className="help">ไม่มีรายการในหน้านี้ที่ขอเคลียร์ได้</p>}
 </>;
}
