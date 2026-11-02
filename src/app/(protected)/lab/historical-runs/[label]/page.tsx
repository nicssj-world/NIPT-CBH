import Link from "next/link";
import {notFound} from "next/navigation";
import {currentUser} from "../../../../../server/http";
import {authorize} from "../../../../../../packages/security/policy";
import {withTransaction} from "../../../../../../packages/db/connection";
import {historicalRunDetail} from "../../../../../../packages/lab/historical-run";

const KIND:Record<string,string>={SAMPLE:"ตัวอย่างผู้ป่วย",CONTROL:"Control",REPEAT:"ตรวจซ้ำทางเทคนิค",EMPTY:"ว่าง"};
const TEMPLATE:Record<string,string>={PC:"Positive Control",NC:"Negative Control",BLANK:"BLANK"};
const ADVICE:Record<string,string>={QUALIFIED:"ผ่านเกณฑ์ HALOS",RERUN:"HALOS แนะนำตรวจซ้ำ",REVIEW:"ต้องทบทวน"};
export default async function HistoricalRunPage({params}:{params:Promise<{label:string}>}){
 const {label}=await params;
 const runLabel=decodeURIComponent(label).replace(/^(Run\d{3})-(\d{4})$/,"$1/$2");
 const user=(await currentUser())!;
 if(!authorize(user,"worksheet.read",{},"read"))return <section className="panel"><h1>Run</h1><p role="alert">ไม่มีสิทธิ์เปิด Run</p></section>;
 const run=await withTransaction(db=>historicalRunDetail(db,user,runLabel));
 if(!run)notFound();
 return <>
  <header className="page-header"><div><h1>{run.runLabel} <span className="badge">ย้อนหลังจาก Genomic-CBH</span></h1>
   <p className="muted">ข้อมูลตามไฟล์วิเคราะห์ HALOS ของระบบเดิม (อ่านอย่างเดียว) — ไม่มี Task List, QC หรือการรับรองผลใน NIPT-CBH สำหรับ Run นี้</p></div>
   <div className="row"><Link className="button secondary" href="/lab/batches">กลับไปรายการ Run</Link></div></header>
  <section className="panel">
   <p><strong>{run.samples}</strong> ตัวอย่างผู้ป่วย · <strong>{run.controls}</strong> Control · <strong>{run.technicalRepeats}</strong> ตรวจซ้ำทางเทคนิค · <strong>{run.withPdf}</strong> เคสมี PDF ผลตรวจเชื่อมแล้ว</p>
   <div className="table-wrap" role="region" aria-label={`ตำแหน่งใน ${run.runLabel}`} tabIndex={0}><table className="data-table"><caption className="sr-only">ตำแหน่ง 1–48 ของ {run.runLabel}</caption>
    <thead><tr><th scope="col">ตำแหน่ง</th><th scope="col">ประเภท</th><th scope="col">LN / Control</th><th scope="col">LN Halos</th><th scope="col">ครั้งที่</th><th scope="col">ข้อแนะนำ HALOS</th><th scope="col">ผลตรวจ</th></tr></thead>
    <tbody>{run.slots.map((s,i)=><tr key={`${s.slot}-${i}`}>
     <td>{s.slot||"—"}{s.template&&<span className="muted"> ({TEMPLATE[s.template]})</span>}</td>
     <td>{KIND[s.kind]}</td>
     <td className="mono">{s.caseId?<Link href={`/cases/${s.caseId}`}>{s.hisLn}</Link>:(s.hisLn??s.label??"—")}</td>
     <td className="mono">{s.lnHalos??"—"}</td>
     <td>{s.attempt??"—"}</td>
     <td>{s.advice?ADVICE[s.advice]??s.advice:"—"}</td>
     <td>{s.hasPdf&&s.caseId?<Link href={`/cases/${s.caseId}/result`}>ดูผลตรวจ</Link>:s.kind==="SAMPLE"||s.kind==="REPEAT"?"ยังไม่มี PDF":"—"}</td></tr>)}</tbody></table></div>
   <p className="help">ตำแหน่ง PC 1, NC 25 และ BLANK 40 เป็นแบบฟอร์ม Task List 48 ตำแหน่ง ตำแหน่งที่ไฟล์ต้นทางไม่มีแถวแสดงเป็น “ว่าง”</p>
  </section>
 </>;
}
