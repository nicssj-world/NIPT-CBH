"use client";
import {useEffect,useLayoutEffect,useId,useRef,useState,type ChangeEvent,type KeyboardEvent} from "react";
import {parseBeInput,parseBeDateTime,formatBe,formatBeWall,bangkokIsoDay,BE_OFFSET,THAI_MONTH_LONG} from "../../../packages/domain/thai-date";

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

export type ThaiDateInputProps={id?:string;value:string|null|undefined;onChange:(iso:string)=>void;onValidityChange?:(valid:boolean)=>void;required?:boolean;disabled?:boolean;
 "aria-describedby"?:string;"aria-invalid"?:boolean;"aria-required"?:boolean;"aria-label"?:string;name?:string;"data-field"?:string};

/** Invalid editing text never replaces the last ISO value. Only intentional clearing emits empty. */
function useDateDraft(value:string|null|undefined,onChange:(v:string)=>void,required:boolean|undefined,onValidityChange:((valid:boolean)=>void)|undefined,withTime=false){
 const format=(v:string)=>withTime?formatBeWall(v):safeFormat(v);
 const [text,setText]=useState(()=>format(value??"")),[error,setError]=useState(""),[seen,setSeen]=useState(value??"");
 const input=useRef<HTMLInputElement>(null),caret=useRef<{start:number;end:number}|null>(null),notify=useRef(onValidityChange);
 useLayoutEffect(()=>{notify.current=onValidityChange;},[onValidityChange]);
 if((value??"")!==seen){setSeen(value??"");setText(format(value??""));setError("");}
 const read=(raw:string)=>{if(withTime){const r=parseBeDateTime(raw);return r.ok?{value:r.wall,code:""}:{value:"",code:r.code};}const r=parseBeInput(raw);return r.ok?{value:r.iso,code:""}:{value:"",code:r.code};};
 const message=(code:string)=>code==='EMPTY'?(required?ERROR.REQUIRED:""):(withTime?DT_ERROR:ERROR)[code]??ERROR.FORMAT;
 const validate=(raw:string)=>{const r=read(raw);input.current?.setCustomValidity(r.value?"":message(r.code));notify.current?.(!!r.value||!raw.trim());return r;};
 useEffect(()=>{const raw=withTime?formatBeWall(value??""):safeFormat(value??"");const r=withTime?parseBeDateTime(raw):parseBeInput(raw);input.current?.setCustomValidity(r.ok?"":r.code==='EMPTY'?(required?ERROR.REQUIRED:""):ERROR.FORMAT);notify.current?.(r.ok||!raw.trim());},[value,required,withTime]);
 useLayoutEffect(()=>{if(caret.current&&input.current===document.activeElement){input.current?.setSelectionRange(caret.current.start,caret.current.end);}caret.current=null;},[text]);
 const emit=(v:string)=>{setSeen(v);onChange(v);};
 const change=(e:ChangeEvent<HTMLInputElement>)=>{const raw=e.target.value,clean=raw;
  const compact=withTime?/^\d{8}(?=$| )/.test(clean):/^\d{8}$/.test(clean),next=compact?clean.slice(0,2)+"/"+clean.slice(2,4)+"/"+clean.slice(4):clean;
  const position=(p:number)=>compact?p+(p>2?1:0)+(p>4?1:0):p;
  if(next!==raw)caret.current={start:position(e.target.selectionStart??raw.length),end:position(e.target.selectionEnd??raw.length)};
  setText(next);const r=validate(next);setError(r.value||!next.trim()?"":compact||error?message(r.code):"");
  if(r.value)emit(r.value);else if(!next.trim()&&seen!=="")emit("");
 };
 const commit=(raw:string)=>{const r=validate(raw);if(!raw.trim()){setError(required?ERROR.REQUIRED:"");if(seen!=="")emit("");return !required;}
  if(r.value){setError("");setText(format(r.value));emit(r.value);return true;}setError(message(r.code));return false;};
 const pick=(v:string)=>{setText(format(v));setError("");input.current?.setCustomValidity("");notify.current?.(true);emit(v);};
 return {text,error,seen,inputRef:input,change,commit,pick};
}

