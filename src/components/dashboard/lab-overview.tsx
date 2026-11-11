import Link from "next/link";
import {Ln} from "../p2/shared";
import {LabIcon} from "../shared/lab-icons";
import {BatchStatus} from "../p4/batch-status";
import {displayBe,displayBeDateTime} from "../../../packages/domain/thai-date";
import type {LabOverview,LabStage,OpenSpecimen} from "../../../packages/lab/overview";
import {MonthBars} from "./month-bars";
import {monthLabelLong} from "./month-label";
import "./dashboard.css";

const STAGE:Record<LabStage,string>={READY:"รอเข้า Batch",IN_RUN:"อยู่ใน Run",QC_FAILED:"QC ไม่ผ่าน · รอตัดสินใจ",ANALYSIS_DONE:"วิเคราะห์เสร็จ · รอผลตรวจ",AWAITING_RESULT:"รอออกผล",HOLD:"HOLD",OTHER:"กำลังดำเนินการ"};
const stageText=(r:OpenSpecimen)=>r.stage==="IN_RUN"&&r.runLabel?`อยู่ใน ${r.runLabel}`:STAGE[r.stage];
const QC_STAGE:Record<string,string>={QC1:"QC1",QC2:"QC2",QC3:"QC3",QC4:"QC4",SEQUENCING:"Sequencing"};

function Who({r}:{r:OpenSpecimen}){
 return <><Link className="registry-ln-link" href={`/cases/${r.caseId}`} aria-label={`ดูเคส LN ${r.ln}`}><Ln value={r.ln}/></Link><span className="cell-sub">HN {r.hn??"ยังไม่ยืนยัน"}</span></>;
}
/** TAT in words, icon + word; colour only supports it (DESIGN.md: status is always a word). */
export function TatWord({state,left}:{state:"ok"|"due-soon"|"overdue";left:number}){
 if(state==="overdue")return <span className="dash-status bad"><LabIcon name="alert" size={18}/>เกินกำหนด {-left} วันทำการ</span>;
 if(state==="due-soon")return <span className="dash-status warn"><LabIcon name="clock" size={18}/>{left===0?"ครบกำหนดวันนี้":`เหลือ ${left} วันทำการ`}</span>;
 return <span className="dash-status good">ภายในกำหนด</span>;
}

