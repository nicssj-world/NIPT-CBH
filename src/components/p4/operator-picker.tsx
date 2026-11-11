"use client";
import {useEffect,useId,useRef,useState} from "react";
import "./operator-picker.css";

/** Owner 2026-11-11: every Lab operator field (Task List 1–3, QC, Pooling, Sequencing) is chosen from the active Lab people, shown by first name only;
 *  several can be chosen, and the field keeps their Initial Names joined by " / " (e.g. "SJ / SC") — the text the worksheet and its PDF print. */
type Operator={id:string;firstName:string;initialName:string|null};
let cache:Promise<Operator[]>|null=null;
function loadOperators(){
 cache??=fetch("/api/p4/operators",{cache:"no-store"}).then(async r=>{if(!r.ok)throw Error("OPERATORS_UNAVAILABLE");return ((await r.json()) as {operators:Operator[]}).operators;}).catch(e=>{cache=null;throw e;});
 return cache;
}
const split=(value:string)=>value.split("/").map(s=>s.trim()).filter(Boolean);
const join=(items:string[])=>[...new Set(items)].join(" / ");

export function OperatorPicker({id,value,onChange,disabled=false,label="ผู้ปฏิบัติงาน",labelledBy}:{id:string;value:string;onChange:(value:string)=>void;disabled?:boolean;label?:string;labelledBy?:string}){
 const [open,setOpen]=useState(false),[operators,setOperators]=useState<Operator[]|null>(null),[error,setError]=useState("");
 const wrap=useRef<HTMLDivElement>(null),trigger=useRef<HTMLButtonElement>(null),panelId=useId();
 const chosen=split(value);
 useEffect(()=>{if(!open||operators)return;let live=true;loadOperators().then(o=>{if(live)setOperators(o);}).catch(()=>{if(live)setError("โหลดรายชื่อผู้ปฏิบัติงานไม่สำเร็จ");});return()=>{live=false;};},[open,operators]);
 useEffect(()=>{if(!open)return;
  const outside=(e:PointerEvent)=>{if(!wrap.current?.contains(e.target as Node))setOpen(false);};
  const key=(e:KeyboardEvent)=>{if(e.key==="Escape"){e.stopPropagation();setOpen(false);trigger.current?.focus();}};
  document.addEventListener("pointerdown",outside);wrap.current?.addEventListener("keydown",key);const node=wrap.current;
  return()=>{document.removeEventListener("pointerdown",outside);node?.removeEventListener("keydown",key);};},[open]);
 const known=new Set((operators??[]).map(o=>o.initialName).filter((v):v is string=>!!v));
 // A value typed before this rule (not an Initial Name) stays visible and can be unticked; it is never silently dropped.
 const legacy=operators?chosen.filter(c=>!known.has(c)):[];
 const toggle=(item:string,on:boolean)=>onChange(join(on?[...chosen,item]:chosen.filter(c=>c!==item)));
 return <div className="operator-picker" ref={wrap}>
  <button ref={trigger} id={id} type="button" className="operator-picker-trigger" disabled={disabled} aria-labelledby={labelledBy?`${labelledBy} ${id}`:undefined} aria-expanded={open} aria-controls={panelId} onClick={()=>setOpen(o=>!o)}>
   <span className={value?"mono":"muted"}>{value||"เลือกผู้ปฏิบัติงาน"}</span><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
  </button>
  {open&&<div id={panelId} className="operator-picker-panel" role="group" aria-label={`เลือก${label} (เลือกได้หลายคน)`}>
   {error?<p role="alert" className="notice">{error}</p>:!operators?<p role="status" className="muted">กำลังโหลด…</p>:<ul>
    {legacy.map(item=><li key={"legacy:"+item}><label><input type="checkbox" checked onChange={()=>toggle(item,false)}/><span>{item}</span><small className="muted">ค่าเดิม</small></label></li>)}
    {operators.map(o=><li key={o.id}><label className={o.initialName?undefined:"operator-picker-off"}>
     <input type="checkbox" disabled={!o.initialName} checked={!!o.initialName&&chosen.includes(o.initialName)} onChange={e=>o.initialName&&toggle(o.initialName,e.target.checked)}/>
     <span>{o.firstName}</span><small className={o.initialName?"mono":"muted"}>{o.initialName??"ยังไม่ตั้ง Initial Name"}</small></label></li>)}
    {!operators.length&&!legacy.length&&<li className="muted">ยังไม่มีผู้ใช้บทบาท Lab</li>}
   </ul>}
   <div className="operator-picker-foot">{value&&<button type="button" className="button small secondary" onClick={()=>onChange("")}>ล้าง</button>}<button type="button" className="button small" onClick={()=>{setOpen(false);trigger.current?.focus();}}>เสร็จ</button></div>
  </div>}
 </div>;
}
