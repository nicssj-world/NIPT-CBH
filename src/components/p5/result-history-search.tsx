"use client";
import Link from "next/link";
import {useCallback,useEffect,useMemo,useRef,useState} from "react";
import {labApi,failureText,bkk} from "../p4/lab-api";
import {csrf} from "../p2/shared";
import {Pager} from "../shared/pager";
import type {HisDeliveryStatus} from "../../../packages/results/his-status";
import {HisDeliveryBadge} from "./his-delivery-badge";
import {STATE_TEXT,STATE_TONE,KIND_TEXT} from "./labels";

// "ค้นหาขั้นสูง (ประวัติผลทั้งหมด)": the original `query` action, its filters, status buckets and CSV export, unchanged. The board lists only what needs
// an action, waits for HIS or was sent; historical (migrated) results, rejected/superseded/voided files and the CSV still live behind this query.
type Row={hisDelivery?:HisDeliveryStatus;id:string;origin?:string;kind:string;template_kind:string;state:string;state_changed_at:string;original_name:string;relative_path:string|null;member_name:string|null;hn:string|null;lab:string|null;collection:string|null;round_number:number|null;ln:string|null;proposal:boolean;abnormal:boolean;name_conflict:boolean;historical?:boolean};
type Data={page:{number:number;size:number;hasNext:boolean;total:number;totalPages:number;scope:"BOUNDED_PAGE"};rows:Row[]};
const BUCKETS=[["historical","ออกรายงานแล้วจากระบบเดิม",[]],["unlinked","รอเชื่อมโยง",["Unlinked"]],["conflict","ข้อมูลไม่ตรง",["LinkConflict"]],["blocked","ถูกบล็อกโดย Gate",["ValidationBlocked"]],["pending","รอรับรอง",["PendingCertification"]],["closed","ปิดแล้ว/ใช้ไม่ได้",["RejectedImport","Superseded","Voided","CertifiedReleased"]]] as const;
const DEFAULT_FILTERS={dateField:"REPORTED",from:"",to:"",q:"",gender:"ALL",qc:"ALL",risk:"ALL"};
const Status=({tone,children}:{tone?:string;children:React.ReactNode})=><span className={`status ${tone??""}`}>{children}</span>;

