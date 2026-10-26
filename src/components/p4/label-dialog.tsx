"use client";
import {useEffect,useMemo,useRef,useState} from "react";
import {Dialog,Ln} from "../p2/shared";
import {labApi,failureText} from "./lab-api";
import {LabIcon} from "../shared/lab-icons";
import {formatHisLn} from "./his-ln";
import "./label-dialog.css";

type Sample={roundId:string;hisLn:string;lnHalos:string|null;labelCode:string|null;roundNumber:number;printed:number};
/**
 * Tube labels (OWNER-LAB-004/025/026/027): 4 stickers (50 × 20 mm) / 8 halves per sample with LN Halos, HIS LN and their
 * barcodes. Preview and print are the same server HTML; printing records an audited job and never issues a number.
 * Several samples open as one selection list (live search, select/deselect, selected total) before preview/print.
 */
export function LabelDialog({samples,onClose,onPrinted}:{samples:Sample[];onClose:()=>void;onPrinted?:()=>void}){
 const [selected,setSelected]=useState<Set<string>>(()=>new Set(samples.filter(s=>s.lnHalos).map(s=>s.roundId))),[query,setQuery]=useState("");
 const [includeName,setIncludeName]=useState(false),[note,setNote]=useState(""),[sheet,setSheet]=useState<string|null>(null),[mode,setMode]=useState<"preview"|"print">("preview"),[busy,setBusy]=useState(false),[error,setError]=useState(""),[done,setDone]=useState("");
 const frame=useRef<HTMLIFrameElement>(null),multi=samples.length>1;
 const chosen=useMemo(()=>samples.filter(s=>selected.has(s.roundId)),[samples,selected]);
 const visible=useMemo(()=>{const q=query.trim().toLowerCase().replaceAll("-","");return q?samples.filter(s=>[s.hisLn,s.lnHalos??"",s.labelCode??""].some(v=>v.toLowerCase().replaceAll("-","").includes(q))):samples;},[samples,query]);
 const reprint=chosen.some(s=>s.printed>0);
 const body=(name=includeName)=>({roundIds:chosen.map(s=>s.roundId),includeName:name,...(reprint&&note.trim()?{reason:note.trim()}:{})});
 const key=chosen.map(s=>s.roundId).join(",");
 // The preview follows the current selection; it is re-requested after the selection settles.
 useEffect(()=>{if(!chosen.length){void Promise.resolve().then(()=>setSheet(null));return;}let live=true;const timer=setTimeout(()=>{setBusy(true);setError("");labApi<{sheetId:string}>("/api/p4/labels",{action:"preview",...body()}).then(r=>{if(live){setSheet(r.sheetId);setMode("preview");}}).catch(e=>{if(live)setError(failureText(e));}).finally(()=>{if(live)setBusy(false);});},250);return()=>{live=false;clearTimeout(timer);};
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[key,includeName]);
 async function print(){setBusy(true);setError("");try{const r=await labApi<{sheetId:string;kind:string}>("/api/p4/labels",{action:"print",...body()});setMode("print");setSheet(r.sheetId);setDone(r.kind==="REPRINT"?"บันทึกการพิมพ์ซ้ำแล้ว — LN Halos เดิม":"บันทึกการพิมพ์แล้ว");onPrinted?.();}catch(e){setError(failureText(e));}finally{setBusy(false);}}
 const toggle=(id:string)=>setSelected(s=>{const n=new Set(s);if(n.has(id))n.delete(id);else n.add(id);return n;});
 const allVisible=visible.filter(s=>s.lnHalos).every(s=>selected.has(s.roundId));
 const one=!multi?samples[0]:null;
 return <Dialog title={multi?"พิมพ์ฉลากหลอด":`ฉลากหลอด ${one?.labelCode??one?.lnHalos??""}`} onClose={onClose}>
  <div className={`label-dialog${multi?" multi":""}`}>
   {one&&<div className="label-identity"><strong className="mono">{one.labelCode??one.lnHalos??"ยังไม่มี LN Halos"}</strong><span>LN <Ln value={one.hisLn}/> · รอบที่ {one.roundNumber}{one.printed>0&&<span className="badge warning">พิมพ์แล้ว {one.printed} ครั้ง</span>}</span></div>}
   {multi&&<section className="label-picker" aria-label="เลือกตัวอย่างที่จะพิมพ์">
    <div className="label-picker-tools"><label className="sr-only" htmlFor="label-search">ค้นหา LN / LN Halos</label><input id="label-search" type="search" placeholder="ค้นหา LN / LN Halos" value={query} onChange={e=>setQuery(e.target.value)} autoComplete="off"/>
     <button type="button" className="button secondary small" onClick={()=>setSelected(s=>{const n=new Set(s);for(const v of visible)if(v.lnHalos){if(allVisible)n.delete(v.roundId);else n.add(v.roundId);}return n;})}>{allVisible?"ไม่เลือกที่แสดง":"เลือกทั้งหมดที่แสดง"}</button></div>
    <ul className="label-picker-list">{visible.map(s=><li key={s.roundId}><label className={selected.has(s.roundId)?"selected":undefined}><input type="checkbox" disabled={!s.lnHalos||busy&&mode==="print"} checked={selected.has(s.roundId)} onChange={()=>toggle(s.roundId)}/>
     <span className="mono strong">{s.labelCode??s.lnHalos??"ยังไม่มี LN Halos"}</span><span className="muted">LN {formatHisLn(s.hisLn)} · รอบที่ {s.roundNumber}</span>{s.printed>0&&<span className="badge warning">พิมพ์แล้ว {s.printed}</span>}</label></li>)}
     {!visible.length&&<li className="muted">ไม่พบตัวอย่างที่ตรงกับคำค้น</li>}</ul>
   </section>}
   <div className="label-preview">{sheet&&chosen.length?<iframe ref={frame} key={sheet} title={mode==="print"?"แผ่นฉลากสำหรับพิมพ์":"ตัวอย่างฉลากก่อนพิมพ์"} src={`/api/p4/label-sheet/${sheet}`} onLoad={()=>{if(mode==="print")frame.current?.contentWindow?.print();}}/>:<p className="help">{busy?"กำลังเตรียมตัวอย่างฉลาก…":"เลือกตัวอย่างอย่างน้อย 1 รายการ"}</p>}</div>
   <label className="check-label"><input type="checkbox" checked={includeName} onChange={e=>setIncludeName(e.target.checked)} disabled={busy||mode==="print"}/> พิมพ์ชื่อผู้รับบริการบรรทัดที่ 3 (เฉพาะที่มีสิทธิ์เห็น)</label>
   {reprint&&mode!=="print"&&<div className="field"><label htmlFor="reprint-note">หมายเหตุการพิมพ์ซ้ำ (ไม่บังคับ)</label><input id="reprint-note" value={note} onChange={e=>setNote(e.target.value)} maxLength={500}/></div>}
   {error&&<p className="notice" role="alert">{error}</p>}{done&&<p className="notice success" role="status">{done}</p>}
   <div className="dialog-actions label-footer"><span className="label-total" aria-live="polite">{multi?`เลือก ${chosen.length} จาก ${samples.length} ตัวอย่าง · ${chosen.length*4} ดวง`:`${chosen.length*4} ดวง (8 ช่อง)`}</span>
    <button className="button" type="button" disabled={busy||mode==="print"||!chosen.length} onClick={()=>void print()}><LabIcon name="printer"/>{reprint?"พิมพ์ซ้ำ":"พิมพ์"}</button></div>
  </div>
 </Dialog>;
}
