"use client";
import "./batch-workspace.css";
import {useCallback,useEffect,useState,type KeyboardEvent} from "react";
import Link from "next/link";
import {useRouter,useSearchParams} from "next/navigation";
import {Dialog,csrf} from "../p2/shared";
import {labApi,labPdf,failureText,bkk,gateText,LabFailure} from "./lab-api";
import {stripLabels,type SheetNumber} from "../../../packages/lab/rules";
import {displayBe} from "../../../packages/domain/thai-date";
import {ThaiDateInput,ThaiDateTimeInput} from "../shared/thai-date-input";
import {gaBadge,type Ga} from "./ga-badge";

type Sheet={id:string;sheet_number:number;state:string;planned_work_date:string|null;planned_operator:string|null;planned_extraction_lot:string|null;planned_extraction_expiry:string|null;planned_library_lot:string|null;planned_library_expiry:string|null;placement_revision:number;plan_checked_at:string|null;execution_started_at:string|null;execution_ended_at:string|null;verified_at:string|null};
type Slot={slot:number;sheet:number;plate:string;barcode:number;control:string|null;controlLabel:string|null;controlCode:string|null;assignment:null|{attemptId:string;roundNumber:number;hisLn:string;hn:string|null;lnHalos:string|null;labelCode:string|null;printedSampleId:string|null;attemptState:string;repeat:boolean;urgent:boolean;ga:Ga;labelPrints:number}};
type Doc={id:string;form:string;kind:string;revision:number;doc_code:string;status:string;status_reason:string|null;issued_at:string;issued_by:string;sheet_number:number|null;working_copies:number;unrecalled:number};
type Obs={id:string;sheetId:string|null;slot:number|null;fieldId:string;item:string;label:string;cls:string;valueText:string;source:string;eventTime:string|null;eventPrecision:string;recordedAt:string;recorder:string;recordedBy:string;reviewer:string|null;status:string;candidates:{code:string;approved:boolean;outcome:string}[]|null};
type Field={id:string;item:string;form:string;scope:string;kind:string;cls:string;label:string;source:string;sheets:number[]};
type Disp={id:string;slot_number:number;stage:string;disposition:string;reason_code:string;note:string;proposer:string;proposed_by:string;confirmer:string|null;confirmed_at:string|null};
type Copy={id:string;document_id:string;kind:string;copy_number:number|null;created_at:string;recalled_at:string|null;actor:string;document_status:string;doc_code:string;revision:number};
export type Workspace={urgent40?:boolean;operational?:boolean;batch:{id:string;runLabel:string;state:string;version:number;templateVersion:string;formulaVersion:string;cancelReason:string|null};sheets:Sheet[];slots:Slot[];documents:Doc[];events:{event_type:string;sheet_number:number|null;reason:string|null;created_at:string;actor:string}[];snapshots:{id:string;sheet_number:number;revision:number;content_hash:string;created_at:string}[];
 observations:Obs[];dispositions:Disp[];copies:Copy[];completeness:{sheet:number;ready:boolean;missingFields:{id:string;item:string;label:string}[];slots:{slot:number;status:string}[];open:number}[];policy:string;
 qc:{ready:boolean;rows:{slot:number;status:string;decision:string|null;observationId:string|null;attemptId:string|null}[];standards:({id:string;status:string}|null)[];operator:{id:string;status:string}|null};fields:Field[];criteria:{code:string;label:string}[];dispositionReasons:string[];
 allowed:Record<"draft"|"assign"|"finalize"|"amend"|"unlock"|"execute"|"transcribe"|"verify"|"qcRecord"|"qcAccept"|"dispositionPropose"|"dispositionConfirm"|"recall"|"obsoletePrint"|"labels",boolean>};

const STEPS=["Draft","PlanChecked","PlacementFinalized","PreWorkIssued","InExecution","ExecutionRecorded","ExecutionVerified","CompletedIssued"];
const STEP_TEXT:Record<string,string>={Draft:"ร่างแผน",PlanChecked:"ยืนยันแผนแล้ว",PlacementFinalized:"ล็อกตำแหน่ง",PreWorkIssued:"ออกใบงานก่อนทำ",InExecution:"กำลังปฏิบัติ",ExecutionRecorded:"บันทึกจบแล้ว",ExecutionVerified:"ทวนสอบแล้ว",CompletedIssued:"ออกบันทึกหลังทำ",Amended:"แก้แผน (Amendment)",Cancelled:"ยกเลิก"};
const EDITABLE=["Draft","PlanChecked","Amended"],STARTED=["InExecution","ExecutionRecorded","ExecutionVerified","CompletedIssued"];
const DOC_STATUS:Record<string,string>={Issued:"มีผล",StopUse:"ระงับใช้",Superseded:"ถูกแทนที่",Cancelled:"ยกเลิก"};
const BATCH_STATE:Record<string,string>={Draft:"ร่าง",InPreparation:"เตรียมงาน",ExtractionLibrary:"Extraction/Library เสร็จ",QC1Complete:"QC1 บันทึกครบ",Cancelled:"ยกเลิก"};
const DISP_TEXT:Record<string,string>={MEASURED:"ทำแล้ว (ทวนสอบ)",REQUIRED_PENDING:"รอบันทึก",NOT_APPLICABLE:"ไม่มีตัวอย่าง",NOT_PERFORMED:"ไม่ได้ทำ",EXCLUDED:"ถอดออก",STOPPED:"หยุด",AWAITING_DECISION:"รอตัดสิน QC1"};
const OUTCOME:Record<string,string>={WITHIN:"อยู่ในช่วง",BELOW_MIN:"ต่ำกว่าช่วง",ABOVE_MAX:"สูงกว่าช่วง",NOT_APPLICABLE:"ไม่ใช้กับแถวนี้"};
/** Non-blocking server warnings (records.ts) that must be shown, never swallowed (RC7). */
const WARNING_TEXT:Record<string,string>={LOT_EXPIRED_BEFORE_WORK_DATE_OD33:"คำเตือน: วันหมดอายุของ Lot อยู่ก่อนวันปฏิบัติงาน — ตรวจสอบก่อนใช้ (บันทึกแล้ว ไม่ได้บล็อก)"};
/** Per-Task counts for the tab chips and context header. Controls are never counted as patients. */
function sheetStats(slots:Slot[],n:number){
 const own=slots.filter(s=>s.sheet===n),patientSlots=own.filter(s=>!s.control),placed=patientSlots.filter(s=>s.assignment).length;
 return {placed,capacity:patientSlots.length,empty:patientSlots.length-placed,control:own.find(s=>s.control)??null};
}

