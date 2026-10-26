"use client";
import Link from "next/link";
import {useCallback,useEffect,useState} from "react";
import {labApi,failureText,bkk} from "../p4/lab-api";

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
 const [grant,setGrant]=useState({granteeId:"",reported:true,approved:false,reference:"",expires:""}),[reasons,setReasons]=useState<Record<string,string>>({});
 const load=useCallback(async()=>{try{setD(await labApi<Overview>("/api/task3/signers"));setError("");}catch(e){setError(failureText(e));}},[]);
 useEffect(()=>{void Promise.resolve().then(load);},[load]);
 const act=async(name:string,body:Record<string,unknown>,done:string)=>{setBusy(name);setError("");setNotice("");try{await labApi("/api/task3/signers",body);setNotice(done);await load();}catch(e){setError(failureText(e));}finally{setBusy("");}};
 if(!d)return error?<p className="notice" role="alert">{error}</p>:<div className="skeleton" aria-busy="true" aria-label="กำลังโหลด"/>;
 const mine=d.profiles.filter(p=>p.userId===userId);
 return <>
  <header className="page-header"><div><h1>ผู้ลงนามรายงาน</h1></div>
   <div className="action-bar"><Link className="button secondary" href="/results">← ผลตรวจ NIPT</Link></div></header>
  <div aria-live="polite">{notice&&<p className="notice success" role="status">{notice}</p>}{error&&<p className="notice" role="alert">{error}</p>}</div>

  {/* OWNER-LAB-054: licence and signature are entered in โปรไฟล์ของฉัน and checked by an administrator in จัดการผู้ใช้; no separate enrollment here. */}
  <section className="panel" aria-labelledby="sig-own-h"><h2 id="sig-own-h">ใบอนุญาตและลายเซ็น</h2>
   {mine.length?<p><strong>{mine[0].legalName}</strong> · ใบอนุญาต {mine[0].license} · <Status tone={mine[0].current?"good":mine[0].state==="REVOKED"?"bad":"warning"}>{STATE_TEXT(mine[0])}</Status></p>:<p className="help">ยังไม่มีข้อมูล</p>}
   <p className="help">แก้ไขได้ที่โปรไฟล์ของฉัน (มุมขวาบน) · ผู้ดูแลระบบตรวจยืนยันที่หน้าจัดการผู้ใช้</p></section>

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


 </>;
}
