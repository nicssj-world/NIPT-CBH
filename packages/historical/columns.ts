// Dependency-free so client components can build template-shaped rows (OWNER-LAB-005 single-patient import).
/** Canonical columns of the import template. `required` ones must be present in the header; blanks are judged per row. */
export const TABLE_COLUMNS=[
 {key:'ln',required:true,label:'LN ตามเอกสาร'},{key:'hn',required:true,label:'HN'},{key:'name',required:true,label:'ชื่อ-สกุล'},{key:'dob',required:false,label:'วันเกิด'},
 {key:'collection_date',required:false,label:'วันที่เจาะเลือด'},{key:'receipt_date',required:false,label:'วันที่รับตัวอย่าง'},{key:'report_date',required:false,label:'วันที่รายงานผล'},
 {key:'control_record_date',required:false,label:'วันที่บันทึกควบคุมของ Lab'},{key:'request_date',required:false,label:'วันที่ใบขอส่งตรวจ'},{key:'consent_date',required:false,label:'วันที่ใบยินยอม'},
 {key:'pdf_file',required:false,label:'ชื่อไฟล์ PDF ผลเดิม'},{key:'original_location',required:true,label:'ที่เก็บเอกสารต้นฉบับ'},
 {key:'request_paper',required:false,label:'มีใบขอส่งตรวจกระดาษ (Y/N)'},{key:'consent_paper',required:false,label:'มีใบยินยอมกระดาษ (Y/N)'},{key:'consent_decision',required:false,label:'การตัดสินใจใน Consent ตามที่เขียน'},
 {key:'pregnancy_type',required:false,label:'ประเภทครรภ์'},{key:'past_certification',required:false,label:'การรับรองในอดีตตามที่ปรากฏ (ข้อความ)'},
] as const;
