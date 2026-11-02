"use client";
import {useEffect,useMemo,useState} from "react";
import {api,message} from "./shared";
type HistoricalDoctor={id:string;name:string;cases:number};
/** Doctors named on the reports issued by Genomic-CBH. Read-only: they have no unit and no signature and cannot order, sign or approve here. */
export function HistoricalDoctors(){
 const [rows,setRows]=useState<HistoricalDoctor[]|null>(null),[error,setError]=useState(""),[q,setQ]=useState("");
 useEffect(()=>{let live=true;api<{historicalDoctors:HistoricalDoctor[]}>("/api/p2/doctors?historical=1").then(r=>{if(live)setRows(r.historicalDoctors);}).catch(e=>{if(live)setError(message(e));});return()=>{live=false;};},[]);
 const shown=useMemo(()=>(rows??[]).filter(d=>!q.trim()||d.name.toLowerCase().includes(q.trim().toLowerCase())),[rows,q]);
 if(error)return <section className="panel"><h2>แพทย์จากระบบเดิม (Genomic-CBH)</h2><p role="alert">{error}</p></section>;
 if(!rows||!rows.length)return null;
 return <section className="panel" aria-labelledby="historical-doctors-h"><h2 id="historical-doctors-h">แพทย์จากระบบเดิม (Genomic-CBH)</h2>
  <p className="muted">รายชื่อตาม “Referring Doctor” บนรายงานผลที่ออกจากระบบเดิม {rows.length} ท่าน — ใช้อ้างอิงเคสย้อนหลังเท่านั้น (ไม่มีหน่วยงานหรือลายเซ็น และไม่ใช้สั่งตรวจ/ลงนามใน NIPT-CBH)</p>
  <div className="field"><label htmlFor="hist-doctor-q">ค้นหาแพทย์</label><input id="hist-doctor-q" type="search" value={q} onChange={e=>setQ(e.target.value)} autoComplete="off" maxLength={80}/></div>
  <div className="table-wrap" role="region" aria-label="แพทย์จากระบบเดิม" tabIndex={0}><table className="data-table"><thead><tr><th scope="col">ชื่อแพทย์</th><th scope="col">จำนวนเคสย้อนหลัง</th></tr></thead>
   <tbody>{shown.map(d=><tr key={d.id}><td>{d.name}</td><td>{d.cases}</td></tr>)}{!shown.length&&<tr><td colSpan={2}>ไม่พบแพทย์ที่ตรงกับคำค้น</td></tr>}</tbody></table></div></section>;
}
