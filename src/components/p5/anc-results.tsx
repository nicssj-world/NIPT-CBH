"use client";
import {useEffect,useState} from "react";
import {labApi,failureText,bkk} from "../p4/lab-api";

type Release={id:string;kind:string;state:string;certified_at:string;revised:boolean};
type Round={id:string;number:number;state:string;current:boolean;collectionDate:string|null;redraw:{reasonCode:string;label:string;requestedAt:string}|null;result:Release|null;notices:Release[];history:{id:string;kind:string;state:string}[]};
type Data={currentRoundId:string;releaseHold:boolean;rounds:Round[]};
const HISTORY_STATE:Record<string,string>={Superseded:"ถูกแทนด้วยฉบับแก้ไข",Voided:"ยกเลิกแล้ว — โปรดติดต่อห้องปฏิบัติการ"};

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
    <p><strong>รอบที่ {current.number}</strong> (รอบปัจจุบัน){current.collectionDate?` · เก็บตัวอย่าง ${current.collectionDate}`:""}</p>
    {current.redraw&&<p><span className="badge warning">ต้องเก็บตัวอย่างใหม่ — รอบที่ {current.number+1}</span> {current.redraw.label}</p>}
    {current.result?<p>{releaseLink(current.result,"เปิดผลตรวจ")}{current.result.revised&&<span className="badge">แก้ไขแล้ว</span>}</p>
     :<p className="empty-state">ยังไม่มีผลตรวจที่ปล่อยสำหรับรอบนี้{d.releaseHold?" — ระบบยังไม่เปิดการปล่อยผล (ข้อมูลจำลอง)":""}</p>}
    {current.notices.map(n=><p key={n.id}>{releaseLink(n,"เปิดหนังสือแจ้ง")} <span className="badge warning">หนังสือแจ้ง — ไม่ใช่ผลตรวจ</span></p>)}
   </div>}
   {earlier.length>0&&<details className="p5-history"><summary>ประวัติรอบก่อน ({earlier.length})</summary>
    <ul className="timeline">{earlier.map(r=><li key={r.id}><div className="row"><strong>รอบที่ {r.number}</strong>{r.collectionDate&&<span>เก็บ {r.collectionDate}</span>}</div>
     {r.redraw&&<div><span className="badge warning">สั่งเก็บตัวอย่างใหม่</span> {r.redraw.label} · {bkk(r.redraw.requestedAt)}</div>}
     {r.notices.map(n=><div key={n.id}>{releaseLink(n,"เปิดหนังสือแจ้ง")} <span className="badge warning">หนังสือแจ้ง — ไม่ใช่ผลตรวจ</span></div>)}
     {r.result&&<div>{releaseLink(r.result,"เปิดผลตรวจของรอบนี้")}</div>}
     {r.history.map(h=><div key={h.id}>{h.kind==="RESULT"?"ผลตรวจ":"หนังสือแจ้ง"}: {HISTORY_STATE[h.state]??h.state}</div>)}
     {!r.redraw&&!r.result&&!r.notices.length&&!r.history.length&&<div className="muted">ไม่มีผลที่ปล่อย</div>}</li>)}</ul></details>}
  </>}
 </section>;
}
