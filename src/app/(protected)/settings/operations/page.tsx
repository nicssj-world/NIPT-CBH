import Link from 'next/link';
import {redirect} from 'next/navigation';
import {currentUser} from '../../../../server/http';
import {pool} from '../../../../../packages/db/connection';
import {authorize} from '../../../../../packages/security/policy';
import {readOperationsOverview} from '../../../../../packages/results/operations-overview';
import {OperationsCenter} from '../../../../components/operations-center';

export default async function OperationsPage(){
 const user=(await currentUser())!;
 if(!authorize(user,'settings.read',{},'read'))redirect('/');
 let summary:Awaited<ReturnType<typeof readOperationsOverview>>|null=null;
 try{summary=await readOperationsOverview(pool(),user);}catch{/* Show a non-sensitive status with no stale data. */}
 if(!summary)return <section className="panel"><h1>งานผิดพลาดและสถิติระบบ</h1>
   <p role="alert">อ่านข้อมูลไม่สำเร็จ กรุณาตรวจ PostgreSQL, Migration และสิทธิ์ APP_ADMIN</p><Link href="/health">ดูสถานะระบบ</Link></section>;
 return <><header className="page-header"><div><h1>งานผิดพลาดและสถิติระบบ</h1>
  <p className="muted">ข้อมูลการจัดเก็บ PDF และการเปิดอ่านเอกสาร ไม่เปลี่ยนสถานะรับรองผลหรือ HIS</p></div></header>
  <OperationsCenter summary={summary}/></>;
}
