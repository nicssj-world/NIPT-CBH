"use client";
/* eslint-disable @next/next/no-img-element -- previews are local data URLs made in the browser */
import {useId,useMemo,useState} from "react";
import {useRouter} from "next/navigation";
import Link from "next/link";
import {FileDropInput} from "../shared/file-drop-input";
import type {PhotoView} from "../../../packages/run-photos/service";
import {bangkokIsoDay,displayBe} from "../../../packages/domain/thai-date";
import {ThaiDateInput} from "../shared/thai-date-input";
import {failureText,LabFailure} from "../p4/lab-api";
import {makeThumbnail,uploadOne,newKey,formatBytes} from "./photo-client";
import {Thumb} from "./thumb";
import {Viewer,Icon,CAMERA,IMAGES,PHOTO_RENDERABLE,halosRangeText} from "./run-gallery";

/** LN Halos as staff type it: the 12-character base YYBYYMMDDNNN; a suffix (D, -1, -2, R) is ignored, as the server does. */
const HALOS=/^[0-9]{2}B[0-9]{9}$/;
const base=(v:string)=>v.trim().toUpperCase().slice(0,12);

type Item={key:string;file:File;preview:string|null;thumb:Blob|null;status:"preparing"|"ready"|"uploading"|"done"|"duplicate"|"error";progress:number;message:string};
/**
 * Tube photos taken before the tubes go into a Task, when no Run exists yet (Owner 2026-11-24). The photo has no Run; the uploader states the
 * LN Halos range of the tubes in it so a search by LN Halos or LN HIS finds it. Photos stay optional evidence and block nothing.
 */
