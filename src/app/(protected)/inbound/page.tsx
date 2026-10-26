import {currentUser} from "../../../server/http";
import {authorize} from "../../../../packages/security/policy";
import {redirect} from "next/navigation";
import {inboundPageData} from "../../../server/p3/inbound";
import {ScanButton} from "../../../components/system-actions";
import {TestConnectionButton,DeepScanForm,IssueActions,actionLabel} from "../../../components/p3/inbound-actions";
import {Pager} from "../../../components/shared/pager";
import {LabIcon,type LabIconName} from "../../../components/shared/lab-icons";
import "./inbound.css";

const KIND:Record<string,string>={UNLINKED:"ยังไม่มีเคสในระบบ — รอลงทะเบียน",IDENTITY_MISMATCH:"ตัวระบุไม่ตรงกับที่ผู้ลงทะเบียนบันทึก",IDENTITY_UNVERIFIED:"ไม่มีตัวระบุอิสระให้เทียบ",LN_REUSED_OR_CHANGED:"ข้อมูลตัวตนจาก HIS เปลี่ยนหลังรับรอบที่ 1",LN_REUSED_DIFFERENT_PATIENT:"LN ถูกใช้กับผู้ป่วยอื่น (HN ต่างกัน)",S1_INTEGRITY_EVENT:"ไฟล์ของรอบที่ 1 ส่งมาอีกพร้อมข้อมูลที่เปลี่ยน",HISTORICAL_LN_INTAKE:"LN เป็นเคสย้อนหลัง — ไม่นำไปใช้"};
const FIELD:Record<string,string>={hn:"HN",name:"ชื่อ",dob:"วันเกิด",sex:"เพศ",identity:"เลขประจำตัว",receivedAt:"เวลารับใน HIS",specimenAt:"เวลาเก็บตัวอย่าง",orderAt:"เวลาสั่งตรวจ",ward:"หน่วยงานส่งตรวจ"};
const STATE:Record<string,string>={Ready:"รอจับคู่","Applied(S1)":"รับรอบที่ 1 แล้ว",Unlinked:"รอเชื่อมกับเคส",Conflict:"ขัดแย้ง — รอตรวจ",S1IntegrityEvent:"เหตุการณ์ตรวจรอบที่ 1",DuplicateSameContent:"ซ้ำ เนื้อหาเดิม",ParseError:"อ่านไฟล์ไม่ได้",HistoricalIntake:"เคสย้อนหลัง"};
const RUN:Record<string,string>={SUCCESS:"สำเร็จ",PARTIAL:"สำเร็จบางส่วน",SHARE_UNAVAILABLE:"เข้าถึงโฟลเดอร์ต้นทางไม่ได้",FAILED:"ล้มเหลว",SKIPPED_BACKOFF:"เว้นช่วงก่อนลองใหม่"};
const TRIGGER:Record<string,string>={INTERVAL:"ตามรอบเวลา",MANUAL:"สแกนทันที",DEEP:"สแกนย้อนหลัง"};
const SHARE:Record<string,string>={UP:"เข้าถึงและอ่านได้",DOWN:"เข้าถึงไม่ได้",BACKOFF:"เข้าถึงไม่ได้ — รอลองใหม่",UNKNOWN:"ยังไม่ทราบ (ยังไม่เคยสแกน)"};
const ALERT:Record<string,string>={INBOUND_NOT_ALIVE:"เปิดใช้งานแต่ไม่มีการสแกนล่าสุด — ตรวจ Worker",INBOUND_SHARE_UNAVAILABLE:"เข้าถึงโฟลเดอร์รับข้อมูลจาก HIS ไม่ได้ ระบบจะลองใหม่อัตโนมัติ",OK_SENTINEL_OVERDUE:"มีไฟล์ .pet ที่ยังไม่มี .ok เกิน 15 นาที",PET_PARSE_ERRORS:"มีไฟล์อ่านไม่ได้ใน 24 ชั่วโมง",INBOUND_PARTIAL_FAILURE:"การสแกนล่าสุดสำเร็จบางส่วน — ดูรหัสข้อผิดพลาด"};
/** OWNER-LAB-017: each path diagnostic step in operator words (folder exists → readable → day folders → .pet/.ok pair → sample read). */
const CHECK:Record<string,string>={SYNTHETIC_ROOT_MARKER:"โฟลเดอร์ทดสอบที่อนุญาต",INBOUND_DIRECTORY:"พบโฟลเดอร์ขาเข้า",DAY_FOLDERS_FOUND:"อ่านรายการโฟลเดอร์วันได้",PET_OK_PAIR_FOUND:"พบคู่ไฟล์ .pet/.ok",SAMPLE_PARSE:"อ่านเนื้อหาไฟล์ตัวอย่างได้"};
const when=(v:Date|string|null)=>v?new Date(v).toLocaleString("th-TH",{timeZone:"Asia/Bangkok"}):"ยังไม่มีข้อมูล";
type Tone="good"|"warn"|"bad"|"unknown";

