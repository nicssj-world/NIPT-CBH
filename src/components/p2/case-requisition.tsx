"use client";
import {useId,useRef,useState,type KeyboardEvent,type ReactNode} from "react";
import {LabIcon} from "../shared/lab-icons";
import {sections,historyFacts} from "./request-form";
import {historyAnswers} from "./request-history-contract";
import {calculations,type RequestDraft} from "../../../packages/p2/schema";
import {registryGa} from "../../../packages/lab/registry-ga";
import {displayBe} from "../../../packages/domain/thai-date";
import type {CaseData,Doctor} from "./shared";
import "./case-requisition.css";

/**
 * "ข้อมูลจากใบส่งตรวจ" on the case page (Owner 2026-11-12): request-form categories 1–3, read-only, one tab per category.
 * Fields the HIS section already shows (name, date of birth, age, collection date/time) are left out. Empty → "ไม่มีข้อมูล".
 * Source: the confirmed request of the current round when there is one, otherwise the working draft (Lab paper metadata lands there).
 * Layout by kind of data: measurements as figures, people and places as a fact list, the medical history as answered questions.
 */
const EMPTY="ไม่มีข้อมูล";
type Tone="good"|"warn"|"bad"|undefined;
type Fact={label:string;value:ReactNode;mono?:boolean;wide?:boolean};
type Figure={label:string;value:string|null;unit?:string;tone?:Tone;note?:string|null};
type Answer={n:number;label:string;value:string|null;stop:boolean;detail?:string|null};
const blank=(v:unknown)=>v===null||v===undefined||v===false||(typeof v==="string"&&!v.trim());
const text=(v:unknown):string|null=>blank(v)?null:String(v);
const yesNo=(v:unknown)=>v==="Yes"?"ใช่":v==="No"?"ไม่ใช่":v==="Unknown"?"ไม่ทราบ":null;
const date=(v:unknown)=>blank(v)?null:displayBe(String(v));
const fixed=(v:unknown,digits=1)=>typeof v==="number"&&Number.isFinite(v)?v.toLocaleString("th-TH",{maximumFractionDigits:digits}):null;
const thaiId=(v:string|null)=>v&&/^\d{13}$/.test(v)?`${v[0]}-${v.slice(1,5)}-${v.slice(5,10)}-${v.slice(10,12)}-${v[12]}`:v;
const ENTITLEMENT:Record<string,string>={NHSO:"สปสช.",SELF_PAY:"ชำระเงินเอง"};
const PREGNANCY:Record<string,string>={Singleton:"ครรภ์เดี่ยว",Twins:"ครรภ์แฝด",Unknown:"ยังไม่ทราบ"};

function requestSource(data:CaseData){
 const confirmed=data.revisions.find(r=>r.kind==="REQUEST"&&(r.payload.identity as {roundId?:string}|undefined)?.roundId===data.case.current_round_id);
 const payload=confirmed?.payload as {draft?:RequestDraft;doctor?:{name?:string}|null}|undefined;
 return {draft:payload?.draft??data.workspace.draft,doctorName:payload?.doctor?.name??null,
  source:confirmed?`แบบขอส่งตรวจที่ยืนยันแล้ว ฉบับที่ ${confirmed.version}`:data.workspace.request_mode==="Paper"?"ข้อมูลที่บันทึกจากใบส่งตรวจกระดาษ":"ร่างแบบขอส่งตรวจ (ยังไม่ยืนยัน)"};
}

const Empty=()=> <span className="req-empty">{EMPTY}</span>;
/** National ID is masked by default; only the last 3 digits show until the eye button is pressed (Owner 2026-11-12). */
function maskId(v:string){const digits=v.replace(/\D/g,"");if(digits.length<4)return "x".repeat(v.length);
 const shown=thaiId(digits)??digits;let keep=3;return [...shown].reverse().map(ch=>/\d/.test(ch)?(keep-->0?ch:"x"):ch).reverse().join("");}
