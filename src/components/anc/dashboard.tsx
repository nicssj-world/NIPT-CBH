"use client";
import Link from "next/link";
import {useEffect,useState} from "react";
import {api,ApiFailure,message} from "../p2/shared";
import {Icon} from "../p2/anc-progress-view";
import {Columns,LinkBars} from "../dashboard/stat-charts";
import {Kpi} from "../dashboard/kpi";
import {registryHref,STATUS_LABEL} from "../p2/registry-filters";
import type {AncInsights} from "../../../packages/anc/insights";
import "../shared/console.css";
import "../dashboard/dashboard.css";
import "../p2/registry.css";

type Counts=Record<"all"|"awaiting"|"testing"|"released"|"followup"|"other"|"high"|"high_run"|"ga18"|"hold"|"identity"|"attention"|"tat_open"|"tat_due"|"tat_overdue",number>;
/** The registry summary: counts of the registry's own filters, and the TAT aging of the same cases (tatStatus, Lab policy and holidays). */
type Summary={counts:Counts;latestRun:string|null;scopeUnits:{id:string;name:string}[];tat:{policy:{businessDays:number;warnDaysLeft:number};aging:{days:number;ok:number;dueSoon:number;overdue:number}[]}};
type Source<T>={data:T|null;error:string;forbidden:boolean};
const W=STATUS_LABEL.anc;
const n=(v:number|undefined|null)=>v===undefined||v===null?"—":v.toLocaleString("th-TH");
const dayLong=(day:string)=>new Date(day+"T00:00:00Z").toLocaleDateString("th-TH",{timeZone:"UTC",weekday:"short",day:"numeric",month:"short",year:"numeric"});
const dayShort=(day:string)=>String(Number(day.slice(8,10)));
async function load<T>(url:string):Promise<Source<T>>{try{return {data:await api<T>(url),error:"",forbidden:false};}catch(e){return {data:null,error:message(e),forbidden:e instanceof ApiFailure&&e.status===403};}}

/**
 * ANC Dashboard (Owner 2026-11-14): current work at a glance, no patient list. Counts come from the central registry's own filters
 * (registry summary: same scope and rules as /cases) and the ANC insights (TAT of the cases waiting, the last 14 days). Every card,
 * alert and chart row opens /cases with the matching filter; the statistics of the year stay on "สถิติการส่งตรวจ".
 */
