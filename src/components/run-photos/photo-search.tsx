"use client";
import {useId,useState} from "react";
import Link from "next/link";
import type {PhotoSearch} from "../../../packages/run-photos/service";
import {displayBe} from "../../../packages/domain/thai-date";
import {ThaiDateInput} from "../shared/thai-date-input";
import {labApi,failureText,bkk} from "../p4/lab-api";
import {Thumb} from "./thumb";
import {rangeText,runStateText} from "./labels";

type Form={date:string;run:string;lnHalos:string;lnHis:string;sample:string;text:string};
const EMPTY:Form={date:"",run:"",lnHalos:"",lnHis:"",sample:"",text:""};
/** Search Runs and photos. Criteria are sent in a POST body so LN values never appear in the address bar or history. */
export function RunPhotoSearch({initial}:{initial:PhotoSearch}){
 const id=useId();
 const [form,setForm]=useState<Form>(EMPTY),[last,setLast]=useState<Form>(EMPTY),[result,setResult]=useState(initial),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const set=(k:keyof Form)=>(v:string)=>setForm(f=>({...f,[k]:v}));
 const body=(f:Form,runsOffset:number)=>({date:f.date||null,run:f.run||null,lnHalos:f.lnHalos||null,lnHis:f.lnHis||null,sample:f.sample?Number(f.sample):null,text:f.text||null,runsOffset});
 const search=async(f:Form)=>{setBusy(true);setError("");
  try{setResult(await labApi<PhotoSearch>("/api/run-photos/search",body(f,0)));setLast(f);}
  catch(e){setError(failureText(e));}finally{setBusy(false);}};
 // Older Runs: same criteria, next block. The photo list and LN matches do not depend on the offset, so only the Runs are appended.
 const loadMore=async()=>{setBusy(true);setError("");
  try{const next=await labApi<PhotoSearch>("/api/run-photos/search",body(last,result.nextRunsOffset));setResult(r=>({...next,runs:[...r.runs,...next.runs.filter(x=>!r.runs.some(y=>y.id===x.id))]}));}
  catch(e){setError(failureText(e));}finally{setBusy(false);}};
 const byRun=new Map<string,PhotoSearch["photos"]>();for(const p of result.photos){if(!byRun.has(p.batchId))byRun.set(p.batchId,[]);byRun.get(p.batchId)!.push(p);}
 const hits=new Map<string,PhotoSearch["lnMatches"]>();for(const m of result.lnMatches){if(!hits.has(m.batchId))hits.set(m.batchId,[]);hits.get(m.batchId)!.push(m);}
 return <>
  <section className="panel" aria-labelledby={id+"-h"}>
   <h2 id={id+"-h"}>ค้นหาภาพ</h2>
   <form className="photo-search" onSubmit={e=>{e.preventDefault();void search(form);}}>
    <div className="field"><label htmlFor={id+"-date"}>วันที่ Run หรือวันที่ถ่ายภาพ</label><ThaiDateInput id={id+"-date"} value={form.date} onChange={set("date")}/></div>
    <div className="field"><label htmlFor={id+"-run"}>Run</label><input id={id+"-run"} value={form.run} onChange={e=>set("run")(e.target.value)} placeholder="เช่น 12 หรือ Run012/2026" autoComplete="off"/></div>
    <div className="field"><label htmlFor={id+"-sample"}>ลำดับตัวอย่างใน Run (คนที่)</label><input id={id+"-sample"} inputMode="numeric" value={form.sample} onChange={e=>set("sample")(e.target.value.replace(/\D/g,"").slice(0,2))} placeholder="1–48" autoComplete="off"/></div>
    <div className="field"><label htmlFor={id+"-halos"}>LN Halos</label><input id={id+"-halos"} className="mono" value={form.lnHalos} onChange={e=>set("lnHalos")(e.target.value.trim())} placeholder="เช่น 26B261018001" autoComplete="off" spellCheck={false}/></div>
    <div className="field"><label htmlFor={id+"-his"}>LN HIS</label><input id={id+"-his"} className="mono" inputMode="numeric" value={form.lnHis} onChange={e=>set("lnHis")(e.target.value.replace(/\D/g,""))} placeholder="ตัวเลข LN จาก HIS" autoComplete="off"/></div>
    <div className="field"><label htmlFor={id+"-text"}>ข้อความในคำอธิบายภาพ</label><input id={id+"-text"} value={form.text} onChange={e=>set("text")(e.target.value)} placeholder="เช่น 11-20 หรือ Task 2" autoComplete="off"/></div>
    <div className="actions"><button className="button" disabled={busy}>{busy?"กำลังค้นหา…":"ค้นหา"}</button><button type="button" className="button secondary" disabled={busy} onClick={()=>{setForm(EMPTY);void search(EMPTY);}}>ล้างเงื่อนไข</button></div>
   </form>
   {error&&<p className="notice" role="alert">{error}</p>}
  </section>

  <section className="panel" aria-labelledby={id+"-r"} aria-busy={busy}>
   <h2 id={id+"-r"}>{result.criteria?`ผลการค้นหา · ${result.runTotal} Run · ${result.photoTotal} ภาพ`:"Run ล่าสุด"}</h2>
   <p className="help" role="status">แสดง {result.runs.length} จาก {result.runTotal} Run{result.hasMoreRuns?" — กด “โหลด Run เพิ่ม” ด้านล่างเพื่อดู Run ที่เก่ากว่า":""}</p>
   {result.photosTruncated&&<p className="notice warning-notice" role="note">พบ {result.photoTotal} ภาพ แสดงเฉพาะ {result.photoCap} ภาพล่าสุด — ภาพที่เหลือเปิดได้จากปุ่ม “เปิดภาพของ Run” ของแต่ละ Run หรือเพิ่มเงื่อนไขค้นหาให้แคบลง</p>}
   {result.lnSearched&&(result.lnMatches.length?<div className="ln-hit" role="status"><strong>พบตัวอย่างนี้ใน {hits.size} Run</strong>
     <ul>{result.lnMatches.map(m=><li key={m.batchId+m.slot}>{m.runLabel} · {m.ordinal?`คนที่ ${m.ordinal} (ตำแหน่ง ${m.slot})`:`เคยอยู่ตำแหน่ง ${m.slot} แต่ย้ายออกแล้ว`} · <span className="mono">{m.sampleCode??"—"}</span> · LN HIS {m.lnHis} · รอบที่ {m.round}</li>)}</ul>
     <p className="small" >ภาพที่ระบุ “ครอบคลุม” คือภาพที่ผู้อัปโหลดระบุช่วงลำดับตัวอย่างไว้ตรงกับลำดับนี้เท่านั้น ภาพอื่นเป็นภาพของ Run เดียวกัน — ระบบไม่ได้ยืนยันว่าเห็นหลอดของผู้ป่วยรายนี้ในภาพ</p></div>
    :<p className="notice warning-notice" role="status">ไม่พบตัวอย่างที่มี LN นี้ใน Run ใด (หรือไม่มีสิทธิ์เห็น)</p>)}
   {!result.runs.length?<div className="empty-state"><p>{result.criteria?"ไม่พบ Run หรือภาพตามเงื่อนไข":"ยังไม่มี Run"}</p></div>
    :<ul className="photo-run-list">{result.runs.map(r=>{const photos=byRun.get(r.id)??[];return <li key={r.id}>
     <div className="photo-run-head"><div><h3>{r.runLabel}</h3><p className="muted small">{runStateText(r.state)} · สร้าง {bkk(r.createdAt)}{r.workDates.length?` · วันทำงาน ${r.workDates.map(d=>displayBe(d)).join(", ")}`:""}</p></div>
      <div className="row"><span className={`photo-chip${r.photos?"":" neutral"}`}>{r.photos?`${r.photos} ภาพ`:"ยังไม่มีภาพ"}{r.latestTakenOn?` · ล่าสุด ${displayBe(r.latestTakenOn)}`:""}</span>
       <Link className="button secondary small" href={`/lab/photos/${r.id}`}>เปิดภาพของ Run</Link><Link className="button secondary small" href={`/lab/batches/${r.id}`}>หน้า Run</Link></div></div>
     {photos.length>0&&<ul className="photo-grid">{photos.slice(0,12).map(p=>{const range=rangeText(p.sampleFrom,p.sampleTo),covers=p.coversLnOrdinals;
      return <li key={p.id}><figure className={`photo-card${p.state==="Retracted"?" retracted":""}`}>
       <Link className="photo-thumb" href={`/lab/photos/${r.id}`} aria-label={`เปิดภาพของ ${r.runLabel}: ${p.caption||p.name}`}><Thumb id={p.id} hasThumb={p.hasThumb} fallback="ไม่มีภาพย่อ"/></Link>
       <figcaption>
        {covers&&covers.length>0?<span className="photo-chip covers">ครอบคลุมคนที่ {covers.join(", ")} (ตามที่ผู้อัปโหลดระบุ)</span>:range?<span className="photo-chip">{range}</span>:<span className="photo-chip neutral">ไม่ระบุลำดับ</span>}
        {p.caption&&<p className="photo-text">{p.caption}</p>}
        <p className="photo-meta">{displayBe(p.takenOn)} · {p.uploadedBy}</p>
       </figcaption></figure></li>;})}</ul>}
     {photos.length>12&&<p className="small"><Link href={`/lab/photos/${r.id}`}>ดูอีก {photos.length-12} ภาพใน {r.runLabel}</Link></p>}
    </li>;})}</ul>}
   {result.hasMoreRuns&&<div className="actions"><button type="button" className="button secondary" disabled={busy} onClick={()=>void loadMore()}>{busy?"กำลังโหลด…":`โหลด Run เพิ่ม (เหลืออีก ${result.runTotal-result.runs.length} Run)`}</button></div>}
  </section>
 </>;
}
