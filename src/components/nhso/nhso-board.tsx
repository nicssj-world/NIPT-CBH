"use client";
import {useCallback,useEffect,useRef,useState} from "react";
import {createPortal} from "react-dom";
import {labApi,failureText} from "../p4/lab-api";
import {Ln} from "../p2/shared";
import {Pager} from "../shared/pager";
import {TableScroll} from "../shared/table-scroll";
import {LabIcon} from "../shared/lab-icons";
import {formatBeDateTime} from "../../../packages/domain/thai-date";
import type {NhsoRow,NhsoTab} from "../../../packages/results/nhso-entry";
import {NhsoDialog} from "./nhso-dialog";
import "./nhso.css";

type Board={rows:NhsoRow[];counts:Record<NhsoTab,number>;truncated:boolean;page:{number:number;size:number;total:number;totalPages:number;hasNext:boolean}};
const TILES:{tab:NhsoTab;label:string;sub:string;icon:"clipboard"|"check"}[]=[
 {tab:"PENDING",label:"ตัวอย่างที่ต้องลงผล",sub:"มีผลตรวจแล้ว ยังไม่ได้ลงในระบบสปสช.",icon:"clipboard"},
 {tab:"DONE",label:"ลงผลแล้ว",sub:"ยืนยันการลงผลสปสช.แล้ว",icon:"check"}];
const TAB_LABEL:Record<NhsoTab,string>={PENDING:"รายการที่ต้องลงผล",DONE:"รายการที่ลงผลแล้ว",NOT_NHSO:"รายการที่ไม่ใช่สิทธิ สปสช."};

