"use client";
import {useEffect,useRef,useState} from "react";
import {labApi,failureText,bkk} from "../p4/lab-api";
import {formatBe} from "../../../packages/domain/thai-date";

// Owner decision (Plan Rev 3.4 §7): user-facing dates are Buddhist Era.
const be=(iso:string)=>{try{return formatBe(iso.slice(0,10));}catch{return iso;}};

type Summary={template:string;noCall:boolean;qc:string|null;t21?:string|null;t18?:string|null;t13?:string|null;fetalSex?:string|null;yChromosome?:string|null;sca?:{xo:string|null;xxx:string|null;xxy:string|null;xyy:string|null}|null;fetalFraction?:number|null};
type Release={id:string;kind:string;state:string;certified_at:string;revised:boolean;summary?:Summary};
type Round={id:string;number:number;state:string;current:boolean;collectionDate:string|null;redraw:{reasonCode:string;label:string;requestedAt:string}|null;result:Release|null;notices:Release[];history:{id:string;kind:string;state:string}[]};
type Data={currentRoundId:string;releaseHold:boolean;rounds:Round[]};
const HISTORY_STATE:Record<string,string>={Superseded:"ถูกแทนด้วยฉบับแก้ไข",Voided:"ยกเลิกแล้ว — โปรดติดต่อห้องปฏิบัติการ"};

const risk=(v?:string|null)=>v??"—",tone=(v?:string|null)=>v==="High Risk"||v==="Detected"?"bad":v?"good":"";
/** Certified result summary (same for reports generated in NIPT-CBH and PDFs from ReadyGen) and the exact Final PDF: open, download, print. */
function ResultCard({r}:{r:Release}){
 const s=r.summary,frame=useRef<HTMLIFrameElement>(null),[printNote,setPrintNote]=useState("");
 const file=`/api/p5/releases/${r.id}/file`;
 // Print loads the same certified bytes in a hidden frame and opens the browser's print dialog. Physical printing is never claimed.
 const print=()=>{setPrintNote("กำลังเปิดหน้าต่างพิมพ์ของเบราว์เซอร์…");const f=frame.current;if(!f)return;
  f.onload=()=>{try{f.contentWindow?.focus();f.contentWindow?.print();setPrintNote("เปิดหน้าต่างพิมพ์แล้ว — ตรวจผลการพิมพ์ที่เครื่องพิมพ์");}catch{window.open(`${file}?mode=print`,"_blank","noopener");setPrintNote("เบราว์เซอร์ไม่อนุญาตให้พิมพ์จากหน้านี้ — เปิดไฟล์ในแท็บใหม่แล้ว ให้กดพิมพ์จากตัวแสดง PDF");}};
  f.src=`${file}?mode=print&t=${Date.now()}`;};
 return <div className="stack anc-result">
  {s&&<dl className="compact-facts plan-dl anc-summary" aria-label="สรุปผลตามรายงานที่รับรอง">
   {s.noCall?<div><dt>ผลการตรวจ</dt><dd><span className="status warning">No Call</span> — ไม่สามารถรายงานผลได้ โปรดดูรายงาน</dd></div>:<>
    <div><dt>Trisomy 21</dt><dd><span className={`status ${tone(s.t21)}`}>{risk(s.t21)}</span></dd></div>
    <div><dt>Trisomy 18</dt><dd><span className={`status ${tone(s.t18)}`}>{risk(s.t18)}</span></dd></div>
    <div><dt>Trisomy 13</dt><dd><span className={`status ${tone(s.t13)}`}>{risk(s.t13)}</span></dd></div>
    {s.template==="TWIN"?<div><dt>Y Chromosome</dt><dd>{risk(s.yChromosome)}</dd></div>:<>
     {s.fetalSex&&<div><dt>เพศทารก</dt><dd>{s.fetalSex}</dd></div>}
     {s.sca&&<div><dt>Sex chromosome (XO / XXX / XXY / XYY)</dt><dd>{[s.sca.xo,s.sca.xxx,s.sca.xxy,s.sca.xyy].map(risk).join(" / ")}</dd></div>}
     {s.fetalFraction!=null&&<div><dt>Fetal fraction</dt><dd>{s.fetalFraction.toFixed(2)} %</dd></div>}</>}</>}
   <div><dt>QC</dt><dd>{s.qc??"—"}</dd></div>
  </dl>}
  <p className="help">สรุปนี้ตรงตามรายงานฉบับที่รับรอง — ใช้รายงาน PDF เป็นหลักฐานทางการแพทย์</p>
  <div className="action-bar"><a className="button small" href={file} target="_blank" rel="noopener">เปิดรายงาน PDF</a><a className="button small secondary" href={`${file}?mode=download`}>ดาวน์โหลด PDF</a>
   <button type="button" className="button small secondary" onClick={print}>พิมพ์</button>{r.revised&&<span className="badge">แก้ไขแล้ว</span>}</div>
  <p className="help" role="status" aria-live="polite">{printNote}</p>
  <iframe ref={frame} title="ไฟล์สำหรับพิมพ์" className="print-frame" aria-hidden="true" tabIndex={-1}/>
 </div>;
}

