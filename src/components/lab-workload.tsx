import Link from "next/link";
import "./shared/console.css";
import "./lab-workload.css";
import {LabIcon} from "./shared/lab-icons";
import {LabOverviewPanels} from "./dashboard/lab-overview";
import {LabStats} from "./dashboard/lab-stats";
import {HomeTabs} from "./dashboard/home-tabs";
import type {LabOverview} from "../../packages/lab/overview";

/** One stage of today's Lab work. `n` is an existing queue count (no new counting rule); null = the queue could not be read. */
export type WorkloadStage={key:string;href:string;label:string;n:number|null;parts:{label:string;n:number}[];go:string;hot?:boolean};
const ARROW="M5 12h14M13 6l6 6-6 6";

/**
 * สรุปงานวันนี้ (Owner 2026-11-08, dashboard 2026-11-11). Top: what needs attention (TAT, GA over 18 weeks, missing LN Halos) as links to their
 * panels. Then the work in order, left to right, each stage a sign to the page that owns the queue. Then TAT, GA, Runs and six months of quality.
 * Links and read-only counts only: no new step, no new data entry.
 */
export function LabWorkload({stages,generatedAt,alerts,overview}:{stages:WorkloadStage[];generatedAt:string;alerts:{text:string;href:string}[];overview?:LabOverview|null}){
 const attention:{href:string;text:string;n:number;tone:"bad"|"warn"}[]=overview?[
  {href:"#tat",text:"เกินกำหนด TAT",n:overview.tat.overdue,tone:"bad" as const},
  {href:"#tat",text:`ใกล้ครบกำหนด (เหลือ ≤ ${overview.policy.warnDaysLeft} วันทำการ)`,n:overview.tat.dueSoon,tone:"warn" as const},
  {href:"#ga18",text:"GA เกิน 18 สัปดาห์",n:overview.gaOver18.count,tone:"bad" as const},
 ].filter(a=>a.n>0):[];
 return <div className="lab-workload">
  <header className="page-header"><div><h1>สรุปงานวันนี้</h1><p className="page-meta">ข้อมูล ณ <time dateTime={generatedAt}>{new Date(generatedAt).toLocaleString("th-TH",{timeZone:"Asia/Bangkok",dateStyle:"full",timeStyle:"short"})} น.</time> · ตัวเลขมาจากคิวของแต่ละหน้าโดยตรง</p></div><Link className="button secondary" href="/cases">เปิดทะเบียนกลาง</Link></header>
  <HomeTabs label="มุมมองหน้าแรก Lab" tabs={[{id:"overview",label:"ภาพรวม",content:<>
  {(attention.length>0||alerts.length>0||overview===null)&&<nav aria-label="รายการเตือน"><ul className="dash-attention">
   {attention.map(a=><li key={a.text}><Link href={a.href} className={a.tone}><LabIcon name="alert" size={18}/>{a.text} <span className="n">{a.n}</span></Link></li>)}
   {alerts.map(a=><li key={a.href+a.text}><Link href={a.href} className="warn"><LabIcon name="info" size={18}/>{a.text}</Link></li>)}
   {overview===null&&<li><span className="dash-note warn"><LabIcon name="info" size={18}/>อ่านข้อมูล TAT / GA / สถิติไม่ได้ในขณะนี้ — คิวงานด้านล่างยังใช้ได้ <Link href="/">โหลดใหม่</Link></span></li>}
  </ul></nav>}
  {stages.length?<nav className="lab-signs" aria-label="งานของ Lab ตามขั้นตอน"><ol>{stages.map(s=><li key={s.key}><Link href={s.href} className={"lab-sign"+(s.hot?" hot":"")+(s.n?"":" quiet")}>
   <span className="lab-sign-to"><strong>{s.label}</strong>{s.parts.length?<small>{s.parts.map(p=>`${p.label} ${p.n}`).join(" · ")}</small>:null}</span>
   <span className="lab-sign-n num" aria-label={s.n===null?"อ่านจำนวนไม่ได้":`${s.n} รายการ`}>{s.n===null?"—":s.n}</span>
   <span className="lab-sign-go"><span>{s.go}</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d={ARROW}/></svg></span>
  </Link></li>)}</ol></nav>:<p className="empty-state">บัญชีนี้ยังไม่มีสิทธิ์เปิดคิวงานของ Lab</p>}
  {overview&&<LabOverviewPanels data={overview}/>}
  </>},...(overview?[{id:"stats",label:"สถิติการส่งตรวจ",content:<LabStats data={overview}/>}]:[])]}/>
 </div>;
}