export function AncDashboard({operational=false}:{operational?:boolean}){
 const [unitId,setUnitId]=useState(""),[tick,setTick]=useState(0);
 const [state,setState]=useState<{summary:Source<Summary>;insights:Source<AncInsights>;loading:boolean}>({summary:{data:null,error:"",forbidden:false},insights:{data:null,error:"",forbidden:false},loading:true});
 useEffect(()=>{let live=true;const t=setTimeout(()=>{setState(s=>({...s,loading:true}));const u=unitId?"&unitId="+encodeURIComponent(unitId):"";
  void Promise.all([load<Summary>("/api/p2/cases?summary=1"+u),load<AncInsights>("/api/anc/insights?view=dashboard"+u)]).then(([summary,insights])=>{if(live)setState({summary,insights,loading:false});});},0);
  return()=>{live=false;clearTimeout(t);};},[unitId,tick]);
 const {summary,insights,loading}=state,c=summary.data?.counts,ins=insights.data,tat=summary.data?.tat;
 // TAT lists: exactly the cases counted (registry flags built from the same tatStatus).
 const over=registryHref({flag:"tat_overdue",sort:"asc"}),soon=registryHref({flag:"tat_due",sort:"asc"}),waiting=registryHref({flag:"tat_open",sort:"asc"});
 const units=ins?.units??[],scope=unitId?units.find(u=>u.id===unitId)?.name??"หน่วยงานที่เลือก":units.length===1?units[0].name:"ทุกหน่วยงานในสิทธิ์";
 const forbidden=summary.forbidden&&insights.forbidden;
 const head=<header className="page-header"><div><h1>Dashboard</h1><p className="page-meta">ANC · {scope}{!operational&&" · ข้อมูลจำลอง"}{ins&&<> · ข้อมูล ณ <time dateTime={ins.generatedAt}>{new Date(ins.generatedAt).toLocaleString("th-TH",{timeZone:"Asia/Bangkok",dateStyle:"medium",timeStyle:"short"})} น.</time></>}</p></div>
  <div className="action-bar"><button type="button" className="button secondary" disabled={loading} onClick={()=>setTick(x=>x+1)}>{loading?"กำลังอัปเดต…":"รีเฟรช"}</button><Link className="button secondary" href="/cases">เปิดทะเบียนกลาง</Link><Link className="button" href="/cases?register=anc">ลงทะเบียนคุณแม่</Link></div></header>;
 if(forbidden)return <div className="dash-home">{head}<section className="panel"><h2>ไม่มีสิทธิ์เปิด Dashboard ANC</h2><p>ไม่แสดงตัวเลขหรือเคสนอกขอบเขตสิทธิ์</p></section></div>;
 const first=loading&&!c&&!ins;
 const toolbar=<section className="dash-toolbar" aria-label="ตัวกรอง Dashboard">
  {units.length>1&&<label className="registry-filter">หน่วยงาน<select value={unitId} onChange={e=>setUnitId(e.target.value)}><option value="">ทุกหน่วยงานในสิทธิ์</option>{units.map(u=><option key={u.id} value={u.id}>{u.name}</option>)}</select></label>}
  </section>;
 // A source the user may not read (403) is said too, so "—" is never left unexplained.
 const failed=[summary.error&&(summary.forbidden?"ตัวเลขสถานะเคสและ TAT (ไม่มีสิทธิ์ในหน่วยงานนี้)":"ตัวเลขสถานะเคสและ TAT"),insights.error&&(insights.forbidden?"ยอดปีงบและ 14 วันล่าสุด (ไม่มีสิทธิ์ในหน่วยงานนี้)":"ยอดปีงบและ 14 วันล่าสุด")].filter(Boolean);
 // Alerts = what needs a person today: results and time. Workflow follow-ups are the chart below, so nothing is said twice.
 const alerts=[
  {key:"high",text:`ผลความเสี่ยงสูง · ${summary.data?.latestRun??"Run ล่าสุด"}`,v:c?.high_run,href:registryHref({flag:"high_run"}),tone:"bad"},
  {key:"ga",text:"GA เกิน 18 สัปดาห์ (ยังไม่มีผล)",v:c?.ga18,href:registryHref({flag:"ga18"}),tone:"bad"},
  {key:"over",text:"เกินกำหนด TAT",v:c?.tat_overdue,href:over,tone:"bad"},
  {key:"soon",text:`ใกล้ครบกำหนด TAT (เหลือ ≤ ${tat?.policy.warnDaysLeft??2} วันทำการ)`,v:c?.tat_due,href:soon,tone:"warn"},
 ].filter(a=>(a.v??0)>0);
 return <div className={"dash-home"+(loading&&!first?" is-stale":"")} aria-busy={loading}>
  {head}{units.length>1&&toolbar}
  {failed.length>0&&<div className="error" role="alert">โหลด{failed.join(" และ ")}ไม่สำเร็จ ช่องที่อ่านไม่ได้แสดง “—” <button type="button" className="button secondary" onClick={()=>setTick(x=>x+1)}>ลองใหม่</button></div>}
  {first?<section className="dash-skeleton" aria-label="กำลังโหลด Dashboard" role="status"><span/><span/><span/></section>:<>
  <section className="dash-alerts" aria-labelledby="ad-alerts"><h2 id="ad-alerts">ต้องดูตอนนี้</h2>
   {alerts.length?<ul className="dash-attention">{alerts.map(a=><li key={a.key}><Link href={a.href} className={a.tone}><Icon name="alert"/>{a.text} <span className="n">{n(a.v)}</span></Link></li>)}</ul>
   :c?<p className="dash-calm"><Icon name="done"/>ไม่มีผลความเสี่ยงสูงใน Run ล่าสุด, GA เกิน 18 สัปดาห์ หรือเคสเกินกำหนด TAT</p>:<p className="dash-empty">ยังอ่านรายการเตือนไม่ได้</p>}</section>
  <ul className="dash-kpis" aria-label="ตัวเลขสำคัญ">
   <Kpi label={`ส่งตรวจ ปีงบ ${ins?.fiscalYear??""}`} value={ins?.stats.totals.sent} sub="Lab รับตัวอย่างครั้งแรก · ดูสถิติ" href="/anc-stats"/>
   <Kpi label={W.awaiting} value={c?.awaiting} sub="ลงทะเบียนแล้ว ตัวอย่างยังไม่ถึง Lab" href={registryHref({status:"awaiting"})}/>
   <Kpi label={W.testing} value={c?.testing} sub="Lab รับแล้ว ยังไม่มีผล" href={registryHref({status:"testing"})}/>
   <Kpi label={W.released} value={c?.released} sub="รวมทุกปีในสิทธิ์" href={registryHref({status:"released"})} tone="good"/>
   <Kpi label="ต้องติดตาม" value={c?.attention} sub="เจาะซ้ำ · HOLD · ข้อมูลตัวตน · ตรวจสอบสถานะ" href={registryHref({flag:"attention"})} tone="warn"/>
   <Kpi label="เกินกำหนด TAT" value={c?.tat_overdue} sub={c?`ใกล้ครบอีก ${c.tat_due} · จากที่รอผล ${c.tat_open} ราย`:"กำหนดตามวันทำการของ Lab"} href={over} tone="bad"/>
  </ul>
  <div className="dash-stat-grid">
   <section className="panel dash-panel" aria-labelledby="ad-status"><header className="dash-panel-head"><h2 id="ad-status">สถานะเคสตอนนี้</h2><p className="dash-panel-note">ทุกปีในสิทธิ์ · กดแถวเพื่อเปิดรายการในทะเบียนกลาง</p></header>
    {c?<LinkBars title="จำนวนเคสตามสถานะ" parts={[{name:"เคส",tone:"s1"}]} unit="ราย" rows={[
     {label:W.awaiting,values:[c.awaiting],href:registryHref({status:"awaiting"})},
     {label:W.testing,values:[c.testing],href:registryHref({status:"testing"})},
     {label:W.followup,values:[c.followup],href:registryHref({status:"followup"}),tone:"warn" as const},
     ...(c.other?[{label:W.other,sub:"ไม่ยินยอม · ถอนความยินยอม · ตัวตนยังไม่ยืนยัน",values:[c.other],href:registryHref({status:"other"}),tone:"warn" as const}]:[]),
     {label:W.released,values:[c.released],href:registryHref({status:"released"})}]}/>:<p className="dash-empty">อ่านตัวเลขสถานะไม่ได้</p>}</section>
   <section className="panel dash-panel" aria-labelledby="ad-tat"><header className="dash-panel-head"><h2 id="ad-tat">ระยะรอผลเทียบกำหนด TAT</h2><p className="dash-panel-note">เคสที่ Lab รับแล้วและยังไม่มีผล · กำหนด {tat?.policy.businessDays??"—"} วันทำการ</p></header>
    {tat?<Columns title="เคสที่รอผล แยกตามวันทำการที่ใช้ไป" mode="stack" parts={[{name:"ภายในกำหนด",tone:"good"},{name:`ใกล้ครบ (≤ ${tat.policy.warnDaysLeft} วัน)`,tone:"warn"},{name:"เกินกำหนด",tone:"bad"}]}
     items={tat.aging.map((b,i,all)=>({label:i===all.length-1?`${b.days}+`:String(b.days),long:`ใช้ไป ${b.days}${i===all.length-1?" วันทำการขึ้นไป":" วันทำการ"}`,values:[b.ok,b.dueSoon,b.overdue]}))}
     limit={{at:tat.policy.businessDays,label:`กำหนด ${tat.policy.businessDays} วัน`}} axisNote="แกนนอน = วันทำการตั้งแต่ Lab รับตัวอย่าง (ไม่นับเสาร์-อาทิตย์และวันหยุด)" empty="ไม่มีเคสที่รอผลอยู่"/>:<p className="dash-empty">อ่านข้อมูล TAT ไม่ได้</p>}
    {c&&c.tat_open>0&&<Link className="button secondary" href={waiting}>เปิดเคสที่รอผล เรียงจากรอนานที่สุด</Link>}</section>
   <section className="panel dash-panel" aria-labelledby="ad-follow"><header className="dash-panel-head"><h2 id="ad-follow">เคสที่ต้องติดตาม</h2><p className="dash-panel-note">ปัญหาค้างตามขั้นตอนจริง · เคสหนึ่งอาจอยู่หลายแถว</p></header>
    {c?<LinkBars title="ติดตามตามเรื่อง" parts={[{name:"เคส",tone:"s2"}]} unit="ราย" rows={[
     {label:W.followup,sub:"ตัวอย่างเดิมตรวจไม่ได้",values:[c.followup],href:registryHref({status:"followup"}),tone:"warn" as const},
     {label:"HOLD · ห้อง Lab พักการตรวจ",values:[c.hold],href:registryHref({flag:"hold"}),tone:"warn" as const},
     {label:"ข้อมูลตัวตนรอตรวจสอบ",sub:"ข้อมูลจาก HIS ไม่ตรงหรือยังยืนยันไม่ครบ",values:[c.identity],href:registryHref({flag:"identity"}),tone:"warn" as const},
     {label:"High Risk ทั้งหมด",sub:"ทุกผลที่ออกแล้วในสิทธิ์",values:[c.high],href:registryHref({flag:"high"}),tone:"bad" as const}]}/>:<p className="dash-empty">อ่านตัวเลขติดตามไม่ได้</p>}</section>
   <section className="panel dash-panel" aria-labelledby="ad-recent"><header className="dash-panel-head"><h2 id="ad-recent">14 วันล่าสุด</h2><p className="dash-panel-note">ส่งตรวจ = Lab รับตัวอย่างครั้งแรก · ออกผล = ผลที่ออกในวันนั้น · ภาพรายเดือนอยู่ในสถิติการส่งตรวจ</p></header>
    {ins?<Columns title="ส่งตรวจและออกผลรายวัน" mode="group" parts={[{name:"ส่งตรวจ",tone:"s1"},{name:"ออกผล",tone:"s2"}]} items={ins.recent.map(d=>({label:dayShort(d.day),long:dayLong(d.day),values:[d.sent,d.released]}))} axisNote="แกนนอน = วันที่ของเดือน" empty="ไม่มีการส่งตรวจหรือออกผลใน 14 วันนี้"/>:<p className="dash-empty">อ่านข้อมูล 14 วันไม่ได้</p>}</section>
  </div></>}
 </div>;
}
