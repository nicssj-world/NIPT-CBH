"use client";
import {Kpi} from "../dashboard/kpi";
import {HBars} from "../dashboard/stat-charts";
import {FINDING_KEYS,FINDING_LABEL} from "../../../packages/confirm/model";
import type {ConfirmStats} from "../../../packages/confirm/stats";
import "../dashboard/dashboard.css";

const pct=(v:number|null)=>v===null?"—":`${v.toLocaleString("th-TH",{maximumFractionDigits:1})}%`;

/**
 * Concordance of the NIPT screening with the confirmatory result (Owner 2026-11-23), shared by ผลตรวจยืนยัน and the ANC statistics page.
 * % ผลตรงกัน = True positive ÷ findings with a confirmatory result; Mosaic-other counts as not concordant. Cases without a result are counted, never in the %.
 */
export function ConcordanceSummary({stats,headingId}:{stats:ConfirmStats;headingId:string}){
 const o=stats.overall,c=stats.cases,s=stats.status;
 const notDone=s.DECLINED+s.PREGNANCY_LOSS+s.LOST_FOLLOW_UP;
 const rows=FINDING_KEYS.filter(k=>stats.byFinding[k].screened>0).map(k=>{const t=stats.byFinding[k];
  return {label:FINDING_LABEL[k],sub:`ผลตรงกัน ${pct(t.ppv)} · มีผลยืนยัน ${t.confirmed} จาก ${t.screened}`,values:[t.truePositive,t.falsePositive,t.mosaicOther,t.screened-t.confirmed]};});
 const year=stats.fiscalYear===null?"ทุกปีงบประมาณ":`ปีงบ ${stats.fiscalYear}`;
 return <div className="confirm-summary">
  <ul className="dash-kpis" aria-labelledby={headingId}>
   <Kpi label={`ผลตรงกัน (PPV) · ${year}`} value={o.ppv} unit="%"
    sub={o.confirmed?<>True positive {o.truePositive} จาก {o.confirmed} รายการที่มีผลยืนยัน{o.mosaicOther>0&&<> · Mosaic-other {o.mosaicOther} นับเป็นไม่ตรง</>}</>:"ยังไม่มีผลยืนยัน"}/>
   <Kpi label="มีผลยืนยันแล้ว" value={c.withResult} sub={<>จาก {c.followed} รายที่ผลคัดกรองผิดปกติ · ตรงกันทุกรายการ {c.concordant} ราย</>}/>
   <Kpi label="รอผล" value={s.PENDING} tone="warn" sub="ยังไม่ได้บันทึกผลยืนยัน"/>
   <Kpi label="ไม่ได้ตรวจยืนยัน" value={notDone} sub={`ปฏิเสธการเจาะ ${s.DECLINED} · แท้ง-ยุติการตั้งครรภ์ ${s.PREGNANCY_LOSS} · ติดตามไม่ได้ ${s.LOST_FOLLOW_UP} (ไม่นับใน %)`}/>
  </ul>
  <HBars title="ผลยืนยันแยกตามรายการที่คัดกรองพบ" unit="รายการ"
   note={`โครโมโซม 13/18/21 ผลตรงกัน ${pct(stats.trisomy.ppv)} (${stats.trisomy.truePositive}/${stats.trisomy.confirmed}) · โครโมโซมเพศ ${pct(stats.sca.ppv)} (${stats.sca.truePositive}/${stats.sca.confirmed}) · ผลเดียวพบหลายรายการนับในทุกแถว`}
   parts={[{name:"True positive",tone:"good"},{name:"False positive",tone:"bad"},{name:"Mosaic-other",tone:"warn"},{name:"ยังไม่มีผลยืนยัน",tone:"neutral"}]} rows={rows}/>
 </div>;
}
