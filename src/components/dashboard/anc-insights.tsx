"use client";
import Link from "next/link";
import {useEffect,useState} from "react";
import {Ln,api,message} from "../p2/shared";
import {Icon} from "../p2/anc-progress-view";
import {ViewResultButton} from "../p5/result-popup";
import {displayBe,displayBeDateTime} from "../../../packages/domain/thai-date";
import type {AncInsights as Data} from "../../../packages/anc/insights";
import {MonthBars} from "./month-bars";
import {monthLabelLong} from "./month-label";
import "./dashboard.css";
import "./anc-insights.css";

/** Risk words for the ANC nurse (Owner 2026-11-11: the attention label is "ผลความเสี่ยงสูง", no clinical instruction appended). */
const RISK:Record<string,{text:string;tone:string}>={HIGH:{text:"ผลความเสี่ยงสูง",tone:"bad"},LOW:{text:"ความเสี่ยงต่ำ",tone:"good"},UNKNOWN:{text:"ดูในรายงานผล",tone:"neutral"}};

// One request serves both parts of the panel (top and statistics); kept for a minute so switching back does not refetch.
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

/** Top of the ANC dashboard: what to look at first, the results of the last 14 days and the cases with GA over 18 weeks. */
export function AncAttention({fy,unitId}:{fy:number;unitId:string}){
 const {data,error,loading,retry}=useInsights(fy,unitId);
 if(error)return <Failed error={error} retry={retry}/>;
 if(!data)return <section className="panel dash-panel anc-skeleton" aria-busy="true" aria-label="กำลังโหลดสรุป"><span/><span/><span/></section>;
 const {recent,gaOver18}=data;
 return <div className={"anc-insights"+(loading?" is-stale":"")}>
  {(recent.high>0||gaOver18.count>0)&&<nav aria-label="รายการเตือน" className="anc-urgent"><ul className="dash-attention">
   {recent.high>0&&<li><a href="#anc-recent" className="bad"><Icon name="alert"/>ผลความเสี่ยงสูง <span className="n">{recent.high}</span></a></li>}
   {gaOver18.count>0&&<li><a href="#anc-ga18" className="bad"><Icon name="alert"/>GA เกิน 18 สัปดาห์ <span className="n">{gaOver18.count}</span></a></li>}
  </ul></nav>}
  <div className="anc-insight-grid">
   <section className="panel dash-panel" id="anc-recent" aria-labelledby="anc-recent-h">
    <header className="dash-panel-head"><h2 id="anc-recent-h">ผลออก {recent.days} วันล่าสุด</h2><p className="dash-panel-note">{recent.total?`${recent.total} ราย · ผลความเสี่ยงสูงขึ้นก่อน`:"ยังไม่มีผลที่ออกในช่วงนี้"}</p></header>
    {recent.rows.length>0&&<ul className="anc-list">{recent.rows.map(r=>{const k=RISK[r.risk]??RISK.UNKNOWN;return <li key={r.caseId} className={r.risk==="HIGH"?"is-high":undefined}>
     <div className="anc-list-who"><strong>{r.name}</strong><span className="cell-sub">HN {r.hn??"ยังไม่ยืนยัน"} · LN <Link className="registry-ln-link" href={`/cases/${r.caseId}`} aria-label={`ดูเคส LN ${r.ln}`}><Ln value={r.ln}/></Link></span></div>
     <div className="anc-list-what"><span className={`dash-status ${k.tone}`}>{r.risk==="HIGH"&&<Icon name="alert"/>}{k.text}</span><span className="cell-sub">ออกผล {displayBeDateTime(r.releasedAt)} น.</span></div>
     <ViewResultButton caseId={r.caseId} ln={r.ln} hn={r.hn} name={r.name} className="button secondary anc-case-action"/>
    </li>;})}</ul>}
    {recent.total>recent.rows.length&&<p className="help">แสดง {recent.rows.length} จาก {recent.total} ราย · ดูทั้งหมดในแท็บ “มีผลตรวจแล้ว”</p>}
   </section>
   <section className="panel dash-panel" id="anc-ga18" aria-labelledby="anc-ga-h">
    <header className="dash-panel-head"><h2 id="anc-ga-h">GA เกิน 18 สัปดาห์</h2><p className="dash-panel-note">อายุครรภ์ ณ วันเจาะเลือดเกิน 18+0 สัปดาห์ ในเคสที่ยังไม่มีผล</p></header>
    {gaOver18.rows.length===0?<p className="dash-empty">ไม่มีเคสที่ GA เกิน 18 สัปดาห์</p>:<ul className="anc-list">{gaOver18.rows.map(r=><li key={r.caseId}>
     <div className="anc-list-who"><strong>{r.name}</strong><span className="cell-sub">HN {r.hn??"ยังไม่ยืนยัน"} · LN <Link className="registry-ln-link" href={`/cases/${r.caseId}`} aria-label={`ดูเคส LN ${r.ln}`}><Ln value={r.ln}/></Link></span></div>
     <div className="anc-list-what"><span className="dash-status bad"><Icon name="alert"/>GA <span className="num">{r.gaWeeks}+{r.gaDays}</span> สัปดาห์</span><span className="cell-sub">เจาะเลือด {displayBe(r.collectionDate)} · {r.received?"รับตัวอย่างแล้ว":"ยังไม่ได้รับตัวอย่าง"}</span></div>
    </li>)}</ul>}
    {gaOver18.count>gaOver18.rows.length&&<p className="help">แสดง {gaOver18.rows.length} จาก {gaOver18.count} ราย</p>}
   </section>
  </div>
 </div>;
}

