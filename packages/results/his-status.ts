import type {Queryable} from '../db/connection';

export type HisDeliveryStatus={code:string;label:string;tone:'good'|'warning'|'bad'|'info'|'';updatedAt?:string;transferId?:string};
export function hisDeliveryStatus(f:{released?:boolean;attested?:boolean;eqa?:boolean;transferState?:string|null;jobState?:string|null}):HisDeliveryStatus{
 const status=(code:string,label:string,tone:HisDeliveryStatus['tone']=''):HisDeliveryStatus=>({code,label,tone});
 if(f.eqa)return status('NOT_APPLICABLE','ไม่ส่ง HIS');
 if(f.attested)return status('ATTESTED','มีผลใน HIS แล้ว · ผู้ใช้ยืนยัน','info');
 if(!f.released)return status('NOT_RELEASED','ยังไม่ยืนยันผล');
 if(['AWAITING_CONFIRMATION','PICKED_UP_UNCONFIRMED','OK_OBSERVED'].includes(f.transferState??''))return status('DELIVERED_UNCONFIRMED','ส่งไฟล์แล้ว · รอยืนยันจาก HIS','info');
 if(f.transferState==='RETRY_PENDING')return status('RETRY','รอส่งใหม่','warning');
 if(f.transferState==='FAILED_NEEDS_ADMIN'||['Failed','FAILED'].includes(f.jobState??''))return status('FAILED','ส่งไม่สำเร็จ','bad');
 if(['RECONCILIATION_REQUIRED','UNKNOWN_TIMEOUT','CANCELLED','SYNTHETIC_CONFIRMED'].includes(f.transferState??''))return status('NEEDS_ATTENTION','ต้องตรวจสอบการส่ง','warning');
 if(f.transferState)return status('SENDING','กำลังส่ง','info');
 return status('QUEUED','รอส่ง HIS','warning');
}

/** Call only after the caller has checked access to the report/case. Never expose destination paths or payloads. */
export async function readHisDeliveryStatuses(db:Queryable,versionIds:string[]):Promise<Map<string,HisDeliveryStatus>>{
 if(!versionIds.length)return new Map();
 const rows=(await db.query<{id:string;released:boolean;attested:boolean;eqa:boolean;transfer_state:string|null;transfer_id:string|null;updated_at:Date|string|null;job_state:string|null}>(
  `SELECT v.id,r.id IS NOT NULL released,task3_his_presence_attested(v.id) attested,EXISTS(SELECT 1 FROM eqa_case e WHERE e.case_id=v.case_id) eqa,
    t.model->>'state' transfer_state,t.id transfer_id,t.updated_at,j.state job_state
   FROM result_report_version v LEFT JOIN result_release r ON r.version_id=v.id AND r.state='Active'
   LEFT JOIN LATERAL (SELECT x.* FROM p6_transfer x WHERE x.clinical_release_id=r.id ORDER BY x.created_at DESC,x.id DESC LIMIT 1) t ON true
   LEFT JOIN LATERAL (SELECT o.state FROM job_outbox o WHERE o.kind='result_release_completed' AND o.payload->>'releaseId'=r.id::text ORDER BY o.created_at DESC LIMIT 1) j ON true
   WHERE v.id=ANY($1::uuid[])`,[versionIds])).rows;
 return new Map(rows.map(r=>[r.id,{...hisDeliveryStatus({released:r.released,attested:r.attested,eqa:r.eqa,transferState:r.transfer_state,jobState:r.job_state}),
  ...(r.transfer_id?{transferId:r.transfer_id}:{}),...(r.updated_at?{updatedAt:new Date(r.updated_at).toISOString()}:{})}]));
}
