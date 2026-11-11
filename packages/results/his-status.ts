import type {Queryable} from '../db/connection';

export type HisDeliveryStatus={code:string;label:string;tone:'good'|'warning'|'bad'|'info'|'';updatedAt?:string;transferId?:string;error?:string};
/** Why a "ส่ง HIS" job did not write the files (codes from packages/p6/send-result.ts and the share checks). */
export const HIS_SEND_ERROR_TEXT:Record<string,string>={
 SHARE_PATH_NOT_FOUND:'ไม่พบโฟลเดอร์ปลายทาง — ตรวจ Path ในตั้งค่า HIS ขาออก',SHARE_NOT_DIRECTORY:'Path ปลายทางไม่ใช่โฟลเดอร์',
 SHARE_PERMISSION_DENIED:'ไม่มีสิทธิ์เขียนโฟลเดอร์ปลายทาง',SHARE_FILE_ACCESS_FAILED:'เขียนไฟล์ไปโฟลเดอร์ปลายทางไม่สำเร็จ',
 SHARE_SYSTEM_PATH_PROHIBITED:'Path ปลายทางเป็นโฟลเดอร์ของระบบ',UNSAFE_SHARE_PATH:'Path ปลายทางไม่ถูกต้อง',
 RES_PROFILE_REQUIRED:'ยังไม่ได้ตั้งค่ารูปแบบ RES ในตั้งค่า HIS ขาออก',CERTIFIER_HIS_MAPPING_REQUIRED:'ยังไม่ได้ตั้ง Operator / ผู้รับรองใน HIS',
 ROUND_PET_EVIDENCE_REQUIRED:'ไม่พบไฟล์ PET จาก HIS ของรอบนี้ (ใช้สร้าง .res)',RELEASE_NOT_ACTIVE:'ผลนี้ถูกยกเลิกแล้ว',RELEASE_NOT_FOUND:'ไม่พบผลที่ส่ง',
 EQA_NO_HIS_OUTBOUND:'EQA ไม่ส่ง HIS',STUCK:'ยังไม่ได้ส่งไฟล์ไป HIS — กดส่ง HIS อีกครั้ง',FAILED:'ส่ง HIS ไม่สำเร็จ — กดส่ง HIS อีกครั้ง',SEND_FAILED:'ส่ง HIS ไม่สำเร็จ — กดส่ง HIS อีกครั้ง',
 NEEDS_ATTENTION:'การส่งแบบเดิมค้างอยู่ — ตรวจโฟลเดอร์ HIS แล้วกดส่ง HIS อีกครั้ง',UNEXPECTED_OK:'พบไฟล์ .ok เดิมในโฟลเดอร์ — ตรวจโฟลเดอร์ HIS แล้วกดส่ง HIS อีกครั้ง',INVALID_RESULT:'ค่าผลไม่ตรงรูปแบบที่ .res รับได้',INVALID_DATE:'วันที่ใน PET ไม่ถูกต้อง',
};
export const hisSendErrorText=(code:string)=>HIS_SEND_ERROR_TEXT[code]??`ส่งไม่สำเร็จ (${code})`;
type SendResult={sent?:boolean;error?:string;transferId?:string;suppressed?:string};
export function hisDeliveryStatus(f:{released?:boolean;attested?:boolean;eqa?:boolean;transferState?:string|null;jobState?:string|null;sendResult?:SendResult|null;stale?:boolean}):HisDeliveryStatus{
 const status=(code:string,label:string,tone:HisDeliveryStatus['tone']=''):HisDeliveryStatus=>({code,label,tone});
 if(f.eqa)return status('NOT_APPLICABLE','ไม่ส่ง HIS');
 if(f.attested)return status('ATTESTED','มีผลใน HIS แล้ว · ผู้ใช้ยืนยัน','info');
 if(!f.released)return status('NOT_RELEASED','ยังไม่ยืนยันผล');
 // Owner 2026-11-11 simple send: the latest "ส่ง HIS" job either wrote PDF/RES/OK or recorded why not.
 if(f.sendResult?.sent===true)return status('SENT','ส่ง HIS แล้ว','good');
 if(f.sendResult?.sent===false)return {...status('FAILED','ส่ง HIS ไม่สำเร็จ','bad'),error:f.sendResult.error??'SEND_FAILED'};
 if(['AWAITING_CONFIRMATION','PICKED_UP_UNCONFIRMED','OK_OBSERVED'].includes(f.transferState??''))return status('DELIVERED_UNCONFIRMED','ส่งไฟล์แล้ว · รอยืนยันจาก HIS','info');
 if(f.transferState==='RETRY_PENDING')return status('RETRY','รอส่งใหม่','warning');
 if(f.transferState==='FAILED_NEEDS_ADMIN'||['Failed','FAILED'].includes(f.jobState??''))return status('FAILED','ส่งไม่สำเร็จ','bad');
 if(['RECONCILIATION_REQUIRED','UNKNOWN_TIMEOUT','CANCELLED','SYNTHETIC_CONFIRMED'].includes(f.transferState??''))return status('NEEDS_ATTENTION','ต้องตรวจสอบการส่ง','warning');
 if(f.transferState)return status('SENDING','กำลังส่ง','info');
 if(f.stale)return status('STUCK','ยังไม่ได้ส่ง — กดส่งอีกครั้ง','warning');
 return status('QUEUED','กำลังส่ง HIS','info');
}

/** Call only after the caller has checked access to the report/case. Never expose destination paths or payloads. */
export async function readHisDeliveryStatuses(db:Queryable,versionIds:string[]):Promise<Map<string,HisDeliveryStatus>>{
 if(!versionIds.length)return new Map();
 const rows=(await db.query<{id:string;released:boolean;attested:boolean;eqa:boolean;transfer_state:string|null;transfer_id:string|null;updated_at:Date|string|null;job_state:string|null;send_result:SendResult|null;stale:boolean|null}>(
  `SELECT v.id,r.id IS NOT NULL released,task3_his_presence_attested(v.id) attested,EXISTS(SELECT 1 FROM eqa_case e WHERE e.case_id=v.case_id) eqa,
    CASE WHEN j.result ? 'transferId' THEN t.model->>'state' END transfer_state,t.id transfer_id,coalesce(j.receipt_at,t.updated_at,j.created_at) updated_at,j.state job_state,
    CASE WHEN j.result ? 'sent' THEN j.result END send_result,(j.result IS NULL AND j.created_at<now()-interval '10 minutes') stale
   FROM result_report_version v LEFT JOIN result_release r ON r.version_id=v.id AND r.state='Active'
   LEFT JOIN LATERAL (SELECT x.* FROM p6_transfer x WHERE x.clinical_release_id=r.id ORDER BY x.created_at DESC,x.id DESC LIMIT 1) t ON true
   LEFT JOIN LATERAL (SELECT o.state,o.created_at,x.result,x.completed_at receipt_at FROM job_outbox o LEFT JOIN integration_job_receipt x ON x.outbox_id=o.id WHERE o.kind='result_release_completed' AND o.payload->>'releaseId'=r.id::text ORDER BY o.created_at DESC LIMIT 1) j ON true
   WHERE v.id=ANY($1::uuid[])`,[versionIds])).rows;
 return new Map(rows.map(r=>[r.id,{...hisDeliveryStatus({released:r.released,attested:r.attested,eqa:r.eqa,transferState:r.transfer_state,jobState:r.job_state,sendResult:r.send_result,stale:!!r.stale}),
  ...(r.transfer_id?{transferId:r.transfer_id}:{}),...(r.updated_at?{updatedAt:new Date(r.updated_at).toISOString()}:{})}]));
}
