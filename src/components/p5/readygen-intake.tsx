"use client";
import {FileDropInput} from "../shared/file-drop-input";
import Link from "next/link";
import {useEffect,useMemo,useRef,useState} from "react";
import {labApi,failureText,bkk} from "../p4/lab-api";
import {csrf} from "../p2/shared";
import './result-workflow.css';
import {SCAN_TEXT,REJECT_TEXT,FOLDER_ERROR_TEXT,CHECK_TEXT,bytes} from "./labels";

// ReadyGen intake, one button: scan (or upload) -> "นำเข้า" = read files, match patients, and put every matched PDF in "รอส่ง HIS".
// PDFs that cannot be matched are imported to the queue so they show up in "ต้องจัดการ" with their reasons. Nothing here releases a result.
type Job<T=Record<string,unknown>>={id:string;kind:string;state:string;result:T|null;intakes:Intake[]};
type Check={code:string;passed:boolean};
type TestResult={passed:boolean;checks:Check[];files:number;folders:number;errorCode:string|null;folder:string};
type ScanFile={path:string;folder:string;name:string;size:number;modifiedAt:string;sha256:string|null;status:string};
type ScanResult={folder:string;files:ScanFile[];folders:number;truncated:boolean;errorCode:string|null};
type Intake={id:string;file:string;member:string|null;container:string|null;state:string;rejectCode:string|null;nameConflicts?:{versions:{id:string;state:string}[];sameBatch:number}};
type Info={latestFolder:{folder:string;at:string}|null;intake:{folder:string;scanSubfolders:boolean;acceptZip:boolean;maxUploadMb:number;maxFilesPerScan:number;lastTest:{result:TestResult|null}|null;lastScan:{result:ScanResult|null}|null}};
type Preview={intakeId:string;ready:boolean;candidate:{caseId:string;round:{id:string};attempt:{id:string}}|null;abnormal:boolean};
type Plan={ready:Preview[];queue:string[];conflicts:string[];abnormal:number;rejected:{name:string;code:string}[];key:string};
export type ImportSummary={ready:number;action:number};

async function waitForJob<T>(id:string,signal:AbortSignal):Promise<Job<T>>{
 for(let i=0;i<120;i++){if(signal.aborted)throw new Error("ABORTED");const j=await labApi<Job<T>>(`/api/p5/jobs/${id}`);if(j.state==="Completed")return j;await new Promise(r=>setTimeout(r,i<5?400:1000));}
 throw new Error("WORKER_TIMEOUT");
}
const jobError=(e:unknown)=>e instanceof Error&&e.message==="WORKER_TIMEOUT"?"Worker ยังไม่ตอบภายใน 2 นาที — ตรวจหน้า สถานะระบบ ว่า Worker ทำงานอยู่ แล้วลองใหม่":failureText(e);
const Status=({tone,children}:{tone?:string;children:React.ReactNode})=><span className={`status ${tone??""}`}>{children}</span>;
const conflicted=(i:Intake)=>!!i.nameConflicts&&(i.nameConflicts.versions.length>0||i.nameConflicts.sameBatch>0);

