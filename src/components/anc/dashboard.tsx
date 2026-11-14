"use client";
import Link from "next/link";
import {useEffect,useState} from "react";
import {api,ApiFailure,message} from "../p2/shared";
import {Icon} from "../p2/anc-progress-view";
import {LabIcon} from "../shared/lab-icons";
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
  <div className="action-bar"><button type="button" className="icon-btn dash-refresh" disabled={loading} onClick={()=>setTick(x=>x+1)} aria-label={loading?"กำลังอัปเดตตัวเลข":"อัปเดตตัวเลขล่าสุด"} title={loading?"กำลังอัปเดตตัวเลข":"อัปเดตตัวเลขล่าสุด"}><LabIcon name="refresh" size={20}/></button><Link className="button secondary" href="/cases">เปิดทะเบียนกลาง</Link><Link className="button" href="/cases?register=anc">ลงทะเบียนคุณแม่</Link></div></header>;
 if(forbidden)return <div className="dash-home">{head}<section className="panel"><h2>ไม่มีสิทธิ์เปิด Dashboard ANC</h2><p>ไม่แสดงตัวเลขหรือเคสนอกขอบเขตสิทธิ์</p></section></div>;
 const first=loading&&!c&&!ins;
 const toolbar=<section className="dash-toolbar" aria-label="ตัวกรอง Dashboard">
  {units.length>1&&<label className="registry-filter">หน่วยงาน<select value={unitId} onChange={e=>setUnitId(e.target.value)}><option value="">ทุกหน่วยงานในสิทธิ์</option>{units.map(u=><option key={u.id} value={u.id}>{u.name}</option>)}</select></label>}
  </section>;
 // A source the user may not read (403) is said too, so "—" is never left unexplained.
 const failed=[summary.error&&(summary.forbidden?"ตัวเลขสถานะและระยะรอผล (ไม่มีสิทธิ์ดูหน่วยงานนี้)":"ตัวเลขสถานะและระยะรอผล"),insights.error&&(insights.forbidden?"ยอดปีงบและ 14 วันล่าสุด (ไม่มีสิทธิ์ดูหน่วยงานนี้)":"ยอดปีงบและ 14 วันล่าสุด")].filter(Boolean);
 // Alerts = what needs a person today: results and time. Workflow follow-ups are the chart below, so nothing is said twice.
 const alerts=[
  {key:"high",text:`ผลความเสี่ยงสูงในชุดผลล่าสุด${summary.data?.latestRun?` (${summary.data.latestRun})`:""}`,v:c?.high_run,href:registryHref({flag:"high_run"}),tone:"bad"},
  {key:"ga",text:"อายุครรภ์เกิน 18 สัปดาห์ และยังไม่มีผล",v:c?.ga18,href:registryHref({flag:"ga18"}),tone:"bad"},
  {key:"over",text:"รอผลเกินกำหนด",v:c?.tat_overdue,href:over,tone:"bad"},
  {key:"soon",text:`ใกล้ครบกำหนดรอผล (เหลือไม่เกิน ${tat?.policy.warnDaysLeft??2} วันทำการ)`,v:c?.tat_due,href:soon,tone:"warn"},
 ].filter(a=>(a.v??0)>0);
 return <div className={"dash-home"+(loading&&!first?" is-stale":"")} aria-busy={loading}>
  {head}{units.length>1&&toolbar}
  {failed.length>0&&<div className="error" role="alert">โหลด{failed.join(" และ ")}ไม่สำเร็จ ช่องที่อ่านไม่ได้แสดง “—” <button type="button" className="button secondary" onClick={()=>setTick(x=>x+1)}>ลองใหม่</button></div>}
  {first?<section className="dash-skeleton" aria-label="กำลังโหลด Dashboard" role="status"><span/><span/><span/></section>:<>
  <section className="dash-alerts" aria-labelledby="ad-alerts"><h2 id="ad-alerts">ต้องดูตอนนี้</h2>
   {alerts.length?<ul className="dash-attention">{alerts.map(a=><li key={a.key}><Link href={a.href} className={a.tone}><Icon name="alert"/>{a.text} <span className="n">{n(a.v)}</span></Link></li>)}</ul>
   :c?<p className="dash-calm"><Icon name="done"/>ไม่มีผลความเสี่ยงสูงในชุดผลล่าสุด ไม่มีคุณแม่อายุครรภ์เกิน 18 สัปดาห์ที่ยังไม่มีผล และไม่มีใครรอผลเกินกำหนด</p>:<p className="dash-empty">ยังโหลดรายการเตือนไม่ได้</p>}</section>
  <ul className="dash-kpis" aria-label="ตัวเลขสำคัญ">
   <Kpi label={`ส่งตรวจในปีงบประมาณ ${ins?.fiscalYear??""}`} value={ins?.stats.totals.sent} sub="นับจากวันที่ห้อง Lab ได้รับเลือดครั้งแรก" href="/anc-stats"/>
   <Kpi label={W.awaiting} value={c?.awaiting} sub="ลงทะเบียนแล้ว แต่เลือดยังไม่ถึงห้อง Lab" href={registryHref({status:"awaiting"})}/>
   <Kpi label={W.testing} value={c?.testing} sub="ห้อง Lab ได้รับเลือดแล้ว กำลังรอผล" href={registryHref({status:"testing"})}/>
   <Kpi label={W.released} value={c?.released} sub="นับรวมทุกปี" href={registryHref({status:"released"})} tone="good"/>
   <Kpi label="ต้องติดตาม" value={c?.attention} sub="ต้องเจาะเลือดใหม่ ข้อมูลไม่ตรงกัน หรือห้อง Lab ขอข้อมูลเพิ่ม" href={registryHref({flag:"attention"})} tone="warn"/>
   <Kpi label="รอผลเกินกำหนด" value={c?.tat_overdue} sub={c?`ใกล้ครบกำหนดอีก ${c.tat_due} ราย จากที่รอผลทั้งหมด ${c.tat_open} ราย`:"ควรได้ผลภายใน 8 วันทำการ"} href={over} tone="bad"/>
  </ul>
  <div className="dash-stat-grid">
   <section className="panel dash-panel" aria-labelledby="ad-status"><header className="dash-panel-head"><h2 id="ad-status">สถานะคุณแม่ตอนนี้</h2><p className="dash-panel-note">นับรวมทุกปี · กดที่แถวเพื่อดูรายชื่อ</p></header>
    {c?<LinkBars title="จำนวนคุณแม่ตามสถานะ" parts={[{name:"คุณแม่",tone:"s1"}]} unit="ราย" rows={[
     {label:W.awaiting,values:[c.awaiting],href:registryHref({status:"awaiting"})},
     {label:W.testing,values:[c.testing],href:registryHref({status:"testing"})},
     {label:W.followup,values:[c.followup],href:registryHref({status:"followup"}),tone:"warn" as const},
     ...(c.other?[{label:W.other,sub:"ไม่ยินยอม ถอนความยินยอม หรือยังยืนยันตัวตนไม่ได้",values:[c.other],href:registryHref({status:"other"}),tone:"warn" as const}]:[]),
     {label:W.released,values:[c.released],href:registryHref({status:"released"})}]}/>:<p className="dash-empty">อ่านตัวเลขสถานะไม่ได้</p>}</section>
   <section className="panel dash-panel" aria-labelledby="ad-tat"><header className="dash-panel-head"><h2 id="ad-tat">รอผลมานานแค่ไหน</h2><p className="dash-panel-note">คุณแม่ที่ห้อง Lab ได้รับเลือดแล้วและยังรอผล · ควรได้ผลภายใน {tat?.policy.businessDays??"—"} วันทำการ</p></header>
    {tat?<Columns title="รอผลมาแล้วกี่วันทำการ" mode="stack" parts={[{name:"ภายในกำหนด",tone:"good"},{name:`ใกล้ครบ (≤ ${tat.policy.warnDaysLeft} วัน)`,tone:"warn"},{name:"เกินกำหนด",tone:"bad"}]}
     items={tat.aging.map((b,i,all)=>({label:i===all.length-1?`${b.days}+`:String(b.days),long:`ใช้ไป ${b.days}${i===all.length-1?" วันทำการขึ้นไป":" วันทำการ"}`,values:[b.ok,b.dueSoon,b.overdue]}))}
     limit={{at:tat.policy.businessDays,label:`กำหนด ${tat.policy.businessDays} วัน`}} axisNote="แกนนอน = จำนวนวันทำการที่รอมาแล้ว นับจากวันที่ห้อง Lab ได้รับเลือด (ไม่นับเสาร์-อาทิตย์และวันหยุด)" empty="ตอนนี้ไม่มีคุณแม่ที่กำลังรอผล"/>:<p className="dash-empty">อ่านข้อมูล TAT ไม่ได้</p>}
    {c&&c.tat_open>0&&<Link className="button secondary" href={waiting}>ดูรายชื่อคุณแม่ที่รอผล เรียงจากรอนานที่สุด</Link>}</section>
   <section className="panel dash-panel" aria-labelledby="ad-follow"><header className="dash-panel-head"><h2 id="ad-follow">คุณแม่ที่ต้องติดตาม</h2><p className="dash-panel-note">เรื่องที่ยังต้องจัดการต่อ · คุณแม่หนึ่งคนอาจอยู่ได้มากกว่าหนึ่งแถว</p></header>
    {c?<LinkBars title="เรื่องที่ต้องติดตาม" parts={[{name:"คุณแม่",tone:"s2"}]} unit="ราย" rows={[
     {label:W.followup,sub:"เลือดชุดเดิมตรวจไม่ได้",values:[c.followup],href:registryHref({status:"followup"}),tone:"warn" as const},
     {label:"ข้อมูลคุณแม่ไม่ตรงกัน",sub:"ข้อมูลจากระบบโรงพยาบาลไม่ตรงกับที่ลงทะเบียน หรือยังยืนยันไม่ครบ",values:[c.identity],href:registryHref({flag:"identity"}),tone:"warn" as const},
     {label:"ผลความเสี่ยงสูง",sub:"คุณแม่ที่ผลตรวจพบความเสี่ยงสูง นับรวมทุกปี",values:[c.high],href:registryHref({flag:"high"}),tone:"bad" as const}]}/>:<p className="dash-empty">อ่านตัวเลขติดตามไม่ได้</p>}</section>
   <section className="panel dash-panel" aria-labelledby="ad-recent"><header className="dash-panel-head"><h2 id="ad-recent">14 วันล่าสุด</h2><p className="dash-panel-note">ส่งตรวจ = วันที่ห้อง Lab ได้รับเลือดครั้งแรก · ออกผล = วันที่ผลออก · ดูรายเดือนได้ที่หน้าสถิติการส่งตรวจ</p></header>
    {ins?<Columns title="ส่งตรวจและออกผลรายวัน" mode="group" parts={[{name:"ส่งตรวจ",tone:"s1"},{name:"ออกผล",tone:"s2"}]} items={ins.recent.map(d=>({label:dayShort(d.day),long:dayLong(d.day),values:[d.sent,d.released]}))} axisNote="แกนนอน = วันที่ของเดือน" empty="14 วันที่ผ่านมาไม่มีการส่งตรวจหรือผลออก"/>:<p className="dash-empty">อ่านข้อมูล 14 วันไม่ได้</p>}</section>
  </div></>}
 </div>;
}
