import Link from 'next/link';
import {redirect} from 'next/navigation';
import '../../../../components/worker-queue.css';
import {currentUser} from '../../../../server/http';
import {pool} from '../../../../../packages/db/connection';
import {readWorkerQueueOverview,readPgBossQueueOverview} from '../../../../../packages/jobs/admin-center';
import {WorkerQueueActions} from '../../../../components/worker-queue-actions';
import {STATUS_LABEL} from '../../../../components/worker-queue-labels';

type Search={scope?:string;status?:string;page?:string;pageSize?:string};
const SCOPES=[['OUTBOX','HIS Outbox'],['HIS_TRANSFER','HIS Transfer'],['ARCHIVE','NAS PDF Archive'],['PGBOSS','pg-boss (อ่านอย่างเดียว)']] as const;
const fmt=(v:string|Date)=>new Date(v).toLocaleString('th-TH',{timeZone:'Asia/Bangkok',calendar:'buddhist'});

export default async function WorkerQueuePage({searchParams}:{searchParams:Promise<Search>}){
 const user=(await currentUser())!;
 if(!user.roles.includes('APP_ADMIN'))redirect('/');
 const q=await searchParams;
 const scope=SCOPES.some(s=>s[0]===q.scope)?q.scope as 'OUTBOX'|'ARCHIVE'|'HIS_TRANSFER'|'PGBOSS':'OUTBOX';
 const href=(o:Search)=>{const p=new URLSearchParams();for(const [k,v] of Object.entries({scope,...o}))if(v)p.set(k,String(v));return '/settings/worker-queue?'+p;};
 let content;
 if(scope==='PGBOSS'){
  const boss=await readPgBossQueueOverview(pool(),user);
  content=<>
   <p className="help">สถานะภายใน pg-boss ไม่แสดงข้อมูลงาน ผู้ป่วย หรือผลลัพธ์ การยกเลิกหรือ Retry งานใน pg-boss ทำผ่าน Worker เท่านั้น</p>
   <div className="table-wrap"><table className="table data-table"><caption className="sr-only">สรุปงาน pg-boss</caption>
    <thead><tr><th scope="col">ประเภท</th><th scope="col">สถานะ</th><th scope="col">จำนวน</th></tr></thead>
    <tbody>{boss.counts.length===0?<tr><td colSpan={3} className="muted">ยังไม่มีงานใน pg-boss</td></tr>:boss.counts.map(r=><tr key={r.kind+r.job_state}><td>{r.kind}</td><td>{r.job_state}</td><td>{r.job_count}</td></tr>)}</tbody></table></div>
   <h3>งานล่าสุด (สูงสุด 75)</h3>
   <div className="table-wrap"><table className="table data-table"><caption className="sr-only">งาน pg-boss ล่าสุด</caption>
    <thead><tr><th scope="col">สร้างเมื่อ</th><th scope="col">ประเภท</th><th scope="col">สถานะ</th><th scope="col">กำหนดเริ่ม</th><th scope="col">Retry</th></tr></thead>
    <tbody>{boss.items.map(r=><tr key={r.job_id}><td>{fmt(r.created_on)}</td><td>{r.kind}</td><td>{r.job_state}</td><td>{fmt(r.start_after)}</td><td>{r.retry_count}</td></tr>)}</tbody></table></div></>;
 }else{
  const data=await readWorkerQueueOverview(pool(),user,{scope,status:q.status,page:q.page,pageSize:q.pageSize});
  const counts=Object.fromEntries(data.counts.filter(c=>c.scope===scope).reduce<Map<string,number>>((m,c)=>m.set(c.status,(m.get(c.status)??0)+c.count),new Map()));
  content=<>
   <div className="status-summary" role="group" aria-label="กรองตามสถานะ">
    <Link className="tab" aria-current={!data.status?'page':undefined} href={href({status:'',page:''})}>ทั้งหมด</Link>
    {Object.entries(counts).map(([s,n])=><Link key={s} className="tab" aria-current={data.status===s?'page':undefined} href={href({status:s,page:''})}>{STATUS_LABEL[s]??s}<span className="count">{n}</span></Link>)}
   </div>
   {counts.RECONCILIATION_REQUIRED>0&&<p className="notice warning-notice" role="alert">มี {counts.RECONCILIATION_REQUIRED} รายการที่ผลปลายทางไม่แน่ชัด ต้องตรวจสอบกับ HIS หรือ NAS ก่อนดำเนินการต่อ ระบบจะไม่ลองส่งซ้ำเอง</p>}
   <WorkerQueueActions scope={scope} rows={data.rows} counts={counts}/>
   <nav className="pager" aria-label="เลือกหน้า">
    <span className="pager-summary">หน้า {data.page}/{data.pages} · {data.total} รายการ</span>
    <span className="pager-buttons">
     {data.page>1&&<Link className="button secondary" href={href({status:data.status??'',page:String(data.page-1),pageSize:String(data.pageSize)})}>ก่อนหน้า</Link>}
     {data.page<data.pages&&<Link className="button secondary" href={href({status:data.status??'',page:String(data.page+1),pageSize:String(data.pageSize)})}>ถัดไป</Link>}
    </span>
   </nav>
   {scope==='OUTBOX'&&<p className="help">“ส่งเข้าคิวแล้ว” ไม่ได้หมายถึง HIS รับข้อมูลแล้ว ต้องดูใบรับ (สถานะ “เสร็จสิ้น”) เท่านั้น</p>}
   {scope==='HIS_TRANSFER'&&<p className="help">การส่งผลไป HIS ไม่มีปุ่มเคลียร์ ระบบ Retry ให้เฉพาะสถานะ “รอลองใหม่” ส่วน “ต้องตรวจสอบปลายทาง” หรือ “ส่งแล้ว รอ HIS ยืนยัน” อาจถึง HIS แล้ว ระบบจะไม่ส่งซ้ำเอง ต้องตรวจกับ HIS ก่อน</p>}
   {scope==='ARCHIVE'&&<p className="help">ตรวจข้อผิดพลาดของ NAS เพิ่มเติมที่ <Link href="/settings/operations">งานผิดพลาด / PDF Audit</Link></p>}
  </>;
 }
 return <main className="stack">
  <header className="page-header"><div><h1>Worker Queue</h1>
   <p className="muted">งานเบื้องหลังตามหลักฐานในฐานข้อมูล ไม่แสดงข้อมูลผู้ป่วย เส้นทางไฟล์ หรือรายละเอียดการส่ง HIS</p></div></header>
  <div className="tabs" role="tablist" aria-label="หมวดคิว">
   {SCOPES.map(([id,label])=><Link key={id} role="tab" className="tab" aria-selected={scope===id} href={href({scope:id,status:'',page:''})}>{label}</Link>)}
  </div>
  <section className="panel">{content}</section>
 </main>;
}