function TubeUploader({onUploaded}:{onUploaded:()=>void}){
 const id=useId();
 const [items,setItems]=useState<Item[]>([]),[takenOn,setTakenOn]=useState(()=>bangkokIsoDay()),[from,setFrom]=useState(""),[to,setTo]=useState(""),[caption,setCaption]=useState("");
 const [busy,setBusy]=useState(false),[summary,setSummary]=useState(""),[toast,setToast]=useState("");
 const patch=(key:string,p:Partial<Item>)=>setItems(list=>list.map(x=>x.key===key?{...x,...p}:x));
 const add=async(files:FileList|null)=>{
  if(!files?.length)return;setSummary("");
  const fresh=[...files].map(file=>({key:newKey(),file,preview:null,thumb:null,status:"preparing" as const,progress:0,message:""}));
  setItems(list=>[...list,...fresh]);
  for(const it of fresh){const t=await makeThumbnail(it.file);patch(it.key,{preview:t?.dataUrl??null,thumb:t?.blob??null,status:"ready"});}
 };
 // One tube: "ถึง" may stay empty and means the same number.
 const f=base(from),t=base(to)||f;
 const rangeError=!from.trim()?"":!HALOS.test(f)||!HALOS.test(t)?"เลข LN Halos มีรูปแบบ เช่น 26B261018001":t<f?"เลข LN Halos \"ถึง\" ต้องไม่น้อยกว่า \"ตั้งแต่\"":"";
 const ready=!!from.trim()&&!rangeError;
 const pending=items.filter(x=>["ready","error"].includes(x.status));
 const upload=async()=>{
  if(!ready||!takenOn||!pending.length)return;setBusy(true);setSummary("");let ok=0,failed=0,duplicate=0;
  for(const it of pending){
   patch(it.key,{status:"uploading",progress:0,message:""});
   try{await uploadOne(it.file,it.thumb,{batchId:null,idempotencyKey:it.key,caption,sampleFrom:null,sampleTo:null,takenOn,lnHalosFrom:f,lnHalosTo:t},p=>patch(it.key,{progress:p}));
    ok++;patch(it.key,{status:"done",progress:1,message:"บันทึกแล้ว"});}
   catch(e){const dup=e instanceof LabFailure&&e.code==="DUPLICATE_IN_RUN";if(dup)duplicate++;else failed++;patch(it.key,{status:dup?"duplicate":"error",progress:0,message:dup?"ภาพนี้ (ไฟล์เดียวกันทุกไบต์) อัปโหลดไว้แล้ว — ไม่ได้บันทึกซ้ำ":failureText(e)});}
  }
  setBusy(false);
  if(ok&&!failed&&!duplicate){setToast(`อัปโหลดแล้ว ${ok} ภาพ`);setTimeout(()=>setToast(""),4000);}
  else setSummary([ok?`อัปโหลดแล้ว ${ok} ภาพ`:"",duplicate?`ซ้ำกับภาพเดิม ${duplicate} ภาพ (ไม่บันทึกซ้ำ)`:"",failed?`ไม่สำเร็จ ${failed} ภาพ — กด อัปโหลด อีกครั้งเพื่อลองใหม่`:""].filter(Boolean).join(" · "));
  if(ok){setItems(list=>list.filter(x=>x.status!=="done"));onUploaded();}
 };
 return <details className="tube-upload">
  <summary className="button"><Icon d={CAMERA}/>อัปโหลดภาพหลอดตัวอย่าง</summary>
  <div className="tube-upload-body">
   <p className="help">ภาพหลอดที่ถ่ายก่อนวางลง Task ไม่ต้องเลือก Run — ระบุเลข LN Halos ของหลอดในภาพ แล้วค้นหาด้วย LN Halos หรือ LN HIS จะเจอภาพนี้</p>
   <div className="photo-capture">
    <div><FileDropInput compact id={id+"-camera"} type="file" accept="image/*" capture="environment" disabled={busy} onChange={e=>{void add(e.target.files);e.target.value="";}}/>
     <label className="button" htmlFor={id+"-camera"}><Icon d={CAMERA}/>ถ่ายภาพด้วยกล้อง</label></div>
    <div><FileDropInput compact id={id+"-pick"} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" multiple disabled={busy} onChange={e=>{void add(e.target.files);e.target.value="";}}/>
     <label className="button secondary" htmlFor={id+"-pick"}><Icon d={IMAGES}/>เลือกภาพจากเครื่อง (หลายภาพได้)</label></div>
   </div>
   <div className="photo-fields">
    <div className="field" role="group" aria-labelledby={id+"-range-label"}>
     <label id={id+"-range-label"} htmlFor={id+"-from"}>เลข LN Halos ของหลอดในภาพ <span className="required-mark">(จำเป็น)</span></label>
     <div className="photo-range"><input id={id+"-from"} className="mono" aria-label="LN Halos ตั้งแต่" placeholder="ตั้งแต่ เช่น 26B261124001" value={from} onChange={e=>setFrom(e.target.value.trim().toUpperCase())} aria-invalid={!!rangeError} spellCheck={false} autoComplete="off"/><span>ถึง</span>
      <input className="mono" aria-label="LN Halos ถึง" placeholder="ถึง (หลอดเดียวเว้นว่าง)" value={to} onChange={e=>setTo(e.target.value.trim().toUpperCase())} aria-invalid={!!rangeError} spellCheck={false} autoComplete="off"/></div>
     {rangeError&&<p className="field-error" role="alert">{rangeError}</p>}
    </div>
    <div className="field"><label htmlFor={id+"-date"}>วันที่ถ่ายภาพ</label><ThaiDateInput id={id+"-date"} value={takenOn} onChange={setTakenOn} required/></div>
    <div className="field"><label htmlFor={id+"-caption"}>คำอธิบายภาพ</label><textarea id={id+"-caption"} maxLength={1000} value={caption} onChange={e=>setCaption(e.target.value)} placeholder="เช่น แร็คที่ 1 ก่อนวางลง Task"/></div>
   </div>
   {items.length>0&&<ul className="photo-queue" aria-label="ภาพที่เลือก">{items.map(it=><li key={it.key}>
    {it.preview?<img src={it.preview} alt="" width={56} height={56}/>:<span className="photo-placeholder" aria-hidden="true">{it.status==="preparing"?"…":"ไม่มีภาพย่อ"}</span>}
    <div><span className="name">{formatBytes(it.file.size)}</span>
     {it.status==="uploading"?<span className="photo-progress"><progress max={1} value={it.progress} aria-label={`กำลังอัปโหลด ${Math.round(it.progress*100)}%`}/></span>
      :<span className={`status small queue-status ${it.status==="error"?"bad":it.status==="duplicate"?"warning":""}`}>{it.status==="preparing"?"กำลังเตรียมภาพย่อ":it.status==="ready"?"พร้อมอัปโหลด":it.message}</span>}</div>
    {["ready","error","duplicate"].includes(it.status)&&!busy?<button type="button" className="button secondary small" onClick={()=>setItems(list=>list.filter(x=>x.key!==it.key))} aria-label={`นำ ${it.file.name||"ภาพ"} ออกจากรายการ`}>นำออก</button>:<span/>}
   </li>)}</ul>}
   <div className="action-bar row" aria-live="polite">
    <button type="button" className="button" disabled={busy||!pending.length||!ready||!takenOn||items.some(x=>x.status==="preparing")} onClick={()=>void upload()}>{busy?"กำลังอัปโหลด…":pending.length?`อัปโหลด ${pending.length} ภาพ`:"อัปโหลด"}</button>
    {!from.trim()&&pending.length>0&&<p className="help">ระบุเลข LN Halos ก่อนอัปโหลด</p>}
    {summary&&<p className="notice" role="status">{summary}</p>}
    {toast&&<p className="photo-toast" role="status">{toast}</p>}
   </div>
  </div>
 </details>;
}