export function ThaiDateInput({id,value,onChange,onValidityChange,required,disabled,name,"data-field":dataField,...aria}:ThaiDateInputProps){
 const auto=useId(),inputId=id??auto,hintId=inputId+"-be-hint",errorId=inputId+"-be-error";
 const [open,setOpen]=useState(false),effectiveRequired=required||aria["aria-required"],{text,error,seen,inputRef,change,commit,pick}=useDateDraft(value,onChange,effectiveRequired,onValidityChange);
 const describedBy=[aria["aria-describedby"],hintId,error?errorId:""].filter(Boolean).join(" ");
 return <div className="be-date">
  <div className="be-date-row">
   <input ref={inputRef} id={inputId} name={name} data-field={dataField} type="text" inputMode="numeric" autoComplete="off" placeholder="วว/ดด/ปปปป" maxLength={10} value={text} disabled={disabled} required={effectiveRequired}
    aria-label={aria["aria-label"]} aria-describedby={describedBy} aria-invalid={error?true:aria["aria-invalid"]} aria-required={required||aria["aria-required"]||undefined}
    onChange={change}
    onBlur={e=>commit(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&!commit((e.target as HTMLInputElement).value))e.preventDefault();}}/>
   <button className="button secondary be-date-open" type="button" disabled={disabled} aria-label="เลือกวันที่จากปฏิทิน (พ.ศ.)" aria-haspopup="dialog" onClick={()=>setOpen(true)}>ปฏิทิน</button>
  </div>
  <p id={hintId} className="help small">วว/ดด/ปปปป (พ.ศ.) · พิมพ์ 8 หลักติดกันได้</p>
  {error&&<p id={errorId} className="field-error" role="alert">{error}{seen&&<> · วันที่ก่อนหน้า {safeFormat(seen)} ยังคงเดิม วันที่ที่กรอกผิดยังไม่ถูกบันทึก</>}</p>}
  {open&&<BeCalendar initial={seen||bangkokIsoDay()} selected={seen} onClose={()=>setOpen(false)} onPick={v=>{pick(v);setOpen(false);}}/>}
 </div>;
}

const formatWall=(wall:string)=>formatBeWall(wall);
const DT_ERROR:Record<string,string>={...ERROR,FORMAT_DT:"กรอกเป็น วว/ดด/ปปปป ชช:นน เช่น 17/10/2569 09:30",INVALID_TIME:"เวลาไม่ถูกต้อง (00:00–23:59)"};

/**
 * BE date + 24 h time in one control (`วว/ดด/ปปปป ชช:นน`), Asia/Bangkok wall time. Emits the same wall string
 * (`YYYY-MM-DDTHH:mm`, CE) that native datetime-local produced, so existing bangkokInput/bangkokInstant conversions apply.
 */
export function ThaiDateTimeInput({id,value,onChange,onValidityChange,required,disabled,name,"data-field":dataField,...aria}:ThaiDateInputProps){
 const auto=useId(),inputId=id??auto,hintId=inputId+"-be-hint",errorId=inputId+"-be-error";
 const [open,setOpen]=useState(false),effectiveRequired=required||aria["aria-required"],{text,error,seen,inputRef,change,commit,pick}=useDateDraft(value,onChange,effectiveRequired,onValidityChange,true);
 const describedBy=[aria["aria-describedby"],hintId,error?errorId:""].filter(Boolean).join(" ");
 return <div className="be-date">
  <div className="be-date-row">
   <input ref={inputRef} id={inputId} name={name} data-field={dataField} type="text" inputMode="numeric" autoComplete="off" placeholder="วว/ดด/ปปปป ชช:นน" maxLength={16} value={text} disabled={disabled} required={effectiveRequired}
    aria-label={aria["aria-label"]} aria-describedby={describedBy} aria-invalid={error?true:aria["aria-invalid"]} aria-required={required||aria["aria-required"]||undefined}
    onChange={change}
    onBlur={e=>commit(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&!commit((e.target as HTMLInputElement).value))e.preventDefault();}}/>
   <button className="button secondary be-date-open" type="button" disabled={disabled} aria-label="เลือกวันที่จากปฏิทิน (พ.ศ.)" aria-haspopup="dialog" onClick={()=>setOpen(true)}>ปฏิทิน</button>
  </div>
  <p id={hintId} className="help small">วว/ดด/ปปปป ชช:นน (พ.ศ., เวลาไทย 24 ชม.)</p>
  {error&&<p id={errorId} className="field-error" role="alert">{error}{seen&&<> · วันเวลาก่อนหน้า {formatWall(seen)} ยังคงเดิม วันเวลาที่กรอกผิดยังไม่ถูกบันทึก</>}</p>}
  {open&&<BeCalendar initial={seen.slice(0,10)||bangkokIsoDay()} selected={seen.slice(0,10)} onClose={()=>setOpen(false)} onPick={v=>{const time=seen.slice(11,16)||"00:00";pick(`${v}T${time}`);setOpen(false);}}/>}
 </div>;
}

/**
 * For uncontrolled forms read through FormData: shows the BE control and submits the unchanged value format under `name`
 * (ISO date `YYYY-MM-DD`, or wall time `YYYY-MM-DDTHH:mm` with `withTime`), exactly what the native input used to submit.
 */
export function ThaiDateFormField({name,label,required=false,defaultValue="",withTime=false}:{name:string;label:string;required?:boolean;defaultValue?:string;withTime?:boolean}){
 const id=useId(),[value,setValue]=useState(defaultValue),Input=withTime?ThaiDateTimeInput:ThaiDateInput;
 return <div className="field"><label htmlFor={id}>{label}</label><Input id={id} value={value} onChange={setValue} required={required}/><input type="hidden" name={name} value={value}/></div>;
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
