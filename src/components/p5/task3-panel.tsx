"use client";
import {useState} from "react";
import {labApi,failureText,bkk} from "../p4/lab-api";
import {PdfPreviewButton} from "../shared/pdf-preview";
import type {HisDeliveryStatus} from '../../../packages/results/his-status';
import {HisDeliveryBadge} from './his-delivery-badge';

// Task 3 on the LAB result page: where the report came from (INTERNAL_GENERATED / EXTERNAL_READYGEN) with its evidence, the "มีผลใน HIS แล้ว" attestation and the outage provenance of a ReadyGen PDF. ANC never sees any of this.
export type Task3Detail={origin?:"EXTERNAL_READYGEN"|"INTERNAL_GENERATED";hisTransferState?:string|null;hisDelivery?:HisDeliveryStatus;
 internal?:{id:string;state:string;templateKind:string;templateCode:string;templateSha256:string;pregnancySource:string;overrideReason:string|null;ruleset:{id:string;version:string;sha256:string;approved:boolean;combinationApproved:boolean;productCode:string|null;approvalReference:string;settingRevisionVersion:number|null};
  downloadName:string;reportedAt:string;approvedAt:string;createdAt:string;batchId:string|null;halosImportId:string;reportedName:string;reportedLicense:string;reportedBasis:string;approvedName:string;approvedLicense:string;approvedBasis:string;operator:string;current:boolean}|null;
 fallback?:{outageReference:string;outageStartedAt:string|null;outageEndedAt:string|null;note:string|null;recordedAt:string;recordedBy:string}|null;
 attestations?:{id:string;statement:string;effect:string;note:string|null;attestedAt:string;actor:string;withdrawnAt:string|null;withdrawnBy:string|null;withdrawReason:string|null}[];
 can:{attestHis?:boolean;recordFallback?:boolean}};
const BASIS:Record<string,string>={SELF:"ลงนามด้วยตนเอง",STANDING_DELEGATION:"ใช้ลายเซ็นตามการมอบสิทธิ์ของเจ้าของลายเซ็น",ADMIN_OPERATOR:"ผู้ดูแลระบบใช้ลายเซ็นที่ยืนยันแล้ว"};
const EFFECT:Record<string,string>={SUPPRESSED_BEFORE_RELEASE:"บันทึกก่อนยืนยันส่งผล — จะไม่ส่งผลเข้า HIS ซ้ำ",SUPPRESSED_PENDING_DELIVERY:"บันทึกหลังยืนยันส่งผล ก่อนระบบเริ่มส่ง — ยกเลิกการส่งเข้า HIS"};

