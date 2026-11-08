"use client";
import Link from "next/link";
import {LabIcon,type LabIconName} from "../shared/lab-icons";
import {STEP_ORDER,stepText,type StepKey,type StepStatus} from "./bench-progress";
import "./batch-stepper.css";

const META:Record<StepKey,{label:string;icon:LabIconName;path:string}>={
 TASK:{label:"Task List",icon:"list",path:""},
 QC:{label:"QC Measurements",icon:"flask",path:"/bench"},
 POOL:{label:"Pooling",icon:"layers",path:"/pooling"},
 SEQ:{label:"Sequencing",icon:"dna",path:"/sequencing"},
};
/** Full step names stay reachable (tooltip) because the older buttons used the longer wording. */
const FULL:Record<StepKey,string>={TASK:"Task List 1–3 (จัดตัวอย่างลงตำแหน่ง)",QC:"QC Measurements",POOL:"Pooling / QC2 / F4",SEQ:"DNB / Sequencing / F5"};

/**
 * Four-step header of a Run (Owner 2026-11-09, extends OWNER-LAB-041): where you are, which steps are done, and the progress of each.
 * On the bench page the three bench steps switch in place (`onSelect`), everything else is an ordinary link.
 */
export function BatchStepper({batchId,current,status,onSelect}:{batchId:string;current:StepKey;status:Record<StepKey,StepStatus>;onSelect?:(key:Exclude<StepKey,"TASK">)=>void}){
 return <ol className="run-steps" aria-label="ขั้นตอนของ Run">{STEP_ORDER.map((key,i)=>{
  const m=META[key],s=status[key],active=key===current,done=s.done&&s.known;
  const sid=`run-step-${batchId}-${key}`;
  const body=<><span className="run-step-icon"><LabIcon name={done&&!active?"check":m.icon} size={22}/></span>
   <span className="run-step-text"><small>ขั้นที่ {i+1}</small><strong>{m.label}</strong><small id={sid}>{stepText(s,active,key)}</small></span></>;
  const cls=`run-step${active?" active":""}${done?" done":""}${s.known?"":" unknown"}`;
  return <li key={key}>{onSelect&&key!=="TASK"
   ?<button type="button" className={cls} title={FULL[key]} aria-label={m.label} aria-describedby={sid} aria-current={active?"step":undefined} onClick={()=>onSelect(key)}>{body}</button>
   :<Link className={cls} title={FULL[key]} aria-label={m.label} aria-describedby={sid} aria-current={active?"step":undefined} href={`/lab/batches/${batchId}${m.path}`}>{body}</Link>}</li>;})}</ol>;
}
