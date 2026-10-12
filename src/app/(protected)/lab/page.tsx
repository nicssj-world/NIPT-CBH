import Link from "next/link";
import {currentUser} from "../../../server/http";
import {authorize} from "../../../../packages/security/policy";
import {withTransaction} from "../../../../packages/db/connection";
import {labWorklist} from "../../../../packages/lab/intake";
import {LabWorklist,type WorklistData} from "../../../components/p4/worklist";

export default async function LabPage(){
 const user=(await currentUser())!;
 if(!authorize(user,"worksheet.read",{},"read"))return <section className="panel"><h1>งาน Lab</h1><p role="alert">ไม่มีสิทธิ์เปิดคิวงาน Lab</p></section>;
 const data=JSON.parse(JSON.stringify(await withTransaction(db=>labWorklist(db,user)))) as WorklistData;
 const can={labels:authorize(user,"label.print"),assign:authorize(user,"batch.assign"),receive:authorize(user,"round.receive"),repeat:authorize(user,"repeat.order"),redraw:authorize(user,"redraw.order"),redrawCancel:authorize(user,"redraw.cancel"),hold:authorize(user,"specimen.hold")};
 return <>
  <header className="page-header"><div><h1>งาน Lab — คิวตัวอย่าง</h1><p className="muted">รอบที่ 1 เข้ามาเองจากการรับใน HIS (.pet ที่จับคู่แล้ว) — ไม่มีปุ่มรับซ้ำ · รอบเจาะซ้ำรับในระบบ NIPT · การรับไม่ใช่การจัดเข้า Batch</p></div><Link className="button secondary" href="/lab/batches">Batch / Task List</Link></header>
  <LabWorklist initial={data} can={can}/>
 </>;
}
