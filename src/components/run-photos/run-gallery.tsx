"use client";
import {FileDropInput} from "../shared/file-drop-input";
/* eslint-disable @next/next/no-img-element -- photos are served by an authenticated endpoint; next/image would proxy them through its optimizer and inject inline styles the CSP blocks */
import {useCallback,useEffect,useId,useMemo,useRef,useState} from "react";
import Link from "next/link";
import type {RunGallery,PhotoView} from "../../../packages/run-photos/service";
import {bangkokIsoDay,displayBe,formatBeText} from "../../../packages/domain/thai-date";
import {ThaiDateInput} from "../shared/thai-date-input";
import {labApi,failureText,bkk,LabFailure} from "../p4/lab-api";
import {makeThumbnail,uploadOne,newKey,fileUrl,formatBytes} from "./photo-client";
import {coverage,rangeText} from "./labels";
import {Thumb} from "./thumb";

type Placement=RunGallery["placement"];
const RENDERABLE=new Set(["image/jpeg","image/png","image/webp"]);
const num=(v:string)=>v.trim()===""?null:Number(v);
function Icon({d}:{d:string}){return <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d}/></svg>;}
const CAMERA="M3 8h3.5l2-3h7l2 3H21v11H3zM12 10.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7";
const IMAGES="M3 5h14v12H3zM7 21h14V9M3 14l4-4 4 4 2-2 4 4M13 9h.01";