/** Grid of tube photos (each with its LN Halos range). Opens the shared viewer; a click on a photo never needs a Run. */
export function TubePhotoGrid({photos,onChanged}:{photos:(PhotoView&{runLabel?:string|null})[];onChanged:(message:string)=>void}){
 const [index,setIndex]=useState<number|null>(null);
 // A Run photo that also states a range opens on its Run page, where its sample order is edited; only photos without a Run use the viewer here.
 const loose=useMemo(()=>photos.filter(p=>!p.batchId),[photos]);
 return <>
  <ul className="photo-grid">{photos.map(p=>{const halos=halosRangeText(p.lnHalosFrom,p.lnHalosTo),label=`เปิดภาพ ${p.caption||p.name}${halos?` (LN Halos ${halos})`:""}`;
   const thumb=<Thumb id={p.id} hasThumb={p.hasThumb} fallback={PHOTO_RENDERABLE.has(p.mediaType)?"แตะเพื่อเปิดภาพ":"HEIC — แตะเพื่อดาวน์โหลด"}/>;
   return <li key={p.id}><figure className={`photo-card${p.state==="Retracted"?" retracted":""}`}>
    {p.batchId?<Link className="photo-thumb" href={`/lab/photos/${p.batchId}`} aria-label={label}>{thumb}</Link>
     :<button type="button" className="photo-thumb" onClick={()=>setIndex(loose.indexOf(p))} aria-label={label}>{thumb}</button>}
    <figcaption>
     {p.state==="Retracted"?<span className="photo-chip danger">ถอนออกแล้ว</span>:halos&&<span className="photo-chip mono">{halos}</span>}
     {p.runLabel&&<span className="photo-chip neutral">{p.runLabel}</span>}
     {p.caption&&<p className="photo-text">{p.caption}</p>}
     <p className="photo-meta">{displayBe(p.takenOn)} · {p.uploadedBy}</p>
    </figcaption></figure></li>;})}</ul>
  <Viewer photos={loose} index={index} setIndex={setIndex} run={null} placement={[]} onChanged={m=>{setIndex(null);onChanged(m);}}/>
 </>;
}

/** "ภาพตามเลข LN Halos" on the photo home page: the uploader and the newest tube photos without a Run. */
export function TubePhotos({photos,canUpload}:{photos:PhotoView[];canUpload:boolean}){
 const id=useId(),router=useRouter(),[notice,setNotice]=useState("");
 const days=useMemo(()=>new Set(photos.map(p=>p.takenOn)).size,[photos]);
 return <section className="panel" aria-labelledby={id+"-h"}>
  <div className="photo-run-head"><div><h2 id={id+"-h"}>ภาพตามเลข LN Halos</h2><p className="muted small">ภาพหลอดที่ไม่อยู่ใน Run · ค้นหาด้วย LN Halos หรือ LN HIS ด้านบนจะเจอภาพที่ช่วงเลขครอบตัวอย่างนั้น</p></div>
   {photos.length>0&&<span className="photo-chip neutral">{photos.length} ภาพล่าสุด · {days} วัน</span>}</div>
  {canUpload&&<TubeUploader onUploaded={()=>router.refresh()}/>}
  {notice&&<p className="notice success" role="status">{notice}</p>}
  {photos.length?<TubePhotoGrid photos={photos} onChanged={m=>{setNotice(m);router.refresh();}}/>:<div className="empty-state"><p>ยังไม่มีภาพหลอดที่ไม่อยู่ใน Run</p></div>}
 </section>;
}
