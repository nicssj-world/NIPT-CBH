import Link from "next/link";
import {LAB_STEP_NAMES,STEPS,stepStates,type Progress} from "./anc-progress";

/** Hand-drawn 24px stroke icons, one weight (no glyphs or emoji standing in for an icon system). */
const PATHS:Record<string,string>={
 waiting:"M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0",
 received:"M9 3h6M10 3v13a2 2 0 0 0 4 0V3M10 11h4",
 testing:"M9 3h6M10 3v6L5 18a2 2 0 0 0 1.8 3h10.4a2 2 0 0 0 1.8-3L14 9V3M7.5 15h9",
 done:"M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0M8 12l3 3 5-6",
 warn:"M3 12a9 9 0 1 0 3-6.7M3 4v5h5",
 stop:"M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0M10 9v6M14 9v6",
 check:"M12 3 2 20h20L12 3zM12 10v4M12 17h.01",
 alert:"M12 3 2 20h20L12 3zM12 10v4M12 17h.01",
 redo:"M3 12a9 9 0 1 0 3-6.7M3 4v5h5",
 all:"M4 6h16M4 12h16M4 18h10",
};
export function Icon({name,className="ui-icon"}:{name:keyof typeof PATHS|string;className?:string}){
 return <span className={className} aria-hidden="true"><svg viewBox="0 0 24 24"><path d={PATHS[name]??PATHS.check}/></svg></span>;
}

/** People-language progress: one badge, an optional "เจาะเลือดครั้งที่ N" chip, the reason, and the three-step track. */
export function ProgressView({progress,round,extra}:{progress:Progress;round?:number|null;extra?:React.ReactNode}){
 const steps=stepStates(progress),lab=progress.labSteps;
 return <div className="progress-cell">
  <span className="progress-row"><span className={"progress-badge tone-"+progress.tone}><Icon name={progress.tone}/>{progress.label}</span>
   {round&&round>=2?<span className="round-chip"><Icon name="redo"/>เจาะเลือดครั้งที่ {round}</span>:null}{extra}</span>
  {progress.reason&&<span className="progress-reason">{progress.reason}</span>}
  <span className="progress-track" aria-hidden="true">{STEPS.map((s,i)=>i===1&&typeof lab==="number"&&progress.tone==="testing"
   ?<span key={s} className="lab-steps now"><span className="lab-bars">{LAB_STEP_NAMES.map((n,k)=><i key={n} className={k<lab?"done":k===lab?"now":undefined}/>)}</span>{s}</span>
   :<span key={s} className={steps[i]||undefined}>{s}</span>)}</span>
  {typeof lab==="number"&&progress.tone==="testing"&&<span className="progress-note">{lab>=LAB_STEP_NAMES.length?"ห้อง Lab ตรวจครบทุกขั้นตอนแล้ว รอทวนผลและรับรอง":`ขั้นตอนในห้อง Lab ${lab+1}/${LAB_STEP_NAMES.length}: ${LAB_STEP_NAMES[lab]}`}</span>}
 </div>;
}

/** Owner Change 21: GA > 18+0 → red, warning icon only (the words "เกิน 18 สัปดาห์" removed, Owner 2026-11-10); 18+0 itself is not over. Unknown GA is stated, never guessed. */
export function GaText({ga}:{ga?:{weeks:number;days:number;over18:boolean}|null}){
 if(!ga)return <span className="muted">ยังไม่มีข้อมูล</span>;
 const t=`${ga.weeks} สัปดาห์ ${ga.days} วัน`;
 return ga.over18?<span className="ga-over"><Icon name="alert"/><span className="num">{t}</span></span>:<span className="num">{t}</span>;
}

/** The nurse's own next step, drawn as a wayfinding sign. Empty when nothing is pending (Owner: no "nothing to do" text). */
export function TodoSign({todo,caseId,ln}:{todo:string;caseId:string;ln?:string}){return todo?<Link className="next-sign" href={`/cases/${caseId}`} aria-label={ln?`${todo} · เปิดเคส LN ${ln}`:`${todo} · เปิดเคส`}>{todo}</Link>:null;}