/** Bottom of the ANC dashboard: the fiscal year month by month, in the nurse's units. */
export function AncMonthly({fy,unitId}:{fy:number;unitId:string}){
 const {data,error,retry}=useInsights(fy,unitId);
 if(error)return <Failed error={error} retry={retry}/>;
 if(!data)return null;
 const m=data.monthly;
 return <section className="panel dash-panel" aria-labelledby="anc-monthly-h">
  <header className="dash-panel-head"><h2 id="anc-monthly-h">สถิติรายเดือน ปีงบประมาณ {data.fiscalYear}</h2><p className="dash-panel-note">{m.length?`${monthLabelLong(m[0].month)} – ${monthLabelLong(m.at(-1)!.month)}`:""} · นับตามหน่วยงานที่เลือก · ระยะรอผลนับเป็นวันทำการ</p></header>
  <div className="dash-split"><MonthBars title="ส่งตรวจและมีผล" note="ส่งตรวจ = รับตัวอย่างเลือดครั้งแรก · มีผล = ผลที่ออกในเดือนนั้น" series={[{name:"ส่งตรวจ"},{name:"มีผล"}]} months={m.map(x=>({month:x.month,values:[x.sent,x.released]}))}/>
  <div className="table-wrap" role="region" aria-label="ตารางสถิติรายเดือน" tabIndex={0}><table className="data-table dash-quality-table">
   <thead><tr><th scope="col">เดือน</th><th scope="col" className="num">ส่งตรวจ</th><th scope="col" className="num">มีผล</th><th scope="col" className="num">ผลความเสี่ยงสูง</th><th scope="col" className="num">เจาะเลือดซ้ำ</th><th scope="col" className="num">มัธยฐานวันทำการรอผล</th></tr></thead>
   <tbody>{[...m].reverse().map(x=><tr key={x.month}><th scope="row">{monthLabelLong(x.month)}</th><td className="num">{x.sent}</td><td className="num">{x.released}</td><td className="num">{x.high>0?<span className="dash-status bad"><Icon name="alert"/>{x.high}</span>:0}</td><td className="num">{x.redraw}</td><td className="num">{x.medianDays??"—"}</td></tr>)}</tbody></table></div></div>
 </section>;
}
