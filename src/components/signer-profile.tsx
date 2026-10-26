"use client";
import {useCallback,useEffect,useRef,useState} from "react";
import {labApi,failureText,bkk} from "./p4/lab-api";
import {csrf} from "./p2/shared";
import {FileDropInput} from "./shared/file-drop-input";

/** OWNER-LAB-054: licence number and report signature live with the user — entered in the user's own Profile, checked by an
 *  administrator in Users (never by the same person; DB-enforced). No separate signer enrollment page. The rules that decide
 *  who may sign Reported by / Approved by are unchanged (packages/readygen/signers.ts). */
type Profile={id:string;userId:string;displayName:string;version:number;legalName:string;license:string;submittedAt:string;state:"VERIFIED"|"REVOKED"|null;current:boolean};
type Overview={canManage:boolean;profiles:Profile[]};
const stateText=(p:Profile)=>p.state==="REVOKED"?"เพิกถอนแล้ว":p.state==="VERIFIED"?(p.current?"ใช้งานได้":"มีฉบับใหม่กว่า"):"รอผู้ดูแลระบบตรวจ";
const tone=(p:Profile)=>p.current?"good":p.state==="REVOKED"?"bad":"warning";

export function SignerProfile({targetUserId,self,onChanged}:{targetUserId:string;self:boolean;onChanged?:()=>void}){
 const [d,setD]=useState<Overview|null>(null),[error,setError]=useState(""),[notice,setNotice]=useState(""),[busy,setBusy]=useState(false);
 const [form,setForm]=useState({legalName:"",license:""}),[note,setNote]=useState("ตรวจตัวตน เลขใบอนุญาต และลายเซ็นกับทะเบียนบุคลากรแล้ว"),file=useRef<HTMLInputElement>(null);
 const load=useCallback(async()=>{try{setD(await labApi<Overview>("/api/task3/signers"));setError("");}catch(e){setError(failureText(e));}},[]);
 useEffect(()=>{void Promise.resolve().then(load);},[load]);
 const profiles=(d?.profiles??[]).filter(p=>p.userId===targetUserId);
 const latest=profiles[0];
 async function submit(){const f=file.current?.files?.[0];if(!f){setError("กรุณาเลือกภาพลายเซ็น (PNG หรือ JPEG)");file.current?.focus();return;}
  setBusy(true);setError("");setNotice("");try{const body=new FormData();body.append("legalName",form.legalName);body.append("mtLicenseNo",form.license);body.append("signature",f);
   const r=await fetch("/api/task3/signers",{method:"POST",headers:{"x-csrf-token":csrf()},body});const j=await r.json().catch(()=>({}));if(!r.ok){setError(j.error??"บันทึกไม่สำเร็จ");return;}
   setNotice("บันทึกแล้ว — ใช้ลงนามรายงานได้หลังผู้ดูแลระบบตรวจ");setForm({legalName:"",license:""});if(file.current)file.current.value="";await load();onChanged?.();}finally{setBusy(false);}}
 async function decide(p:Profile,decision:"VERIFY"|"REVOKE"){setBusy(true);setError("");setNotice("");try{await labApi("/api/task3/signers",{action:"decideProfile",profileId:p.id,decision,reason:note.trim()});setNotice(decision==="VERIFY"?"ยืนยันใบอนุญาตและลายเซ็นแล้ว":"เพิกถอนแล้ว");await load();onChanged?.();}catch(e){setError(failureText(e));}finally{setBusy(false);}}
 if(!d)return error?<p className="notice" role="alert">{error}</p>:<p role="status">กำลังโหลด…</p>;
 return <section className="signer-profile stack" aria-label="ใบอนุญาตและลายเซ็นรายงาน">
  <div aria-live="polite">{notice&&<p className="notice success" role="status">{notice}</p>}{error&&<p className="notice" role="alert">{error}</p>}</div>
  {latest?<div className="signer-current">
   <div className="row"><strong>{latest.legalName}</strong><span className={`status ${tone(latest)}`}>{stateText(latest)}</span></div>
   <p className="help">ใบอนุญาต {latest.license} · ฉบับที่ {latest.version} · บันทึกเมื่อ {bkk(latest.submittedAt)}</p>
   {/* eslint-disable-next-line @next/next/no-img-element -- authenticated, no-store signature image must never enter the image optimizer cache */}
   {(self||d.canManage)&&<img className="t3-signature" src={`/api/task3/signers/${latest.id}/image`} alt={`ลายเซ็นของ ${latest.legalName}`}/>}
   {!self&&d.canManage&&latest.state!=="REVOKED"&&<div className="stack"><div className="field"><label htmlFor={`sig-note-${latest.id}`}>บันทึกการตรวจ</label><input id={`sig-note-${latest.id}`} value={note} maxLength={300} onChange={e=>setNote(e.target.value)}/></div>
    <div className="action-bar">{latest.state===null&&<button type="button" className="button" disabled={busy||note.trim().length<8} onClick={()=>void decide(latest,"VERIFY")}>ยืนยันใบอนุญาตและลายเซ็น</button>}
     <button type="button" className="button secondary" disabled={busy||note.trim().length<8} onClick={()=>void decide(latest,"REVOKE")}>เพิกถอน</button></div></div>}
  </div>:<p className="help">{self?"ยังไม่มีใบอนุญาตและลายเซ็นสำหรับรายงาน":"ผู้ใช้นี้ยังไม่ได้บันทึกใบอนุญาตและลายเซ็นในโปรไฟล์ของตนเอง"}</p>}
  {self&&<div className="stack"><h3>{latest?"บันทึกฉบับใหม่":"บันทึกใบอนุญาตและลายเซ็น"}</h3>
   <div className="form-grid">
    <div className="field"><label htmlFor="sig-name">ชื่อ-สกุลตามใบอนุญาต</label><input id="sig-name" maxLength={120} value={form.legalName} onChange={e=>setForm(f=>({...f,legalName:e.target.value}))}/></div>
    <div className="field"><label htmlFor="sig-license">เลขใบอนุญาตประกอบวิชาชีพ</label><input id="sig-license" inputMode="numeric" maxLength={10} value={form.license} onChange={e=>setForm(f=>({...f,license:e.target.value.replace(/\D/g,"")}))}/></div>
   </div>
   <div className="field"><label htmlFor="sig-file">ภาพลายเซ็น (PNG หรือ JPEG ไม่เกิน 512 KB)</label><FileDropInput id="sig-file" ref={file} type="file" accept="image/png,image/jpeg"/></div>
   <div className="action-bar"><button type="button" className="button" disabled={busy||form.legalName.trim().length<3||form.license.length<3} onClick={()=>void submit()}>{busy?"กำลังบันทึก…":"บันทึก"}</button></div></div>}
 </section>;
}
