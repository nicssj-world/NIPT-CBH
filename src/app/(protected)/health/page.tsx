import Link from 'next/link';
import {currentUser} from '../../../server/http';
import {authorize} from '../../../../packages/security/policy';
import {redirect} from 'next/navigation';
import {systemHealth,operationsEvidence} from '../../../server/health';
import {LabIcon,type LabIconName} from '../../../components/shared/lab-icons';
import {HealthRefresh} from '../../../components/health-refresh';
import './health.css';
const ALERT_TEXT:Record<string,string>={WORKER_OFFLINE:'Worker ไม่ทำงานหรือขาดการติดต่อ — ตรวจบริการ Worker',QUEUE_BACKLOG:'มีงานค้างถึงเกณฑ์แจ้งเตือน — ตรวจการประมวลผลของ Worker',QUEUE_STALE:'มีงานรอนานเกินเกณฑ์ — ตรวจงานที่ค้างและ Worker',WORKER_ERROR:'Worker รายงานข้อผิดพลาด — ดูรายละเอียดล่าสุด',HIS_SCAN_FAILURE:'การสแกน HIS ล่าสุดมีปัญหา — ตรวจสถานะการเชื่อมต่อ',TRANSFER_RETRY:'มีงานส่งผลรอลองใหม่ — ตรวจประวัติการส่ง',TRANSFER_RECONCILIATION:'มีงานส่งผลที่ต้องตรวจสอบความสอดคล้อง',TRANSFER_WORKER_ERROR:'Worker ส่งผลรายงานข้อผิดพลาด — ตรวจการเข้าถึงโฟลเดอร์',RUNTIME_MODE_MISMATCH:'โหมด Runtime และฐานข้อมูลไม่ตรงกัน — ให้ IT ตรวจการตั้งค่า',RECOVERY_QUARANTINE:'ระบบถูกกักกันหลังการกู้คืน — ให้ผู้ดูแลตรวจสอบ',MIGRATION_MISMATCH:'โครงสร้างฐานข้อมูลไม่ตรงกับ Source — ให้ IT ตรวจ Migration',RENDERER_UNAVAILABLE:'บริการสร้างเอกสารไม่พร้อม — ตรวจ Renderer',BACKUP_WARNING:'Backup ยังไม่ได้ตั้งค่าหรือยังไม่ได้ตรวจสอบ — ตรวจหน้า Backup / Restore',STORAGE_CAPACITY_WARNING:'พื้นที่จัดเก็บเหลือต่ำกว่า 1 GiB',TLS_EXPIRING:'ใบรับรอง HTTPS ใกล้หมดอายุ (ภายใน 30 วัน)',TLS_UNVERIFIED:'ตรวจใบรับรอง HTTPS ไม่ได้'};
const CRITICAL=new Set(['WORKER_OFFLINE','RUNTIME_MODE_MISMATCH','RECOVERY_QUARANTINE','MIGRATION_MISMATCH','RENDERER_UNAVAILABLE']);
const SHARE:Record<string,string>={UP:'เข้าถึงและอ่านได้',DOWN:'เข้าถึงไม่ได้',BACKOFF:'เข้าถึงไม่ได้ — รอลองใหม่',UNKNOWN:'ยังไม่ทราบ'};
type Tone='good'|'warn'|'bad'|'unknown';
const TONE_TEXT:Record<Tone,string>={good:'ปกติ',warn:'ควรตรวจสอบ',bad:'ต้องแก้ไข',unknown:'ยังไม่ทราบ'};
const when=(v:Date|string|null|undefined)=>v?new Date(v).toLocaleString('th-TH',{timeZone:'Asia/Bangkok'}):'—';

