"use client";
import Link from "next/link";
import {useCallback,useEffect,useState} from "react";
import {labApi,failureText,bkk,LabFailure} from "../p4/lab-api";
import {STATE_TEXT,STATE_TONE,KIND_TEXT,CONTAINER_TEXT,CROSS_TEXT,CMP_TEXT,CMP_TONE,GATE_NAME,TRI_TEXT,TRI_TONE,reasonText,bytes} from "./labels";
import {ThaiDateInput} from "../shared/thai-date-input";

type Field={value:string|number|null;raw:string|null;method:string};
type Cross=Record<string,string>;
type Predicate={code:string;status:string;reason:string;governance?:string;dependency?:string};
type Gate={gate:"RG"|"RN";eligible:boolean;failed:string[];pending:string[];waitsForP4b:boolean;predicates:Predicate[]};
type Candidate={caseId:string;ln:string;hn:string|null;lnHalos:string|null;matchedOn:string[];cross:Cross;round:{id:string;number:number;state:string;current:boolean;collectionDate:string|null};attempt:{id:string;number:number;state:string;printedSampleId:string|null;latest:boolean}};
type Detail={operational?:boolean;nameConflicts:{id:string;state:string;importedAt:string}[];version:{id:string;kind:string;templateKind:string;templateVersion:string;parserVersion:string;state:string;rowVersion:number;sha256:string;importedAt:string;roundId:string|null;supersedesId:string|null};
 parsed:{identifiers:Record<string,Field>;results:Record<string,Field>;needsManualReview:boolean;abnormal:boolean;noticeCategory:string|null};
 intake:{source:string;relative_path:string|null;original_name:string;member_name:string|null;size:number;container:string};
 target:{round_number:number;ln:string;ln_halos:string|null;printed_sample_id:string|null;attempt_number:number|null;attempt_state:string|null;current:boolean}|null;
 proposal:{actor_id:string;round_id:string;attempt_id:string|null;reason:string;cross_check:Cross;revision:unknown;name_review:string|null;created_at:string}|null;candidates:Candidate[];gate:Gate|null;
 events:{from_state:string|null;to_state:string;reason:string|null;created_at:string;actor:string|null}[];links:{event:string;outcome:string|null;reason:string;cross_check:Cross;created_at:string;actor:string}[];
 gates:{gate:string;purpose:string;outcome:string;created_at:string;actor:string|null}[];reviews:{abnormal_acknowledged:boolean;note:string|null;created_at:string;reviewer:string}[];
 autoMatch:{caseId:string;roundId:string;attemptId:string;reason:string}|null;
 can:{propose:boolean;decide:boolean;unlink:boolean;review:boolean;certify:boolean;void:boolean;acceptRelease?:boolean}};
const ID_FIELDS:[string,string][]=[["labNumber","เลข Lab (LN ใน PDF)"],["hn","HN"],["patientName","ชื่อ"],["dob","วันเกิด"],["collectionDate","วันที่เก็บตัวอย่าง"],["receivedDate","วันที่รับตัวอย่าง"],["reportedDate","วันที่รายงาน"],["gestationalAgeDays","อายุครรภ์ (วัน)"]];
const RESULT_FIELDS:[string,string][]=[["t21","Trisomy 21"],["t18","Trisomy 18"],["t13","Trisomy 13"],["fetalSex","เพศทารก (ถ้าแสดง)"],["xo","XO"],["xxx","XXX"],["xxy","XXY"],["xyy","XYY"],["yChromosome","โครโมโซม Y (ครรภ์แฝด)"],["fetalFraction","Fetal fraction (%)"],["qc","RESULTS QC"]];
const METHOD_TEXT:Record<string,string>={ANCHORED:"ตรงตำแหน่ง",FALLBACK:"สำรอง — ตรวจมือ",UNREADABLE:"อ่านไม่ได้",NOT_APPLICABLE:"ไม่เกี่ยวข้อง"};
const METHOD_TONE:Record<string,""|"good"|"warning"|"bad">={ANCHORED:"good",FALLBACK:"warning",UNREADABLE:"bad"};
const key=()=>crypto.randomUUID().replaceAll("-","");
const Status=({tone,children}:{tone?:string;children:React.ReactNode})=><span className={`status ${tone??""}`}>{children}</span>;
const CROSS_KEYS=["hn","dob","pregnancy","collectionDate","gestationalAge","labNumber"];

function CrossTable({cross,caption}:{cross:Cross;caption:string}){
 return <table className="data-table p5-cross"><caption>{caption}</caption><thead><tr><th scope="col">คุณสมบัติ</th><th scope="col">ผลเทียบ</th></tr></thead>
  <tbody>{CROSS_KEYS.map(k=><tr key={k}><td>{CROSS_TEXT[k]}{k==="labNumber"&&<span className="muted"> (ข้อมูลประกอบ — PIC ยังไม่ Active)</span>}</td><td><Status tone={CMP_TONE[cross[k]]}>{CMP_TEXT[cross[k]]??"—"}</Status></td></tr>)}</tbody></table>;
}

