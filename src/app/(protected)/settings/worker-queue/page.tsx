import {WorkerQueueActions} from '../../../../components/worker-queue-actions';
import {redirect} from 'next/navigation';
import Link from 'next/link';
import {currentUser} from '../../../../server/http';
import {pool} from '../../../../../packages/db/connection';
import {readWorkerQueueOverview,readPgBossQueueOverview} from '../../../../../packages/jobs/admin-center';
export default async function WorkerQueuePage(){
 const user=(await currentUser())!;
 if(!user.roles.includes('APP_ADMIN'))redirect('/');
 const [data,pgBoss]=await Promise.all([readWorkerQueueOverview(pool(),user),readPgBossQueueOverview(pool(),user)]);
 const fmt=(v:string|Date)=>new Date(v).toLocaleString('th-TH',{timeZone:'Asia/Bangkok'});
 return <main className="stack"><header className="page-header"><div><h1>Worker Queue</h1>
 <p className="muted">รายการงานเบื้องหลังตามหลักฐานฐานข้อมูล (ไม่แสดงข้อมูลผู้ป่วยหรือรายละเอียดการส่ง HIS)</p></div></header>
 <WorkerQueueActions outbox={data.items} archive={data.archiveJobs}/>
 <section className="panel"><h2>Outbox — แยกตามประเภทและสถานะ</h2>
 <div className="table-wrap"><table className="data-table"><thead><tr><th>ชนิด</th><th>สถานะ Outbox</th><th>มี Receipt</th><th>จำนวน</th></tr></thead>
 <tbody>{data.outbox.map((r,i)=><tr key={r.kind+'-'+r.state+'-'+i}><td>{r.kind}</td><td>{r.state}</td><td>{r.completed?'มี':'ไม่มี'}</td><td>{r.count}</td></tr>)}</tbody></table></div>
 <p className="help">สถานะ Dispatched ไม่ได้หมายถึง HIS รับข้อมูลแล้ว ต้องตรวจ Receipt และการตอบรับปลายทางแยกต่างหาก</p></section>
 <section className="panel"><h2>pg-boss — คิว Worker ทุกประเภท</h2>
 <p className="help">สถานะภายใน pg-boss รวม Scheduled / Created / Active / Retry / Completed / Failed ตามข้อมูลที่มีอยู่จริง ไม่แสดง Payload หรือข้อมูลผู้ป่วย และยังไม่อนุญาตให้เคลียร์งานใน pg-boss โดยตรงจนกว่าจะพิสูจน์การประสานสถานะกับ HIS</p>
 <div className="table-wrap"><table className="data-table"><thead><tr><th>ประเภท</th><th>สถานะ pg-boss</th><th>จำนวน</th></tr></thead><tbody>
 {pgBoss.counts.map(r=><tr key={r.kind+'-'+r.job_state}><td>{r.kind}</td><td>{r.job_state}</td><td>{r.job_count}</td></tr>)}</tbody></table></div>
 <h3>งาน pg-boss ล่าสุด (สูงสุด 75)</h3>
 <div className="table-wrap"><table className="data-table"><thead><tr><th>ประเภท</th><th>สถานะ</th><th>กำหนดเริ่ม</th><th>Retry</th><th>Job ID</th></tr></thead><tbody>
 {pgBoss.items.map(r=><tr key={r.job_id}><td>{r.kind}</td><td>{r.job_state}</td><td>{fmt(r.start_after)}</td><td>{r.retry_count}</td><td><code>{r.job_id.slice(0,8)}…</code></td></tr>)}</tbody></table></div>
 </section>
 <section className="panel"><h2>NAS PDF Archive</h2>
 <div className="table-wrap"><table className="data-table"><thead><tr><th>สถานะ</th><th>จำนวน</th></tr></thead>
 <tbody>{data.archive.map(r=><tr key={r.state}><td>{r.state}</td><td>{r.count}</td></tr>)}</tbody></table></div>
 <p><Link href="/settings/operations">ตรวจข้อผิดพลาดและขอ Worker ตรวจ NAS ก่อน Retry</Link></p></section>
 <section className="panel"><h2>รายการล่าสุด (สูงสุด 75)</h2><div className="table-wrap"><table className="data-table">
 <thead><tr><th>สร้างเมื่อ</th><th>ประเภท</th><th>สถานะ</th><th>Receipt</th><th>Job ID</th></tr></thead>
 <tbody>{data.items.map(r=><tr key={r.id}><td>{fmt(r.created_at)}</td><td>{r.kind}</td><td>{r.state}</td><td>{r.completed?'มี':'ไม่มี'}</td><td><code>{r.id.slice(0,8)}…</code></td></tr>)}</tbody></table></div>
 <p className="help">Clear All ยกเลิก Pending ส่วนงาน Dispatched ยังคงสถานะเดิมและต้องตรวจสอบปลายทาง งานอาจยังทำงานต่อ ระบบรักษาประวัติ ผลตรวจ และหลักฐาน HIS</p></section></main>;
}
