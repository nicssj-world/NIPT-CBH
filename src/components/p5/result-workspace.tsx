"use client";
import {FileDropInput} from "../shared/file-drop-input";
import Link from "next/link";
import {useCallback,useEffect,useMemo,useRef,useState} from "react";
import {labApi,failureText,bkk} from "../p4/lab-api";
import {csrf} from "../p2/shared";
import {Pager} from "../shared/pager";
import {STATE_TEXT,STATE_TONE,KIND_TEXT,CONTAINER_TEXT,INTAKE_TEXT,SCAN_TEXT,REJECT_TEXT,FOLDER_ERROR_TEXT,CHECK_TEXT,bytes} from "./labels";

type Job<T=Record<string,unknown>>={id:string;kind:string;state:string;result:T|null;intakes:Intake[]};
type Check={code:string;passed:boolean};
type TestResult={passed:boolean;checks:Check[];files:number;folders:number;errorCode:string|null;folder:string};
type ScanFile={path:string;folder:string;name:string;size:number;modifiedAt:string;sha256:string|null;status:string};
type ScanResult={folder:string;files:ScanFile[];folders:number;truncated:boolean;errorCode:string|null};
type Summary={result?:string|null;labNumber:string|null;hn:string|null;collectionDate:string|null;t21:string|null;t18:string|null;t13:string|null;sca:string[]|null;yChromosome:string|null;fetalFraction:number|null;qc:string|null;needsManualReview:boolean;abnormal:boolean;unreadable:string[]};
type Intake={id:string;file:string;member:string|null;parentId:string|null;container:string|null;state:string;rejectCode:string|null;templateKind:string|null;summary:Summary|null;candidates:number;size:number;nameConflicts?:{versions:{id:string;state:string}[];sameBatch:number}};
type Row={id:string;kind:string;template_kind:string;state:string;state_changed_at:string;original_name:string;relative_path:string|null;member_name:string|null;hn:string|null;lab:string|null;collection:string|null;round_number:number|null;ln:string|null;proposal:boolean;abnormal:boolean;name_conflict:boolean};
type Data={page:{number:number;size:number;hasNext:boolean;total:number;totalPages:number;scope:"BOUNDED_PAGE"};rows:Row[];latestFolder:{folder:string;at:string}|null;intake:{folder:string;scanSubfolders:boolean;acceptZip:boolean;maxUploadMb:number;maxFilesPerScan:number;picVersion:string;scanMode:"ON_DEMAND";lastTest:{result:TestResult|null;completed_at:string|null}|null;lastScan:{result:ScanResult|null;completed_at:string|null}|null}};
const BUCKETS=[["unlinked","รอเชื่อมโยง",["Unlinked"]],["conflict","ข้อมูลไม่ตรง",["LinkConflict"]],["blocked","ถูกบล็อกโดย Gate",["ValidationBlocked"]],["pending","รอรับรอง",["PendingCertification"]],["closed","ปิดแล้ว/ใช้ไม่ได้",["RejectedImport","Superseded","Voided","CertifiedReleased"]]] as const;
const DEFAULT_FILTERS={dateField:"REPORTED",from:"",to:"",q:"",gender:"ALL",qc:"ALL",risk:"ALL"};
const STEPS=["ทดสอบโฟลเดอร์","สแกนไฟล์ PDF","เลือกไฟล์และ Preview","ยืนยันนำเข้า"];

/** Polls the requester's own worker job until its receipt exists. The worker, not the browser, reads the folder. */
async function waitForJob<T>(id:string,signal:AbortSignal):Promise<Job<T>>{
 for(let i=0;i<120;i++){if(signal.aborted)throw new Error("ABORTED");const j=await labApi<Job<T>>(`/api/p5/jobs/${id}`);if(j.state==="Completed")return j;await new Promise(r=>setTimeout(r,i<5?400:1000));}
 throw new Error("WORKER_TIMEOUT");
}
const jobError=(e:unknown)=>e instanceof Error&&e.message==="WORKER_TIMEOUT"?"Worker ยังไม่ตอบภายใน 2 นาที — ตรวจหน้า สถานะระบบ ว่า Worker ทำงานอยู่ แล้วลองใหม่":failureText(e);
const Status=({tone,children}:{tone?:string;children:React.ReactNode})=><span className={`status ${tone??""}`}>{children}</span>;
function resultLine(s:Summary|null,kind:string|null){
 if(!s||!kind)return "—";if(kind==="REDRAW_NOTICE")return "หนังสือแจ้ง";if(kind==="UNKNOWN")return "—";
 if(s.result==="No Call")return "No Call";
 const t=[s.t21,s.t18,s.t13].map(v=>v??"อ่านไม่ได้").join(" / ");return kind==="TWIN"?`${t} · Y: ${s.yChromosome??"อ่านไม่ได้"}`:`${t} · FF ${s.fetalFraction??"อ่านไม่ได้"}`;
}