export function NhsoBoard(){
 const [tab,setTab]=useState<NhsoTab>("PENDING"),[q,setQ]=useState(""),[term,setTerm]=useState(""),[page,setPage]=useState(1),[pageSize,setPageSize]=useState(50);
 const [data,setData]=useState<Board|null>(null),[counts,setCounts]=useState<Board["counts"]|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState(""),[notice,setNotice]=useState("");
 const [open,setOpen]=useState<NhsoRow|null>(null),seq=useRef(0);
 const load=useCallback(async()=>{const n=++seq.current;setLoading(true);
  try{const d=await labApi<Board>("/api/nhso",{action:"board",tab,page,pageSize,...(term?{q:term}:{})});if(n===seq.current){setData(d);setCounts(d.counts);setError("");}}
  catch(e){if(n===seq.current){setData(null);setError(failureText(e));}}finally{if(n===seq.current)setLoading(false);}},[tab,page,pageSize,term]);
 useEffect(()=>{void Promise.resolve().then(load);},[load]);
 useEffect(()=>{const t=setTimeout(()=>{setTerm(q.trim());setPage(1);},q?300:0);return()=>clearTimeout(t);},[q]);
 const pick=(t:NhsoTab)=>{setNotice("");setPage(1);setTab(t);};
 const changed=async(message:string)=>{setOpen(null);setNotice(message);await load();};
 const rows=data?.rows??[];
 const empty=q?"ไม่พบรายการที่ตรงกับคำค้น":tab==="PENDING"?"ไม่มีตัวอย่างที่ต้องลงผล":tab==="DONE"?"ยังไม่มีตัวอย่างที่ลงผลแล้ว":"ยังไม่มีตัวอย่างที่ระบุว่าไม่ใช่สิทธิ สปสช.";
 return <div className="nhso-board stack">
  <header className="page-header"><div><h1>ลงผลสปสช.</h1><p className="page-meta">ผู้ป่วยสิทธิ สปสช. (รวมเคสที่ไม่ได้ระบุสิทธิ) ที่รับรองและออกผลตรวจแล้ว — เปิด LN เพื่อคัดลอกข้อมูลไปลงในระบบสปสช. แล้วกด “ยืนยันการลงผล” ถ้าไม่ใช่สิทธิ สปสช. กด “ไม่ใช่สิทธิ สปสช.”</p></div></header>
  <div className="nhso-tiles" role="tablist" aria-label="สถานะการลงผลสปสช.">{TILES.map(t=><button key={t.tab} type="button" role="tab" id={`nhso-tab-${t.tab}`} aria-selected={tab===t.tab} aria-controls="nhso-panel" className={"nhso-tile"+(t.tab==="PENDING"?" need":"")} onClick={()=>pick(t.tab)}>
   <span className="nhso-tile-label"><LabIcon name={t.icon} size={20}/>{t.label}</span><strong className="num">{counts?counts[t.tab]:"—"}</strong><small>{t.sub}</small></button>)}
   <button type="button" role="tab" id="nhso-tab-NOT_NHSO" aria-selected={tab==="NOT_NHSO"} aria-controls="nhso-panel" className="nhso-tab-minor" onClick={()=>pick("NOT_NHSO")}>ไม่ใช่สิทธิ สปสช.{counts?` (${counts.NOT_NHSO})`:""}</button></div>
  <section className="panel" role="tabpanel" id="nhso-panel" aria-labelledby={`nhso-tab-${tab}`}>
   <form className="search-form" role="search" aria-label="ค้นหารายการลงผลสปสช." onSubmit={e=>e.preventDefault()}>
    <div className="field"><label htmlFor="nhso-q">ค้นหา LN / HN</label><input id="nhso-q" type="search" autoComplete="off" maxLength={40} value={q} onChange={e=>setQ(e.target.value)}/></div>
    {q&&<button type="button" className="button secondary" onClick={()=>setQ("")}>ล้างคำค้น</button>}
   </form>
   <div aria-live="polite">
    {loading&&<p className="help" role="status">กำลังโหลด…</p>}
    {notice&&<p className="notice success" role="status">{notice}</p>}
    {error&&<div className="notice" role="alert">{error} <button type="button" className="button small secondary" onClick={()=>void load()}>ลองใหม่</button></div>}
    {data?.truncated&&<p className="notice warning-notice" role="status">แสดงเฉพาะรายการล่าสุด — ใช้ช่องค้นหา</p>}
   </div>
   {!error&&<TableScroll label={TAB_LABEL[tab]} railLabel="แถบเลื่อนแนวนอนของตารางลงผลสปสช.">
    <table className="data-table"><thead><tr><th scope="col">LN</th><th scope="col">HN</th><th scope="col">ชื่อ-นามสกุล</th><th scope="col">ออกผลเมื่อ</th><th scope="col">{tab==="PENDING"?"สถานะ":tab==="DONE"?"ลงผลเมื่อ":"ระบุเมื่อ"}</th></tr></thead>
     <tbody>{rows.length?rows.map(r=><tr key={r.releaseId}>
      <td><button type="button" className="nhso-ln" aria-haspopup="dialog" onClick={()=>setOpen(r)}><Ln value={r.ln}/><span className="sr-only"> เปิดข้อมูลสำหรับลงผลสปสช.</span></button></td>
      <td className="num">{r.hn??"—"}</td><td>{r.name??"—"}</td><td className="num">{formatBeDateTime(r.certifiedAt)}</td>
      <td>{tab==="PENDING"?<><span className="status warning">ต้องลงผล</span>{r.entitlement==="UNSPECIFIED"&&<span className="badge info">ไม่ได้ระบุสิทธิ</span>}{r.reissued&&<span className="badge warning">ผลถูกแก้ไข ต้องลงใหม่</span>}</>
       :<><span className="num">{r.entry?formatBeDateTime(r.entry.at):"—"}</span><span className="cell-sub">โดย {r.entry?.by??"—"}</span></>}</td></tr>)
      :<tr><td colSpan={5} className="empty-row">{loading?"กำลังโหลด…":empty}</td></tr>}</tbody></table></TableScroll>}
   {data&&data.page.total>0&&<Pager label="รายการลงผลสปสช." page={data.page.number} pageSize={data.page.size} total={data.page.total} totalPages={data.page.totalPages} busy={loading} onPage={setPage} onSize={n=>{setPageSize(n);setPage(1);}}/>}
  </section>
  {open&&createPortal(<NhsoDialog row={open} tab={tab} onClose={()=>setOpen(null)} onChanged={m=>void changed(m)}/>,document.body)}
 </div>;
}
