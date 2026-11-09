// Pure logic of the results board (no React): which ticks "ส่ง HIS" needs, what an outcome means to the user, and Thai text for reason codes.
export type BoardTab="ACTION"|"READY"|"SENT";
export type BoardReason={code:string;fixHref?:string};
export type SendableRow={key:string;versionId:string|null;rowVersion:number|null;abnormal:boolean;reviewed:boolean};
export type SendOutcome={versionId:string;outcome:"CertifiedReleased"|"BLOCKED"|"ERROR";code?:string;failed?:string[];pending?:string[]};

/** A row can be sent only when it is a version with a row version (HALOS-only rows have neither). */
export const isSendable=(r:SendableRow)=>!!r.versionId&&r.rowVersion!==null;
export const selectedRows=<T extends SendableRow>(rows:T[],selected:ReadonlySet<string>)=>rows.filter(r=>selected.has(r.key)&&isSendable(r));
export const needsReviewTick=(sel:SendableRow[])=>sel.some(r=>!r.reviewed);
export const needsAbnormalTick=(sel:SendableRow[])=>sel.some(r=>r.abnormal);
export type Ticks={reviewConfirmed:boolean;abnormalAcknowledged:boolean};
/** "ส่งที่เลือก" is enabled only when something is selected and every tick that the selection requires has been given. */
export function canSend(sel:SendableRow[],ticks:Ticks){
 if(!sel.length)return false;
 if(needsReviewTick(sel)&&!ticks.reviewConfirmed)return false;
 if(needsAbnormalTick(sel)&&!ticks.abnormalAcknowledged)return false;
 return true;
}
/** The payload ticks: sent as true only when they were required (a tick the user could not see is never sent as given). */
export const sendTicks=(sel:SendableRow[],ticks:Ticks):Ticks=>({reviewConfirmed:needsReviewTick(sel)&&ticks.reviewConfirmed,abnormalAcknowledged:needsAbnormalTick(sel)&&ticks.abnormalAcknowledged});
/** One idempotency key per click-batch: the same key is reused only when the batch (versions + row versions + ticks) is unchanged. */
export const batchSignature=(sel:SendableRow[],t:Ticks)=>JSON.stringify([sel.map(r=>[r.versionId,r.rowVersion]).sort(),t.reviewConfirmed,t.abnormalAcknowledged]);

export const OUTCOME_ERROR_TEXT:Record<string,string>={
 VERSION_CONFLICT:"รายการถูกแก้ไขโดยผู้อื่น — โหลดใหม่แล้วลองอีกครั้ง",SEND_REQUIRES_REVIEWED_RESULT:"รายการนี้ยังไม่อยู่ในสถานะที่ส่ง HIS ได้",
 ABNORMAL_ACK_REQUIRED:"ต้องรับทราบผลผิดปกติก่อนส่ง",REVIEW_CONFIRMATION_REQUIRED:"ต้องยืนยันว่าตรวจผลแล้วก่อนส่ง",NOT_FOUND:"ไม่พบรายการนี้",
 MIGRATION_REVIEW_PRECONDITION_FAILED:"รายการจากระบบเดิมยังไม่ผ่านเงื่อนไขการตรวจรับ — เปิดหน้าผลเพื่อตรวจ",IDEMPOTENCY_KEY_REUSED:"คำขอนี้ถูกใช้กับรายการชุดอื่นแล้ว — ลองส่งใหม่",
 RELEASE_HOLD_AL5:"ผลนี้ส่งแล้ว ไม่สามารถทิ้งได้"};

/** Thai text for one send outcome; `label` resolves a gate/state reason code. */
export function outcomeText(o:SendOutcome,label:(code:string)=>string):string{
 if(o.outcome==="CertifiedReleased")return "ส่ง HIS สำเร็จ — ผลพร้อมให้ ANC เห็นแล้ว";
 if(o.outcome==="BLOCKED"){const rs=[...(o.failed??[]),...(o.pending??[])].map(label);return `ส่งไม่ได้ — ไม่ผ่านการตรวจก่อนส่ง${rs.length?`: ${rs.join(" · ")}`:""}`;}
 return `ส่งไม่สำเร็จ: ${OUTCOME_ERROR_TEXT[o.code??""]??o.code??"เกิดข้อผิดพลาด"}`;
}
export const outcomeTone=(o:SendOutcome)=>o.outcome==="CertifiedReleased"?"good":o.outcome==="BLOCKED"?"warning":"bad";

/** Owner 2026-11-09: any external PDF on the board can be marked "มีผลใน HIS แล้ว". An unlinked one is linked first by the clean rule (HN + lab number, one attempt); if that
 *  is not clean the reason comes back and a person picks the patient. */
export const canShowOnPatient=(r:{versionId:string|null;reasons:{code:string}[]})=>!!r.versionId;
export const ATTEST_ERROR_TEXT:Record<string,string>={
 HIS_ATTESTATION_LINKED_RESULT_REQUIRED:"ยังไม่ได้เชื่อมโยงกับผู้ป่วย — กด “เลือกผู้ป่วย” ก่อน",
 HIS_ATTESTATION_IDENTITY_MISMATCH:"PDF ไม่ตรงกับผู้ป่วยที่เชื่อมไว้ (HN / วันเกิด / เลข Lab) — ตรวจก่อน",
 HUMAN_DECISION_EXISTS:"มีคนตัดสินใจเรื่องผู้ป่วยของ PDF นี้ไว้แล้ว — กด “เลือกผู้ป่วย”",SERIES_NOT_EMPTY:"รอบนี้มีผลอีกฉบับอยู่แล้ว — ตรวจรายการ หรือกด “เลือกผู้ป่วย”",LINK_CONFLICT_NEEDS_HUMAN:"มีข้อขัดแย้งในการเชื่อมโยง — ให้คนตัดสินที่หน้ารายละเอียด",ROUND_NOT_CURRENT:"ไม่ใช่รอบปัจจุบันของเคส",NOT_AN_EXTERNAL_PDF:"ไม่ใช่ PDF จากภายนอก",NOT_A_CLEAN_MATCH:"ระบบจับคู่ผู้ป่วยไม่ได้ชัดเจน — กด “เลือกผู้ป่วย”",
 HIS_ATTESTATION_EXISTS:"ระบุไว้แล้วก่อนหน้านี้",HIS_ATTESTATION_TRANSFER_EXISTS:"เริ่มส่ง HIS แล้ว — ตรวจสถานะการส่ง",
 FORBIDDEN:"ไม่มีสิทธิ์ทำรายการนี้",VERSION_CONFLICT:"มีผู้อื่นเปลี่ยนรายการนี้ — โหลดใหม่แล้วลองอีกครั้ง"};
export const attestErrorText=(code:string)=>ATTEST_ERROR_TEXT[code]??(code.startsWith("AUTO_")?ATTEST_ERROR_TEXT.NOT_A_CLEAN_MATCH:"ทำรายการไม่สำเร็จ");
export const MIN_REASON=8;
export const reasonOk=(s:string)=>s.trim().length>=MIN_REASON;