export function ResultWorkspace({canImport,canSettings,canExport=false}:{canImport:boolean;canSettings:boolean;canExport?:boolean}){
 const [data,setData]=useState<Data|null>(null),[error,setError]=useState(""),[notice,setNotice]=useState("");
 const [tab,setTab]=useState<"folder"|"upload">("folder"),[bucket,setBucket]=useState<string>("unlinked");
 const [busy,setBusy]=useState<string|null>(null),[test,setTest]=useState<TestResult|null>(null),[scan,setScan]=useState<ScanResult|null>(null),[picked,setPicked]=useState<Set<string>>(new Set());
 const [preview,setPreview]=useState<Intake[]|null>(null),[toImport,setToImport]=useState<Set<string>>(new Set()),[acked,setAcked]=useState<Set<string>>(new Set()),[uploadRejected,setUploadRejected]=useState<{name:string;code:string}[]>([]);
 const [draftFilters,setDraftFilters]=useState(DEFAULT_FILTERS),[filters,setFilters]=useState(DEFAULT_FILTERS),[page,setPage]=useState(1),[pageSize,setPageSize]=useState(50),[queueLoading,setQueueLoading]=useState(false);
 const query=useMemo(()=>({bucket,...filters,...(!filters.from?{from:undefined}:{}),...(!filters.to?{to:undefined}:{}),page,pageSize}),[bucket,filters,page,pageSize]);
 const loadSequence=useRef(0);
 const abort=useRef<AbortController|null>(null),fileInput=useRef<HTMLInputElement>(null);
 const load=useCallback(async()=>{const seq=++loadSequence.current;setQueueLoading(true);setData(null);try{const d=await labApi<Data>("/api/p5/results",{action:"query",...query});if(seq!==loadSequence.current)return;setData(d);setTest(t=>t??d.intake.lastTest?.result??null);setScan(s=>s??d.intake.lastScan?.result??null);setError("");}catch(e){if(seq===loadSequence.current)setError(failureText(e));}finally{if(seq===loadSequence.current)setQueueLoading(false);}},[query]);
 useEffect(()=>{void Promise.resolve().then(load);return()=>abort.current?.abort();},[load]);
 const run=async<T,>(label:string,fn:(signal:AbortSignal)=>Promise<T>)=>{abort.current?.abort();const c=new AbortController();abort.current=c;setBusy(label);setError("");setNotice("");try{return await fn(c.signal);}catch(e){if(!(e instanceof Error&&e.message==="ABORTED"))setError(jobError(e));return null;}finally{if(abort.current===c)setBusy(null);}};
 const startJob=async(action:string,body:Record<string,unknown>={})=>(await labApi<{jobId:string}>("/api/p5/results",{action,...body})).jobId;
 const doTest=()=>run("test",async s=>{const j=await waitForJob<TestResult>(await startJob("testPath"),s);setTest(j.result);});
 const doScan=()=>run("scan",async s=>{const j=await waitForJob<ScanResult>(await startJob("scan"),s);setScan(j.result);setPicked(new Set((j.result?.files??[]).filter(f=>f.status==="NEW").map(f=>f.path)));setPreview(null);});
 const showPreview=(j:Job)=>{setPreview(j.intakes);setAcked(new Set());setToImport(new Set(j.intakes.filter(i=>i.state==="Parsed"&&i.container!=="ZIP_BATCH").map(i=>i.id)));};
 const doPreview=()=>run("preview",async s=>{const paths=(scan?.files??[]).filter(f=>picked.has(f.path)&&f.sha256).map(f=>({path:f.path,sha256:f.sha256}));showPreview(await waitForJob(await startJob("preview",{paths}),s));});
 const doUpload=()=>run("upload",async s=>{
  const files=[...(fileInput.current?.files??[])];if(!files.length){setError("กรุณาเลือกไฟล์ .pdf หรือ .zip อย่างน้อย 1 ไฟล์");fileInput.current?.focus();return;}
  const form=new FormData();for(const f of files)form.append("files",f);
  const r=await fetch("/api/p5/results/upload",{method:"POST",headers:{"x-csrf-token":csrf()},body:form});const d=await r.json().catch(()=>({}));
  if(!r.ok){setError(d.error??"อัปโหลดไม่สำเร็จ");return;}
  setUploadRejected(d.rejected??[]);showPreview(await waitForJob(d.jobId,s));if(fileInput.current)fileInput.current.value="";
 });
 const doConfirm=()=>run("confirm",async()=>{const r=await labApi<{results:{outcome:string}[]}>("/api/p5/results",{action:"confirm",intakeIds:[...toImport],acknowledgeNameConflicts:[...acked].filter(id=>toImport.has(id))});
  const n=r.results.filter(x=>x.outcome==="Unlinked").length;setNotice(`นำเข้าแล้ว ${n} รายการ — รอการเชื่อมโยงกับรอบ/Attempt ในคิวด้านล่าง${r.results.length>n?` · ไม่นำเข้า ${r.results.length-n} รายการ (ซ้ำ/รูปแบบไม่รู้จัก/หมดอายุ)`:""}`);
  setPreview(null);setToImport(new Set());setScan(null);setBucket("unlinked");await load();});
 const doExport=()=>run("csv",async()=>{const r=await fetch("/api/p5/results/csv",{method:"POST",cache:"no-store",headers:{"content-type":"application/json","x-csrf-token":csrf()},body:JSON.stringify(query)});if(!r.ok){const d=await r.json().catch(()=>({}));setError(d.error??"ส่งออกไม่สำเร็จ กรุณาลองอีกครั้ง");return;}
  const url=URL.createObjectURL(await r.blob()),a=document.createElement("a");a.href=url;a.download=`synthetic-results-page-${page}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);setNotice("ส่งออก CSV เฉพาะหน้าปัจจุบันแล้ว — ไม่ใช่รายการทั้งหมด");});
 const step=preview?3:scan?.files?.length?2:test?.passed?1:0;
 const newFiles=useMemo(()=>(scan?.files??[]).filter(f=>f.status==="NEW"),[scan]);
 const rows=useMemo(()=>(data?.rows??[]).filter(r=>(BUCKETS.find(b=>b[0]===bucket)?.[2] as readonly string[]|undefined)?.includes(r.state)),[data,bucket]);
 const toggle=(set:Set<string>,key:string,on:boolean)=>{const n=new Set(set);if(on)n.add(key);else n.delete(key);return n;};
 const folderMsg=(code:string|null)=>code?(FOLDER_ERROR_TEXT[code]??code):"";
 const conflicted=(i:Intake)=>!!i.nameConflicts&&(i.nameConflicts.versions.length>0||i.nameConflicts.sameBatch>0);
 const unacked=(preview??[]).filter(i=>toImport.has(i.id)&&conflicted(i)&&!acked.has(i.id)).length;

 return <>
  <header className="page-header"><div><h1>ผลตรวจ NIPT</h1><p className="muted">นำเข้าไฟล์ผลจากโฟลเดอร์หรือจากเครื่อง ตรวจทาน เชื่อมโยงกับรอบ/Attempt และประเมิน Gate ก่อนรับรอง</p></div></header>
  <p className="notice warning-notice" role="note"><strong>ยังไม่ปล่อยผลจริง</strong> — ระบบทำได้ถึงการตรวจทานและประเมิน Gate (RG/RN) เท่านั้น การรับรองและปล่อยผลถูกระงับจนกว่า AL-5, OD-05 และ OD-07 ผ่าน และยังรอ FinalQcAccepted จากงาน P4b</p>
  <div aria-live="polite">{notice&&<p className="notice success" role="status">{notice}</p>}{error&&<p className="notice" role="alert">{error}</p>}</div>

  {canImport&&<section className="panel result-intake" aria-labelledby="intake-h">
   <h2 id="intake-h">นำเข้าไฟล์ผล</h2><p className="import-next" role="status"><strong>ขั้นตอนถัดไป: {tab==="folder"?STEPS[step]:preview?"ตรวจ Preview และยืนยันนำเข้า":"เลือกไฟล์จากเครื่องเพื่อ Preview"}</strong><span>{tab==="folder"?"ทดสอบและสแกนเพื่อเลือกไฟล์ ตรวจ Preview แล้วจึงยืนยันนำเข้า":"เลือกไฟล์ .pdf หรือ .zip ตรวจ Preview แล้วจึงยืนยันนำเข้า"}</span></p>
   <ol className="stepper" aria-label="ขั้นตอนนำเข้า">{STEPS.map((s,i)=><li key={s} className={i<step?"done":i===step?"current":""} aria-current={i===step?"step":undefined}>{s}</li>)}</ol>
   <div className="tabs p5-tabs" role="tablist" aria-label="ช่องทางนำเข้า">
    <button type="button" role="tab" className="tab" aria-selected={tab==="folder"} onClick={()=>setTab("folder")}>จากโฟลเดอร์ผล (แนะนำ)</button>
    <button type="button" role="tab" className="tab" aria-selected={tab==="upload"} onClick={()=>setTab("upload")}>เลือกไฟล์จากเครื่อง</button>
   </div>
   {tab==="folder"?<div role="tabpanel" aria-label="จากโฟลเดอร์ผล" className="stack">
    <dl className="compact-facts plan-dl p5-facts">
     <div><dt>โฟลเดอร์ผล PDF</dt><dd><span className="mono">{data?.intake.folder??"…"}</span>{canSettings&&<> · <Link href="/settings?key=result_management">เปลี่ยนในตั้งค่าระบบ</Link></>}</dd></div>
     <div><dt>การสแกน</dt><dd>{data?(data.intake.scanSubfolders?"รวมโฟลเดอร์ย่อย":"เฉพาะโฟลเดอร์หลัก"):"…"} · {data?.intake.acceptZip?".pdf และ .zip":".pdf เท่านั้น"} · ไม่เกิน {data?.intake.maxFilesPerScan??"…"} ไฟล์ · ไฟล์ละไม่เกิน {data?.intake.maxUploadMb??"…"} MB</dd></div>
     <div><dt>การสแกนโฟลเดอร์</dt><dd>เมื่อกดปุ่ม “สแกนไฟล์ PDF” เท่านั้น — สแกนครั้งเดียวแล้วหยุด ระบบไม่สแกนเองตามเวลา</dd></div>
     <div><dt>นำเข้าล่าสุดถึงโฟลเดอร์</dt><dd>{data?.latestFolder?<><span className="mono">{data.latestFolder.folder||"(โฟลเดอร์หลัก)"}</span> · {bkk(data.latestFolder.at)}</>:"ยังไม่เคยนำเข้าจากโฟลเดอร์"}</dd></div>
    </dl>
    <div className="action-bar">
     <button type="button" className="button secondary" onClick={doTest} disabled={!!busy}>{busy==="test"?"Worker กำลังทดสอบ…":"ทดสอบโฟลเดอร์"}</button>
     <button type="button" className="button" onClick={doScan} disabled={!!busy}>{busy==="scan"?"Worker กำลังสแกน…":"สแกนไฟล์ PDF"}</button>
    </div>
    <p className="help">Worker อ่านโฟลเดอร์แบบอ่านอย่างเดียว ไม่สร้าง ย้าย หรือลบไฟล์ใด ๆ — ไฟล์จะถูกนำเข้าเมื่อกดยืนยันหลัง Preview เท่านั้น</p>
    {test&&<div className="p5-test" aria-label="ผลทดสอบโฟลเดอร์">
     <p><Status tone={test.passed?"good":"bad"}>{test.passed?`อ่านได้ — พบ ${test.files} ไฟล์ใน ${test.folders+1} โฟลเดอร์`:"ทดสอบไม่ผ่าน"}</Status>{test.errorCode&&<> · {folderMsg(test.errorCode)}</>}</p>
     <ul className="p5-checks">{test.checks.map(c=><li key={c.code}><Status tone={c.passed?"good":c.code==="RESULT_FILES_FOUND"?"warning":"bad"}>{CHECK_TEXT[c.code]??c.code}: {c.passed?"ผ่าน":"ไม่ผ่าน"}</Status></li>)}</ul>
    </div>}
    {scan&&(scan.errorCode?<p className="notice" role="alert">สแกนไม่สำเร็จ: {folderMsg(scan.errorCode)}</p>:
     <div className="stack">
      <div className="table-wrap" role="region" aria-label="ไฟล์ที่พบในโฟลเดอร์" tabIndex={0}>
       <table className="data-table p5-scan"><caption>พบ {scan.files.length} ไฟล์ · ใหม่ {newFiles.length} · ซ้ำ {scan.files.filter(f=>f.status==="IMPORTED"||f.status==="DUPLICATE_IN_SCAN").length} · Error {scan.files.filter(f=>["TOO_LARGE","ZIP_NOT_ACCEPTED","EMPTY"].includes(f.status)).length}{scan.truncated?` · แสดงไม่เกิน ${data?.intake.maxFilesPerScan} ไฟล์ — ย้ายไฟล์เก่าออกหรือปรับการตั้งค่า`:""}</caption>
        <thead><tr><th scope="col"><label className="table-check-target"><input type="checkbox" aria-label="เลือกไฟล์ใหม่ทั้งหมด" checked={newFiles.length>0&&newFiles.every(f=>picked.has(f.path))} onChange={e=>setPicked(e.target.checked?new Set(newFiles.map(f=>f.path)):new Set())} disabled={!newFiles.length}/></label></th><th scope="col">ไฟล์</th><th scope="col">โฟลเดอร์ย่อย</th><th scope="col" className="num">ขนาด</th><th scope="col">แก้ไขล่าสุด</th><th scope="col">สถานะ</th></tr></thead>
        <tbody>{scan.files.length?scan.files.map(f=><tr key={f.path} className={picked.has(f.path)?"selected":""}>
         <td><label className="table-check-target"><input type="checkbox" aria-label={`เลือก ${f.name}`} checked={picked.has(f.path)} disabled={f.status!=="NEW"&&f.status!=="DUPLICATE_IN_SCAN"} onChange={e=>setPicked(p=>toggle(p,f.path,e.target.checked))}/></label></td>
         <td className="p5-file">{f.name}</td><td>{f.folder||<span className="muted">(โฟลเดอร์หลัก)</span>}</td><td className="num">{bytes(f.size)}</td><td>{bkk(f.modifiedAt)}</td>
         <td><Status tone={f.status==="NEW"?"good":f.status==="IMPORTED"?"":"warning"}>{SCAN_TEXT[f.status]??f.status}</Status></td></tr>)
         :<tr><td colSpan={6} className="empty-row">ไม่พบไฟล์ .pdf หรือ .zip ในโฟลเดอร์นี้</td></tr>}</tbody>
       </table>
      </div>
      <div className="bulk-bar"><span>เลือก {picked.size} ไฟล์</span><button type="button" className="button" disabled={!picked.size||!!busy} onClick={doPreview}>{busy==="preview"?"Worker กำลังอ่านไฟล์…":"Preview ไฟล์ที่เลือก"}</button></div>
     </div>)}
   </div>:<div role="tabpanel" aria-label="เลือกไฟล์จากเครื่อง" className="stack">
    <div className="field"><label htmlFor="p5-files">ไฟล์ผล (.pdf หรือ .zip) ได้สูงสุด 20 ไฟล์</label><FileDropInput id="p5-files" ref={fileInput} type="file" multiple accept=".pdf,.zip,application/pdf,application/zip" aria-describedby="p5-files-help"/>
     <p id="p5-files-help" className="help">ทางเลือกเมื่อไฟล์ไม่ได้อยู่ในโฟลเดอร์ผล — ระบบกักตรวจและอ่านไฟล์แบบเดียวกับไฟล์จากโฟลเดอร์ ไฟล์ละไม่เกิน {data?.intake.maxUploadMb??"…"} MB</p></div>
    <div className="action-bar"><button type="button" className="button" onClick={doUpload} disabled={!!busy}>{busy==="upload"?"กำลังอัปโหลดและอ่านไฟล์…":"อัปโหลดและ Preview"}</button></div>
    {uploadRejected.length>0&&<ul className="notice" role="alert">{uploadRejected.map(r=><li key={r.name}>{r.name}: {REJECT_TEXT[r.code]??r.code}</li>)}</ul>}
   </div>}

   {preview&&<div className="stack p5-preview" aria-labelledby="preview-h">
    <h3 id="preview-h">Preview — ตรวจค่าที่อ่านได้ก่อนยืนยันนำเข้า</h3>
    <p className="help">ระบบไม่จับคู่ผลกับผู้ป่วยอัตโนมัติ (HN หรือ LN อย่างเดียวไม่พอ) — หลังนำเข้า ต้องเลือกรอบ/Attempt และให้ผู้รับรองอีกคนยืนยัน</p>
    <div className="table-wrap" role="region" aria-label="ผล Preview" tabIndex={0}>
     <table className="data-table p5-scan"><caption>{preview.length} รายการ · พร้อมนำเข้า {preview.filter(i=>i.state==="Parsed"&&i.container!=="ZIP_BATCH").length}</caption>
      <thead><tr><th scope="col"><span className="sr-only">เลือก</span></th><th scope="col">ไฟล์</th><th scope="col">รูปแบบ</th><th scope="col">HN · เลข Lab</th><th scope="col">วันที่เก็บ</th><th scope="col">ผลหลัก</th><th scope="col">ผู้สมัครจับคู่</th><th scope="col">สถานะ</th></tr></thead>
      <tbody>{preview.length?preview.map(i=>{const ready=i.state==="Parsed"&&i.container!=="ZIP_BATCH";return <tr key={i.id} className={toImport.has(i.id)?"selected":""}>
       <td><label className="table-check-target"><input type="checkbox" aria-label={`นำเข้า ${i.member??i.file}`} disabled={!ready} checked={toImport.has(i.id)} onChange={e=>setToImport(p=>toggle(p,i.id,e.target.checked))}/></label></td>
       <td className="p5-file">{i.member?<>{i.member}<span className="muted"> ใน {i.file}</span></>:i.file}{i.container==="PDF"&&<> · <a href={`/api/p5/intake/${i.id}/file`} target="_blank" rel="noopener">เปิด PDF</a></>}</td>
       <td>{i.container==="ZIP_BATCH"?CONTAINER_TEXT.ZIP_BATCH:i.templateKind?KIND_TEXT[i.templateKind]:"—"}{i.container&&i.container!=="PDF"&&i.container!=="ZIP_BATCH"&&<span className="badge">{CONTAINER_TEXT[i.container]}</span>}</td>
       <td className="mono">{i.summary?.hn??"—"}<br/>{i.summary?.labNumber??"—"}</td><td>{i.summary?.collectionDate??"—"}</td>
       <td>{resultLine(i.summary,i.templateKind)}{i.summary?.abnormal&&<span className="badge danger">ผิดปกติ</span>}{i.summary?.needsManualReview&&<span className="badge warning">ต้องตรวจมือ</span>}{i.summary?.unreadable?.length?<span className="badge danger">อ่านไม่ได้ {i.summary.unreadable.length} ค่า</span>:null}</td>
       <td className="num">{i.summary?`${i.candidates} รอบ/Attempt`:"—"}</td>
       <td><Status tone={i.state==="Parsed"?"good":i.state==="Rejected"?"bad":"warning"}>{INTAKE_TEXT[i.state]??i.state}</Status>{i.rejectCode&&<div className="help">{REJECT_TEXT[i.rejectCode]??i.rejectCode}</div>}
        {conflicted(i)&&i.state==="Parsed"&&<div className="p5-conflict"><span className="badge warning">ชื่อซ้ำ เนื้อหาต่าง</span><div className="help">ชื่อเดียวกับ{i.nameConflicts!.versions.length?`รายงานที่มีอยู่ ${i.nameConflicts!.versions.length} รายการ`:"ไฟล์อื่นใน Preview นี้"} แต่ SHA-256 ต่างกัน — ไม่ถือเป็นไฟล์ซ้ำ และต้องตรวจว่าเป็นรายงานใหม่หรือฉบับแก้ไขตอนเชื่อมโยง</div>
         <label className="check-label"><input type="checkbox" checked={acked.has(i.id)} onChange={e=>setAcked(p=>toggle(p,i.id,e.target.checked))}/> รับทราบ นำเข้าเพื่อตรวจสอบ</label></div>}</td></tr>;})
       :<tr><td colSpan={8} className="empty-row">ไม่มีไฟล์ที่อ่านได้</td></tr>}</tbody>
     </table>
    </div>
    <div className="bulk-bar"><span>นำเข้า {toImport.size} รายการ{unacked?` · รอรับทราบชื่อซ้ำ ${unacked} รายการ`:""}</span><button type="button" className="button secondary" onClick={()=>{setPreview(null);setToImport(new Set());}} disabled={!!busy}>ยกเลิก Preview</button><button type="button" className="button" disabled={!toImport.size||!!busy||unacked>0} onClick={doConfirm}>{busy==="confirm"?"กำลังนำเข้า…":"ยืนยันนำเข้า"}</button></div>
   </div>}
  </section>}

  <section className="panel" aria-labelledby="queue-h">
   <h2 id="queue-h">คิวตรวจทานผล</h2>
   <form className="search-form" autoComplete="off" aria-label="กรองคิวผลตรวจ" onSubmit={e=>{e.preventDefault();if(draftFilters.from&&draftFilters.to&&draftFilters.from>draftFilters.to){setError("วันที่เริ่มต้องไม่เกินวันที่สิ้นสุด กรุณาตรวจช่วงวันที่");return;}setPage(1);setFilters({...draftFilters});}}>
    <div className="field"><label htmlFor="result-search">ค้นหา HN / เลข Lab / ชื่อที่อ่านได้</label><input id="result-search" type="search" maxLength={100} autoComplete="off" value={draftFilters.q} onChange={e=>setDraftFilters(f=>({...f,q:e.target.value}))}/></div>
    <div className="field"><label htmlFor="result-date-field">กรองตามวันที่</label><select id="result-date-field" value={draftFilters.dateField} onChange={e=>setDraftFilters(f=>({...f,dateField:e.target.value}))}><option value="REPORTED">วันที่รายงานที่อ่านได้</option><option value="IMPORTED">วันที่นำเข้า (เวลาไทย)</option></select></div>
    <div className="field"><label htmlFor="result-from">ตั้งแต่วันที่</label><input id="result-from" type="date" value={draftFilters.from} onChange={e=>setDraftFilters(f=>({...f,from:e.target.value}))}/></div>
    <div className="field"><label htmlFor="result-to">ถึงวันที่</label><input id="result-to" type="date" value={draftFilters.to} onChange={e=>setDraftFilters(f=>({...f,to:e.target.value}))}/></div>
    <div className="field"><label htmlFor="result-risk">ความเสี่ยงตามค่าที่อ่าน</label><select id="result-risk" value={draftFilters.risk} onChange={e=>setDraftFilters(f=>({...f,risk:e.target.value}))}><option value="ALL">ทั้งหมด</option><option value="HIGH">High Risk / Detected</option><option value="LOW">Low Risk ที่อ่านครบ</option><option value="UNKNOWN">Unknown / อ่านไม่ครบ / หนังสือแจ้ง</option></select></div>
    <div className="field"><label htmlFor="result-gender">เพศตามค่าที่อ่าน</label><select id="result-gender" value={draftFilters.gender} onChange={e=>setDraftFilters(f=>({...f,gender:e.target.value}))}><option value="ALL">ทั้งหมด</option><option value="Male">Male</option><option value="Female">Female</option><option value="UNKNOWN">Unknown / อ่านไม่ได้</option></select></div>
    <div className="field"><label htmlFor="result-qc">QC ตามค่าที่อ่าน</label><select id="result-qc" value={draftFilters.qc} onChange={e=>setDraftFilters(f=>({...f,qc:e.target.value}))}><option value="ALL">ทั้งหมด</option><option value="PASS">PASS</option><option value="FAIL">FAIL</option><option value="UNKNOWN">Unknown / อ่านไม่ได้</option></select></div>
    <button className="button secondary" disabled={queueLoading}>ใช้ตัวกรอง</button>
    <button type="button" className="button secondary" disabled={queueLoading} onClick={()=>{setDraftFilters(DEFAULT_FILTERS);setFilters(DEFAULT_FILTERS);setPage(1);}}>ล้างตัวกรอง</button>
   </form>
   <p className="help">ตัวกรองอ้างอิงค่าที่ Parser อ่านได้ ไม่ใช่การรับรองผล — ค่าที่ไม่รู้จักหรืออ่านไม่ครบเป็น Unknown</p>
   <div className="tabs result-status-filters" role="tablist" aria-label="สถานะรายงาน">{BUCKETS.map(([key,label])=><button key={key} type="button" role="tab" className="tab" aria-selected={bucket===key} onClick={()=>{setBucket(key);setPage(1);}}>{label}</button>)}</div>
   {queueLoading&&<p className="help" role="status">กำลังโหลดคิว…</p>}{!queueLoading&&!data&&<p className="help" role="status">โหลดคิวไม่สำเร็จ — ลองใช้ตัวกรองอีกครั้ง</p>}
   {canExport&&<div className="action-bar"><button type="button" className="button secondary" disabled={queueLoading||!data||!!busy} onClick={doExport}>{busy==="csv"?"กำลังส่งออก…":"ส่งออก CSV เฉพาะหน้านี้"}</button>{data&&<span className="help">CSV หน้านี้ {data.rows.length} / {data.page.total} รายการ</span>}</div>}
   <div className="table-wrap" role="region" aria-label="รายการรายงาน" tabIndex={0}>
    <table className="data-table p5-queue"><thead><tr><th scope="col">ไฟล์</th><th scope="col">ชนิด</th><th scope="col">HN · เลข Lab</th><th scope="col">วันที่เก็บ</th><th scope="col">LN · รอบ</th><th scope="col">สถานะ</th><th scope="col">อัปเดต</th><th scope="col"><span className="sr-only">เปิด</span></th></tr></thead>
     <tbody>{!data?<tr><td colSpan={8} className="empty-row">{queueLoading?"กำลังโหลด…":"โหลดคิวไม่สำเร็จ"}</td></tr>:rows.length?rows.map(r=><tr key={r.id}>
      <td className="p5-file">{r.member_name??r.relative_path??r.original_name}</td><td>{KIND_TEXT[r.template_kind]??r.kind}{r.abnormal&&<span className="badge danger">ผิดปกติ</span>}</td>
      <td className="mono">{r.hn??"—"}<br/>{r.lab??"—"}</td><td>{r.collection??"—"}</td><td>{r.ln?<><span className="mono">{r.ln}</span> · รอบที่ {r.round_number}</>:"—"}</td>
      <td><Status tone={STATE_TONE[r.state]}>{STATE_TEXT[r.state]??r.state}</Status>{r.proposal&&<span className="badge warning">รอผู้ยืนยันคนที่สอง</span>}{r.name_conflict&&<span className="badge warning">ชื่อไฟล์ซ้ำ — ตรวจว่าใหม่/ฉบับแก้ไข</span>}</td><td>{bkk(r.state_changed_at)}</td>
      <td><Link className="button small secondary" href={`/results/${r.id}`}>เปิด</Link></td></tr>)
      :<tr><td colSpan={8} className="empty-row">ไม่มีรายการในสถานะนี้</td></tr>}</tbody></table>
   </div>
   {data&&<Pager label="คิวผลตรวจ" page={data.page.number} pageSize={data.page.size} total={data.page.total} totalPages={data.page.totalPages} busy={queueLoading} onPage={setPage} onSize={n=>{setPageSize(n);setPage(1);}}/>}
  </section>
 </>;
}
