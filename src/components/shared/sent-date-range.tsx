"use client";
import {useId} from "react";
import {ThaiDateInput} from "./thai-date-input";
import "./sent-date-range.css";

/**
 * "วันที่ส่งตรวจ" range filter (Owner 2026-11-12), shared by the ANC overview and the central registry. Two Buddhist-Era date fields
 * with the calendar picker; either end may be left empty. Values are ISO days (YYYY-MM-DD) as the APIs expect.
 */
export function SentDateRange({from,to,onChange,disabled}:{from:string;to:string;onChange:(from:string,to:string)=>void;disabled?:boolean}){
 const id=useId();
 return <fieldset className="sent-date-range">
  <legend>วันที่ส่งตรวจ</legend>
  <div className="sent-date-range-fields">
   <ThaiDateInput id={id+"-from"} value={from} disabled={disabled} aria-label="วันที่ส่งตรวจ ตั้งแต่" onChange={v=>onChange(v,to)}/>
   <span aria-hidden="true">ถึง</span>
   <ThaiDateInput id={id+"-to"} value={to} disabled={disabled} aria-label="วันที่ส่งตรวจ ถึง" onChange={v=>onChange(from,v)}/>
   {(from||to)&&<button type="button" className="button secondary small" disabled={disabled} onClick={()=>onChange("","")}>ล้างวันที่</button>}
  </div>
 </fieldset>;
}