function NationalId({value}:{value:string}){
 const [open,setOpen]=useState(false);
 return <span className="req-id"><span className="req-mono">{open?thaiId(value):maskId(value)}</span>
  <button type="button" className="req-id-toggle" aria-pressed={open} aria-label={open?"ซ่อนเลขประจำตัวประชาชน":"แสดงเลขประจำตัวประชาชนเต็ม"} title={open?"ซ่อน":"แสดงเลขเต็ม"} onClick={()=>setOpen(v=>!v)}><LabIcon name={open?"x":"eye"} size={18}/></button></span>;
}
function Facts({items}:{items:Fact[]}){
 return <dl className="req-facts">{items.map(f=><div key={f.label} className={f.wide?"req-wide":undefined}><dt>{f.label}</dt><dd className={f.mono&&!blank(f.value)?"req-mono":undefined}>{blank(f.value)?<Empty/>:f.value}</dd></div>)}</dl>;
}
function Figures({items}:{items:Figure[]}){
 return <dl className="req-figures">{items.map(f=><div key={f.label} className={f.tone?`req-figure tone-${f.tone}`:"req-figure"}>
  <dt>{f.label}</dt>
  <dd>{f.value===null?<Empty/>:<><span className="req-figure-value">{f.tone==="warn"&&<LabIcon name="alert" size={18}/>}{f.value}</span>{f.unit&&<span className="req-figure-unit">{f.unit}</span>}</>}{f.note&&<small>{f.note}</small>}</dd>
 </div>)}</dl>;
}
function Group({title,span=false,children}:{title:string;span?:boolean;children:ReactNode}){
 return <div className={span?"req-group req-span":"req-group"}><h3>{title}</h3>{children}</div>;
}