function StatusCard({icon,label,value,detail,tone,next}:{icon:LabIconName;label:string;value:string;detail?:string;tone:Tone;next?:string}){
 return <article className={`inbound-card tone-${tone}`}><span className="inbound-card-icon"><LabIcon name={icon}/></span><div><h3>{label}</h3><p className="inbound-card-value">{value}</p>{detail&&<p className="inbound-card-detail">{detail}</p>}{next&&<p className="inbound-card-next">ถัดไป: {next}</p>}</div></article>;
}

/** Server-rendered "how old is this timestamp"; kept out of the render body so the purity rule sees no impure call there. */
const ageMs=(iso:string|Date)=>Date.now()-new Date(iso).getTime();
export default async function InboundPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const user=(await currentUser())!;if(!authorize(user,"his.scan",{},"read"))redirect("/");
 const sp=await searchParams,one=(k:string)=>{const v=sp[k];return Array.isArray(v)?v[0]:v;};
 const {settings,health,queue,lastTest}=await inboundPageData(user,{issuesPage:one("issuesPage"),unlinkedPage:one("unlinkedPage"),filesPage:one("filesPage"),runsPage:one("runsPage"),pageSize:one("pageSize"),q:one("q")});
 const review=queue.review.rows,unlinked=queue.unlinked.rows;
 // The lists page independently; each pager keeps the other pages, the page size and the search.
 const keep=()=>({q:queue.search.q||undefined,issuesPage:String(queue.review.page.number),unlinkedPage:String(queue.unlinked.page.number),filesPage:String(queue.files.page.number),runsPage:String(queue.runs.page.number)});
 const canScan=authorize(user,"his.scan",{},"write"),canConfigure=authorize(user,"integration.configure",{},"write");
 const canPropose=authorize(user,"his.conflict.resolve",{},"propose"),canApprove=authorize(user,"his.conflict.resolve",{actorId:"another-person"},"approve");
 // OWNER-LAB-020: green only for a verified, fresh state; never-scanned or stale is "unknown", not healthy.
 const lastSuccessAge=health.LastSuccess?ageMs(health.LastSuccess):null,fresh=lastSuccessAge!==null&&lastSuccessAge<=Math.max(3*settings.intervalSeconds,90)*1000;
 const scanTone:Tone=!settings.enabled?"unknown":health.healthy&&health.Alive&&fresh?"good":!health.LastSuccess?"unknown":"bad";
 const shareTone:Tone=health.shareStatus==="UP"?"good":health.shareStatus==="UNKNOWN"?"unknown":"bad";
 const pending=queue.review.page.total+queue.unlinked.page.total;
 return <div className="inbound-page">
  <header className="page-header"><div><h1>รับตัวอย่างจาก HIS</h1></div></header>
  <section className="inbound-summary" aria-label="สรุปสถานะรับตัวอย่างจาก HIS">
   <StatusCard icon="refresh" label="การสแกนอัตโนมัติ" tone={scanTone} value={!settings.enabled?"ปิดใช้งาน":scanTone==="good"?"ทำงานปกติ":!health.LastSuccess?"ยังไม่ทราบ":"ต้องตรวจสอบ"}
    detail={`สำเร็จล่าสุด ${when(health.LastSuccess)} · ทุก ${settings.intervalSeconds} วินาที`} next={scanTone==="good"?undefined:!settings.enabled?"เปิดใช้งานในตั้งค่า HIS ขาเข้า":"ตรวจ Worker และโฟลเดอร์ต้นทาง"}/>
   <StatusCard icon="inbox" label="โฟลเดอร์ต้นทาง" tone={shareTone} value={SHARE[health.shareStatus]} detail={health.nextRetryAt?`ลองใหม่หลัง ${when(health.nextRetryAt)}`:health.LastError?`ข้อผิดพลาดล่าสุด ${health.LastError}`:undefined} next={shareTone==="good"?undefined:"กดทดสอบการเชื่อมต่อด้านล่าง"}/>
   <StatusCard icon="alert" label="รายการที่ต้องดำเนินการ" tone={pending?"warn":"good"} value={`${pending} รายการ`} detail={`ต้องตรวจ ${queue.review.page.total} · รอลงทะเบียน ${queue.unlinked.page.total}`} next={pending?"ตรวจรายการด้านล่าง":undefined}/>
   <StatusCard icon="clock" label="รอไฟล์ .ok" tone={health.waitingOkOverdue?"bad":queue.waiting.total?"warn":"good"} value={`${queue.waiting.total} ไฟล์`} detail={`ค้างเกิน 15 นาที ${health.waitingOkOverdue} ไฟล์`} next={health.waitingOkOverdue?"แจ้ง IT ตรวจการส่งไฟล์ .ok จาก HIS":undefined}/>
  </section>
  {health.alerts.length>0&&<ul className="notice warning-notice inbound-alerts" aria-label="การแจ้งเตือน">{health.alerts.map(a=><li key={a}>{ALERT[a]??a}</li>)}</ul>}
  {(canScan||canConfigure)&&<section className="panel inbound-actions" aria-labelledby="inbound-actions"><h2 id="inbound-actions">คำสั่ง</h2>
   <div className="inbound-action-grid">
    {canScan&&<div className="inbound-action"><h3>สแกนทันที</h3><ScanButton/></div>}
    {canScan&&<div className="inbound-action"><h3>สแกนย้อนหลัง</h3><DeepScanForm defaultDays={settings.lookbackDays}/></div>}
    {canConfigure&&<div className="inbound-action"><h3>ทดสอบเส้นทางโฟลเดอร์</h3><TestConnectionButton/>
     {lastTest&&<div className="inbound-test"><p className={`status ${lastTest.result.passed?"good":"bad"}`}>{lastTest.result.passed?"ผ่าน":"ไม่ผ่าน"} · {when(lastTest.completed_at)}</p>
      <ul>{lastTest.result.checks.map(c=><li key={c.code} className={c.passed?"pass":"fail"}><LabIcon name={c.passed?"check":"x"} size={16}/>{CHECK[c.code]??c.code}</li>)}</ul>
      <p className="help">โฟลเดอร์วัน {lastTest.result.dayFolders} · คู่ .pet/.ok {lastTest.result.pairedPetFiles}{lastTest.result.errorCode?` · ${lastTest.result.errorCode}`:""}</p></div>}</div>}
   </div>
  </section>}
  {queue.search.enabled&&<section className="panel" aria-label="ค้นหา LN"><form className="search-form" role="search" method="get" action="/inbound"><div className="field"><label htmlFor="inbound-q">ค้นหา LN</label><input id="inbound-q" name="q" type="search" defaultValue={queue.search.q} maxLength={40} autoComplete="off"/></div><input type="hidden" name="pageSize" value={queue.review.page.size}/><button className="button">ค้นหา</button>{queue.search.q&&<a className="button secondary" href={`/inbound?pageSize=${queue.review.page.size}`}>ล้าง</a>}</form></section>}
  <section className="panel" aria-labelledby="inbound-issues"><h2 id="inbound-issues">รายการที่ต้องตรวจ ({queue.review.page.total})</h2>
   <p className="help">ตรวจกับหน้าจอ HIS และเอกสาร/หลอดเลือดโดยตรง การแก้ไขต้องมีผู้เสนอและผู้รับรองคนละคน</p>
   {review.length?<ul className="registry">{review.map(i=><li className="registry-row" key={i.id}>
    <div><span className="registry-label">LN</span><strong className="mono">{i.ln}</strong></div>
    <div><span className="registry-label">ชนิด</span>{KIND[i.kind]??i.kind}</div>
    <div><span className="registry-label">ข้อมูลที่ต่างกัน</span>{i.fields.length?i.fields.map(x=>FIELD[x]??x).join(", "):"—"}{i.proposal&&<><br/><span className="status">เสนอแล้ว: {actionLabel(i.proposal.action)}</span></>}</div>
    <details><summary className="min-h-11 cursor-pointer py-2">ดำเนินการ<span className="sr-only"> LN {i.ln}</span></summary><IssueActions issueId={i.id} ln={i.ln??""} allowedActions={i.allowedActions} caseId={i.caseId} proposal={i.proposal} canPropose={canPropose} canApprove={canApprove}/></details>
   </li>)}</ul>:<p>{queue.search.q?"ไม่มีรายการที่ตรงกับ LN ที่ค้น":"ไม่มีรายการค้าง"}</p>}
   <Pager label="รายการที่ต้องตรวจ" basePath="/inbound" params={keep()} pageParam="issuesPage" page={queue.review.page.number} pageSize={queue.review.page.size} total={queue.review.page.total} totalPages={queue.review.page.totalPages}/>
  </section>
  <section className="panel" aria-labelledby="inbound-unlinked"><h2 id="inbound-unlinked">รอลงทะเบียน ({queue.unlinked.page.total})</h2>
   <p className="help">เชื่อมอัตโนมัติเมื่อลงทะเบียน LN นั้นและตัวระบุที่กรอกตรงกัน</p>
   {unlinked.length?<ul className="registry">{unlinked.map(i=><li className="registry-row" key={i.id}>
    <div><span className="registry-label">LN</span><strong className="mono">{i.ln}</strong></div><div><span className="registry-label">พบเมื่อ</span>{when(i.createdAt)}</div>
    <div>{i.proposal&&<span className="status">เสนอแล้ว: {actionLabel(i.proposal.action)}</span>}</div>
    <details><summary className="min-h-11 cursor-pointer py-2">ปิดรายการ<span className="sr-only"> LN {i.ln}</span></summary><IssueActions issueId={i.id} ln={i.ln??""} allowedActions={i.allowedActions} caseId={i.caseId} proposal={i.proposal} canPropose={canPropose} canApprove={canApprove}/></details>
   </li>)}</ul>:<p>{queue.search.q?"ไม่มีรายการที่ตรงกับ LN ที่ค้น":"ไม่มีไฟล์รอลงทะเบียน"}</p>}
   <Pager label="รอลงทะเบียน" basePath="/inbound" params={keep()} pageParam="unlinkedPage" page={queue.unlinked.page.number} pageSize={queue.unlinked.page.size} total={queue.unlinked.page.total} totalPages={queue.unlinked.page.totalPages}/>
  </section>
  {queue.waiting.total>0&&<section className="panel" aria-labelledby="inbound-waiting"><h2 id="inbound-waiting">ไฟล์ที่ยังไม่มี .ok ({queue.waiting.total})</h2><p className="help">ระบบจะไม่อ่านไฟล์จนกว่า HIS จะสร้าง .ok คู่กัน</p>
   <ul className="registry">{queue.waiting.rows.map(w=><li className="registry-row" key={w.dayFolder+w.ln}><div><span className="registry-label">LN</span><span className="mono">{w.ln}</span></div><div><span className="registry-label">โฟลเดอร์วัน</span>{w.dayFolder}</div><div><span className="registry-label">พบครั้งแรก</span>{when(w.firstSeenAt)}</div><div/></li>)}</ul></section>}
  <section className="panel" aria-labelledby="inbound-files"><h2 id="inbound-files">ไฟล์ล่าสุด ({queue.files.page.total})</h2>
   {queue.files.rows.length?<div className="table-wrap" role="region" aria-label="ไฟล์ล่าสุด" tabIndex={0}><table className="data-table"><thead><tr><th scope="col">LN</th><th scope="col">โฟลเดอร์วัน / รุ่น</th><th scope="col">สถานะ</th><th scope="col">พบเมื่อ</th></tr></thead>
    <tbody>{queue.files.rows.map(x=><tr key={x.id}><td className="mono">{x.ln}</td><td>{x.dayFolder} · v{x.pathVersion}</td><td><span className={`status ${x.state==="Applied(S1)"?"good":x.state==="ParseError"||x.state==="Conflict"?"bad":""}`}>{STATE[x.state]??x.state}</span>{x.errorCode&&<> · รหัส {x.errorCode}</>}</td><td>{when(x.discoveredAt)}</td></tr>)}</tbody></table></div>:<p>{queue.search.q?"ไม่มีไฟล์ที่ตรงกับ LN ที่ค้น":"ยังไม่มีไฟล์จาก HIS"}</p>}
   <Pager label="ไฟล์ล่าสุด" basePath="/inbound" params={keep()} pageParam="filesPage" page={queue.files.page.number} pageSize={queue.files.page.size} total={queue.files.page.total} totalPages={queue.files.page.totalPages}/>
  </section>
  <section className="panel" aria-labelledby="inbound-runs"><h2 id="inbound-runs">ประวัติการสแกน ({queue.runs.page.total})</h2>
   {queue.runs.rows.length?<div className="table-wrap" role="region" aria-label="ประวัติการสแกน" tabIndex={0}><table className="data-table"><thead><tr><th scope="col">เวลา</th><th scope="col">ชนิด</th><th scope="col">ผล</th><th scope="col">ไฟล์ใหม่ / อ่านไม่ได้</th></tr></thead>
    <tbody>{queue.runs.rows.map(r=><tr key={r.id}><td>{when(r.finishedAt)}</td><td>{TRIGGER[r.trigger]??r.trigger}</td><td><span className={`status ${r.outcome==="SUCCESS"?"good":r.outcome==="PARTIAL"||r.outcome==="SKIPPED_BACKOFF"?"warning":"bad"}`}>{RUN[r.outcome]??r.outcome}</span>{r.errorCode?` · ${r.errorCode}`:""}</td><td>{r.counts.stored??0} / {r.counts.parseError??0}</td></tr>)}</tbody></table></div>:<p>ยังไม่มีการสแกน</p>}
   <Pager label="ประวัติการสแกน" basePath="/inbound" params={keep()} pageParam="runsPage" page={queue.runs.page.number} pageSize={queue.runs.page.size} total={queue.runs.page.total} totalPages={queue.runs.page.totalPages}/>
  </section>
 </div>;
}
