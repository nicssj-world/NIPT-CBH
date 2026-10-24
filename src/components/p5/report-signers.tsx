"use client";
import Link from "next/link";
import {useCallback,useEffect,useRef,useState} from "react";
import {labApi,failureText,bkk} from "../p4/lab-api";
import {csrf} from "../p2/shared";
import {FileDropInput} from "../shared/file-drop-input";

// Report signers: each staff member submits their own legal name, MT licence and signature (administrator verifies, never themselves);
// a signer may authorise a colleague to apply their stored signature, citing the hospital's documented authority.
type Profile={id:string;userId:string;displayName:string;version:number;legalName:string;license:string;submittedAt:string;state:"VERIFIED"|"REVOKED"|null;current:boolean};
type Delegation={id:string;grantorId:string;grantor:string;granteeId:string;grantee:string;roles:string[];authorityReference:string;effectiveFrom:string;expiresAt:string|null;revokedAt:string|null};
type Overview={canManage:boolean;profiles:Profile[];delegations:Delegation[];delegateCandidates:{id:string;displayName:string}[]};
const ROLE_TEXT:Record<string,string>={REPORTED:"Reported by",APPROVED:"Approved by"};
const STATE_TEXT=(p:Profile)=>p.state==="REVOKED"?"เพิกถอนแล้ว":p.state==="VERIFIED"?(p.current?"ใช้งานอยู่":"มีฉบับใหม่กว่า"):"รอผู้ดูแลระบบตรวจ";
const Status=({tone,children}:{tone?:string;children:React.ReactNode})=><span className={`status ${tone??""}`}>{children}</span>;