export function BatchWorkspace({initial,userId}:{initial:Workspace;userId:string}){
 const router=useRouter();const requested=Number(useSearchParams().get("task"));
 const [w,setW]=useState(initial),[sheetNo,setSheetNoState]=useState(()=>[1,2,3].includes(requested)?requested:initial.sheets.find(s=>s.state!=="Draft"||initial.slots.some(x=>x.sheet===s.sheet_number&&x.assignment))?.sheet_number??1);
 // The selected Task is kept in the URL (?task=N) so reload/share returns to the same Task without a navigation.
 const setSheetNo=(n:number)=>{setSheetNoState(n);const url=new URL(window.location.href);url.searchParams.set("task",String(n));window.history.replaceState(window.history.state,"",url);};
 const [msg,setMsg]=useState<{ok:boolean;text:string;details?:unknown;warnings?:string[]}|null>(null),[busy,setBusy]=useState(false),[dialog,setDialog]=useState<null|{type:string;slot?:number}>(null);
 // Unsaved PlanForm edits belong to one Task only: switching Task never carries them over (RC1).
 const [planDirty,setPlanDirty]=useState(false),[pendingSheet,setPendingSheet]=useState<number|null>(null);
 const selectSheet=(n:number)=>{if(n===sheetNo)return;if(planDirty){setPendingSheet(n);return;}setPendingSheet(null);setSheetNo(n);};
 const discardAndSwitch=()=>{if(pendingSheet===null)return;setPlanDirty(false);setSheetNo(pendingSheet);setPendingSheet(null);};
 // WAI-ARIA tabs: arrows/Home/End move between Task List 1–3 (roving tabindex); the unsaved-edit guard still applies.
 const tabKeys=(e:KeyboardEvent<HTMLDivElement>)=>{
  const target={ArrowRight:sheetNo%3+1,ArrowLeft:(sheetNo+1)%3+1,Home:1,End:3}[e.key];if(!target)return;e.preventDefault();
  selectSheet(target);if(!planDirty)requestAnimationFrame(()=>document.getElementById(`sheet-${target}`)?.focus());
 };
 const sheet=w.sheets[sheetNo-1],slots=w.slots.filter(s=>s.sheet===sheetNo),comp=w.completeness[sheetNo-1];
 const editable=EDITABLE.includes(sheet.state)&&w.batch.state!=="Cancelled",started=STARTED.includes(sheet.state);
 const reload=async()=>setW(await labApi<Workspace>(`/api/p4/batches/${w.batch.id}`));
 async function act(action:string,data:Record<string,unknown>={},ok="บันทึกแล้ว"){setBusy(true);setMsg(null);try{const res=await labApi<{warnings?:unknown}>(`/api/p4/batches/${w.batch.id}`,{action,expectedVersion:w.batch.version,...data});await reload();
   const warnings=Array.isArray(res?.warnings)?res.warnings.filter((x):x is string=>typeof x==="string"):[];setMsg({ok:true,text:ok,warnings});return true;}
  catch(e){setMsg({ok:false,text:failureText(e),details:e instanceof LabFailure?e.details:undefined});if(e instanceof LabFailure&&e.code==="VERSION_CONFLICT")await reload();return false;}finally{setBusy(false);}}
 /** Uncontrolled per-Task PDF from the existing workbook path (P0-5): rebinds the draft from the Lab source when needed,
  *  then renders that Task's master sheet natively. Controlled documents are still only Pre-work/Completed issue. */
 async function taskPdf(n:number,mode:"view"|"download"){
  setBusy(true);setMsg(null);
  try{
   const api=`/api/workbook/batches/${w.batch.id}`;
   type Ws={version:number;draft:{revision:number}|null;sourceStale:boolean;values:Record<string,unknown>};
   let ws=await labApi<Ws>(api);
   if(!ws.draft||ws.sourceStale){await labApi(api,{action:"saveDraft",expectedVersion:ws.version,expectedRevision:ws.draft?.revision??0,values:ws.values});ws=await labApi<Ws>(api);}
   const sheetName=`Ext. & Prep. Task List ${n}`;
   const r=await fetch(api,{method:"POST",cache:"no-store",headers:{"content-type":"application/json","x-csrf-token":csrf()},body:JSON.stringify({action:"export",revision:ws.draft!.revision,format:"PDF",sheet:sheetName})});
   if(!r.ok){const d=await r.json().catch(()=>({}));throw new LabFailure(d.code??"REQUEST_FAILED",d.error??"ออก PDF ไม่สำเร็จ",d.details,r.status);}
   const url=URL.createObjectURL(await r.blob());
   if(mode==="view")window.open(url,"_blank","noopener");else{const a=document.createElement("a");a.href=url;a.download=`${w.batch.runLabel.replace("/","-")}_Task-List-${n}_uncontrolled.pdf`;a.click();}
   setTimeout(()=>URL.revokeObjectURL(url),60000);
   setMsg({ok:true,text:`สร้าง PDF ของ Task List ${n} แล้ว (สำเนาตรวจทาน — ไม่ใช่เอกสารควบคุม)`});
  }catch(e){setMsg({ok:false,text:failureText(e)});}finally{setBusy(false);}
 }
 async function pdf(id:string,kind:string,reason?:string){setMsg(null);try{await labPdf(`/api/p4/documents/${id}`,{kind,...(reason?{reason}:{})});await reload();}catch(e){setMsg({ok:false,text:failureText(e)});}}
 const sheetDocs=w.documents.filter(d=>d.sheet_number===sheetNo);
 const preWork=sheetDocs.find(d=>d.form==="F2"&&d.kind==="PRE_WORK"&&d.status==="Issued");
 const copiesForPreWork=w.copies.filter(c=>preWork&&c.document_id===preWork.id&&c.kind==="WORKING_COPY"&&!c.recalled_at);
 const transfer=(slot:number)=>comp.slots.find(s=>s.slot===slot)?.status??"NOT_APPLICABLE";
 const finalizedAny=w.sheets.some(s=>s.placement_revision>0&&s.state!=="Cancelled"&&!EDITABLE.includes(s.state));
 const qcOpen=w.sheets.some(s=>["ExecutionRecorded","ExecutionVerified","CompletedIssued"].includes(s.state));
 return <>
  <header className="page-header"><div><p className="muted"><Link href="/lab/batches">Batch / Task List</Link></p><h1>{w.batch.runLabel}</h1><p className="muted">สถานะ Batch: <strong>{BATCH_STATE[w.batch.state]??w.batch.state}</strong> · ฉบับ {w.batch.version}{!w.operational&&<> · Template {w.batch.templateVersion} · Formula {w.batch.formulaVersion}</>}</p></div>
   {w.batch.state!=="Cancelled"&&(w.allowed.draft||w.allowed.unlock)&&<button className="button secondary" type="button" onClick={()=>setDialog({type:"cancel"})}>ยกเลิก Batch</button>}</header>
  {w.batch.cancelReason&&<p className="notice" role="note">Batch ถูกยกเลิก: {w.batch.cancelReason}</p>}
  <nav className="action-bar" aria-label="งานประจำ Run">{w.operational&&<><Link className="button" href={`/lab/batches/${w.batch.id}/bench`}>QC Measurements</Link><Link className="button secondary" href={`/lab/batches/${w.batch.id}/pooling`}>Pooling / QC2 / F4</Link><Link className="button secondary" href={`/lab/batches/${w.batch.id}/sequencing`}>DNB / Sequencing / F5</Link></>}<Link className="button secondary" href={`/lab/batches/${w.batch.id}/workbook`}>ใบงาน Excel / PDF</Link></nav>
  {!w.operational&&w.policy==="PROCEED_SYNTHETIC_LABELLED"&&<p className="notice warning-notice" role="note">ข้อมูลจำลอง: Gate ที่ยังรอการตัดสิน (OD-01/08/16) ผ่านด้วยนโยบายจำลองและถูกระบุบนใบงาน — ไม่ใช่การรับรองทางคลินิก</p>}
  {msg&&<div className={`notice${msg.ok?" success":""}`} role={msg.ok?"status":"alert"}>{msg.text}{Array.isArray(msg.details)&&<ul>{(msg.details as {slot:number;failed:string[];pending:string[]}[]).map((d,i)=><li key={i}>ตน. {d.slot??"-"}: {[...(d.failed??[]),...(d.pending??[])].map(gateText).join(", ")}</li>)}</ul>}
   {msg.details&&!Array.isArray(msg.details)&&typeof msg.details==="object"?<pre className="details">{JSON.stringify(msg.details,null,1)}</pre>:null}</div>}
  {msg?.warnings?.map(code=><p key={code} className="notice warning-notice" role="alert">{WARNING_TEXT[code]??`คำเตือน: ${code}`}</p>)}
  <div className="tabs task-tabs" role="tablist" aria-label="Task List" onKeyDown={tabKeys}>{w.sheets.map(s=>{const st=sheetStats(w.slots,s.sheet_number);
   return <button key={s.id} type="button" role="tab" id={`sheet-${s.sheet_number}`} aria-selected={s.sheet_number===sheetNo} tabIndex={s.sheet_number===sheetNo?0:-1} aria-controls="sheet-panel" className="tab" onClick={()=>selectSheet(s.sheet_number)}>
    Task List {s.sheet_number} <span className="count">{STEP_TEXT[s.state]??s.state}</span>
    <span className="tab-meta">ผู้ป่วย {st.placed}/{st.capacity} · ว่าง {st.empty}</span></button>;})}</div>
  {pendingSheet!==null&&<div className="notice warning-notice" role="alert">Task List {sheetNo} มีข้อมูลแผนที่ยังไม่บันทึก — บันทึกก่อน หรือทิ้งการแก้ไขเพื่อไป Task List {pendingSheet}
   <div className="row-actions"><button className="button small secondary" type="button" onClick={()=>setPendingSheet(null)}>กลับไปแก้ไข Task List {sheetNo}</button><button className="button small secondary" type="button" onClick={discardAndSwitch}>ทิ้งการแก้ไขและไป Task List {pendingSheet}</button></div></div>}
  <section id="sheet-panel" role="tabpanel" aria-labelledby={`sheet-${sheetNo}`} className="panel stack lab-task-panel">
   <div className="action-bar"><Link className="button" href={`/lab/batches/${w.batch.id}/bench`}>QC Measurements → Pooling → Seq Task-G50</Link></div>
   {w.allowed.draft&&w.batch.state==="Draft"&&!w.slots.some(s=>s.assignment)&&<div className="action-bar"><button className="button secondary" type="button" disabled={busy} onClick={async()=>{if(!window.confirm("ลบ Batch ร่างที่ยังไม่มีตัวอย่างหรือเอกสารเชื่อมโยงนี้?"))return;setBusy(true);try{await labApi(`/api/p4/batches/${w.batch.id}`,{action:"deleteDraft",expectedVersion:w.batch.version});router.push("/lab/batches");router.refresh();}catch(e){setMsg({ok:false,text:failureText(e)});setBusy(false);}}}>ลบ Batch</button></div>}
   {sheetNo===3&&editable&&w.allowed.draft&&<label className="check-label"><input type="checkbox" checked={w.urgent40===true} disabled={busy||!!w.slots.find(s=>s.slot===40)?.assignment||sheet.placement_revision>0} onChange={e=>void act("urgent40",{enabled:e.target.checked},"บันทึกการใช้ช่อง 40 แล้ว")}/>ใช้ช่อง 40 สำหรับผู้ป่วย Urgent แทน BLANK (สูงสุด 46 ผู้ป่วย)</label>}
   {!w.operational&&<ol className="stepper" aria-label="ขั้นตอนของ Task List">{STEPS.map((s,i)=>{const idx=STEPS.indexOf(sheet.state==="Amended"?"Draft":sheet.state);return <li key={s} aria-current={s===sheet.state?"step":undefined} className={i<idx?"done":i===idx?"current":""}>{STEP_TEXT[s]}</li>;})}</ol>}
   {sheet.state==="Amended"&&<p className="notice warning-notice">อยู่ระหว่าง Controlled amendment — ใบงานเดิมถูกระงับใช้ แก้แผนแล้วยืนยัน/Finalize ใหม่ (สร้าง Revision ใหม่ ของเดิมไม่ถูกแก้)</p>}
   <TaskContext w={w} sheet={sheet} sheetNo={sheetNo}/>
   <div className="row"><h2>แผนผังตัวอย่าง — ตำแหน่ง {(sheetNo-1)*16+1}–{sheetNo*16}</h2>{editable&&w.allowed.assign&&<button className="button secondary" type="button" disabled={busy||sheetStats(w.slots,sheetNo).empty===0} onClick={()=>setDialog({type:"fill"})}>เติมตัวอย่างจากคิว</button>}</div>
   <div className="plate">{[0,1].map(strip=><table key={strip} className="data-table plate-table"><caption>Strip {strip===0?"S1":"S2"} (ตำแหน่ง {(sheetNo-1)*16+1+strip*8}–{(sheetNo-1)*16+8+strip*8})</caption>
    <thead><tr><th scope="col">ตน. / Plate</th><th scope="col">Barcode</th><th scope="col">Sample ID / Control</th><th scope="col">{started?"✓ ตรวจก่อน/หลังดูด":"จัดการ"}</th></tr></thead>
    <tbody>{slots.slice(strip*8,strip*8+8).map(s=><tr key={s.slot} className={s.control?"control-row":s.assignment?"":"empty-row"}>
     <th scope="row">{s.slot}<div className="small muted">{s.plate}</div></th><td className="mono">{s.barcode}</td>
     <td>{s.control?<><span className="badge">{s.controlLabel}</span> <span className="mono">{s.controlCode??"(ต้องระบุวันที่ปฏิบัติงาน)"}</span></>:s.assignment?<><span className="mono strong">{s.assignment.printedSampleId}</span><div className="small">LN {s.assignment.hisLn} · HN {s.assignment.hn??"—"} · รอบที่ {s.assignment.roundNumber}{s.assignment.repeat?" · ตรวจซ้ำ":""}{s.assignment.attemptState==="Stopped"?" · หยุด":""} {gaBadge(s.assignment.ga)}{s.assignment.labelPrints===0&&<span className="badge warning" title="แจ้งเตือนเท่านั้น — จัดตำแหน่งต่อได้ พิมพ์ฉลากจากคิวงาน Lab ก่อนเริ่มปฏิบัติงาน">ยังไม่พิมพ์ฉลาก</span>}</div></>:<span className="muted">ว่าง</span>}</td>
     <td>{editable&&s.assignment&&w.allowed.draft?<div className="row-actions"><button className="button small secondary" type="button" onClick={()=>setDialog({type:"move",slot:s.slot})}>ย้าย/สลับ</button><button className="button small secondary" type="button" onClick={()=>setDialog({type:"remove",slot:s.slot})}>ถอดออก</button></div>
      :started&&(s.control||s.assignment)?<TransferCell status={transfer(s.slot)} canRecord={sheet.state==="InExecution"||sheet.state==="ExecutionRecorded"} canDispose={w.allowed.dispositionPropose} onRecord={()=>setDialog({type:"transfer",slot:s.slot})} onDispose={()=>setDialog({type:"dispose",slot:s.slot})}/>:"—"}</td></tr>)}</tbody></table>)}</div>
   {editable&&<PlanForm key={`${sheet.id}:${w.batch.version}`} sheet={sheet} disabled={busy||!w.allowed.draft} onDirty={setPlanDirty} onSave={async d=>{const ok=await act("updatePlan",{sheetNumber:sheetNo,...d},"บันทึกข้อมูลแผนแล้ว");if(ok)setPlanDirty(false);return ok;}}/>}
   {!editable&&<dl className="plan-dl"><dt>ข้อมูลที่วางแผน</dt><dd>วันที่ทำ Library Preparation {displayBe(sheet.planned_work_date)} · ผู้ปฏิบัติ {sheet.planned_operator??"—"} · Extraction Lot {sheet.planned_extraction_lot??"—"} / Exp. {displayBe(sheet.planned_extraction_expiry)} · Library Lot {sheet.planned_library_lot??"—"} / Exp. {displayBe(sheet.planned_library_expiry)}</dd><dt>Placement revision</dt><dd>{sheet.placement_revision} {w.snapshots.filter(x=>x.sheet_number===sheetNo).map(x=><span key={x.id} className="mono small"> r{x.revision}:{x.content_hash.slice(0,12)}</span>)}</dd>
    {sheet.execution_started_at&&<><dt>เริ่มปฏิบัติ (เวลาที่ Server บันทึก)</dt><dd>{bkk(sheet.execution_started_at)}</dd></>}</dl>}
   <div className="action-bar">
    {(sheet.state==="Draft"||sheet.state==="Amended")&&w.allowed.finalize&&<button className="button" type="button" disabled={busy} onClick={()=>setDialog({type:"plancheck"})}>ยืนยันแผนตำแหน่ง</button>}
    {sheet.state==="PlanChecked"&&w.allowed.finalize&&<button className="button" type="button" disabled={busy} onClick={()=>act("finalize",{sheetNumber:sheetNo},"ล็อกตำแหน่งแล้ว — ใช้รหัสจากฉบับนี้ในใบงาน")}>ล็อกตำแหน่ง Task List</button>}
    {!w.operational&&sheet.state==="PlacementFinalized"&&w.allowed.finalize&&<button className="button" type="button" disabled={busy} onClick={()=>act("issuePreWork",{sheetNumber:sheetNo},"ออกใบงาน Pre-work (F2) แล้ว")}>ออกใบงาน Pre-work (F2)</button>}
    {["PlacementFinalized","PreWorkIssued"].includes(sheet.state)&&w.allowed.amend&&<button className="button secondary" type="button" disabled={busy} onClick={()=>setDialog({type:"amend"})}>Controlled amendment</button>}
    {!w.operational&&sheet.state==="PreWorkIssued"&&w.allowed.execute&&<button className="button" type="button" disabled={busy} onClick={()=>act("start",{sheetNumber:sheetNo},"บันทึกเริ่มปฏิบัติแล้ว (เวลา Server)")}>เริ่มปฏิบัติงานจริง</button>}
    {!w.operational&&sheet.state==="InExecution"&&w.allowed.execute&&<button className="button secondary" type="button" disabled={busy} onClick={()=>act("end",{sheetNumber:sheetNo},"บันทึกจบการปฏิบัติแล้ว")}>บันทึกจบการปฏิบัติ</button>}
    {!w.operational&&sheet.state==="ExecutionRecorded"&&w.allowed.verify&&<button className="button" type="button" disabled={busy||!comp.ready} onClick={()=>act("verify",{sheetNumber:sheetNo},"ทวนสอบหลักฐานการปฏิบัติครบแล้ว")}>ยืนยัน Execution Verified</button>}
    {!w.operational&&sheet.state==="ExecutionVerified"&&w.allowed.execute&&<button className="button" type="button" disabled={busy} onClick={()=>act("issueCompleted",{sheetNumber:sheetNo},"ออกบันทึกหลังปฏิบัติ (F2 Completed) แล้ว")}>ออก F2 Completed</button>}
   </div>
   <div className="action-bar" aria-label={`PDF ของ Task List ${sheetNo}`}>
    {sheet.placement_revision>0&&sheet.state!=="Cancelled"&&w.allowed.execute?<>
     <button className="button secondary" type="button" disabled={busy} onClick={()=>void taskPdf(sheetNo,"view")}>ดูตัวอย่าง PDF Task List {sheetNo}</button>
     <button className="button secondary" type="button" disabled={busy} onClick={()=>void taskPdf(sheetNo,"download")}>ดาวน์โหลด PDF Task List {sheetNo}</button>
     <span className="help">{w.operational?"PDF ผูกกับตำแหน่งและวันที่ใน Task List ฉบับนี้ พิมพ์เพื่อบันทึกการทำงานบนกระดาษได้":"สำเนาตรวจทานจาก Excel Master — ไม่ใช่เอกสารควบคุม"}</span></>
    :editable&&w.allowed.draft?<><button className="button secondary" type="button" disabled={busy} onClick={()=>void labPdf(`/api/p4/batches/${w.batch.id}/draft-pdf`,{sheetNumber:sheetNo}).catch(e=>setMsg({ok:false,text:failureText(e)}))}>ดูตัวอย่าง PDF ฉบับร่าง (DRAFT)</button>
     <span className="help">ฉบับร่างก่อน Finalize มีลายน้ำ DRAFT — ไม่ใช่เอกสารควบคุม ไม่มีเลขเอกสาร และใช้ปฏิบัติงานไม่ได้ · PDF จาก Excel Master พร้อมเมื่อ Finalize แล้ว</span></>
    :<span className="help">PDF ของ Task List {sheetNo} พร้อมเมื่อ Finalize Placement แล้ว</span>}
   </div>
   {sheet.state==="PlanChecked"&&<p className="help">การยืนยันแผนคือการตรวจแผนบนจอ ไม่ใช่หลักฐานว่าดูดตัวอย่างแล้ว · Finalize จะประเมิน Finalize Gate ใหม่ทุกตัวอย่าง — ถ้าตัวใดไม่ผ่านจะไม่ Finalize ทั้ง Sheet</p>}
   {sheet.state==="PlacementFinalized"&&<p className="help">ล็อกเฉพาะแผนตำแหน่ง — ยังไม่มีการบันทึก ✓ การดูด ใบงาน Pre-work มีเพียงช่องว่างสำหรับเขียนระหว่างปฏิบัติ</p>}
   {started&&<ExecutionPanel w={w} sheet={sheet} comp={comp} copies={copiesForPreWork} busy={busy} act={act} userId={userId}/>}
  </section>
  {qcOpen&&<QcPanel w={w} busy={busy} act={act} userId={userId}/>}
  <section className="panel" aria-labelledby="docs-h"><h2 id="docs-h">เอกสาร (Issued original และสำเนา)</h2>
   {w.operational&&<p className="help">สำเนามีเลขกำกับและสถานะของฉบับ โปรดตรวจเทียบทะเบียนก่อนใช้ เอกสารที่ระงับใช้หรือถูกแทนที่ต้องเรียกคืนตามขั้นตอน</p>}
   <div className="action-bar">{finalizedAny&&w.allowed.finalize&&w.batch.state!=="Cancelled"&&<button className="button secondary" type="button" disabled={busy} onClick={()=>act("issueQcPreWork",{},"ออก/ปรับ F3 Pre-work แล้ว")}>ออก F3 QC1 Pre-work</button>}
    {qcOpen&&w.allowed.qcRecord&&w.batch.state==="ExtractionLibrary"&&<button className="button" type="button" disabled={busy||!w.qc.ready} onClick={()=>act("issueQcCompleted",{},"ออก F3 Completed แล้ว")}>ออก F3 Completed</button>}</div>
   {w.documents.length===0?<p className="empty-state">ยังไม่มีเอกสารที่ออก — Draft แสดงบนจอเท่านั้นและพิมพ์ไม่ได้</p>:<div className="table-wrap" role="region" aria-label="เอกสารของ Batch" tabIndex={0}><table className="data-table"><thead><tr><th scope="col">เอกสาร</th><th scope="col">Rev</th><th scope="col">สถานะ</th><th scope="col">ออกเมื่อ / โดย</th><th scope="col">สำเนาใช้งาน</th><th scope="col">จัดการ</th></tr></thead>
    <tbody>{w.documents.map(d=><tr key={d.id}><td>{d.form==="F2"?`F2 Task List ${d.sheet_number}`:"F3 QC1"} · {d.kind==="PRE_WORK"?"Pre-work":"Completed"}<div className="mono small">{d.doc_code}</div></td><td>{d.revision}</td><td><span className={`status ${d.status==="Issued"?"good":"bad"}`}>{DOC_STATUS[d.status]}</span>{d.status_reason&&<div className="small">{d.status_reason}</div>}</td><td>{bkk(d.issued_at)}<div className="small">{d.issued_by}</div></td>
     <td>{d.working_copies}{d.unrecalled>0&&d.status!=="Issued"?<span className="badge danger">รอเรียกคืน {d.unrecalled}</span>:null}</td>
     <td><div className="row-actions"><a className="button small secondary" href={`/api/p4/documents/${d.id}`} target="_blank" rel="noopener">ดูต้นฉบับ</a>
      {d.status==="Issued"&&d.kind==="PRE_WORK"&&w.allowed.execute&&<button className="button small" type="button" onClick={()=>pdf(d.id,"WORKING_COPY")}>พิมพ์สำเนาใช้งาน</button>}
      {d.status==="Issued"&&<button className="button small secondary" type="button" onClick={()=>pdf(d.id,"ORIGINAL_REPRINT")}>พิมพ์ซ้ำต้นฉบับ</button>}
      {d.status!=="Issued"&&<button className="button small secondary" type="button" onClick={()=>pdf(d.id,"STATUS_MARKED")}>สำเนาระบุสถานะ</button>}</div></td></tr>)}</tbody></table></div>}
   {w.copies.filter(c=>c.kind==="WORKING_COPY"&&c.document_status!=="Issued"&&!c.recalled_at).length>0&&<div className="stack"><h3>สำเนาใช้งานที่ต้องเรียกคืน</h3><ul>{w.copies.filter(c=>c.kind==="WORKING_COPY"&&c.document_status!=="Issued"&&!c.recalled_at).map(c=><li key={c.id}>{c.doc_code} Rev {c.revision} สำเนาที่ {c.copy_number} ({c.actor}) {w.allowed.recall&&<button className="button small secondary" type="button" onClick={()=>setDialog({type:`recall:${c.id}`})}>ยืนยันเรียกคืนแล้ว</button>}</li>)}</ul></div>}
  </section>
  <details className="panel"><summary>ประวัติการทำงานของ Batch ({w.events.length})</summary><ol className="timeline">{w.events.map((e,i)=><li key={i}>{bkk(e.created_at)} · {e.event_type}{e.sheet_number?` · TL${e.sheet_number}`:""} · {e.actor}{e.reason?` — ${e.reason}`:""}</li>)}</ol></details>
  {dialog&&<WorkspaceDialog dialog={dialog} w={w} sheetNo={sheetNo} busy={busy} act={act} close={()=>setDialog(null)} setMsg={setMsg} reload={reload}/>}
 </>;
}
/** V2 "Batch context" card, per Task: run, strip labels, counts, control and plan summary in one place. */
function TaskContext({w,sheet,sheetNo}:{w:Workspace;sheet:Sheet;sheetNo:number}){
 const st=sheetStats(w.slots,sheetNo),strips=stripLabels(w.batch.runLabel,sheetNo as SheetNumber);
 return <section className="task-context" aria-label={`สรุป Task List ${sheetNo}`}>
  <dl>
   <div><dt>Task List</dt><dd><strong>{sheetNo}</strong> · ตำแหน่ง {(sheetNo-1)*16+1}–{sheetNo*16} · {STEP_TEXT[sheet.state]??sheet.state}</dd></div>
   <div><dt>Run</dt><dd className="mono">{w.batch.runLabel}{!w.operational&&<> · {strips.s1} · {strips.s2}</>}</dd></div>
   <div><dt>ตัวอย่างผู้ป่วย</dt><dd>{st.placed}/{st.capacity} · ว่าง {st.empty}</dd></div>
   <div><dt>Control</dt><dd>{st.control?<><span className="badge">{st.control.controlLabel}</span> <span className="mono">{st.control.controlCode??"รอวันที่ปฏิบัติงาน"}</span></>:"—"}</dd></div>
   <div><dt>วันที่ทำ Library Preparation (วางแผน)</dt><dd>{displayBe(sheet.planned_work_date)} · ผู้ปฏิบัติ {sheet.planned_operator??"—"}</dd></div>
   <div><dt>Extraction / Library Lot</dt><dd>{sheet.planned_extraction_lot??"—"} / Exp. {displayBe(sheet.planned_extraction_expiry)} · {sheet.planned_library_lot??"—"} / Exp. {displayBe(sheet.planned_library_expiry)}</dd></div>
  </dl>
 </section>;
}
function TransferCell({status,canRecord,canDispose,onRecord,onDispose}:{status:string;canRecord:boolean;canDispose:boolean;onRecord:()=>void;onDispose:()=>void}){
 return <div><span className={`status ${status==="MEASURED"?"good":status==="REQUIRED_PENDING"?"warning":"bad"}`}>{DISP_TEXT[status]??status}</span>
  {status==="REQUIRED_PENDING"&&canRecord&&<div className="row-actions"><button className="button small" type="button" onClick={onRecord}>บันทึก ✓</button>{canDispose&&<button className="button small secondary" type="button" onClick={onDispose}>ไม่ได้ดูด…</button>}</div>}</div>;
}
/** Mounted per Task (keyed by sheet id + batch version), so its local state can never belong to another Task. */
function PlanForm({sheet,disabled,onSave,onDirty}:{sheet:Sheet;disabled:boolean;onSave:(d:Record<string,unknown>)=>Promise<boolean>;onDirty:(dirty:boolean)=>void}){
 const [d,setD]=useState({plannedWorkDate:sheet.planned_work_date??"",plannedOperator:sheet.planned_operator??"",plannedExtractionLot:sheet.planned_extraction_lot??"",plannedExtractionExpiry:sheet.planned_extraction_expiry??"",plannedLibraryLot:sheet.planned_library_lot??"",plannedLibraryExpiry:sheet.planned_library_expiry??""});
 const set=(k:keyof typeof d,v:string)=>{setD(p=>({...p,[k]:v}));onDirty(true);};
 // Dates are typed and shown in BE (ThaiDateInput); the value kept here and sent to the API is ISO CE.
 const f=(k:keyof typeof d,label:string,type="text")=><div className="field"><label htmlFor={`plan-${k}`}>{label}</label>{type==="date"
  ?<ThaiDateInput id={`plan-${k}`} value={d[k]} onChange={v=>{if(v!==d[k])set(k,v);}}/>
  :<input id={`plan-${k}`} type={type} value={d[k]} onChange={e=>set(k,e.target.value)} maxLength={80}/>}</div>;
 const n=(v:string)=>v.trim()?v.trim():null;
 return <fieldset className="plan-form"><legend>ข้อมูลที่วางแผน (พิมพ์แยกจากช่อง “ใช้จริง” — ไม่ใช่หลักฐานการปฏิบัติ)</legend><div className="form-grid">{f("plannedWorkDate","วันที่ทำ Library Preparation ที่วางแผน (ใช้สร้างรหัส Control)","date")}{f("plannedOperator","ผู้ปฏิบัติที่วางแผน")}{f("plannedExtractionLot","Extraction Lot (ถ้าทราบ)")}{f("plannedExtractionExpiry","Extraction Exp.","date")}{f("plannedLibraryLot","Library Lot (ถ้าทราบ)")}{f("plannedLibraryExpiry","Library Exp.","date")}</div>
  <button className="button secondary" type="button" disabled={disabled||!d.plannedWorkDate} onClick={()=>onSave({plannedWorkDate:d.plannedWorkDate,plannedOperator:n(d.plannedOperator),plannedExtractionLot:n(d.plannedExtractionLot),plannedExtractionExpiry:n(d.plannedExtractionExpiry),plannedLibraryLot:n(d.plannedLibraryLot),plannedLibraryExpiry:n(d.plannedLibraryExpiry)})}>บันทึกข้อมูลแผน</button></fieldset>;
}
type Act=(action:string,data?:Record<string,unknown>,ok?:string)=>Promise<boolean>;
/** Source/time controls shared by every execution or QC entry: paper values cite the working copy and the time written on it. */
function SourceControls({copies,value,onChange}:{copies:{id:string;label:string}[];value:{source:string;copyId:string;eventTime:string;notRecorded:boolean};onChange:(v:{source:string;copyId:string;eventTime:string;notRecorded:boolean})=>void}){
 return <fieldset className="source-controls"><legend>ที่มาของค่า</legend>
  <label className="check-label"><input type="radio" name="source" checked={value.source==="DIRECT_ENTRY"} onChange={()=>onChange({...value,source:"DIRECT_ENTRY"})}/> บันทึกตรงในระบบขณะปฏิบัติ (เวลาเหตุการณ์ = เวลา Server)</label>
  <label className="check-label"><input type="radio" name="source" checked={value.source==="PAPER_TRANSCRIPTION"} onChange={()=>onChange({...value,source:"PAPER_TRANSCRIPTION"})} disabled={!copies.length}/> ถอดจากสำเนาใช้งานกระดาษ{copies.length?"":" (ยังไม่มีสำเนาใช้งานที่ใช้ได้)"}</label>
  {value.source==="PAPER_TRANSCRIPTION"&&<div className="form-grid"><div className="field"><label htmlFor="copy">สำเนาใช้งาน</label><select id="copy" value={value.copyId} onChange={e=>onChange({...value,copyId:e.target.value})}><option value="">เลือกสำเนา</option>{copies.map(c=><option key={c.id} value={c.id}>{c.label}</option>)}</select></div>
   <div className="field"><label htmlFor="etime">เวลาที่เขียนบนกระดาษ</label><ThaiDateTimeInput id="etime" value={value.eventTime} disabled={value.notRecorded} onChange={v=>onChange({...value,eventTime:v})}/></div>
   <label className="check-label"><input type="checkbox" checked={value.notRecorded} onChange={e=>onChange({...value,notRecorded:e.target.checked})}/> ไม่ได้เขียนเวลาไว้บนเอกสาร (ไม่เติมเอง)</label></div>}
 </fieldset>;
}
const sourcePayload=(v:{source:string;copyId:string;eventTime:string;notRecorded:boolean})=>v.source==="DIRECT_ENTRY"?{source:"DIRECT_ENTRY"}:{source:"PAPER_TRANSCRIPTION",documentCopyId:v.copyId,...(v.notRecorded?{eventPrecision:"NOT_RECORDED"}:{eventTime:new Date(v.eventTime).toISOString(),eventPrecision:"MINUTE"})};
function valueInput(kind:string,v:Record<string,string>,set:(v:Record<string,string>)=>void,id:string,planned?:string|null){
 if(kind==="CHECK")return <label className="check-label"><input id={id} type="checkbox" checked={v.checked==="true"} onChange={e=>set({checked:String(e.target.checked)})}/> ทำแล้ว</label>;
 if(kind==="DATE")return <div className="stack"><ThaiDateInput id={id} value={v.date??""} onChange={x=>set({...v,date:x})}/>{planned&&v.date&&v.date!==planned&&<><p className="notice warning-notice" role="note">ต่างจากวันที่วางแผน {displayBe(planned)} ที่ใช้สร้างรหัส Control — รหัส Control คงเดิม (ล็อกเมื่อเริ่มปฏิบัติงาน) ระบุเหตุผลสั้น ๆ</p><input aria-label="เหตุผลที่วันที่ต่างจากแผน" placeholder="เหตุผลที่วันที่ต่างจากแผน (อย่างน้อย 8 ตัวอักษร)" value={v.deviationReason??""} maxLength={500} onChange={e=>set({...v,deviationReason:e.target.value})}/></>}</div>;
 if(kind==="LOT")return <div className="row"><input id={id} aria-label="Lot no." placeholder="Lot no." value={v.lot??""} onChange={e=>set({...v,lot:e.target.value})}/><ThaiDateInput aria-label="Exp. date" value={v.expiry??""} onChange={x=>set({...v,expiry:x})}/></div>;
 if(kind==="TIME_RANGE")return <div className="row"><input id={id} type="time" aria-label="เวลาเริ่ม" value={v.start??""} onChange={e=>set({...v,start:e.target.value})}/><input type="time" aria-label="เวลาจบ" value={v.end??""} onChange={e=>set({...v,end:e.target.value})}/></div>;
 if(kind==="NUMBER")return <input id={id} inputMode="decimal" value={v.value??""} onChange={e=>set({value:e.target.value})} aria-describedby={`${id}-unit`}/>;
 return <input id={id} value={v.text??""} onChange={e=>set({text:e.target.value})} maxLength={120}/>;
}
const toValue=(kind:string,v:Record<string,string>)=>kind==="CHECK"?(v.checked==="true"?{checked:true}:null):kind==="DATE"?(v.date?{date:v.date,...(v.deviationReason?.trim()?{deviationReason:v.deviationReason.trim()}:{})}:null):kind==="LOT"?(v.lot&&v.expiry?{lot:v.lot,expiry:v.expiry}:null):kind==="TIME_RANGE"?(v.start&&v.end?{start:v.start,end:v.end}:null):kind==="NUMBER"?(/^\d{1,4}(\.\d{1,3})?$/.test(v.value??"")?{value:v.value,unit:"ng/uL"}:null):(v.text?.trim()?{text:v.text.trim()}:null);
function ExecutionPanel({w,sheet,comp,copies,busy,act,userId}:{w:Workspace;sheet:Sheet;comp:Workspace["completeness"][number];copies:Copy[];busy:boolean;act:Act;userId:string}){
 const fields=w.fields.filter(f=>f.form==="F2"&&f.scope==="SHEET"&&f.sheets.includes(sheet.sheet_number));
 const obs=w.observations.filter(o=>o.sheetId===sheet.id);
 const [src,setSrc]=useState({source:"DIRECT_ENTRY",copyId:"",eventTime:"",notRecorded:false}),[vals,setVals]=useState<Record<string,Record<string,string>>>({}),[fix,setFix]=useState<Record<string,string>>({});
 const canEnter=["InExecution","ExecutionRecorded"].includes(sheet.state)&&(src.source==="DIRECT_ENTRY"?w.allowed.execute:w.allowed.transcribe);
 return <section className="stack" aria-labelledby="exec-h"><h2 id="exec-h">บันทึกการปฏิบัติ (F2) — บันทึกได้หลังเริ่มปฏิบัติเท่านั้น</h2>
  {comp.missingFields.length>0&&<p className="help">ยังขาดค่าที่ทวนสอบแล้ว {comp.missingFields.length} รายการ · ตำแหน่งที่ยังไม่มี ✓/Disposition {comp.slots.filter(s=>s.status==="REQUIRED_PENDING").length} · รอทวนสอบ {comp.open}</p>}
  {canEnter&&<SourceControls copies={copies.map(c=>({id:c.id,label:`${c.doc_code} Rev ${c.revision} สำเนาที่ ${c.copy_number}`}))} value={src} onChange={setSrc}/>}
  <div className="table-wrap" role="region" aria-label="รายการข้อมูลแบบฟอร์ม" tabIndex={0}><table className="data-table"><thead><tr><th scope="col">รายการ (Field inventory — ยังไม่ยืนยัน)</th><th scope="col">ค่าที่บันทึก</th><th scope="col">สถานะ</th><th scope="col">บันทึก/แก้ไข</th></tr></thead>
   <tbody>{fields.map(f=>{const key=f.id+":"+f.item,o=obs.find(x=>x.fieldId===f.id&&x.item===f.item),id=`f-${f.id}-${f.item}`;const value=toValue(f.kind,vals[key]??{});
    return <tr key={key}><th scope="row"><label htmlFor={id}>{f.label}</label><div className="small muted">{f.id}{f.item?` · ${f.item}`:""} · {f.cls}</div></th><td>{o?<>{o.valueText}<div className="small muted">{o.source==="PAPER_TRANSCRIPTION"?"กระดาษ":"บันทึกตรง"} · เหตุการณ์ {o.eventPrecision==="NOT_RECORDED"?"ไม่ได้บันทึกบนเอกสาร":bkk(o.eventTime)} · กรอก {bkk(o.recordedAt)} {o.recorder}</div></>:"—"}</td>
     <td>{o?<span className={`status ${o.status==="Verified"?"good":o.status==="Discrepancy"?"bad":"warning"}`}>{o.status==="Verified"?`ทวนสอบแล้ว (${o.reviewer})`:o.status==="Discrepancy"?"ไม่ตรง — ต้องแก้":"รอทวนสอบ"}</span>:<span className="status warning">ยังไม่บันทึก</span>}</td>
     <td>{canEnter&&(!o||o.status!=="Verified"||sheet.state==="InExecution"||sheet.state==="ExecutionRecorded")?<div className="row">{valueInput(f.kind,vals[key]??{},v=>setVals({...vals,[key]:v}),id,f.id==="F2-02"?sheet.planned_work_date:null)}
      {o&&<input aria-label="เหตุผลการแก้ไข" placeholder="เหตุผลการแก้ไข" value={fix[key]??""} onChange={e=>setFix({...fix,[key]:e.target.value})}/>}
      <button className="button small" type="button" disabled={busy||!value||(src.source==="PAPER_TRANSCRIPTION"&&(!src.copyId||(!src.notRecorded&&!src.eventTime)))||(!!o&&(fix[key]??"").trim().length<8)} onClick={async()=>{if(await act("record",{sheetNumber:sheet.sheet_number,fieldId:f.id,item:f.item,value,...sourcePayload(src),...(o?{supersedesId:o.id,correctionReason:fix[key]}:{})},o?"บันทึกค่าแก้ไขแล้ว (ค่าเดิมเก็บไว้)":"บันทึกแล้ว — รอผู้อื่นทวนสอบ"))setVals({...vals,[key]:{}});}}>{o?"แก้ไข":"บันทึก"}</button></div>:null}</td></tr>;})}</tbody></table></div>
  <ReviewPanel w={w} obs={w.observations.filter(o=>o.sheetId===sheet.id)} act={act} busy={busy} userId={userId}/>
  <DispositionList w={w} slots={comp.slots.map(s=>s.slot)} act={act} busy={busy} userId={userId}/>
 </section>;
}
function ReviewPanel({w,obs,act,busy,userId}:{w:Workspace;obs:Obs[];act:Act;busy:boolean;userId:string}){
 const pending=obs.filter(o=>o.status==="PendingReconciliation");const [sel,setSel]=useState<Set<string>>(new Set()),[kind,setKind]=useState("VALUE_MISMATCH"),[note,setNote]=useState("");
 if(!pending.length)return null;
 const own=(o:Obs)=>o.recordedBy===userId;
 return <div className="stack review"><h3>รอทวนสอบโดยคนที่สอง ({pending.length})</h3>{!w.allowed.verify&&<p className="help">ต้องให้ผู้มีสิทธิ์ทวนสอบ (ผู้รับรอง Lab) ซึ่งไม่ใช่ผู้บันทึก</p>}
  <ul className="review-list">{pending.map(o=><li key={o.id}><label className="check-label"><input type="checkbox" disabled={!w.allowed.verify||own(o)} checked={sel.has(o.id)} onChange={()=>setSel(s=>{const n=new Set(s);if(n.has(o.id))n.delete(o.id);else n.add(o.id);return n;})}/> {o.label}{o.slot?` (ตน. ${o.slot})`:""}: <strong>{o.valueText}</strong> · {o.source==="PAPER_TRANSCRIPTION"?"เทียบกับกระดาษ":"บันทึกตรง"} · {o.recorder}{own(o)?" (ของคุณ — ทวนสอบเองไม่ได้)":""}</label></li>)}</ul>
  {w.allowed.verify&&<div className="row"><button className="button small" type="button" disabled={busy||!sel.size} onClick={async()=>{if(await act("review",{observationIds:[...sel],result:"Confirmed"},"ทวนสอบแล้ว"))setSel(new Set());}}>ยืนยันตรงกับต้นทาง ({sel.size})</button>
   <select aria-label="ชนิดความไม่ตรง" value={kind} onChange={e=>setKind(e.target.value)}><option value="VALUE_MISMATCH">ค่าไม่ตรง</option><option value="MISSING">ขาด</option><option value="ILLEGIBLE">อ่านไม่ออก</option><option value="ID_MISMATCH">ID ไม่ตรง Snapshot</option><option value="CHECK_MISSING">✓ ขาด</option><option value="WRONG_REVISION">สำเนาผิด Revision</option></select>
   <input aria-label="รายละเอียดความไม่ตรง" placeholder="รายละเอียด (อย่างน้อย 8 ตัวอักษร)" value={note} onChange={e=>setNote(e.target.value)}/>
   <button className="button small secondary" type="button" disabled={busy||!sel.size||note.trim().length<8} onClick={async()=>{if(await act("review",{observationIds:[...sel],result:"Discrepancy",discrepancyKind:kind,note},"บันทึก Discrepancy แล้ว — ผู้บันทึกต้องแก้ไขพร้อมเหตุผล"))setSel(new Set());}}>บันทึกความไม่ตรง</button></div>}
 </div>;
}
function DispositionList({w,slots,act,busy,userId}:{w:Workspace;slots:number[];act:Act;busy:boolean;userId:string}){
 const rows=w.dispositions.filter(d=>slots.includes(d.slot_number)||d.stage==="QC1");
 if(!rows.length)return null;
 return <div className="stack"><h3>Disposition ของตำแหน่งที่ไม่ได้ทำ/วัด</h3><ul>{rows.filter(d=>slots.includes(d.slot_number)).map(d=><li key={d.id}>ตน. {d.slot_number} · {d.stage} · {DISP_TEXT[d.disposition]} · {d.reason_code} — {d.note} · เสนอโดย {d.proposer} · {d.confirmed_at?`ยืนยันโดย ${d.confirmer}`:<>รอยืนยัน{w.allowed.dispositionConfirm&&d.proposed_by!==userId&&<button className="button small" type="button" disabled={busy} onClick={()=>act("confirmDisposition",{dispositionId:d.id},"ยืนยัน Disposition แล้ว")}>ยืนยัน</button>}</>}</li>)}</ul></div>;
}
function QcPanel({w,busy,act,userId}:{w:Workspace;busy:boolean;act:Act;userId:string}){
 const ready=w.sheets.filter(s=>["ExecutionRecorded","ExecutionVerified","CompletedIssued"].includes(s.state)).map(s=>s.sheet_number);
 const rows=w.qc.rows.filter(r=>r.status!=="NOT_APPLICABLE"&&ready.includes(Math.ceil(r.slot/16)));
 const f3=w.documents.find(d=>d.form==="F3"&&d.kind==="PRE_WORK"&&d.status==="Issued");const copies=w.copies.filter(c=>f3&&c.document_id===f3.id&&c.kind==="WORKING_COPY"&&!c.recalled_at);
 const [src,setSrc]=useState({source:"DIRECT_ENTRY",copyId:"",eventTime:"",notRecorded:false}),[vals,setVals]=useState<Record<string,string>>({}),[decide,setDecide]=useState<null|{attemptId:string;slot:number;cand:Obs["candidates"]}>(null);
 const obs=(slot:number|null,field:string,item="")=>w.observations.find(o=>o.slot===slot&&o.fieldId===field&&o.item===item);
 const slotInfo=(slot:number)=>w.slots.find(s=>s.slot===slot)!;
 return <section className="panel stack" aria-labelledby="qc-h"><h2 id="qc-h">QC1 Library Concentration (F3)</h2>
  <p className="notice warning-notice">{w.operational?"เกณฑ์ QC1 ตาม Master ล่าสุด: ":"เกณฑ์ QC1 ที่เสนอ: "}{w.criteria.map(c=>c.label).join(" · ")} — ผู้รับรองทบทวนค่าจริงและบันทึกผลการตัดสิน</p>
  {w.allowed.qcRecord&&<SourceControls copies={copies.map(c=>({id:c.id,label:`${c.doc_code} Rev ${c.revision} สำเนาที่ ${c.copy_number}`}))} value={src} onChange={setSrc}/>}
  <div className="form-grid">{[["F3-05","STD1","Standard 1"],["F3-05","STD2","Standard 2"],["F3-01","OPERATOR","ผู้ปฏิบัติงาน QC"]].map(([f,item,label])=>{const o=obs(null,f,item),k=f+item;return <div key={k} className="field"><label htmlFor={`qc-${k}`}>{label}</label>{o?<p>{o.valueText} · {o.status==="Verified"?"ทวนสอบแล้ว":"รอทวนสอบ"}</p>:w.allowed.qcRecord&&<div className="row"><input id={`qc-${k}`} value={vals[k]??""} onChange={e=>setVals({...vals,[k]:e.target.value})}/><button className="button small" type="button" disabled={busy||!(vals[k]??"").trim()} onClick={()=>act("record",{fieldId:f,item,value:f==="F3-01"?{text:vals[k]}:{value:vals[k],unit:"ng/uL"},...sourcePayload(src)},"บันทึกแล้ว")}>บันทึก</button></div>}</div>;})}</div>
  <div className="table-wrap" role="region" aria-label="ผลวัดความเข้มข้น" tabIndex={0}><table className="data-table"><thead><tr><th scope="col">ตน.</th><th scope="col">Sample ID / Control</th><th scope="col">Concentration (ng/µL)</th><th scope="col">อ่านค่าเทียบเกณฑ์ที่เสนอ (ไม่ใช่การตัดสิน)</th><th scope="col">Stage QC1</th></tr></thead>
   <tbody>{rows.map(r=>{const s=slotInfo(r.slot),o=obs(r.slot,"F3-03"),k="v"+r.slot;return <tr key={r.slot} className={s.control?"control-row":""}><th scope="row">{r.slot}<div className="small muted">{s.plate}</div></th><td>{s.control?<><span className="badge">{s.controlLabel}</span> <span className="mono">{s.controlCode}</span></>:<span className="mono">{s.assignment?.printedSampleId}</span>}</td>
    <td>{o?<>{o.valueText} <span className={`status ${o.status==="Verified"?"good":"warning"}`}>{o.status==="Verified"?"ทวนสอบแล้ว":o.status==="Discrepancy"?"ไม่ตรง":"รอทวนสอบ"}</span></>:r.status==="REQUIRED_PENDING"&&w.allowed.qcRecord?<div className="row"><input aria-label={`ค่า QC1 ตำแหน่ง ${r.slot}`} inputMode="decimal" value={vals[k]??""} onChange={e=>setVals({...vals,[k]:e.target.value})}/><button className="button small" type="button" disabled={busy||!/^\d{1,4}(\.\d{1,3})?$/.test(vals[k]??"")} onClick={()=>act("record",{slot:r.slot,fieldId:"F3-03",value:{value:vals[k],unit:"ng/uL"},...sourcePayload(src)},"บันทึกค่า QC1 แล้ว — รอทวนสอบ")}>บันทึก</button></div>:DISP_TEXT[r.status]??r.status}</td>
    <td>{o?.candidates?.map(c=><div key={c.code} className="small">{c.code.includes("WI")?"WI":"Workbook"}: {OUTCOME[c.outcome]}</div>)}</td>
    <td>{r.decision?r.decision:s.control?(r.status==="MEASURED"?"Control — ตามนโยบาย IQC (OD-34)":"—"):o?.status==="Verified"&&w.allowed.qcAccept&&r.attemptId?<button className="button small" type="button" onClick={()=>setDecide({attemptId:r.attemptId!,slot:r.slot,cand:o.candidates})}>ตัดสิน</button>:"—"}</td></tr>;})}</tbody></table></div>
  <ReviewPanel w={w} obs={w.observations.filter(o=>o.fieldId.startsWith("F3-"))} act={act} busy={busy} userId={userId}/>
  {decide&&<DecideDialog decide={decide} operational={w.operational} close={()=>setDecide(null)} act={act}/>}
 </section>;
}
function DecideDialog({decide,close,act,operational}:{decide:{attemptId:string;slot:number;cand:Obs["candidates"]};close:()=>void;act:Act;operational?:boolean}){
 const [decision,setDecision]=useState(""),[reason,setReason]=useState(""),[criteriaReference,setCriteriaReference]=useState('');
 return <Dialog title={`ตัดสิน Stage QC1 — ตำแหน่ง ${decide.slot}`} onClose={close}><div className="stack">
  {operational?<div className="field"><label htmlFor="qc1-criteria">เอกสาร / เกณฑ์ QC1 ที่ใช้ทบทวน</label><input id="qc1-criteria" value={criteriaReference} onChange={e=>setCriteriaReference(e.target.value)}/></div>:<p className="notice warning-notice">การตัดสินนี้บันทึกเป็น “เกณฑ์ยังไม่รับรอง (UNAPPROVED_OD31)” เสมอ</p>}
  <ul>{decide.cand?.map(c=><li key={c.code}>{c.code}: {OUTCOME[c.outcome]}</li>)}</ul>
  <fieldset><legend>ผลการตัดสิน</legend>{[["Accepted","ยอมรับ"],["Failed","ไม่ผ่าน → Attempt QcFailed (สั่งตรวจซ้ำ/เจาะซ้ำได้)"],["Remeasure","วัดซ้ำ (QcHold)"],["Hold","ระงับ (QcHold)"]].map(([v,l])=><label key={v} className="check-label"><input type="radio" name="dec" checked={decision===v} onChange={()=>setDecision(v)}/> {l}</label>)}</fieldset>
  <label htmlFor="dec-reason">เหตุผล</label><textarea id="dec-reason" rows={3} value={reason} onChange={e=>setReason(e.target.value)}/>
  <div className="dialog-actions"><button className="button" type="button" disabled={!decision||reason.trim().length<8||(operational&&criteriaReference.trim().length<8)} onClick={async()=>{if(await act("decideQc",{attemptId:decide.attemptId,decision,reason,...(operational?{criteriaReference}:{})},"บันทึกการตัดสิน Stage QC1 แล้ว"))close();}}>บันทึกการตัดสิน</button><button className="button secondary" type="button" onClick={close}>ยกเลิก</button></div>
 </div></Dialog>;
}
function WorkspaceDialog({dialog,w,sheetNo,busy,act,close,setMsg,reload}:{dialog:{type:string;slot?:number};w:Workspace;sheetNo:number;busy:boolean;act:Act;close:()=>void;setMsg:(m:{ok:boolean;text:string})=>void;reload:()=>Promise<void>}){
 const [reason,setReason]=useState(""),[target,setTarget]=useState(""),[checks,setChecks]=useState({controls:false,ids:false,dup:false}),[stage,setStage]=useState("TRANSFER"),[disp,setDisp]=useState("NOT_PERFORMED"),[code,setCode]=useState(""),[src,setSrc]=useState({source:"DIRECT_ENTRY",copyId:"",eventTime:"",notRecorded:false});
 const sheet=w.sheets[sheetNo-1],slot=dialog.slot?w.slots.find(s=>s.slot===dialog.slot):undefined;
 const run=async(action:string,data:Record<string,unknown>,ok:string)=>{if(await act(action,data,ok))close();};
 if(dialog.type.startsWith("recall:")){const id=dialog.type.slice(7);return <Dialog title="ยืนยันการเรียกคืนสำเนาใช้งาน" onClose={close}><div className="stack"><label htmlFor="recall-note">บันทึก (อย่างน้อย 8 ตัวอักษร)</label><textarea id="recall-note" rows={3} value={reason} onChange={e=>setReason(e.target.value)}/><div className="dialog-actions"><button className="button" type="button" disabled={busy||reason.trim().length<8} onClick={async()=>{try{await labApi(`/api/p4/copies/${id}`,{note:reason});await reload();setMsg({ok:true,text:"บันทึกการเรียกคืนแล้ว"});close();}catch(e){setMsg({ok:false,text:failureText(e)});}}}>ยืนยัน</button></div></div></Dialog>;}
 if(dialog.type==="plancheck")return <Dialog title={`ยืนยันแผนตำแหน่ง Task List ${sheetNo}`} onClose={close}><div className="stack"><p>ตรวจบนจอ — <strong>ไม่ใช่การยืนยันว่าดูดตัวอย่างแล้ว</strong></p>
  {[["controls","Control อยู่ตาม Template (PC 1 / NC 25 / Blank 40) และรหัส Control ถูกต้อง"],["ids","Sample ID / LN Halos / ป้ายรอบ / Barcode index ตรงกับตัวอย่างที่เลือก"],["dup","ไม่มี ID ซ้ำ"]].map(([k,l])=><label key={k} className="check-label"><input type="checkbox" checked={checks[k as keyof typeof checks]} onChange={e=>setChecks({...checks,[k]:e.target.checked})}/> {l}</label>)}
  <div className="dialog-actions"><button className="button" type="button" disabled={busy||!checks.controls||!checks.ids||!checks.dup} onClick={()=>run("planCheck",{sheetNumber:sheetNo,confirm:{controlsAtTemplate:true,identifiersMatch:true,noDuplicates:true}},"ยืนยันแผนตำแหน่งแล้ว")}>ยืนยันแผน</button></div></div></Dialog>;
 if(dialog.type==="move"&&slot){const targets=w.slots.filter(s=>!s.control&&s.slot!==slot.slot&&EDITABLE.includes(w.sheets[s.sheet-1].state));const needReason=[sheet.state,w.sheets[Math.ceil(Number(target||slot.slot)/16)-1].state].includes("PlanChecked");
  return <Dialog title={`ย้าย/สลับตำแหน่ง ${slot.slot}`} onClose={close}><div className="stack"><label htmlFor="target">ไปยังตำแหน่ง (ถ้ามีตัวอย่างอยู่จะสลับกัน)</label><select id="target" value={target} onChange={e=>setTarget(e.target.value)}><option value="">เลือกตำแหน่ง</option>{targets.map(s=><option key={s.slot} value={s.slot}>ตน. {s.slot} ({s.plate}) {s.assignment?`— สลับกับ ${s.assignment.printedSampleId}`:"— ว่าง"}</option>)}</select>
   {needReason&&<><label htmlFor="mv-reason">เหตุผล (ยืนยันแผนแล้ว)</label><input id="mv-reason" value={reason} onChange={e=>setReason(e.target.value)}/></>}
   <div className="dialog-actions"><button className="button" type="button" disabled={busy||!target||(needReason&&reason.trim().length<8)} onClick={()=>run("move",{fromSlot:slot.slot,toSlot:Number(target),...(reason.trim()?{reason:reason.trim()}:{})},"ย้ายตำแหน่งแล้ว")}>ยืนยัน</button></div></div></Dialog>;}
 if(dialog.type==="remove"&&slot){const need=sheet.state!=="Draft"||sheet.placement_revision>0;return <Dialog title={`ถอดตัวอย่างออกจากตำแหน่ง ${slot.slot}`} onClose={close}><div className="stack"><p>{slot.assignment?.printedSampleId} จะกลับไปที่คิวพร้อมเข้าตรวจ (ประวัติการจัดยังเก็บไว้)</p>
  {need&&<><label htmlFor="rm-reason">เหตุผล</label><input id="rm-reason" value={reason} onChange={e=>setReason(e.target.value)}/></>}
  <div className="dialog-actions"><button className="button" type="button" disabled={busy||(need&&reason.trim().length<8)} onClick={()=>run("remove",{slot:slot.slot,...(reason.trim()?{reason:reason.trim()}:{})},"ถอดออกแล้ว")}>ถอดออก</button></div></div></Dialog>;}
 if(dialog.type==="transfer"&&slot){const copies=w.copies.filter(c=>c.kind==="WORKING_COPY"&&!c.recalled_at&&w.documents.some(d=>d.id===c.document_id&&d.form==="F2"&&d.sheet_number===sheetNo&&d.status==="Issued"));
  return <Dialog title={`✓ ตรวจ Lab number ตำแหน่ง ${slot.slot}`} onClose={close}><div className="stack"><p className="mono strong">{slot.control?`${slot.controlLabel} ${slot.controlCode}`:slot.assignment?.printedSampleId}</p><p>ยืนยันว่าได้ตรวจ Lab number บนหลอดเทียบ Task List ทั้ง <strong>ก่อน</strong> และ <strong>หลัง</strong> ดูดลง Strip (WI-T-BM16 §10.5)</p>
   <SourceControls copies={copies.map(c=>({id:c.id,label:`${c.doc_code} Rev ${c.revision} สำเนาที่ ${c.copy_number}`}))} value={src} onChange={setSrc}/>
   <div className="dialog-actions"><button className="button" type="button" disabled={busy||(src.source==="PAPER_TRANSCRIPTION"&&(!src.copyId||(!src.notRecorded&&!src.eventTime)))} onClick={()=>run("record",{sheetNumber:sheetNo,slot:slot.slot,fieldId:"F2-11",value:{before:true,after:true},...sourcePayload(src)},"บันทึก ✓ แล้ว — รอทวนสอบ")}>บันทึก ✓ ก่อน/หลังดูด</button></div></div></Dialog>;}
 if(dialog.type==="dispose"&&slot)return <Dialog title={`ตำแหน่ง ${slot.slot} ไม่ได้ทำ/ไม่ได้วัด`} onClose={close}><div className="stack"><p>บันทึกข้อเท็จจริงแทนค่า — ไม่มีตัวเลขหรือ ✓ ปลอม ต้องให้ผู้มีสิทธิ์อีกคนยืนยัน</p>
  <label htmlFor="stage">ขั้น</label><select id="stage" value={stage} onChange={e=>setStage(e.target.value)}><option value="TRANSFER">ดูดลง Strip (F2)</option><option value="QC1">วัด QC1 (F3)</option></select>
  <label htmlFor="disp">Disposition</label><select id="disp" value={disp} onChange={e=>setDisp(e.target.value)}><option value="NOT_PERFORMED">ไม่ได้ทำ</option><option value="EXCLUDED">ถอดออกหลังเริ่มงาน</option><option value="STOPPED">หยุด</option></select>
  <label htmlFor="dcode">รหัสเหตุผล</label><select id="dcode" value={code} onChange={e=>setCode(e.target.value)}><option value="">เลือก</option>{w.dispositionReasons.map(r=><option key={r} value={r}>{r}</option>)}</select>
  <label htmlFor="dnote">รายละเอียด</label><textarea id="dnote" rows={3} value={reason} onChange={e=>setReason(e.target.value)}/>
  <div className="dialog-actions"><button className="button" type="button" disabled={busy||!code||reason.trim().length<8} onClick={()=>run("proposeDisposition",{slot:slot.slot,stage,disposition:disp,reasonCode:code,note:reason},"เสนอ Disposition แล้ว — รอผู้อื่นยืนยัน")}>เสนอ</button></div></div></Dialog>;
 if(dialog.type==="amend")return <Dialog title={`Controlled amendment — Task List ${sheetNo}`} onClose={close}><div className="stack"><p>ใบงาน Pre-work ที่ออกแล้วจะถูก “ระงับใช้” และสำเนาใช้งานทุกฉบับต้องถูกเรียกคืนก่อนเริ่มงาน Snapshot และ PDF เดิมไม่ถูกแก้</p><label htmlFor="am-reason">เหตุผล</label><textarea id="am-reason" rows={3} value={reason} onChange={e=>setReason(e.target.value)}/>
  <div className="dialog-actions"><button className="button" type="button" disabled={busy||reason.trim().length<8} onClick={()=>run("amend",{sheetNumber:sheetNo,reason},"เปิด Controlled amendment แล้ว")}>ยืนยัน</button></div></div></Dialog>;
 if(dialog.type==="fill")return <FillDialog w={w} sheetNo={sheetNo} close={close} setMsg={setMsg} reload={reload}/>;
 if(dialog.type==="cancel")return <Dialog title={`ยกเลิก ${w.batch.runLabel}`} onClose={close}><div className="stack"><p>ยกเลิกได้เฉพาะก่อนเริ่มปฏิบัติ ตัวอย่างที่ยังไม่เคย Finalize กลับคิวพร้อมเข้าตรวจ ส่วนที่ Finalize แล้วเป็น “Batch ถูกยกเลิก” และต้องสั่งตรวจซ้ำ เลข Run ไม่ถูกนำกลับมาใช้</p><label htmlFor="cx-reason">เหตุผล</label><textarea id="cx-reason" rows={3} value={reason} onChange={e=>setReason(e.target.value)}/>
  <div className="dialog-actions"><button className="button" type="button" disabled={busy||reason.trim().length<8} onClick={()=>run("cancel",{reason},"ยกเลิก Batch แล้ว")}>ยืนยันยกเลิก</button></div></div></Dialog>;
 return null;
}

