// Thai wording for the bulk historical import (P5H). Codes come from packages/historical; unknown codes are shown as-is so nothing is hidden.
export const STATE_TEXT:Record<string,string>={
 Draft:"ต้องแก้ไข",NotEligible:"ยังไม่มีสิทธิ์นำเข้า",Submitted:"พร้อมให้ผู้ตรวจรับรอง",Discrepancy:"ผู้ตรวจพบไม่ตรงต้นฉบับ",Conflict:"ขัดแย้ง (ไม่สร้างเคส)",Promoted:"นำเข้าแล้ว",Abandoned:"ยกเลิกแล้ว",
};
export const STATE_TONE:Record<string,string>={Draft:"bad",NotEligible:"warning",Submitted:"good",Discrepancy:"bad",Conflict:"bad",Promoted:"good",Abandoned:""};
export const BATCH_TEXT:Record<string,string>={Uploaded:"รอ Worker ตรวจ",Staging:"กำลังตรวจ",Staged:"ตรวจแล้ว",Failed:"ตรวจไม่สำเร็จ",Cancelled:"ยกเลิก"};
export const ISSUE_TEXT:Record<string,string>={
 LN_INVALID:"LN ต้องเป็นตัวเลขล้วน",HN_INVALID:"HN ไม่อยู่ในรูปแบบข้อมูลจำลอง",NAME_INVALID:"ชื่อต้องเป็นข้อมูลจำลอง (ขึ้นต้น SYNTHETIC หรือ จำลอง)",ORIGINAL_LOCATION_REQUIRED:"ต้องระบุที่เก็บเอกสารต้นฉบับ",
 DATE_FORMAT_INVALID:"รูปแบบวันที่ไม่ถูกต้อง (ใช้ YYYY-MM-DD ค.ศ.)",DATE_ERA_AMBIGUOUS:"ปี พ.ศ. ไม่รับ — ใช้ปี ค.ศ.",DATE_IMPOSSIBLE:"วันที่ไม่มีอยู่จริง",DATE_OUT_OF_RANGE:"ปีอยู่นอกช่วงที่รับ",DOB_NEEDS_FULL_DATE:"วันเกิดต้องระบุเต็มวัน",YES_NO_INVALID:"ใช้ Y หรือ N",
 PDF_FILE_NOT_FOUND:"ไม่พบไฟล์ PDF ที่ระบุ",PDF_NAME_AMBIGUOUS:"ชื่อไฟล์ PDF ซ้ำหลายไฟล์",PDF_MATCH_AMBIGUOUS:"พบ PDF หลายไฟล์ที่มี LN เดียวกัน",PDF_SHARED_BY_ROWS:"PDF นี้ถูกใช้โดยหลายแถว",
 PDF_HN_MISMATCH:"HN ใน PDF ไม่ตรงกับตาราง",PDF_DOB_MISMATCH:"วันเกิดใน PDF ไม่ตรงกับตาราง",PDF_REPORT_DATE_MISMATCH:"วันที่รายงานใน PDF ไม่ตรงกับตาราง",PDF_NAME_DIFFERS:"ชื่อใน PDF ต่างจากตาราง (ตรวจกับต้นฉบับ)",PDF_LN_DIFFERS:"LN ใน PDF ต่างจากตาราง (ตรวจกับต้นฉบับ)",PDF_CONTENT_NOT_READ:"อ่านเนื้อหา PDF ไม่ได้ — ผู้ตรวจต้องดูต้นฉบับ",
 DUPLICATE_LN_IN_BATCH:"LN ซ้ำในตารางเดียวกัน — แก้หรือยกเลิกแถวที่ซ้ำ",LN_EXISTS_IN_CASE_LN:"LN นี้มีในทะเบียนเคสแล้ว",ACTIVE_DRAFT_EXISTS:"LN นี้อยู่ในการนำเข้าอื่นที่ยังค้าง",INTAKE_EXISTS_FOR_LN:"มีไฟล์ใบสั่งจาก HIS ของ LN นี้",
 IDENTITY_CONFLICT_SAME_HN:"HN ตรงกับผู้ป่วยในทะเบียนแต่ชื่อ/วันเกิดไม่ตรง",HN_ONLY_MATCH_NOT_LINKED:"HN ตรงกับผู้ป่วยในทะเบียนแต่เทียบข้อมูลอื่นไม่ได้ — ไม่เชื่อมอัตโนมัติ ผู้ตรวจดูประกอบ",
 IDENTITY_MATCH_EXISTING_PATIENT_REVIEW:"ผู้ป่วยรายนี้มีในทะเบียนแล้ว — ผู้ตรวจดูประกอบ",POSSIBLE_DUPLICATE_PATIENT_DIFFERENT_HN:"ชื่อและวันเกิดตรงกับผู้ป่วยอื่นที่ HN ต่างกัน — ผู้ตรวจดูประกอบ",
 REVIEW_MISMATCH_LN:"ผู้ตรวจ: LN ไม่ตรงต้นฉบับ",REVIEW_MISMATCH_ANCHORDATE:"ผู้ตรวจ: วันที่ Anchor ไม่ตรงต้นฉบับ",REVIEW_MISMATCH_PDFBINDING:"ผู้ตรวจ: PDF ไม่ใช่ของเคสนี้",REVIEW_MISMATCH_IDENTITY:"ผู้ตรวจ: ตัวตนไม่ตรงต้นฉบับ",
};
export const REASON_TEXT:Record<string,string>={
 ANCHOR_POLICY_NOT_CONFIGURED:"Owner ยังไม่ตัดสินชนิดหลักฐาน Anchor (OD-18)",CUTOFF_NOT_CONFIGURED:"ยังไม่ได้อนุมัติวันตัดระบบ (go_live_cutoff)",NO_ANCHOR:"ไม่มีรายงานผลสุดท้ายที่ลงวันที่ — ไม่มีหลักฐานว่าตรวจเสร็จก่อนเริ่มใช้ระบบ",
 ANCHOR_DATE_NOT_DAY_PRECISION:"วันที่ของรายงานผลต้องระบุเต็มวัน",ANCHOR_NOT_BEFORE_CUTOFF:"วันที่รายงานผลไม่ได้อยู่ก่อนวันตัดระบบ",EVENT_NOT_BEFORE_CUTOFF:"มีเหตุการณ์ที่วันที่ไม่ได้อยู่ก่อนวันตัดระบบ",EVENT_DATE_UNKNOWN:"มีเหตุการณ์ที่ไม่ทราบวันที่",
 LN_ALREADY_REGISTERED:"LN นี้ลงทะเบียนเป็นเคสแล้ว",NIPT_ACTIVITY_PET_APPLIED:"LN นี้มีใบสั่ง .pet ที่ใช้แล้ว",NIPT_ACTIVITY_RECEIVED:"LN นี้มีการรับตัวอย่างใน NIPT",NIPT_ACTIVITY_BATCH:"LN นี้อยู่ใน Batch",NIPT_ACTIVITY_RELEASED:"LN นี้มีการปล่อยผลแล้ว",UNLINKED_INTAKE_AFTER_CUTOFF:"มีใบสั่งจาก HIS หลังวันตัดระบบ — เป็นเคสปัจจุบัน",
};
export const OUTCOME_TEXT:Record<string,string>={PROMOTED:"นำเข้าแล้ว",ALREADY_PROMOTED:"นำเข้าไว้แล้ว",DISCREPANCY:"ไม่ตรงต้นฉบับ — กลับไปแก้",CONFLICT:"ขัดแย้ง — ไม่สร้างเคส",REJECTED:"ไม่ผ่าน"};
export const REJECT_TEXT:Record<string,string>={
 STALE_VERSION:"แถวถูกแก้ไขหลังที่คุณเปิดดู — โหลดหน้าใหม่",SELF_VERIFICATION_PROHIBITED:"คุณเป็นผู้นำเข้า/แก้ไขแถวนี้ ผู้ตรวจต้องเป็นคนอื่น",FORBIDDEN:"ไม่มีสิทธิ์ผู้ตรวจ",ATTESTATION_INCOMPLETE:"ยังตรวจไม่ครบทุกข้อ",
 IDENTITY_NEEDS_TWO_INDEPENDENT_IDENTIFIERS:"ต้องตรวจตัวตนกับต้นฉบับอย่างน้อย 2 ตัวระบุ",REEVALUATION_NOT_ELIGIBLE:"ตรวจสิทธิ์ซ้ำแล้วไม่ผ่าน",DRAFT_NOT_SUBMITTED:"แถวนี้ไม่อยู่ในสถานะพร้อมรับรอง",ALREADY_PROMOTED:"นำเข้าแล้วด้วยคำขอก่อนหน้า",NOT_FOUND:"ไม่พบแถว",DATABASE_GUARD_REFUSED:"ฐานข้อมูลปฏิเสธ (Guard)",
};
export const COLUMN_LABEL:Record<string,string>={ln:"LN",hn:"HN",name:"ชื่อ-สกุล",dob:"วันเกิด",collection_date:"วันที่เจาะเลือด",receipt_date:"วันที่รับตัวอย่าง",report_date:"วันที่รายงานผล",control_record_date:"วันที่บันทึกควบคุม Lab",request_date:"วันที่ใบขอส่งตรวจ",consent_date:"วันที่ใบยินยอม",pdf_file:"ชื่อไฟล์ PDF",original_location:"ที่เก็บต้นฉบับ",request_paper:"มีใบขอส่งตรวจ (Y/N)",consent_paper:"มีใบยินยอม (Y/N)",consent_decision:"Consent ตามที่เขียน",pregnancy_type:"ประเภทครรภ์",past_certification:"การรับรองในอดีต (ข้อความ)"};
export const issueText=(code:string)=>ISSUE_TEXT[code]??REASON_TEXT[code]??code;
