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

const ACTION_LABEL:Record<string,string>={link_case:"เชื่อมกับเคสเดิม (ตรวจกับหน้าจอ HIS แล้ว)",keep_existing:"คงข้อมูลเดิม ไม่รับค่าจาก HIS",acknowledge:"รับทราบ (ไม่เปลี่ยนสถานะเคส)",dismiss:"ปิดรายการ (ไม่ใช่เคส NIPT ในระบบ)"};
export const actionLabel=(a:string)=>ACTION_LABEL[a]??a;

export function IssueActions({issueId,ln,allowedActions,caseId,proposal,canPropose,canApprove}:{issueId:string;ln:string;allowedActions:readonly string[];caseId:string|null;proposal:{action:string;byCurrentUser:boolean}|null;canPropose:boolean;canApprove:boolean}){
 const router=useRouter(),id=useId(),actions=allowedActions.filter(a=>a!=="link_case"||caseId);
 const [action,setAction]=useState(actions[0]??""),[reason,setReason]=useState(""),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
 const submit=async(body:Record<string,unknown>)=>{setBusy(true);setMessage("");try{await post(`/api/p3/inbound/issues/${issueId}`,body);setReason("");router.refresh();}catch(e){setMessage((e as Error).message);}finally{setBusy(false);}};
 const reasonField=<><label htmlFor={id+"-reason"}>เหตุผลและสิ่งที่ตรวจ (อย่างน้อย 8 ตัวอักษร)</label><textarea id={id+"-reason"} rows={2} value={reason} onChange={e=>setReason(e.target.value)} required minLength={8} maxLength={500}/></>;
 if(!proposal&&canPropose&&actions.length)return <form className="stack" aria-label={`เสนอการแก้ไข LN ${ln}`} onSubmit={e=>{e.preventDefault();void submit({op:"propose",action,caseId:action==="link_case"?caseId:null,reason});}}>
  <label htmlFor={id+"-action"}>การแก้ไขที่เสนอ</label><select id={id+"-action"} value={action} onChange={e=>setAction(e.target.value)}>{actions.map(a=><option key={a} value={a}>{actionLabel(a)}</option>)}</select>
  {reasonField}<button className="button" disabled={busy||reason.trim().length<8}>{busy?"กำลังบันทึก…":"เสนอให้ผู้รับรองตัดสิน"}</button><p role="status" aria-live="polite">{message}</p></form>;
 if(proposal&&canApprove&&!proposal.byCurrentUser)return <form className="stack" aria-label={`ตัดสินข้อเสนอของ LN ${ln}`} onSubmit={e=>e.preventDefault()}>
  <p>ข้อเสนอ: <strong>{actionLabel(proposal.action)}</strong></p>{reasonField}
  <div className="row"><button type="button" className="button" disabled={busy||reason.trim().length<8} onClick={()=>void submit({op:"decide",decision:"APPROVED",reason})}>อนุมัติ (คนที่สอง)</button><button type="button" className="button secondary" disabled={busy||reason.trim().length<8} onClick={()=>void submit({op:"decide",decision:"REJECTED",reason})}>ไม่อนุมัติ ส่งกลับ</button></div>
  <p role="status" aria-live="polite">{message}</p></form>;
 if(proposal)return <p className="help">{proposal.byCurrentUser?"คุณเป็นผู้เสนอ — รอผู้รับรองอีกคนตัดสิน":`รอผู้รับรองตัดสินข้อเสนอ: ${actionLabel(proposal.action)}`}</p>;
 return <p className="help">{actions.length?"ดูได้อย่างเดียว — ผู้ที่มีสิทธิ์เสนอคือเจ้าหน้าที่ Lab":"ต้องแก้ผ่านการลงทะเบียน (P2) — ยังไม่เปิดในระยะนี้"}</p>;
}
