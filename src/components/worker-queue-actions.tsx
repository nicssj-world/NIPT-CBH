'use client';
import {useState} from 'react';
import {useRouter} from 'next/navigation';
import {csrf} from './p2/shared';

type Item={id:string;state:string;kind?:string;reconciliation_required?:boolean};
export function WorkerQueueActions({outbox,archive}:{outbox:Item[];archive:Item[]}){
 const router=useRouter();
 const [selection,setSelection]=useState<string[]>([]);
 const [busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const list=[...outbox.map(x=>({...x,scope:'OUTBOX' as const})),...archive.map(x=>({...x,scope:'ARCHIVE' as const}))];
 const toggle=(id:string,scope:string)=>{const k=scope+':'+id;setSelection(s=>s.includes(k)?s.filter(x=>x!==k):[...s,k]);};
 async function clear(action:'CLEAR_ALL'|'CLEAR_SELECTED',scope:'ALL'|'OUTBOX'|'ARCHIVE'='ALL'){
  const selected=list.filter(x=>selection.includes(x.scope+':'+x.id));
  if(action==='CLEAR_SELECTED'&&(selected.length===0||new Set(selected.map(x=>x.scope)).size!==1)){setMessage('เลือกงานจากประเภทเดียวกันก่อน');return;}
  const target=action==='CLEAR_SELECTED'?selected[0].scope:scope;
  const count=action==='CLEAR_SELECTED'?selected.length:list.filter(x=>scope==='ALL'||scope===x.scope).length;
  if(!window.confirm(`ยืนยันเคลียร์คิว ${count} รายการ? งานกำลังทำงานหรือส่ง HIS อาจต้องตรวจสอบปลายทางก่อนยืนยันผล การเคลียร์ไม่ลบประวัติหรือข้อมูลผู้ป่วย`))return;
  setBusy(true);setMessage('');
  try{
   const response=await fetch('/api/settings/worker-queue',{method:'POST',headers:{'content-type':'application/json','x-csrf-token':csrf()},cache:'no-store',body:JSON.stringify({action,scope:target,...(action==='CLEAR_SELECTED'?{ids:selected.map(x=>x.id)}:{})})});
   const result=await response.json();
   if(!response.ok)throw Error(result.error??'ไม่สามารถเคลียร์คิวได้');
   setMessage(`เคลียร์/ซ่อนแล้ว ${result.cancelled+result.hidden} รายการ · รอยืนยัน Worker ${result.requested} · ต้องตรวจสอบการส่งปลายทาง ${result.uncertain}`);
   setSelection([]);router.refresh();
  }catch(e){setMessage(e instanceof Error?e.message:'เกิดข้อผิดพลาด');}finally{setBusy(false);}
 }
 const retryEligible=list.filter(x=>x.scope==='ARCHIVE'&&x.state==='FAILED'&&!x.reconciliation_required&&selection.includes(x.scope+':'+x.id));
 async function retrySelectedArchive(){
  if(!retryEligible.length||retryEligible.length!==selection.length){setMessage('เลือกเฉพาะ NAS PDF Archive สถานะ FAILED ที่ไม่รอตรวจสอบปลายทาง');return;}
  if(!window.confirm(`ขอให้ Worker ตรวจสอบโฟลเดอร์ NAS ก่อน Retry ${retryEligible.length} รายการ? ไม่มีการยืนยันว่าจัดเก็บสำเร็จจนกว่า Worker ตรวจจริง`))return;
  setBusy(true);setMessage('');
  try{
   const response=await fetch('/api/settings/worker-queue',{method:'POST',
    headers:{'content-type':'application/json','x-csrf-token':csrf()},cache:'no-store',
    body:JSON.stringify({action:'RETRY_SELECTED',scope:'ARCHIVE',ids:retryEligible.map(x=>x.id)})});
   const result=await response.json();
   if(!response.ok)throw Error(result.error??'ไม่สามารถขอ Retry ได้');
   setMessage(`ส่งคำขอให้ Worker ทดสอบ NAS ${result.requested} รายการ — ยังไม่ถือว่าจัดเก็บไฟล์สำเร็จ`);
   setSelection([]);router.refresh();
  }catch(e){setMessage(e instanceof Error?e.message:'เกิดข้อผิดพลาด');}
  finally{setBusy(false);}
 }
 return <section className="panel">
  <h2>จัดการ Worker Queue (Admin)</h2>
  <p className="help">เลือกแถว Outbox หรือ NAS PDF Archive เพื่อเคลียร์ งาน Dispatched ต้องตรวจสอบปลายทางและอาจยังทำงานต่อ ระบบไม่ลบหลักฐานการรับรองผลหรือการส่ง HIS</p>
  <div className="row"><button className="button secondary" disabled={busy||selection.length===0} onClick={()=>void clear('CLEAR_SELECTED')}>Clear Selected ({selection.length})</button><button className="button" disabled={busy||!list.length} onClick={()=>void clear('CLEAR_ALL')}>Clear All ({list.length} ที่แสดง)</button><button className="button secondary" disabled={busy||retryEligible.length===0||retryEligible.length!==selection.length} onClick={()=>void retrySelectedArchive()}>Retry NAS Archive ({retryEligible.length})</button></div>
  <p className="help">Clear All ครอบคลุม Outbox และ NAS PDF Archive ที่ยังไม่เคลียร์ ไม่จำกัดเฉพาะ 75 แถวที่แสดง ยังไม่ครอบคลุมคิว pg-boss โดยตรง</p>
  {message&&<p role="status">{message}</p>}
  <div className="table-wrap"><table className="data-table"><thead><tr><th>เลือก</th><th>ประเภท</th><th>สถานะปัจจุบัน</th><th>Job ID</th></tr></thead>
   <tbody>{list.map(x=><tr key={x.scope+x.id}><td><input type="checkbox" aria-label={'เลือก '+x.scope+' '+x.id} checked={selection.includes(x.scope+':'+x.id)} disabled={busy||x.reconciliation_required} onChange={()=>toggle(x.id,x.scope)}/></td><td>{x.scope==='OUTBOX'?x.kind:'NAS PDF Archive'}</td><td>{x.state}{x.reconciliation_required?' · ต้องตรวจสอบปลายทาง':''}</td><td><code>{x.id.slice(0,8)}…</code></td></tr>)}</tbody>
  </table></div>
  <p className="help">RUNNING: หากไฟล์อาจถูกส่งออกไปแล้ว ระบบบันทึกคำขอและกำหนดให้ตรวจสอบปลายทาง ไม่แสดงว่ายกเลิกการส่งสำเร็จจนมีหลักฐาน</p>
 </section>;
}
