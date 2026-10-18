"use client";
import {useEffect,useMemo,useState} from "react";
import {useRouter} from "next/navigation";
import Link from "next/link";
import {Dialog} from "../p2/shared";
import {LabelDialog} from "./label-dialog";
import {labApi,failureText,bkk,gateText,LabFailure} from "./lab-api";
import {compareReceive,READY_QUEUE_DEFAULT_SORT,type SortDirection} from "../../../packages/lab/receive-sort";
import {getSheetNumber} from "../../../packages/lab/rules";
import {gaBadge,type Ga} from "./ga-badge";
import {ThaiDateInput} from "../shared/thai-date-input";

type Attempt={kind:"ATTEMPT";category:string;caseId:string;roundId:string;roundNumber:number;receivedSource:string|null;receivedAt:string|null;hisLn:string;lnHalos:string|null;labelCode:string|null;pregnancy:string|null;ga:Ga;attemptId:string;attemptNumber:number;attemptState:string;printedSampleId:string|null;
 repeat:{level:string|null;state:string|null}|null;urgent:boolean;urgentReason:string|null;hold:{stage:string|null}|null;resumeDecisionRequired:boolean;qcFailedStage:string|null;gate:{eligible:boolean;syntheticPendingAccepted:boolean;failed:string[];pending:string[]}|null;
 placement:{batchId:string;runLabel:string|null;slot:number|null;sheetState:string|null}|null;labels:{prints:number;lastPrintedAt:string|null}};
type Expected={kind:"REDRAW_EXPECTED";caseId:string;roundId:string;roundNumber:number;hisLn:string;requestedAt:string;reasonCode:string;previousLnHalos:string|null};
type Missing={kind:"LN_HALOS_MISSING";caseId:string;roundId:string;roundNumber:number;hisLn:string;receivedAt:string;receivedSource:string};
export type WorklistData={operational?:boolean;policy:string;attempts:Attempt[];expected:Expected[];missing:Missing[];generatedAt:string};
type Can={labels:boolean;assign:boolean;receive:boolean;repeat:boolean;redraw:boolean;redrawCancel:boolean;hold:boolean};
type Batch={id:string;run_label:string;state:string;version:number;samples:number;sheet_states:string[]};

const TABS=[["READY","พร้อมเข้าตรวจ"],["GATE_BLOCKED","ติด Gate"],["IN_BATCH","อยู่ใน Batch / กำลังทำ"],["DECISION","ต้องตัดสินใจ (QC ไม่ผ่าน / หยุด)"],["REDRAW_EXPECTED","รอรับเจาะซ้ำ (รอบที่ 2+)"],["LN_HALOS_MISSING","ไม่มี LN Halos"]] as const;
type Tab=typeof TABS[number][0];
const tabOf=(a:Attempt):Tab=>a.category==="READY"?"READY":a.category==="GATE_BLOCKED"?"GATE_BLOCKED":["IN_BATCH","IN_PROGRESS"].includes(a.category)?"IN_BATCH":"DECISION";
const STATE:Record<string,string>={Ready:"พร้อม",Assigned:"จัดเข้า Batch",InProgress:"กำลังปฏิบัติ",QcFailed:"QC ไม่ผ่าน",Stopped:"หยุด",BatchCancelled:"Batch ถูกยกเลิก",Superseded:"ถูกแทนที่"};
const SOURCE:Record<string,string>={HIS_PET_RECEIPT:"รับใน HIS",NIPT_LOCAL_RECEIPT:"รับใน NIPT"};

