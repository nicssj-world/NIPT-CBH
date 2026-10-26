"use client";
import {useEffect,useRef,useState} from "react";
import {labApi,failureText,bkk} from "../p4/lab-api";
import "./anc-results.css";
import {formatBe} from "../../../packages/domain/thai-date";
import {printPdfPages,renderPdfForPrint} from '../p2/print-pdf';

// Owner decision (Plan Rev 3.4 §7): user-facing dates are Buddhist Era.
const be=(iso:string)=>{try{return formatBe(iso.slice(0,10));}catch{return iso;}};

type Summary={template:string;noCall:boolean;qc:string|null;t21?:string|null;t18?:string|null;t13?:string|null;fetalSex?:string|null;yChromosome?:string|null;sca?:{xo:string|null;xxx:string|null;xxy:string|null;xyy:string|null}|null;fetalFraction?:number|null};
type Release={id:string;kind:string;state:string;certified_at:string;revised:boolean;summary?:Summary};
type Round={id:string;number:number;state:string;current:boolean;collectionDate:string|null;redraw:{reasonCode:string;label:string;requestedAt:string}|null;result:Release|null;notices:Release[];history:{id:string;kind:string;state:string}[]};
type Data={currentRoundId:string;releaseHold:boolean;rounds:Round[]};
const HISTORY_STATE:Record<string,string>={Superseded:"ถูกแทนด้วยฉบับแก้ไข",Voided:"ยกเลิกแล้ว — โปรดติดต่อห้องปฏิบัติการ"};