export function CaseRequisition({data,doctors}:{data:CaseData;doctors:Doctor[]}){
 const base=useId(),[open,setOpen]=useState(0),refs=useRef<(HTMLButtonElement|null)[]>([]);
 const {draft,doctorName,source}=requestSource(data);
 const p=draft.patient,g=draft.pregnancy,h=draft.history,o=draft.ordering as RequestDraft["ordering"]&{coordinator?:string|null;phone?:string|null};
 // GA on the blood-draw date: the request's own draw date first, then the round receipt, then the HIS collection time (Bangkok date).
 const hisDraw=data.his?.specimenAt&&!Number.isNaN(Date.parse(data.his.specimenAt))?new Date(data.his.specimenAt).toLocaleDateString("en-CA",{timeZone:"Asia/Bangkok"}):null;
 const calc=calculations(draft),lab=calc.gaDays===null?registryGa(g.edd,data.roundReceipt.collectionDate??hisDraw):null;
 const gaDays=calc.gaDays??(lab?lab.weeks*7+lab.days:null);
 const doctor=doctors.find(d=>d.id===o.doctorVersionId)?.name??doctorName;

 // 1 · ผู้รับบริการและสถานพยาบาล
 const person:Fact[]=[{label:"เลขประจำตัวประชาชน",value:text(p.identifier)?<NationalId value={text(p.identifier)!}/>:null},{label:"สิทธิการตรวจ",value:p.entitlement?<span className="req-pill tone-info">{ENTITLEMENT[p.entitlement]??p.entitlement}</span>:null}];
 const body:Figure[]=[{label:"น้ำหนัก",value:fixed(g.weightKg),unit:"กก."},{label:"ส่วนสูง",value:fixed(g.heightCm),unit:"ซม."},
  {label:"BMI",value:calc.bmi===null?null:calc.bmi.toFixed(2),tone:calc.bmi!==null&&calc.bmi>40?"warn":undefined}];
 const ordering:Fact[]=[{label:"สถานพยาบาล",value:text(o.facility)},{label:"แพทย์ผู้สั่งตรวจ",value:doctor},
  {label:"ผู้ประสานงาน",value:text(o.coordinator)},{label:"โทรศัพท์ผู้ประสานงาน",value:text(o.phone),mono:true},{label:"เหตุผลส่งตรวจ",value:text(o.reason),wide:true}];
 // 2 · การตั้งครรภ์
 const pregnancy:Figure[]=[{label:"อายุครรภ์ (GA) ณ วันเจาะเลือด",value:gaDays===null?null:`${Math.floor(gaDays/7)}+${gaDays%7}`,unit:"สัปดาห์",tone:gaDays!==null&&gaDays>126?"warn":undefined},
  {label:"วันกำหนดคลอด",value:date(g.edd)},{label:"ประเภทครรภ์",value:g.type?PREGNANCY[g.type]??g.type:null}];
 const obstetric:Figure[]=[{label:"ตั้งครรภ์ (G)",value:text(g.gravida)},{label:"คลอด (P)",value:text(g.para)},{label:"แท้ง (A)",value:text(g.abortion)}];
 const pregnancyFacts:Fact[]=[{label:"วันอัลตราซาวนด์",value:date(g.ultrasoundDate)},{label:"ใช้เทคโนโลยีช่วยเจริญพันธุ์",value:yesNo(g.art)},{label:"พบภาวะที่ตัวอ่อนฝ่อขณะตั้งครรภ์",value:yesNo(g.vanishingTwin)},
  ...(g.vanishingTwin==="Yes"?[{label:"วันที่ตัวอ่อนฝ่อ",value:date(g.vanishingDate)},{label:"อายุครรภ์เมื่อตัวอ่อนฝ่อ",value:g.vanishingGaDays===null?null:`${g.vanishingGaDays} วัน`},{label:"เจาะเลือดหลังตัวอ่อนฝ่ออย่างน้อย 8 สัปดาห์",value:yesNo(g.drawEightWeeksAfterLoss)}]:[])];
 // 3 · ประวัติทางการแพทย์ — items 1–5 answered "ใช่" stop the test (request form rule); 6–8 are information.
 const strip=(label:string)=>label.replace(/^\d+\.\s*/,"");
 const history:Answer[]=[
  ...historyFacts.map(([k,label],i)=>({n:i+1,label:strip(label),value:yesNo((h as unknown as Record<string,{answer?:string|null}|undefined>)[k]?.answer),stop:true})),
  ...historyAnswers.slice(0,4).map(([k,label],i)=>({n:i+4,label:strip(label),value:yesNo((h as Record<string,unknown>)[k]),stop:i<2,
   detail:k==="tumor"&&h.tumor==="Yes"?text(h.tumorDetails):k==="priorChromosomeTest"&&h.priorChromosomeTest==="Yes"?[h.priorTestMethod&&`วิธี ${h.priorTestMethod}`,h.priorTestResult&&`ผล ${h.priorTestResult}`].filter(Boolean).join(" · ")||null:null})),
  {n:8,label:strip(historyAnswers[4][1]),value:h.otherHistory==="Yes"||text(h.otherDetails)?"ใช่":yesNo(h.otherHistory),stop:false,detail:text(h.otherDetails)},
 ];
 const yes=history.filter(a=>a.value==="ใช่"),stopYes=yes.some(a=>a.stop),answered=history.filter(a=>a.value!==null).length;

 const filled=(values:unknown[])=>`${values.filter(v=>!blank(v)).length}/${values.length}`;
 const tabs:{count:string;alert?:number;stop?:boolean}[]=[
  {count:filled([...person.map(f=>f.value),...body.map(f=>f.value),...ordering.map(f=>f.value)])},
  {count:filled([...pregnancy.map(f=>f.value),...obstetric.map(f=>f.value),...pregnancyFacts.map(f=>f.value)])},
  {count:`${answered}/${history.length}`,alert:yes.length,stop:stopYes},
 ];
 const choose=(i:number,focus=false)=>{setOpen(i);if(focus)refs.current[i]?.focus();};
 const onKey=(e:KeyboardEvent)=>{const n=tabs.length,to=e.key==="ArrowRight"?(open+1)%n:e.key==="ArrowLeft"?(open-1+n)%n:e.key==="Home"?0:e.key==="End"?n-1:-1;if(to>=0){e.preventDefault();choose(to,true);}};

 return <section className="panel case-requisition" aria-labelledby={`${base}-h`}>
  <h2 id={`${base}-h`}><span className="case-sec-icon" aria-hidden="true"><LabIcon name="list" size={22}/></span>ข้อมูลจากใบส่งตรวจ</h2>
  <p className="req-source">{source}</p>
  <div className="req-tabs" role="tablist" aria-label="หมวดใบส่งตรวจ" onKeyDown={onKey}>{tabs.map((t,i)=><button key={i} ref={el=>{refs.current[i]=el;}} type="button" role="tab" className="req-tab" id={`${base}-t${i}`} aria-selected={open===i} aria-controls={`${base}-p`} tabIndex={open===i?0:-1} onClick={()=>choose(i)}>
   <span className="req-tab-n" aria-hidden="true">{i+1}</span><span className="req-tab-label">{sections[i]}</span>
   {t.alert?<span className={t.stop?"req-tab-alert is-stop":"req-tab-alert"}>ใช่ {t.alert} ข้อ</span>:<span className="req-tab-count" aria-label={`มีข้อมูล ${t.count} ช่อง`}>{t.count}</span>}
  </button>)}</div>
  <div role="tabpanel" id={`${base}-p`} aria-labelledby={`${base}-t${open}`} tabIndex={0} className="req-panel">
   {open===0&&<div className="req-layout">
    <Group title="น้ำหนักและส่วนสูง"><Figures items={body}/></Group>
    <Group title="ผู้รับบริการ"><Facts items={person}/></Group>
    <Group title="ผู้ส่งตรวจ"><Facts items={ordering}/></Group>
   </div>}
   {open===1&&<div className="req-layout">
    <Group title="ครรภ์ปัจจุบัน"><Figures items={pregnancy}/></Group>
    <Group title="ประวัติการตั้งครรภ์"><Figures items={obstetric}/></Group>
    <Group title="ข้อมูลเพิ่มเติม" span><Facts items={pregnancyFacts}/></Group>
   </div>}
   {open===2&&<div className="req-history">
    <p className={`req-history-summary ${stopYes?"has-stop":yes.length?"has-note":""}`} role="status">{answered===0?"ยังไม่มีคำตอบในหมวดนี้":yes.length?`ตอบ “ใช่” ${yes.length} ข้อ: ข้อ ${yes.map(a=>a.n).join(", ")}${stopYes?" — มีข้อ 1–5 ที่ไม่สามารถส่งตรวจได้":""}`:"ไม่มีข้อที่ตอบ “ใช่”"}</p>
    <ol className="req-answers">{history.map(a=><li key={a.n} className={a.value==="ใช่"?a.stop?"is-stop":"is-note":undefined}>
     <span className="req-answer-n" aria-hidden="true">{a.n}</span>
     <span className="req-answer-q"><span className="sr-only">ข้อ {a.n} </span>{a.label}{a.detail&&<small>{a.detail}</small>}</span>
     <span className="req-answer-a">{a.value===null?<Empty/>:<span className={`req-pill ${a.value==="ใช่"?a.stop?"tone-bad":"tone-warn":a.value==="ไม่ใช่"?"tone-good":""}`}>{a.value}</span>}</span>
    </li>)}</ol>
    <p className="req-history-rule">ข้อ 1–5 หากตอบ “ใช่” จะไม่สามารถส่งตรวจได้ (ตามแบบขอส่งตรวจ)</p>
   </div>}
  </div>
 </section>;
}
