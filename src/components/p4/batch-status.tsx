type Progress={state:string;qc_saved?:boolean;pool_exported?:boolean;pooling_recorded?:boolean;seq_files_exported?:boolean;seq_recorded?:boolean};
const STATE:Record<string,string>={Draft:'ร่าง',InPreparation:'เตรียมงาน',ExtractionLibrary:'Extraction/Library เสร็จ',QC1Complete:'QC1 บันทึกครบ',Cancelled:'ยกเลิก'};
/**
 * One display status, the furthest step with saved evidence (same steps as the Run header: QC, Pooling, Sequencing).
 * Exported files are evidence of export, not completed sequencing; a saved QC revision is evidence of saved QC, not of every field filled.
 */
export function batchStatusText(progress:Progress){
 if(progress.state==='Cancelled')return STATE.Cancelled;
 // Last step (Owner 2026-11-09): the first-cycle sequencing result (Loaded DNB, Q30, BIC, Fit) is saved in Seq Task-G50.
 if(progress.seq_recorded)return 'บันทึกผล Sequencing แล้ว';
 if(progress.seq_files_exported)return 'ส่งออกไฟล์ Sequencing แล้ว';
 if(progress.pooling_recorded)return 'บันทึก Pooling แล้ว';
 if(progress.pool_exported)return 'ส่งออกไฟล์ Pooling แล้ว';
 if(progress.qc_saved)return 'บันทึก QC แล้ว';
 return STATE[progress.state]??progress.state;
}
export function BatchStatus(progress:Progress){return <span className="badge">{batchStatusText(progress)}</span>;}
