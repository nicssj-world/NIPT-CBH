"use client";
import Link from "next/link";
import {useEffect,useRef,useState} from "react";
import {Ln,api,message} from "../p2/shared";
import {Icon} from "../p2/anc-progress-view";
import {ViewResultButton} from "../p5/result-popup";
import {displayBe,displayBeDateTime} from "../../../packages/domain/thai-date";
import type {AncInsights as Data} from "../../../packages/anc/insights";
import "./dashboard.css";
import "./anc-insights.css";


// Kept for a minute so switching tabs back and forth does not refetch.
const cache=new Map<string,{at:number;p:Promise<Data>}>();
function load(fy:number,unitId:string,force=false){
 const key=`${fy}|${unitId}`,hit=cache.get(key);
 if(hit&&!force&&Date.now()-hit.at<60000)return hit.p;
 const q=new URLSearchParams({fy:String(fy)});if(unitId)q.set("unitId",unitId);
 const p=api<Data>("/api/anc/insights?"+q);cache.set(key,{at:Date.now(),p});p.catch(()=>cache.delete(key));return p;
}
function useInsights(fy:number,unitId:string){
 const [state,setState]=useState<{data:Data|null;error:string;loading:boolean}>({data:null,error:"",loading:true});
 const [n,setN]=useState(0);
 useEffect(()=>{let live=true;const t=setTimeout(()=>{setState(s=>({...s,loading:true,error:""}));load(fy,unitId,n>0).then(d=>{if(live)setState({data:d,error:"",loading:false});},e=>{if(live)setState({data:null,error:message(e),loading:false});});},0);return()=>{live=false;clearTimeout(t);};},[fy,unitId,n]);
 return {...state,retry:()=>setN(x=>x+1)};
}
function Failed({error,retry}:{error:string;retry:()=>void}){
 return <div className="error" role="alert">{error||"โหลดข้อมูลสรุปไม่สำเร็จ"} · คิวเคสด้านล่างยังใช้ได้ <button type="button" className="button secondary" onClick={retry}>ลองใหม่</button></div>;
}

/**
 * Two count cards at the top of the ANC overview (Owner 2026-11-12): High Risk results of the latest Run, and cases with GA over 18 weeks.
 * A card only shows the number; pressing it opens a popup with the names. In the High Risk popup each row opens the result.
 */
type Open="high"|"ga"|null;
export function AncFocusCards({fy,unitId}:{fy:number;unitId:string}){
 const {data,error,loading,retry}=useInsights(fy,unitId);
 const [open,setOpen]=useState<Open>(null);
 const ref=useRef<HTMLDialogElement>(null);
 useEffect(()=>{const d=ref.current;if(!d)return;if(open&&!d.open)d.showModal();if(!open&&d.open)d.close();},[open]);
 if(error)return <Failed error={error} retry={retry}/>;
 if(!data)return <section className="anc-focus anc-skeleton" aria-busy="true" aria-label="กำลังโหลดสรุป"><span/><span/></section>;
 const {highRisk,gaOver18}=data;
 const card=(kind:"high"|"ga",title:string,n:number,sub:string,bad:boolean)=><li key={kind}><button type="button" className={"anc-focus-card"+(bad&&n>0?" bad":"")} disabled={n===0} aria-haspopup="dialog" onClick={()=>setOpen(kind)}>
  <span className="f-title">{bad&&n>0&&<Icon name="alert"/>}{title}</span><span className="f-n num">{n}<small> ราย</small></span><span className="f-sub">{n===0?"ไม่มีรายการ":sub}</span></button></li>;
 return <div className={"anc-insights"+(loading?" is-stale":"")}>
  <ul className="anc-focus" aria-label="รายการที่ควรดู">
   {card("high","ผลความเสี่ยงสูง",highRisk.count,highRisk.runLabel?`${highRisk.runLabel} · กดดูรายชื่อ`:"Run ล่าสุด · กดดูรายชื่อ",true)}
   {card("ga","GA เกิน 18 สัปดาห์",gaOver18.count,"เคสที่ยังไม่มีผล · กดดูรายชื่อ",true)}
  </ul>
  <dialog ref={ref} className="anc-dialog" aria-labelledby="anc-dialog-h" onClose={()=>setOpen(null)} onClick={e=>{if(e.target===e.currentTarget)setOpen(null);}}>
   <header className="anc-dialog-head"><h2 id="anc-dialog-h">{open==="ga"?"GA เกิน 18 สัปดาห์":"ผลความเสี่ยงสูง"}</h2><p className="dash-panel-note">{open==="ga"?`${gaOver18.count} ราย · อายุครรภ์ ณ วันเจาะเลือดเกิน 18+0 สัปดาห์ ในเคสที่ยังไม่มีผล`:`${highRisk.count} ราย · ${highRisk.runLabel??"Run ล่าสุด"}`}</p>
    <button type="button" className="button secondary" onClick={()=>setOpen(null)}>ปิด</button></header>
   {open==="high"&&<ul className="anc-list">{highRisk.rows.map(r=><li key={r.caseId} className="is-high">
    <div className="anc-list-who"><strong>{r.name}</strong><span className="cell-sub">HN {r.hn??"ยังไม่ยืนยัน"} · LN <Link className="registry-ln-link" href={`/cases/${r.caseId}`} aria-label={`ดูเคส LN ${r.ln}`}><Ln value={r.ln}/></Link></span></div>
    <div className="anc-list-what"><span className="dash-status bad"><Icon name="alert"/>ผลความเสี่ยงสูง</span>{r.releasedAt&&<span className="cell-sub">ออกผล {displayBeDateTime(r.releasedAt)} น.</span>}</div>
    <ViewResultButton caseId={r.caseId} ln={r.ln} hn={r.hn} name={r.name} className="button secondary anc-case-action"/>
   </li>)}</ul>}
   {open==="ga"&&<ul className="anc-list anc-list-2">{gaOver18.rows.map(r=><li key={r.caseId}>
    <div className="anc-list-who"><strong>{r.name}</strong><span className="cell-sub">HN {r.hn??"ยังไม่ยืนยัน"} · LN <Link className="registry-ln-link" href={`/cases/${r.caseId}`} aria-label={`ดูเคส LN ${r.ln}`}><Ln value={r.ln}/></Link></span></div>
    <div className="anc-list-what"><span className="dash-status bad"><Icon name="alert"/>GA <span className="num">{r.gaWeeks}+{r.gaDays}</span> สัปดาห์</span><span className="cell-sub">เจาะเลือด {displayBe(r.collectionDate)} · {r.received?"รับตัวอย่างแล้ว":"ยังไม่ได้รับตัวอย่าง"}</span></div>
   </li>)}</ul>}
  </dialog>
 </div>;
}
