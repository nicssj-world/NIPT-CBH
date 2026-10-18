"use client";
import {useCallback,useEffect,useState} from "react";
import {csrf} from "../p2/shared";

// Owner 2026-10-18: Final Result PDF on the patient's case page — status per round and the fallback "อัปโหลด PDF ผลตรวจ".
// The upload is checked against the selected round/attempt before anything is attached; it is never acceptance or release.
type Attempt={id:string;number:number;state:string;printedSampleId:string|null};
type Round={id:string;number:number;received:boolean;status:"NO_RESULT"|"AWAITING_MATCH"|"AWAITING_ACCEPTANCE"|"CONFIRMED";attempts:Attempt[]};
type Version={id:string;roundId:string|null;state:string;kind:string;importedAt:string;linkMode:string|null;channel:string;openProposal:boolean};
type Status={caseId:string;currentRoundId:string;rounds:Round[];versions:Version[];folderChannel:{workerAlive:boolean;lastHeartbeatAt:string|null;lastScanAt:string|null;lastScanError:string|null;manualUploadAvailable:boolean};can:{upload:boolean}};
type Check={outcome:"READY"|"REFUSED"|"DUPLICATE"|"REJECTED";intakeId:string;code?:string|null;versionId?:string|null;cross?:Record<string,string>;failed?:string[];nameConflict?:boolean};
type Confirmed={versionId:string;outcome:string;state:string;next:string};
const STATUS:Record<Round["status"],string>={NO_RESULT:"ยังไม่มีผล",AWAITING_MATCH:"รอจับคู่",AWAITING_ACCEPTANCE:"รอตรวจรับ",CONFIRMED:"ยืนยันแล้ว"};
const TONE:Record<Round["status"],string>={NO_RESULT:"",AWAITING_MATCH:"warning",AWAITING_ACCEPTANCE:"warning",CONFIRMED:"good"};
const FIELD:Record<string,string>={hn:"HN",dob:"วันเกิด",pregnancy:"ครรภ์เดี่ยว/แฝด",collectionDate:"วันเจาะเลือด",gestationalAge:"อายุครรภ์",labNumber:"เลข Lab"};
const CMP:Record<string,string>={MATCH:"ตรงกัน",MISMATCH:"ไม่ตรงกัน",NOT_AVAILABLE:"ไม่มีข้อมูล"};
const REFUSAL:Record<string,string>={IDENTITY_CONFLICT_WITH_SELECTED_CASE:"ข้อมูลใน PDF ไม่ตรงกับผู้ป่วย/รอบที่เลือก — ไม่ได้แนบไฟล์",IDENTITY_NOT_VERIFIABLE:"PDF ไม่มีข้อมูลระบุตัวตนครบพอจะยืนยันกับรายการนี้ — ไม่ได้แนบไฟล์",ONE_REPORT_PER_UPLOAD:"อัปโหลดได้ครั้งละ 1 รายงาน",TEMPLATE_UNKNOWN:"ไม่ใช่รูปแบบรายงานผลที่ระบบรองรับ"};
const STATE:Record<string,string>={Unlinked:"รอจับคู่",LinkConflict:"จับคู่ขัดแย้ง",Linked:"เชื่อมโยงแล้ว",ValidationBlocked:"รอตรวจรับ (มีเงื่อนไขค้าง)",PendingCertification:"รอตรวจรับ",CertifiedReleased:"ยืนยันแล้ว",Superseded:"ถูกแทนด้วยฉบับใหม่",Voided:"ยกเลิก"};
const when=(x:string|null)=>x?new Date(x).toLocaleString("th-TH",{timeZone:"Asia/Bangkok",dateStyle:"short",timeStyle:"short"}):"—";

