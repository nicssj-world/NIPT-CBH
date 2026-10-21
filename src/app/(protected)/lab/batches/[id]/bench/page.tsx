import {currentUser} from '../../../../../../server/http';
import {authorize} from '../../../../../../../packages/security/policy';
import {LabBench} from '../../../../../../components/p4/lab-bench';
export default async function LabBenchPage({params}:{params:Promise<{id:string}>}){
 const user=(await currentUser())!,{id}=await params;
 if(!authorize(user,'worksheet.read',{},'read'))return <section className="panel"><h1>ใบงาน Lab</h1><p role="alert">ไม่มีสิทธิ์เปิดใบงาน</p></section>;
 return <LabBench batchId={id} canWrite={authorize(user,'qc.record')&&authorize(user,'execution.record')}/>;
}
