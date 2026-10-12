import {currentUser} from "../../../../../server/http";
import {authorize} from "../../../../../../packages/security/policy";
import {withTransaction} from "../../../../../../packages/db/connection";
import {batchWorkspace} from "../../../../../server/p4-data";
import {BatchWorkspace,type Workspace} from "../../../../../components/p4/batch-workspace";

export default async function BatchPage({params}:{params:Promise<{id:string}>}){
 const user=(await currentUser())!;const {id}=await params;
 if(!authorize(user,"worksheet.read",{},"read")||!/^[a-f0-9-]{36}$/.test(id))return <section className="panel"><h1>Batch</h1><p role="alert">ไม่มีสิทธิ์หรือไม่พบ Batch</p></section>;
 const data=await withTransaction(db=>batchWorkspace(db,user,id)).catch(()=>null);
 if(!data)return <section className="panel"><h1>Batch</h1><p role="alert">ไม่พบ Batch</p></section>;
 return <BatchWorkspace initial={JSON.parse(JSON.stringify(data)) as Workspace} userId={user.id}/>;
}
