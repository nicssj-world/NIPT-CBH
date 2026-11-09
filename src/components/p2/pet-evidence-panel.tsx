import {displayBeDateTime} from "../../../packages/domain/thai-date";
import {LabIcon} from "../shared/lab-icons";
import type {CasePetEvidence} from "../../../packages/inbound/case-pet-evidence";

const FILE_STATE:Record<string,string>={
 "Applied(S1)":"ใช้รับตัวอย่างครั้งที่ 1","Applied(Redraw)":"ใช้รับตัวอย่างเก็บซ้ำ",DuplicateSameContent:"ไฟล์ซ้ำเนื้อหาเดิม",Conflict:"ข้อมูลขัดแย้ง ต้องตรวจสอบ",
 ParseError:"อ่านไฟล์ไม่ได้",Unlinked:"ยังไม่ผูกกับผู้ป่วย",S1IntegrityEvent:"ข้อมูลเปลี่ยนหลังรับ ต้องตรวจสอบ",Ready:"รอประมวลผล",HistoricalIntake:"นำเข้าข้อมูลเดิม"
};
const COUNTS:[keyof CasePetEvidence["counts"],string,string][]=[
 ["verifiedHisReceipts","ใบรับ HIS ที่ยืนยันแล้ว","นับต่อรอบตัวอย่างที่ HIS รับแล้ว"],
 ["specimenRounds","รอบตัวอย่าง","การเก็บตัวอย่างใหม่ (S1, S2, …) ไม่ใช่จำนวนครั้งที่สแกน"],
 ["petFiles","ไฟล์ PET","ไฟล์ที่ระบบบันทึกไว้สำหรับเคสนี้"],
 ["resendSightings","พบไฟล์เดิมซ้ำ","เนื้อหาเดิมถูกส่งซ้ำ ไม่ถือเป็นรอบหรือเวอร์ชันใหม่"]
];

/** Read-only provenance. Four different counts are shown separately because a scan, a file, a receipt and a specimen are different things. */
export function PetEvidencePanel({evidence}:{evidence:CasePetEvidence}){
  return <details className="panel case-pet-evidence">
  <summary id="pet-evidence-title"><span className="case-sec-icon" aria-hidden="true"><LabIcon name="database" size={22}/></span>ประวัติคำสั่งตรวจจาก HIS</summary>
  {evidence.evidence==="NONE"
   ?<p className="muted">ไม่มีไฟล์ PET ในระบบสำหรับเคสนี้ (เช่นเคสนำเข้าจากระบบเดิมหรือยังไม่ได้รับ PET) ระบบไม่คาดเดาจำนวน</p>
   :<>
    <dl className="compact-facts">{COUNTS.map(([key,label,help])=><div key={key}><dt>{label}</dt><dd><strong>{evidence.counts[key]}</strong><span className="help"> {help}</span></dd></div>)}</dl>
    <p className="help">จำนวนครั้งที่สแกนโฟลเดอร์ผูกกับเคสไม่ได้ เพราะหนึ่งการสแกนครอบคลุมทั้งโฟลเดอร์ ดูประวัติการสแกนที่หน้า “รับตัวอย่างจาก HIS”</p>
    <div className="table-wrap"><table className="table data-table">
     <caption className="sr-only">ไฟล์ PET ของเคสนี้</caption>
     <thead><tr><th scope="col">พบเมื่อ</th><th scope="col">โฟลเดอร์วันที่</th><th scope="col">รอบ</th><th scope="col">สถานะ</th><th scope="col">เวอร์ชันเส้นทาง</th><th scope="col">พบซ้ำ</th><th scope="col">SHA-256</th></tr></thead>
     <tbody>{evidence.files.map(f=><tr key={f.id}>
      <td>{displayBeDateTime(f.discoveredAt)}</td><td>{f.dayFolder??"—"}</td><td>{f.roundNumber??"—"}</td>
      <td><span className={"badge"+(["Conflict","ParseError","S1IntegrityEvent"].includes(f.state)?" danger":"")}>{FILE_STATE[f.state]??f.state}</span>{f.verifiedReceipt&&" · ใบรับ HIS"}</td>
      <td>{f.pathVersion??"—"}</td><td>{f.sightings>1?f.sightings-1:0}</td><td><code>{f.sha256Prefix??"—"}</code></td></tr>)}</tbody>
    </table></div></>}
  </details>;
}
