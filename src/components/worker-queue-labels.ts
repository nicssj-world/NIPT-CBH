export const STATUS_LABEL:Record<string,string>={
 PENDING:'รอดำเนินการ',DISPATCHED:'ส่งเข้าคิวแล้ว',RUNNING:'กำลังทำงาน',RETRY:'รอลองใหม่',FAILED:'ล้มเหลว',COMPLETED:'เสร็จสิ้น',
 CANCEL_REQUESTED:'ขอเคลียร์แล้ว รอ Worker',RETRY_REQUESTED:'ขอ Retry แล้ว รอ Worker',CANCELLED:'ยกเลิกแล้ว',
 AWAITING_HIS:'ส่งแล้ว รอ HIS ยืนยัน',RECONCILIATION_REQUIRED:'ต้องตรวจสอบปลายทาง'
};
/** Statuses an Admin can ask to clear. A completed, cancelled, already requested or uncertain item is never offered. */
export const CLEARABLE=['PENDING','DISPATCHED','RUNNING','RETRY','FAILED'];
/** Retry is offered only where a retry cannot cause a second external effect; the Worker re-checks and may still refuse. */
export const RETRYABLE:Record<'OUTBOX'|'ARCHIVE'|'HIS_TRANSFER',string[]>={OUTBOX:['FAILED'],ARCHIVE:['FAILED'],HIS_TRANSFER:['RETRY']};
export const statusTone=(s:string)=>s==='RECONCILIATION_REQUIRED'||s==='FAILED'?'danger':s==='CANCEL_REQUESTED'||s==='RETRY_REQUESTED'||s==='CANCELLED'||s==='AWAITING_HIS'?'warning':'';
