import {LabIcon} from "../shared/lab-icons";
import type {LabOverview} from "../../../packages/lab/overview";
import {Histogram,HBars,TrendLines} from "./stat-charts";
import {monthLabelLong} from "./month-label";
import {MonthBars} from "./month-bars";
import "./dashboard.css";

const QC_STAGE:Record<string,string>={QC1:"QC1",QC2:"QC2",QC3:"QC3",QC4:"QC4",SEQUENCING:"Sequencing"};
const pct=(n:number,d:number)=>d?`${(n/d*100).toLocaleString("th-TH",{maximumFractionDigits:1})}%`:"—";

/**
 * Statistics tab of the Lab home (Owner 2026-11-12), centred on TAT: how long results take in working days, how much of the work is
 * on time and what costs time (where open specimens wait now is on the Dashboard, Owner 2026-11-14) (QC failures and repeats). Read-only. Counts exclude EQA; results imported from
 * the previous system count as results but never in the TAT figures (this Lab did not receive those specimens).
 */
export function LabStats({data}:{data:LabOverview}){
 const {quality,stats,policy,tat}=data,limit=policy.businessDays;
 const onTime=pct(stats.withinTat,stats.timed);
 const qcTotals=new Map<string,number>();for(const m of quality)for(const [k,v] of Object.entries(m.qcFailed))qcTotals.set(k,(qcTotals.get(k)??0)+v);
 const repeats=quality.reduce((a,m)=>({RE_LIBRARY:a.RE_LIBRARY+m.repeats.RE_LIBRARY,RE_EXTRACTION:a.RE_EXTRACTION+m.repeats.RE_EXTRACTION,RE_SAMPLING:a.RE_SAMPLING+m.repeats.RE_SAMPLING}),{RE_LIBRARY:0,RE_EXTRACTION:0,RE_SAMPLING:0});
 const range=quality.length?`${monthLabelLong(quality[0].month)} – ${monthLabelLong(quality.at(-1)!.month)}`:"";
 const highT=quality.reduce((a,m)=>a+m.highTrisomy,0),highS=quality.reduce((a,m)=>a+m.highSca,0),high=quality.reduce((a,m)=>a+m.high,0),rel=quality.reduce((a,m)=>a+m.released,0);
 const positive=quality.reduce((a,m)=>({t13:a.t13+m.positive.t13,t18:a.t18+m.positive.t18,t21:a.t21+m.positive.t21,xo:a.xo+m.positive.xo,xxx:a.xxx+m.positive.xxx,xxy:a.xxy+m.positive.xxy,xyy:a.xyy+m.positive.xyy}),{t13:0,t18:0,t21:0,xo:0,xxx:0,xxy:0,xyy:0});
 const buckets=stats.distribution.map((d,i,all)=>({label:i===all.length-1?`${d.days}+`:String(d.days),n:d.n}));
 return <div className="dash-stats">
  <ul className="dash-kpis" aria-label="สรุป TAT 6 เดือน">
   <li className="dash-kpi"><span className="k-label">ออกผลภายใน {limit} วันทำการ</span><span className="k-value num">{onTime}</span><span className="k-sub">{stats.withinTat.toLocaleString("th-TH")} จาก {stats.timed.toLocaleString("th-TH")} ราย · {range}</span></li>
   <li className="dash-kpi"><span className="k-label">ใช้เวลาเฉลี่ย (มัธยฐาน)</span><span className="k-value num">{stats.median??"—"}<small> วันทำการ</small></span><span className="k-sub">ครึ่งหนึ่งของผลออกเร็วกว่านี้</span></li>
   <li className="dash-kpi"><span className="k-label">90% ของผลออกภายใน</span><span className="k-value num">{stats.p90??"—"}<small> วันทำการ</small></span><span className="k-sub">ส่วนที่ช้าที่สุด 1 ใน 10</span></li>
   <li className={"dash-kpi"+(tat.overdue>0?" is-bad":"")}><span className="k-label">เกินกำหนดตอนนี้</span><span className="k-value num">{tat.overdue}<small> ราย</small></span><span className="k-sub">{tat.overdue>0&&<LabIcon name="alert" size={16}/>} จากที่ยังไม่ออกผล {tat.open} ราย</span></li>
   <li className={"dash-kpi"+(tat.dueSoon>0?" is-warn":"")}><span className="k-label">ใกล้ครบกำหนด</span><span className="k-value num">{tat.dueSoon}<small> ราย</small></span><span className="k-sub">เหลือ ≤ {policy.warnDaysLeft} วันทำการ</span></li>
  </ul>

  <div className="dash-stat-grid">
   <section className="panel dash-panel" aria-labelledby="ls-dist"><header className="dash-panel-head"><h2 id="ls-dist">ผลออกช้าหรือเร็วแค่ไหน</h2><p className="dash-panel-note">ผลที่ออกใน 6 เดือน แบ่งตามจำนวนวันทำการที่ใช้ · เส้นประคือกำหนด {limit} วันทำการ</p></header>
    <Histogram title="การกระจายของเวลาออกผล" buckets={buckets} limit={limit} limitLabel={`กำหนด ${limit} วัน`} names={["ภายในกำหนด","เกินกำหนด"]}/></section>
   <section className="panel dash-panel" aria-labelledby="ls-trend"><header className="dash-panel-head"><h2 id="ls-trend">แนวโน้มเวลาออกผล</h2><p className="dash-panel-note">วันทำการนับจากวันที่ Lab รับตัวอย่าง · เดือนที่ไม่มีผลไม่แสดงจุด</p></header>
    <TrendLines title="มัธยฐานและ 90% ของผลที่ออก" series={[{name:"มัธยฐาน"},{name:"90% ของผล"}]} unit="วัน" reference={{value:limit,label:`กำหนด ${limit} วัน`}} months={quality.map(m=>({month:m.month,values:[m.medianDays,m.p90Days]}))}/></section>
   <section className="panel dash-panel" aria-labelledby="ls-ontime"><header className="dash-panel-head"><h2 id="ls-ontime">ออกผลภายในกำหนดรายเดือน</h2><p className="dash-panel-note">ร้อยละของผลที่ออกในเดือนนั้นและออกภายใน {limit} วันทำการ</p></header>
    <TrendLines title="ร้อยละภายในกำหนด" series={[{name:"ภายในกำหนด"}]} unit="%" months={quality.map(m=>({month:m.month,values:[m.timed?Math.round(m.withinTat/m.timed*1000)/10:null]}))}/></section>
   <section className="panel dash-panel" aria-labelledby="ls-qc"><header className="dash-panel-head"><h2 id="ls-qc">อะไรทำให้เสียเวลา</h2><p className="dash-panel-note">รวม 6 เดือน · {range}</p></header>
    <div className="dash-charts">
     <HBars title="QC ไม่ผ่านแยกตามขั้น" parts={[{name:"QC ไม่ผ่าน",tone:"bad"}]} rows={[...qcTotals].sort((a,b)=>b[1]-a[1]).map(([k,v])=>({label:QC_STAGE[k]??k,values:[v]}))} unit="ครั้ง"/>
     <HBars title="การตรวจซ้ำแยกตามชนิด" parts={[{name:"ตรวจซ้ำ",tone:"s2"}]} rows={[{label:"Re-Library",values:[repeats.RE_LIBRARY]},{label:"Re-Extraction",values:[repeats.RE_EXTRACTION]},{label:"Re-Sampling",values:[repeats.RE_SAMPLING]}]} unit="ครั้ง"/>
    </div></section>
   <section className="panel dash-panel" aria-labelledby="ls-high"><header className="dash-panel-head"><h2 id="ls-high">ผลความเสี่ยงสูงแยกกลุ่ม</h2><p className="dash-panel-note">รวม 6 เดือน: เสี่ยงสูง {high} ราย ({pct(high,rel)} ของผลที่ออก) · โครโมโซม 13/18/21 {highT} · โครโมโซมเพศ {highS} · ผลที่เสี่ยงทั้งสองกลุ่มนับในแต่ละกลุ่ม</p></header>
    <MonthBars title="ผลความเสี่ยงสูงตามกลุ่มโครโมโซม" note="แยกตามเดือนที่ออกผล · โครโมโซมเพศ = XO, XXX, XXY, XYY (ครรภ์เดี่ยว)" series={[{name:"โครโมโซม 13/18/21"},{name:"โครโมโซมเพศ"}]} months={quality.map(m=>({month:m.month,values:[m.highTrisomy,m.highSca]}))}/></section>
   <section className="panel dash-panel" aria-labelledby="ls-tri"><header className="dash-panel-head"><h2 id="ls-tri">ผลความเสี่ยงสูง โครโมโซม 13 / 18 / 21</h2><p className="dash-panel-note">รวม 6 เดือน · {range} · ถ้าผลเดียวเสี่ยงหลายโครโมโซม จะนับในทุกแถวที่เกี่ยวข้อง</p></header>
    <HBars title="จำนวนผลความเสี่ยงสูงรายโครโมโซม" parts={[{name:"ความเสี่ยงสูง",tone:"bad"}]} unit="ราย" rows={[{label:"Trisomy 13",values:[positive.t13]},{label:"Trisomy 18",values:[positive.t18]},{label:"Trisomy 21",values:[positive.t21]}]}/></section>
   <section className="panel dash-panel" aria-labelledby="ls-sca"><header className="dash-panel-head"><h2 id="ls-sca">ผลที่พบ โครโมโซมเพศ (ครรภ์เดี่ยว)</h2><p className="dash-panel-note">รวม 6 เดือน · {range} · ตรวจได้เฉพาะครรภ์เดี่ยว · ถ้าผลเดียวพบหลายแบบ จะนับในทุกแถวที่เกี่ยวข้อง</p></header>
    <HBars title="จำนวนผลที่พบความผิดปกติของโครโมโซมเพศ" parts={[{name:"พบ (Detected)",tone:"bad"}]} unit="ราย" rows={[{label:"XO",values:[positive.xo]},{label:"XXX",values:[positive.xxx]},{label:"XXY",values:[positive.xxy]},{label:"XYY",values:[positive.xyy]}]}/></section>
   <section className="panel dash-panel" aria-labelledby="ls-vol"><header className="dash-panel-head"><h2 id="ls-vol">ปริมาณงานรายเดือน</h2><p className="dash-panel-note">รับตัวอย่างและออกผลในเดือนนั้น · ไม่รวม EQA</p></header>
    <MonthBars title="รับตัวอย่างและออกผล" series={[{name:"รับตัวอย่าง"},{name:"ออกผล"}]} months={quality.map(m=>({month:m.month,values:[m.received,m.released]}))}/></section>
  </div>

  <section className="panel dash-panel" aria-labelledby="ls-table"><header className="dash-panel-head"><h2 id="ls-table">ตารางสรุปรายเดือน</h2></header>
   <div className="table-wrap" role="region" aria-label="ตารางสรุป TAT รายเดือน" tabIndex={0}><table className="data-table dash-quality-table">
    <thead><tr><th scope="col">เดือน</th><th scope="col" className="num">ออกผล</th><th scope="col" className="num">เสี่ยงสูง 13/18/21</th><th scope="col" className="num">เสี่ยงสูง โครโมโซมเพศ</th><th scope="col" className="num">ภายในกำหนด</th><th scope="col" className="num">มัธยฐาน (วันทำการ)</th><th scope="col" className="num">90% ภายใน (วันทำการ)</th><th scope="col" className="num">QC ไม่ผ่าน</th><th scope="col" className="num">ตรวจซ้ำ</th></tr></thead>
    <tbody>{[...quality].reverse().map(m=>{const qc=Object.values(m.qcFailed).reduce((a,b)=>a+b,0),rep=m.repeats.RE_LIBRARY+m.repeats.RE_EXTRACTION+m.repeats.RE_SAMPLING;
     return <tr key={m.month}><th scope="row">{monthLabelLong(m.month)}</th><td className="num">{m.released}</td><td className="num">{m.highTrisomy}</td><td className="num">{m.highSca}</td><td className="num">{m.timed?`${m.withinTat}/${m.timed} (${pct(m.withinTat,m.timed)})`:"—"}</td><td className="num">{m.medianDays??"—"}</td><td className="num">{m.p90Days??"—"}</td><td className="num">{qc}</td><td className="num">{rep}</td></tr>;})}</tbody></table></div>
  </section>
 </div>;
}
