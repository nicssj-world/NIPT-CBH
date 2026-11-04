type Progress={state:string;pooling_recorded?:boolean;seq_files_exported?:boolean};
const STATE:Record<string,string>={Draft:'ร่าง',InPreparation:'เตรียมงาน',ExtractionLibrary:'Extraction/Library เสร็จ',QC1Complete:'QC1 บันทึกครบ',Cancelled:'ยกเลิก'};
/** One display status; exported files are evidence of export, not completed sequencing. */
export function batchStatusText(progress:Progress){
 if(progress.state==='Cancelled')return STATE.Cancelled;
 if(progress.seq_files_exported)return 'ส่งออกไฟล์ Sequencing แล้ว';
 if(progress.pooling_recorded)return 'บันทึก Pooling แล้ว';
 return STATE[progress.state]??progress.state;
}
export function BatchStatus(progress:Progress){return <span className="badge">{batchStatusText(progress)}</span>;}