export function ReportSigners({userId}:{userId:string}){
 const [d,setD]=useState<Overview|null>(null),[error,setError]=useState(""),[notice,setNotice]=useState(""),[busy,setBusy]=useState("");
 const [form,setForm]=useState({legalName:"",license:""}),file=useRef<HTMLInputElement>(null);
 const [grant,setGrant]=useState({granteeId:"",reported:true,approved:false,reference:"",expires:""}),[reasons,setReasons]=useState<Record<string,string>>({});
 const load=useCallback(async()=>{try{setD(await labApi<Overview>("/api/task3/signers"));setError("");}catch(e){setError(failureText(e));}},[]);
 useEffect(()=>{void Promise.resolve().then(load);},[load]);
 const act=async(name:string,body:Record<string,unknown>,done:string)=>{setBusy(name);setError("");setNotice("");try{await labApi("/api/task3/signers",body);setNotice(done);await load();}catch(e){setError(failureText(e));}finally{setBusy("");}};
 const submit=async()=>{const f=file.current?.files?.[0];if(!f){setError("กรุณาเลือกภาพลายเซ็น (PNG หรือ JPEG)");file.current?.focus();return;}
  setBusy("submit");setError("");setNotice("");try{const body=new FormData();body.append("legalName",form.legalName);body.append("mtLicenseNo",form.license);body.append("signature",f);
   const r=await fetch("/api/task3/signers",{method:"POST",headers:{"x-csrf-token":csrf()},body});const j=await r.json().catch(()=>({}));if(!r.ok){setError(j.error??"บันทึกไม่สำเร็จ");return;}
   setNotice("ส่งโปรไฟล์แล้ว — รอผู้ดูแลระบบตรวจตัวตน ใบอนุญาต และลายเซ็นก่อนใช้งาน");setForm({legalName:"",license:""});if(file.current)file.current.value="";await load();}finally{setBusy("");}};
 if(!d)return error?<p className="notice" role="alert">{error}</p>:<div className="skeleton" aria-busy="true" aria-label="กำลังโหลด"/>;
 const mine=d.profiles.filter(p=>p.userId===userId),pending=d.profiles.filter(p=>p.userId!==userId&&p.state===null);
 return <>
  <header className="page-header"><div><h1>ผู้ลงนามรายงาน</h1><p className="muted">ชื่อตามใบอนุญาต เลขใบอนุญาตนักเทคนิคการแพทย์ และลายเซ็นที่ใช้ในช่อง Reported by / Approved by ของรายงานที่ออกในระบบ</p></div>
   <div className="action-bar"><Link className="button secondary" href="/results">← ผลตรวจ NIPT</Link></div></header>
  <div aria-live="polite">{notice&&<p className="notice success" role="status">{notice}</p>}{error&&<p className="notice" role="alert">{error}</p>}</div>

  <section className="panel" aria-labelledby="sig-own-h">
   <h2 id="sig-own-h">โปรไฟล์ของฉัน</h2>
   {mine.length?<ul className="timeline">{mine.map(p=><li key={p.id}><div className="row"><strong>{p.legalName}</strong><Status tone={p.current?"good":p.state==="REVOKED"?"bad":"warning"}>{STATE_TEXT(p)}</Status></div>
     <div className="help">ใบอนุญาต {p.license} · ฉบับที่ {p.version} · ส่งเมื่อ {bkk(p.submittedAt)}</div>
     <div className="action-bar"><a className="button small secondary" href={`/api/task3/signers/${p.id}/image`} target="_blank" rel="noopener">ดูภาพลายเซ็น</a>
      {p.state!=="REVOKED"&&<><input aria-label="เหตุผลการเพิกถอน" placeholder="เหตุผลการเพิกถอน (อย่างน้อย 8 ตัวอักษร)" value={reasons[p.id]??""} onChange={e=>setReasons(r=>({...r,[p.id]:e.target.value}))}/>
       <button type="button" className="button small secondary" disabled={!!busy||(reasons[p.id]??"").trim().length<8} onClick={()=>act("revoke-"+p.id,{action:"decideProfile",profileId:p.id,decision:"REVOKE",reason:reasons[p.id]},"เพิกถอนแล้ว")}>เพิกถอน</button></>}</div></li>)}</ul>
    :<p className="empty-state">ยังไม่มีโปรไฟล์ — ส่งข้อมูลด้านล่างเพื่อใช้เป็นผู้ลงนาม</p>}
   <h3>ส่งโปรไฟล์ใหม่</h3>
   <div className="form-grid">
    <div className="field"><label htmlFor="sig-name">ชื่อ-สกุลตามใบอนุญาต (ตามที่พิมพ์ในรายงาน)</label><input id="sig-name" maxLength={120} value={form.legalName} onChange={e=>setForm(f=>({...f,legalName:e.target.value}))} aria-describedby="sig-name-help"/><p id="sig-name-help" className="help">ไม่ต้องใส่วงเล็บ ระบบเติมให้ตามแบบฟอร์ม</p></div>
    <div className="field"><label htmlFor="sig-license">เลขใบอนุญาตนักเทคนิคการแพทย์</label><input id="sig-license" inputMode="numeric" maxLength={10} value={form.license} onChange={e=>setForm(f=>({...f,license:e.target.value.replace(/\D/g,"")}))}/></div>
   </div>
   <div className="field"><label htmlFor="sig-file">ภาพลายเซ็น (PNG หรือ JPEG ไม่เกิน 512 KB)</label><FileDropInput id="sig-file" ref={file} type="file" accept="image/png,image/jpeg" aria-describedby="sig-file-help"/><p id="sig-file-help" className="help">ภาพเก็บแบบป้องกัน แสดงได้เฉพาะเจ้าของและผู้ดูแลระบบที่ตรวจ ใช้ได้หลังผ่านการตรวจเท่านั้น</p></div>
   <div className="action-bar"><button type="button" className="button" disabled={!!busy||form.legalName.trim().length<3||form.license.length<3} onClick={submit}>{busy==="submit"?"กำลังส่ง…":"ส่งเพื่อตรวจ"}</button></div>
  </section>

  <section className="panel" aria-labelledby="sig-dlg-h">
   <h2 id="sig-dlg-h">การมอบสิทธิ์ใช้ลายเซ็น</h2>
   <p className="help">มอบให้เพื่อนร่วมงานใช้ลายเซ็นของท่านเมื่อออกรายงาน ตามระเบียบ/คำสั่งของโรงพยาบาล ระบบบันทึกผู้ออกรายงานจริงทุกครั้ง</p>
   {d.delegations.length>0&&<div className="table-wrap" role="region" aria-label="การมอบสิทธิ์" tabIndex={0}><table className="data-table"><thead><tr><th scope="col">เจ้าของลายเซ็น</th><th scope="col">ผู้รับมอบ</th><th scope="col">บทบาท</th><th scope="col">อ้างอิงระเบียบ</th><th scope="col">ช่วงเวลา</th><th scope="col">สถานะ</th></tr></thead>
    <tbody>{d.delegations.map(g=><tr key={g.id}><td>{g.grantor}</td><td>{g.grantee}</td><td>{g.roles.map(r=>ROLE_TEXT[r]).join(", ")}</td><td>{g.authorityReference}</td><td>{bkk(g.effectiveFrom)}{g.expiresAt?` – ${bkk(g.expiresAt)}`:" – ไม่กำหนด"}</td>
     <td>{g.revokedAt?<Status tone="bad">ยกเลิก {bkk(g.revokedAt)}</Status>:(g.grantorId===userId||d.canManage)?<span className="action-bar"><input aria-label="เหตุผลการยกเลิก" placeholder="เหตุผล" value={reasons[g.id]??""} onChange={e=>setReasons(r=>({...r,[g.id]:e.target.value}))}/>
      <button type="button" className="button small secondary" disabled={!!busy||(reasons[g.id]??"").trim().length<8} onClick={()=>act("rvk-"+g.id,{action:"revoke",delegationId:g.id,reason:reasons[g.id]},"ยกเลิกการมอบสิทธิ์แล้ว")}>ยกเลิก</button></span>:<Status tone="good">ใช้งานอยู่</Status>}</td></tr>)}</tbody></table></div>}
   {mine.some(p=>p.current)?<div className="stack"><h3>มอบสิทธิ์ใหม่</h3><div className="form-grid">
    <div className="field"><label htmlFor="dlg-grantee">ผู้รับมอบ</label><select id="dlg-grantee" value={grant.granteeId} onChange={e=>setGrant(g=>({...g,granteeId:e.target.value}))}><option value="">— เลือก —</option>{d.delegateCandidates.map(c=><option key={c.id} value={c.id}>{c.displayName}</option>)}</select></div>
    <div className="field"><label htmlFor="dlg-ref">อ้างอิงระเบียบ/คำสั่งที่อนุญาต</label><input id="dlg-ref" maxLength={300} value={grant.reference} onChange={e=>setGrant(g=>({...g,reference:e.target.value}))}/></div>
    <div className="field"><label htmlFor="dlg-exp">สิ้นสุด (ไม่บังคับ)</label><input id="dlg-exp" type="datetime-local" value={grant.expires} onChange={e=>setGrant(g=>({...g,expires:e.target.value}))}/></div></div>
    <fieldset className="stack"><legend>ใช้ลายเซ็นของฉันในช่อง</legend><label className="check-label"><input type="checkbox" checked={grant.reported} onChange={e=>setGrant(g=>({...g,reported:e.target.checked}))}/> Reported by</label><label className="check-label"><input type="checkbox" checked={grant.approved} onChange={e=>setGrant(g=>({...g,approved:e.target.checked}))}/> Approved by</label></fieldset>
    <div className="action-bar"><button type="button" className="button" disabled={!!busy||!grant.granteeId||grant.reference.trim().length<8||(!grant.reported&&!grant.approved)} onClick={()=>act("grant",{action:"grant",granteeId:grant.granteeId,roles:[...(grant.reported?["REPORTED"]:[]),...(grant.approved?["APPROVED"]:[])],authorityReference:grant.reference.trim(),expiresAt:grant.expires?new Date(grant.expires).toISOString():null},"มอบสิทธิ์แล้ว")}>มอบสิทธิ์</button></div></div>
    :<p className="help">มอบสิทธิ์ได้หลังโปรไฟล์ของท่านผ่านการตรวจแล้ว</p>}
  </section>

  {d.canManage&&<section className="panel" aria-labelledby="sig-verify-h">
   <h2 id="sig-verify-h">รอตรวจ ({pending.length})</h2>
   <p className="help">ตรวจตัวตน เลขใบอนุญาต และลายเซ็นกับเอกสารของโรงพยาบาลก่อนอนุมัติ ผู้ดูแลระบบตรวจโปรไฟล์ของตนเองไม่ได้</p>
   {pending.length?<ul className="timeline">{pending.map(p=><li key={p.id}><div className="row"><strong>{p.legalName}</strong><span>{p.displayName}</span></div>
    <div className="help">ใบอนุญาต {p.license} · ส่งเมื่อ {bkk(p.submittedAt)}</div>
    {/* eslint-disable-next-line @next/next/no-img-element -- authenticated, no-store signature image must never enter the image optimizer cache */}
    <img className="t3-signature" src={`/api/task3/signers/${p.id}/image`} alt={`ลายเซ็นของ ${p.legalName}`}/>
    <div className="action-bar"><input aria-label={`บันทึกการตรวจของ ${p.legalName}`} placeholder="บันทึกการตรวจ (อย่างน้อย 8 ตัวอักษร)" value={reasons[p.id]??""} onChange={e=>setReasons(r=>({...r,[p.id]:e.target.value}))}/>
     <button type="button" className="button small" disabled={!!busy||(reasons[p.id]??"").trim().length<8} onClick={()=>act("v-"+p.id,{action:"decideProfile",profileId:p.id,decision:"VERIFY",reason:reasons[p.id]},"ตรวจผ่านแล้ว — ใช้เป็นผู้ลงนามได้")}>ตรวจผ่าน</button>
     <button type="button" className="button small secondary" disabled={!!busy||(reasons[p.id]??"").trim().length<8} onClick={()=>act("r-"+p.id,{action:"decideProfile",profileId:p.id,decision:"REVOKE",reason:reasons[p.id]},"ไม่อนุมัติแล้ว")}>ไม่อนุมัติ</button></div></li>)}</ul>
    :<p className="empty-state">ไม่มีโปรไฟล์รอตรวจ</p>}
  </section>}
 </>;
}
