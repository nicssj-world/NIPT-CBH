import Link from "next/link";
import "./shared/console.css";
import "./lab-workload.css";
import "./dashboard/dashboard.css";
import {LabIcon} from "./shared/lab-icons";
import {LabStats} from "./dashboard/lab-stats";
import {HomeTabs} from "./dashboard/home-tabs";
import {Kpi} from "./dashboard/kpi";
import {Columns,LinkBars} from "./dashboard/stat-charts";
import {registryHref} from "./p2/registry-filters";
import {BATCH_STATUSES,batchStatusKey} from "./p4/batch-status";
import type {LabOverview,LabStage} from "../../packages/lab/overview";
import type {RegistryCounts} from "../../packages/p2/service";

/** One stage of today's Lab work. `n` is an existing queue count (no new counting rule); null = the queue could not be read. */
export type WorkloadStage={key:string;href:string;label:string;n:number|null;parts:{label:string;n:number}[];go:string;hot?:boolean};
const ARROW="M5 12h14M13 6l6 6-6 6";
/** Where each open stage is worked on: the bottleneck rows open that page (Lab worklist tabs, Batch list, results, the registry for HOLD). */
const STAGE:Record<LabStage,{label:string;href:string}>={READY:{label:"รอเข้า Batch",href:"/lab?tab=READY"},IN_RUN:{label:"อยู่ใน Run",href:"/lab/batches"},
 QC_FAILED:{label:"QC ไม่ผ่าน · รอตัดสินใจ",href:"/lab?tab=DECISION"},ANALYSIS_DONE:{label:"วิเคราะห์เสร็จ · รอผลตรวจ",href:"/lab?tab=COMPLETED"},
 AWAITING_RESULT:{label:"รอออกผล",href:"/results"},HOLD:{label:"HOLD",href:registryHref({flag:"hold"})},OTHER:{label:"กำลังดำเนินการ",href:"/lab"}};
const dayLong=(day:string)=>new Date(day+"T00:00:00Z").toLocaleDateString("th-TH",{timeZone:"UTC",weekday:"short",day:"numeric",month:"short",year:"numeric"});

/**
 * Lab Dashboard (Owner 2026-11-08, 2026-11-11, redesigned 2026-11-14): what needs attention now, a row of KPIs, the work in order as signs,
 * then where open specimens wait, how long they have waited, the last 14 days and the Runs in progress. No patient rows and no queue tables:
 * every number opens the page that owns its list (worklist tab, Batch list, results, or the registry filtered). Statistics stay on their tab.
 */
