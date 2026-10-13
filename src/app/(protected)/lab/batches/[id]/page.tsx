import {currentUser} from "../../../../../server/http";
import Link from 'next/link';
import {authorize} from "../../../../../../packages/security/policy";
import {withTransaction} from "../../../../../../packages/db/connection";
import {batchWorkspace} from "../../../../../server/p4-data";
import {BatchWorkspace,type Workspace} from "../../../../../components/p4/batch-workspace";

export default async function BatchPage({params}:{params:Promise<{id:string}>}){
 const user=(await currentUser())!;const {id}=await params;
 if(!authorize(user,"worksheet.read",{},"read")||!/^[a-f0-9-]{36}$/.test(id))return <section className="panel"><h1>Batch</h1><p role="alert">ไม่มีสิทธิ์หรือไม่พบ Batch</p></section>;
 const data=await withTransaction(db=>batchWorkspace(db,user,id)).catch(()=>null);
 if(!data)return <section className="panel"><h1>Batch</h1><p role="alert">ไม่พบ Batch</p></section>;
 return <><p><Link href={`/lab/batches/${id}/pooling`}>Pooling / QC2 / F4 (สังเคราะห์)</Link> · <Link href={`/lab/batches/${id}/sequencing`}>DNB / Sequencing / F5 (จำลอง)</Link></p><BatchWorkspace initial={JSON.parse(JSON.stringify(data)) as Workspace} userId={user.id}/></>;
}
