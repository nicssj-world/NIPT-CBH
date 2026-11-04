import Link from "next/link";
import {currentUser} from "../../../../server/http";
import {authorize} from "../../../../../packages/security/policy";
import {withTransaction} from "../../../../../packages/db/connection";
import {listUnifiedRunPage} from "../../../../../packages/lab/historical-run";
import {CreateBatchButton} from "../../../../components/p4/create-batch";
import {Pager} from "../../../../components/shared/pager";
import {BatchStatus} from "../../../../components/p4/batch-status";

const SHEET:Record<string,string>={Draft:"ร่าง",PlanChecked:"ยืนยันแผน",PlacementFinalized:"ล็อกตำแหน่ง",PreWorkIssued:"ออกใบงาน",Amended:"แก้แผน",InExecution:"กำลังปฏิบัติ",ExecutionRecorded:"บันทึกจบ",ExecutionVerified:"ทวนสอบแล้ว",CompletedIssued:"เสร็จ",Cancelled:"ยกเลิก"};
export default async function BatchesPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const sp=await searchParams,one=(k:string)=>{const v=sp[k];return Array.isArray(v)?v[0]:v;};
 const user=(await currentUser())!;
 if(!authorize(user,"worksheet.read",{},"read"))return <section className="panel"><h1>Batch / Task List</h1><p role="alert">ไม่มีสิทธิ์เปิด Batch</p></section>;
 const q=(one("q")??"").trim();
 const {rows,page}=await withTransaction(db=>listUnifiedRunPage(db,user,{q,page:one("page")??1,pageSize:one("pageSize")??25}));
 return <>
  <header className="page-header"><div><h1>Batch / Task List</h1><p className="muted">1 Batch = 48 ตำแหน่ง = Task List 1 (1–16), 2 (17–32), 3 (33–48) · Control PC 1, NC 25, Blank 40 · เลข Run รูปแบบ RunNNN/ปี</p></div>
   <div className="row"><Link className="button secondary" href="/lab">กลับไปคิวงาน</Link>{authorize(user,"batch.draft")&&<CreateBatchButton/>}</div></header>
  <section className="panel">
   <form className="search-form" role="search" method="get" action="/lab/batches"><div className="field"><label htmlFor="run-q">ค้นหาเลข Run</label><input id="run-q" name="q" type="search" defaultValue={q} autoComplete="off" maxLength={40}/><p className="help">เช่น 4, Run004 หรือ 2026 — ค้นหาทั้ง Run ปัจจุบันและย้อนหลัง</p></div><input type="hidden" name="pageSize" value={page.size}/><button className="button">ค้นหา</button>{q&&<Link className="button secondary" href={`/lab/batches?pageSize=${page.size}`}>ล้าง</Link>}</form>
   {page.total===0?<p className="empty-state">{q?`ไม่พบ Run ที่ตรงกับ “${q}”`:"ยังไม่มี Run — เริ่มจากคิวงาน Lab แล้วสร้าง Batch"}</p>:
   <div className="table-wrap" role="region" aria-label="รายการ Run ทั้งหมด เรียงเลขล่าสุดก่อน" tabIndex={0}><table className="data-table">
    <caption className="sr-only">Run ทั้งหมด รวม Run ย้อนหลังจาก Genomic-CBH เรียงตามปีและเลข Run จากใหม่ไปเก่า</caption>
    <thead><tr><th scope="col">Run</th><th scope="col">สถานะ</th><th scope="col">ตัวอย่าง</th><th scope="col">รายละเอียด / Task List 1–3</th><th scope="col">สร้างเมื่อ</th></tr></thead>
    <tbody>{rows.map(r=><tr key={r.source+":"+r.run_label}>
     <td><Link className="mono strong" href={r.source==="HISTORICAL"?`/lab/historical-runs/${r.run_label.replace("/","-")}`:`/lab/batches/${r.id}`}>{r.run_label}</Link></td>
     <td>{r.source==="HISTORICAL"?<span className="badge">ย้อนหลัง · อ่านอย่างเดียว</span>:<BatchStatus {...r}/>}</td>
     <td>{r.samples}</td>
     <td>{r.source==="HISTORICAL"?`Control ${r.controls} · ตรวจซ้ำ ${r.technical_repeats} · มี PDF ${r.with_pdf}`:r.sheet_states.map(s=>SHEET[s]??s).join(" / ")}</td>
     <td>{r.created_at?new Date(r.created_at).toLocaleString("th-TH",{timeZone:"Asia/Bangkok",dateStyle:"short",timeStyle:"short"}):"—"}</td>
    </tr>)}</tbody>
   </table></div>}
   {page.total>0&&<Pager label="รายการ Run" basePath="/lab/batches" params={{q:q||undefined}} page={page.number} pageSize={page.size} total={page.total} totalPages={page.totalPages}/>}
  </section>
 </>;
}