function Tile({icon,title,tone,value,facts,href,linkText}:{icon:LabIconName;title:string;tone:Tone;value:string;facts:[string,string][];href?:string;linkText?:string}){
 return <article className={`health-tile tone-${tone}`} aria-labelledby={`tile-${icon}`}>
  <header><span className="health-tile-icon"><LabIcon name={icon}/></span><h3 id={`tile-${icon}`}>{title}</h3><span className={`health-badge tone-${tone}`}>{TONE_TEXT[tone]}</span></header>
  <p className="health-tile-value">{value}</p>
  <dl>{facts.map(([k,v])=><div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
  {href&&<Link className="health-tile-link" href={href}>{linkText??'ดูรายละเอียด'}<LabIcon name="chevronRight" size={16}/></Link>}
 </article>;
}

export default async function HealthPage(){
 // A role without health.read is sent home (as Settings does) instead of reaching the error boundary; the APIs still answer 403.
 if(!authorize((await currentUser())!,'health.read',{},'read'))redirect('/');
 let h:Awaited<ReturnType<typeof systemHealth>>,ops:Awaited<ReturnType<typeof operationsEvidence>>;
 try{[h,ops]=await Promise.all([systemHealth(),operationsEvidence()]);}catch{return <section className="panel"><h1>สถานะระบบ</h1><p role="alert">ตรวจสถานะไม่สำเร็จ · อ่านข้อมูล PostgreSQL / Runtime ไม่ได้ กรุณาให้ IT ตรวจบริการและ Migration</p><HealthRefresh checkedAt={null}/></section>;}
 const alerts=[...h.alerts,...(h.backup.warning?['BACKUP_WARNING']:[]),...(h.storage.availableBytes!==null&&h.storage.availableBytes<1024**3?['STORAGE_CAPACITY_WARNING']:[]),
  ...(ops.tls.protocol==='https'&&ops.tls.daysLeft!==null&&ops.tls.daysLeft<30?['TLS_EXPIRING']:[]),...(ops.tls.protocol==='https'&&ops.tls.error?['TLS_UNVERIFIED']:[])];
 const workerTone:Tone=h.Alive?(h.LastError?'warn':'good'):h.observedAt?'bad':'unknown';
 const inboundTone:Tone=!ops.inbound.enabled?'unknown':ops.inbound.healthy?'good':!ops.inbound.lastSuccess?'unknown':'bad';
 const outboundTone:Tone=!ops.outbound.configured||!ops.outbound.enabled?'unknown':ops.outbound.attention?'bad':ops.outbound.retry?'warn':'good';
 const queueTone:Tone=h.backlog>=h.thresholds.backlogWarning||h.age>h.thresholds.staleSeconds?'warn':'good';
 const storageTone:Tone=h.storage.availableBytes===null?'unknown':h.storage.availableBytes<1024**3?'bad':h.backup.warning?'warn':'good';
 const tlsTone:Tone=ops.tls.protocol==='http'?'warn':ops.tls.protocol==='UNKNOWN'||ops.tls.error||ops.tls.daysLeft===null?'unknown':ops.tls.daysLeft<30?'warn':'good';
 const integrityTone:Tone=h.modeMatches&&h.migrationsMatch&&!h.quarantined?'good':'bad';
 return <div className="health-page">
  <header className="page-header"><div><h1>สถานะระบบ</h1></div><HealthRefresh checkedAt={ops.checkedAt}/></header>
  <section className={`health-overall tone-${alerts.some(a=>CRITICAL.has(a))?'bad':alerts.length?'warn':'good'}`} aria-live="polite">
   <LabIcon name={alerts.length?'alert':'check'} size={24}/><p><strong>{alerts.some(a=>CRITICAL.has(a))?'มีบริการที่ต้องแก้ไขทันที':alerts.length?`มี ${alerts.length} รายการที่ควรตรวจสอบ`:'บริการที่ตรวจวัดได้ทำงานปกติ'}</strong><span>ตรวจวัดเมื่อ {when(ops.checkedAt)} · ค่าที่วัดไม่ได้แสดงเป็น “ยังไม่ทราบ”</span></p>
  </section>
  {alerts.length>0&&<section className="panel" aria-labelledby="alerts-title"><h2 id="alerts-title">การแจ้งเตือน</h2>
   <ul className="health-alerts">{alerts.map(a=><li key={a}><span className={`status ${CRITICAL.has(a)?'bad':'warning'}`}>{CRITICAL.has(a)?'ต้องตรวจทันที':'ควรตรวจสอบ'}</span><span>{ALERT_TEXT[a]??a}</span><code>{a}</code></li>)}</ul></section>}
  <section aria-labelledby="services-title" className="health-group"><h2 id="services-title">บริการหลัก</h2><div className="health-grid">
   <Tile icon="server" title="Web" tone="good" value="ทำงาน (ตอบหน้านี้)" facts={[['ตรวจเมื่อ',when(ops.checkedAt)]]}/>
   <Tile icon="database" title="ฐานข้อมูล PostgreSQL" tone={ops.dbLatencyMs<500?'good':'warn'} value={`ตอบกลับ ${ops.dbLatencyMs} ms`} facts={[['โหมด',`${h.databaseMode} / Runtime ${h.runtimeMode}`]]}/>
   <Tile icon="cpu" title="Worker" tone={workerTone} value={h.Alive?'ทำงาน':h.observedAt?'ขาดการติดต่อ':'ยังไม่มี Heartbeat'} facts={[['Heartbeat ล่าสุด',h.heartbeatAge===null?'—':`${h.heartbeatAge} วินาทีที่แล้ว (เกณฑ์ ${h.thresholds.staleSeconds})`],['สำเร็จล่าสุด',when(h.LastSuccess)],['ข้อผิดพลาดล่าสุด',h.LastError??'ไม่มี']]}/>
   <Tile icon="printer" title="บริการสร้างเอกสาร (Renderer)" tone={h.renderer==='ALIVE'?'good':h.renderer==='NOT CONFIGURED'?'unknown':'bad'} value={h.renderer==='ALIVE'?'ทำงาน':h.renderer==='NOT CONFIGURED'?'ยังไม่ได้ตั้งค่า':'ไม่ตอบสนอง'} facts={[['ตรวจโดย','เรียก /health ของ Renderer']]}/>
  </div></section>
  <section aria-labelledby="his-title" className="health-group"><h2 id="his-title">HIS และคิวงาน</h2><div className="health-grid">
   <Tile icon="inbox" title="HIS ขาเข้า (PET/OK)" tone={inboundTone} value={!ops.inbound.enabled?'ปิดใช้งาน':ops.inbound.healthy?'ทำงานปกติ':!ops.inbound.lastSuccess?'ยังไม่ทราบ':'ต้องตรวจสอบ'} facts={[['โฟลเดอร์ต้นทาง',SHARE[ops.inbound.share]??ops.inbound.share],['สำเร็จล่าสุด',when(ops.inbound.lastSuccess)],['ข้อผิดพลาดล่าสุด',ops.inbound.lastError??'ไม่มี'],['รอจับคู่ / .ok ค้าง',`${ops.inbound.readyBacklog} / ${ops.inbound.waitingOkOverdue}`]]} href="/inbound" linkText="ไปหน้ารับตัวอย่างจาก HIS"/>
   <Tile icon="send" title="HIS ขาออก (RES/OK + PDF)" tone={outboundTone} value={!ops.outbound.configured?'ยังไม่ได้ตั้งค่า':!ops.outbound.enabled?'ปิดใช้งาน':`เขียนไฟล์แล้ว ${ops.outbound.written} รายการ`} facts={[['เขียนสำเร็จล่าสุด',when(ops.outbound.lastWritten)],['รอส่ง / ลองใหม่ / ต้องตรวจ',`${ops.outbound.pending} / ${ops.outbound.retry} / ${ops.outbound.attention}`],['การยืนยันรับจาก HIS (ACK)','ไม่มีในระบบ — ไม่แสดงว่ารับแล้ว']]} href="/results" linkText="ไปหน้าผลตรวจ NIPT"/>
   <Tile icon="layers" title="คิวงานเบื้องหลัง" tone={queueTone} value={`ค้าง ${h.backlog} งาน`} facts={[['อายุงานเก่าสุด',`${Math.round(h.age)} วินาที`],['เกณฑ์แจ้งเตือน',`${h.thresholds.backlogWarning} งาน / ${h.thresholds.staleSeconds} วินาที`],...ops.queues.slice(0,4).map(q=>[q.kind,`${q.pending} งาน`] as [string,string])]}/>
  </div></section>
  <section aria-labelledby="data-title" className="health-group"><h2 id="data-title">ข้อมูล ความปลอดภัย และการสำรอง</h2><div className="health-grid">
   <Tile icon="archive" title="ที่เก็บไฟล์และ Backup" tone={storageTone} value={h.storage.availableBytes===null?'วัดพื้นที่ไม่ได้':`ว่าง ${Math.round(h.storage.availableBytes/1024**3)} GiB`} facts={[['Backup',`${h.backup.status} / ${h.backup.integrity}`]]} href="/settings/backup" linkText="ไปหน้า Backup / Restore"/>
   <Tile icon="shield" title="HTTPS / ใบรับรอง" tone={tlsTone} value={ops.tls.protocol==='http'?'ไม่ได้ใช้ HTTPS':ops.tls.daysLeft!==null?`หมดอายุใน ${ops.tls.daysLeft} วัน`:'ตรวจไม่ได้'} facts={[['หมดอายุ',when(ops.tls.validTo)],['ชื่อในใบรับรอง',ops.tls.subject??'—'],...(ops.tls.error?[['ข้อผิดพลาด',ops.tls.error] as [string,string]]:[])]}/>
   <Tile icon="check" title="ความสอดคล้องของระบบ" tone={integrityTone} value={integrityTone==='good'?'ตรงกันทั้งหมด':'พบความไม่ตรงกัน'} facts={[['Migration',h.migrationsMatch?'ตรงกับ Source':'ไม่ตรง'],['การกักกันหลังกู้คืน',h.quarantined?'ถูกกักกัน':'ไม่ถูกกักกัน'],['Transfer รอตรวจ',`${h.unresolvedReconciliation} รายการ`]]} href="/settings/audit" linkText="ดู Audit Log"/>
  </div></section>
 </div>;
}
