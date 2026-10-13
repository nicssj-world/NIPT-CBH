// Thai vocabulary shared by the P5 screens. Status is always text; colour only supplements it (DESIGN.md).
export const STATE_TEXT:Record<string,string>={Imported:"นำเข้าแล้ว",Parsed:"อ่านค่าแล้ว",RejectedImport:"รูปแบบไม่รู้จัก — ใช้ไม่ได้",Unlinked:"รอเชื่อมโยงกับรอบ/Attempt",LinkConflict:"ข้อมูลไม่ตรง — ต้องแก้",
 Linked:"เชื่อมโยงแล้ว",ValidationBlocked:"ถูกบล็อกโดย Gate",PendingCertification:"รอรับรอง",CertifiedReleased:"ปล่อยผลแล้ว",Superseded:"ถูกแทนด้วยฉบับแก้ไข",Voided:"ยกเลิกแล้ว"};
export const STATE_TONE:Record<string,""|"good"|"warning"|"bad">={Unlinked:"warning",LinkConflict:"bad",ValidationBlocked:"bad",PendingCertification:"warning",CertifiedReleased:"good",Linked:"good",RejectedImport:"bad"};
export const KIND_TEXT:Record<string,string>={SINGLETON:"ผลตรวจ ครรภ์เดี่ยว",TWIN:"ผลตรวจ ครรภ์แฝด",REDRAW_NOTICE:"หนังสือแจ้ง — ไม่ใช่ผลตรวจ",UNKNOWN:"รูปแบบไม่รู้จัก"};
export const CONTAINER_TEXT:Record<string,string>={PDF:"PDF",ZIP_AS_PDF:"ZIP (ชื่อ .pdf)",ZIP_BATCH:"ZIP รวมหลายไฟล์"};
export const INTAKE_TEXT:Record<string,string>={Quarantined:"กักตรวจ",Parsed:"อ่านได้ — พร้อมนำเข้า",Rejected:"ไม่ผ่านการกักตรวจ",Duplicate:"ไฟล์ซ้ำ (เคยนำเข้าแล้ว)",Imported:"นำเข้าแล้ว",Expired:"หมดอายุ — Preview ใหม่"};
export const SCAN_TEXT:Record<string,string>={NEW:"ใหม่",IMPORTED:"นำเข้าแล้ว",DUPLICATE_IN_SCAN:"ซ้ำกับไฟล์อื่นในรอบสแกน",TOO_LARGE:"ใหญ่เกินกำหนด",ZIP_NOT_ACCEPTED:"ปิดรับ ZIP",EMPTY:"ไฟล์ว่าง"};
export const REJECT_TEXT:Record<string,string>={EMPTY_FILE:"ไฟล์ว่าง",FILE_TOO_LARGE:"ไฟล์ใหญ่เกินกำหนด",NOT_PDF_OR_ZIP:"ไม่ใช่ PDF หรือ ZIP (ตรวจจาก Magic bytes)",PDF_UNREADABLE:"เปิด PDF ไม่ได้",PDF_ENCRYPTED:"PDF ใส่รหัสผ่าน",
 PDF_PAGE_COUNT_UNSUPPORTED:"จำนวนหน้าไม่รองรับ",TEXT_NOT_EXTRACTABLE:"อ่านข้อความไม่ได้ (อาจเป็นภาพสแกน)",ZIP_HAS_NO_REPORT_TEXT:"ZIP ไม่มีข้อความรายงาน",ZIP_ENCRYPTED:"ZIP ใส่รหัสผ่าน",ZIP_RATIO_UNSAFE:"ZIP บีบอัดผิดปกติ (ไม่ปลอดภัย)",
 ZIP_CRC_MISMATCH:"ไฟล์ใน ZIP เสียหาย",ZIP_NOT_ACCEPTED:"ปิดรับ ZIP ในการตั้งค่า",NESTED_BATCH_ZIP:"ZIP ซ้อน ZIP",CHANGED_SINCE_SCAN:"ไฟล์เปลี่ยนหลังสแกน — สแกนใหม่",ORIGINAL_UNREADABLE:"อ่านไฟล์ต้นฉบับไม่ได้",FILE_NAME_INVALID:"ชื่อไฟล์ไม่ถูกต้อง"};