const risk=(v?:string|null)=>v??"ไม่ระบุในรายงาน";
const tone=(v?:string|null)=>v==="High Risk"||v==="Detected"?"bad":v==="Low Risk"||v==="Not Detected"?"good":"neutral";
const riskLabel=(v?:string|null)=>v==="Low Risk"?"ความเสี่ยงต่ำ":v==="High Risk"?"ความเสี่ยงสูง":v==="No Call"?"ไม่สามารถรายงานผล":"ไม่ระบุความเสี่ยง";
function ResultIcon({kind}:{kind:string}){return <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">{kind==="report"?<><path d="M6 2h13l7 7v21H6zM19 2v8h7M10 15h12M10 20h12M10 25h12"/></>:kind==="file"?<><path d="M8 3h11l7 7v19H8zM19 3v8h7"/><path d="M11 18h3l2-5 3 10 2-5h3"/></>:kind==="download"?<><path d="M16 3v19m-7-7 7 7 7-7M5 22v7h22v-7"/></>:kind==="print"?<><path d="M9 11V3h14v8M9 24H4V12h24v12h-5M9 19h14v11H9z"/></>:kind==="fraction"?<><path d="M7 28V18m9 10V10m9 18V3" strokeWidth="4"/></>:kind==="sex"?<><circle cx="16" cy="6" r="4"/><path d="M11 14h10l4 12H7zM13 26v6m6-6v6"/></>:<><path d="M8 2c0 14 16 14 16 28M24 2C24 16 8 16 8 30M9 7h14M11 12h10M11 21h10M9 26h14"/></>}</svg>}

/** Certified result summary (same for reports generated in NIPT-CBH and PDFs from ReadyGen) and the exact Final PDF: open, download, print. */
function ResultCard({r,round}:{r:Release;round:Round}){
 const printAbort=useRef<AbortController|null>(null);useEffect(()=>()=>printAbort.current?.abort(),[]);
 const s=r.summary,frame=useRef<HTMLIFrameElement>(null),[printNote,setPrintNote]=useState("");
 const file=`/api/p5/releases/${r.id}/file`;
 const print=async()=>{printAbort.current?.abort();const controller=new AbortController();printAbort.current=controller;setPrintNote('กำลังเตรียมหน้ารายงานสำหรับพิมพ์…');const timer=setTimeout(()=>controller.abort(),45000);
  try{const canvases=await renderPdfForPrint(file,controller.signal);if(controller.signal.aborted)throw Error('PDF_TIMEOUT');if(!frame.current)return;const invoked=await printPdfPages(canvases,frame.current,()=>setPrintNote('เปิดคำสั่งพิมพ์ของเบราว์เซอร์แล้ว'));if(!invoked)setPrintNote('หากหน้าต่างพิมพ์ไม่เปิด ให้เปิดรายงาน PDF แล้วใช้คำสั่งพิมพ์ของเบราว์เซอร์');}
  catch{if(printAbort.current===controller)setPrintNote('เตรียมเอกสารสำหรับพิมพ์ไม่สำเร็จ กรุณาเปิดรายงาน PDF แล้วใช้คำสั่งพิมพ์');}finally{clearTimeout(timer);}};
 return <div className="anc-result">
  <header className="nipt-result-header"><span className="nipt-icon"><ResultIcon kind="file"/></span><div><h2 id="anc-results-h">ผลตรวจ NIPT</h2><p><strong>รอบที่ {round.number} (รอบปัจจุบัน)</strong>{round.collectionDate?` · เก็บตัวอย่าง ${be(round.collectionDate)}`:""}</p></div><span className={`nipt-qc ${s?.qc?.toUpperCase()==="PASS"?"good":s?.qc?.toUpperCase()==="FAIL"?"bad":"neutral"}`}>{s?.qc&&<span aria-hidden="true">{s.qc.toUpperCase()==="PASS"?"✓":s.qc.toUpperCase()==="FAIL"?"×":"?"}</span>} QC {s?.qc??"ไม่ระบุในรายงาน"}</span></header>
  {s?.noCall&&<p className="nipt-no-call" role="status">No Call — ไม่สามารถรายงานผลได้</p>}
  <div className="nipt-table-wrap"><table className="nipt-table"><thead><tr><th>รายการตรวจ</th><th>ผลตรวจ</th><th>สรุปความเสี่ยง</th></tr></thead><tbody>{[["Trisomy 21",s?.t21],["Trisomy 18",s?.t18],["Trisomy 13",s?.t13]].map(([label,value])=><tr key={label}><th scope="row">{label}</th><td><span className={`nipt-risk ${s?.noCall?"neutral":tone(value)}`}><span aria-hidden="true">●</span> {s?.noCall?"No Call":risk(value)}</span></td><td><span className={`nipt-risk-summary ${s?.noCall?"neutral":tone(value)}`}>{s?.noCall?"ไม่สามารถรายงานผล":riskLabel(value)}</span></td></tr>)}</tbody></table></div>
  <div className="nipt-supplement"><div><span className="nipt-icon"><ResultIcon kind="dna"/></span><dl><dt>{s?.template==="TWIN"?"Y Chromosome":"Sex chromosome (XO / XXX / XXY / XYY)"}</dt><dd>{s?.noCall?"No Call":s?.template==="TWIN"?risk(s.yChromosome):s?.sca?[s.sca.xo,s.sca.xxx,s.sca.xxy,s.sca.xyy].map(risk).join(" / "):"ไม่ระบุในรายงาน"}</dd></dl></div><div><span className="nipt-icon"><ResultIcon kind="sex"/></span><dl><dt>เพศทารก</dt><dd>{s?.noCall?"No Call":risk(s?.fetalSex)}</dd></dl></div><div><span className="nipt-icon"><ResultIcon kind="fraction"/></span><dl><dt>Fetal fraction</dt><dd>{s?.fetalFraction!=null?`${s.fetalFraction.toFixed(2)} %`:"ไม่ระบุในรายงาน"}</dd></dl></div></div>
  <div className="nipt-actions"><a className="nipt-button primary" href={file} target="_blank" rel="noopener"><ResultIcon kind="report"/>เปิดรายงาน PDF</a><a className="nipt-button" href={`${file}?mode=download`}><ResultIcon kind="download"/>ดาวน์โหลด PDF</a><button type="button" className="nipt-button" onClick={print}><ResultIcon kind="print"/>พิมพ์</button>{r.revised&&<span className="badge">แก้ไขแล้ว</span>}</div>
  {printNote&&<p role="status" aria-live="polite">{printNote}</p>}<iframe ref={frame} title="ไฟล์สำหรับพิมพ์" className="print-frame" aria-hidden="true" tabIndex={-1}/>
 </div>;
}

/** ANC Result Viewer (Plan §11.8, §11.10, LD-08): the current round first, earlier rounds only under history; nothing unreleased. */
export function AncResults({caseId,onCurrentRelease}:{caseId:string;onCurrentRelease?:(released:boolean)=>void}){
 const [d,setD]=useState<Data|null>(null),[error,setError]=useState(""),[hidden,setHidden]=useState(false);
 useEffect(()=>{let live=true;labApi<Data>(`/api/p5/cases/${caseId}/results`).then(x=>{if(live){setD(x);onCurrentRelease?.(!!x.rounds.find(r=>r.current)?.result);}}).catch(e=>{if(!live)return;if((e as {status?:number}).status===404||(e as {status?:number}).status===403)setHidden(true);else setError(failureText(e));});return()=>{live=false;};},[caseId,onCurrentRelease]);
 if(hidden)return null;
 const current=d?.rounds.find(r=>r.current),earlier=d?.rounds.filter(r=>!r.current)??[];
 const releaseLink=(r:Release,label:string)=><a className="button small secondary" href={`/api/p5/releases/${r.id}/file`} target="_blank" rel="noopener">{label}</a>;
 return <section className="anc-results-section" aria-label="ผลตรวจ NIPT">

  {error&&<p className="notice" role="alert">{error}</p>}
  {!d?<div className="skeleton" role="status" aria-busy="true" aria-label="กำลังโหลดผลตรวจ"/>:<>
   {current&&<div className="stack">

    {current.redraw&&<p><span className="badge warning">ต้องเก็บตัวอย่างใหม่ — รอบที่ {current.number+1}</span> {current.redraw.label}</p>}
    {current.result?<ResultCard r={current.result} round={current}/>
     :<p className="empty-state">ยังไม่มีผลตรวจที่ปล่อยสำหรับรอบนี้{d.releaseHold?" — ยังไม่ผ่านเงื่อนไขการรับรองและออกผล":""}</p>}
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
