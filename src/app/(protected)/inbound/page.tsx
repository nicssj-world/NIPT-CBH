import {currentUser} from "../../../server/http";
import {authorize,requirePermission} from "../../../../packages/security/policy";
import {inboundPageData} from "../../../server/p3/inbound";
import {ScanButton} from "../../../components/system-actions";
import {TestConnectionButton,DeepScanForm,IssueActions,actionLabel} from "../../../components/p3/inbound-actions";

const KIND:Record<string,string>={UNLINKED:"ยังไม่มีเคสในระบบ — รอลงทะเบียน",IDENTITY_MISMATCH:"ตัวระบุไม่ตรงกับที่ผู้ลงทะเบียนบันทึก",IDENTITY_UNVERIFIED:"ไม่มีตัวระบุอิสระให้เทียบ",LN_REUSED_OR_CHANGED:"ข้อมูลตัวตนจาก HIS เปลี่ยนหลังรับรอบที่ 1",LN_REUSED_DIFFERENT_PATIENT:"LN ถูกใช้กับผู้ป่วยอื่น (HN ต่างกัน)",S1_INTEGRITY_EVENT:"ไฟล์ของรอบที่ 1 ส่งมาอีกพร้อมข้อมูลที่เปลี่ยน",HISTORICAL_LN_INTAKE:"LN เป็นเคสย้อนหลัง — ไม่นำไปใช้"};
const FIELD:Record<string,string>={hn:"HN",name:"ชื่อ",dob:"วันเกิด",sex:"เพศ",identity:"เลขประจำตัว",receivedAt:"เวลารับใน HIS",specimenAt:"เวลาเก็บตัวอย่าง",orderAt:"เวลาสั่งตรวจ",ward:"หอผู้ป่วย"};
const STATE:Record<string,string>={Ready:"รอจับคู่","Applied(S1)":"รับรอบที่ 1 แล้ว",Unlinked:"รอเชื่อมกับเคส",Conflict:"ขัดแย้ง — รอตรวจ",S1IntegrityEvent:"เหตุการณ์ตรวจรอบที่ 1",DuplicateSameContent:"ซ้ำ เนื้อหาเดิม",ParseError:"อ่านไฟล์ไม่ได้",HistoricalIntake:"เคสย้อนหลัง"};
const RUN:Record<string,string>={SUCCESS:"สำเร็จ",PARTIAL:"สำเร็จบางส่วน",SHARE_UNAVAILABLE:"เข้าถึงโฟลเดอร์ต้นทางไม่ได้",FAILED:"ล้มเหลว",SKIPPED_BACKOFF:"เว้นช่วงก่อนลองใหม่"};
const TRIGGER:Record<string,string>={INTERVAL:"ตามรอบเวลา",MANUAL:"สแกนทันที",DEEP:"สแกนย้อนหลัง"};
const SHARE:Record<string,string>={UP:"เข้าถึงได้",DOWN:"เข้าถึงไม่ได้",BACKOFF:"เข้าถึงไม่ได้ — รอลองใหม่",UNKNOWN:"ยังไม่เคยสแกน"};
const ALERT:Record<string,string>={INBOUND_NOT_ALIVE:"เปิดใช้งานแต่ไม่มีการสแกนล่าสุด — ตรวจ Worker",INBOUND_SHARE_UNAVAILABLE:"เข้าถึงโฟลเดอร์ตัวจำลองไม่ได้ ระบบจะลองใหม่อัตโนมัติ",OK_SENTINEL_OVERDUE:"มีไฟล์ .pet ที่ยังไม่มี .ok เกิน 15 นาที",PET_PARSE_ERRORS:"มีไฟล์อ่านไม่ได้ใน 24 ชั่วโมง",INBOUND_PARTIAL_FAILURE:"การสแกนล่าสุดสำเร็จบางส่วน — ดูรหัสข้อผิดพลาด"};
const when=(v:Date|string|null)=>v?new Date(v).toLocaleString("th-TH",{timeZone:"Asia/Bangkok"}):"ยังไม่มีข้อมูล";

