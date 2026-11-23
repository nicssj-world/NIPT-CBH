"use client";
import {useCallback,useEffect,useRef,useState} from "react";
import {createPortal} from "react-dom";
import {labApi,failureText} from "../p4/lab-api";
import {Ln} from "../p2/shared";
import {Pager} from "../shared/pager";
import {TableScroll} from "../shared/table-scroll";
import {LabIcon} from "../shared/lab-icons";
import {formatBe} from "../../../packages/domain/thai-date";
import {SCREEN_LABEL,type ConfirmTab} from "../../../packages/confirm/model";
import type {ConfirmRow} from "../../../packages/confirm/service";
import type {ConfirmStats} from "../../../packages/confirm/stats";
import {ConcordanceSummary} from "./concordance-summary";
import {ConfirmEditor} from "./confirm-editor";
import {StatusBadge,MatchBadge,OutcomeList} from "./confirm-badges";
import "../nhso/nhso.css";
import "../shared/console.css";
import "./confirm.css";

type Board={rows:ConfirmRow[];counts:Record<ConfirmTab,number>;fiscalYears:number[];page:{number:number;size:number;total:number;totalPages:number;hasNext:boolean}};
const TILES:{tab:ConfirmTab;label:string;sub:string;icon:"list"|"clock"|"check"|"x"}[]=[
 {tab:"PENDING",label:"รอผล",sub:"ผลคัดกรองผิดปกติ ยังไม่ได้บันทึกผลยืนยัน",icon:"clock"},
 {tab:"RESULTED",label:"มีผลแล้ว",sub:"มีผลยืนยัน หรือใช้ผลหลังคลอด",icon:"check"},
 {tab:"NOT_DONE",label:"ไม่ได้ตรวจยืนยัน",sub:"ปฏิเสธการเจาะ · แท้ง-ยุติการตั้งครรภ์ · ติดตามไม่ได้",icon:"x"},
 {tab:"ALL",label:"ทั้งหมด",sub:"ทุกเคสที่ผลคัดกรองผิดปกติ",icon:"list"}];
const TAB_LABEL:Record<ConfirmTab,string>={ALL:"ทุกเคสที่ติดตามผลยืนยัน",PENDING:"เคสที่รอผลยืนยัน",RESULTED:"เคสที่มีผลยืนยันแล้ว",NOT_DONE:"เคสที่ไม่ได้ตรวจยืนยัน"};
const CURRENT_FY=()=>{const d=new Date(Date.now()+7*3600000),y=d.getUTCFullYear()+543;return d.getUTCMonth()>=9?y+1:y;};
const be=(iso:string)=>{try{return formatBe(iso.slice(0,10));}catch{return "—";}};

