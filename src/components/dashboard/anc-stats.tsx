"use client";
import {useEffect,useState,type ReactNode} from "react";
import {api,message} from "../p2/shared";
import {Icon} from "../p2/anc-progress-view";
import type {AncInsights as Data} from "../../../packages/anc/insights";
import {MonthBars} from "./month-bars";
import {HBars,StackedMonthBars,TrendLines} from "./stat-charts";
import {monthLabelLong} from "./month-label";
import "./dashboard.css";
import "./anc-insights.css";

const WEEKDAYS=["จันทร์","อังคาร","พุธ","พฤหัสบดี","ศุกร์","เสาร์","อาทิตย์"];
const pct=(n:number,d:number)=>d?`${(n/d*100).toLocaleString("th-TH",{maximumFractionDigits:1})}%`:"—";

/**
 * ANC statistics page (Owner 2026-11-12), a menu item beside the doctor registry: the fiscal year of the nurse's units in numbers and charts.
 * Read-only. The year and unit are chosen here (the unit list comes from the same scope as the queue).
 */
const FY=()=>{const d=new Date(),y=d.getFullYear()+543;return d.getMonth()>=9?y+1:y;};
export function AncStatsPage(){
 const [fy,setFy]=useState(FY),[unitId,setUnitId]=useState("");
 const [state,setState]=useState<{data:Data|null;error:string;loading:boolean}>({data:null,error:"",loading:true});
 const [n,setN]=useState(0);
 useEffect(()=>{let live=true;const t=setTimeout(()=>{setState(s=>({...s,loading:true,error:""}));
  // view=dashboard: the statistics never show names, so none are sent (Owner 2026-11-14).
  const q=new URLSearchParams({fy:String(fy),view:"dashboard"});if(unitId)q.set("unitId",unitId);
  api<Data>("/api/anc/insights?"+q).then(d=>{if(live)setState({data:d,error:"",loading:false});},e=>{if(live)setState({data:null,error:message(e),loading:false});});},0);
  return()=>{live=false;clearTimeout(t);};},[fy,unitId,n]);
 const {data,error,loading}=state;
 const units=data?.units??[];
 const filters=<section className="anc-toolbar dash-stat-filters" aria-label="ตัวกรองสถิติ">
  <label>หน่วยงาน<select value={unitId} onChange={e=>setUnitId(e.target.value)}><option value="">ทุกหน่วยในขอบเขตสิทธิ์</option>{units.map(u=><option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
  <label>ปีงบประมาณ<select value={fy} onChange={e=>setFy(Number(e.target.value))}>{Array.from({length:8},(_,i)=>FY()-i).map(y=><option key={y} value={y}>{y} · 1 ต.ค. {y-1} – 30 ก.ย. {y}</option>)}</select></label>
 </section>;
 const head=<header className="page-header"><div><h1>สถิติการส่งตรวจ</h1><p className="page-meta">ANC · ปีงบประมาณ {fy} · นับตามหน่วยงานที่เลือก · ตัวเลขอ่านอย่างเดียว</p></div></header>;
 if(error)return <div className="dash-stats">{head}{filters}<div className="error" role="alert">{error||"โหลดสถิติไม่สำเร็จ"} <button type="button" className="button secondary" onClick={()=>setN(x=>x+1)}>ลองใหม่</button></div></div>;
 if(!data)return <div className="dash-stats">{head}{filters}<section className="panel dash-panel anc-skeleton" aria-busy="true" aria-label="กำลังโหลดสถิติ"><span/><span/><span/></section></div>;
 return <div><AncStatsView data={data} filters={<>{head}{filters}</>} loading={loading}/></div>;
}

/** The statistics themselves (no fetching): the tab above wraps it. */
export function AncStatsView({data,filters,loading}:{data:Data;filters:ReactNode;loading:boolean}){
 const {monthly:m,stats}=data,t=stats.totals;
 const last=m.at(-1),prev=m.at(-2);
 const delta=(a?:number,b?:number)=>a===undefined||b===undefined?undefined:a-b;
 const dSent=delta(last?.sent,prev?.sent),age=stats.age;
 const ageRows=[...age.groups.map(g=>({label:g.label,sub:`${pct(g.sent,age.known)} · เสี่ยงสูง ${g.high}${g.sent?` (${pct(g.high,g.sent)})`:""}`,values:[g.sent]})),...(age.unknown?[{label:"ไม่ทราบอายุ",sub:`ไม่มีวันเกิด · เสี่ยงสูง ${age.unknownHigh}`,values:[age.unknown]}]:[])];
 return <div className={"dash-stats"+(loading?" is-stale":"")}>
  {filters}
  <ul className="dash-kpis" aria-label="สรุปปีงบประมาณ">
   <li className="dash-kpi"><span className="k-label">ส่งตรวจ ปีงบ {data.fiscalYear}</span><span className="k-value num">{t.sent.toLocaleString("th-TH")}<small> ราย</small></span><span className="k-sub">{dSent===undefined||!prev?"รับตัวอย่างเลือดครั้งแรก":`เดือนล่าสุดเทียบเดือนก่อน ${dSent>=0?"+":""}${dSent}`}</span></li>
   <li className="dash-kpi"><span className="k-label">มีผลแล้ว</span><span className="k-value num">{t.released.toLocaleString("th-TH")}<small> ราย</small></span><span className="k-sub">คิดเป็น {pct(t.released,t.sent)} ของที่ส่งตรวจ</span></li>
   <li className={"dash-kpi"+(t.high>0?" is-bad":"")}><span className="k-label">ผลความเสี่ยงสูง</span><span className="k-value num">{t.high.toLocaleString("th-TH")}<small> ราย</small></span><span className="k-sub">{t.high>0&&<Icon name="alert"/>} {pct(t.high,t.released)} ของผลที่ออก · โครโมโซม 13/18/21 {t.highTrisomy} · โครโมโซมเพศ {t.highSca}</span></li>
   <li className="dash-kpi"><span className="k-label">เจาะเลือดซ้ำ</span><span className="k-value num">{t.redraw.toLocaleString("th-TH")}<small> ครั้ง</small></span><span className="k-sub">{pct(t.redraw,t.sent)} ของที่ส่งตรวจ</span></li>
   <li className="dash-kpi"><span className="k-label">รอผลเฉลี่ย (มัธยฐาน)</span><span className="k-value num">{t.medianDays??"—"}<small> วันทำการ</small></span><span className="k-sub">90% ของผลออกภายใน {t.p90Days??"—"} วันทำการ</span></li>
  </ul>
  <div className="dash-stat-grid">
   <section className="panel dash-panel" aria-labelledby="as-vol"><header className="dash-panel-head"><h2 id="as-vol">ปริมาณงานรายเดือน</h2><p className="dash-panel-note">{m.length?`${monthLabelLong(m[0].month)} – ${monthLabelLong(m.at(-1)!.month)}`:""} · ส่งตรวจ = รับตัวอย่างเลือดครั้งแรก · มีผล = ผลที่ออกในเดือนนั้น</p></header>
    <MonthBars title="ส่งตรวจและมีผล" series={[{name:"ส่งตรวจ"},{name:"มีผล"}]} months={m.map(x=>({month:x.month,values:[x.sent,x.released]}))}/></section>
   <section className="panel dash-panel" aria-labelledby="as-risk"><header className="dash-panel-head"><h2 id="as-risk">ระดับความเสี่ยงของผลที่ออก</h2><p className="dash-panel-note">แยกตามเดือนที่ออกผล · “ดูในรายงานผล” คือผลที่ระบบสรุประดับให้ไม่ได้</p></header>
    <StackedMonthBars title="ผลที่ออกแยกตามระดับความเสี่ยง" parts={[{name:"ความเสี่ยงสูง",tone:"bad"},{name:"ความเสี่ยงต่ำ",tone:"good"},{name:"ดูในรายงานผล",tone:"neutral"}]} months={m.map(x=>({month:x.month,values:[x.high,x.low,x.unknown]}))}/></section>
   <section className="panel dash-panel" aria-labelledby="as-group"><header className="dash-panel-head"><h2 id="as-group">ผลความเสี่ยงสูงแยกกลุ่ม</h2><p className="dash-panel-note">ปีงบ {data.fiscalYear}: โครโมโซม 13/18/21 {t.highTrisomy} ราย · โครโมโซมเพศ {t.highSca} ราย · ผลที่เสี่ยงทั้งสองกลุ่มนับในแต่ละกลุ่ม</p></header>
    <MonthBars title="ผลความเสี่ยงสูงตามกลุ่มโครโมโซม" note="แยกตามเดือนที่ออกผล · โครโมโซมเพศ = XO, XXX, XXY, XYY (ครรภ์เดี่ยว)" series={[{name:"โครโมโซม 13/18/21"},{name:"โครโมโซมเพศ"}]} months={m.map(x=>({month:x.month,values:[x.highTrisomy,x.highSca]}))}/></section>
   <section className="panel dash-panel" aria-labelledby="as-tri"><header className="dash-panel-head"><h2 id="as-tri">ผลความเสี่ยงสูง โครโมโซม 13 / 18 / 21</h2><p className="dash-panel-note">ปีงบ {data.fiscalYear} · ถ้าผลเดียวเสี่ยงหลายโครโมโซม จะนับในทุกแถวที่เกี่ยวข้อง</p></header>
    <HBars title="จำนวนผลความเสี่ยงสูงรายโครโมโซม" parts={[{name:"ความเสี่ยงสูง",tone:"bad"}]} unit="ราย" rows={[{label:"Trisomy 13",values:[stats.positive.t13]},{label:"Trisomy 18",values:[stats.positive.t18]},{label:"Trisomy 21",values:[stats.positive.t21]}]}/></section>
   <section className="panel dash-panel" aria-labelledby="as-sca"><header className="dash-panel-head"><h2 id="as-sca">ผลที่พบ โครโมโซมเพศ (ครรภ์เดี่ยว)</h2><p className="dash-panel-note">ปีงบ {data.fiscalYear} · ตรวจได้เฉพาะครรภ์เดี่ยว · ถ้าผลเดียวพบหลายแบบ จะนับในทุกแถวที่เกี่ยวข้อง</p></header>
    <HBars title="จำนวนผลที่พบความผิดปกติของโครโมโซมเพศ" parts={[{name:"พบ (Detected)",tone:"bad"}]} unit="ราย" rows={[{label:"XO",values:[stats.positive.xo]},{label:"XXX",values:[stats.positive.xxx]},{label:"XXY",values:[stats.positive.xxy]},{label:"XYY",values:[stats.positive.xyy]}]}/></section>
   <section className="panel dash-panel" aria-labelledby="as-high"><header className="dash-panel-head"><h2 id="as-high">สัดส่วนผลความเสี่ยงสูง</h2><p className="dash-panel-note">ร้อยละของผลที่ออกในแต่ละเดือน (เดือนที่ไม่มีผลออกไม่แสดงจุด)</p></header>
    <TrendLines title="ผลความเสี่ยงสูง (%)" series={[{name:"ความเสี่ยงสูง"}]} unit="%" months={m.map(x=>({month:x.month,values:[x.released?Math.round(x.high/x.released*1000)/10:null]}))}/></section>
   <section className="panel dash-panel dash-wide" aria-labelledby="as-wait"><header className="dash-panel-head"><h2 id="as-wait">ระยะรอผลและเจาะซ้ำ</h2><p className="dash-panel-note">ระยะรอผลนับเป็นวันทำการ ตั้งแต่ Lab รับตัวอย่างถึงออกผล</p></header>
    <div className="dash-charts">
     <TrendLines title="ระยะรอผล (มัธยฐาน)" series={[{name:"มัธยฐาน"}]} unit="วันทำการ" months={m.map(x=>({month:x.month,values:[x.medianDays]}))}/>
     <MonthBars title="เจาะเลือดซ้ำ" note="จำนวนคำขอเจาะเลือดซ้ำที่เปิดในเดือนนั้น" series={[{name:"เจาะซ้ำ"}]} months={m.map(x=>({month:x.month,values:[x.redraw]}))}/>
    </div></section>
   <section className="panel dash-panel" aria-labelledby="as-unit"><header className="dash-panel-head"><h2 id="as-unit">แยกตามหน่วยงาน</h2><p className="dash-panel-note">จำนวนที่ส่งตรวจในปีงบ · เคสที่อยู่หลายหน่วยนับในทุกหน่วยนั้น</p></header>
    <HBars title="ส่งตรวจตามหน่วยงาน" parts={[{name:"ส่งตรวจ",tone:"s1"}]} rows={stats.units.map(u=>({label:u.name,sub:`มีผล ${u.released} · เสี่ยงสูง ${u.high}`,values:[u.sent]}))} unit="ราย"/></section>
   <section className="panel dash-panel" aria-labelledby="as-age"><header className="dash-panel-head"><h2 id="as-age">ช่วงอายุของคุณแม่</h2><p className="dash-panel-note">เคสที่ส่งตรวจในปีงบ · อายุเต็มปี ณ วันเจาะเลือดครั้งแรก · อายุมัธยฐาน {age.median??"—"} ปี · อายุ 35 ปีขึ้นไป {age.over35} ราย ({pct(age.over35,age.known)} ของที่ทราบอายุ)</p></header>
    <HBars title="ส่งตรวจตามช่วงอายุ" note="ร้อยละคิดจากเคสที่ทราบอายุ · เสี่ยงสูง = ผลปัจจุบันของเคสเป็นความเสี่ยงสูง" parts={[{name:"ส่งตรวจ",tone:"s1"}]} rows={ageRows} unit="ราย"/></section>
   <section className="panel dash-panel" aria-labelledby="as-day"><header className="dash-panel-head"><h2 id="as-day">ส่งตรวจตามวันในสัปดาห์</h2><p className="dash-panel-note">วันที่ Lab รับตัวอย่างเลือดครั้งแรก ตามเวลาประเทศไทย</p></header>
    <HBars title="จำนวนตัวอย่างที่ส่งตรวจต่อวัน" parts={[{name:"ส่งตรวจ",tone:"s1"}]} rows={WEEKDAYS.map((d,i)=>({label:d,values:[stats.weekday[i]]}))} unit="ราย"/></section>
  </div>
  <section className="panel dash-panel" aria-labelledby="as-table"><header className="dash-panel-head"><h2 id="as-table">ตารางรายเดือน ปีงบประมาณ {data.fiscalYear}</h2></header>
   <div className="table-wrap" role="region" aria-label="ตารางสถิติรายเดือน" tabIndex={0}><table className="data-table dash-quality-table">
    <thead><tr><th scope="col">เดือน</th><th scope="col" className="num">ส่งตรวจ</th><th scope="col" className="num">มีผล</th><th scope="col" className="num">ผลความเสี่ยงสูง</th><th scope="col" className="num">เสี่ยงสูง 13/18/21</th><th scope="col" className="num">เสี่ยงสูง โครโมโซมเพศ</th><th scope="col" className="num">เจาะเลือดซ้ำ</th><th scope="col" className="num">มัธยฐานวันทำการรอผล</th></tr></thead>
    <tbody>{[...m].reverse().map(x=><tr key={x.month}><th scope="row">{monthLabelLong(x.month)}</th><td className="num">{x.sent}</td><td className="num">{x.released}</td><td className="num">{x.high>0?<span className="dash-status bad"><Icon name="alert"/>{x.high}</span>:0}</td><td className="num">{x.highTrisomy}</td><td className="num">{x.highSca}</td><td className="num">{x.redraw}</td><td className="num">{x.medianDays??"—"}</td></tr>)}</tbody></table></div>
  </section>
 </div>;
}
