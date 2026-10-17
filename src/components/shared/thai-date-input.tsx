"use client";
import {useEffect,useId,useRef,useState,type KeyboardEvent} from "react";
import {parseBeInput,formatBe,bangkokIsoDay,BE_OFFSET,THAI_MONTH_LONG} from "../../../packages/domain/thai-date";

// Owner decision (Plan Rev 3.4 §7): every user-facing date input is Thai Buddhist Era. Native <input type=date> shows
// the browser/OS calendar (CE in Chrome/Edge/Safari) and silently accepts 2569 as CE, so it is not used for BE fields.
// The component emits ISO CE (`YYYY-MM-DD`) or "" so API contracts and identifier logic stay Gregorian.
const ERROR:Record<string,string>={FORMAT:"กรอกเป็น วว/ดด/ปปปป เช่น 17/10/2569",USE_BE_YEAR:"ใช้ปี พ.ศ. 4 หลัก เช่น 2569 (ไม่ใช่ ค.ศ.)",INVALID_DATE:"วันที่นี้ไม่มีอยู่จริงในปฏิทิน",REQUIRED:"กรุณากรอกวันที่"};
const WEEKDAYS=["อา","จ","อ","พ","พฤ","ศ","ส"];
const pad=(n:number)=>String(n).padStart(2,"0");
const iso=(y:number,m:number,d:number)=>`${y}-${pad(m)}-${pad(d)}`;
const daysIn=(y:number,m:number)=>new Date(Date.UTC(y,m,0)).getUTCDate();
const shift=(value:string,days:number)=>{const d=new Date(value+"T00:00:00Z");d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);};
const shiftMonth=(value:string,months:number)=>{const [y,m,d]=value.split("-").map(Number);const t=new Date(Date.UTC(y,m-1+months,1));const ny=t.getUTCFullYear(),nm=t.getUTCMonth()+1;return iso(ny,nm,Math.min(d,daysIn(ny,nm)));};
const safeFormat=(value:string)=>{try{return value?formatBe(value):"";}catch{return value;}};

export type ThaiDateInputProps={id?:string;value:string|null|undefined;onChange:(iso:string)=>void;required?:boolean;disabled?:boolean;
 "aria-describedby"?:string;"aria-invalid"?:boolean;"aria-required"?:boolean;"aria-label"?:string;name?:string};