// ── Upload ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
type Item={key:string;file:File;preview:string|null;thumb:Blob|null;status:"preparing"|"ready"|"uploading"|"done"|"duplicate"|"error";progress:number;message:string};
function Uploader({run,placement,onUploaded}:{run:RunGallery["run"];placement:Placement;onUploaded:()=>void}){
 const id=useId();
 const [items,setItems]=useState<Item[]>([]),[takenOn,setTakenOn]=useState(()=>bangkokIsoDay()),[from,setFrom]=useState(""),[to,setTo]=useState(""),[caption,setCaption]=useState("");
 const [busy,setBusy]=useState(false),[summary,setSummary]=useState<{ok:boolean;text:string}|null>(null);
 const patch=(key:string,p:Partial<Item>)=>setItems(list=>list.map(x=>x.key===key?{...x,...p}:x));
 const add=async(files:FileList|null)=>{
  if(!files?.length)return;setSummary(null);
  const fresh=[...files].map(file=>({key:newKey(),file,preview:null,thumb:null,status:"preparing" as const,progress:0,message:""}));
  setItems(list=>[...list,...fresh]);
  for(const it of fresh){const t=await makeThumbnail(it.file);patch(it.key,{preview:t?.dataUrl??null,thumb:t?.blob??null,status:"ready"});}
 };
 const f=num(from),t=num(to);
 const rangeError=(from!==""||to!=="")&&(f===null||t===null)?"ระบุทั้ง ตั้งแต่ และ ถึง หรือเว้นว่างทั้งคู่":f!==null&&t!==null&&(!Number.isInteger(f)||!Number.isInteger(t)||f<1||t>48||t<f)?"ลำดับต้องเป็นเลข 1–48 และ ถึง ต้องไม่น้อยกว่า ตั้งแต่":"";
 const cover=!rangeError?coverage(placement,f,t):null;
 const pending=items.filter(x=>["ready","error"].includes(x.status));
 const upload=async()=>{
  if(rangeError||!takenOn||!pending.length)return;setBusy(true);setSummary(null);let ok=0,failed=0,duplicate=0;const elsewhere=new Set<string>();
  for(const it of pending){
   patch(it.key,{status:"uploading",progress:0,message:""});
   try{const r=await uploadOne(it.file,it.thumb,{batchId:run.id,idempotencyKey:it.key,caption,sampleFrom:f,sampleTo:t,takenOn},p=>patch(it.key,{progress:p}));
    r.otherRuns.forEach(x=>elsewhere.add(x));ok++;patch(it.key,{status:"done",progress:1,message:r.otherRuns.length?`ไฟล์เดียวกันนี้อยู่ใน ${r.otherRuns.join(", ")} ด้วย — ตรวจว่าเลือก Run ถูกต้อง`:"บันทึกแล้ว"});}
   catch(e){const dup=e instanceof LabFailure&&e.code==="DUPLICATE_IN_RUN";if(dup)duplicate++;else failed++;patch(it.key,{status:dup?"duplicate":"error",progress:0,message:failureText(e)});}
  }
  setBusy(false);
  setSummary({ok:failed===0,text:[ok?`อัปโหลดแล้ว ${ok} ภาพ`:"",duplicate?`ซ้ำกับภาพเดิมใน Run นี้ ${duplicate} ภาพ (ไม่บันทึกซ้ำ)`:"",failed?`ไม่สำเร็จ ${failed} ภาพ — กด อัปโหลด อีกครั้งเพื่อลองใหม่`:"",elsewhere.size?`พบไฟล์เดียวกันใน ${[...elsewhere].join(", ")}`:""].filter(Boolean).join(" · ")});
  if(ok){setItems(list=>list.filter(x=>x.status!=="done"||x.message!=="บันทึกแล้ว"));onUploaded();}
 };
 return <section className="panel" aria-labelledby={id+"-h"}>
  <div className="photo-run-head"><h2 id={id+"-h"}>เพิ่มภาพ</h2><p className="muted small">ไม่บังคับ — Run ที่ไม่มีภาพทำงานต่อได้ตามปกติ</p></div>
  <div className="photo-capture">
   <div><FileDropInput id={id+"-camera"} type="file" accept="image/*" capture="environment" disabled={busy} onChange={e=>{void add(e.target.files);e.target.value="";}}/>
    <label className="button" htmlFor={id+"-camera"}><Icon d={CAMERA}/>ถ่ายภาพด้วยกล้อง</label></div>
   <div><FileDropInput id={id+"-pick"} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" multiple disabled={busy} onChange={e=>{void add(e.target.files);e.target.value="";}}/>
    <label className="button secondary" htmlFor={id+"-pick"}><Icon d={IMAGES}/>เลือกภาพจากเครื่อง (หลายภาพได้)</label></div>
  </div>
  <div className="photo-fields">
   <div className="field"><label htmlFor={id+"-date"}>วันที่ถ่ายภาพ</label><ThaiDateInput id={id+"-date"} value={takenOn} onChange={setTakenOn} required/></div>
   <div className="field" role="group" aria-labelledby={id+"-range-label"} aria-describedby={id+"-range-help"}>
    <label id={id+"-range-label"} htmlFor={id+"-from"}>ลำดับตัวอย่างในภาพ (คนที่)</label>
    <div className="photo-range"><input id={id+"-from"} inputMode="numeric" pattern="[0-9]*" aria-label="ตั้งแต่คนที่" placeholder="ตั้งแต่" value={from} onChange={e=>setFrom(e.target.value.replace(/\D/g,"").slice(0,2))} aria-invalid={!!rangeError}/><span>ถึง</span>
     <input inputMode="numeric" pattern="[0-9]*" aria-label="ถึงคนที่" placeholder="ถึง" value={to} onChange={e=>setTo(e.target.value.replace(/\D/g,"").slice(0,2))} aria-invalid={!!rangeError}/></div>
    {rangeError?<p className="field-error" role="alert">{rangeError}</p>:<p id={id+"-range-help"} className="photo-coverage">{cover?cover.text+(cover.beyond?` · Run นี้มีตัวอย่าง ${placement.length} คน`:""):"เว้นว่างได้ · นับเฉพาะตัวอย่างผู้ป่วยตามลำดับตำแหน่ง ไม่นับ PC/NC/Blank"}</p>}
   </div>
   <div className="field"><label htmlFor={id+"-caption"}>คำอธิบายภาพ</label><textarea id={id+"-caption"} maxLength={1000} value={caption} onChange={e=>setCaption(e.target.value)} placeholder="เช่น Task 1 ชั้นวางหลอด หลังติดฉลาก"/></div>
  </div>
  {run.placementEditable&&<p className="notice warning-notice small" role="note">Run นี้ยังแก้ตำแหน่งได้ (ยังไม่ Finalize ครบ) — ลำดับ คนที่ อาจเปลี่ยนตามการจัดวาง</p>}
  {items.length>0&&<ul className="photo-queue" aria-label="ภาพที่เลือก">{items.map(it=><li key={it.key}>
   {it.preview?<img src={it.preview} alt="" width={56} height={56}/>:<span className="photo-placeholder" aria-hidden="true">{it.status==="preparing"?"…":"ไม่มีภาพย่อ"}</span>}
   <div><span className="name">{it.file.name||"ภาพจากกล้อง"} · {formatBytes(it.file.size)}</span>
    {it.status==="uploading"?<span className="photo-progress"><progress max={1} value={it.progress} aria-label={`กำลังอัปโหลด ${Math.round(it.progress*100)}%`}/></span>
     :<span className={`status small queue-status ${it.status==="done"?(it.message==="บันทึกแล้ว"?"good":"warning"):it.status==="error"?"bad":it.status==="duplicate"?"warning":""}`}>{it.status==="preparing"?"กำลังเตรียมภาพย่อ":it.status==="ready"?(it.preview?"พร้อมอัปโหลด":"พร้อมอัปโหลด (เบราว์เซอร์นี้แสดงภาพย่อไม่ได้ จะเก็บต้นฉบับครบ)"):it.message}</span>}</div>
   {["ready","error","duplicate"].includes(it.status)&&!busy?<button type="button" className="button secondary small" onClick={()=>setItems(list=>list.filter(x=>x.key!==it.key))} aria-label={`นำ ${it.file.name||"ภาพ"} ออกจากรายการ`}>นำออก</button>:<span/>}
  </li>)}</ul>}
  <div className="action-bar row" aria-live="polite">
   <button type="button" className="button" disabled={busy||!pending.length||!!rangeError||!takenOn||items.some(x=>x.status==="preparing")} onClick={()=>void upload()}>{busy?"กำลังอัปโหลด…":pending.length?`อัปโหลด ${pending.length} ภาพ`:"อัปโหลด"}</button>
   {summary&&<p className={`notice ${summary.ok?"success":""}`} role="status">{summary.text}</p>}
  </div>
 </section>;
}

