import Link from "next/link";
import {redirect} from "next/navigation";
import {currentUser} from "../../../server/http";
import {pool} from "../../../../packages/db/connection";
import {authorize} from "../../../../packages/security/policy";
import {readEqaRegistry,readIqc} from "../../../../packages/eqa/registry";
import {displayBeDateTime} from "../../../../packages/domain/thai-date";
import {EqaRegisterForm} from "../../../components/quality-control/eqa-register-form";
import {EqaDeleteButton} from "../../../components/quality-control/eqa-delete-button";
import {NativeReports} from "../../../components/p5/native-reports";
import {EqaReleaseBoard} from "../../../components/quality-control/eqa-release-board";
import {PdfActions} from "../../../components/quality-control/pdf-actions";
import "../../../components/quality-control/quality-control.css";

type Search={tab?:string;q?:string;year?:string;page?:string;pageSize?:string;control?:string;operator?:string};
const TABS=[["eqa","EQA"],["iqc","IQC Positive / Negative / Blank"]] as const;
const CONTROL_NAME:Record<string,string>={PC:"Positive Control",NC:"Negative Control",BLANK:"Blank"};
const REPORT_STATE:Record<string,string>={Linked:"ฉบับร่าง",ValidationBlocked:"ฉบับร่าง (ติดเงื่อนไข)",PendingCertification:"รอรับรอง",CertifiedReleased:"รับรองแล้ว",Superseded:"ถูกแทนที่",Voided:"ยกเลิก"};
const ATTEMPT:Record<string,string>={Ready:"พร้อมจัดเข้า Batch",Assigned:"จัดเข้า Batch แล้ว",InProgress:"กำลังตรวจ",QcFailed:"QC ไม่ผ่าน",AnalysisComplete:"วิเคราะห์เสร็จ",FinalQcAccepted:"ผ่าน QC สุดท้าย",Final:"ออกผลแล้ว"};
const fmt=(v:string|null)=>v?displayBeDateTime(v):"—";