export function CasePdfIntake({caseId}:{caseId:string}){
 const [status,setStatus]=useState<Status|null>(null),[roundId,setRoundId]=useState(""),[attemptId,setAttemptId]=useState(""),[file,setFile]=useState<File|null>(null);
 const [check,setCheck]=useState<Check|null>(null),[done,setDone]=useState<Confirmed|null>(null),[ack,setAck]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(""),[inputKey,setInputKey]=useState(0);
 const load=useCallback(async()=>{const r=await fetch(`/api/p5/cases/${caseId}/pdf-intake`,{cache:"no-store"});if(!r.ok){if(r.status!==403&&r.status!==404)setError("โหลดสถานะผล PDF ไม่ได้");return;}
  const d=await r.json() as Status;setStatus(d);setRoundId(x=>x||d.currentRoundId);},[caseId]);
 useEffect(()=>{void Promise.resolve().then(load);},[load]);
 const round=status?.rounds.find(r=>r.id===roundId);
 // Default to the latest attempt of the chosen round; a choice from another round never carries over.
 const attempt=round?.attempts.some(a=>a.id===attemptId)?attemptId:round?.attempts[0]?.id??"";
 if(!status)return error?<p className="notice" role="alert">{error}</p>:null;
 async function submit(e:React.FormEvent){e.preventDefault();if(!file)return;setBusy(true);setError("");setCheck(null);setDone(null);setAck(false);
  try{const form=new FormData();form.append("file",file);form.append("roundId",roundId);form.append("attemptId",attempt);
   const r=await fetch(`/api/p5/cases/${caseId}/pdf-intake`,{method:"POST",headers:{"x-csrf-token":csrf()},body:form});const d=await r.json();
   if(!r.ok){setError(d.error??"อัปโหลดไม่สำเร็จ");return;}setCheck(d);}catch{setError("อัปโหลดไม่สำเร็จ กรุณาลองใหม่");}finally{setBusy(false);}}
 async function confirm(){if(!check)return;setBusy(true);setError("");
  try{const r=await fetch(`/api/p5/cases/${caseId}/pdf-intake/confirm`,{method:"POST",headers:{"content-type":"application/json","x-csrf-token":csrf()},body:JSON.stringify({target:{roundId,attemptId:attempt||null},intakeId:check.intakeId,...(check.nameConflict?{acknowledgeNameConflict:ack}:{})})});
   const d=await r.json();if(!r.ok){setError(d.error??"ยืนยันไม่สำเร็จ");return;}setDone(d);setCheck(null);setFile(null);setInputKey(k=>k+1);await load();}catch{setError("ยืนยันไม่สำเร็จ กรุณาลองใหม่");}finally{setBusy(false);}}
 const fc=status.folderChannel;
 return <section className="panel" aria-labelledby="case-pdf-h"><h2 id="case-pdf-h">ผล PDF ฉบับสุดท้าย</h2>
  <p className="help">ช่องทางหลัก: ระบบรับ PDF จากโฟลเดอร์ที่ตั้งไว้ · ช่องทางสำรอง: อัปโหลดจากหน้านี้ ทั้งสองช่องทางยังต้อง ตรวจรับ PDF และยืนยันส่งผล ก่อนส่ง HIS</p>
  {fc.workerAlive&&!(fc.lastScanError&&fc.lastScanError!=="PENDING")?<p role="status">ช่องทางโฟลเดอร์: Worker ทำงานปกติ · สแกนล่าสุด {when(fc.lastScanAt)}</p>
   :<p className="notice warning-notice" role="status">ช่องทางโฟลเดอร์ขัดข้อง ({!fc.workerAlive?"Worker ไม่ตอบสนอง":`สแกนล่าสุดไม่สำเร็จ ${fc.lastScanError}`}) — ยังอัปโหลด PDF จากหน้านี้ได้</p>}
  <div className="table-wrap" role="region" aria-label="สถานะผล PDF แต่ละรอบ" tabIndex={0}><table className="data-table"><thead><tr><th scope="col">รอบ</th><th scope="col">สถานะผล PDF</th><th scope="col">รายงาน</th></tr></thead>
   <tbody>{status.rounds.map(r=><tr key={r.id}><td>รอบที่ {r.number}</td><td><span className={`status ${TONE[r.status]}`}>{STATUS[r.status]}</span></td>
    <td>{status.versions.filter(v=>v.roundId===r.id||(!v.roundId&&r.id===status.currentRoundId)).map(v=><div key={v.id}><a href={`/results/${v.id}`}>{STATE[v.state]??v.state}</a> · {v.channel==="MANUAL_UPLOAD"?"อัปโหลดจากหน้าผู้ป่วย":"โฟลเดอร์/หน้าผลตรวจ"} · {when(v.importedAt)}{v.openProposal?" · รอผู้รับรองยืนยันการเชื่อมโยง":""}</div>)}</td></tr>)}</tbody></table></div>
  {status.can.upload&&<form className="stack" onSubmit={submit} aria-label="อัปโหลด PDF ผลตรวจ">
   <div className="form-grid">
    <div className="field"><label htmlFor="case-pdf-round">รอบตัวอย่าง</label><select id="case-pdf-round" value={roundId} onChange={e=>setRoundId(e.target.value)}>{status.rounds.map(r=><option key={r.id} value={r.id}>รอบที่ {r.number}{r.id===status.currentRoundId?" (ปัจจุบัน)":""}</option>)}</select></div>
    <div className="field"><label htmlFor="case-pdf-attempt">Attempt</label><select id="case-pdf-attempt" value={attempt} onChange={e=>setAttemptId(e.target.value)}>{round?.attempts.map(a=><option key={a.id} value={a.id}>ครั้งที่ {a.number}{a.printedSampleId?` · ${a.printedSampleId}`:""}</option>)}</select></div>
    <div className="field"><label htmlFor="case-pdf-file">ไฟล์ PDF ผลตรวจ</label><input key={inputKey} id="case-pdf-file" type="file" accept="application/pdf,.pdf" onChange={e=>setFile(e.target.files?.[0]??null)}/></div>
   </div>
   <div className="action-bar"><button className="button" disabled={busy||!file||!roundId}>{busy&&!check?"กำลังตรวจไฟล์…":"อัปโหลด PDF ผลตรวจ"}</button></div>
  </form>}
  <div aria-live="polite">{error&&<p className="notice" role="alert">{error}</p>}
   {check?.outcome==="REFUSED"&&<div className="notice" role="alert"><p>{REFUSAL[check.code??""]??"ไม่ได้แนบไฟล์"}</p>{check.failed&&<p>ไม่ผ่าน: {check.failed.map(k=>FIELD[k]??k).join(", ")}</p>}</div>}
   {check?.outcome==="REJECTED"&&<p className="notice" role="alert">ไฟล์ถูกปฏิเสธ ({check.code}) — ไม่ได้แนบไฟล์</p>}
   {check?.outcome==="DUPLICATE"&&<p className="notice warning-notice" role="status">ไฟล์นี้มีในระบบแล้ว (อาจมาจากโฟลเดอร์) — ไม่สร้างรายการซ้ำ <a href={`/results/${check.versionId}`}>เปิดรายการเดิม</a></p>}
   {check?.outcome==="READY"&&<div className="stack" role="region" aria-label="ตรวจ PDF กับรายการที่เลือก">
    <p role="status">ข้อมูลใน PDF ตรงกับรายการที่เลือก — ตรวจตัวอย่างไฟล์แล้วกดยืนยัน</p>
    <table className="data-table"><thead><tr><th scope="col">ข้อมูล</th><th scope="col">ผลเทียบ</th></tr></thead><tbody>{Object.entries(check.cross??{}).map(([k,v])=><tr key={k}><td>{FIELD[k]??k}</td><td>{CMP[v]??v}</td></tr>)}</tbody></table>
    <iframe title="ตัวอย่าง PDF ที่อัปโหลด" src={`/api/p5/intake/${check.intakeId}/file`} style={{width:"100%",height:"28rem",border:"1px solid var(--border)"}}/>
    {check.nameConflict&&<label className="check-label"><input type="checkbox" checked={ack} onChange={e=>setAck(e.target.checked)}/> มีไฟล์ชื่อเดียวกันแต่เนื้อหาต่างในระบบแล้ว — รับทราบ</label>}
    <div className="action-bar"><button type="button" className="button" disabled={busy||(!!check.nameConflict&&!ack)} onClick={()=>void confirm()}>{busy?"กำลังบันทึก…":"ยืนยันแนบ PDF กับรายการนี้"}</button></div>
   </div>}
   {done&&<div className="stack" role="region" aria-label="ผลการอัปโหลด"><p className="notice success" role="status">แนบ PDF แล้ว ({STATE[done.state]??done.state}) — ขั้นต่อไป: {done.next}</p>
    <iframe title="PDF ที่แนบแล้ว" src={`/api/p5/results/${done.versionId}/file`} style={{width:"100%",height:"28rem",border:"1px solid var(--border)"}}/>
    <p><a className="button secondary" href={`/results/${done.versionId}`}>เปิดหน้าตรวจรับผล</a></p></div>}
  </div>
 </section>;
}