// ── Viewer ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
type RunOption={id:string;runLabel:string};
type ViewerProps={photos:PhotoView[];index:number|null;setIndex:(i:number|null)=>void;run:RunGallery["run"];placement:Placement;onChanged:(message:string)=>void};
/** Full-size inspection in a native modal dialog (focus trap, Esc to close); arrow keys move between photos. Per-photo form
 * state lives in ViewerContent, keyed by photo and version, so switching photos starts from that photo's saved values. */
function Viewer(props:ViewerProps){
 const ref=useRef<HTMLDialogElement>(null),id=useId();const {photos,index,setIndex}=props;const p=index===null?null:photos[index]??null;
 useEffect(()=>{const d=ref.current;if(!d)return;if(p&&!d.open)d.showModal();if(!p&&d.open)d.close();},[p]);
 const go=useCallback((step:number)=>{if(index===null||!photos.length)return;setIndex((index+step+photos.length)%photos.length);},[index,photos.length,setIndex]);
 return <dialog ref={ref} className="p2-dialog photo-viewer" aria-labelledby={id+"-title"} onClose={()=>setIndex(null)} onKeyDown={e=>{if((e.target as HTMLElement).closest("input,textarea,select"))return;if(e.key==="ArrowRight"){e.preventDefault();go(1);}if(e.key==="ArrowLeft"){e.preventDefault();go(-1);}}}>
  {p&&<ViewerContent key={p.id+":"+p.rowVersion} {...props} p={p} titleId={id+"-title"} go={go}/>}
 </dialog>;
}
function ViewerContent({p,photos,index,setIndex,run,placement,onChanged,titleId,go}:ViewerProps&{p:PhotoView;titleId:string;go:(step:number)=>void}){
 const id=useId();
 const [loaded,setLoaded]=useState(false),[broken,setBroken]=useState(false),[error,setError]=useState(""),[busy,setBusy]=useState(false);
 const [caption,setCaption]=useState(p.caption),[from,setFrom]=useState(p.sampleFrom?.toString()??""),[to,setTo]=useState(p.sampleTo?.toString()??""),[takenOn,setTakenOn]=useState(p.takenOn),[reason,setReason]=useState(""),[target,setTarget]=useState(""),[runs,setRuns]=useState<RunOption[]|null>(null);
 const cover=coverage(placement,p.sampleFrom,p.sampleTo);
 const act=async(action:string,body:Record<string,unknown>,done:string)=>{setBusy(true);setError("");try{await labApi(`/api/run-photos/${p.id}`,{action,expectedRowVersion:p.rowVersion,...body});onChanged(done);}catch(e){setError(failureText(e));}finally{setBusy(false);}};
 const loadRuns=async()=>{if(runs)return;try{const r=await labApi<{runs:RunOption[]}>("/api/run-photos/search",{});setRuns(r.runs.filter(x=>x.id!==run.id));}catch(e){setError(failureText(e));}};
 const renderable=RENDERABLE.has(p.mediaType);
 return <div className="photo-viewer-body">
   <div className="photo-stage">
    {renderable&&!broken?<>
     {!loaded&&p.hasThumb&&<img src={fileUrl(p.id,"thumb")} alt="" aria-hidden="true"/>}
     <img src={fileUrl(p.id,"original")} alt={p.caption||`ภาพประจำ ${run.runLabel}`} hidden={!loaded} onLoad={()=>setLoaded(true)} onError={()=>setBroken(true)}/>
     {!loaded&&<span className="sr-only" role="status">กำลังโหลดภาพต้นฉบับ</span>}
    </>:<div className="photo-placeholder">{broken?"เปิดภาพต้นฉบับไม่ได้ขณะนี้ — ที่เก็บภาพอาจไม่พร้อมใช้งาน งานหลักทำต่อได้ตามปกติ":"ไฟล์ HEIC/HEIF แสดงในเบราว์เซอร์นี้ไม่ได้ — ดาวน์โหลดต้นฉบับเพื่อเปิด"}</div>}
    <div className="photo-stage-bar">
     {photos.length>1&&<button type="button" className="button secondary small" onClick={()=>go(-1)} aria-label="ภาพก่อนหน้า">‹ ก่อนหน้า</button>}
     <a className="button secondary small" href={fileUrl(p.id,"original")} target="_blank" rel="noopener">เปิดภาพเต็มในแท็บใหม่</a>
     <a className="button secondary small" href={fileUrl(p.id,"original",true)}>ดาวน์โหลดต้นฉบับ</a>
     {photos.length>1&&<button type="button" className="button secondary small" onClick={()=>go(1)} aria-label="ภาพถัดไป">ถัดไป ›</button>}
    </div>
   </div>
   <div className="photo-side">
    <div className="dialog-header"><h2 id={titleId}>ภาพที่ {index!+1} จาก {photos.length}</h2><button type="button" className="button secondary small" onClick={()=>setIndex(null)}>ปิด</button></div>
    {p.state==="Retracted"&&<p className="notice" role="note">ถอนออกแล้วเมื่อ {bkk(p.retractedAt)} โดย {p.retractedBy} — {p.retractReason}</p>}
    {p.caption&&<p className="photo-text">{p.caption}</p>}
    <dl className="compact-facts">
     <div><dt>Run</dt><dd>{run.runLabel}</dd></div>
     <div><dt>วันที่ถ่าย</dt><dd>{displayBe(p.takenOn)}</dd></div>
     <div><dt>ลำดับตัวอย่าง</dt><dd>{rangeText(p.sampleFrom,p.sampleTo)??"ไม่ได้ระบุ"}</dd></div>
     <div><dt>ผู้อัปโหลด</dt><dd>{p.uploadedBy} · {bkk(p.uploadedAt)}</dd></div>
     <div><dt>ไฟล์</dt><dd>{p.name} · {formatBytes(p.bytes)}{p.width&&p.height?` · ${p.width}×${p.height} px`:""}</dd></div>
     <div><dt>SHA-256</dt><dd className="photo-hash">{p.sha256}</dd></div>
    </dl>
    {cover&&<div><h3>ตัวอย่างในช่วงที่ระบุ</h3><p className="help">ช่วงนี้ผู้อัปโหลดเป็นผู้ระบุ — ไม่ใช่การยืนยันว่าภาพแสดงหลอดของผู้ป่วยแต่ละราย ตรวจฉลากในภาพต้นฉบับ</p>
     {cover.rows.length?<ul className="photo-samples" tabIndex={0} aria-label="ตัวอย่างในช่วงที่ระบุ">{cover.rows.map(r=><li key={r.slot}><span>คนที่ {r.ordinal}</span><span>ตน. {r.slot}</span><span><span className="sample-code">{r.sampleCode??"ไม่มีสิทธิ์ดู"}</span>{r.lnHis&&<span className="sample-ln">LN HIS {r.lnHis}</span>}</span></li>)}</ul>:<p className="muted small">{cover.text}</p>}</div>}
    {error&&<p className="notice" role="alert">{error}</p>}
    {p.canManage&&<>
     <details><summary>แก้ไขคำอธิบาย ช่วงตัวอย่าง หรือวันที่</summary>
      <form className="stack" onSubmit={e=>{e.preventDefault();void act("edit",{caption,sampleFrom:num(from),sampleTo:num(to),takenOn},"บันทึกการแก้ไขแล้ว");}}>
       <div><label htmlFor={id+"-cap"}>คำอธิบายภาพ</label><textarea id={id+"-cap"} maxLength={1000} value={caption} onChange={e=>setCaption(e.target.value)}/></div>
       <div><label htmlFor={id+"-from"}>ลำดับตัวอย่าง (คนที่)</label><div className="photo-range"><input id={id+"-from"} inputMode="numeric" aria-label="ตั้งแต่คนที่" value={from} onChange={e=>setFrom(e.target.value.replace(/\D/g,"").slice(0,2))}/><span>ถึง</span><input inputMode="numeric" aria-label="ถึงคนที่" value={to} onChange={e=>setTo(e.target.value.replace(/\D/g,"").slice(0,2))}/></div></div>
       <div><label htmlFor={id+"-taken"}>วันที่ถ่ายภาพ</label><ThaiDateInput id={id+"-taken"} value={takenOn} onChange={setTakenOn} required/></div>
       <button className="button" disabled={busy}>{busy?"กำลังบันทึก…":"บันทึกการแก้ไข"}</button>
      </form></details>
     <details onToggle={e=>{if((e.target as HTMLDetailsElement).open)void loadRuns();}}><summary>อัปโหลดผิด Run หรือภาพใช้ไม่ได้</summary>
      <div className="stack">
       <div><label htmlFor={id+"-reason"}>เหตุผล (อย่างน้อย 8 ตัวอักษร)</label><input id={id+"-reason"} value={reason} maxLength={500} onChange={e=>setReason(e.target.value)} placeholder="เช่น อัปโหลดผิด Run / ภาพเบลออ่านฉลากไม่ได้"/></div>
       <div><label htmlFor={id+"-target"}>ย้ายไป Run ที่ถูกต้อง</label><select id={id+"-target"} value={target} onChange={e=>setTarget(e.target.value)}><option value="">{runs?"เลือก Run":"กำลังโหลดรายการ Run…"}</option>{runs?.map(r=><option key={r.id} value={r.id}>{r.runLabel}</option>)}</select></div>
       <button type="button" className="button secondary" disabled={busy||!target||reason.trim().length<8} onClick={()=>void act("move",{targetBatchId:target,reason},"ย้ายภาพไป Run ที่เลือกแล้ว")}>ย้ายภาพไป Run นี้</button>
       <p className="help">หรือถอนภาพออกจากหลักฐานของ Run — ไฟล์และประวัติยังเก็บไว้ตรวจสอบได้ ไม่มีการลบ</p>
       <button type="button" className="button danger" disabled={busy||reason.trim().length<8} onClick={()=>void act("retract",{reason},"ถอนภาพออกแล้ว")}>ถอนภาพนี้ออก</button>
      </div></details>
    </>}
   </div>
  </div>;
}