export function ResultHistorySearch({canExport}:{canExport:boolean}){
 const [open,setOpen]=useState(false),[data,setData]=useState<Data|null>(null),[error,setError]=useState(""),[notice,setNotice]=useState(""),[csvBusy,setCsvBusy]=useState(false);
 const [bucket,setBucket]=useState<string>("unlinked"),[draftFilters,setDraftFilters]=useState(DEFAULT_FILTERS),[filters,setFilters]=useState(DEFAULT_FILTERS),[page,setPage]=useState(1),[pageSize,setPageSize]=useState(50),[loading,setLoading]=useState(false);
 const query=useMemo(()=>({bucket,...filters,...(!filters.from?{from:undefined}:{}),...(!filters.to?{to:undefined}:{}),page,pageSize}),[bucket,filters,page,pageSize]);
 const seq=useRef(0);
 const load=useCallback(async()=>{const n=++seq.current;setLoading(true);setData(null);try{const d=await labApi<Data>("/api/p5/results",{action:"query",...query});if(n!==seq.current)return;setData(d);setError("");}catch(e){if(n===seq.current)setError(failureText(e));}finally{if(n===seq.current)setLoading(false);}},[query]);
 // The history query runs only once the section is opened: the board is the default view.
 useEffect(()=>{if(open)void Promise.resolve().then(load);},[open,load]);
 const rows=useMemo(()=>(data?.rows??[]).filter(r=>bucket==="historical"?!!r.historical:(BUCKETS.find(b=>b[0]===bucket)?.[2] as readonly string[]|undefined)?.includes(r.state)&&!(r.historical&&(bucket==="blocked"||bucket==="pending"))),[data,bucket]);
 const doExport=async()=>{setCsvBusy(true);setError("");setNotice("");try{const r=await fetch("/api/p5/results/csv",{method:"POST",cache:"no-store",headers:{"content-type":"application/json","x-csrf-token":csrf()},body:JSON.stringify(query)});if(!r.ok){const d=await r.json().catch(()=>({}));setError(d.error??"ส่งออกไม่สำเร็จ กรุณาลองอีกครั้ง");return;}
  const url=URL.createObjectURL(await r.blob()),a=document.createElement("a");a.href=url;a.download=`nipt-results-page-${page}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);setNotice("ส่งออก CSV เฉพาะหน้าปัจจุบันแล้ว — ไม่ใช่รายการทั้งหมด");}finally{setCsvBusy(false);}};
 return <details className="result-history" open={open} onToggle={e=>setOpen((e.currentTarget as HTMLDetailsElement).open)}>
  <summary>ค้นหาขั้นสูง (ประวัติผลทั้งหมด)</summary>
  <div className="stack">
   <div aria-live="polite">{notice&&<p className="notice success" role="status">{notice}</p>}{error&&<p className="notice" role="alert">{error}</p>}</div>
   <form className="search-form" autoComplete="off" aria-label="กรองประวัติผลตรวจ" onSubmit={e=>{e.preventDefault();if(draftFilters.from&&draftFilters.to&&draftFilters.from>draftFilters.to){setError("วันที่เริ่มต้องไม่เกินวันที่สิ้นสุด กรุณาตรวจช่วงวันที่");return;}setPage(1);setFilters({...draftFilters});}}>
    <div className="field"><label htmlFor="result-search">ค้นหา HN / เลข Lab / ชื่อที่อ่านได้</label><input id="result-search" type="search" maxLength={100} autoComplete="off" value={draftFilters.q} onChange={e=>setDraftFilters(f=>({...f,q:e.target.value}))}/></div>
    <div className="field"><label htmlFor="result-date-field">กรองตามวันที่</label><select id="result-date-field" value={draftFilters.dateField} onChange={e=>setDraftFilters(f=>({...f,dateField:e.target.value}))}><option value="REPORTED">วันที่รายงานที่อ่านได้</option><option value="IMPORTED">วันที่นำเข้า (เวลาไทย)</option></select></div>
    <div className="field"><label htmlFor="result-from">ตั้งแต่วันที่</label><input id="result-from" type="date" value={draftFilters.from} onChange={e=>setDraftFilters(f=>({...f,from:e.target.value}))}/></div>
    <div className="field"><label htmlFor="result-to">ถึงวันที่</label><input id="result-to" type="date" value={draftFilters.to} onChange={e=>setDraftFilters(f=>({...f,to:e.target.value}))}/></div>
    <div className="field"><label htmlFor="result-risk">ความเสี่ยงตามค่าที่อ่าน</label><select id="result-risk" value={draftFilters.risk} onChange={e=>setDraftFilters(f=>({...f,risk:e.target.value}))}><option value="ALL">ทั้งหมด</option><option value="HIGH">High Risk / Detected</option><option value="LOW">Low Risk ที่อ่านครบ</option><option value="UNKNOWN">Unknown / อ่านไม่ครบ / หนังสือแจ้ง</option></select></div>
    <div className="field"><label htmlFor="result-gender">เพศตามค่าที่อ่าน</label><select id="result-gender" value={draftFilters.gender} onChange={e=>setDraftFilters(f=>({...f,gender:e.target.value}))}><option value="ALL">ทั้งหมด</option><option value="Male">Male</option><option value="Female">Female</option><option value="UNKNOWN">Unknown / อ่านไม่ได้</option></select></div>
    <div className="field"><label htmlFor="result-qc">QC ตามค่าที่อ่าน</label><select id="result-qc" value={draftFilters.qc} onChange={e=>setDraftFilters(f=>({...f,qc:e.target.value}))}><option value="ALL">ทั้งหมด</option><option value="PASS">PASS</option><option value="FAIL">FAIL</option><option value="UNKNOWN">Unknown / อ่านไม่ได้</option></select></div>
    <button className="button secondary" disabled={loading}>ใช้ตัวกรอง</button>
    <button type="button" className="button secondary" disabled={loading} onClick={()=>{setDraftFilters(DEFAULT_FILTERS);setFilters(DEFAULT_FILTERS);setPage(1);}}>ล้างตัวกรอง</button>
   </form>
   <p className="help">ตัวกรองอ้างอิงค่าที่ Parser อ่านได้ ไม่ใช่การรับรองผล — ค่าที่ไม่รู้จักหรืออ่านไม่ครบเป็น Unknown</p>
   <div className="tabs result-status-filters" role="tablist" aria-label="สถานะรายงาน (ประวัติ)">{BUCKETS.map(([key,label])=><button key={key} type="button" role="tab" className="tab" aria-selected={bucket===key} onClick={()=>{setBucket(key);setPage(1);}}>{label}</button>)}</div>
   {loading&&<p className="help" role="status">กำลังโหลด…</p>}
   {canExport&&<div className="action-bar"><button type="button" className="button secondary" disabled={loading||!data||csvBusy} onClick={()=>void doExport()}>{csvBusy?"กำลังส่งออก…":"ส่งออก CSV เฉพาะหน้านี้"}</button>{data&&<span className="help">CSV หน้านี้ {data.rows.length} / {data.page.total} รายการ</span>}</div>}
   <div className="table-wrap" role="region" aria-label="รายการรายงาน" tabIndex={0}>
    <table className="data-table p5-queue"><thead><tr><th scope="col">ไฟล์</th><th scope="col">ชนิด</th><th scope="col">HN · เลข Lab</th><th scope="col">วันที่เก็บ</th><th scope="col">LN · รอบ</th><th scope="col">สถานะ</th><th scope="col">อัปเดต</th><th scope="col"><span className="sr-only">เปิด</span></th></tr></thead>
     <tbody>{!data?<tr><td colSpan={8} className="empty-row">{loading?"กำลังโหลด…":"โหลดไม่สำเร็จ"}</td></tr>:rows.length?rows.map(r=><tr key={r.id}>
      <td className="p5-file">{r.origin==="INTERNAL_GENERATED"?"รายงานที่ออกในระบบ":r.member_name??r.relative_path??r.original_name}</td><td>{KIND_TEXT[r.template_kind]??r.kind}{r.origin==="INTERNAL_GENERATED"&&<span className="badge info">ออกในระบบ</span>}{r.abnormal&&<span className="badge danger">ผิดปกติ</span>}</td>
      <td className="mono">{r.hn??"—"}<br/>{r.lab??"—"}</td><td>{r.collection??"—"}</td><td>{r.ln?<><span className="mono">{r.ln}</span> · รอบที่ {r.round_number}</>:"—"}</td>
      <td><Status tone={STATE_TONE[r.historical?"HistoricalReported":r.state]}>{STATE_TEXT[r.historical?"HistoricalReported":r.state]??r.state}</Status>{!r.historical&&<HisDeliveryBadge status={r.hisDelivery}/>} {r.proposal&&<span className="badge warning">รอยืนยันการจับคู่</span>}{r.name_conflict&&<span className="badge warning">ชื่อไฟล์ซ้ำ — ตรวจว่าใหม่/ฉบับแก้ไข</span>}</td><td>{bkk(r.state_changed_at)}</td>
      <td><Link className="button small secondary" href={`/results/${r.id}`}>เปิด</Link></td></tr>)
      :<tr><td colSpan={8} className="empty-row">ไม่มีรายการในสถานะนี้</td></tr>}</tbody></table>
   </div>
   {data&&<Pager label="ประวัติผลตรวจ" page={data.page.number} pageSize={data.page.size} total={data.page.total} totalPages={data.page.totalPages} busy={loading} onPage={setPage} onSize={n=>{setPageSize(n);setPage(1);}}/>}
  </div>
 </details>;
}