/** ผลตรวจยืนยัน (Owner 2026-11-23): concordance figures, then the followed High Risk cases by status; Lab staff record each outlab result. */
export function ConfirmBoard({canWrite}:{canWrite:boolean}){
 const [fy,setFy]=useState<number|"all">(CURRENT_FY),[tab,setTab]=useState<ConfirmTab>("PENDING"),[q,setQ]=useState(""),[term,setTerm]=useState(""),[page,setPage]=useState(1),[pageSize,setPageSize]=useState(50);
 const [data,setData]=useState<Board|null>(null),[stats,setStats]=useState<ConfirmStats|null>(null),[statsError,setStatsError]=useState("");
 const [loading,setLoading]=useState(true),[error,setError]=useState(""),[notice,setNotice]=useState(""),[open,setOpen]=useState<string|null>(null),seq=useRef(0),[n,setN]=useState(0);
 const load=useCallback(async()=>{const id=++seq.current;setLoading(true);
  try{const d=await labApi<Board>("/api/confirm",{action:"board",tab,page,pageSize,fy:fy==="all"?null:fy,...(term?{q:term}:{})});if(id===seq.current){setData(d);setError("");}}
  catch(e){if(id===seq.current){setData(null);setError(failureText(e));}}finally{if(id===seq.current)setLoading(false);}},[tab,page,pageSize,term,fy]);
 useEffect(()=>{void Promise.resolve().then(load);},[load,n]);
 useEffect(()=>{let live=true;labApi<ConfirmStats>(`/api/confirm?view=stats&fy=${fy}`).then(s=>{if(live){setStats(s);setStatsError("");}},e=>{if(live){setStats(null);setStatsError(failureText(e));}});return()=>{live=false;};},[fy,n]);
 useEffect(()=>{const t=setTimeout(()=>{setTerm(q.trim());setPage(1);},q?300:0);return()=>clearTimeout(t);},[q]);
 const pick=(t:ConfirmTab)=>{setNotice("");setPage(1);setTab(t);};
 const years=[...new Set([CURRENT_FY(),...(stats?.fiscalYears??[]),...(data?.fiscalYears??[])])].sort((a,b)=>b-a);
 const rows=data?.rows??[],counts=data?.counts;
 const empty=q?"ไม่พบเคสที่ตรงกับคำค้น":tab==="PENDING"?"ไม่มีเคสที่รอผลยืนยัน":tab==="RESULTED"?"ยังไม่มีเคสที่บันทึกผลยืนยัน":tab==="NOT_DONE"?"ไม่มีเคสที่ไม่ได้ตรวจยืนยัน":"ยังไม่มีเคสที่ผลคัดกรองผิดปกติ";
 return <div className="confirm-board nhso-board stack">
  <header className="page-header confirm-head"><div><h1>ผลตรวจยืนยัน</h1>
   <p className="page-meta">เคสที่ผลคัดกรอง NIPT ผิดปกติ (High Risk) · บันทึกผลตรวจยืนยันจาก outlab (น้ำคร่ำ ชิ้นเนื้อรก หรือผลหลังคลอด) แล้วระบบเทียบกับผลคัดกรองให้</p></div>
   <div className="field confirm-fy"><label htmlFor="confirm-fy">ปีงบประมาณของผลคัดกรอง</label>
    <select id="confirm-fy" value={String(fy)} onChange={e=>{setFy(e.target.value==="all"?"all":Number(e.target.value));setPage(1);}}>
     {years.map(y=><option key={y} value={y}>{y} · 1 ต.ค. {y-1} – 30 ก.ย. {y}</option>)}<option value="all">ทุกปีงบประมาณ</option></select></div>
  </header>

  <section className="panel dash-panel" aria-labelledby="confirm-sum-h">
   <header className="dash-panel-head"><h2 id="confirm-sum-h">ความตรงกันของผลคัดกรองกับผลยืนยัน</h2>
    <p className="dash-panel-note">ผลตรงกัน (PPV) = True positive ÷ รายการที่มีผลยืนยัน · Mosaic-other นับเป็นไม่ตรง · เคสที่รอผลหรือไม่ได้ตรวจยืนยันไม่นำมาคิด %</p></header>
   {statsError?<div className="notice" role="alert">{statsError} <button type="button" className="button small secondary" onClick={()=>setN(x=>x+1)}>ลองใหม่</button></div>
    :stats?<ConcordanceSummary stats={stats} headingId="confirm-sum-h"/>:<p className="help" role="status">กำลังโหลด…</p>}
  </section>

  <div className="nhso-tiles confirm-tiles" role="tablist" aria-label="สถานะผลยืนยัน">{TILES.map(t=><button key={t.tab} type="button" role="tab" id={`confirm-tab-${t.tab}`} aria-selected={tab===t.tab} aria-controls="confirm-panel"
   className={"nhso-tile"+(t.tab==="PENDING"?" need":"")} onClick={()=>pick(t.tab)}>
   <span className="nhso-tile-label"><LabIcon name={t.icon} size={20}/>{t.label}</span><strong className="num">{counts?counts[t.tab]:"—"}</strong><small>{t.sub}</small></button>)}</div>

  <section className="panel" role="tabpanel" id="confirm-panel" aria-labelledby={`confirm-tab-${tab}`}>
   <form className="search-form" role="search" aria-label="ค้นหาเคสผลตรวจยืนยัน" onSubmit={e=>e.preventDefault()}>
    <div className="field"><label htmlFor="confirm-q">ค้นหา LN / HN</label><input id="confirm-q" type="search" autoComplete="off" maxLength={40} value={q} onChange={e=>setQ(e.target.value)}/></div>
    {q&&<button type="button" className="button secondary" onClick={()=>setQ("")}>ล้างคำค้น</button>}
   </form>
   <div aria-live="polite">
    {loading&&<p className="help" role="status">กำลังโหลด…</p>}
    {notice&&<p className="notice success" role="status">{notice}</p>}
    {error&&<div className="notice" role="alert">{error} <button type="button" className="button small secondary" onClick={()=>void load()}>ลองใหม่</button></div>}
   </div>
   {!error&&<TableScroll label={TAB_LABEL[tab]} railLabel="แถบเลื่อนแนวนอนของตารางผลตรวจยืนยัน">
    <table className="data-table confirm-table"><thead><tr><th scope="col">LN</th><th scope="col">ชื่อ-นามสกุล</th><th scope="col">ผลคัดกรอง</th><th scope="col">ออกผล NIPT</th><th scope="col">สถานะ</th><th scope="col">ผลเทียบ</th></tr></thead>
     <tbody>{rows.length?rows.map(r=><tr key={r.caseId}>
      <td><button type="button" className="nhso-ln" aria-haspopup="dialog" onClick={()=>setOpen(r.caseId)}><Ln value={r.ln}/>{r.lnHalos&&<span className="nhso-halos num">{r.lnHalos}</span>}
       <span className="sr-only"> {canWrite?"เปิดบันทึกผลยืนยัน":"เปิดดูผลยืนยัน"}</span></button></td>
      <td><span className="confirm-person"><span>{r.name??"—"}</span>{r.hn&&<span className="confirm-sub num">HN {r.hn}</span>}</span></td>
      <td><span className="confirm-chips">{r.screen.map(k=><span key={k} className="badge danger">{SCREEN_LABEL[k]}</span>)}</span></td>
      <td className="num">{be(r.releasedAt)}</td>
      <td><span className="confirm-person"><StatusBadge status={r.status}/>{r.waitingDays!==null&&<span className="confirm-sub num">รอมาแล้ว {r.waitingDays} วัน</span>}</span></td>
      <td>{r.concordant===null?<span className="help">—</span>:<><MatchBadge value={r.concordant}/>{r.record&&<OutcomeList screen={r.screen} findings={r.record.findings}/>}</>}</td>
     </tr>):<tr><td colSpan={6} className="empty-row">{loading?"กำลังโหลด…":empty}</td></tr>}</tbody></table></TableScroll>}
   {data&&data.page.total>0&&<Pager label="รายการผลตรวจยืนยัน" page={data.page.number} pageSize={data.page.size} total={data.page.total} totalPages={data.page.totalPages} busy={loading} onPage={setPage} onSize={x=>{setPageSize(x);setPage(1);}}/>}
  </section>
  {open&&createPortal(<ConfirmEditor caseId={open} canWrite={canWrite} onClose={()=>setOpen(null)} onSaved={m=>{setOpen(null);setNotice(m);setN(x=>x+1);}}/>,document.body)}
 </div>;
}
