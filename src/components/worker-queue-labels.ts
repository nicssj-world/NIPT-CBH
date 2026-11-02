export const STATUS_LABEL:Record<string,string>={
 PENDING:'รอดำเนินการ',DISPATCHED:'ส่งเข้าคิวแล้ว',RUNNING:'กำลังทำงาน',RETRY:'รอลองใหม่',FAILED:'ล้มเหลว',COMPLETED:'เสร็จสิ้น',
 CANCEL_REQUESTED:'ขอเคลียร์แล้ว รอ Worker',CANCELLED:'ยกเลิกแล้ว',RECONCILIATION_REQUIRED:'ต้องตรวจสอบปลายทาง'
};
/** Statuses an Admin can ask to clear. A completed, cancelled, already requested or uncertain item is never offered. */
export const CLEARABLE=['PENDING','DISPATCHED','RUNNING','RETRY','FAILED'];
export const statusTone=(s:string)=>s==='RECONCILIATION_REQUIRED'||s==='FAILED'?'danger':s==='CANCEL_REQUESTED'||s==='CANCELLED'?'warning':'';