export function ThaiDateInput({id,value,onChange,required,disabled,name,...aria}:ThaiDateInputProps){
 const auto=useId(),inputId=id??auto,hintId=inputId+"-be-hint",errorId=inputId+"-be-error";
 const [text,setText]=useState(()=>safeFormat(value??"")),[error,setError]=useState(""),[open,setOpen]=useState(false);
 // `seen` = the last ISO value this input emitted or received. External changes (reload, reset) replace the text;
 // our own emissions are already in `seen`, so they never reformat what the user is typing.
 const [seen,setSeen]=useState(value??"");
 if((value??"")!==seen){setSeen(value??"");setText(safeFormat(value??""));setError("");}
 const emit=(v:string)=>{setSeen(v);onChange(v);};
 const commit=(raw:string)=>{
  if(!raw.trim()){setError(required?ERROR.REQUIRED:"");emit("");return;}
  const r=parseBeInput(raw);
  if(r.ok){setError("");setText(formatBe(r.iso));emit(r.iso);}else{setError(ERROR[r.code]??ERROR.FORMAT);emit("");}
 };
 const describedBy=[aria["aria-describedby"],hintId,error?errorId:""].filter(Boolean).join(" ");
 return <div className="be-date">
  <div className="be-date-row">
   <input id={inputId} name={name} type="text" inputMode="numeric" autoComplete="off" placeholder="วว/ดด/ปปปป" maxLength={10} value={text} disabled={disabled}
    aria-label={aria["aria-label"]} aria-describedby={describedBy} aria-invalid={error?true:aria["aria-invalid"]} aria-required={required||aria["aria-required"]||undefined}
    onChange={e=>{const t=e.target.value.replace(/[^\d/.-]/g,"");setText(t);const r=parseBeInput(t);if(r.ok){setError("");emit(r.iso);}else if(seen!==""&&!t.trim())emit("");}}
    onBlur={e=>commit(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")commit((e.target as HTMLInputElement).value);}}/>
   <button className="button secondary be-date-open" type="button" disabled={disabled} aria-label="เลือกวันที่จากปฏิทิน (พ.ศ.)" aria-haspopup="dialog" onClick={()=>setOpen(true)}>ปฏิทิน</button>
  </div>
  <p id={hintId} className="help small">วว/ดด/ปปปป (พ.ศ.)</p>
  {error&&<p id={errorId} className="field-error" role="alert">{error}</p>}
  {open&&<BeCalendar initial={seen||bangkokIsoDay()} selected={seen} onClose={()=>setOpen(false)} onPick={v=>{setText(formatBe(v));setError("");emit(v);setOpen(false);}}/>}
 </div>;
}

/** WAI-ARIA date picker dialog: grid of days, arrows/PageUp/PageDown/Home/End, Enter selects, Esc closes. BE month/year headings. */
function BeCalendar({initial,selected,onClose,onPick}:{initial:string;selected:string;onClose:()=>void;onPick:(iso:string)=>void}){
 const ref=useRef<HTMLDialogElement>(null),grid=useRef<HTMLTableElement>(null),titleId=useId();
 const [focus,setFocus]=useState(initial);
 const [y,m]=focus.split("-").map(Number);
 useEffect(()=>{const opener=document.activeElement as HTMLElement|null;ref.current?.showModal();return()=>{opener?.focus();};},[]);
 useEffect(()=>{grid.current?.querySelector<HTMLButtonElement>(`[data-iso="${focus}"]`)?.focus();},[focus]);
 const first=new Date(Date.UTC(y,m-1,1)).getUTCDay(),total=daysIn(y,m),today=bangkokIsoDay();
 const cells:(number|null)[]=[...Array(first).fill(null),...Array.from({length:total},(_,i)=>i+1)];while(cells.length%7)cells.push(null);
 const weeks=Array.from({length:cells.length/7},(_,w)=>cells.slice(w*7,w*7+7));
 const key=(e:KeyboardEvent<HTMLTableElement>)=>{
  const dow=new Date(focus+"T00:00:00Z").getUTCDay();
  const next:Record<string,()=>string>={ArrowLeft:()=>shift(focus,-1),ArrowRight:()=>shift(focus,1),ArrowUp:()=>shift(focus,-7),ArrowDown:()=>shift(focus,7),
   PageUp:()=>shiftMonth(focus,e.shiftKey?-12:-1),PageDown:()=>shiftMonth(focus,e.shiftKey?12:1),Home:()=>shift(focus,-dow),End:()=>shift(focus,6-dow)};
  if(next[e.key]){e.preventDefault();setFocus(next[e.key]());}
 };
 const beYear=y+BE_OFFSET,years=Array.from({length:131},(_,i)=>beYear-100+i);
 return <dialog ref={ref} className="p2-dialog be-calendar" aria-labelledby={titleId} onCancel={e=>{e.preventDefault();onClose();}}>
  <header className="dialog-header"><h2 id={titleId} aria-live="polite">{THAI_MONTH_LONG[m-1]} {beYear}</h2><button className="button secondary" type="button" onClick={onClose}>ปิด</button></header>
  <div className="be-calendar-nav">
   <button className="button secondary" type="button" onClick={()=>setFocus(shiftMonth(focus,-1))} aria-label="เดือนก่อนหน้า">‹</button>
   <label className="sr-only" htmlFor={titleId+"-m"}>เดือน</label>
   <select id={titleId+"-m"} value={m} onChange={e=>setFocus(iso(y,Number(e.target.value),Math.min(Number(focus.slice(8)),daysIn(y,Number(e.target.value)))))}>{THAI_MONTH_LONG.map((n,i)=><option key={n} value={i+1}>{n}</option>)}</select>
   <label className="sr-only" htmlFor={titleId+"-y"}>ปี พ.ศ.</label>
   <select id={titleId+"-y"} value={beYear} onChange={e=>{const ny=Number(e.target.value)-BE_OFFSET;setFocus(iso(ny,m,Math.min(Number(focus.slice(8)),daysIn(ny,m))));}}>{years.map(v=><option key={v} value={v}>{v}</option>)}</select>
   <button className="button secondary" type="button" onClick={()=>setFocus(shiftMonth(focus,1))} aria-label="เดือนถัดไป">›</button>
  </div>
  <table ref={grid} role="grid" className="be-calendar-grid" aria-labelledby={titleId} onKeyDown={key}>
   <thead><tr>{WEEKDAYS.map(d=><th key={d} scope="col" abbr={d}>{d}</th>)}</tr></thead>
   <tbody>{weeks.map((w,i)=><tr key={i}>{w.map((d,j)=>{if(d===null)return <td key={j}/>;const v=iso(y,m,d);
    return <td key={j}><button type="button" data-iso={v} tabIndex={v===focus?0:-1} aria-pressed={v===selected} aria-current={v===today?"date":undefined} aria-label={`${d} ${THAI_MONTH_LONG[m-1]} ${beYear}`}
     className={v===selected?"selected":undefined} onClick={()=>onPick(v)}>{d}</button></td>;})}</tr>)}</tbody>
  </table>
  <p className="help small">ลูกศรเลื่อนวัน · Page Up/Down เลื่อนเดือน · Enter เลือก · Esc ปิด</p>
 </dialog>;
}
