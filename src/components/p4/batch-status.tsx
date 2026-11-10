import "./batch-status.css";
type Progress={state:string;qc_saved?:boolean;pool_exported?:boolean;pooling_recorded?:boolean;seq_files_exported?:boolean;seq_recorded?:boolean};
/** Every status a Run can show: its own colour (batch-status.css) and the note printed under the Run list. Order = the order of the work. */
export const BATCH_STATUSES:{key:string;text:string;note:string}[]=[
 {key:"draft",text:"ร่าง",note:"สร้าง Run แล้ว ยังไม่เริ่มเตรียมงาน"},
 {key:"prep",text:"เตรียมงาน",note:"กำลังจัดตัวอย่างและตำแหน่งใน Run ยังไม่บันทึกผล QC"},
 {key:"extraction",text:"Extraction/Library เสร็จ",note:"ขั้น Extraction/Library เสร็จแล้ว"},
 {key:"qc1",text:"QC1 บันทึกครบ",note:"บันทึก QC1 ครบแล้ว"},
 {key:"qc",text:"บันทึก QC แล้ว",note:"บันทึกผลวัด QC Measurements ของ Run แล้ว"},
 {key:"pool-file",text:"ส่งออกไฟล์ Pooling แล้ว",note:"ส่งออกไฟล์ Pooling ไปเครื่องแล้ว ยังไม่ได้บันทึกผล Pooling"},
 {key:"pool",text:"บันทึก Pooling แล้ว",note:"บันทึกผล Pooling จริงแล้ว"},
 {key:"seq-file",text:"ส่งออกไฟล์ Sequencing แล้ว",note:"ส่งออกไฟล์ให้เครื่อง Sequencing แล้ว ยังไม่ได้บันทึกผลรอบแรก (Loaded DNB, Q30, BIC, Fit)"},
 {key:"done",text:"Done",note:"บันทึกผล Sequencing รอบแรกครบ 4 ค่า (Loaded DNB, Q30, BIC, Fit) ใน Seq Task-G50 — ขั้นสุดท้าย"},
 {key:"cancelled",text:"ยกเลิก",note:"Run ถูกยกเลิก"},
 {key:"historical",text:"ย้อนหลัง · อ่านอย่างเดียว",note:"Run ที่นำเข้าจากระบบเดิม ดูได้อย่างเดียว แก้ไขไม่ได้"}
];
const KEY_OF_STATE:Record<string,string>={Draft:"draft",InPreparation:"prep",ExtractionLibrary:"extraction",QC1Complete:"qc1",Cancelled:"cancelled"};
const TEXT=Object.fromEntries(BATCH_STATUSES.map(s=>[s.key,s.text]));
/**
 * One display status, the furthest step with saved evidence (same steps as the Run header: QC, Pooling, Sequencing).
 * Exported files are evidence of export, not completed sequencing; a saved QC revision is evidence of saved QC, not of every field filled.
 */
export function batchStatusKey(progress:Progress){
 if(progress.state==="Cancelled")return "cancelled";
 // Last step (Owner 2026-11-09): the first-cycle sequencing result (Loaded DNB, Q30, BIC, Fit) is saved in Seq Task-G50. Shown as "Done" (Owner 2026-11-10).
 if(progress.seq_recorded)return "done";
 if(progress.seq_files_exported)return "seq-file";
 if(progress.pooling_recorded)return "pool";
 if(progress.pool_exported)return "pool-file";
 if(progress.qc_saved)return "qc";
 return KEY_OF_STATE[progress.state]??"other";
}
export function batchStatusText(progress:Progress){const key=batchStatusKey(progress);return TEXT[key]??progress.state;}
export function BatchStatus(progress:Progress){return <span className={`badge batch-status st-${batchStatusKey(progress)}`}>{batchStatusText(progress)}</span>;}
/** "หมายเหตุ" under the Run list: each badge as it looks in the list with what it means. */
export function BatchStatusLegend(){
 return <section className="batch-status-legend" aria-label="หมายเหตุสถานะ Run"><h2>หมายเหตุสถานะ</h2>
  <ul>{BATCH_STATUSES.map(s=><li key={s.key}><span className={`badge batch-status st-${s.key}`}>{s.text}</span><span className="muted">{s.note}</span></li>)}</ul></section>;
}
