import {currentUser} from '../../../../../../server/http';
import {withTransaction} from '../../../../../../../packages/db/connection';
import {workspace} from '../../../../../../../packages/pooling/service';
import {PoolingWorkspace,type PoolingData} from '../../../../../../components/p4/pooling-workspace';
import {authorize} from '../../../../../../../packages/security/policy';
export default async function PoolingPage({params}:{params:Promise<{id:string}>}){
 const user=(await currentUser())!,{id}=await params;
 const data=await withTransaction(db=>workspace(db,user,id)).catch(()=>null);
 if(!data)return <section className="panel"><h1>Pooling / QC2 / F4</h1><p role="alert">ไม่มีสิทธิ์หรือไม่พบ Batch</p></section>;
 return <PoolingWorkspace initial={JSON.parse(JSON.stringify(data)) as PoolingData} userId={user.id} canWrite={authorize(user,'execution.record')} canReview={authorize(user,'observation.verify')}/>;
}