export const FOLDER_ERROR_TEXT:Record<string,string>={SIMULATOR_PATH_REQUIRED:"โหมดข้อมูลจำลองอ่านได้เฉพาะโฟลเดอร์ใต้ simulator/results — Path จริงของโรงพยาบาลยัง HOLD",FOLDER_NOT_FOUND:"ไม่พบโฟลเดอร์ (ไดรฟ์ต่อไม่ได้ หรือ Path ผิด)",
 FOLDER_UNREADABLE:"เข้าถึงโฟลเดอร์ไม่ได้",SIMULATOR_MARKER_REQUIRED:"ไม่พบเครื่องหมายโฟลเดอร์ข้อมูลจำลอง",SIMULATOR_ROOT_REQUIRED:"ไม่พบโฟลเดอร์ตัวจำลอง",SYMLINK_PROHIBITED:"ไม่รับ Symbolic link",UNSAFE_PATH:"Path ไม่ปลอดภัย",NOT_A_FOLDER:"Path นี้ไม่ใช่โฟลเดอร์"};
export const CHECK_TEXT:Record<string,string>={SYNTHETIC_PATH:"Path อยู่ในขอบเขตข้อมูลจำลอง",SYNTHETIC_ROOT_MARKER:"พบเครื่องหมายข้อมูลจำลอง",RESULT_FOLDER_EXISTS:"พบโฟลเดอร์",RESULT_FOLDER_READABLE:"Worker อ่านรายการไฟล์ได้",RESULT_FILES_FOUND:"พบไฟล์ .pdf / .zip"};
export const CROSS_TEXT:Record<string,string>={hn:"HN",dob:"วันเกิด",pregnancy:"ประเภทครรภ์",collectionDate:"วันที่เก็บตัวอย่างของรอบ",gestationalAge:"อายุครรภ์",labNumber:"เลข Lab ใน PDF"};
const CROSS_UPPER=Object.fromEntries(Object.entries(CROSS_TEXT).map(([k,v])=>[k.toUpperCase(),v]));
export const CMP_TEXT:Record<string,string>={MATCH:"ตรง",MISMATCH:"ไม่ตรง",NOT_AVAILABLE:"ไม่มีข้อมูล"};
export const CMP_TONE:Record<string,""|"good"|"warning"|"bad">={MATCH:"good",MISMATCH:"bad",NOT_AVAILABLE:"warning"};
export const GATE_NAME:Record<string,string>={"RG-01":"รูปแบบรายงานตาม Template ที่อนุมัติ","RG-02":"ค่าที่จำเป็นอ่านได้ครบ","RG-03":"เชื่อมโยงกับ Attempt เดียวแบบมีผู้ตรวจ","RG-04":"ตัวตนและวันที่เก็บของรอบตรงกัน",
 "RG-05":"เป็น Attempt ปัจจุบันของรอบปัจจุบัน","RG-06":"Batch ไม่ยกเลิกและวิเคราะห์เสร็จ","RG-07":"QC ทุกขั้นยอมรับแล้ว (FinalQcAccepted)","RG-08":"ไม่มีปัญหาตัวตนค้าง","RG-09":"Clinical Gate ของรอบผ่าน",
 "RG-10":"ความยินยอมยังมีผลกับรอบนี้","RG-11":"กฎการเปิดเผยเพศ","RG-12":"ฉบับล่าสุดที่ตรวจทานแล้ว","RG-13":"ผู้รับรองและวิธียืนยัน",
 "RN-01":"รูปแบบหนังสือแจ้งที่อนุมัติ","RN-02":"เชื่อมกับรอบที่ถูกสั่งเจาะซ้ำ","RN-03":"มีคำสั่ง Redraw ก่อนหนังสือแจ้ง","RN-04":"ตัวตนตรงกัน","RN-05":"ไม่ถอนความยินยอม","RN-06":"ไม่ต้องมี QC","RN-07":"ช่องทางปล่อยหนังสือแจ้ง"};
