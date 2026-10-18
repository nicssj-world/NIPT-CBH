"use client";
import Link from "next/link";
import {Fragment,useCallback,useEffect,useRef,useState} from "react";
import {labApi,failureText} from "../p4/lab-api";
import {STATE_TEXT,STATE_TONE,BATCH_TEXT,COLUMN_LABEL,OUTCOME_TEXT,REJECT_TEXT,issueText} from "./labels";
import {Pager} from "../shared/pager";

type Issue={code:string;severity:"ERROR"|"WARN";ref?:string};
type DateValue={precision:string;value?:string};
type Row={id:string;rowNo:number;ln:string;state:string;version:number;issues:Issue[];pdfName:string|null;canVerify:boolean;cells:Record<string,string>;
 evaluation:{outcome:string;reasons:{code:string;ref?:string}[]}|null;identifiers:{hn:string|null;name:string|null;dob:string|null};originalLocation:string|null;
 evidence:{id:string;kind:string;date:DateValue}[];events:{id:string;type:string;date:DateValue}[];completeness:{status:string;missing:string[]}|null;pastCertification:{state:string;text?:string}};
type PageInfo={number:number;size:number;total:number;totalPages:number};
/** One page of rows plus a summary counted over the WHOLE batch (the server pages and searches; nothing here loads every row). */
type Batch={batch:{id:string;state:string;table_name:string;row_count:number|null;error_code:string|null;issues:{code:string;ref?:string}[]};ready:boolean;blockers:string[];files:{id:string;role:string;original_name:string;state:string;reject_code:string|null}[];
 summary:{total:number;ready:number;problem:number;done:number};view:string;page:PageInfo;rows:Row[]};
type Outcome={draftId:string;rowNo:number;outcome:string;code?:string};
type Check={ln:boolean;anchor:boolean;pdf:boolean;identity:boolean;ids:Set<string>};
type ListParams={q:string;page:number;pageSize:number};
const EDIT_COLUMNS=["ln","hn","name","dob","collection_date","receipt_date","report_date","control_record_date","request_date","consent_date","pdf_file","original_location","request_paper","consent_paper","consent_decision","pregnancy_type","past_certification"];
const dateText=(d:DateValue)=>d.precision==="UNKNOWN"?"ไม่ทราบ":d.value??"—";
const SIZES=[50,100] as const;

