import Link from "next/link";
import "./shared/console.css";
import "./lab-workload.css";

/** One stage of today's Lab work. `n` is an existing queue count (no new counting rule); null = the queue could not be read. */
export type WorkloadStage={key:string;href:string;label:string;n:number|null;parts:{label:string;n:number}[];go:string;hot?:boolean};
const ARROW="M5 12h14M13 6l6 6-6 6";

/**
 * สรุปงานวันนี้ (Owner 2026-11-08): replaces the QuickActions cards on the Lab overview. Each sign is a link to the page that already
 * owns that queue, with that queue's own count and the Thai tab names that page uses. Links only: no new step, no new data.
 */
export function LabWorkload({stages,generatedAt,alerts}:{stages:WorkloadStage[];generatedAt:string;alerts:{text:string;href:string}[]}){
 return <div className="lab-workload">
  <header className="page-header"><div><h1>สรุปงานวันนี้</h1><p className="page-meta">ข้อมูล ณ <time dateTime={generatedAt}>{new Date(generatedAt).toLocaleString("th-TH",{timeZone:"Asia/Bangkok",dateStyle:"full",timeStyle:"short"})} น.</time> · ตัวเลขมาจากคิวของแต่ละหน้าโดยตรง</p></div><Link className="button secondary" href="/cases">เปิดทะเบียนกลาง</Link></header>
  {alerts.map(a=><p key={a.href+a.text} className="lab-alert" role="status"><span>{a.text}</span><Link href={a.href}>ดูรายการ</Link></p>)}
  {stages.length?<nav className="lab-signs" aria-label="งานของ Lab ตามขั้นตอน">{stages.map(s=><Link key={s.key} href={s.href} className={"lab-sign"+(s.hot?" hot":"")+(s.n?"":" quiet")}>
   <span className="lab-sign-to"><strong>{s.label}</strong>{s.parts.length?<small>{s.parts.map(p=>`${p.label} ${p.n}`).join(" · ")}</small>:null}</span>
   <span className="lab-sign-n num" aria-label={s.n===null?"อ่านจำนวนไม่ได้":`${s.n} รายการ`}>{s.n===null?"—":s.n}</span>
   <span className="lab-sign-go"><span>{s.go}</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d={ARROW}/></svg></span>
  </Link>)}</nav>:<p className="empty-state">บัญชีนี้ยังไม่มีสิทธิ์เปิดคิวงานของ Lab</p>}
 </div>;
}