type FillProposal={sheetNumber:number;freeSlots:number;queueSize:number;candidates:{attemptId:string;hisLn:string;hn:string|null;labelCode:string|null;printedSampleId:string|null;receivedAt:string|null;roundNumber:number;urgent:boolean}[]};
/** G07: fills the selected Task's empty patient slots from the eligible FIFO queue after showing exactly what will be placed. */
function FillDialog({w,sheetNo,close,setMsg,reload}:{w:Workspace;sheetNo:number;close:()=>void;setMsg:(m:{ok:boolean;text:string;details?:unknown})=>void;reload:()=>Promise<void>}){
 const [p,setP]=useState<FillProposal|null>(null),[error,setError]=useState(""),[busy,setBusy]=useState(false);
 const batchId=w.batch.id;
 const load=useCallback(async()=>{setError("");try{setP(await labApi<FillProposal>(`/api/p4/batches/${batchId}`,{action:"previewFill",sheetNumber:sheetNo}));}catch(e){setError(failureText(e));}},[batchId,sheetNo]);
 useEffect(()=>{void Promise.resolve().then(load);},[load]);
 async function confirm(){if(!p)return;setBusy(true);setError("");
  try{const r=await labApi<{placed:unknown[];rejected:unknown[]}>(`/api/p4/batches/${w.batch.id}`,{action:"fill",expectedVersion:w.batch.version,sheetNumber:sheetNo,attemptIds:p.candidates.map(c=>c.attemptId)});
   await reload();setMsg({ok:true,text:`เติมตัวอย่างจากคิวลง Task List ${sheetNo} แล้ว ${r.placed.length} รายการ${r.rejected.length?` · ไม่ผ่าน Gate ${r.rejected.length} รายการ`:""}`,details:r.rejected.length?r.rejected:undefined});close();}
  catch(e){if(e instanceof LabFailure&&["FILL_PROPOSAL_CHANGED","VERSION_CONFLICT"].includes(e.code)){await reload();await load();setError("คิวหรือ Task เปลี่ยนไประหว่างนี้ — แสดงรายการล่าสุดแล้ว กรุณาตรวจอีกครั้ง");}else setError(failureText(e));}
  finally{setBusy(false);}}
 return <Dialog title={`เติมตัวอย่างจากคิว — Task List ${sheetNo}`} onClose={close}><div className="stack">
  <p className="help">เติมเฉพาะตัวอย่างที่พร้อมเข้าตรวจและผ่าน Gate ตามลำดับรับสิ่งส่งตรวจ (FIFO) ลงช่องว่างของ Task นี้เท่านั้น ไม่แตะช่อง Control (1/25/40) และไม่เปลี่ยน LN Halos หรือรหัส — ต้องการเลือกเองหรือแทรกคิว ให้เลือกจากคิวงาน Lab</p>
  {!p&&!error&&<div className="skeleton" role="status" aria-label="กำลังโหลดรายการ"/>}
  {p&&<p role="status"><strong>จะเติม {p.candidates.length} รายการ</strong> · ช่องว่าง {p.freeSlots} · ในคิวที่พร้อม {p.queueSize}</p>}
  {p&&p.candidates.length>0&&<div className="table-wrap" role="region" aria-label="รายการที่จะเติม" tabIndex={0}><table className="data-table"><caption className="sr-only">รายการที่จะเติม</caption><thead><tr><th scope="col">ลำดับ</th><th scope="col">ตัวอย่าง</th><th scope="col">LN (HIS)</th><th scope="col">รับเมื่อ</th></tr></thead>
   <tbody>{p.candidates.map((c,i)=><tr key={c.attemptId}><td>{i+1}</td><td><span className="mono strong">{c.printedSampleId??c.labelCode??"—"}</span><div className="small">LN {c.hisLn} · HN {c.hn??"—"} · รอบที่ {c.roundNumber}</div>{c.roundNumber>1&&<span className="badge warning">เจาะซ้ำ</span>}{c.urgent&&<span className="badge danger">ด่วน</span>}</td><td className="mono">{c.hisLn}</td><td>{bkk(c.receivedAt)}</td></tr>)}</tbody></table></div>}
  {p&&p.candidates.length===0&&<p className="empty-state">{p.freeSlots===0?"Task นี้ไม่มีช่องว่างแล้ว":"ไม่มีตัวอย่างที่พร้อมเข้าตรวจในคิว"}</p>}
  {error&&<p className="notice" role="alert">{error}</p>}
  <div className="dialog-actions"><button className="button" type="button" disabled={busy||!p||p.candidates.length===0} onClick={()=>void confirm()}>{busy?"กำลังเติม…":`ยืนยันเติม ${p?.candidates.length??0} รายการ`}</button><button className="button secondary" type="button" onClick={close}>ยกเลิก</button></div>
 </div></Dialog>;
}