export function ResultReview({id,canMaintain=false}:{id:string;canMaintain?:boolean}){
 const [qcCriteria,setQcCriteria]=useState(''),[qcReason,setQcReason]=useState(''),[qcTemplate,setQcTemplate]=useState(false),[qcDisclosure,setQcDisclosure]=useState(false),[confirmCertification,setConfirmCertification]=useState(false);
 const [noticeTone,setNoticeTone]=useState<"success"|"warning-notice">("success");
 const [d,setD]=useState<Detail|null>(null),[error,setError]=useState(""),[notice,setNotice]=useState(""),[busy,setBusy]=useState<string|null>(null);
 const [choice,setChoice]=useState(""),[reason,setReason]=useState(""),[revise,setRevise]=useState(false),[nameReview,setNameReview]=useState<""|"NEW_REPORT"|"REVISION">(""),[rev,setRev]=useState({receivedDate:"",requestedBy:"",reason:""});
 const [decision,setDecision]=useState(""),[valuesOk,setValuesOk]=useState(false),[ack,setAck]=useState(false),[note,setNote]=useState("");
 const [accept,setAccept]=useState({external:false,identity:false,disclosure:false});
 const [certKey,setCertKey]=useState(key),[certAck,setCertAck]=useState(false),[outcome,setOutcome]=useState<{outcome:string;failed?:string[];pending?:string[];waitsForP4b?:boolean}|null>(null),[voidReason,setVoidReason]=useState("");
 const [reparseReason,setReparseReason]=useState(""),[reparseKey,setReparseKey]=useState(()=>crypto.randomUUID()),[diagnostics,setDiagnostics]=useState<{id:string;parserVersion:string;outcome:string;rejectCode:string|null;createdAt:string;reason:string}[]>([]),[maintenanceError,setMaintenanceError]=useState("");
 const loadDiagnostics=useCallback(async()=>{if(!canMaintain)return;try{const r=await labApi<{evidence:typeof diagnostics}>(`/api/p5/results/${id}/reparse`);setDiagnostics(r.evidence);setMaintenanceError("");}catch(e){setMaintenanceError(failureText(e));}},[id,canMaintain]);
 useEffect(()=>{void Promise.resolve().then(loadDiagnostics);},[loadDiagnostics]);
 const doReparse=async()=>{setBusy("reparse");setMaintenanceError("");setNotice("");try{const r=await labApi<{outcome:string;rejectCode:string|null}>(`/api/p5/results/${id}/reparse`,{reason:reparseReason,idempotencyKey:reparseKey});setNoticeTone(r.outcome==="PARSED_DIAGNOSTIC"?"success":"warning-notice");setNotice(r.outcome==="PARSED_DIAGNOSTIC"?"สร้างหลักฐานอ่านซ้ำแล้ว — รายงานเดิมและการตรวจทานไม่เปลี่ยน":`บันทึกหลักฐานแล้ว แต่อ่านต้นฉบับซ้ำไม่ได้ (${r.rejectCode??"Unknown"}) — ตรวจต้นฉบับก่อนลองใหม่`);setReparseReason("");setReparseKey(crypto.randomUUID());await loadDiagnostics();}catch(e){setMaintenanceError(failureText(e));}finally{setBusy(null);}};
 const load=useCallback(async()=>{try{setD(await labApi<Detail>(`/api/p5/results/${id}`));setError("");}catch(e){setError(failureText(e));}},[id]);
 useEffect(()=>{void Promise.resolve().then(load);},[load]);
 const act=async(name:string,body:Record<string,unknown>,done:string)=>{if(!d)return null;setBusy(name);setError("");setNotice("");setNoticeTone("success");
  try{const r=await labApi<Record<string,unknown>>(`/api/p5/results/${id}`,{action:name,expectedRowVersion:d.version.rowVersion,...body});setNotice(done);await load();return r;}
  catch(e){if(e instanceof LabFailure&&e.code==="REVISION_DETAILS_REQUIRED")setRevise(true);setError(failureText(e));if(e instanceof LabFailure&&e.code==="VERSION_CONFLICT")await load();return null;}finally{setBusy(null);}};
 if(!d)return <><p><Link href="/results">← คิวตรวจทานผล</Link></p>{error?<p className="notice" role="alert">{error}</p>:<div className="skeleton" aria-busy="true" aria-label="กำลังโหลด"/>}</>;
 const v=d.version,p=d.parsed,isNotice=v.kind==="REDRAW_NOTICE",picked=d.candidates.find(c=>c.attempt.id===choice);
 const history=[...d.events.map(e=>({at:e.created_at,text:`${e.from_state?STATE_TEXT[e.from_state]+" → ":""}${STATE_TEXT[e.to_state]??e.to_state}${e.reason?" · "+reasonText(e.reason):""}`,who:e.actor})),
  ...d.links.map(l=>({at:l.created_at,text:`${{PROPOSED:"เสนอการเชื่อมโยง",APPROVED:"ยืนยันการเชื่อมโยง",REJECTED:"ปฏิเสธข้อเสนอ",UNLINKED:"ถอดการเชื่อมโยง"}[l.event]??l.event}${l.outcome?" → "+STATE_TEXT[l.outcome]:""} · ${l.reason}`,who:l.actor})),
  ...d.gates.map(g=>({at:g.created_at,text:`ประเมิน ${g.gate} (${g.purpose==="CERTIFY_ATTEMPT"?"ขณะกดรับรอง":"ตรวจความพร้อม"}) → ${g.outcome==="RELEASE_HOLD"?"ผ่าน Gate แต่ระงับการปล่อย":g.outcome==="BLOCKED"?"ถูกบล็อก":"รอรับรอง"}`,who:g.actor})),
  ...d.reviews.map(r=>({at:r.created_at,text:`ตรวจทานค่ากับ PDF${r.abnormal_acknowledged?" · รับทราบผลผิดปกติ":""}${r.note?" · "+r.note:""}`,who:r.reviewer}))].sort((a,b)=>a.at.localeCompare(b.at));

 return <>
  <p><Link href="/results">← คิวตรวจทานผล</Link></p>
  <header className="page-header"><div><h1>ตรวจทานผล</h1><p className="muted p5-file">{d.intake.member_name??d.intake.relative_path??d.intake.original_name}</p></div>
   <div className="p5-head-status"><Status tone={STATE_TONE[v.state]}>{STATE_TEXT[v.state]??v.state}</Status><span className="badge">{KIND_TEXT[v.templateKind]}</span>{p.abnormal&&<span className="badge danger">ผิดปกติ</span>}{v.supersedesId&&<span className="badge warning">ฉบับแก้ไข</span>}</div></header>
  <div aria-live="polite">{notice&&<p className={`notice ${noticeTone}`} role="status">{notice}</p>}{error&&<p className="notice" role="alert">{error}</p>}</div>
  <div className="p5-review">
   <section className="panel p5-original" aria-labelledby="orig-h">
    <h2 id="orig-h">ไฟล์ต้นฉบับ</h2>
    {d.intake.container==="PDF"?<iframe className="pdf-frame" title="PDF ต้นฉบับ (อ่านอย่างเดียว)" src={`/api/p5/results/${v.id}/file`}/>
     :<p className="notice">ต้นฉบับเป็น {CONTAINER_TEXT[d.intake.container]} — <a href={`/api/p5/results/${v.id}/file`}>ดาวน์โหลดไฟล์ต้นฉบับ</a> เพื่อเทียบค่า</p>}
    <dl className="plan-dl p5-facts">
     <dt>ที่มา</dt><dd>{d.intake.source==="FOLDER"?"โฟลเดอร์ผล":"เลือกไฟล์จากเครื่อง"}{d.intake.relative_path&&<> · <span className="mono">{d.intake.relative_path}</span></>}</dd>
     <dt>SHA-256</dt><dd className="mono p5-hash">{v.sha256}</dd><dt>ขนาด</dt><dd>{bytes(d.intake.size)}</dd><dt>นำเข้าเมื่อ</dt><dd>{bkk(v.importedAt)}</dd>
     <dt>Template</dt><dd className="mono">{v.templateVersion}</dd><dt>Parser</dt><dd className="mono">{v.parserVersion}</dd>
    </dl>
   </section>

   <div className="p5-side">
    {canMaintain&&<section className="panel" aria-labelledby="reparse-h">
     <h2 id="reparse-h">อ่านต้นฉบับซ้ำเพื่อวินิจฉัย Parser</h2>
     <p className="help">สร้างหลักฐานจากไฟล์เดิมเท่านั้น ไม่แทนค่ารายงาน ไม่เปลี่ยนการเชื่อมโยง การตรวจทาน หรือการปล่อยผล หากต้องแก้ผลให้ใช้กระบวนการฉบับแก้ไขเดิม</p>
     {maintenanceError&&<p className="notice" role="alert">{maintenanceError} <button type="button" className="button small secondary" disabled={!!busy} onClick={()=>void loadDiagnostics()}>โหลดหลักฐานอีกครั้ง</button></p>}
     <form className="stack" onSubmit={e=>{e.preventDefault();void doReparse();}}><div className="field"><label htmlFor="reparse-reason">เหตุผลการอ่านซ้ำ (อย่างน้อย 8 ตัวอักษร)</label><input id="reparse-reason" value={reparseReason} minLength={8} maxLength={500} required onChange={e=>{setReparseReason(e.target.value);setReparseKey(crypto.randomUUID());}}/></div>
      <div className="action-bar"><button className="button secondary" disabled={!!busy}>{busy==="reparse"?"กำลังสร้างหลักฐาน…":"สร้างหลักฐานอ่านซ้ำ"}</button></div></form>
     <details><summary>หลักฐานอ่านซ้ำล่าสุด (สูงสุด 50 รายการ)</summary>{diagnostics.length?<ul>{diagnostics.map(e=><li key={e.id}>{bkk(e.createdAt)} · <span className="mono">{e.parserVersion}</span> · {e.outcome==="PARSED_DIAGNOSTIC"?"อ่านได้ (หลักฐานวินิจฉัยเท่านั้น)":`อ่านไม่ได้ (${e.rejectCode})`}<br/>{e.reason}<br/><span className="mono p5-hash">{e.id}</span></li>)}</ul>:<p className="help">ยังไม่มีหลักฐานอ่านซ้ำ</p>}</details>
    </section>}

    <section className="panel" aria-labelledby="values-h">
     <h2 id="values-h">ค่าที่อ่านได้จาก PDF</h2>
     {p.needsManualReview&&<p className="notice warning-notice">มีค่าที่อ่านแบบสำรองหรืออ่านไม่ได้ — ตรวจกับ PDF ต้นฉบับทุกค่า ค่าที่อ่านไม่ได้ถือเป็น Unknown ไม่ใช่ปกติ</p>}
     {isNotice&&<p className="notice">หนังสือแจ้ง — ไม่ใช่ผลตรวจ{p.noticeCategory?` (${p.noticeCategory})`:""} ไม่ทำให้สถานะหลักเป็น &ldquo;รายงานผล&rdquo;</p>}
     <div className="table-wrap" role="region" aria-label="ค่าที่อ่านได้" tabIndex={0}>
      <table className="data-table p5-values"><thead><tr><th scope="col">รายการ</th><th scope="col">ค่าและข้อความดิบใน PDF</th><th scope="col">วิธีอ่าน</th></tr></thead>
       <tbody>{[...ID_FIELDS.map(([k,l])=>[k,l,p.identifiers[k]] as const),...RESULT_FIELDS.map(([k,l])=>[k,l,p.results[k]] as const)].filter(([,,f])=>f&&f.method!=="NOT_APPLICABLE").map(([k,l,f])=>
        <tr key={k}><th scope="row">{l}</th><td><strong className={k==="hn"||k==="labNumber"?"mono":""}>{f!.value??"อ่านไม่ได้ (Unknown)"}</strong>{f!.raw&&<div className="p5-raw" title={f!.raw}>{f!.raw}</div>}</td><td><Status tone={METHOD_TONE[f!.method]}>{METHOD_TEXT[f!.method]??f!.method}</Status></td></tr>)}</tbody></table>
     </div>
    </section>

    <section className="panel" aria-labelledby="link-h">
     <h2 id="link-h">เชื่อมโยงกับรอบ / Attempt</h2>
     {d.nameConflicts.length>0&&<div className="notice warning-notice" role="note"><p><strong>ชื่อไฟล์ซ้ำกับรายงานอื่น {d.nameConflicts.length} รายการ แต่เนื้อหา (SHA-256) ต่างกัน</strong> — ระบบไม่ข้ามไฟล์และไม่สร้างฉบับแก้ไขอัตโนมัติ ผู้เสนอต้องระบุว่าเป็นรายงานใหม่หรือฉบับแก้ไข และผู้ยืนยันคนที่สองยืนยันการจัดประเภทเดียวกัน</p>
      <ul>{d.nameConflicts.map(c=><li key={c.id}><Link href={`/results/${c.id}`}>รายงานชื่อเดียวกัน</Link> · {STATE_TEXT[c.state]??c.state} · นำเข้า {bkk(c.importedAt)}</li>)}</ul></div>}
     <p className="help">ทุกรอบใช้ HIS LN เดิม — ต้องเลือกรอบและ Attempt ที่ถูกต้อง โดยเทียบหลายคุณสมบัติ ระบบไม่จับคู่อัตโนมัติด้วย HN หรือ LN อย่างเดียว และต้องมีผู้รับรองอีกคนยืนยัน</p>
     {d.target&&<><dl className="plan-dl p5-facts"><dt>เชื่อมกับ</dt><dd><span className="mono">{d.target.ln}</span> · รอบที่ {d.target.round_number}{d.target.current?" (รอบปัจจุบัน)":" (ไม่ใช่รอบปัจจุบัน)"}{d.target.attempt_number&&<> · Attempt {d.target.attempt_number} ({d.target.attempt_state})</>}</dd>
       <dt>LN Halos · Printed ID</dt><dd className="mono">{d.target.ln_halos??"—"} · {d.target.printed_sample_id??"—"}</dd></dl>
      {d.links.filter(l=>l.event==="APPROVED").slice(-1).map(l=><CrossTable key="x" cross={l.cross_check} caption="ผลเทียบตอนยืนยันการเชื่อมโยง"/>)}
      {d.can.unlink&&<form className="stack p5-inline-form" onSubmit={e=>{e.preventDefault();void act("unlink",{reason},"ถอดการเชื่อมโยงแล้ว — รายการกลับไปรอเชื่อมโยง").then(()=>setReason(""));}}>
       <div className="field"><label htmlFor="unlink-reason">เหตุผลที่ถอดการเชื่อมโยง</label><input id="unlink-reason" value={reason} onChange={e=>setReason(e.target.value)} minLength={8} maxLength={500} required/></div>
       <div className="action-bar"><button className="button secondary" disabled={!!busy}>{busy==="unlink"?"กำลังบันทึก…":"ถอดการเชื่อมโยง"}</button></div></form>}</>}
     {d.proposal&&<div className="stack">
      <p><Status tone="warning">มีข้อเสนอรอผู้รับรองคนที่สองยืนยัน</Status> · เสนอเมื่อ {bkk(d.proposal.created_at)} · {d.proposal.reason}{d.proposal.name_review&&<span className="badge warning">{d.proposal.name_review==="REVISION"?"จัดเป็นฉบับแก้ไข":"จัดเป็นรายงานใหม่"}</span>}</p>
      <CrossTable cross={d.proposal.cross_check} caption="ผลเทียบของข้อเสนอ"/>
      {d.can.decide?<form className="stack p5-inline-form" onSubmit={e=>{e.preventDefault();const which=(e.nativeEvent as SubmitEvent).submitter?.getAttribute("value")??"APPROVE";void act("decide",{decision:which,reason:decision},which==="APPROVE"?"ยืนยันการเชื่อมโยงแล้ว":"ปฏิเสธข้อเสนอแล้ว").then(()=>setDecision(""));}}>
       <div className="field"><label htmlFor="decide-reason">เหตุผลการตัดสิน (ผู้ยืนยันคนที่สอง)</label><input id="decide-reason" value={decision} onChange={e=>setDecision(e.target.value)} minLength={8} maxLength={500} required/></div>
       <div className="action-bar"><button className="button secondary" value="REJECT" disabled={!!busy}>ปฏิเสธข้อเสนอ</button><button className="button" value="APPROVE" disabled={!!busy}>{busy==="decide"?"กำลังบันทึก…":"ยืนยันการเชื่อมโยง"}</button></div></form>
       :<p className="help">ผู้เสนอยืนยันรายการของตนเองไม่ได้ — ต้องให้ผู้รับรองคนอื่นยืนยัน</p>}
     </div>}
     {v.state==="Unlinked"&&!d.proposal&&d.autoMatch&&d.can.propose&&<div className="notice success" role="status"><p><strong>ระบบจับคู่ได้ชัดเจน 1 รายการ</strong> — LN/HN/วันเกิด/ครรภ์/วันเจาะ/GA และเลข Lab ตรงกัน ไม่มีรายงานชื่อซ้ำหรือฉบับที่ค้าง ระบบไม่ส่งผล HIS อัตโนมัติ</p><div className="action-bar"><button type="button" className="button" disabled={!!busy} onClick={()=>void act("proposeAuto",{},"เสนอการเชื่อมโยงตามที่ระบบจับคู่แล้ว — รอผู้รับรองคนที่สองยืนยัน")}>{busy==="proposeAuto"?"กำลังส่ง…":"ใช้รายการที่ระบบจับคู่"}</button></div><p className="help">การเชื่อมโยงยังต้องให้ผู้รับรองคนที่สองยืนยันตามข้อกำหนดฐานข้อมูลปัจจุบัน</p></div>}
     {v.state==="Unlinked"&&!d.proposal&&(d.can.propose?<form className="stack" onSubmit={e=>{e.preventDefault();if(!picked)return;void act("propose",{roundId:picked.round.id,attemptId:isNotice?null:picked.attempt.id,reason,...(revise?{revision:rev}:{}),...(nameReview?{nameReview}:{})},"ส่งข้อเสนอการเชื่อมโยงแล้ว — รอผู้รับรองคนที่สองยืนยัน").then(r=>{if(r){setReason("");setChoice("");setRevise(false);setNameReview("");}});}}>
      <fieldset className="p5-candidates"><legend>เลือก{isNotice?"รอบที่ถูกสั่งเจาะซ้ำ":"รอบและ Attempt"} ({d.candidates.length} ตัวเลือก)</legend>
       {d.candidates.length?<div className="table-wrap" role="region" aria-label="ตัวเลือกการเชื่อมโยง" tabIndex={0}><table className="data-table"><thead><tr><th scope="col"><span className="sr-only">เลือก</span></th><th scope="col">LN · รอบ</th><th scope="col">Attempt</th><th scope="col">พบจาก</th>{CROSS_KEYS.slice(0,5).map(k=><th scope="col" key={k}>{CROSS_TEXT[k]}</th>)}</tr></thead>
        <tbody>{d.candidates.map(c=><tr key={c.attempt.id} className={choice===c.attempt.id?"selected":""}>
         <td><input type="radio" name="candidate" aria-label={`LN ${c.ln} รอบที่ ${c.round.number} Attempt ${c.attempt.number}`} checked={choice===c.attempt.id} onChange={()=>setChoice(c.attempt.id)}/></td>
         <td><span className="mono">{c.ln}</span> · รอบที่ {c.round.number}{c.round.current?<span className="badge">ปัจจุบัน</span>:<span className="badge warning">รอบก่อน</span>}<div className="help">เก็บ {c.round.collectionDate??"—"}</div></td>
         <td>{c.attempt.number} · {c.attempt.state}{!c.attempt.latest&&<span className="badge warning">ไม่ใช่ล่าสุด</span>}<div className="help mono">{c.attempt.printedSampleId??""}</div></td>
         <td>{c.matchedOn.join(", ")}</td>{CROSS_KEYS.slice(0,5).map(k=><td key={k}><Status tone={CMP_TONE[c.cross[k]]}>{CMP_TEXT[c.cross[k]]}</Status></td>)}</tr>)}</tbody></table></div>
        :<p className="empty-state">ไม่พบรอบ/Attempt ที่มี HN หรือเลข Lab ตรงกับ PDF — ตรวจว่าลงทะเบียนและรับสิ่งส่งตรวจแล้ว</p>}
      </fieldset>
      <div className="field"><label htmlFor="link-reason">เหตุผลที่เลือก (อย่างน้อย 8 ตัวอักษร)</label><input id="link-reason" value={reason} onChange={e=>setReason(e.target.value)} minLength={8} maxLength={500} required/></div>
      {d.nameConflicts.length>0?<fieldset className="p5-candidates"><legend>ไฟล์ชื่อซ้ำ — จัดประเภท (บังคับ)</legend>
       <label className="check-label"><input type="radio" name="name-review" checked={nameReview==="NEW_REPORT"} onChange={()=>{setNameReview("NEW_REPORT");setRevise(false);}} required/> รายงานใหม่ (ไม่ใช่การแก้ไขฉบับเดิม)</label>
       <label className="check-label"><input type="radio" name="name-review" checked={nameReview==="REVISION"} onChange={()=>{setNameReview("REVISION");setRevise(true);}}/> ฉบับแก้ไขของรายงานที่รอบนี้มีอยู่แล้ว</label></fieldset>
      :<label className="check-label"><input type="checkbox" checked={revise} onChange={e=>setRevise(e.target.checked)}/> เป็นฉบับแก้ไขของรายงานที่รอบนี้มีอยู่แล้ว</label>}
      {revise&&<fieldset className="form-grid"><legend>ข้อมูลคำขอแก้ไข</legend>
       <div className="field"><label htmlFor="rev-date">วันที่รับเรื่อง</label><ThaiDateInput id="rev-date" value={rev.receivedDate} onChange={v=>setRev({...rev,receivedDate:v})} required/></div>
       <div className="field"><label htmlFor="rev-by">ผู้ขอ / หน่วยงาน</label><input id="rev-by" value={rev.requestedBy} onChange={e=>setRev({...rev,requestedBy:e.target.value})} required/></div>
       <div className="field"><label htmlFor="rev-reason">เหตุผลการแก้ไข</label><input id="rev-reason" value={rev.reason} onChange={e=>setRev({...rev,reason:e.target.value})} minLength={8} required/></div></fieldset>}
      <div className="action-bar"><button className="button" disabled={!picked||!!busy||(d.nameConflicts.length>0&&!nameReview)}>{busy==="propose"?"กำลังส่ง…":"เสนอการเชื่อมโยง"}</button></div>
     </form>:<p className="help">รอผู้มีสิทธิ์เสนอการเชื่อมโยง (เจ้าหน้าที่ Lab)</p>)}
    </section>

    {d.gate&&<section className="panel" aria-labelledby="gate-h">
     <h2 id="gate-h">{d.gate.gate==="RG"?"Final Result Release Gate (RG-01 – RG-13)":"Redraw Notice Release Gate (RN-01 – RN-07)"}</h2>
     <p><Status tone={d.gate.eligible?"good":"bad"}>{d.gate.eligible?"ผ่านทุกข้อที่ประเมินก่อนรับรอง":`ไม่ผ่าน ${d.gate.failed.length} ข้อ · รอการตัดสินใจ ${d.gate.pending.length} ข้อ`}</Status>{d.gate.waitsForP4b&&<span className="badge warning">รอข้อมูล QC/วิเคราะห์จาก P4b</span>}</p>
     <ul className="p5-gates">{d.gate.predicates.map(g=><li key={g.code}><span className="mono p5-code">{g.code}</span><span className="p5-gate-name">{GATE_NAME[g.code]}</span><Status tone={TRI_TONE[g.status]}>{TRI_TEXT[g.status]}</Status><span className="help">{reasonText(g.reason)}{g.governance?` · ${g.governance}`:""}</span></li>)}</ul>
     {d.can.review&&<div className="action-bar"><button type="button" className="button secondary" disabled={!!busy} onClick={()=>void act("revalidate",{},"ประเมิน Gate ใหม่แล้ว")}>{busy==="revalidate"?"กำลังประเมิน…":"ประเมินใหม่"}</button></div>}
    </section>}

    {d.operational&&d.can.acceptRelease&&<section className="panel" aria-labelledby="accept-h">
     <h2 id="accept-h">ตรวจรับ PDF และยืนยันส่งผล</h2>
     <p className="help">รายงาน Final มาจากโปรแกรมวิเคราะห์ภายนอกที่รับรองผลแล้ว NIPT-CBH ไม่วิเคราะห์หรือรับรองผลทางคลินิกซ้ำ — ยืนยันครั้งเดียวเพื่อบันทึกการตรวจรับ PDF และส่งผล ระบบยังตรวจตัวตนผู้ป่วย ฉบับรายงาน ความยินยอม และ Gate ทุกข้อขณะกด</p>
     <label className="check-label"><input type="checkbox" checked={accept.external} onChange={e=>setAccept({...accept,external:e.target.checked})}/> รายงานฉบับนี้เป็น Final ที่ผ่านการรับรองจากระบบวิเคราะห์ภายนอกแล้ว</label>
     <label className="check-label"><input type="checkbox" checked={accept.identity} onChange={e=>setAccept({...accept,identity:e.target.checked})}/> ตรวจตัวตนผู้ป่วย (LN/HN/ชื่อ/วันเกิด) และค่าทุกค่าตรงกับ PDF ต้นฉบับแล้ว</label>
     <label className="check-label"><input type="checkbox" checked={accept.disclosure} onChange={e=>setAccept({...accept,disclosure:e.target.checked})}/> ตรวจความยินยอมและข้อมูลที่เปิดเผยในรายงานแล้ว</label>
     {p.abnormal&&<label className="check-label"><input type="checkbox" checked={certAck} onChange={e=>setCertAck(e.target.checked)}/> รับทราบผลผิดปกติ (High risk / Detected)</label>}
     <div className="action-bar"><button type="button" className="button" disabled={!!busy||!accept.external||!accept.identity||!accept.disclosure||(p.abnormal&&!certAck)} onClick={async()=>{const r=await act("acceptRelease",{idempotencyKey:certKey,externalFinalCertified:true,identityAndValuesMatchPdf:true,disclosureReviewed:true,abnormalAcknowledged:certAck},"บันทึกการตรวจรับและยืนยันส่งผลแล้ว");if(r){setOutcome(r as typeof outcome);setCertKey(key());setAccept({external:false,identity:false,disclosure:false});}}}>{busy==="acceptRelease"?"กำลังตรวจและบันทึก…":"ตรวจรับและยืนยันส่งผล"}</button></div>
     {outcome&&<div role="status" className={`notice ${outcome.outcome==="CertifiedReleased"?"":"warning-notice"}`}>{outcome.outcome==="CertifiedReleased"?<p><strong>ยืนยันส่งผลแล้ว</strong> — ระบบส่งไฟล์ไป HIS ตามคิว การส่งไฟล์ยังไม่ใช่หลักฐานว่า HIS รับผลแล้ว</p>:<><p><strong>ยังส่งผลไม่ได้</strong> — ไม่ผ่าน Gate</p><ul>{[...(outcome.failed??[]),...(outcome.pending??[])].map(x=>{const [code,...rest]=x.split(":");return <li key={x}>{code} {GATE_NAME[code]}: {reasonText(rest[rest.length-1])}</li>;})}</ul></>}</div>}
    </section>}

    {d.can.review&&!(d.operational&&d.can.acceptRelease)&&<section className="panel" aria-labelledby="review-h">
     <h2 id="review-h">ตรวจทานค่ากับ PDF</h2>
     <form className="stack" onSubmit={e=>{e.preventDefault();void act("review",{valuesMatchPdf:true,abnormalAcknowledged:ack,...(note?{note}:{})},"บันทึกการตรวจทานแล้ว").then(r=>{if(r){setValuesOk(false);setAck(false);setNote("");}});}}>
      <label className="check-label"><input type="checkbox" checked={valuesOk} onChange={e=>setValuesOk(e.target.checked)} required/> ตรวจแล้วว่าค่าทุกค่าตรงกับ PDF ต้นฉบับ</label>
      {p.abnormal&&<label className="check-label"><input type="checkbox" checked={ack} onChange={e=>setAck(e.target.checked)} required/> รับทราบว่าเป็นผลผิดปกติ (High risk / Detected)</label>}
      <div className="field"><label htmlFor="review-note">หมายเหตุ (ไม่บังคับ)</label><input id="review-note" value={note} onChange={e=>setNote(e.target.value)} maxLength={500}/></div>
      <div className="action-bar"><button className="button secondary" disabled={!valuesOk||!!busy}>{busy==="review"?"กำลังบันทึก…":"บันทึกการตรวจทาน"}</button></div>
     </form>
     <p className="help">OD-04: ผู้ตรวจทานเป็นคนเดียวกับผู้รับรองได้หากได้รับสิทธิ์ — Clinical Governance ยังไม่ลงนาม</p>
    </section>}

    {d.can.certify&&!(d.operational&&d.can.acceptRelease)&&<section className="panel" aria-labelledby="certify-h">
     <h2 id="certify-h">รับรองและส่งผล</h2>
     {d.operational?<><p className="help">ทบทวน QC5 และยืนยันการรับรอง ระบบตรวจสิทธิ์และหลักฐานปัจจุบันก่อนปล่อยผลทุกครั้ง</p><fieldset><legend>QC5 ของ PDF ฉบับนี้</legend><label htmlFor="qc5-criteria">เอกสาร / เกณฑ์ที่ใช้ทบทวน</label><input id="qc5-criteria" value={qcCriteria} onChange={e=>setQcCriteria(e.target.value)}/><label htmlFor="qc5-reason">ผลทบทวน</label><textarea id="qc5-reason" value={qcReason} onChange={e=>setQcReason(e.target.value)}/><label className="check-label"><input type="checkbox" checked={qcTemplate} onChange={e=>setQcTemplate(e.target.checked)}/> ตรวจรูปแบบและค่ากับ PDF ต้นฉบับแล้ว</label><label className="check-label"><input type="checkbox" checked={qcDisclosure} onChange={e=>setQcDisclosure(e.target.checked)}/> ตรวจความยินยอมและข้อมูลที่เปิดเผยในรายงานแล้ว</label><button className="button secondary" disabled={!!busy||!qcTemplate||!qcDisclosure||qcCriteria.trim().length<8||qcReason.trim().length<8} onClick={()=>void act('qc5',{criteriaReference:qcCriteria,reason:qcReason,templateReviewed:true,disclosureReviewed:true,abnormalAcknowledged:certAck},'บันทึก QC5 แล้ว')}>ยืนยัน QC5</button></fieldset><label className="check-label"><input type="checkbox" checked={confirmCertification} onChange={e=>setConfirmCertification(e.target.checked)}/> ยืนยันรับรองผลด้วยบัญชีของฉัน</label></>:<p className="help">ระบบประเมิน Gate ใหม่ทั้งหมดในขณะกด และบันทึกผลการประเมินทุกครั้ง ในระยะนี้แม้ผ่าน Gate ก็จะไม่ปล่อยผล (AL-5 / OD-05 / OD-07)</p>}
     {p.abnormal&&<label className="check-label"><input type="checkbox" checked={certAck} onChange={e=>setCertAck(e.target.checked)}/> รับทราบผลผิดปกติก่อนรับรอง</label>}
     <div className="action-bar"><button type="button" className="button" disabled={!!busy||(p.abnormal&&!certAck)||(d.operational&&!confirmCertification)} onClick={async()=>{const r=await act("certify",{idempotencyKey:certKey,abnormalAcknowledged:certAck,...(d.operational?{confirmed:true}:{})},"บันทึกการประเมินขณะรับรองแล้ว");if(r){setOutcome(r as typeof outcome);setCertKey(key());}}}>{busy==="certify"?"กำลังประเมิน…":"รับรองและส่งผล"}</button></div>
     {outcome&&<div role="status" className={`notice ${outcome.outcome==="RELEASE_HOLD"?"warning-notice":""}`}>
      {outcome.outcome==='CertifiedReleased'?<p><strong>รับรองและปล่อยผลแล้ว</strong> — ตรวจสถานะการส่งไฟล์ในประวัติ HIS/CFS การส่งไฟล์ยังไม่ใช่หลักฐานว่า HIS รับผลแล้ว</p>:outcome.outcome==="RELEASE_HOLD"?<p><strong>ผ่าน Gate แต่ยังไม่ปล่อยผล</strong> — การปล่อยผลจริงถูกระงับจนกว่า AL-5 ผ่าน</p>
       :<><p><strong>รับรองไม่ได้</strong> — ไม่ผ่าน Gate</p><ul>{[...(outcome.failed??[]),...(outcome.pending??[])].map(x=>{const [code,...rest]=x.split(":");return <li key={x}>{code} {GATE_NAME[code]}: {reasonText(rest[rest.length-1])}</li>;})}</ul></>}
     </div>}
    </section>}

    {d.can.void&&<section className="panel" aria-labelledby="void-h">
     <h2 id="void-h">ยกเลิกรายการนำเข้า</h2>
     <form className="stack" onSubmit={e=>{e.preventDefault();if(window.confirm("ยืนยันยกเลิกรายการนำเข้านี้? ไฟล์ต้นฉบับและประวัติยังถูกเก็บไว้"))void act("void",{reason:voidReason},"ยกเลิกรายการนำเข้าแล้ว");}}>
      <div className="field"><label htmlFor="void-reason">เหตุผล</label><input id="void-reason" value={voidReason} onChange={e=>setVoidReason(e.target.value)} minLength={8} maxLength={500} required/></div>
      <div className="action-bar"><button className="button danger" disabled={!!busy}>ยกเลิกรายการนำเข้า</button></div></form>
    </section>}

    <section className="panel" aria-labelledby="hist-h"><h2 id="hist-h">ประวัติ</h2>
     <ol className="timeline">{history.map((h,i)=><li key={i}><div className="row"><strong>{bkk(h.at)}</strong><span>{h.who??"ระบบ"}</span></div><div>{h.text}</div></li>)}</ol></section>
   </div>
  </div>
 </>;
}