const REASON:Record<string,string>={TEMPLATE_AND_PIC_NOT_APPROVED:"Template/PIC ยังไม่อนุมัติ (รอ OD-07)",PDF_QC_NOT_PASS:"ค่า QC ใน PDF ไม่ใช่ PASS",NOT_LINKED:"ยังไม่เชื่อมโยง",LINK_PROPOSAL_OPEN:"มีข้อเสนอการเชื่อมโยงรอตัดสิน",
 CLINICAL_ANALYSIS_ADAPTER_PENDING:"ยังไม่มีหลักฐานยอมรับการวิเคราะห์ทางคลินิก — รอการรับรองขั้นตอนเชื่อมต่อ",CLINICAL_FINAL_QC_ADAPTER_PENDING:"ยังไม่มีหลักฐานยอมรับ QC ทุกขั้นทางคลินิก — รอ QC5 และการรับรองขั้นตอนเชื่อมต่อ",
 UPSTREAM_EVIDENCE_MISSING:"หลักฐานต้นทางยังไม่ครบ — ตรวจสอบ Pool, DNB และรอบ Sequencing",UPSTREAM_SLOT_AMBIGUOUS:"พบตำแหน่งใช้งานมากกว่าหนึ่งตำแหน่ง — ให้ห้องปฏิบัติการตรวจสอบ",
 UPSTREAM_POOL_MEMBER_STALE:"สมาชิก Pool ปัจจุบันไม่ตรง Attempt — ตรวจสอบต้นทางก่อนดำเนินการ",UPSTREAM_POOL_STOP_USE:"Pool ถูกระงับใช้ — ให้ห้องปฏิบัติการตรวจสอบต้นทาง",UPSTREAM_POOL_INACTIVE:"Pool ถูก Hold หรือแทนที่ — ตรวจสอบฉบับปัจจุบัน",
 UPSTREAM_POOL_RECALLED:"สำเนา F4 ถูกเรียกคืน — ตรวจสอบฉบับปัจจุบัน",UPSTREAM_POOL_INCOMPLETE:"หลักฐาน Pool ยังไม่ครบ — ให้ห้องปฏิบัติการบันทึกตามขั้นตอน",UPSTREAM_POOL_SOURCE_CHANGED:"หลักฐานต้นทาง Pool เปลี่ยน — ตรวจสอบและออกฉบับใหม่ตามขั้นตอน",
 UPSTREAM_DNB_MISSING:"ยังไม่มี DNB — ให้ห้องปฏิบัติการดำเนินการตามขั้นตอน",UPSTREAM_DNB_STALE:"DNB ไม่ตรง Pool ปัจจุบัน — ตรวจสอบฉบับปัจจุบัน",UPSTREAM_DNB_STOP_USE:"DNB ถูกระงับใช้ — ให้ห้องปฏิบัติการตรวจสอบต้นทาง",UPSTREAM_DNB_INACTIVE:"DNB ถูก Hold หรือแทนที่ — ตรวจสอบฉบับปัจจุบัน",
 UPSTREAM_DNB_RECALLED:"สำเนา F5 ถูกเรียกคืน — ตรวจสอบฉบับปัจจุบัน",UPSTREAM_SEQUENCE_MISSING:"ยังไม่มีรอบ Sequencing — ให้ห้องปฏิบัติการดำเนินการตามขั้นตอน",UPSTREAM_SEQUENCE_HOLD:"รอบ Sequencing ปัจจุบันถูก Hold — ให้ห้องปฏิบัติการตรวจสอบ",
 UPSTREAM_POOL_RECALL_PENDING:"Pool ถูกระงับใช้และมีสำเนา F4 รอเรียกคืน — ให้ห้องปฏิบัติการเรียกคืนสำเนา",UPSTREAM_DNB_RECALL_PENDING:"DNB ถูกระงับใช้และมีสำเนา F5 รอเรียกคืน — ให้ห้องปฏิบัติการเรียกคืนสำเนา",
 NOT_CURRENT_ROUND:"ไม่ใช่รอบปัจจุบัน",REDRAW_REQUESTED:"สั่งเก็บตัวอย่างใหม่แล้ว",REPEAT_ORDER_OPEN:"มีคำสั่งตรวจซ้ำค้าง",BATCH_CANCELLED:"Batch ถูกยกเลิก",NO_ACTIVE_SLOT:"ไม่มีตำแหน่งใน Batch",
 ANALYSIS_COMPLETION_NOT_RECORDED:"ยังไม่มีบันทึกวิเคราะห์เสร็จ — รอ P4b",FINAL_QC_NOT_ACCEPTED:"ยังไม่ใช่ FinalQcAccepted — รอ QC4/QC5 จาก P4b",QC1_ONLY_NOT_FINAL_QC_ACCEPTED:"ผ่าน QC1 อย่างเดียว ยังไม่ใช่ QC ทั้งหมด — รอ P4b",
 QC_HOLD_OPEN:"มี QC Hold เปิดอยู่",QC1_SLOT_NOT_MEASURED:"ตำแหน่ง QC1 ไม่ได้วัด",IDENTITY_ISSUE_OPEN:"มีปัญหาตัวตนค้าง",CLINICAL_RULES_NOT_APPROVED:"เกณฑ์ Clinical Gate ยังไม่รับรอง (OD-08)",
 CONSENT_REVOKED:"ถอนความยินยอมแล้ว",CONSENT_DECLINED:"ไม่ยินยอม",CONSENT_NOT_GRANTED:"ยังไม่มีความยินยอมที่ยืนยัน",REDRAW_CONSENT_APPLICABILITY:"การใช้ Consent กับรอบเจาะซ้ำรอตัดสิน (OD-16)",
 TWIN_Y_CHROMOSOME_DISCLOSURE_RULE:"กฎเปิดเผยผลโครโมโซม Y ของครรภ์แฝดรอ OD-09",DISCLOSURE_RULE_PROPOSED_ONLY:"กฎเปิดเผยเพศยังเป็นข้อเสนอ (OD-09)",SEX_SHOWN_BUT_NOT_WANTED:"PDF แสดงเพศ แต่ผู้รับบริการไม่ประสงค์ทราบ",
 SEX_PREFERENCE_NOT_RECORDED:"ไม่มีบันทึกความประสงค์ทราบเพศ",SEX_NOT_SHOWN:"PDF ไม่แสดงเพศ",NOT_LATEST_VERSION:"ไม่ใช่ฉบับล่าสุด",ACTIVE_RELEASE_EXISTS:"มีผลที่ปล่อยอยู่แล้ว",REVIEW_NOT_RECORDED:"ยังไม่บันทึกการตรวจทาน",
 CERTIFIER_ROLE_NOT_ACTIVE:"ไม่มีบทบาทผู้รับรองที่ใช้งานได้",CONFIRMATION_METHOD_AND_GOVERNANCE_SIGNOFF:"วิธียืนยันรอ OD-05 และ Clinical Governance ยังไม่ลงนาม",NO_REDRAW_ORDER_FOR_ROUND:"รอบนี้ไม่มีคำสั่ง Redraw",
 NOTICE_IMPORTED_BEFORE_REDRAW_ORDER:"นำเข้าหนังสือแจ้งก่อนมีคำสั่ง Redraw",NOTICE_CHANNEL_NIPT_ONLY_PENDING:"ช่องทางรอ OD-07 (ระหว่างรอ: ใน NIPT เท่านั้น)",NOTICE_TEMPLATE_NOT_APPROVED:"Template หนังสือแจ้งยังไม่อนุมัติ (OD-07)",
 QC_NOT_REQUIRED_FOR_NOTICE:"หนังสือแจ้งไม่ต้องมี QC",CROSS_CHECK_MATCH:"ตรงทุกคุณสมบัติ",
 TEMPLATE_APPROVED:"Template อนุมัติแล้ว",REQUIRED_VALUES_READABLE:"อ่านค่าที่จำเป็นได้ครบ",LINKED_MANUAL_REVIEWED:"เชื่อมโยงโดยผู้ตรวจสองคนแล้ว",CURRENT_ROUND_CURRENT_ATTEMPT:"รอบและ Attempt ปัจจุบัน",ANALYSIS_COMPLETE:"วิเคราะห์เสร็จแล้ว",
 FINAL_QC_ACCEPTED:"QC ทุกขั้นยอมรับแล้ว",NO_IDENTITY_CONFLICT:"ไม่มีปัญหาตัวตน",CLINICAL_GATE_PASS:"Clinical Gate ผ่าน",CONSENT_GRANTED:"ยินยอมแล้ว",LATEST_REVIEWED_VERSION:"ฉบับล่าสุดและตรวจทานแล้ว",
 NOTICE_TEMPLATE_APPROVED:"Template หนังสือแจ้งอนุมัติแล้ว",LINKED_TO_REDRAW_ROUND:"เชื่อมกับรอบที่ถูกสั่งเจาะซ้ำ",REDRAW_ORDER_EXISTS:"มีคำสั่ง Redraw ของรอบนี้",CONSENT_NOT_WITHDRAWN:"ไม่ถอนความยินยอม",
 REVISION_LINKED:"ถูกแทนด้วยฉบับแก้ไข",NAME_CONFLICT_ACKNOWLEDGED:"นำเข้าแม้ชื่อซ้ำ (รับทราบแล้ว รอตรวจว่าใหม่/ฉบับแก้ไข)",TEMPLATE_UNKNOWN:"รูปแบบไม่รู้จัก",UNLINKED:"ถอดการเชื่อมโยง"};
