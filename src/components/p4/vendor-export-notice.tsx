import Link from 'next/link';
import type {VendorExportIssue} from '../../../packages/sequencing/owner-export';

export function VendorExportNotice({issues}:{issues:VendorExportIssue[]}){
 return <div role="alert" className="notice danger bench-export-errors">
  <strong>ส่งออก XLSX ไม่สำเร็จ · พบข้อมูลที่ต้องตรวจสอบ {issues.length} ตัวอย่าง</strong>
  <p>ตรวจสอบเอกสารต้นทาง แก้ไขและบันทึกข้อมูลของแต่ละรายการ แล้วกลับมาส่งออกอีกครั้ง</p>
  <ul>{issues.map(issue=><li key={issue.slot}>
   <strong>ตำแหน่ง {issue.slot} · <span className="mono">{issue.sampleId}</span></strong>
   <ul>{issue.problems.map(problem=><li key={problem}>{problem}</li>)}</ul>
   {issue.caseId&&<Link href={`/cases/${issue.caseId}`} target="_blank" rel="noopener">เปิดเคส / ใบคำขอของตัวอย่างนี้ <span className="sr-only">{issue.sampleId} (แท็บใหม่)</span></Link>}
  </li>)}</ul>
  <p>ยังไม่ได้สร้างไฟล์ส่งออก</p>
 </div>;
}