export function HistoricalBatch({id,canImport,canReview}:{id:string;canImport:boolean;canReview:boolean}){
 const [data,setData]=useState<Batch|null>(null),[review,setReview]=useState<Batch|null>(null),[error,setError]=useState(""),[notice,setNotice]=useState(""),[busy,setBusy]=useState(false);
 const [onlyProblems,setOnlyProblems]=useState(true),[fix,setFix]=useState<ListParams>({q:"",page:1,pageSize:50}),[typedFix,setTypedFix]=useState("");
 const [look,setLook]=useState<ListParams>({q:"",page:1,pageSize:50}),[typedLook,setTypedLook]=useState("");
 const [editing,setEditing]=useState<string|null>(null),[patch,setPatch]=useState<Record<string,string>>({}),[reason,setReason]=useState("");
 // Ticks and the rows they belong to survive paging, so the reviewer can work through several pages and confirm everything ticked at once.
 const [checks,setChecks]=useState<Record<string,Check>>({}),[seen,setSeen]=useState<Record<string,Row>>({}),[outcomes,setOutcomes]=useState<Outcome[]|null>(null);
 const timer=useRef<ReturnType<typeof setTimeout>|null>(null),seq=useRef({fix:0,look:0});
 const fetchView=useCallback((view:string,p:ListParams)=>labApi<Batch>(`/api/p5h/batches/${id}?${new URLSearchParams({view,q:p.q,page:String(p.page),pageSize:String(p.pageSize)})}`),[id]);
 const loadFix=useCallback(async()=>{const n=++seq.current.fix;try{const d=await fetchView(onlyProblems?"auto":"all",fix);if(n===seq.current.fix){setData(d);setError("");}}catch(e){if(n===seq.current.fix)setError(failureText(e));}},[fetchView,onlyProblems,fix]);
 const staged=data?.batch.state==="Staged";
 const loadLook=useCallback(async()=>{const n=++seq.current.look;try{const d=await fetchView("ready",look);if(n===seq.current.look){setReview(d);setSeen(s=>({...s,...Object.fromEntries(d.rows.map(r=>[r.id,r]))}));}}catch(e){if(n===seq.current.look)setError(failureText(e));}},[fetchView,look]);
 useEffect(()=>{void Promise.resolve().then(loadFix);return()=>{if(timer.current)clearTimeout(timer.current);};},[loadFix]);
 useEffect(()=>{if(staged&&canReview)void Promise.resolve().then(loadLook);},[staged,canReview,loadLook]);
 // The worker stages the batch; poll until it is finished.
 const waiting=data?.batch.state==="Uploaded"||data?.batch.state==="Staging";
 useEffect(()=>{if(!waiting)return;timer.current=setTimeout(()=>void loadFix(),1500);return()=>{if(timer.current)clearTimeout(timer.current);};},[waiting,data,loadFix]);
 // Searching the batch by LN asks the server once typing pauses.
 useEffect(()=>{const t=setTimeout(()=>setFix(p=>p.q===typedFix.trim()?p:{...p,q:typedFix.trim(),page:1}),350);return()=>clearTimeout(t);},[typedFix]);
 useEffect(()=>{const t=setTimeout(()=>setLook(p=>p.q===typedLook.trim()?p:{...p,q:typedLook.trim(),page:1}),350);return()=>clearTimeout(t);},[typedLook]);
 const reloadAll=async()=>{await Promise.all([loadFix(),staged&&canReview?loadLook():Promise.resolve()]);};
 const act=async(body:Record<string,unknown>,done:string)=>{setBusy(true);setError("");setNotice("");try{const r=await labApi<Record<string,unknown>>(`/api/p5h/batches/${id}`,body);setNotice(done);await reloadAll();return r;}catch(e){setError(failureText(e));return null;}finally{setBusy(false);}};
 const counts=data?.summary??{total:0,ready:0,problem:0,done:0};
 const startEdit=(r:Row)=>{setEditing(r.id);setPatch({});setReason("");};
 const checkOf=(rowId:string):Check=>checks[rowId]??{ln:false,anchor:false,pdf:false,identity:false,ids:new Set()};
 const setCheck=(rowId:string,c:Partial<Check>)=>setChecks(s=>({...s,[rowId]:{...checkOf(rowId),...c}}));
 const complete=(r:Row)=>{const c=checkOf(r.id);return c.ln&&c.anchor&&(c.pdf||!r.pdfName)&&c.identity&&c.ids.size>=2;};
 const quick=(r:Row)=>setCheck(r.id,{ln:true,anchor:true,pdf:true,identity:true,ids:new Set(["HN","NAME",...(r.identifiers.dob?["DOB"]:[])])});
 // Everything fully ticked on ANY page the reviewer has visited - not only the rows currently on screen.
 const toConfirm=Object.values(seen).filter(r=>r.state==="Submitted"&&r.canVerify&&complete(r));
 async function confirm(){
  const r=await act({action:"confirm",idempotencyKey:crypto.randomUUID(),rows:toConfirm.map(x=>({draftId:x.id,version:x.version,attestation:{lnMatchesOriginal:checkOf(x.id).ln,anchorDateMatchesOriginal:checkOf(x.id).anchor,pdfBindingMatchesOriginal:checkOf(x.id).pdf||!x.pdfName,identityMatchesOriginal:checkOf(x.id).identity,identityIdentifiersChecked:[...checkOf(x.id).ids]}}))},"ยืนยันแล้ว");
  if(r){const done=(r as {outcomes:Outcome[]}).outcomes;setOutcomes(done);setSeen(s=>{const n={...s};for(const o of done)delete n[o.draftId];return n;});}
 }
 const pdfFileId=(r:Row)=>data?.files.find(f=>f.original_name===r.pdfName&&f.state==="Parsed")?.id;

 if(!data)return <>{error?<p className="form-error" role="alert">{error}</p>:<p role="status">กำลังโหลด…</p>}<Link href="/historical">← กลับ</Link></>;
 const shown=data.rows,lookRows=review?.rows??[];
 return <>
  <p><Link href="/historical">← ชุดนำเข้าทั้งหมด</Link></p>
  <h1>ชุดนำเข้า: {data.batch.table_name}</h1>
  <ol className="request-steps" aria-label="ขั้นตอน"><li aria-current={undefined}>① อัปโหลดแล้ว</li><li aria-current={data.batch.state==="Staged"&&counts.problem>0?"step":undefined}>② ตรวจสอบและแก้ไข</li><li aria-current={data.batch.state==="Staged"&&counts.problem===0?"step":undefined}>③ ผู้ตรวจรับรองและยืนยัน</li></ol>
  {error&&<p className="form-error" role="alert">{error}</p>}{notice&&<p role="status" className="status good">{notice}</p>}
  {waiting&&<p role="status">Worker กำลังตรวจตารางและ PDF ({BATCH_TEXT[data.batch.state]}) — หน้านี้จะอัปเดตเอง</p>}
  {data.batch.state==="Failed"&&<p className="form-error" role="alert">ตรวจตารางไม่สำเร็จ: {data.batch.error_code} — แก้ไฟล์แล้วอัปโหลดใหม่</p>}
  {data.batch.state==="Staged"&&!data.ready&&<div className="panel" role="status"><strong>ยังยืนยันเป็นชุดไม่ได้ (Fail Closed)</strong><ul>{data.blockers.map(b=><li key={b}>{issueText(b)}</li>)}</ul>
   {canImport&&<button className="button secondary" disabled={busy} onClick={()=>void act({action:"recheck"},"ตรวจสิทธิ์ใหม่แล้ว")}>ตรวจสิทธิ์อีกครั้ง (หลัง Owner อนุมัติ)</button>}</div>}
  {data.batch.state==="Staged"&&<>
   <div className="panel" aria-label="สรุป"><p><strong>{counts.total}</strong> แถว · พร้อมให้รับรอง <strong>{counts.ready}</strong> · ต้องแก้/ยังไม่มีสิทธิ์ <strong>{counts.problem}</strong> · นำเข้าแล้ว <strong>{counts.done}</strong></p>
    {data.batch.issues.length>0&&<ul>{data.batch.issues.map((i,n)=><li key={n}>{i.code==="PDF_NOT_USED"?`ไฟล์ PDF ไม่ถูกใช้โดยแถวใด: ${i.ref}`:`ไฟล์ถูกปฏิเสธ (${i.code.replace("FILE_REJECTED_","")}): ${i.ref}`}</li>)}</ul>}</div>

   <section className="panel" aria-labelledby="hist-step2"><h2 id="hist-step2">② ตรวจสอบรายการ</h2>
    <div className="filters"><div className="field grow"><label htmlFor="hist-q2">ค้นหา LN ในชุดนี้</label><input id="hist-q2" type="search" value={typedFix} onChange={e=>setTypedFix(e.target.value)} autoComplete="off" maxLength={40}/></div>
     <label className="check"><input type="checkbox" checked={onlyProblems} onChange={e=>{setOnlyProblems(e.target.checked);setFix(p=>({...p,page:1}));}}/> แสดงเฉพาะแถวที่ต้องแก้ไข ({counts.problem})</label></div>
    {shown.length===0?<p className="empty-state" role="status">{counts.problem===0&&data.view==="all"&&!fix.q?"ไม่มีแถวในชุดนี้":fix.q?"ไม่พบแถวที่ตรงกับ LN ที่ค้น":"ไม่มีแถวที่ต้องแก้ไข"}</p>:
    <div className="table-wrap" role="region" aria-label="รายการที่นำเข้า" tabIndex={0}><table className="data-table"><caption className="sr-only">รายการที่นำเข้า</caption><thead><tr><th scope="col">แถว</th><th scope="col">LN</th><th scope="col">HN / ชื่อ</th><th scope="col">PDF</th><th scope="col">สถานะ</th><th scope="col">สิ่งที่ต้องแก้ / ข้อสังเกต</th><th scope="col"><span className="sr-only">การทำงาน</span></th></tr></thead>
     <tbody>{shown.map(r=><Fragment key={r.id}>
      <tr><td>{r.rowNo}</td><td>{r.ln}</td><td>{r.identifiers.hn} · {r.identifiers.name}</td><td>{r.pdfName??"—"}</td>
       <td><span className={`status ${STATE_TONE[r.state]??""}`}>{STATE_TEXT[r.state]??r.state}</span></td>
       <td><ul className="plain">{[...r.issues.map(i=>({text:issueText(i.code),warn:i.severity==="WARN"})),...(r.state==="NotEligible"?(r.evaluation?.reasons??[]).map(x=>({text:issueText(x.code),warn:false})):[])].map((x,n)=><li key={n}>{x.warn?"⚠ ":""}{x.text}</li>)}</ul>{r.completeness?.status==="PARTIAL"&&<p className="hint">หลักฐานยังไม่ครบ: {r.completeness.missing.join(", ")}</p>}</td>
       <td>{canImport&&["Draft","NotEligible","Discrepancy"].includes(r.state)&&<button className="button small secondary" onClick={()=>startEdit(r)} aria-label={`แก้ไขแถว ${r.rowNo}`}>แก้ไข</button>}</td></tr>
      {editing===r.id&&<tr><td colSpan={7}><div className="panel"><h3>แก้ไขแถว {r.rowNo} (แก้เฉพาะช่องที่ผิด)</h3>
       <div className="form-grid">{EDIT_COLUMNS.map(c=><div className="field" key={c}><label htmlFor={`f-${r.id}-${c}`}>{COLUMN_LABEL[c]}</label><input id={`f-${r.id}-${c}`} value={patch[c]??r.cells[c]??""} onChange={e=>setPatch(p=>({...p,[c]:e.target.value}))}/></div>)}</div>
       <div className="field"><label htmlFor={`why-${r.id}`}>เหตุผลที่แก้ (อย่างน้อย 8 ตัวอักษร — ไม่ใส่เลขประจำตัว)</label><input id={`why-${r.id}`} value={reason} onChange={e=>setReason(e.target.value)}/></div>
       <div className="button-row"><button className="button" disabled={busy||reason.trim().length<8||!Object.keys(patch).length} onClick={async()=>{if(await act({action:"fix",draftId:r.id,patch,reason},`แก้แถว ${r.rowNo} แล้ว`))setEditing(null);}}>บันทึกและตรวจใหม่</button>
        {["Draft","NotEligible","Discrepancy"].includes(r.state)&&<button className="button secondary" disabled={busy||reason.trim().length<8} onClick={async()=>{if(await act({action:"abandon",draftId:r.id,reason},`ยกเลิกแถว ${r.rowNo} แล้ว`))setEditing(null);}}>ยกเลิกแถวนี้</button>}
        <button className="button secondary" onClick={()=>setEditing(null)}>ปิด</button></div></div></td></tr>}
     </Fragment>)}</tbody></table></div>}
    <Pager label="รายการที่นำเข้า" sizes={SIZES} page={data.page.number} pageSize={data.page.size} total={data.page.total} totalPages={data.page.totalPages} onPage={n=>setFix(p=>({...p,page:n}))} onSize={n=>setFix(p=>({...p,pageSize:n,page:1}))}/>
    {counts.problem===0&&<p role="status">ไม่มีแถวที่ต้องแก้ไข</p>}
   </section>

   <section className="panel" aria-labelledby="hist-step3"><h2 id="hist-step3">③ ผู้ตรวจตรวจกับต้นฉบับและยืนยันเป็นชุด</h2>
    {!canReview?<p>ขั้นตอนนี้ทำได้เฉพาะผู้ตรวจ (Historical Verifier) ที่ไม่ใช่ผู้นำเข้าหรือผู้แก้ไขแถวนั้น</p>:<>
     <p className="hint">ตรวจแต่ละแถวกับเอกสารต้นฉบับ แล้วติ๊กทุกข้อก่อน ระบบไม่มีปุ่มติ๊กทั้งชุดโดยตั้งใจ — แถวที่ไม่ได้ติ๊กครบจะไม่ถูกยืนยัน แถวที่ติ๊กครบไว้ในหน้าอื่นยังนับอยู่ ({toConfirm.length} แถว)</p>
     <div className="filters"><div className="field grow"><label htmlFor="hist-q3">ค้นหา LN ในแถวที่รอรับรอง</label><input id="hist-q3" type="search" value={typedLook} onChange={e=>setTypedLook(e.target.value)} autoComplete="off" maxLength={40}/></div></div>
     {lookRows.length>0&&<div className="table-wrap" role="region" aria-label="แถวที่พร้อมให้ผู้ตรวจรับรอง" tabIndex={0}><table className="data-table"><caption className="sr-only">แถวที่พร้อมให้ผู้ตรวจรับรอง</caption><thead><tr><th scope="col">แถว</th><th scope="col">เคส</th><th scope="col">หลักฐาน</th><th scope="col">ตรวจกับต้นฉบับ</th></tr></thead>
      <tbody>{lookRows.map(r=>{const c=checkOf(r.id),f=pdfFileId(r);return <tr key={r.id}>
       <td>{r.rowNo}</td>
       <td><strong>LN {r.ln}</strong><br/>HN {r.identifiers.hn}<br/>{r.identifiers.name}<br/>เกิด {r.identifiers.dob??"ไม่ปรากฏในหลักฐาน"}</td>
       <td>ที่เก็บ: {r.originalLocation}<br/>{r.evidence.map(e=><span key={e.id} className="p5-nowrap">{e.kind==="FINAL_RESULT_REPORT"?"รายงานผล":e.kind==="REQUEST_PAPER"?"ใบขอส่งตรวจ":e.kind==="CONSENT_PAPER"?"ใบยินยอม":e.kind} {dateText(e.date)}; </span>)}<br/>{r.pdfName&&f?<a href={`/api/p5h/batches/${id}/files/${f}`} target="_blank" rel="noreferrer">เปิด PDF ต้นฉบับ</a>:"ไม่มี PDF"}
        {r.issues.filter(i=>i.severity==="WARN").map((i,n)=><p key={n} className="hint">⚠ {issueText(i.code)}</p>)}</td>
       <td>{!r.canVerify?<span className="hint">คุณเป็นผู้นำเข้า/แก้ไขแถวนี้ — ต้องให้ผู้ตรวจคนอื่นรับรอง</span>:<fieldset><legend className="sr-only">ตรวจแถว {r.rowNo}</legend>
        {([["ln","LN ตรงต้นฉบับ"],["anchor","วันที่รายงานผลตรง"],...(r.pdfName?[["pdf","PDF เป็นของเคสนี้"]]:[]),["identity","ตัวตนตรงต้นฉบับ"]] as [keyof Check,string][]).map(([k,label])=><label className="check" key={k}><input type="checkbox" checked={Boolean(c[k])} onChange={e=>setCheck(r.id,{[k]:e.target.checked})}/> {label}</label>)}
        <p className="hint">ตัวระบุที่ตรวจ (อย่างน้อย 2):</p>{(["HN","NAME",...(r.identifiers.dob?["DOB"]:[])]).map(k=><label className="check" key={k}><input type="checkbox" checked={c.ids.has(k)} onChange={e=>{const s=new Set(c.ids);if(e.target.checked)s.add(k);else s.delete(k);setCheck(r.id,{ids:s});}}/> {k==="NAME"?"ชื่อ":k==="DOB"?"วันเกิด":"HN"}</label>)}
        <button className="button small secondary" type="button" onClick={()=>quick(r)}>ตรวจครบทุกข้อของแถวนี้แล้ว</button></fieldset>}</td></tr>;})}</tbody></table></div>}
     {review&&<Pager label="แถวที่รอรับรอง" sizes={SIZES} page={review.page.number} pageSize={review.page.size} total={review.page.total} totalPages={review.page.totalPages} onPage={n=>setLook(p=>({...p,page:n}))} onSize={n=>setLook(p=>({...p,pageSize:n,page:1}))}/>}
     {!counts.ready&&<p>ยังไม่มีแถวที่พร้อมให้รับรอง</p>}
     <div className="button-row"><button className="button" disabled={busy||!data.ready||!toConfirm.length} onClick={()=>void confirm()}>ยืนยันแถวที่ตรวจครบ ({toConfirm.length} แถว)</button></div>
     {!data.ready&&<p className="hint">ยืนยันไม่ได้จนกว่า Owner จะอนุมัติ Anchor และวันตัดระบบ</p>}
    </>}
    {outcomes&&<div role="status"><h3>ผลการยืนยัน</h3><ul>{outcomes.map(o=><li key={o.draftId}>แถว {o.rowNo}: {OUTCOME_TEXT[o.outcome]??o.outcome}{o.code?` — ${REJECT_TEXT[o.code]??o.code}`:""}</li>)}</ul></div>}
   </section>
  </>}
 </>;
}
