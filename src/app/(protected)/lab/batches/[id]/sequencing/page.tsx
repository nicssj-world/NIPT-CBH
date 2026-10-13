import {currentUser} from '../../../../../../server/http';
import {sequencingWorkspace} from '../../../../../../server/p4c';
import {withTransaction} from '../../../../../../../packages/db/connection';
import {authorize} from '../../../../../../../packages/security/policy';
import {bangkokToday} from '../../../../../../../packages/lab/core';
import {SequencingWorkspace,type SequencingData} from '../../../../../../components/p4/sequencing-workspace';
export default async function SequencingPage({params}:{params:Promise<{id:string}>}){const user=(await currentUser())!,{id}=await params,data=await withTransaction(db=>sequencingWorkspace(db,user,id)).catch(()=>null);
 if(!data)return <section className="panel"><h1>DNB / Sequencing / F5</h1><p role="alert">ไม่มีสิทธิ์หรือไม่พบ Batch</p></section>;
 return <SequencingWorkspace initial={JSON.parse(JSON.stringify(data)) as SequencingData} userId={user.id} today={bangkokToday()} canWrite={authorize(user,'execution.record')} canReview={authorize(user,'observation.verify')} canVerify={authorize(user,'handoff.verify')}/>;}
