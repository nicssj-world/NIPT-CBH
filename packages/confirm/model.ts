import {z} from 'zod';
import type {PositiveKey} from '../results/query';

// ผลตรวจยืนยัน (Confirm) (Owner 2026-11-23). Codes and their Thai/English labels, shared by the service and the screens (no server imports here).

/** A screening finding: a positive key of the result, or `other` for an abnormal result that names no key. */
// Same order as results/query.ts POSITIVE_KEYS (kept here so the screens never import server code; tests/unit/confirm-model.test.ts checks they match).
export const FINDING_KEYS=['t13','t18','t21','xo','xxx','xxy','xyy','other'] as const satisfies readonly (PositiveKey|'other')[];
export type FindingKey=PositiveKey|'other';
export const FINDING_LABEL:Record<FindingKey,string>={t13:'Trisomy 13',t18:'Trisomy 18',t21:'Trisomy 21',xo:'XO',xxx:'XXX',xxy:'XXY',xyy:'XYY',other:'ผลผิดปกติอื่น'};
/** How the screening called the finding, the words the result tables use. */
export const SCREEN_LABEL:Record<FindingKey,string>={t13:'Trisomy 13 High Risk',t18:'Trisomy 18 High Risk',t21:'Trisomy 21 High Risk',xo:'XO Detected',xxx:'XXX Detected',xxy:'XXY Detected',xyy:'XYY Detected',other:'ผลผิดปกติ (Abnormal)'};
export const TRISOMY_KEYS:readonly FindingKey[]=['t13','t18','t21'];
export const SCA_KEYS:readonly FindingKey[]=['xo','xxx','xxy','xyy'];

/** Owner 2026-11-23: per-finding outcome labels; MOSAIC_OTHER counts as not concordant. */
export const OUTCOMES=['TRUE_POSITIVE','FALSE_POSITIVE','MOSAIC_OTHER'] as const;
export type Outcome=typeof OUTCOMES[number];
export const OUTCOME_LABEL:Record<Outcome,string>={TRUE_POSITIVE:'True positive',FALSE_POSITIVE:'False positive',MOSAIC_OTHER:'Mosaic-other'};

/** Owner 2026-11-23: case status labels (short Thai set). RESULTED and POSTNATAL carry a confirmatory result and enter the percentage. */
export const STATUSES=['PENDING','RESULTED','POSTNATAL','DECLINED','PREGNANCY_LOSS','LOST_FOLLOW_UP'] as const;
export type ConfirmStatus=typeof STATUSES[number];
export const STATUS_LABEL:Record<ConfirmStatus,string>={PENDING:'รอผล',RESULTED:'มีผลแล้ว',POSTNATAL:'ใช้ผลหลังคลอด',DECLINED:'ปฏิเสธการเจาะ',PREGNANCY_LOSS:'แท้ง-ยุติการตั้งครรภ์',LOST_FOLLOW_UP:'ติดตามไม่ได้'};
export const RESULT_STATUSES:readonly ConfirmStatus[]=['RESULTED','POSTNATAL'];
export const NOT_DONE_STATUSES:readonly ConfirmStatus[]=['DECLINED','PREGNANCY_LOSS','LOST_FOLLOW_UP'];
export const hasResult=(s:ConfirmStatus)=>RESULT_STATUSES.includes(s);

export const METHODS=['KARYOTYPE','QF_PCR','MICROARRAY','FISH','OTHER'] as const;
export type Method=typeof METHODS[number];
export const METHOD_LABEL:Record<Method,string>={KARYOTYPE:'Karyotype',QF_PCR:'QF-PCR',MICROARRAY:'Microarray (CMA)',FISH:'FISH',OTHER:'อื่นๆ'};
export const SPECIMENS=['AMNIOTIC_FLUID','CVS','CORD_BLOOD','POSTNATAL_BLOOD','PRODUCT_OF_CONCEPTION','OTHER'] as const;
export type Specimen=typeof SPECIMENS[number];
export const SPECIMEN_LABEL:Record<Specimen,string>={AMNIOTIC_FLUID:'น้ำคร่ำ',CVS:'ชิ้นเนื้อรก (CVS)',CORD_BLOOD:'เลือดสายสะดือ',POSTNATAL_BLOOD:'เลือดทารกหลังคลอด',PRODUCT_OF_CONCEPTION:'ชิ้นเนื้อจากการตั้งครรภ์ (POC)',OTHER:'อื่นๆ'};

/** List tabs: all, waiting, with a result, not done (declined / loss / lost to follow-up). */
export const TABS=['ALL','PENDING','RESULTED','NOT_DONE'] as const;
export type ConfirmTab=typeof TABS[number];
export const tabOf=(s:ConfirmStatus):Exclude<ConfirmTab,'ALL'>=>hasResult(s)?'RESULTED':s==='PENDING'?'PENDING':'NOT_DONE';

/** A case with a result is concordant only when every screening finding is a true positive. */
export const concordant=(findings:Partial<Record<FindingKey,Outcome>>,keys:readonly FindingKey[])=>keys.length>0&&keys.every(k=>findings[k]==='TRUE_POSITIVE');

const day=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>{const d=new Date(v+'T00:00:00Z');return !Number.isNaN(d.getTime())&&d.toISOString().slice(0,10)===v;},'DATE_INVALID');
const text=(max:number)=>z.string().trim().max(max).refine(s=>!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(s),'CONTROL_CHARACTER');
/** The editor's fields (the PDF travels beside them as a file). `expectedSequence` = the revision the user saw (null = none yet). */
export const saveInput=z.strictObject({
 caseId:z.uuid(),versionId:z.uuid(),expectedSequence:z.number().int().positive().nullable(),
 status:z.enum(STATUSES),
 method:z.enum(METHODS).nullable().default(null),specimen:z.enum(SPECIMENS).nullable().default(null),
 outlabName:text(200).default(''),procedureDate:day.nullable().default(null),reportDate:day.nullable().default(null),
 resultText:text(500).default(''),note:text(1000).default(''),
 findings:z.partialRecord(z.enum(FINDING_KEYS),z.enum(OUTCOMES)).default({}),
}).refine(d=>!d.procedureDate||!d.reportDate||d.procedureDate<=d.reportDate,{message:'CONFIRM_DATE_ORDER',path:['reportDate']});
export type SaveInput=z.infer<typeof saveInput>;

export const PDF_MAX_BYTES=8*1024*1024;
/** A real PDF starts with "%PDF-" (the browser's file type is not trusted). */
export const isPdf=(bytes:Uint8Array)=>bytes.length>=5&&bytes[0]===0x25&&bytes[1]===0x50&&bytes[2]===0x44&&bytes[3]===0x46&&bytes[4]===0x2d;