export default async function QualityControlPage({searchParams}:{searchParams:Promise<Search>}){
 const user=(await currentUser())!;
 if(!authorize(user,"result.review",{},"read"))redirect("/");
 const q=await searchParams,tab=q.tab==="iqc"?"iqc":"eqa";
 const href=(o:Search)=>{const p=new URLSearchParams();for(const [k,v] of Object.entries({tab,...o}))if(v)p.set(k,String(v));return "/quality-control?"+p;};
 const canRegister=authorize(user,"case.register.lab",{origin:"LAB_DIRECT"},"write");
 const units=canRegister?(await pool().query<{id:string;name:string;code:string}>("SELECT id,name,code FROM unit ORDER BY name")).rows.filter(u=>authorize(user,"case.register.lab",{unitId:u.id,origin:"LAB_DIRECT"},"write")):[];
 let body;
 if(tab==="eqa"){
  const d=await readEqaRegistry(pool(),user,{q:q.q,year:q.year,page:q.page,pageSize:q.pageSize});
  body=<><section className="panel" aria-label="ทะเบียน EQA">
   <div className="qc-toolbar">
    <form method="get" className="qc-search" role="search" aria-label="ค้นหา EQA">
     <input type="hidden" name="tab" value="eqa"/>
     <label className="qc-search-year">ปี <select name="year" defaultValue={d.year??""} className="input"><option value="">ทุกปี</option>{d.years.map(y=><option key={y} value={y}>{y}</option>)}</select></label>
     <label className="qc-search-q">ค้นหา <input name="q" defaultValue={d.q??""} className="input" placeholder="HN, ชื่อ, LN, LN Halos" maxLength={80}/></label>
     <button className="button secondary" type="submit">ค้นหา</button>
    </form>
    {canRegister&&<div className="qc-toolbar-primary"><EqaRegisterForm units={units}/></div>}
   </div>
   <div className="table-wrap" role="region" aria-label="ตารางทะเบียน EQA" tabIndex={0}><table className="table data-table qc-registry-table">
    <caption className="sr-only">ทะเบียน EQA</caption>
    <thead><tr><th scope="col">ปี / ผู้จัด</th><th scope="col">ตัวอย่าง</th><th scope="col">LN / LN Halos</th><th scope="col">Run</th><th scope="col">สถานะการตรวจ</th><th scope="col" className="qc-report-col">รายงาน</th></tr></thead>
    <tbody>{d.rows.length===0?<tr><td colSpan={6} className="muted">ยังไม่มีตัวอย่าง EQA ตามเงื่อนไขนี้</td></tr>:d.rows.map(r=><tr key={r.caseId}>
     <td>{r.programYear}<br/><span className="help">{r.organizer}</span></td>
     <td><Link href={`/cases/${r.caseId}`}>{r.sampleRef}</Link><br/><span className="help">{r.firstName} {r.surname} · {r.pregnancy==="Twins"?"แฝด":"เดี่ยว"}</span></td>
     <td><code>{r.ln}</code><br/><code>{r.lnHalos??"ยังไม่ออก"}</code></td>
     <td>{r.run??"ยังไม่จัดเข้า Run"}</td>
     <td>{r.attemptState?ATTEMPT[r.attemptState]??r.attemptState:"—"}<br/><span className="help">รับตัวอย่าง {fmt(r.receivedAt)}</span></td>
     <td className="qc-report">{r.versionId
      ?<div className="qc-report-cell"><span className={"badge"+(r.versionState==="CertifiedReleased"?"":" warning")}>{REPORT_STATE[r.versionState??""]??r.versionState}</span>
        <PdfActions versionId={r.versionId} certified={r.versionState==="CertifiedReleased"}/>
        <span className="help">เวอร์ชัน {r.versions} · {r.certifiedAt?`รับรอง ${fmt(r.certifiedAt)}`:`นำเข้า ${fmt(r.versionAt)}`} · <Link href={`/results/${r.versionId}`}>รายละเอียดการรับรอง</Link></span></div>
      :<div className="qc-report-cell"><span className="muted">ยังไม่มีรายงาน</span>{canRegister&&!r.run&&<EqaDeleteButton caseId={r.caseId} sampleRef={r.sampleRef} lnHalos={r.lnHalos}/>}</div>}</td></tr>)}</tbody>
   </table></div>
   <nav className="pager" aria-label="เลือกหน้า"><span className="pager-summary">หน้า {d.page}/{d.pages} · {d.total} รายการ</span>
    <span className="pager-buttons">{d.page>1&&<Link className="button secondary" href={href({q:d.q??"",year:d.year?String(d.year):"",page:String(d.page-1),pageSize:String(d.pageSize)})}>ก่อนหน้า</Link>}
     {d.page<d.pages&&<Link className="button secondary" href={href({q:d.q??"",year:d.year?String(d.year):"",page:String(d.page+1),pageSize:String(d.pageSize)})}>ถัดไป</Link>}</span></nav>
   <p className="help">EQA ไม่ถูกส่งไป HIS ทุกกรณี รายงานเป็นไฟล์ PDF ภายในที่รับรองด้วยขั้นตอนเดียวกับผู้ป่วย การส่งให้ผู้จัด (GenQA/EMQN) ทำเองผ่านเว็บไซต์ของผู้จัด ระบบยังไม่บันทึกสถานะการส่งเพราะยังไม่มีหลักฐานที่ระบบตรวจสอบได้</p>
   </section>
   <NativeReports canImport={false} scope="EQA"/>
   <EqaReleaseBoard/></>;
 }else{
  const d=await readIqc(pool(),user,{page:q.page,pageSize:q.pageSize,control:q.control,operator:q.operator});
  body=<>
   <div className="tabs" role="group" aria-label="ชนิดตัวควบคุม">
    {[["","ทั้งหมด"],["PC","Positive Control"],["NC","Negative Control"],["BLANK","Blank"]].map(([v,l])=><Link key={v} className="tab" aria-current={(d.control??"")===v?"page":undefined} href={href({control:v,operator:d.operator??"",page:""})}>{l}</Link>)}
   </div>
   <form method="get" className="qc-search iqc-operator-filter" role="search" aria-label="กรองตามผู้ปฏิบัติงาน">
    <input type="hidden" name="tab" value="iqc"/>{d.control&&<input type="hidden" name="control" value={d.control}/>}
    <label className="qc-search-q">ผู้ปฏิบัติงาน (Task List 1) <select name="operator" defaultValue={d.operator??""} className="input"><option value="">ทุกคน</option>{d.operators.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select></label>
    <button className="button secondary" type="submit">กรอง</button>
    {d.operator&&<Link className="button secondary" href={href({control:d.control??"",page:""})}>ล้างตัวกรอง</Link>}
   </form>
   {(()=>{let band=0,last="";const bandOf=(run:string)=>{if(run!==last){if(last)band^=1;last=run;}return band;};return <div className="table-wrap" role="region" aria-label="ตารางค่า Positive / Negative / Blank Control" tabIndex={0}><table className="table data-table iqc-table">
    <caption className="sr-only">ค่า Concentration ของ Positive, Negative และ Blank Control แต่ละ Run</caption>
    <thead><tr><th scope="col">Run</th><th scope="col">วันที่สร้าง Run</th><th scope="col">ชนิด</th><th scope="col">Sample ID</th><th scope="col" className="iqc-center">Concentration (ng/µL)</th><th scope="col">ผู้ปฏิบัติงาน</th></tr></thead>
    <tbody>{d.rows.length===0?<tr><td colSpan={6} className="muted">ยังไม่มีค่า Control ที่บันทึกไว้</td></tr>:d.rows.map(r=><tr key={r.runLabel+r.control} className={bandOf(r.runLabel)?"iqc-run-alt":"iqc-run"}>
     <td>{r.runLabel}</td><td>{fmt(r.runDate)}</td><td>{CONTROL_NAME[r.control]??r.control}</td><td>{r.sampleId??"—"}</td>
     <td className="num iqc-center">{r.concentration??<span className="muted">ไม่มีข้อมูล</span>}</td><td>{r.operator??<span className="muted">—</span>}</td></tr>)}</tbody>
   </table></div>;})()}
   <nav className="pager" aria-label="เลือกหน้า"><span className="pager-summary">หน้า {d.page}/{d.pages} · {d.total} รายการ</span>
    <span className="pager-buttons">{d.page>1&&<Link className="button secondary" href={href({control:d.control??"",operator:d.operator??"",page:String(d.page-1)})}>ก่อนหน้า</Link>}{d.page<d.pages&&<Link className="button secondary" href={href({control:d.control??"",operator:d.operator??"",page:String(d.page+1)})}>ถัดไป</Link>}</span></nav>
   <p className="help">ค่า Concentration (ng/µL) ที่บันทึกในขั้น QC Measurements ของ Positive Control, Negative Control และ Blank ของแต่ละ Run (ฉบับที่บันทึกล่าสุด) ผู้ปฏิบัติงานมาจาก Task List 1 ของ Run นั้น · แถวของ Run เดียวกันมีสีพื้นเดียวกันสลับกับ Run ถัดไป · ระบบไม่คำนวณเกณฑ์ ค่าเฉลี่ย SD หรือผ่าน/ไม่ผ่านเอง</p></>;
 }
 return <main className="stack">
  <header className="page-header"><div><h1>Quality Control</h1><p className="muted">EQA และ IQC ตามหลักฐานที่บันทึกในระบบ</p></div></header>
  <div className="tabs" role="tablist" aria-label="หมวด Quality Control">{TABS.map(([id,label])=><Link key={id} role="tab" className="tab" aria-selected={tab===id} href={href({tab:id,page:"",q:"",year:"",control:"",operator:""})}>{label}</Link>)}</div>
  {tab==="eqa"?body:<section className="panel">{body}</section>}
 </main>;
}
