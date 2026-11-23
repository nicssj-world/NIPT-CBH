"use client";
import Link from "next/link";
import {useEffect,useState} from "react";
import {labApi,failureText,LabFailure} from "../p4/lab-api";
import type {ConfirmStats} from "../../../packages/confirm/stats";
import {ConcordanceSummary} from "./concordance-summary";

/** The concordance card of the ANC statistics page (Owner 2026-11-23): same fiscal year as the page; hidden for a user without confirm.read. */
export function ConfirmStatsCard({fy}:{fy:number}){
 const [state,setState]=useState<{stats:ConfirmStats|null;error:string;hidden:boolean}>({stats:null,error:"",hidden:false}),[n,setN]=useState(0);
 useEffect(()=>{let live=true;labApi<ConfirmStats>(`/api/confirm?view=stats&fy=${fy}`).then(stats=>{if(live)setState({stats,error:"",hidden:false});},
  e=>{if(live)setState({stats:null,error:failureText(e),hidden:e instanceof LabFailure&&e.status===403});});return()=>{live=false;};},[fy,n]);
 if(state.hidden)return null;
 return <section className="panel dash-panel" aria-labelledby="as-confirm">
  <header className="dash-panel-head"><h2 id="as-confirm">ผลตรวจยืนยันเทียบกับผลคัดกรอง</h2>
   <p className="dash-panel-note">เคสผลคัดกรองผิดปกติที่ออกผลในปีงบ {fy} · ทุกหน่วยในขอบเขตสิทธิ์ (ไม่ใช้ตัวกรองหน่วยงานด้านบน) · ผลตรงกัน = True positive ÷ รายการที่มีผลยืนยัน · <Link href="/confirm">ดูรายเคสที่หน้า ผลตรวจยืนยัน (Confirm)</Link></p></header>
  {state.error?<div className="notice" role="alert">{state.error} <button type="button" className="button small secondary" onClick={()=>setN(x=>x+1)}>ลองใหม่</button></div>
   :state.stats?<ConcordanceSummary stats={state.stats} headingId="as-confirm"/>:<p className="help" role="status">กำลังโหลด…</p>}
 </section>;
}