export function Task3Panel({d,versionId,reload}:{d:Task3Detail;versionId:string;reload:()=>Promise<void>}){
 const [busy,setBusy]=useState(""),[error,setError]=useState(""),[notice,setNotice]=useState("");
 const [attest,setAttest]=useState(false),[attestNote,setAttestNote]=useState(""),[withdrawReason,setWithdrawReason]=useState("");
 const [fb,setFb]=useState({ref:"",from:"",to:"",note:""});
 if(!d.origin)return null;
 const run=async(name:string,body:Record<string,unknown>,done:string)=>{setBusy(name);setError("");setNotice("");
  try{await labApi(`/api/p5/results/${versionId}`,{action:name,...body});setNotice(done);await reload();}catch(e){setError(failureText(e));}finally{setBusy("");}};
 const active=(d.attestations??[]).find(a=>!a.withdrawnAt),i=d.internal;
 return <section className="panel task3-origin" aria-labelledby="t3-origin-h">
  <h2 id="t3-origin-h">ที่มาของรายงาน</h2>
  <div aria-live="polite">{notice&&<p className="notice success" role="status">{notice}</p>}{error&&<p className="notice" role="alert">{error}</p>}</div>
  <p><span className={`badge ${d.origin==="INTERNAL_GENERATED"?"info":""}`}>{d.origin==="INTERNAL_GENERATED"?"ออกรายงานในระบบ (INTERNAL_GENERATED)":"PDF จาก ReadyGen / ภายนอก (EXTERNAL_READYGEN)"}</span></p>
  {i&&<dl className="compact-facts plan-dl t3-facts">
   <div><dt>แบบฟอร์ม</dt><dd>{i.templateCode} ({i.templateKind==="TWIN"?"ครรภ์แฝด":"ครรภ์เดี่ยว"}){i.pregnancySource==="AUTHORIZED_OVERRIDE"&&<> · <span className="badge warning">เปลี่ยนชนิดครรภ์โดยผู้มีสิทธิ์</span> {i.overrideReason}</>}<div className="help mono">SHA-256 {i.templateSha256.slice(0,16)}…</div></dd></div>
   <div><dt>ชุดกฎการแปลผล</dt><dd>{i.ruleset.id} {i.ruleset.version} · อนุมัติรุ่นตั้งค่า {i.ruleset.settingRevisionVersion??"—"} · ผลิตภัณฑ์ {i.ruleset.productCode??"—"}{i.ruleset.approvalReference&&<> · อ้างอิง {i.ruleset.approvalReference}</>}</dd></div>
   <div><dt>Reported by</dt><dd>{i.reportedName} · ใบอนุญาต {i.reportedLicense} · {bkk(i.reportedAt)}<div className="help">{BASIS[i.reportedBasis]??i.reportedBasis}</div></dd></div>
   <div><dt>Approved by</dt><dd>{i.approvedName} · ใบอนุญาต {i.approvedLicense} · {bkk(i.approvedAt)}<div className="help">{BASIS[i.approvedBasis]??i.approvedBasis}</div></dd></div>
   <div><dt>ผู้ออกรายงานในระบบ</dt><dd>{i.operator} · {bkk(i.createdAt)}</dd></div>
   <div><dt>สถานะรายงานในระบบ</dt><dd>{i.state==="Final"?(i.current?"ฉบับปัจจุบัน":"ไม่ผ่านการตรวจความเป็นปัจจุบัน"):i.state==="Superseded"?"ถูกแทนด้วยฉบับใหม่":"ยกเลิกแล้ว"}</dd></div>
   <div><dt>ไฟล์</dt><dd><span className="action-bar"><PdfPreviewButton src={`/api/task3/reports/${i.id}/file`} title="รายงานที่ออกในระบบ"/><a className="button small secondary" href={`/api/task3/reports/${i.id}/file?download=1`}>ดาวน์โหลด</a></span><div className="help">{i.downloadName}</div></dd></div>
  </dl>}
  {d.fallback&&<dl className="compact-facts plan-dl t3-facts"><div><dt>ออกผลช่วงระบบขัดข้อง</dt><dd>{d.fallback.outageReference}{d.fallback.outageStartedAt&&<> · {bkk(d.fallback.outageStartedAt)} – {d.fallback.outageEndedAt?bkk(d.fallback.outageEndedAt):"…"}</>}<div className="help">บันทึกโดย {d.fallback.recordedBy} · {bkk(d.fallback.recordedAt)}{d.fallback.note?` · ${d.fallback.note}`:""}</div></dd></div></dl>}

  <div className="stack t3-block">
   <h3>สถานะใน HIS</h3>
   <HisDeliveryBadge status={d.hisDelivery}/>
   {active?<div className="stack"><p><span className="badge info">มีผลใน HIS แล้ว</span> {EFFECT[active.effect]??active.effect}</p>
     <p className="help">บันทึกโดย {active.actor} · {bkk(active.attestedAt)}{active.note?` · ${active.note}`:""} — เป็นการยืนยันของผู้ใช้ ไม่ใช่การตรวจจาก HIS อัตโนมัติ</p>
     {d.can.attestHis===false&&!d.hisTransferState&&<div className="field"><label htmlFor="t3-withdraw">ยกเลิกการบันทึก (ระบุเหตุผล)</label><input id="t3-withdraw" value={withdrawReason} maxLength={500} onChange={e=>setWithdrawReason(e.target.value)}/>
      <div className="action-bar"><button type="button" className="button secondary" disabled={!!busy||withdrawReason.trim().length<8} onClick={()=>run("withdrawHis",{attestationId:active.id,reason:withdrawReason},"ยกเลิกแล้ว — ถ้าผลยืนยันส่งแล้ว ระบบจะส่งเข้า HIS ครั้งเดียว")}>ยกเลิกการบันทึก</button></div></div>}</div>
    :d.hisTransferState?<p>ระบบส่งผลเข้า HIS แล้ว/กำลังส่ง ({d.hisTransferState}) — ตรวจสถานะได้ที่หน้า HIS ขาออก</p>
    :d.can.attestHis?<div className="stack">
     <label className="check-label"><input type="checkbox" checked={attest} onChange={e=>setAttest(e.target.checked)}/> <strong>มีผลใน HIS แล้ว</strong> — ข้าพเจ้าตรวจแล้วว่า HIS มีผลฉบับนี้อยู่แล้ว ระบบจะไม่ส่งซ้ำ</label>
     <div className="field"><label htmlFor="t3-attest-note">หมายเหตุ (ไม่บังคับ)</label><input id="t3-attest-note" value={attestNote} maxLength={500} onChange={e=>setAttestNote(e.target.value)}/></div>
     <div className="action-bar"><button type="button" className="button secondary" disabled={!!busy||!attest} onClick={()=>run("attestHis",{confirmed:true,sameConfirmed:true,...(attestNote.trim()?{note:attestNote.trim()}:{})},"บันทึก “มีผลใน HIS แล้ว” — จะไม่ส่งผลนี้เข้า HIS")}>บันทึก</button></div></div>
    :<p className="help">ยังไม่มีการบันทึก — เมื่อกด “ส่ง HIS” ระบบจะส่งเข้า HIS ตามขั้นตอนปกติ</p>}
  </div>

  {d.can.recordFallback&&<details className="t3-block"><summary>บันทึกว่า PDF นี้ออกจาก ReadyGen ช่วงระบบ NIPT-CBH ขัดข้อง</summary>
   <div className="stack">
    <div className="field"><label htmlFor="t3-fb-ref">เลขอ้างอิงเหตุขัดข้อง</label><input id="t3-fb-ref" value={fb.ref} maxLength={300} onChange={e=>setFb(f=>({...f,ref:e.target.value}))} aria-describedby="t3-fb-help"/><p id="t3-fb-help" className="help">อย่างน้อย 8 ตัวอักษร เช่น เลขแจ้งเหตุของงานสารสนเทศ</p></div>
    <div className="form-grid"><div className="field"><label htmlFor="t3-fb-from">ระบบขัดข้องตั้งแต่</label><input id="t3-fb-from" type="datetime-local" value={fb.from} onChange={e=>setFb(f=>({...f,from:e.target.value}))}/></div>
     <div className="field"><label htmlFor="t3-fb-to">ระบบกลับมาใช้ได้</label><input id="t3-fb-to" type="datetime-local" value={fb.to} onChange={e=>setFb(f=>({...f,to:e.target.value}))}/></div></div>
    <div className="field"><label htmlFor="t3-fb-note">หมายเหตุ</label><input id="t3-fb-note" value={fb.note} maxLength={500} onChange={e=>setFb(f=>({...f,note:e.target.value}))}/></div>
    <div className="action-bar"><button type="button" className="button secondary" disabled={!!busy||fb.ref.trim().length<8} onClick={()=>run("fallback",{outageReference:fb.ref.trim(),outageStartedAt:fb.from?new Date(fb.from).toISOString():null,outageEndedAt:fb.to?new Date(fb.to).toISOString():null,note:fb.note.trim()||null},"บันทึกที่มาช่วงระบบขัดข้องแล้ว")}>บันทึก</button></div>
   </div></details>}
 </section>;
}
