"use client";
import {useCallback,useEffect,useState} from "react";
import {displayBe,displayBeDateTime} from "../../packages/domain/thai-date";
import {holidaySyncMessage} from "../../packages/calendar/messages";
import "./holiday-calendar-panel.css";

type State={lastAttemptAt:string|null;lastSuccessAt:string|null;lastErrorCode:string|null;holidayCount:number;years:number[];trigger:'MANUAL'|'WORKER'|null};
type Data={holidays:{day:string;name:string}[];state:State};
const WEEKDAY=new Intl.DateTimeFormat('th-TH',{weekday:'short',timeZone:'UTC'});

/**
 * Settings > TAT และวันทำการ (Owner 2026-11-11): one sync gives the whole year, so there is no schedule. The administrator presses
 * "ซิงก์วันหยุดตอนนี้" once a year or when a special holiday is announced; the Worker fills a missing year by itself once.
 */
export function HolidayCalendarPanel({canSync}:{canSync:boolean}){
 const [data,setData]=useState<Data|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 const load=useCallback(async()=>{setError('');try{const r=await fetch('/api/settings/holidays');const d=await r.json();if(!r.ok)throw Error(d.error);setData(d as Data);}catch(e){setError((e as Error).message||'โหลดปฏิทินวันหยุดไม่ได้');}},[]);
 useEffect(()=>{const t=setTimeout(()=>void load(),0);return()=>clearTimeout(t);},[load]);
 async function sync(){setBusy(true);setNotice('');setError('');try{
  const me=await fetch('/api/me').then(r=>r.json());
  const r=await fetch('/api/settings/holidays',{method:'POST',headers:{'Content-Type':'application/json','x-csrf-token':me.csrf},body:'{}'});const d=await r.json();
  if(!r.ok){setError(d.error);return;}
  if(d.ok)setNotice(`ซิงก์แล้ว: วันหยุด ${d.count} วัน ปี ${(d.years as number[]).map(y=>y+543).join(', ')}`);else setError(`ซิงก์ไม่สำเร็จ: ${holidaySyncMessage(d.code)} · ใช้วันหยุดชุดเดิมต่อ`);
  await load();
 }catch{setError('ซิงก์ไม่สำเร็จ หรือเชื่อมต่อไม่ได้ กรุณาลองอีกครั้ง');}finally{setBusy(false);}}
 const s=data?.state;
 const years=[...new Set((data?.holidays??[]).map(h=>Number(h.day.slice(0,4))))];
 return <section className="panel holiday-panel" aria-labelledby="holiday-h">
  <h2 id="holiday-h">ปฏิทินวันหยุด</h2>
  <p className="help">ซิงก์ครั้งเดียวได้วันหยุดทั้งปี กดซิงก์ปีละครั้ง หรือเมื่อมีประกาศวันหยุดพิเศษ ถ้ายังไม่มีวันหยุดของปีที่ต้องใช้ Worker จะซิงก์ให้เองหนึ่งครั้ง (บันทึกการตั้งค่าลิงก์ก่อนกดซิงก์)</p>
  {s&&<dl className="holiday-state">
   <div><dt>ซิงก์สำเร็จล่าสุด</dt><dd>{s.lastSuccessAt?`${displayBeDateTime(s.lastSuccessAt)} น.${s.trigger==='WORKER'?' (Worker)':''}`:'ยังไม่เคยซิงก์'}</dd></div>
   <div><dt>ปีที่มีวันหยุด</dt><dd>{s.years.length?s.years.map(y=>y+543).join(', '):'—'}</dd></div>
   {s.lastErrorCode&&<div><dt>ครั้งล่าสุดไม่สำเร็จ</dt><dd className="holiday-error"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 2 21h20L12 3Zm0 6v5m0 3h.01"/></svg>{displayBeDateTime(s.lastAttemptAt)} น. · {holidaySyncMessage(s.lastErrorCode)}</dd></div>}
  </dl>}
  {canSync&&<div className="action-bar"><button type="button" className="button secondary" disabled={busy} onClick={()=>void sync()}>{busy?'กำลังซิงก์…':'ซิงก์วันหยุดตอนนี้'}</button></div>}
  <div aria-live="polite">{notice&&<p className="notice success" role="status">{notice}</p>}{error&&<p className="notice" role="alert">{error} <button type="button" className="button secondary" onClick={()=>void load()}>โหลดใหม่</button></p>}</div>
  {data&&(data.holidays.length?years.map(y=><details key={y} open={y===Number(new Date().toISOString().slice(0,4))}>
   <summary>ปี {y+543} · {data.holidays.filter(h=>h.day.startsWith(String(y))).length} วัน</summary>
   <div className="table-wrap" role="region" aria-label={`วันหยุดปี ${y+543}`} tabIndex={0}><table className="data-table holiday-table"><thead><tr><th scope="col">วันที่</th><th scope="col">วัน</th><th scope="col">ชื่อวันหยุด</th></tr></thead>
    <tbody>{data.holidays.filter(h=>h.day.startsWith(String(y))).map(h=><tr key={h.day}><td className="num">{displayBe(h.day)}</td><td>{WEEKDAY.format(new Date(h.day+'T00:00:00Z'))}</td><td>{h.name}</td></tr>)}</tbody></table></div>
  </details>):<p>ยังไม่มีวันหยุดในระบบ TAT จะนับเฉพาะเสาร์-อาทิตย์จนกว่าจะซิงก์</p>)}
 </section>;
}
