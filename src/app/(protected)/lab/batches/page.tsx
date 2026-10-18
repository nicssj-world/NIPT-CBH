import Link from "next/link";
import {currentUser} from "../../../../server/http";
import {authorize} from "../../../../../packages/security/policy";
import {withTransaction} from "../../../../../packages/db/connection";
import {listBatchPage} from "../../../../../packages/lab/batch";
import {CreateBatchButton} from "../../../../components/p4/create-batch";
import {Pager} from "../../../../components/shared/pager";

const STATE:Record<string,string>={Draft:"ร่าง",InPreparation:"เตรียมงาน",ExtractionLibrary:"Extraction/Library เสร็จ",QC1Complete:"QC1 บันทึกครบ",Cancelled:"ยกเลิก"};
const SHEET:Record<string,string>={Draft:"ร่าง",PlanChecked:"ยืนยันแผน",PlacementFinalized:"ล็อกตำแหน่ง",PreWorkIssued:"ออกใบงาน",Amended:"แก้แผน",InExecution:"กำลังปฏิบัติ",ExecutionRecorded:"บันทึกจบ",ExecutionVerified:"ทวนสอบแล้ว",CompletedIssued:"เสร็จ",Cancelled:"ยกเลิก"};
export default async function BatchesPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const sp=await searchParams,one=(k:string)=>{const v=sp[k];return Array.isArray(v)?v[0]:v;};
 const user=(await currentUser())!;
 if(!authorize(user,"worksheet.read",{},"read"))return <section className="panel"><h1>Batch / Task List</h1><p role="alert">ไม่มีสิทธิ์เปิด Batch</p></section>;
 const {rows,page}=await withTransaction(db=>listBatchPage(db,user,{q:one("q")??"",page:one("page")??1,pageSize:one("pageSize")??25}));
 const q=(one("q")??"").trim();
 return <>
  <header className="page-header"><div><h1>Batch / Task List</h1><p className="muted">1 Batch = 48 ตำแหน่ง = Task List 1 (1–16), 2 (17–32), 3 (33–48) · Control PC 1, NC 25, Blank 40 · เลข Run รูปแบบ RunNNN/ปี (Genomic-CBH)</p></div>
   <div className="row"><Link className="button secondary" href="/lab">กลับไปคิวงาน</Link>{authorize(user,"batch.draft")&&<CreateBatchButton/>}</div></header>
  <section className="panel">
   <form className="search-form" role="search" method="get" action="/lab/batches"><div className="field"><label htmlFor="run-q">ค้นหาเลข Run</label><input id="run-q" name="q" type="search" defaultValue={q} autoComplete="off" maxLength={40}/><p className="help">เช่น 16, Run016 หรือ 2026 — ค้นจาก Run ทั้งหมดที่เคยสร้าง</p></div><input type="hidden" name="pageSize" value={page.size}/><button className="button">ค้นหา</button>{q&&<Link className="button secondary" href={`/lab/batches?pageSize=${page.size}`}>ล้าง</Link>}</form>
   {page.total===0?<p className="empty-state">{q?`ไม่พบ Run ที่ตรงกับ “${q}”`:"ยังไม่มี Batch — เลือกตัวอย่างจากคิวงานแล้วกด “เพิ่มเข้า Batch”"}</p>:<>
   <div className="table-wrap" role="region" aria-label="รายการ Run" tabIndex={0}><table className="data-table"><caption className="sr-only">Run เรียงจากใหม่ไปเก่า</caption><thead><tr><th scope="col">Run</th><th scope="col">สถานะ</th><th scope="col">ตัวอย่าง</th><th scope="col">Task List 1 / 2 / 3</th><th scope="col">สร้างเมื่อ</th></tr></thead>
    <tbody>{rows.map(b=><tr key={b.id}><td><Link href={`/lab/batches/${b.id}`} className="mono strong">{b.run_label}</Link></td><td>{STATE[b.state]??b.state}</td><td>{b.samples}</td><td>{b.sheet_states.map(s=>SHEET[s]??s).join(" / ")}</td><td>{new Date(b.created_at).toLocaleString("th-TH",{timeZone:"Asia/Bangkok",dateStyle:"short",timeStyle:"short"})}</td></tr>)}</tbody></table></div>
   <Pager label="รายการ Run" basePath="/lab/batches" params={{q:q||undefined}} page={page.number} pageSize={page.size} total={page.total} totalPages={page.totalPages}/></>}</section>
 </>;
}
