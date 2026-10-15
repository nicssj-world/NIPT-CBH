import {currentUser} from '../../../../../../server/http';
import {authorize} from '../../../../../../../packages/security/policy';
import {WorkbookEditor} from '../../../../../../components/p4/workbook-editor';
export default async function WorkbookPage({params}:{params:Promise<{id:string}>}) {
  const user=(await currentUser())!,{id}=await params;
  if(!authorize(user,'worksheet.read',{},'read'))return <section className="panel"><h1>แบบฟอร์ม Excel</h1><p role="alert">ไม่มีสิทธิ์เปิดใบงาน</p></section>;
  return <WorkbookEditor batchId={id} canWrite={authorize(user,'execution.record')}/>;
}