export function LabOverviewPanels({data}:{data:LabOverview}){
 const {tat,gaOver18,runs,quality,policy,calendar}=data;
 return <>
  <section className="panel dash-panel" id="tat" aria-labelledby="tat-h">
   <header className="dash-panel-head"><h2 id="tat-h">เคสใกล้ / เกินกำหนด TAT</h2>
    <p className="dash-panel-note">เกณฑ์ {policy.businessDays} วันทำการนับจากวันที่ Lab รับตัวอย่าง เตือนเมื่อเหลือ {policy.warnDaysLeft} วันทำการ · ยังไม่ออกผล {tat.open} ราย</p></header>
   {calendar.missingYears.length>0&&<p className="dash-note warn" role="status"><LabIcon name="info" size={18}/>ยังไม่มีปฏิทินวันหยุดปี {calendar.missingYears.map(y=>y+543).join(", ")}: นับเฉพาะเสาร์-อาทิตย์ <Link href="/settings?key=tat">ไปซิงก์วันหยุด</Link></p>}
   {tat.rows.length===0?<p className="dash-empty">ทุกเคสที่ยังไม่ออกผลอยู่ภายในกำหนด</p>:
   <div className="table-wrap" role="region" aria-label="ตารางเคสใกล้หรือเกินกำหนด TAT" tabIndex={0}><table className="data-table dash-table-tat">
    <caption className="sr-only">เกินกำหนด {tat.overdue} ราย ใกล้ครบกำหนด {tat.dueSoon} ราย เรียงจากเกินกำหนดมากที่สุด</caption>
    <thead><tr><th scope="col">LN / HN</th><th scope="col">Lab รับเมื่อ</th><th scope="col">TAT</th><th scope="col">ครบกำหนด</th><th scope="col">ตอนนี้</th></tr></thead>
    <tbody>{tat.rows.map(r=><tr key={r.caseId}><td className="c-who"><Who r={r}/></td><td className="num">{displayBeDateTime(r.receivedAt)}</td>
     <td><TatWord state={r.state} left={r.left}/><span className="cell-sub">ใช้ไป {r.used}/{policy.businessDays} วันทำการ</span></td><td className="num">{displayBe(r.due)}</td><td>{stageText(r)}</td></tr>)}</tbody></table></div>}
   {tat.overdue+tat.dueSoon>tat.rows.length&&<p className="help">แสดง {tat.rows.length} จาก {tat.overdue+tat.dueSoon} ราย · ดูทั้งหมดในหน้างาน Lab</p>}
  </section>

  <section className="panel dash-panel" id="ga18" aria-labelledby="ga-h">
   <header className="dash-panel-head"><h2 id="ga-h">ตัวอย่างที่ GA เกิน 18 สัปดาห์</h2>
    <p className="dash-panel-note">อายุครรภ์ ณ วันเจาะเลือดเกิน 18+0 สัปดาห์ ในตัวอย่างที่ยังไม่ออกผล (คำเตือนเท่านั้น ไม่ได้หยุดงาน)</p></header>
   {gaOver18.rows.length===0?<p className="dash-empty">ไม่มีตัวอย่างที่ GA เกิน 18 สัปดาห์</p>:
   <div className="table-wrap" role="region" aria-label="ตารางตัวอย่างที่ GA เกิน 18 สัปดาห์" tabIndex={0}><table className="data-table">
    <caption className="sr-only">{gaOver18.count} ราย เรียงจากอายุครรภ์มากที่สุด</caption>
    <thead><tr><th scope="col">LN / HN</th><th scope="col">GA ณ วันเจาะเลือด</th><th scope="col">Lab รับเมื่อ</th><th scope="col">ตอนนี้</th></tr></thead>
    <tbody>{gaOver18.rows.map(r=><tr key={r.caseId}><td className="c-who"><Who r={r}/></td>
     <td><span className="dash-status bad"><LabIcon name="alert" size={18}/><span className="num">{r.gaWeeks}+{r.gaDays}</span> สัปดาห์</span><span className="cell-sub">เกิน 18 สัปดาห์</span></td>
     <td className="num">{displayBeDateTime(r.receivedAt)}</td><td>{stageText(r)}</td></tr>)}</tbody></table></div>}
   {gaOver18.count>gaOver18.rows.length&&<p className="help">แสดง {gaOver18.rows.length} จาก {gaOver18.count} ราย</p>}
  </section>

  <section className="panel dash-panel" aria-labelledby="runs-h">
   <header className="dash-panel-head"><h2 id="runs-h">Run ที่ยังไม่ปล่อยผล</h2><Link className="button secondary" href="/lab/batches">ไป Batch / Task List</Link></header>
   {runs.rows.length===0?<p className="dash-empty">ไม่มี Run ที่กำลังทำ</p>:
   <div className="table-wrap" role="region" aria-label="ตาราง Run ที่ยังไม่ปล่อยผล" tabIndex={0}><table className="data-table">
    <thead><tr><th scope="col">Run</th><th scope="col">ขั้นที่บันทึกล่าสุด</th><th scope="col" className="num">ตัวอย่าง</th><th scope="col">สร้างเมื่อ</th></tr></thead>
    <tbody>{runs.rows.map(r=><tr key={r.id}><td><Link className="mono strong" href={`/lab/batches/${r.id}`}>{r.runLabel}</Link></td><td><BatchStatus {...r}/></td><td className="num">{r.samples}</td><td className="num">{r.createdAt?displayBeDateTime(r.createdAt):"—"}</td></tr>)}</tbody></table></div>}
  </section>

  <section className="panel dash-panel" aria-labelledby="quality-h">
   <header className="dash-panel-head"><h2 id="quality-h">คุณภาพและปริมาณงาน 6 เดือน</h2>
    <p className="dash-panel-note">{monthLabelLong(quality[0]?.month??"")} – {monthLabelLong(quality.at(-1)?.month??"")} · ไม่รวม EQA และข้อมูลย้อนหลัง</p></header>
   <div className="dash-charts">
    <MonthBars title="รับตัวอย่างและออกผล" note="จำนวนตัวอย่างที่ Lab รับ และผลที่ออกในเดือนนั้น" series={[{name:"รับตัวอย่าง"},{name:"ออกผล"}]} months={quality.map(m=>({month:m.month,values:[m.received,m.released]}))}/>
    <MonthBars title="ออกผลภายใน TAT" note={`ผลที่ออกภายใน ${policy.businessDays} วันทำการ เป็นร้อยละของผลที่ออกในเดือนนั้น`} unit="%" series={[{name:"ภายใน TAT"}]} months={quality.map(m=>({month:m.month,values:[m.released?m.withinTat/m.released*100:null]}))}/>
   </div>
   <div className="table-wrap" role="region" aria-label="ตาราง QC ไม่ผ่านและการตรวจซ้ำรายเดือน" tabIndex={0}><table className="data-table dash-quality-table">
    <caption>QC ไม่ผ่าน การตรวจซ้ำ และเวลาออกผล</caption>
    <thead><tr><th scope="col">เดือน</th><th scope="col" className="num">QC ไม่ผ่าน</th><th scope="col" className="num">Re-Library</th><th scope="col" className="num">Re-Extraction</th><th scope="col" className="num">Re-Sampling</th><th scope="col" className="num">มัธยฐานวันทำการถึงออกผล</th></tr></thead>
    <tbody>{[...quality].reverse().map(m=>{const qc=Object.entries(m.qcFailed),n=qc.reduce((s,[,v])=>s+v,0);return <tr key={m.month}><th scope="row">{monthLabelLong(m.month)}</th>
     <td className="num">{n}{n>0&&<span className="cell-sub">{qc.map(([k,v])=>`${QC_STAGE[k]??k} ${v}`).join(" · ")}</span>}</td>
     <td className="num">{m.repeats.RE_LIBRARY}</td><td className="num">{m.repeats.RE_EXTRACTION}</td><td className="num">{m.repeats.RE_SAMPLING}</td><td className="num">{m.medianDays??"—"}</td></tr>;})}</tbody></table></div>
  </section>
 </>;
}