export default async function InboundPage(){
 const user=(await currentUser())!;requirePermission(user,"his.scan",{},"read");
 const {settings,health,queue,lastTest}=await inboundPageData(user);
 const review=queue.issues.filter(i=>i.kind!=="UNLINKED"),unlinked=queue.issues.filter(i=>i.kind==="UNLINKED");
 const canScan=authorize(user,"his.scan",{},"write"),canConfigure=authorize(user,"integration.configure",{},"write");
 const canPropose=authorize(user,"his.conflict.resolve",{},"propose"),canApprove=authorize(user,"his.conflict.resolve",{actorId:"another-person"},"approve");
 return <>
  <header className="page-header"><div><h1>รับใบสั่งจาก HIS</h1><p className="muted">ตัวจำลองเท่านั้น · อ่านอย่างเดียว · เปลี่ยนสถานะได้เฉพาะรอบที่ 1 — รอบเจาะซ้ำรับในระบบ NIPT</p></div></header>
  <section className="panel" aria-labelledby="inbound-health">
   <h2 id="inbound-health">สถานะการเชื่อมต่อ</h2>
   <p className={`status ${health.healthy?"good":""}`}>{health.healthy?"ทำงานปกติ":settings.enabled?"ต้องตรวจสอบ":"ยังไม่เปิดใช้งานตัวจำลอง"}</p>
   {health.alerts.length>0&&<ul className="notice" aria-label="การแจ้งเตือน">{health.alerts.map(a=><li key={a}>{ALERT[a]??a}</li>)}</ul>}
   <dl>
    <dt>Enabled · เปิดใช้งาน</dt><dd>{health.Enabled?`เปิด (ทุก ${settings.intervalSeconds} วินาที, ย้อนหลัง ${settings.lookbackDays} วัน)`:"ปิด"}</dd>
    <dt>Alive · การสแกนล่าสุด</dt><dd>{health.Alive?"มีการสแกนตามรอบ":"ไม่มีการสแกนในช่วงที่คาดไว้"}</dd>
    <dt>Last Success · สำเร็จล่าสุด</dt><dd>{when(health.LastSuccess)}</dd>
    <dt>Last Error · ข้อผิดพลาดล่าสุด</dt><dd>{health.LastError??"ไม่มี"}</dd>
    <dt>โฟลเดอร์ต้นทาง</dt><dd>{SHARE[health.shareStatus]}{health.nextRetryAt?` · ลองใหม่หลัง ${when(health.nextRetryAt)}`:""}</dd>
    <dt>รอจับคู่ / .ok ค้าง</dt><dd>{health.readyBacklog} ไฟล์ · {health.waitingOkOverdue} ไฟล์ค้างเกิน 15 นาที</dd>
   </dl>
  </section>
  {(canScan||canConfigure)&&<section className="panel stack" aria-labelledby="inbound-actions"><h2 id="inbound-actions">คำสั่ง</h2>
   {canScan&&<ScanButton/>}{canScan&&<DeepScanForm defaultDays={settings.lookbackDays}/>}
   {canConfigure&&<TestConnectionButton/>}
   {lastTest&&<p className="help">ทดสอบล่าสุด {when(lastTest.completed_at)}: {lastTest.result.passed?"ผ่าน":"ไม่ผ่าน"} · โฟลเดอร์วัน {lastTest.result.dayFolders} · คู่ .pet/.ok {lastTest.result.pairedPetFiles} · อ่านตัวอย่าง {lastTest.result.sampleParse}{lastTest.result.errorCode?` · ${lastTest.result.errorCode}`:""}</p>}
  </section>}
  <section className="panel" aria-labelledby="inbound-issues"><h2 id="inbound-issues">รายการที่ต้องตรวจ ({review.length})</h2>
   <p className="help">ไม่แสดงชื่อ HN หรือวันเกิดจาก HIS — ให้ตรวจกับหน้าจอ HIS และเอกสาร/หลอดเลือดโดยตรง การแก้ไขต้องมีผู้เสนอและผู้รับรองคนละคน</p>
   {review.length?<ul className="registry">{review.map(i=><li className="registry-row" key={i.id}>
    <div><span className="registry-label">LN</span><strong>{i.ln}</strong></div>
    <div><span className="registry-label">ชนิด</span>{KIND[i.kind]??i.kind}</div>
    <div><span className="registry-label">ข้อมูลที่ต่างกัน</span>{i.fields.length?i.fields.map(x=>FIELD[x]??x).join(", "):"—"}{i.proposal&&<><br/><span className="status">เสนอแล้ว: {actionLabel(i.proposal.action)}</span></>}</div>
    <details><summary className="min-h-11 cursor-pointer py-2">ดำเนินการ<span className="sr-only"> LN {i.ln}</span></summary><IssueActions issueId={i.id} ln={i.ln??""} allowedActions={i.allowedActions} caseId={i.caseId} proposal={i.proposal} canPropose={canPropose} canApprove={canApprove}/></details>
   </li>)}</ul>:<p>ไม่มีรายการค้าง</p>}
  </section>
  <section className="panel" aria-labelledby="inbound-unlinked"><h2 id="inbound-unlinked">รอลงทะเบียน ({unlinked.length})</h2>
   <p className="help">ไฟล์ที่ยังไม่มีเคสในระบบ จะเชื่อมอัตโนมัติเมื่อ ANC/Lab ลงทะเบียน LN นั้นและตัวระบุที่กรอกตรงกัน (ไม่แสดงค่าจาก HIS ก่อนกรอก)</p>
   {unlinked.length?<ul className="registry">{unlinked.slice(0,30).map(i=><li className="registry-row" key={i.id}>
    <div><span className="registry-label">LN</span><strong>{i.ln}</strong></div><div><span className="registry-label">พบเมื่อ</span>{when(i.createdAt)}</div>
    <div>{i.proposal&&<span className="status">เสนอแล้ว: {actionLabel(i.proposal.action)}</span>}</div>
    <details><summary className="min-h-11 cursor-pointer py-2">ปิดรายการ<span className="sr-only"> LN {i.ln}</span></summary><IssueActions issueId={i.id} ln={i.ln??""} allowedActions={i.allowedActions} caseId={i.caseId} proposal={i.proposal} canPropose={canPropose} canApprove={canApprove}/></details>
   </li>)}</ul>:<p>ไม่มีไฟล์รอลงทะเบียน</p>}
   {unlinked.length>30&&<p className="help">แสดง 30 รายการแรกจาก {unlinked.length} รายการ</p>}
  </section>
  {queue.waiting.length>0&&<section className="panel" aria-labelledby="inbound-waiting"><h2 id="inbound-waiting">ไฟล์ที่ยังไม่มี .ok ({queue.waiting.length})</h2><p className="help">ระบบจะไม่อ่านไฟล์จนกว่า HIS จะสร้าง .ok คู่กัน</p>
   <ul className="registry">{queue.waiting.map(w=><li className="registry-row" key={w.dayFolder+w.ln}><div><span className="registry-label">LN</span>{w.ln}</div><div><span className="registry-label">โฟลเดอร์วัน</span>{w.dayFolder}</div><div><span className="registry-label">พบครั้งแรก</span>{when(w.firstSeenAt)}</div><div/></li>)}</ul></section>}
  <section className="panel" aria-labelledby="inbound-files"><h2 id="inbound-files">ไฟล์ล่าสุด</h2>
   {queue.files.length?<ul className="registry">{queue.files.slice(0,30).map(x=><li className="registry-row" key={x.id}>
    <div><span className="registry-label">LN</span><strong>{x.ln}</strong></div>
    <div><span className="registry-label">โฟลเดอร์วัน / รุ่น</span>{x.dayFolder} · v{x.pathVersion}</div>
    <div><span className="registry-label">สถานะ</span><span className={`status ${x.state==="Applied(S1)"?"good":""}`}>{STATE[x.state]??x.state}</span>{x.errorCode&&<> · รหัส {x.errorCode}</>}</div>
    <div><span className="registry-label">พบเมื่อ</span>{when(x.discoveredAt)}</div>
   </li>)}</ul>:<p>ยังไม่มีไฟล์จากตัวจำลอง</p>}
  </section>
  <section className="panel" aria-labelledby="inbound-runs"><h2 id="inbound-runs">ประวัติการสแกน</h2>
   {queue.runs.length?<ul className="registry">{queue.runs.map(r=><li className="registry-row" key={r.id}>
    <div><span className="registry-label">เวลา</span>{when(r.finishedAt)}</div><div><span className="registry-label">ชนิด</span>{TRIGGER[r.trigger]??r.trigger}</div>
    <div><span className="registry-label">ผล</span>{RUN[r.outcome]??r.outcome}{r.errorCode?` · ${r.errorCode}`:""}</div>
    <div><span className="registry-label">ไฟล์ใหม่ / อ่านไม่ได้</span>{r.counts.stored??0} / {r.counts.parseError??0}</div>
   </li>)}</ul>:<p>ยังไม่มีการสแกน</p>}
  </section>
 </>;
}