export function ReadyGenIntake({canSettings,onImported}:{canSettings:boolean;onImported:(s:ImportSummary)=>void}){
 const [info,setInfo]=useState<Info|null>(null),[error,setError]=useState(""),[notice,setNotice]=useState(""),[tab,setTab]=useState<"folder"|"upload">("folder");
 const [busy,setBusy]=useState<string|null>(null),[test,setTest]=useState<TestResult|null>(null),[scan,setScan]=useState<ScanResult|null>(null),[picked,setPicked]=useState<Set<string>>(new Set());
 const [uploadRejected,setUploadRejected]=useState<{name:string;code:string}[]>([]),[plan,setPlan]=useState<Plan|null>(null),[ack,setAck]=useState(false);
 // A prepared plan (files already read, waiting for the abnormal tick) belongs to exactly one selection: any change of selection drops it.
 const dropPlan=()=>{setPlan(null);setAck(false);};
 const abort=useRef<AbortController|null>(null),fileInput=useRef<HTMLInputElement>(null);
 useEffect(()=>{let active=true;void Promise.resolve().then(async()=>{try{const d=await labApi<Info>("/api/p5/results",{action:"query",bucket:"closed",page:1,pageSize:25});if(!active)return;setInfo(d);setTest(t=>t??d.intake.lastTest?.result??null);setScan(s=>s??d.intake.lastScan?.result??null);}catch(e){if(active)setError(failureText(e));}});return()=>{active=false;abort.current?.abort();};},[]);
 const run=async<T,>(label:string,fn:(signal:AbortSignal)=>Promise<T>)=>{abort.current?.abort();const c=new AbortController();abort.current=c;setBusy(label);setError("");setNotice("");try{return await fn(c.signal);}catch(e){if(!(e instanceof Error&&e.message==="ABORTED"))setError(jobError(e));return null;}finally{if(abort.current===c)setBusy(null);}};
 const startJob=async(action:string,body:Record<string,unknown>={})=>(await labApi<{jobId:string}>("/api/p5/results",{action,...body})).jobId;
 const doTest=()=>run("test",async s=>{const j=await waitForJob<TestResult>(await startJob("testPath"),s);setTest(j.result);});
 const doScan=()=>run("scan",async s=>{const j=await waitForJob<ScanResult>(await startJob("scan"),s);setScan(j.result);setPicked(new Set((j.result?.files??[]).filter(f=>f.status==="NEW").map(f=>f.path)));setPlan(null);setAck(false);});
 const newFiles=useMemo(()=>(scan?.files??[]).filter(f=>f.status==="NEW"),[scan]);
 const hidden=(scan?.files??[]).filter(f=>f.status==="IMPORTED"||f.status==="DUPLICATE_IN_SCAN").length;
 const problems=(scan?.files??[]).filter(f=>["TOO_LARGE","ZIP_NOT_ACCEPTED","EMPTY"].includes(f.status)).length;

 /** Read the files and decide, per PDF, whether it can go straight to "รอส่ง HIS" (server-side match) or has to wait in the queue. */
 const prepare=async(s:AbortSignal):Promise<Plan|null>=>{
  let jobId:string;
  if(tab==="folder"){const paths=newFiles.filter(f=>picked.has(f.path)&&f.sha256).map(f=>({path:f.path,sha256:f.sha256}));jobId=await startJob("preview",{paths});}
  else{
   const files=[...(fileInput.current?.files??[])];if(!files.length){setError("กรุณาเลือกไฟล์ .pdf หรือ .zip อย่างน้อย 1 ไฟล์");fileInput.current?.focus();return null;}
   const form=new FormData();for(const f of files)form.append("files",f);
   const r=await fetch("/api/p5/results/upload",{method:"POST",headers:{"x-csrf-token":csrf()},body:form});const d=await r.json().catch(()=>({}));
   if(!r.ok){setError(d.error??"อัปโหลดไม่สำเร็จ");return null;}setUploadRejected(d.rejected??[]);jobId=d.jobId;
  }
  const job=await waitForJob(jobId,s),parsed=job.intakes.filter(i=>i.state==="Parsed"&&i.container!=="ZIP_BATCH");
  const rejected=job.intakes.filter(i=>i.state!=="Parsed"&&i.container!=="ZIP_BATCH").map(i=>({name:i.member??i.file,code:i.rejectCode??i.state}));
  const items=parsed.length?(await labApi<{items:Preview[]}>("/api/p5/results/complete",{action:"preview",intakeIds:parsed.map(i=>i.id)})).items:[];
  const ready=items.filter(i=>i.ready&&i.candidate),readyIds=new Set(ready.map(i=>i.intakeId));
  const queue=parsed.filter(i=>!readyIds.has(i.id)).map(i=>i.id);
  return {ready,queue,conflicts:parsed.filter(i=>conflicted(i)).map(i=>i.id),abnormal:ready.filter(i=>i.abnormal).length,rejected,key:crypto.randomUUID()};
 };
 const finish=async(p:Plan,acknowledged:boolean)=>{
  let certified=0;const toQueue=[...p.queue];
  if(p.ready.length){
   const r=await labApi<{items:{intakeId:string;outcome:string}[]}>("/api/p5/results/complete",{action:"confirm",idempotencyKey:p.key,abnormalAcknowledged:acknowledged,items:p.ready.map(i=>({intakeId:i.intakeId,caseId:i.candidate!.caseId,roundId:i.candidate!.round.id,attemptId:i.candidate!.attempt.id}))});
   for(const it of r.items){if(it.outcome==="PendingCertification")certified++;else toQueue.push(it.intakeId);}
  }
  // Whatever could not be completed is imported as-is: it appears in "ต้องจัดการ" with its reasons instead of being dropped.
  let queued=0;
  if(toQueue.length){const r=await labApi<{results:{outcome:string;versionId?:string}[]}>("/api/p5/results",{action:"confirm",intakeIds:toQueue,acknowledgeNameConflicts:p.conflicts.filter(id=>toQueue.includes(id))});queued=r.results.filter(x=>x.versionId&&x.outcome!=="Duplicate"&&x.outcome!=="RejectedImport").length;}
  const summary:ImportSummary={ready:certified,action:queued};
  return summary;
 };
 const doImport=()=>run("import",async s=>{
  let p=plan;if(!p){p=await prepare(s);if(!p)return;}
  if(p.abnormal>0&&!ack){setPlan(p);return;}
  let sum:ImportSummary={ready:0,action:0};
  // The board is refreshed even when the queue import fails after the ready items were already confirmed.
  try{sum=await finish(p,ack);}finally{onImported(sum);}
  const skipped=p.rejected.length;
  setNotice(`พร้อมส่ง HIS ${sum.ready} · ต้องจัดการ ${sum.action}${skipped?` · ไม่นำเข้า ${skipped} ไฟล์ (ซ้ำ/อ่านไม่ได้)`:""}`);
  setPlan(null);setAck(false);setScan(null);setPicked(new Set());if(fileInput.current)fileInput.current.value="";
});
 const folderMsg=(code:string|null)=>code?(FOLDER_ERROR_TEXT[code]??code):"";
 const importLabel=busy==="import"?"กำลังนำเข้า…":"นำเข้า";
 const ackNeeded=!!plan&&plan.abnormal>0&&!ack;
 const abnormalBox=plan&&plan.abnormal>0&&<label className="check-label"><input type="checkbox" checked={ack} onChange={e=>setAck(e.target.checked)}/> รับทราบผลผิดปกติ {plan.abnormal} รายการ แล้วกด “นำเข้า” อีกครั้ง</label>;
 return <section className="panel result-intake" aria-labelledby="intake-h">
  <h2 id="intake-h">นำเข้า PDF ผลจาก ReadyGen</h2>
  <p className="help">กด “นำเข้า” ครั้งเดียว: ระบบอ่านไฟล์ จับคู่ผู้ป่วย แล้วส่งผลที่ตรงกันไป “รอส่ง HIS” (ยังไม่ส่งให้ ANC) รายการที่จับคู่ไม่ได้จะอยู่ใน “ต้องจัดการ”</p>
  <div aria-live="polite">{notice&&<p className="notice success" role="status">{notice}</p>}{error&&<p className="notice" role="alert">{error}</p>}</div>
  <div className="tabs p5-tabs" role="tablist" aria-label="ช่องทางนำเข้า">
   <button type="button" role="tab" className="tab" aria-selected={tab==="folder"} onClick={()=>{setTab("folder");setPlan(null);setAck(false);}}>จากโฟลเดอร์ผล (แนะนำ)</button>
   <button type="button" role="tab" className="tab" aria-selected={tab==="upload"} onClick={()=>{setTab("upload");setPlan(null);setAck(false);}}>เลือกไฟล์จากเครื่อง</button>
  </div>
  {tab==="folder"?<div role="tabpanel" aria-label="จากโฟลเดอร์ผล" className="stack">
   <dl className="compact-facts plan-dl p5-facts">
    <div><dt>โฟลเดอร์ผล PDF</dt><dd><span className="mono">{info?.intake.folder??"…"}</span>{canSettings&&<> · <Link href="/settings?key=result_management">เปลี่ยนในตั้งค่าระบบ</Link></>}</dd></div>
    <div><dt>การสแกน</dt><dd>{info?(info.intake.scanSubfolders?"รวมโฟลเดอร์ย่อย":"เฉพาะโฟลเดอร์หลัก"):"…"} · {info?.intake.acceptZip?".pdf และ .zip":".pdf เท่านั้น"} · ไม่เกิน {info?.intake.maxFilesPerScan??"…"} ไฟล์ · ไฟล์ละไม่เกิน {info?.intake.maxUploadMb??"…"} MB — สแกนเมื่อกดปุ่มเท่านั้น</dd></div>
    <div><dt>นำเข้าล่าสุดถึงโฟลเดอร์</dt><dd>{info?.latestFolder?<><span className="mono">{info.latestFolder.folder||"(โฟลเดอร์หลัก)"}</span> · {bkk(info.latestFolder.at)}</>:"ยังไม่เคยนำเข้าจากโฟลเดอร์"}</dd></div>
   </dl>
   <div className="action-bar">
    <button type="button" className="button secondary" onClick={()=>void doTest()} disabled={!!busy}>{busy==="test"?"กำลังทดสอบ…":"ทดสอบโฟลเดอร์ (เมื่อมีปัญหา)"}</button>
    <button type="button" className="button" onClick={()=>void doScan()} disabled={!!busy}>{busy==="scan"?"Worker กำลังสแกน…":"สแกนไฟล์ PDF"}</button>
   </div>
   <p className="help">Worker อ่านโฟลเดอร์แบบอ่านอย่างเดียว ไม่สร้าง ย้าย หรือลบไฟล์ใด ๆ</p>
   {test&&<div className="p5-test" aria-label="ผลทดสอบโฟลเดอร์">
    <p><Status tone={test.passed?"good":"bad"}>{test.passed?`อ่านได้ — พบ ${test.files} ไฟล์ใน ${test.folders+1} โฟลเดอร์`:"ทดสอบไม่ผ่าน"}</Status>{test.errorCode&&<> · {folderMsg(test.errorCode)}</>}</p>
    <ul className="p5-checks">{test.checks.map(c=><li key={c.code}><Status tone={c.passed?"good":c.code==="RESULT_FILES_FOUND"?"warning":"bad"}>{CHECK_TEXT[c.code]??c.code}: {c.passed?"ผ่าน":"ไม่ผ่าน"}</Status></li>)}</ul>
   </div>}
   {scan&&(scan.errorCode?<p className="notice" role="alert">สแกนไม่สำเร็จ: {folderMsg(scan.errorCode)}</p>:
    <div className="stack">
     <p className="help" role="status">พบไฟล์ใหม่ {newFiles.length} ไฟล์ · ซ้ำ/นำเข้าแล้ว {hidden} ไฟล์ (ไม่แสดง){problems>0&&` · ใช้ไม่ได้ ${problems} ไฟล์`}{scan.truncated?` · แสดงไม่เกิน ${info?.intake.maxFilesPerScan} ไฟล์ — ย้ายไฟล์เก่าออกหรือปรับการตั้งค่า`:""}</p>
     {newFiles.length>0&&<div className="table-wrap" role="region" aria-label="ไฟล์ใหม่ในโฟลเดอร์" tabIndex={0}>
      <table className="data-table p5-scan"><caption>ไฟล์ใหม่ที่จะนำเข้า</caption>
       <thead><tr><th scope="col"><label className="table-check-target"><input type="checkbox" aria-label="เลือกไฟล์ใหม่ทั้งหมด" checked={newFiles.every(f=>picked.has(f.path))} onChange={e=>{dropPlan();setPicked(e.target.checked?new Set(newFiles.map(f=>f.path)):new Set());}}/></label></th><th scope="col">ไฟล์</th><th scope="col">โฟลเดอร์ย่อย</th><th scope="col" className="num">ขนาด</th><th scope="col">แก้ไขล่าสุด</th><th scope="col">สถานะ</th></tr></thead>
       <tbody>{newFiles.map(f=><tr key={f.path} className={picked.has(f.path)?"selected":""}>
        <td><label className="table-check-target"><input type="checkbox" aria-label={`เลือก ${f.name}`} checked={picked.has(f.path)} onChange={e=>{dropPlan();setPicked(p=>{const n=new Set(p);if(e.target.checked)n.add(f.path);else n.delete(f.path);return n;});}}/></label></td>
        <td className="p5-file">{f.name}</td><td>{f.folder||<span className="muted">(โฟลเดอร์หลัก)</span>}</td><td className="num">{bytes(f.size)}</td><td>{bkk(f.modifiedAt)}</td><td><Status tone="good">{SCAN_TEXT[f.status]??f.status}</Status></td></tr>)}</tbody>
      </table>
     </div>}
     {abnormalBox}
     <div className="bulk-bar"><span>เลือก {picked.size} ไฟล์</span><button type="button" className="button" disabled={!picked.size||!!busy||ackNeeded} onClick={()=>void doImport()}>{importLabel}</button></div>
    </div>)}
  </div>:<div role="tabpanel" aria-label="เลือกไฟล์จากเครื่อง" className="stack">
   <div className="field"><label htmlFor="p5-files">ไฟล์ผล (.pdf หรือ .zip) ได้สูงสุด 20 ไฟล์</label><FileDropInput id="p5-files" ref={fileInput} onChange={dropPlan} type="file" multiple accept=".pdf,.zip,application/pdf,application/zip" aria-describedby="p5-files-help"/>
    <p id="p5-files-help" className="help">ทางเลือกเมื่อไฟล์ไม่ได้อยู่ในโฟลเดอร์ผล — ระบบกักตรวจและอ่านไฟล์แบบเดียวกับไฟล์จากโฟลเดอร์ ไฟล์ละไม่เกิน {info?.intake.maxUploadMb??"…"} MB</p></div>
   {abnormalBox}
   <div className="action-bar"><button type="button" className="button" onClick={()=>void doImport()} disabled={!!busy||ackNeeded}>{importLabel}</button></div>
   {uploadRejected.length>0&&<ul className="notice" role="alert">{uploadRejected.map(r=><li key={r.name}>{r.name}: {REJECT_TEXT[r.code]??r.code}</li>)}</ul>}
  </div>}
 </section>;
}