export function reasonText(r:string):string{
 if(/^R[GN]-\d\d:/.test(r)){const parts=r.split(":");return `${parts[0]} ${reasonText(parts[parts.length-1])}`;}
 if(REASON[r])return REASON[r];
 if(r.startsWith("CROSS_CHECK_"))return "ข้อมูลไม่ตรง: "+r.slice(12).split("_").map(k=>CROSS_UPPER[k]??k).join(", ");
 if(r.startsWith("UNREADABLE_"))return "อ่านค่าไม่ได้: "+r.slice(11).replaceAll("_",", ");
 if(r.startsWith("MISMATCH_")||r.startsWith("NOT_AVAILABLE_"))return (r.startsWith("MISMATCH_")?"ไม่ตรง: ":"ไม่มีข้อมูล: ")+r.replace(/^(MISMATCH|NOT_AVAILABLE)_/,"").split("_").map(k=>CROSS_UPPER[k]??k).join(", ");
 if(r.startsWith("ATTEMPT_NOT_CURRENT_"))return "Attempt ไม่ใช่ปัจจุบัน ("+r.slice(20)+")";
 if(r.startsWith("VERSION_"))return "สถานะฉบับ: "+(STATE_TEXT[r.slice(8)]??r.slice(8));
 if(r.startsWith("CLINICAL_"))return "Clinical Gate: "+r.slice(9);
 return r;
}
export const TRI_TEXT:Record<string,string>={PASS:"ผ่าน",FAIL:"ไม่ผ่าน",PENDING:"รอการตัดสินใจ"};
export const TRI_TONE:Record<string,""|"good"|"warning"|"bad">={PASS:"good",FAIL:"bad",PENDING:"warning"};
export const bytes=(n:number)=>n<1024?`${n} B`:n<1048576?`${(n/1024).toFixed(1)} KB`:`${(n/1048576).toFixed(1)} MB`;