/** ANC Result Viewer (Plan §11.8, §11.10, LD-08): the current round first, earlier rounds only under history; nothing unreleased. */
export function AncResults({caseId}:{caseId:string}){
 const [d,setD]=useState<Data|null>(null),[error,setError]=useState(""),[hidden,setHidden]=useState(false);
 useEffect(()=>{let live=true;labApi<Data>(`/api/p5/cases/${caseId}/results`).then(x=>{if(live)setD(x);}).catch(e=>{if(!live)return;if((e as {status?:number}).status===404||(e as {status?:number}).status===403)setHidden(true);else setError(failureText(e));});return()=>{live=false;};},[caseId]);
 if(hidden)return null;
 const current=d?.rounds.find(r=>r.current),earlier=d?.rounds.filter(r=>!r.current)??[];
 const releaseLink=(r:Release,label:string)=><a className="button small secondary" href={`/api/p5/releases/${r.id}/file`} target="_blank" rel="noopener">{label}</a>;
 return <section className="panel" aria-labelledby="anc-results-h">
  <h2 id="anc-results-h">ผลตรวจ NIPT</h2>
  {error&&<p className="notice" role="alert">{error}</p>}
  {!d?<div className="skeleton" role="status" aria-busy="true" aria-label="กำลังโหลดผลตรวจ"/>:<>
   {current&&<div className="stack">
    <p><strong>รอบที่ {current.number}</strong> (รอบปัจจุบัน){current.collectionDate?` · เก็บตัวอย่าง ${be(current.collectionDate)}`:""}</p>
    {current.redraw&&<p><span className="badge warning">ต้องเก็บตัวอย่างใหม่ — รอบที่ {current.number+1}</span> {current.redraw.label}</p>}
    {current.result?<ResultCard r={current.result}/>
     :<p className="empty-state">ยังไม่มีผลตรวจที่ปล่อยสำหรับรอบนี้{d.releaseHold?" — ระบบยังไม่เปิดการปล่อยผล (ข้อมูลจำลอง)":""}</p>}
    {current.notices.map(n=><p key={n.id}>{releaseLink(n,"เปิดหนังสือแจ้ง")} <span className="badge warning">หนังสือแจ้ง — ไม่ใช่ผลตรวจ</span></p>)}
   </div>}
   {earlier.length>0&&<details className="p5-history"><summary>ประวัติรอบก่อน ({earlier.length})</summary>
    <ul className="timeline">{earlier.map(r=><li key={r.id}><div className="row"><strong>รอบที่ {r.number}</strong>{r.collectionDate&&<span>เก็บ {be(r.collectionDate)}</span>}</div>
     {r.redraw&&<div><span className="badge warning">สั่งเก็บตัวอย่างใหม่</span> {r.redraw.label} · {bkk(r.redraw.requestedAt)}</div>}
     {r.notices.map(n=><div key={n.id}>{releaseLink(n,"เปิดหนังสือแจ้ง")} <span className="badge warning">หนังสือแจ้ง — ไม่ใช่ผลตรวจ</span></div>)}
     {r.result&&<div>{releaseLink(r.result,"เปิดผลตรวจของรอบนี้")}</div>}
     {r.history.map(h=><div key={h.id}>{h.kind==="RESULT"?"ผลตรวจ":"หนังสือแจ้ง"}: {HISTORY_STATE[h.state]??h.state}</div>)}
     {!r.redraw&&!r.result&&!r.notices.length&&!r.history.length&&<div className="muted">ไม่มีผลที่ปล่อย</div>}</li>)}</ul></details>}
  </>}
 </section>;
}
