import Link from 'next/link';
import {currentUser} from '../../../server/http';
import {requirePermission} from '../../../../packages/security/policy';
import {systemHealth} from '../../../server/health';
import {LocalAlertTest} from '../../../components/local-alert-test';
const ALERT_TEXT:Record<string,string>={WORKER_OFFLINE:'Worker ไม่ทำงานหรือขาดการติดต่อ — ตรวจบริการ Worker',QUEUE_BACKLOG:'มีงานค้างถึงเกณฑ์แจ้งเตือน — ตรวจการประมวลผลของ Worker',QUEUE_STALE:'มีงานรอนานเกินเกณฑ์ — ตรวจงานที่ค้างและ Worker',WORKER_ERROR:'Worker รายงานข้อผิดพลาด — ดูรายละเอียดล่าสุด',HIS_SCAN_FAILURE:'การสแกน HIS ล่าสุดมีปัญหา — ตรวจสถานะการเชื่อมต่อ',TRANSFER_RETRY:'มีงานส่งผลรอลองใหม่ — ตรวจประวัติการส่ง',TRANSFER_RECONCILIATION:'มีงานส่งผลที่ต้องตรวจสอบความสอดคล้อง',TRANSFER_WORKER_ERROR:'Worker ส่งผลรายงานข้อผิดพลาด — ตรวจการเข้าถึงโฟลเดอร์',RUNTIME_MODE_MISMATCH:'โหมด Runtime และฐานข้อมูลไม่ตรงกัน — ให้ IT ตรวจการตั้งค่า',RECOVERY_QUARANTINE:'ระบบถูกกักกันหลังการกู้คืน — ให้ผู้ดูแลตรวจสอบ',MIGRATION_MISMATCH:'โครงสร้างฐานข้อมูลไม่ตรงกับ Source — ให้ IT ตรวจ Migration',RENDERER_UNAVAILABLE:'บริการสร้างเอกสารไม่พร้อม — ตรวจ Renderer'};
const CRITICAL=new Set(['WORKER_OFFLINE','RUNTIME_MODE_MISMATCH','RECOVERY_QUARANTINE','MIGRATION_MISMATCH','RENDERER_UNAVAILABLE']);
export default async function HealthPage(){
 requirePermission((await currentUser())!,'health.read',{},'read');
 let h:Awaited<ReturnType<typeof systemHealth>>;
 try{h=await systemHealth();}catch{return <section className="panel"><h1>สถานะระบบ</h1><p role="alert">NOT READY · อ่านหลักฐาน PostgreSQL / Runtime ไม่สำเร็จ กรุณาให้ IT ตรวจบริการและ Migration</p></section>;}
 const date=(v:Date|null)=>v?v.toLocaleString('th-TH',{timeZone:'Asia/Bangkok'}):'ยังไม่มีหลักฐานสำเร็จ';
 return <>
 <header className="page-header"><div><h1>สถานะระบบ</h1><p className="muted">ข้อมูลที่ตรวจได้ขณะเปิดหน้า · Technical Health ไม่ใช่ Clinical / Hospital Acceptance</p></div></header>
 <section className="panel runtime-summary" aria-labelledby="runtime-title">
 <div className="status-summary"><h2 id="runtime-title">Runtime / Services</h2><p className={`status ${h.technicalReady?'good':'warning'}`}>{h.technicalReady?'บริการที่ตรวจสอบได้ทำงานปกติ':'NOT READY — มีบริการหรือหลักฐานที่ต้องตรวจสอบ'}</p></div>
 <dl className="service-strip compact-facts">
 <div><dt>Web</dt><dd>{h.web}</dd></div><div><dt>Database · PostgreSQL</dt><dd>{h.postgresql}</dd></div>
 <div><dt>Worker</dt><dd>{h.Alive?'ALIVE':'OFFLINE / STALE'}<small>{h.workerId}</small></dd></div><div><dt>Renderer</dt><dd>{h.renderer}</dd></div>
 </dl>
 <div className="health-groups">
 <section><h3>การทำงานล่าสุด</h3><dl className="compact-facts">
 <div><dt>สำเร็จล่าสุด</dt><dd>{date(h.LastSuccess)}</dd></div><div><dt>ข้อผิดพลาดล่าสุด</dt><dd>{h.LastError??'ไม่มีข้อผิดพลาดที่บันทึก'}</dd></div>
 <div><dt>HIS Auto Scan</dt><dd>{h.inboundEnabled?'เปิด':'ปิด'} · แยกจากสถานะ Process</dd></div><div><dt>Heartbeat / เกณฑ์ Stale</dt><dd>{h.heartbeatAge??'ไม่มี'} / {h.thresholds.staleSeconds} วินาที</dd></div></dl></section>
 <section><h3>คิวงานและความพร้อมของข้อมูล</h3><dl className="compact-facts">
 <div><dt>งานค้าง / เกณฑ์ Backlog</dt><dd>{h.backlog} / {h.thresholds.backlogWarning} งาน · อายุเก่าสุด {Math.round(h.age)} วินาที</dd></div>
 <div><dt>Transfer Retry / Reconciliation</dt><dd>{h.p6Retry} / {h.unresolvedReconciliation} รายการ</dd></div>
 <div><dt>Runtime / Database Mode</dt><dd>{h.runtimeMode} / {h.databaseMode} · {h.modeMatches?'ตรงกัน':'MODE MISMATCH'}</dd></div>
 <div><dt>Migration Ledger / Quarantine</dt><dd>{h.migrationsMatch?'ตรงกับ Source':'MISMATCH'} / {h.quarantined?'QUARANTINED':'ไม่ถูกกักกัน'}</dd></div></dl></section>
 </div></section>
 <section className="panel" aria-labelledby="alerts-title"><h2 id="alerts-title">การแจ้งเตือน</h2>
 {h.alerts.length?<ul className="health-alerts">{h.alerts.map(a=><li key={a}><span className={`status ${CRITICAL.has(a)?'bad':'warning'}`}>{CRITICAL.has(a)?'ต้องตรวจทันที':'ควรตรวจสอบ'}</span><span role="alert">{ALERT_TEXT[a]??a}</span><details><summary>รายละเอียดทางเทคนิค</summary><code>{a}</code></details></li>)}</ul>:<p>ไม่พบ Alert จากบริการที่ตรวจได้</p>}
 <div className="health-support"><p className={h.backup.warning?'notice':'help'}>{h.backup.warning?'Backup ต้องตรวจสอบ':'การติดตาม Backup'} · {h.backup.status} / {h.backup.integrity}<small>{h.backup.warning?'BACKUP_WARNING':'BACKUP_MONITORING'}</small></p>
 {h.storage.availableBytes!==null&&h.storage.availableBytes<1024**3&&<p role="alert">พื้นที่จัดเก็บเหลือต่ำกว่า 1 GiB <code>STORAGE_CAPACITY_WARNING</code></p>}
 <p>File Store: {h.storage.status} · {h.storage.availableBytes===null?'NOT VERIFIED':`${Math.round(h.storage.availableBytes/1024**3)} GiB available`}</p></div>
 <LocalAlertTest/><Link href="/settings/backup">ดู Backup / Restore Monitoring</Link></section>
 </>;
}