export function LabWorklist({initial,can}:{initial:WorklistData;can:Can}){
 const router=useRouter();
 const [data,setData]=useState(initial),[tab,setTab]=useState<Tab>("READY"),[query,setQuery]=useState(""),[round,setRound]=useState("ALL"),[onlyUnprinted,setOnlyUnprinted]=useState(false),[urgentOnly,setUrgentOnly]=useState(false),[sort,setSort]=useState<SortDirection>(READY_QUEUE_DEFAULT_SORT);
 const [selected,setSelected]=useState<Set<string>>(new Set()),[dialog,setDialog]=useState<null|{type:string;row?:Attempt|Expected|Missing;samples?:Attempt[]}>(null),[status,setStatus]=useState("");
 async function reload(){try{setData(await labApi<WorklistData>("/api/p4/worklist"));setSelected(new Set());router.refresh();}catch(e){setStatus(failureText(e));}}
 const q=query.trim().toLowerCase();
 const match=(...v:(string|null|undefined)[])=>!q||v.some(x=>x?.toLowerCase().includes(q));
 const tabRows=useMemo(()=>data.attempts.filter(a=>tabOf(a)===tab).sort((x,y)=>compareReceive({receivedAt:x.receivedAt,keys:[x.hisLn,x.attemptId]},{receivedAt:y.receivedAt,keys:[y.hisLn,y.attemptId]},sort)),[data,tab,sort]);
 const attempts=useMemo(()=>tabRows.filter(a=>match(a.hisLn,a.lnHalos,a.labelCode,a.printedSampleId,a.placement?.runLabel)&&(round==="ALL"||(round==="S1"?a.roundNumber===1:a.roundNumber>1))&&(!onlyUnprinted||a.labels.prints===0)&&(!urgentOnly||a.urgent)),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [tabRows,q,round,onlyUnprinted,urgentOnly]);
 const counts=Object.fromEntries(TABS.map(([t])=>[t,t==="REDRAW_EXPECTED"?data.expected.length:t==="LN_HALOS_MISSING"?data.missing.length:data.attempts.filter(a=>tabOf(a)===t).length]));
 // Selection order = the order shown on screen after sort (Owner Lock §2.3), not the order of the clicks.
 const chosen=useMemo(()=>tabRows.filter(a=>selected.has(a.attemptId)),[tabRows,selected]);
 const toggle=(id:string)=>setSelected(s=>{const n=new Set(s);if(n.has(id))n.delete(id);else n.add(id);return n;});
 const allShown=attempts.length>0&&attempts.every(a=>selected.has(a.attemptId));
 return <>
  {data.operational?<p className="help">จัดเข้า Batch ได้เมื่อรับ PET ตรวจสิ่งส่งตรวจ เอกสารยินยอม และทบทวนทางคลินิกของรอบปัจจุบันครบแล้ว</p>:data.policy==="PROCEED_SYNTHETIC_LABELLED"?<p className="notice warning-notice" role="note"><strong>นโยบายจำลอง:</strong> ตัวอย่างที่ติดเฉพาะข้อที่ยังรอการตัดสิน (OD-01, OD-08, OD-16) จัดเข้า Batch ได้พร้อมป้ายกำกับ — ไม่ใช่การรับรองทางคลินิก ข้อที่ไม่ผ่านจริงยังบล็อกเสมอ</p>
   :<p className="notice warning-notice" role="note"><strong>Gate รอการตัดสิน:</strong> เกณฑ์ Clinical Gate (OD-08) และการยอมรับตัวอย่าง (OD-01) ยังไม่ได้รับรอง ระบบจึงยังไม่ให้จัดตัวอย่างเข้า Batch (นโยบาย HOLD)</p>}
  <div className="tabs" role="tablist" aria-label="คิวงาน Lab">{TABS.map(([t,label])=><button key={t} role="tab" type="button" id={`tab-${t}`} aria-selected={tab===t} aria-controls="queue-panel" className="tab" onClick={()=>{setTab(t);setSelected(new Set());}}>{label} <span className="count">{counts[t]}</span></button>)}</div>
  <section id="queue-panel" role="tabpanel" aria-labelledby={`tab-${tab}`} className="panel">
   <div className="filters">
    <div className="field grow"><label htmlFor="q">ค้นหา LN / LN Halos / Sample ID / Run</label><input id="q" type="search" value={query} onChange={e=>setQuery(e.target.value)} autoComplete="off"/></div>
    {!["REDRAW_EXPECTED","LN_HALOS_MISSING"].includes(tab)&&<><div className="field"><label htmlFor="round">รอบ</label><select id="round" value={round} onChange={e=>setRound(e.target.value)}><option value="ALL">ทุกรอบ</option><option value="S1">รอบที่ 1 (HIS)</option><option value="S2">รอบที่ 2+ (เจาะซ้ำ)</option></select></div>
     <label className="check-label"><input type="checkbox" checked={onlyUnprinted} onChange={e=>setOnlyUnprinted(e.target.checked)}/> ยังไม่พิมพ์ฉลาก</label>
     <label className="check-label"><input type="checkbox" checked={urgentOnly} onChange={e=>setUrgentOnly(e.target.checked)}/> ด่วนเท่านั้น</label></>}
    <button className="button secondary" type="button" onClick={reload}>โหลดใหม่</button>
   </div>
   {status&&<p className="notice" role="alert">{status}</p>}
   {tab==="REDRAW_EXPECTED"?<ExpectedTable operational={!!data.operational} rows={data.expected.filter(e=>match(e.hisLn,e.previousLnHalos))} can={can} open={(type,row)=>setDialog({type,row})}/>
   :tab==="LN_HALOS_MISSING"?<MissingTable rows={data.missing.filter(m=>match(m.hisLn))} can={can} open={(type,row)=>setDialog({type,row})}/>
   :<>
    <div className="bulk-bar" aria-live="polite"><span>เลือก {chosen.length} รายการ</span>
     {can.labels&&<button className="button secondary" type="button" disabled={!chosen.length||chosen.some(c=>!c.lnHalos)} onClick={()=>setDialog({type:"labels",samples:chosen})}>พิมพ์ฉลาก ({chosen.length})</button>}
     {can.assign&&tab==="READY"&&<button className="button" type="button" disabled={!chosen.length} onClick={()=>setDialog({type:"assign",samples:chosen})}>เพิ่มเข้า Batch ({chosen.length})</button>}
    </div>
    {attempts.length===0?<p className="empty-state">ไม่มีรายการในคิวนี้{q?" ที่ตรงกับคำค้น":""}</p>:
    <div className="table-wrap" role="region" aria-label="รายการงาน Lab" tabIndex={0}><table className="data-table">
     <caption className="sr-only">รายการตัวอย่าง เรียงตามวันที่/เวลารับสิ่งส่งตรวจ ({sort==="asc"?"เก่าไปใหม่ — FIFO":"ใหม่ไปเก่า"})</caption>
     <thead><tr><th scope="col"><input type="checkbox" aria-label="เลือกทั้งหมดที่แสดง" checked={allShown} onChange={()=>setSelected(allShown?new Set():new Set(attempts.map(a=>a.attemptId)))}/></th><th scope="col">LN (HIS)</th><th scope="col">LN Halos / Sample ID</th><th scope="col" aria-sort={sort==="asc"?"ascending":"descending"}><button type="button" className="sort-button" aria-label={`วันที่/เวลารับสิ่งส่งตรวจ เรียง${sort==="asc"?"เก่าไปใหม่":"ใหม่ไปเก่า"} กดเพื่อสลับ`} onClick={()=>setSort(sort==="asc"?"desc":"asc")}>วันที่/เวลารับ <span aria-hidden="true">{sort==="asc"?"↑":"↓"}</span></button></th><th scope="col">รอบ</th><th scope="col">สถานะ / Gate</th><th scope="col">ฉลาก</th><th scope="col">Batch</th><th scope="col">จัดการ</th></tr></thead>
     <tbody>{attempts.map(a=><tr key={a.attemptId} className={selected.has(a.attemptId)?"selected":undefined}>
      <td><input type="checkbox" aria-label={`เลือก LN ${a.hisLn}`} checked={selected.has(a.attemptId)} onChange={()=>toggle(a.attemptId)}/></td>
      <td><span className="mono">{a.hisLn}</span></td>
      <td><span className="mono strong">{a.labelCode??"—"}</span>{a.printedSampleId&&<div className="mono small">{a.printedSampleId}</div>}{a.pregnancy==="Twins"&&<span className="badge">ครรภ์แฝด (D)</span>}</td>
      <td className="receive-time">{a.receivedAt?bkk(a.receivedAt):"— / ยังไม่รับ"}<div className="small muted">{SOURCE[a.receivedSource??""]??""}</div></td><td>รอบที่ {a.roundNumber}{a.roundNumber>1&&<span className="badge warning">เจาะซ้ำ</span>}{a.repeat&&<span className="badge warning">ตรวจซ้ำ #{a.attemptNumber} {a.repeat.level==="RE_LIBRARY"?"Re-Library":a.repeat.level==="RE_EXTRACTION"?"Re-extraction":""}</span>}</td>
      <td><span className={`status ${a.gate?.eligible?"good":a.category==="GATE_BLOCKED"||a.category==="QC_FAILED"?"bad":"warning"}`}>{STATE[a.attemptState]??a.attemptState}{a.qcFailedStage?` (${a.qcFailedStage})`:""}</span>
       {a.urgent&&<span className="badge danger" title={a.urgentReason??undefined}>ด่วน</span>}{gaBadge(a.ga)}{a.hold&&<span className="badge danger">Hold{a.hold.stage?` ${a.hold.stage}`:""}</span>}{a.resumeDecisionRequired&&<span className="badge danger">รอตัดสินใจทำต่อ</span>}
       {a.gate&&!a.gate.eligible&&<ul className="reasons">{[...a.gate.failed,...(data.policy==="HOLD"?a.gate.pending:[])].map(r=><li key={r}>{gateText(r)}</li>)}</ul>}
       {a.gate?.syntheticPendingAccepted&&<p className="small muted">ผ่านด้วยนโยบายจำลอง: {a.gate.pending.map(gateText).join(", ")}</p>}</td>
      <td>{a.labels.prints?<span className="status good">พิมพ์แล้ว {a.labels.prints}</span>:<span className="status warning">ยังไม่พิมพ์</span>}</td>
      <td>{a.placement?<Link href={`/lab/batches/${a.placement.batchId}${a.placement.slot?`?task=${getSheetNumber(a.placement.slot)}`:""}`}>{a.placement.runLabel} · {a.placement.slot?`Task List ${getSheetNumber(a.placement.slot)} · `:""}ตน. {a.placement.slot}</Link>:"—"}</td>
      <td>{data.operational&&can.receive&&a.attemptState==='Ready'&&<button className="button small" onClick={()=>setDialog({type:'accept',row:a})}>ตรวจสภาพสิ่งส่งตรวจ</button>}<RowActions a={a} can={can} open={(type)=>setDialog({type,row:a})}/></td>
     </tr>)}</tbody></table></div>}
   </>}
  </section>
  {dialog?.type==="labels"&&<LabelDialog samples={(dialog.samples??[dialog.row as Attempt]).map(a=>({roundId:a.roundId,hisLn:a.hisLn,lnHalos:a.lnHalos,labelCode:a.labelCode,roundNumber:a.roundNumber,printed:a.labels.prints}))} onClose={()=>setDialog(null)} onPrinted={reload}/>}
  {dialog?.type==="assign"&&<AssignDialog attempts={dialog.samples!} onClose={()=>setDialog(null)} onDone={async msg=>{setDialog(null);setStatus(msg);await reload();}}/>}
  {dialog&&["accept","urgent","hold","repeat","redraw","receive","recover","cancelRedraw"].includes(dialog.type)&&<ActionDialog operational={!!data.operational} type={dialog.type} row={dialog.row!} onClose={()=>setDialog(null)} onDone={async msg=>{setStatus(msg);await reload();}}/>}
 </>;
}
function RowActions({a,can,open}:{a:Attempt;can:Can;open:(type:string)=>void}){
 return <div className="row-actions">
  {can.labels&&a.lnHalos&&<button className="button small secondary" type="button" onClick={()=>open("labels")}>ฉลาก</button>}
  {can.assign&&["Ready"].includes(a.attemptState)&&<button className="button small secondary" type="button" onClick={()=>open("urgent")}>{a.urgent?"ยกเลิกด่วน":"ด่วน"}</button>}
  {can.hold&&["Ready","Assigned","InProgress"].includes(a.attemptState)&&<button className="button small secondary" type="button" onClick={()=>open("hold")}>{a.hold?"ปลด Hold":"Hold"}</button>}
  {can.repeat&&["QcFailed","Stopped","BatchCancelled"].includes(a.attemptState)&&<button className="button small" type="button" onClick={()=>open("repeat")}>สั่งตรวจซ้ำ</button>}
  {can.redraw&&<button className="button small secondary" type="button" onClick={()=>open("redraw")}>สั่งเจาะซ้ำ</button>}
 </div>;
}
function ExpectedTable({operational,rows,can,open}:{operational:boolean;rows:Expected[];can:Can;open:(t:string,r:Expected)=>void}){
 if(!rows.length)return <p className="empty-state">ไม่มีรอบเจาะซ้ำที่รอรับ</p>;
 return <div className="table-wrap" role="region" aria-label="รอบเจาะซ้ำที่รอ PET ใหม่" tabIndex={0}><table className="data-table"><caption className="sr-only">{operational?"รอบเจาะซ้ำที่รอ PET ใหม่จาก HIS (LN เดิม)":"รอบเจาะซ้ำที่รอรับ (ชุดจำลอง)"}</caption>
  <thead><tr><th scope="col">LN (HIS เดิม)</th><th scope="col">รอบ</th><th scope="col">LN Halos รอบก่อน</th><th scope="col">สั่งเมื่อ / เหตุผล</th><th scope="col">จัดการ</th></tr></thead>
  <tbody>{rows.map(r=><tr key={r.roundId}><td className="mono">{r.hisLn}</td><td>รอบที่ {r.roundNumber} <span className="badge warning">ต้องเก็บตัวอย่างใหม่</span></td><td className="mono">{r.previousLnHalos??"—"}</td><td>{bkk(r.requestedAt)} · {r.reasonCode}</td>
   <td><div className="row-actions">{operational?<span className="badge">รอ PET ใหม่จาก HIS</span>:can.receive&&<button className="button small" type="button" onClick={()=>open("receive",r)}>รับตัวอย่างเจาะซ้ำ (ชุดจำลอง)</button>}{can.redrawCancel&&<button className="button small secondary" type="button" onClick={()=>open("cancelRedraw",r)}>ยกเลิกคำสั่ง</button>}</div></td></tr>)}</tbody></table>
  <p className="help">{operational?"เจ้าหน้าที่กดรับสิ่งส่งตรวจรอบใหม่ใน HIS ตามปกติ (HIS LN เดิม) เมื่อระบบอ่าน .pet/.ok ใหม่ได้ รอบนี้จะรับอัตโนมัติด้วยเวลารับจาก HIS และใช้ LN Halos ฐานเดิมต่อท้าย R — ไม่ต้องรับซ้ำใน NIPT":"ชุดจำลอง: รับรอบเจาะซ้ำในระบบ NIPT ได้เพื่อทดสอบ ในการใช้งานจริงรอบเจาะซ้ำรับจาก PET ใหม่ของ HIS เท่านั้น"}</p></div>;
}
function MissingTable({rows,can,open}:{rows:Missing[];can:Can;open:(t:string,r:Missing)=>void}){
 if(!rows.length)return <p className="empty-state">ทุกรอบที่รับแล้วมี LN Halos</p>;
 return <div className="table-wrap" role="region" aria-label="รอบที่รับก่อนเปิดใช้ P4" tabIndex={0}><table className="data-table"><caption className="sr-only">รอบที่รับก่อนเปิดใช้ P4 และยังไม่มี LN Halos</caption><thead><tr><th scope="col">LN (HIS)</th><th scope="col">รอบ</th><th scope="col">รับเมื่อ</th><th scope="col">จัดการ</th></tr></thead>
  <tbody>{rows.map(r=><tr key={r.roundId}><td className="mono">{r.hisLn}</td><td>รอบที่ {r.roundNumber}</td><td>{SOURCE[r.receivedSource]} {bkk(r.receivedAt)}</td><td>{can.receive&&<button className="button small" type="button" onClick={()=>open("recover",r)}>ออก LN Halos จากการรับเดิม</button>}</td></tr>)}</tbody></table></div>;
}
type BatchView={batch:{id:string;runLabel:string;state:string;version:number}};
function AssignDialog({attempts,onClose,onDone}:{attempts:Attempt[];onClose:()=>void;onDone:(msg:string)=>void}){
 const [batches,setBatches]=useState<Batch[]|null>(null),[batchId,setBatchId]=useState(""),[reason,setReason]=useState(""),[needReason,setNeedReason]=useState(false),[overtaken,setOvertaken]=useState(0),[error,setError]=useState(""),[busy,setBusy]=useState(false),[result,setResult]=useState<null|{placed:{slot:number;printedSampleId:string}[];rejected:{attemptId:string;failed:string[];pending:string[]}[]}>(null);
 const [preview,setPreview]=useState<{slot:number;attemptId:string}[]|null>(null),[task,setTask]=useState(0),[urgentReused,setUrgentReused]=useState(false);
 useEffect(()=>{if(!batchId)return;let live=true;labApi<{slots:{slot:number;sheet:number;control:string|null;assignment:unknown}[];sheets:{sheet_number:number;state:string}[]}>(`/api/p4/batches/${batchId}`).then(b=>{if(!live)return;const free=b.slots.filter(s=>!s.control&&!s.assignment&&(!task||s.sheet===task)&&["Draft","PlanChecked","Amended"].includes(b.sheets[s.sheet-1].state)).map(s=>s.slot);setPreview(attempts.slice(0,free.length).map((a,i)=>({slot:free[i],attemptId:a.attemptId})));}).catch(()=>{if(live)setPreview(null);});return()=>{live=false;};},[batchId,attempts,task]);
 const open=(batches??[]).filter(b=>b.state!=="Cancelled"&&b.sheet_states.some(s=>["Draft","PlanChecked","Amended"].includes(s)));
 // Tell the user before submitting whether this selection overtakes FIFO (same server rule as assign; read-only).
 useEffect(()=>{if(!batchId)return;let live=true;labApi<{overtaken:number;reasonRequired:boolean;urgentReasonReused?:boolean}>(`/api/p4/batches/${batchId}`,{action:"previewAssign",attemptIds:attempts.map(a=>a.attemptId)}).then(p=>{if(!live)return;setOvertaken(p.overtaken);setNeedReason(p.reasonRequired);setUrgentReused(!!p.urgentReasonReused);}).catch(()=>{});return()=>{live=false;};},[batchId,attempts]);
 useEffect(()=>{labApi<Batch[]>("/api/p4/batches").then(b=>{setBatches(b);const d=b.find(x=>x.state==="Draft");if(d)setBatchId(d.id);}).catch(e=>setError(failureText(e)));},[]);
 async function create(){setBusy(true);try{const r=await labApi<{batchId:string}>("/api/p4/batches",{});setBatches(await labApi<Batch[]>("/api/p4/batches"));setBatchId(r.batchId);}catch(e){setError(failureText(e));}finally{setBusy(false);}}
 async function submit(){setBusy(true);setError("");try{const v=await labApi<BatchView>(`/api/p4/batches/${batchId}`);const r=await labApi<NonNullable<typeof result>>(`/api/p4/batches/${batchId}`,{action:"assign",expectedVersion:v.batch.version,attemptIds:attempts.map(a=>a.attemptId),...(task?{sheetNumber:task}:{}),...(reason.trim()?{queueOverrideReason:reason.trim()}:{})});setResult(r);}
  catch(e){if(e instanceof LabFailure&&e.code==="QUEUE_OVERRIDE_REASON_REQUIRED"){setNeedReason(true);const n=Number((e.details as {overtaken?:number}|undefined)?.overtaken);if(n)setOvertaken(n);}setError(failureText(e));}finally{setBusy(false);}}
 return <Dialog title="เพิ่มตัวอย่างเข้า Batch" onClose={onClose}><div className="stack">
  <p>ระบบประเมิน Assignment Gate ใหม่ทุกตัวอย่างขณะบันทึก และเสนอตำแหน่งว่างตามลำดับโดยข้ามช่อง Control (PC 1, NC 25, Blank 40) — ปรับตำแหน่งได้ในหน้า Batch ก่อน Finalize</p>
  <table className="data-table"><caption>ข้อเสนอตำแหน่งตามลำดับที่แสดงบนจอ (ข้ามช่อง Control) — ยืนยันจริงหลังผ่าน Gate และปรับได้ใน Draft</caption><thead><tr><th scope="col">ลำดับ</th><th scope="col">ตำแหน่งที่เสนอ</th><th scope="col">ตัวอย่าง</th><th scope="col">รับเมื่อ</th></tr></thead><tbody>{attempts.map((a,i)=><tr key={a.attemptId}><td>{i+1}</td><td>{batchId?(preview?.[i]?.slot?`ตน. ${preview[i].slot}`:preview?"Batch เต็ม":"…"):"เลือก Batch"}</td><td><span className="mono strong">{a.printedSampleId??a.labelCode}</span> · LN {a.hisLn}{a.urgent&&<span className="badge danger">ด่วน</span>}</td><td>{bkk(a.receivedAt)}</td></tr>)}</tbody></table>
  {result?<><p className="notice success" role="status">จัดเข้า Batch แล้ว {result.placed.length} รายการ: {result.placed.map(p=>`ตน.${p.slot} ${p.printedSampleId}`).join(", ")}</p>{result.rejected.length>0&&<div className="notice" role="alert">ไม่ผ่าน Gate {result.rejected.length} รายการ:<ul>{result.rejected.map(r=><li key={r.attemptId}>{attempts.find(a=>a.attemptId===r.attemptId)?.hisLn}: {[...r.failed,...r.pending].map(gateText).join(", ")}</li>)}</ul></div>}
   <div className="dialog-actions"><a className="button" href={`/lab/batches/${batchId}`}>เปิด Batch</a><button className="button secondary" type="button" onClick={()=>onDone(`จัดเข้า Batch ${result.placed.length} รายการ`)}>ปิด</button></div></>
  :<>{batches===null?<p className="help">กำลังโหลด Batch…</p>:open.length?<div><label htmlFor="batch">Batch</label><select id="batch" value={batchId} onChange={e=>setBatchId(e.target.value)}><option value="">เลือก Batch</option>{open.map(b=><option key={b.id} value={b.id}>{b.run_label} · {b.samples} ตัวอย่าง · {b.state}</option>)}</select></div>:<p>ยังไม่มี Batch ที่จัดตำแหน่งได้</p>}
   <button className="button secondary" type="button" disabled={busy} onClick={create}>สร้าง/เปิด Batch ร่าง (RunNNN/ปี)</button>
   {batchId&&<div><label htmlFor="assign-task">Task ปลายทาง</label><select id="assign-task" value={task} onChange={e=>setTask(Number(e.target.value))}><option value={0}>ช่องว่างแรกตามลำดับ (ค่าเริ่มต้น)</option>{[1,2,3].map(n=><option key={n} value={n}>Task List {n}</option>)}</select><p className="help">เลือก Task เองได้ ระบบยังตรวจ Gate และข้ามช่อง Control เหมือนเดิม</p></div>}
   {urgentReused&&<p className="notice" role="note">ตัวอย่างที่แทรกคิวเป็นงานด่วนที่บันทึกเหตุผลไว้แล้ว — ระบบใช้เหตุผลงานด่วนเป็นเหตุผลแทรกคิว ไม่ต้องกรอกซ้ำ</p>}
   {needReason&&<div><p className="notice warning-notice" role="note">ตัวอย่างที่เลือกแซงลำดับ FIFO {overtaken} รายการที่รอก่อน — ผู้ใช้เลือกแทรกคิวได้ โดยต้องบันทึกเหตุผล (อย่างน้อย 8 ตัวอักษร)</p><label htmlFor="override">เหตุผลที่แซงลำดับ FIFO (จำเป็น)</label><input id="override" value={reason} onChange={e=>setReason(e.target.value)} maxLength={500}/></div>}
   {error&&<p className="notice" role="alert">{error}</p>}
   <div className="dialog-actions"><button className="button" type="button" disabled={busy||!batchId||(needReason&&reason.trim().length<8)} onClick={submit}>ยืนยันเพิ่มเข้า Batch</button><button className="button secondary" type="button" onClick={onClose}>ยกเลิก</button></div></>}
 </div></Dialog>;
}
const REDRAW_REASONS:[string,string][]=[["QC1_FAILED","QC1 ไม่ผ่าน"],["QC_SAMPLE_FAILED","QC ระดับตัวอย่างไม่ผ่าน"],["FETAL_FRACTION_LOW","FF ต่ำ"],["SPECIMEN_PROBLEM","ปัญหาสิ่งส่งตรวจ"],["OTHER","อื่น ๆ"]];
const REPEAT_REASONS:[string,string][]=[["QC1_LOW","QC1 ต่ำกว่าเกณฑ์"],["LIBRARY_FAILURE","Library ล้มเหลว"],["BATCH_CANCELLED","Batch ถูกยกเลิก"],["STOPPED_BY_LAB","Lab หยุดงาน"],["OTHER","อื่น ๆ"]];
function ActionDialog({operational,type,row,onClose,onDone}:{operational:boolean;type:string;row:Attempt|Expected|Missing;onClose:()=>void;onDone:(msg:string)=>Promise<void>}){
 const a=row as Attempt;const [note,setNote]=useState(""),[code,setCode]=useState(""),[level,setLevel]=useState("RE_LIBRARY"),[identity,setIdentity]=useState(false),[label,setLabel]=useState(false),[condition,setCondition]=useState("ACCEPTABLE"),[date,setDate]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState(""),[issued,setIssued]=useState<null|{lnHalos:string;duplicate:boolean}>(null);
 const titles:Record<string,string>={urgent:a.urgent?"ยกเลิกสถานะด่วน":"ตั้งเป็นงานด่วน",hold:a.hold?"ปลด Hold":"ระงับ (Hold)",repeat:"สั่งตรวจซ้ำ (Repeat) — สิ่งส่งตรวจเดิม",redraw:"สั่งเก็บตัวอย่างใหม่ (Redraw)",receive:"รับตัวอย่างเจาะซ้ำใน NIPT",recover:"ออก LN Halos จากการรับเดิม",cancelRedraw:"ยกเลิกคำสั่งเก็บตัวอย่างใหม่"};
 async function submit(){setBusy(true);setError("");try{
  const body:Record<string,unknown>=type==='accept'?{action:'acceptSpecimen',roundId:a.roundId,identityChecked:identity,labelChecked:label,condition:condition==='ACCEPTABLE'?'ACCEPTABLE':'REJECTED',criteriaReference:code,reason:note}:type==="urgent"?{action:"setUrgent",attemptId:a.attemptId,urgent:!a.urgent,reason:note}:type==="hold"?{action:"setHold",attemptId:a.attemptId,hold:!a.hold,reason:note}
   :type==="repeat"?{action:"orderRepeat",attemptId:a.attemptId,level,reasonCode:code,note}:type==="redraw"?{action:"orderRedraw",caseId:row.caseId,reasonCode:code,note}:type==="cancelRedraw"?{action:"cancelRedraw",caseId:row.caseId,reason:note}
   :type==="recover"?{action:"recoverLnHalos",roundId:row.roundId,reason:note}:{action:"receiveRedraw",roundId:row.roundId,identityChecked:identity,labelChecked:label,condition,...(condition==="PROBLEM_NOTED"?{conditionNote:note}:{}),collectionDate:date};
  const r=await labApi<Record<string,unknown>>("/api/p4/worklist",body);
  if(type==="receive"||type==="recover"){setIssued(r as {lnHalos:string;duplicate:boolean});await onDone(`LN Halos ${String(r.lnHalos)}`);}
  else{await onDone(type==="repeat"?`สั่งตรวจซ้ำแล้ว — Attempt #${String(r.attemptNumber)} ${r.printedSampleId?String(r.printedSampleId):"(รูปแบบ Printed Sample ID รอ OD-03)"}`:type==="redraw"?`สั่งเก็บตัวอย่างใหม่แล้ว — รอบที่ ${String(r.newRoundNumber)} ${operational?"รอ PET ใหม่จาก HIS":"รอรับ (ชุดจำลอง)"}`:"บันทึกแล้ว");onClose();}
 }catch(e){setError(failureText(e));}finally{setBusy(false);}}
 const needsNote=type!=="receive"||condition==="PROBLEM_NOTED";
 const valid=(!needsNote||note.trim().length>=8)&&(!["repeat","redraw"].includes(type)||code)&&(type!=="receive"||(identity&&label&&date))&&(type!=='accept'||(identity&&label&&code.trim().length>=8));
 return <Dialog title={type==='accept'?'ตรวจสภาพสิ่งส่งตรวจ (หลังรับใน HIS)':titles[type]} onClose={onClose}><div className="stack">
  <p className="mono">LN {row.hisLn} · รอบที่ {row.roundNumber}{"lnHalos" in row&&row.lnHalos?` · ${row.lnHalos}`:""}</p>
  {type==="repeat"&&<><p className="help">ใช้สิ่งส่งตรวจเดิม ไม่สร้างรอบใหม่ ไม่เกี่ยวกับ HIS — Attempt เดิมถูกแทนที่และเก็บประวัติไว้ ชื่อระดับการตรวจซ้ำรอ OD-03; Printed Sample ID สร้างได้เฉพาะรูปแบบเดิมของ Genomic-CBH (Re-Library ครั้งแรก = -2)</p>
   <fieldset><legend>ระดับการตรวจซ้ำ</legend><label className="check-label"><input type="radio" name="level" checked={level==="RE_LIBRARY"} onChange={()=>setLevel("RE_LIBRARY")}/> Re-Library</label><label className="check-label"><input type="radio" name="level" checked={level==="RE_EXTRACTION"} onChange={()=>setLevel("RE_EXTRACTION")}/> Re-extraction (พลาสมาหลอดที่ 2 — รูปแบบ ID รอ OD-03)</label></fieldset></>}
  {type==="redraw"&&<p className="help">สร้างรอบใหม่ภายใต้ HIS LN เดิม งานที่ค้างของรอบนี้ถูกหยุด ANC เห็นสถานะ “ต้องเก็บตัวอย่างใหม่” ทันที — ไม่มีการเขียนใด ๆ ไป HIS{operational?" รอบใหม่จะรับเมื่อ HIS ส่ง PET ใหม่ของ LN เดิม":""}</p>}
  {(type==="repeat"||type==="redraw")&&<div><label htmlFor="code">รหัสเหตุผล</label><select id="code" value={code} onChange={e=>setCode(e.target.value)}><option value="">เลือกเหตุผล</option>{(type==="repeat"?REPEAT_REASONS:REDRAW_REASONS).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></div>}
  {type==='accept'&&<div><label htmlFor="acceptance-criteria">เอกสาร / เกณฑ์ที่ใช้ตรวจรับ</label><input id="acceptance-criteria" value={code} onChange={e=>setCode(e.target.value)}/></div>}
  {['receive','accept'].includes(type)&&!issued&&<>{type==='accept'&&<p className="help">รับสิ่งส่งตรวจใน HIS แล้ว (เวลารับจาก PET) — ขั้นนี้บันทึกผลตรวจสภาพหลอดและฉลากก่อนจัดเข้า Batch ไม่ใช่การรับซ้ำ</p>}{type==='receive'&&<p className="help">บันทึกเมื่อตัวอย่างมาถึง Lab จริงเท่านั้น — LN Halos ของรอบนี้ออกจากการรับครั้งนี้ หากกดซ้ำจะได้เลขเดิม</p>}
   <label className="check-label"><input type="checkbox" checked={identity} onChange={e=>setIdentity(e.target.checked)}/> ตรวจตัวตนผู้รับบริการตรงกับ HIS LN เดิมแล้ว</label>
   <label className="check-label"><input type="checkbox" checked={label} onChange={e=>setLabel(e.target.checked)}/> ตรวจฉลากหลอดตรงกับเคสและรอบแล้ว</label>
   <fieldset><legend>สภาพสิ่งส่งตรวจ (นโยบายการยอมรับรอ OD-01)</legend><label className="check-label"><input type="radio" name="cond" checked={condition==="ACCEPTABLE"} onChange={()=>setCondition("ACCEPTABLE")}/> {type==='accept'?"ยอมรับสิ่งส่งตรวจ":"ไม่พบปัญหา"}</label><label className="check-label"><input type="radio" name="cond" checked={condition==="PROBLEM_NOTED"} onChange={()=>setCondition("PROBLEM_NOTED")}/> {type==='accept'?"ปฏิเสธสิ่งส่งตรวจ (ไม่จัดเข้า Batch)":"พบปัญหา (ระบุ)"}</label></fieldset>
   {type==='receive'&&<div><label htmlFor="cdate">วันที่เจาะเลือดของรอบนี้</label><ThaiDateInput id="cdate" value={date} onChange={setDate}/></div>}</>}
  {issued?<p className="notice success" role="status">{issued.duplicate?"รับไว้แล้วก่อนหน้า — ":""}LN Halos ของรอบนี้: <strong className="mono">{issued.lnHalos}</strong> พิมพ์ฉลากได้จากคิว “พร้อมเข้าตรวจ/ติด Gate”</p>
   :needsNote&&<div><label htmlFor="note">{type==="receive"?"รายละเอียดปัญหา":"เหตุผล"} (อย่างน้อย 8 ตัวอักษร)</label><textarea id="note" value={note} onChange={e=>setNote(e.target.value)} maxLength={500} rows={3}/></div>}
  {error&&<p className="notice" role="alert">{error}</p>}
  <div className="dialog-actions">{!issued&&<button className="button" type="button" disabled={busy||!valid} onClick={submit}>ยืนยัน</button>}<button className="button secondary" type="button" onClick={onClose}>{issued?"ปิด":"ยกเลิก"}</button></div>
 </div></Dialog>;
}
