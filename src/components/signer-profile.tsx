"use client";
import {useCallback,useEffect,useRef,useState} from "react";
import {labApi,labPdf,failureText,bkk,LabFailure} from "./p4/lab-api";
import {csrf} from "./p2/shared";
import {FileDropInput} from "./shared/file-drop-input";

/** OWNER-LAB-054: licence number and report signature live with the user — entered in the user's own Profile, checked by an
 *  administrator in Users (never by the same person; DB-enforced). No separate signer enrollment page. The rules that decide
 *  who may sign Reported by / Approved by are unchanged (packages/readygen/signers.ts). */
type Profile={id:string;userId:string;displayName:string;version:number;legalName:string;license:string;submittedAt:string;state:"VERIFIED"|"REVOKED"|null;current:boolean};
type Overview={canManage:boolean;profiles:Profile[]};
const stateText=(p:Profile)=>p.state==="REVOKED"?"เพิกถอนแล้ว":p.state==="VERIFIED"?(p.current?"ใช้งานได้":"มีฉบับใหม่กว่า"):"รอผู้ดูแลระบบตรวจ";
const tone=(p:Profile)=>p.current?"good":p.state==="REVOKED"?"bad":"warning";

/** The signature already saved in the Profile "ลายเซ็น" tab is reused when no new file is chosen. */
function profileBlob(sig:{mime:string;data:string}){const bin=atob(sig.data),u=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)u[i]=bin.charCodeAt(i);return new Blob([u],{type:sig.mime});}
export function SignerProfile({targetUserId,self,onChanged,profileSignature}:{targetUserId:string;self:boolean;onChanged?:()=>void;profileSignature?:{mime:string;data:string}|null}){
 const [editing,setEditing]=useState(false);
 const [d,setD]=useState<Overview|null>(null),[error,setError]=useState(""),[notice,setNotice]=useState(""),[busy,setBusy]=useState(false);
 const [review,setReview]=useState<{id:string;SINGLETON:boolean;TWIN:boolean;unavailable:boolean;skip:boolean;ok:boolean}|null>(null);
 const [form,setForm]=useState({legalName:"",license:""}),[note,setNote]=useState("ตรวจตัวตน เลขใบอนุญาต และลายเซ็นกับทะเบียนบุคลากรแล้ว"),file=useRef<HTMLInputElement>(null);
 const load=useCallback(async()=>{try{setD(await labApi<Overview>("/api/task3/signers"));setError("");}catch(e){setError(failureText(e));}},[]);
 useEffect(()=>{void Promise.resolve().then(load);},[load]);
 const profiles=(d?.profiles??[]).filter(p=>p.userId===targetUserId);
 const latest=profiles[0];
 async function submit(){const chosen=file.current?.files?.[0];if(!chosen&&!profileSignature){setError("กรุณาเลือกภาพลายเซ็น (PNG หรือ JPEG)");file.current?.focus();return;}
  const f:Blob=chosen??profileBlob(profileSignature!);
  setBusy(true);setError("");setNotice("");try{const body=new FormData();body.append("legalName",form.legalName);body.append("mtLicenseNo",form.license);body.append("signature",f,chosen?.name??(profileSignature!.mime==="image/png"?"signature.png":"signature.jpg"));
   const r=await fetch("/api/task3/signers",{method:"POST",headers:{"x-csrf-token":csrf()},body});const j=await r.json().catch(()=>({}));if(!r.ok){setError(j.error??"บันทึกไม่สำเร็จ");return;}
   setNotice((j.state==="Verified"?"บันทึกแล้ว — ใช้ลงนามรายงานได้ทันที":"บันทึกแล้ว — ใช้ลงนามรายงานได้หลังผู้ดูแลระบบตรวจ")+(j.opaqueBackground?" · พื้นหลังสีขาวอาจทับเส้นในแบบฟอร์ม — แนะนำ PNG พื้นโปร่งใส (ผู้ดูแลระบบจะตรวจจากตัวอย่างก่อนอนุมัติ)":""));setForm({legalName:"",license:""});setEditing(false);if(file.current)file.current.value="";await load();onChanged?.();}finally{setBusy(false);}}
 const rv=(p:Profile)=>review?.id===p.id?review:{id:p.id,SINGLETON:false,TWIN:false,unavailable:false,skip:false,ok:false};
 async function sample(p:Profile,kind:"SINGLETON"|"TWIN"){setError("");try{await labPdf(`/api/task3/signers/${p.id}/preview`,{kind});setReview({...rv(p),[kind]:true});}
  catch(e){if(e instanceof LabFailure&&(e.code==="REPORT_MASTER_NOT_INSTALLED"||e.code==="REPORT_RENDER_UNAVAILABLE"))setReview({...rv(p),unavailable:true});setError(failureText(e));}}
 async function decide(p:Profile,decision:"VERIFY"|"REVOKE"){const r=rv(p);setBusy(true);setError("");setNotice("");try{await labApi("/api/task3/signers",{action:"decideProfile",profileId:p.id,decision,reason:note.trim(),...(decision==="VERIFY"?(r.ok?{layoutReviewed:true}:{previewUnavailable:true}):{})});setNotice(decision==="VERIFY"?"ยืนยันใบอนุญาตและลายเซ็นแล้ว":"เพิกถอนแล้ว");await load();onChanged?.();}catch(e){setError(failureText(e));}finally{setBusy(false);}}
 if(!d)return error?<p className="notice" role="alert">{error}</p>:<p role="status">กำลังโหลด…</p>;
 return <section className="signer-profile stack" aria-label="ใบอนุญาตและลายเซ็นรายงาน">
  <div aria-live="polite">{notice&&<p className="notice success" role="status">{notice}</p>}{error&&<p className="notice" role="alert">{error}</p>}</div>
  {latest?<div className="signer-current">
   <div className="row"><strong>{latest.legalName}</strong><span className={`status ${tone(latest)}`}>{stateText(latest)}</span></div>
   <p className="help">ใบอนุญาต {latest.license} · ฉบับที่ {latest.version} · บันทึกเมื่อ {bkk(latest.submittedAt)}</p>
   {/* eslint-disable-next-line @next/next/no-img-element -- authenticated, no-store signature image must never enter the image optimizer cache */}
   {(self||d.canManage)&&<img className="t3-signature" src={`/api/task3/signers/${latest.id}/image`} alt={`ลายเซ็นของ ${latest.legalName}`}/>}
   {!self&&d.canManage&&latest.state!=="REVOKED"&&<div className="stack"><div className="field"><label htmlFor={`sig-note-${latest.id}`}>บันทึกการตรวจ</label><input id={`sig-note-${latest.id}`} value={note} maxLength={300} onChange={e=>setNote(e.target.value)}/></div>
    <fieldset className="stack"><legend>ตรวจตำแหน่งลายเซ็นในแบบฟอร์ม</legend>
     <p className="help">ดูรายงานตัวอย่างได้ (ลายน้ำ PREVIEW ข้อมูลสังเคราะห์ ไม่บันทึกเป็นรายงาน) ถ้าต้องการ แล้วติ๊กยืนยันว่าลายเซ็นถูกต้อง — ไม่จำเป็นต้องเปิดตัวอย่างก่อน</p>
     <div className="action-bar"><button type="button" className="button secondary" onClick={()=>void sample(latest,"SINGLETON")}>ดูตัวอย่างแบบเดี่ยว</button><button type="button" className="button secondary" onClick={()=>void sample(latest,"TWIN")}>ดูตัวอย่างแบบแฝด</button></div>
     {latest.state===null&&<label className="check-label"><input type="checkbox" checked={rv(latest).ok} onChange={e=>setReview({...rv(latest),ok:e.target.checked})}/> ลายเซ็นแสดงถูกต้องตามแบบฟอร์ม</label>}
     {latest.state===null&&rv(latest).unavailable&&<label className="check-label"><input type="checkbox" checked={rv(latest).skip} onChange={e=>setReview({...rv(latest),skip:e.target.checked})}/> ดูตัวอย่างไม่ได้ในเครื่องนี้ — ขอยืนยันโดยไม่ดูตัวอย่าง (ระบบบันทึกว่า “ไม่ได้ดูตัวอย่าง”)</label>}</fieldset>
    <div className="action-bar">{latest.state===null&&<button type="button" className="button" disabled={busy||!rv(latest).ok&&!(rv(latest).unavailable&&rv(latest).skip)} onClick={()=>void decide(latest,"VERIFY")}>ยืนยันใบอนุญาตและลายเซ็น</button>}
     <button type="button" className="button secondary" disabled={busy} onClick={()=>void decide(latest,"REVOKE")}>เพิกถอน</button></div></div>}
  </div>:<p className="help">{self?"ยังไม่มีใบอนุญาตและลายเซ็นสำหรับรายงาน":"ผู้ใช้นี้ยังไม่ได้บันทึกใบอนุญาตและลายเซ็นในโปรไฟล์ของตนเอง"}</p>}
  {self&&latest&&!editing&&<div className="action-bar"><button type="button" className="button secondary" onClick={()=>{setForm({legalName:latest.legalName,license:latest.license});setNotice("");setEditing(true);}}>แก้ไข</button></div>}
  {self&&(!latest||editing)&&<div className="stack"><h3>{latest?"บันทึกฉบับใหม่":"บันทึกใบอนุญาตและลายเซ็น"}</h3>
   <div className="form-grid">
    <div className="field"><label htmlFor="sig-name">ชื่อ-สกุลตามใบอนุญาต</label><input id="sig-name" maxLength={120} value={form.legalName} onChange={e=>setForm(f=>({...f,legalName:e.target.value}))}/></div>
    <div className="field"><label htmlFor="sig-license">เลขใบอนุญาตประกอบวิชาชีพ</label><input id="sig-license" inputMode="numeric" maxLength={10} value={form.license} onChange={e=>setForm(f=>({...f,license:e.target.value.replace(/\D/g,"")}))}/></div>
   </div>
   <div className="field"><label htmlFor="sig-file">{profileSignature?"เปลี่ยนภาพลายเซ็น (ไม่บังคับ)":"ภาพลายเซ็น (PNG หรือ JPEG ไม่เกิน 512 KB)"}</label>{profileSignature&&<p className="help">ใช้ลายเซ็นที่บันทึกไว้ในแท็บ “ลายเซ็น” โดยอัตโนมัติ หากไม่เลือกไฟล์ใหม่</p>}<FileDropInput id="sig-file" ref={file} type="file" accept="image/png,image/jpeg"/><p className="help">แนะนำ PNG พื้นโปร่งใส — ภาพพื้นขาว (JPEG หรือ PNG ไม่โปร่งใส) อาจทับเส้นในแบบฟอร์ม</p></div>
   <div className="action-bar"><button type="button" className="button" disabled={busy||form.legalName.trim().length<3||form.license.length<3} onClick={()=>void submit()}>{busy?"กำลังบันทึก…":"บันทึก"}</button>{latest&&<button type="button" className="button secondary" disabled={busy} onClick={()=>setEditing(false)}>ยกเลิก</button>}</div></div>}
 </section>;
}
