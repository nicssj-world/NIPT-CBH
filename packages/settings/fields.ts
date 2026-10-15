import {SETTINGS,type SettingKey} from "./catalog";

// Field-level form metadata for every catalog key, so staff edit labelled inputs instead of JSON (Plan §13.1–§13.2).
// The catalog schema remains the only validator; this file only describes how each value is shown. A unit test asserts that
// every schema field has exactly one entry here and that locked fields are literals in the schema.
export type FieldKind="text"|"path"|"number"|"boolean"|"select"|"locked"|"date"|"hash"|"uuid-or-empty"|"res-profile"|"his-certifiers";
export type FieldSpec={name:string;label:string;help:string;kind:FieldKind;options?:readonly {value:string;label:string}[];unit?:string;min?:number;max?:number;lockedBy?:string};
export type SettingForm={key:SettingKey;title:string;summary:string;phase:string;fields:FieldSpec[]};

export const SETTING_FORMS:Record<SettingKey,SettingForm>={
 general:{key:"general",title:"ทั่วไป",summary:"ชื่อระบบและเขตเวลา (เขตเวลาล็อกเป็น Asia/Bangkok)",phase:"P1",fields:[
  {name:"systemName",label:"ชื่อระบบ",help:"แสดงบนหน้าจอและเอกสาร ความยาวไม่เกิน 80 ตัวอักษร",kind:"text",max:80},
  {name:"timezone",label:"เขตเวลา",help:"ล็อกไว้ตาม Baseline — วันที่และเวลาทั้งหมดใช้เวลาไทย",kind:"locked",lockedBy:"LOCKED Baseline"}]},
 request_consent:{key:"request_consent",title:"ANC / ใบขอส่งตรวจและความยินยอม",summary:"รุ่นแบบฟอร์มและช่องทางที่เปิดใช้",phase:"P2",fields:[
  {name:"templateVersion",label:"รุ่นแบบฟอร์ม FM-01/FM-02",help:"รุ่นจำลองจนกว่า DCC อนุมัติแบบฟอร์มจริง",kind:"text"},
  {name:"mode",label:"ช่องทางที่เปิดใช้",help:"การผสมช่องทางเป็นการตัดสินใจ OD-06",kind:"select",options:[{value:"ELECTRONIC",label:"อิเล็กทรอนิกส์"},{value:"PAPER",label:"กระดาษ"},{value:"MIXED",label:"ผสม (รอ OD-06)"}]}]},
 doctor_registry:{key:"doctor_registry",title:"ทะเบียนแพทย์ ANC",summary:"รุ่นทะเบียนแพทย์ (Maker-Checker ในหน้าทะเบียนแพทย์)",phase:"P2",fields:[
  {name:"version",label:"รุ่นทะเบียน",help:"ข้อมูลแพทย์ ใบอนุญาต และลายเซ็นจัดการในหน้า ทะเบียนแพทย์จำลอง",kind:"text"}]},
 security:{key:"security",title:"ผู้ใช้ / บทบาท / สิทธิ์",summary:"นโยบาย Session และการล็อกบัญชี (ค่าตาม Baseline)",phase:"P1",fields:[
  {name:"idleMinutes",label:"หมดเวลาเมื่อไม่ใช้งาน",help:"ล็อกตาม Baseline §13",kind:"locked",unit:"นาที",lockedBy:"LOCKED Baseline"},
  {name:"absoluteHours",label:"อายุ Session สูงสุด",help:"ล็อกตาม Baseline §13",kind:"locked",unit:"ชั่วโมง",lockedBy:"LOCKED Baseline"},
  {name:"lockoutAttempts",label:"ใส่รหัสผิดได้",help:"ล็อกตาม Baseline §13",kind:"locked",unit:"ครั้ง",lockedBy:"LOCKED Baseline"},
  {name:"lockoutMinutes",label:"ระยะล็อกบัญชี",help:"ล็อกตาม Baseline §13",kind:"locked",unit:"นาที",lockedBy:"LOCKED Baseline"}]},
 his_inbound:{key:"his_inbound",title:"HIS ขาเข้า (.pet)",summary:"โฟลเดอร์ใบสั่งแบบอ่านอย่างเดียว — Share ทดสอบที่ IT อนุญาต ข้อมูลผู้ป่วยจริงยัง HOLD",phase:"P3",fields:[
  {name:"enabled",label:"เปิดการสแกนอัตโนมัติ",help:"ปิดไว้เป็นค่าเริ่มต้น",kind:"boolean"},
  {name:"basePath",label:"โฟลเดอร์ขาเข้า",help:"Local/UNC ที่ IT อนุญาต หรือ simulator/inbound — Worker ตรวจ Allowed Root และสิทธิ์ Service Account",kind:"path"},
  {name:"section",label:"Section",help:"ล็อกตาม LOCKED §7.1",kind:"locked",lockedBy:"LOCKED §7.1"},
  {name:"testCode",label:"รหัสการตรวจ NIPT",help:"ล็อกตาม LOCKED §7.1",kind:"locked",lockedBy:"LOCKED §7.1"},
  {name:"intervalSeconds",label:"รอบการสแกน",help:"5–3,600 วินาที",kind:"number",unit:"วินาที",min:5,max:3600},
  {name:"lookbackDays",label:"สแกนย้อนหลัง",help:"1–90 วัน",kind:"number",unit:"วัน",min:1,max:90},
  {name:"secretRef",label:"อ้างอิง Secret ของ Share",help:"เว้นว่างสำหรับตัวจำลอง ค่าจริงเก็บในหน้า Secret แยก",kind:"uuid-or-empty"}]},
 laboratory:{key:"laboratory",title:"ห้องปฏิบัติการ",summary:"รุ่น Template/สูตร และนโยบายระหว่างรอการตัดสินใจ",phase:"P4/P4b",fields:[
  {name:"templateVersion",label:"รุ่น Batch Template",help:"OD-34",kind:"text"},
  {name:"formulaVersion",label:"รุ่น Formula Spec",help:"ยังไม่ผ่าน Validation (OD-28/29)",kind:"text"},
  {name:"partialBatchAllowed",label:"อนุญาต Batch ไม่ครบ 3 Sheet",help:"LOCKED LD-13",kind:"locked",lockedBy:"LOCKED LD-13"},
  {name:"halosDataRows",label:"จำนวนแถวข้อมูล HALOS",help:"Owner Lock OD-35",kind:"locked",lockedBy:"Owner Lock OD-35"},
  {name:"pendingGovernanceGate",label:"นโยบายเมื่อ Gate รอการตัดสินใจ",help:"HOLD = หยุด; PROCEED_SYNTHETIC_LABELLED = ข้อมูลจำลองเดินต่อพร้อมป้ายกำกับ",kind:"select",options:[{value:"HOLD",label:"HOLD — หยุดรอการตัดสินใจ"},{value:"PROCEED_SYNTHETIC_LABELLED",label:"ข้อมูลจำลองเดินต่อพร้อมป้ายกำกับ"}]}]},
 result_management:{key:"result_management",title:"การจัดการผลตรวจ",summary:"โฟลเดอร์ผล PDF แบบ NIPTY + การจับคู่แบบมีผู้ตรวจ — การปล่อยผลจริงยัง HOLD",phase:"P5",fields:[
  {name:"pdfSourcePath",label:"โฟลเดอร์ผล PDF (PDF Source Folder)",help:"Worker อ่านอย่างเดียว โหมดใช้งานจริงต้องมีสิทธิ์ RESULTS ใน Share Policy ของบัญชีบริการ; โหมดจำลองใช้ simulator/results",kind:"path"},
  {name:"scanSubfolders",label:"สแกนรวมโฟลเดอร์ย่อย",help:"เหมือน NIPTY: ค้นหา .pdf และ .zip ทุกโฟลเดอร์ย่อย",kind:"boolean"},
  {name:"acceptZip",label:"รับไฟล์ ZIP",help:"ZIP-as-PDF และ ZIP ที่รวม PDF หลายไฟล์",kind:"boolean"},
  {name:"maxFilesPerScan",label:"จำนวนไฟล์สูงสุดต่อการสแกน",help:"1–2,000 ไฟล์",kind:"number",unit:"ไฟล์",min:1,max:2000},
  {name:"scheduledScanMinutes",label:"สแกนโฟลเดอร์ตามรอบเวลา",help:"0 = ปิด (ค่าเริ่มต้น) หรือ 5–1,440 นาที — Worker ค้นหาและแสดงรายการไฟล์ใหม่เท่านั้น ไม่นำเข้า ไม่เชื่อมโยง ไม่รับรอง และไม่ปล่อยผลอัตโนมัติ (Owner A23)",kind:"number",unit:"นาที",min:0,max:1440},
  {name:"maxUploadMb",label:"ขนาดไฟล์สูงสุด",help:"ใช้ทั้งไฟล์จากโฟลเดอร์และไฟล์ที่เลือกจากเครื่อง (1–25 MB)",kind:"number",unit:"MB",min:1,max:25},
  {name:"gaToleranceDays",label:"ความคลาดเคลื่อนอายุครรภ์ที่ยอมรับ",help:"เทียบอายุครรภ์ใน PDF กับที่คำนวณจาก EDD ของรอบ (0–14 วัน)",kind:"number",unit:"วัน",min:0,max:14},
  {name:"picVersion",label:"รุ่น PDF Identifier Contract (PIC)",help:"ยังไม่ผ่าน OD-07 — ระบบใช้การจับคู่แบบมีผู้ตรวจเท่านั้น",kind:"text"},
  {name:"linkageMode",label:"วิธีจับคู่ผลกับ Attempt",help:"AUTO_PIC เปิดไม่ได้จนกว่า PIC จะ Active (OD-07); HN หรือ HIS LN อย่างเดียวไม่เคยจับคู่อัตโนมัติ",kind:"locked",lockedBy:"OD-07 HOLD"},
  {name:"certificationMethod",label:"วิธียืนยันการรับรอง",help:"รอ OD-05",kind:"locked",lockedBy:"OD-05 HOLD"},
  {name:"sexDisclosureRule",label:"กฎการเปิดเผยเพศ",help:"ข้อเสนอ: ครรภ์เดี่ยวที่ไม่ประสงค์ทราบเพศแต่ PDF แสดงเพศ → บล็อก (รอ OD-09)",kind:"locked",lockedBy:"OD-09 HOLD"},
  {name:"postReleaseRecollection",label:"การเก็บตัวอย่างใหม่หลังออกผล",help:"ระหว่างรอ OD-17: ต้อง Void ผลเดิมก่อน",kind:"locked",lockedBy:"OD-17 HOLD"},
  {name:"noticeChannel",label:"ช่องทางหนังสือแจ้งเจาะซ้ำ",help:"ระหว่างรอ OD-07: แสดงใน NIPT เท่านั้น",kind:"locked",lockedBy:"OD-07 HOLD"},
  {name:"releaseAuthority",label:"สิทธิ์ปล่อยผลจริง",help:"HOLD จนกว่า AL-5 (OD-04 Clinical Governance, OD-05, OD-07) ผ่าน",kind:"locked",lockedBy:"AL-5 HOLD"}]},
 his_outbound:{key:"his_outbound",title:"HIS ขาออก / CFS",summary:"ส่ง Synthetic ไปยัง Share ทดสอบที่ IT อนุญาต — Clinical ยัง HOLD",phase:"P6",fields:[
  {name:"resDestinationPath",label:"ปลายทาง RES / OK",help:"Local/UNC ใน Allowed Root สำหรับ Synthetic Test เท่านั้น",kind:"path"},
  {name:"pdfDestinationPath",label:"ปลายทาง PDF / CFS",help:"ต้องเป็นคนละโฟลเดอร์กับ RES และ Backup",kind:"path"},
  {name:"backupPath",label:"โฟลเดอร์สำรองไฟล์ส่ง",help:"ตรวจ PDF/RES และ Backup ก่อนสร้าง OK — ไม่เขียนทับไฟล์เดิม",kind:"path"},
  {name:"secretRef",label:"Credential / Secret Reference",help:"UUID อ้างอิง Credential ที่ IT จัดเตรียมให้ Service Account — ไม่ใส่รหัสผ่าน",kind:"uuid-or-empty"},
  {name:"retryDelaySeconds",label:"ระยะรอ Retry เริ่มต้น",help:"เพิ่มแบบ Exponential ตามจำนวนครั้ง สูงสุดหนึ่งวัน",kind:"number",unit:"วินาที",min:1,max:3600},
  {name:"confirmationTimeoutSeconds",label:"ระยะรอการยืนยัน",help:"หมดเวลาเป็น UNKNOWN_TIMEOUT — ไม่ถือว่า HIS รับผลแล้ว",kind:"number",unit:"วินาที",min:1,max:86400},
    {name:"enabled",label:"เปิดการส่งผล",help:"Worker ใช้รุ่นที่เปิดใช้งานแล้ว",kind:"boolean"},
    {name:"target",label:"ปลายทาง",help:"Share ต้องได้รับสิทธิ์จากการตั้งค่าระบบและ Service Account",kind:"select",options:[{value:"SIMULATOR",label:"ตัวจำลอง"},{value:"AUTHORIZED_SHARE",label:"HIS/CFS Share ที่ได้รับอนุญาต"}]},
    {name:"productionAuthorized",label:"เปิดส่งผลที่รับรองแล้ว",help:"มีผลเฉพาะ Operational runtime และฐานข้อมูลที่ตั้งค่าไว้ตรงกัน",kind:"boolean"},
  {name:"resultStyle",label:"รูปแบบข้อความผลใน .res",help:"เทียบ NIPTY nipt_result_style",kind:"select",options:[{value:"full",label:"full — ระบุครบ"},{value:"short",label:"short — สั้น"},{value:"fixed",label:"fixed — ข้อความคงที่"}]},
  {name:"retryLimit",label:"จำนวนครั้งลองใหม่",help:"1–10",kind:"number",unit:"ครั้ง",min:1,max:10},
    {name:"round2SpecimenDatePolicy",label:"วันที่เก็บตัวอย่างใน .res ของรอบ ≥ 2",help:"เลือกรอบของหลักฐาน PET ที่ HIS ต้องการ",kind:"select",options:[{value:"",label:"ยังไม่กำหนด"},{value:"CURRENT_ROUND",label:"รอบปัจจุบัน"},{value:"ORIGINAL_ORDER",label:"รอบแรก"}]},
    {name:"resProfile",label:"รูปแบบ RES",help:"ใช้ค่าตามข้อกำหนดของ HIS",kind:"res-profile"},
    {name:"certifierHisMappings",label:"ผู้รับรองใน HIS",help:"ผูกรหัสกับผู้รับรองที่ได้รับสิทธิ์",kind:"his-certifiers"}]},
 storage_backup:{key:"storage_backup",title:"ที่เก็บไฟล์ / NAS / Backup",summary:"ระยะเก็บ Backup ของตัวจำลอง",phase:"P1/P7",fields:[
  {name:"retentionDays",label:"เก็บ Backup",help:"1–3,650 วัน",kind:"number",unit:"วัน",min:1,max:3650},
  {name:"target",label:"ปลายทาง Backup",help:"ตัวจำลองเท่านั้น",kind:"locked",lockedBy:"Q-I6 HOLD"}]},
 notifications:{key:"notifications",title:"การแจ้งเตือน / ระบบ / Audit",summary:"เกณฑ์เตือนสถานะ Worker และคิวค้าง",phase:"P1",fields:[
  {name:"staleSeconds",label:"ถือว่า Worker ขาดการติดต่อเมื่อเกิน",help:"60–3,600 วินาที",kind:"number",unit:"วินาที",min:60,max:3600},
  {name:"backlogWarning",label:"เตือนเมื่อคิวค้างเกิน",help:"1–10,000 รายการ",kind:"number",unit:"รายการ",min:1,max:10000}]},
 historical_backfill:{key:"historical_backfill",title:"นำเข้าข้อมูลย้อนหลัง (P5H)",summary:"ชนิดหลักฐาน Anchor และชุดข้อมูลขั้นต่ำ — ค่า PENDING ทำให้ระบบประเมินสิทธิ์ไม่ผ่านทุกเคส (Fail Closed) จนกว่า Owner ตัดสิน OD-18",phase:"P5H",fields:[
  {name:"anchorPolicy",label:"ชนิดหลักฐาน Anchor ที่ยอมรับ",help:"OD-18: Request/Consent ไม่เป็น Anchor ในทุกทางเลือก; PENDING = ยังไม่ตัดสิน",kind:"select",options:[{value:"PENDING_OD18",label:"ยังไม่ตัดสิน (OD-18)"},{value:"A_FINAL_REPORT",label:"(a) รายงานผลสุดท้ายลงวันที่ระดับวัน"},{value:"B_FINAL_REPORT_OR_CONTROL_RECORD",label:"(b) (a) หรือบันทึกควบคุมของ Lab"}]},
  {name:"minimumProfile",label:"ชุดข้อมูลขั้นต่ำ",help:"OD-18: ใช้แสดงความครบของหลักฐานเท่านั้น ไม่เปลี่ยนสิทธิ์ (OD-23)",kind:"select",options:[{value:"PENDING_OD18",label:"ยังไม่ตัดสิน (OD-18)"},{value:"OD18_A_IDENTITY_AND_ORIGINAL",label:"(a) LN + HN + ชื่อ + DOB + ที่เก็บต้นฉบับ"},{value:"OD18_B_BALANCED",label:"(b) สมดุล"}]},
  {name:"maxBatchRows",label:"จำนวนแถวสูงสุดต่อชุดนำเข้า",help:"1–200 แถว (ชุดปกติประมาณ 47 เคส)",kind:"number",unit:"แถว",min:1,max:200}]},
 go_live_cutoff:{key:"go_live_cutoff",title:"วันเริ่มใช้ระบบ (go_live_cutoff)",summary:"Versioned + Maker-Checker + รายงานผลกระทบ — ใช้กับเคสย้อนหลัง (P5H)",phase:"P5H (Deferred)",fields:[
  {name:"cutoff",label:"วันที่ตัด",help:"เปลี่ยนไม่ได้เมื่อมีเคส HISTORICAL แล้วระหว่างรอ OD-27",kind:"date"},
  {name:"impactReportHash",label:"SHA-256 ของรายงานผลกระทบ",help:"ต้องแนบรายงานผลกระทบทุกเวอร์ชัน (D-50)",kind:"hash"}]}
};

/** Schema keys of a catalog entry, used by the coverage test and the form renderer. */
export function schemaFields(key:SettingKey):string[]{return Object.keys((SETTINGS[key].schema as unknown as {shape:Record<string,unknown>}).shape);}
