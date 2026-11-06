"use client";
import {useState,useId} from "react";
import {useRouter} from "next/navigation";

async function post(url:string,body:unknown){
 const me=await fetch("/api/me").then(r=>r.json());
 const r=await fetch(url,{method:"POST",headers:{"x-csrf-token":me.csrf,"Content-Type":"application/json"},body:JSON.stringify(body)});
 const data=await r.json().catch(()=>({}));if(!r.ok)throw new Error(data.error??"ทำรายการไม่สำเร็จ กรุณาลองอีกครั้ง");return data;
}

export function TestConnectionButton(){
 const router=useRouter(),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
 return <div className="stack"><button className="button secondary" disabled={busy} onClick={async()=>{setBusy(true);try{await post("/api/p3/inbound/test-connection",{});setMessage("เข้าคิวทดสอบการเชื่อมต่อแล้ว ผลจะแสดงเมื่อ Worker ทำเสร็จ (อ่านอย่างเดียว ไม่เขียนไฟล์)");router.refresh();}catch(e){setMessage((e as Error).message);}finally{setBusy(false);}}}>{busy?"กำลังเข้าคิว…":"ทดสอบการเชื่อมต่อ"}</button><p aria-live="polite" className="help">{message}</p></div>;
}

export function DeepScanForm({defaultDays}:{defaultDays:number}){
 const router=useRouter(),id=useId(),[days,setDays]=useState(String(Math.min(90,defaultDays*2))),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
 return <form className="stack" onSubmit={async e=>{e.preventDefault();setBusy(true);try{await post("/api/p3/inbound/deep-scan",{lookbackDays:Number(days)});setMessage(`เข้าคิวสแกนย้อนหลัง ${days} วันแล้ว (บันทึก Audit)`);router.refresh();}catch(err){setMessage((err as Error).message);}finally{setBusy(false);}}}>
  <label htmlFor={id}>สแกนย้อนหลัง (Deep scan) จำนวนวัน</label>
  <input id={id} type="number" min={1} max={90} inputMode="numeric" value={days} onChange={e=>setDays(e.target.value)} aria-describedby={id+"-help"}/>
  <p id={id+"-help"} className="help">ใช้เมื่อสงสัยว่ามีไฟล์ตกหล่นนอกช่วงสแกนปกติ ({defaultDays} วัน) ได้สูงสุด 90 วัน</p>
  <button className="button secondary" disabled={busy}>{busy?"กำลังเข้าคิว…":"สแกนย้อนหลัง"}</button><p aria-live="polite">{message}</p>
 </form>;
}

export function ParseErrorActions({fileId,action}:{fileId:string;action:'delete'|'restore'}){
 const router=useRouter(),[confirming,setConfirming]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const submit=async()=>{
  if(busy)return;setBusy(true);setMessage('');
  try{
   await post(`/api/p3/inbound/files/${fileId}`,{action});
   const url=new URL(window.location.href);url.searchParams.set('parseErrorNotice',action==='delete'?'deleted':'restored');
   router.replace(`${url.pathname}${url.search}`,{scroll:false});
  }catch(error){setMessage((error as Error).message);}finally{setBusy(false);}
 };
 if(action==='delete'&&!confirming)return <button type="button" className="button secondary small" onClick={()=>setConfirming(true)}>ลบรายการ</button>;
 return <div className="stack">
  {action==='delete'&&<p className="help">แถวนี้จะถูกลบจากฐานข้อมูลและกู้คืนไม่ได้ ระบบจะเก็บ path/hash/LN/รุ่น พร้อมผู้ลบและเวลาไว้กันเนื้อหาเดิมกลับมา ส่วนไฟล์ต้นฉบับบน HIS จะไม่ถูกแก้ไข และ LN ยังถูกบล็อกจนกว่าไฟล์รุ่นใหม่จาก path เดิมจะอ่านผ่าน</p>}
  <div className="pager-buttons">
   <button type="button" className={`button small${action==='delete'?' danger':''}`} disabled={busy} onClick={()=>void submit()}>{busy?(action==='delete'?'กำลังลบรายการ…':'กำลังนำกลับ…'):action==='delete'?'ยืนยันลบรายการ':'นำกลับเข้ารายการ'}</button>
   {action==='delete'&&<button type="button" className="button secondary small" disabled={busy} onClick={()=>setConfirming(false)}>ยกเลิก</button>}
  </div>
  {message&&<p role="alert">{message}</p>}
 </div>;
}

const ACTION_LABEL:Record<string,string>={link_case:"เชื่อมกับเคสเดิม (ตรวจกับหน้าจอ HIS แล้ว)",keep_existing:"คงข้อมูลเดิม ไม่รับค่าจาก HIS",acknowledge:"รับทราบ (ไม่เปลี่ยนสถานะเคส)",dismiss:"ปิดรายการ (ไม่ใช่เคส NIPT ในระบบ)"};
export const actionLabel=(a:string)=>ACTION_LABEL[a]??a;

export function IssueActions({issueId,ln,allowedActions,caseId,proposal,canPropose}:{issueId:string;ln:string;allowedActions:readonly string[];caseId:string|null;proposal:{action:string;byCurrentUser:boolean}|null;canPropose:boolean}){
 const router=useRouter(),id=useId(),actions=allowedActions.filter(a=>a!=="link_case"||caseId);
 const [action,setAction]=useState(actions.includes(proposal?.action??"")?proposal!.action:actions[0]??""),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
 const submit=async()=>{if(!action||busy)return;setBusy(true);setMessage("");try{
  await post(`/api/p3/inbound/issues/${issueId}`,{op:"resolve",action,caseId:action==="link_case"?caseId:null});
  router.refresh();
 }catch(e){setMessage((e as Error).message);}finally{setBusy(false);}};
 if(!canPropose)return <p className="help">ดูได้อย่างเดียว — ไม่มีสิทธิ์ดำเนินการรายการ HIS นี้</p>;
 if(!actions.length)return <p className="help">ไม่มีคำสั่งที่ทำได้ในขอบเขตสิทธิ์และข้อมูลตัวตนของรายการนี้ กรุณาตรวจ LN กับ HIS</p>;
 return <form className="stack" aria-label={`ดำเนินการรายการ HIS LN ${ln}`} onSubmit={e=>{e.preventDefault();void submit();}}>
  {proposal&&<p className="help">มีข้อเสนอเดิมค้างอยู่: {actionLabel(proposal.action)} — เจ้าหน้าที่ที่มีสิทธิ์สามารถตรวจสอบและดำเนินการได้โดยตรง</p>}
  <label htmlFor={id+"-action"}>วิธีดำเนินการ</label>
  <select id={id+"-action"} disabled={busy} value={action} onChange={e=>setAction(e.target.value)}>
   {actions.map(a=><option key={a} value={a}>{actionLabel(a)}</option>)}
  </select>
  <p className="help">ตรวจสอบข้อมูลจาก HIS และหลักฐานประจำเคสก่อนยืนยัน ระบบบันทึกผู้ดำเนินการ วันเวลา และวิธีดำเนินการโดยอัตโนมัติ</p>
  <button className="button" disabled={busy||!action}>{busy?"กำลังดำเนินการ…":"ยืนยันการดำเนินการ"}</button>
  {message&&<p role="alert">{message}</p>}
 </form>;
}