// ── Gallery ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
export function RunPhotoGallery({initial}:{initial:RunGallery}){
 const [data,setData]=useState(initial),[showRetracted,setShowRetracted]=useState(false),[index,setIndex]=useState<number|null>(null),[notice,setNotice]=useState<{ok:boolean;text:string}|null>(null);
 const refresh=useCallback(async(retracted=showRetracted)=>{try{setData(await labApi<RunGallery>(`/api/run-photos/runs/${initial.run.id}${retracted?"?retracted=1":""}`));}catch(e){setNotice({ok:false,text:failureText(e)});}},[initial.run.id,showRetracted]);
 const days=useMemo(()=>{const m=new Map<string,PhotoView[]>();for(const p of data.photos){if(!m.has(p.takenOn))m.set(p.takenOn,[]);m.get(p.takenOn)!.push(p);}return [...m.entries()];},[data.photos]);
 const ordered=useMemo(()=>days.flatMap(([,list])=>list),[days]);
 const active=data.photos.filter(p=>p.state==="Active").length;
 return <>
  {data.can.upload&&<Uploader run={data.run} placement={data.placement} onUploaded={()=>void refresh()}/>}
  <section className="panel" aria-labelledby="photos-h">
   <div className="photo-run-head"><h2 id="photos-h">ภาพของ Run นี้ <span className="muted">· {active} ภาพ</span></h2>
    {data.retracted>0&&<label className="check-label small"><input type="checkbox" checked={showRetracted} onChange={e=>{setShowRetracted(e.target.checked);void refresh(e.target.checked);}}/>แสดงภาพที่ถอนออก ({data.retracted})</label>}</div>
   {notice&&<p className={`notice ${notice.ok?"success":""}`} role="status">{notice.text}</p>}
   {!data.photos.length?<div className="empty-state"><p>ยังไม่มีภาพของ Run นี้</p><p className="small">ภาพเป็นหลักฐานประกอบ ไม่บังคับ — {data.can.upload?"ถ่ายภาพชั้นวางหลอดหรือฉลากได้จากแผง เพิ่มภาพ ด้านบน":"ผู้ปฏิบัติงาน Lab เป็นผู้เพิ่มภาพ"}</p></div>
    :days.map(([day,list])=><section className="photo-day" key={day} aria-label={`ภาพวันที่ ${displayBe(day)}`}>
     <h3>{formatBeText(day)}<span className="muted">{list.length} ภาพ</span></h3>
     <ul className="photo-grid">{list.map(p=>{const i=ordered.indexOf(p),range=rangeText(p.sampleFrom,p.sampleTo),cover=coverage(data.placement,p.sampleFrom,p.sampleTo);
      return <li key={p.id}><figure className={`photo-card${p.state==="Retracted"?" retracted":""}`}>
       <button type="button" className="photo-thumb" onClick={()=>setIndex(i)} aria-label={`เปิดภาพ ${p.caption||p.name}${range?` (${range})`:""}`}>
        <Thumb id={p.id} hasThumb={p.hasThumb} fallback={RENDERABLE.has(p.mediaType)?"แตะเพื่อเปิดภาพ":"HEIC — แตะเพื่อดาวน์โหลด"}/>
       </button>
       <figcaption>
        {p.state==="Retracted"?<span className="photo-chip danger">ถอนออกแล้ว</span>:range?<span className="photo-chip" title={cover?.text}>{range}{cover?.rows.length?` · ตน. ${cover.rows[0].slot}–${cover.rows[cover.rows.length-1].slot}`:""}</span>:<span className="photo-chip neutral">ไม่ระบุลำดับ</span>}
        {p.caption&&<p className="photo-text">{p.caption}</p>}
        <p className="photo-meta">{p.uploadedBy} · {bkk(p.uploadedAt)}</p>
       </figcaption></figure></li>;})}</ul>
    </section>)}
  </section>
  {data.history.length>0&&<details className="panel p5-history"><summary>ประวัติการเปลี่ยนแปลงภาพ ({data.history.length})</summary>
   <ol className="timeline">{data.history.map((h,i)=><li key={i}><strong>{({UPLOADED:"อัปโหลด",EDITED:"แก้ไขรายละเอียด",MOVED:"ย้าย Run",RETRACTED:"ถอนออก"} as Record<string,string>)[h.type]??h.type}</strong> · {h.actor} · {bkk(h.at)}
    {h.type==="MOVED"&&<span className="muted"> · {(h.before as {runLabel?:string})?.runLabel} → {(h.after as {runLabel?:string})?.runLabel}</span>}{h.reason&&<span className="muted"> · เหตุผล: {h.reason}</span>}</li>)}</ol></details>}
  <Viewer photos={ordered} index={index} setIndex={setIndex} run={data.run} placement={data.placement} onChanged={text=>{setIndex(null);setNotice({ok:true,text});void refresh();}}/>
  <p className="muted small"><Link href="/lab/photos">ค้นหาภาพจากทุก Run</Link></p>
 </>;
}