export function LabWorkload({stages,generatedAt,alerts,overview,registry,decisions}:{stages:WorkloadStage[];generatedAt:string;alerts:{text:string;href:string}[];overview?:LabOverview|null;registry?:RegistryCounts|null;decisions?:number|null}){
 const o=overview??null,tat=o?.tat,limit=o?.policy.businessDays??8;
 const late=registryHref({status:"testing",sort:"asc"});
 const attention:{href:string;text:string;n:number;tone:"bad"|"warn"}[]=[
  ...(tat?[{href:late,text:"เกินกำหนด TAT",n:tat.overdue,tone:"bad" as const},{href:late,text:`ใกล้ครบกำหนด (เหลือ ≤ ${o!.policy.warnDaysLeft} วันทำการ)`,n:tat.dueSoon,tone:"warn" as const}]:[]),
  {href:"/lab?tab=DECISION",text:"QC ไม่ผ่าน / หยุด · รอตัดสินใจ",n:decisions??0,tone:"bad" as const},
  ...(registry?[{href:registryHref({flag:"ga18"}),text:"GA เกิน 18 สัปดาห์ (ยังไม่มีผล)",n:registry.ga18,tone:"bad" as const},{href:registryHref({flag:"hold"}),text:"ตัวอย่างที่ติด HOLD",n:registry.hold,tone:"warn" as const},{href:registryHref({flag:"identity"}),text:"ข้อมูลตัวตน / การรับตัวอย่างรอตรวจสอบ",n:registry.identity,tone:"warn" as const}]:[]),
 ].filter(a=>a.n>0);
 const unread=o===null||registry===null;
 const runs=o?.runs.rows??[],byStep=BATCH_STATUSES.map(s=>({...s,n:runs.filter(r=>batchStatusKey(r)===s.key).length})).filter(s=>s.n>0);
 const sum=(k:"received"|"released")=>o?o.recent.reduce((a,d)=>a+d[k],0):null;
 const dashboard=<div className="dash-home">
  <section className="dash-alerts" aria-labelledby="ld-alerts"><h2 id="ld-alerts">ต้องดูตอนนี้</h2>
   {(attention.length>0||alerts.length>0)&&<ul className="dash-attention">
    {attention.map(a=><li key={a.text}><Link href={a.href} className={a.tone}><LabIcon name="alert" size={18}/>{a.text} <span className="n">{a.n}</span></Link></li>)}
    {alerts.map(a=><li key={a.href+a.text}><Link href={a.href} className="warn"><LabIcon name="info" size={18}/>{a.text}</Link></li>)}</ul>}
   {o&&o.calendar.missingYears.length>0&&<p className="dash-note warn" role="status"><LabIcon name="info" size={18}/>ยังไม่มีปฏิทินวันหยุดปี {o.calendar.missingYears.map(y=>y+543).join(", ")}: TAT นับเฉพาะเสาร์-อาทิตย์ <Link href="/settings?key=tat">ไปซิงก์วันหยุด</Link></p>}
   {unread&&<p className="dash-note warn" role="status"><LabIcon name="info" size={18}/>อ่านตัวเลขบางส่วนไม่ได้ในขณะนี้ (แสดง “—”) — คิวงานด้านล่างยังใช้ได้ <Link href="/?view=lab">โหลดใหม่</Link></p>}
   {!attention.length&&!alerts.length&&!unread&&<p className="dash-calm"><LabIcon name="info" size={18}/>ไม่มีงานเกินกำหนด QC ค้างตัดสินใจ หรือตัวอย่างติด HOLD</p>}</section>
  <ul className="dash-kpis" aria-label="ตัวเลขสำคัญ">
   <Kpi label="รับตัวอย่าง 14 วัน" value={sum("received")} sub="ไม่รวม EQA" href={registryHref({sort:"desc"})}/>
   <Kpi label="ออกผล 14 วัน" value={sum("released")} sub="รวมผลจากระบบเดิม" href="/results"/>
   <Kpi label="ยังไม่ออกผล" value={tat?.open} sub="Lab รับแล้ว · งานค้างทั้งหมด" href={late}/>
   <Kpi label="ใกล้ครบ TAT" value={tat?.dueSoon} sub={`เหลือ ≤ ${o?.policy.warnDaysLeft??2} วันทำการ`} href={late} tone="warn"/>
   <Kpi label="เกิน TAT" value={tat?.overdue} sub={`กำหนด ${limit} วันทำการ`} href={late} tone="bad"/>
   <Kpi label="Run ที่ยังไม่เสร็จ" value={o?.runs.total} unit="Run" sub="ยังไม่บันทึก Sequencing ครบ" href="/lab/batches"/>
  </ul>
  {stages.length?<nav className="lab-signs" aria-label="งานของ Lab ตามขั้นตอน"><ol>{stages.map(s=><li key={s.key}><Link href={s.href} className={"lab-sign"+(s.hot?" hot":"")+(s.n?"":" quiet")}>
   <span className="lab-sign-to"><strong>{s.label}</strong>{s.parts.length?<small>{s.parts.map(p=>`${p.label} ${p.n}`).join(" · ")}</small>:null}</span>
   <span className="lab-sign-n num" aria-label={s.n===null?"อ่านจำนวนไม่ได้":`${s.n} รายการ`}>{s.n===null?"—":s.n}</span>
   <span className="lab-sign-go"><span>{s.go}</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d={ARROW}/></svg></span>
  </Link></li>)}</ol></nav>:<p className="empty-state">บัญชีนี้ยังไม่มีสิทธิ์เปิดคิวงานของ Lab</p>}
  {o&&<div className="dash-stat-grid">
   <section className="panel dash-panel" aria-labelledby="ld-flow"><header className="dash-panel-head"><h2 id="ld-flow">ตัวอย่างที่ยังไม่ออกผล อยู่ขั้นไหน</h2><p className="dash-panel-note">{o.tat.open} ราย · สีบอกสถานะเทียบกำหนด {limit} วันทำการ · กดแถวเพื่อไปหน้าที่ทำงานขั้นนั้น</p></header>
    <LinkBars title="ตัวอย่างค้างตามขั้น" unit="ราย" empty="ไม่มีตัวอย่างที่รอออกผล" parts={[{name:"ภายในกำหนด",tone:"good"},{name:`ใกล้ครบ (≤ ${o.policy.warnDaysLeft} วัน)`,tone:"warn"},{name:"เกินกำหนด",tone:"bad"}]}
     rows={o.stats.openByStage.map(r=>({label:STAGE[r.stage].label,values:[r.ok,r.dueSoon,r.overdue],href:STAGE[r.stage].href,tone:r.overdue?"bad" as const:r.dueSoon?"warn" as const:undefined}))}/></section>
   <section className="panel dash-panel" aria-labelledby="ld-aging"><header className="dash-panel-head"><h2 id="ld-aging">งานค้างรอมานานแค่ไหน</h2><p className="dash-panel-note">ตัวอย่างที่ยังไม่ออกผล แยกตามวันทำการที่ใช้ไปตั้งแต่ Lab รับ · เส้นประคือกำหนด {limit} วันทำการ</p></header>
    <Columns title="อายุของงานค้าง" mode="stack" parts={[{name:"ภายในกำหนด",tone:"good"},{name:`ใกล้ครบ (≤ ${o.policy.warnDaysLeft} วัน)`,tone:"warn"},{name:"เกินกำหนด",tone:"bad"}]}
     items={o.aging.map((b,i,all)=>({label:i===all.length-1?`${b.days}+`:String(b.days),long:`ใช้ไป ${b.days}${i===all.length-1?" วันทำการขึ้นไป":" วันทำการ"}`,values:[b.ok,b.dueSoon,b.overdue]}))}
     limit={{at:limit,label:`กำหนด ${limit} วัน`}} axisNote="แกนนอน = วันทำการตั้งแต่ Lab รับตัวอย่าง (ไม่นับเสาร์-อาทิตย์และวันหยุด)" empty="ไม่มีตัวอย่างที่รอออกผล"/></section>
   <section className="panel dash-panel" aria-labelledby="ld-recent"><header className="dash-panel-head"><h2 id="ld-recent">รับตัวอย่างเทียบออกผล 14 วัน</h2><p className="dash-panel-note">ถ้ารับมากกว่าออกผลต่อเนื่อง งานค้างจะเพิ่ม · ภาพรายเดือนอยู่ในแท็บสถิติ</p></header>
    <Columns title="รับตัวอย่างและออกผลรายวัน" mode="group" parts={[{name:"รับตัวอย่าง",tone:"s1"},{name:"ออกผล",tone:"s2"}]} items={o.recent.map(d=>({label:String(Number(d.day.slice(8,10))),long:dayLong(d.day),values:[d.received,d.released]}))} axisNote="แกนนอน = วันที่ของเดือน" empty="ไม่มีการรับตัวอย่างหรือออกผลใน 14 วันนี้"/></section>
   <section className="panel dash-panel" aria-labelledby="ld-runs"><header className="dash-panel-head"><h2 id="ld-runs">Run ที่ยังไม่เสร็จ</h2><p className="dash-panel-note">{o.runs.total} Run · แยกตามขั้นที่บันทึกล่าสุด</p><Link className="button secondary" href="/lab/batches">ไป Batch / Task List</Link></header>
    <LinkBars title="Run ตามขั้นล่าสุด" unit="Run" empty="ไม่มี Run ที่กำลังทำ" parts={[{name:"Run",tone:"s1"}]} rows={byStep.map(s=>({label:s.text,values:[s.n],href:"/lab/batches"}))}/></section>
  </div>}
 </div>;
 return <div className="lab-workload">
  <header className="page-header"><div><h1>Dashboard</h1><p className="page-meta">Lab · ข้อมูล ณ <time dateTime={generatedAt}>{new Date(generatedAt).toLocaleString("th-TH",{timeZone:"Asia/Bangkok",dateStyle:"full",timeStyle:"short"})} น.</time> · ตัวเลขมาจากคิวของแต่ละหน้าโดยตรง</p></div><Link className="button secondary" href="/cases">เปิดทะเบียนกลาง</Link></header>
  <HomeTabs label="มุมมองหน้าแรก Lab" tabs={[{id:"overview",label:"Dashboard",content:dashboard},...(o?[{id:"stats",label:"สถิติ",content:<LabStats data={o}/>}]:[])]}/>
 </div>;
}
