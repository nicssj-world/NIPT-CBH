import {DCC_REQUEST_CONTRACT,dccRequiredIssues,validThaiCitizenId} from '../forms/request-contract';
import {z} from 'zod';
import {operationalDataEnabled} from '../security/runtime';
import {isLikelyBuddhistEraYear} from '../domain/thai-date';
export const REQUEST_TEMPLATE='SYNTHETIC-FM01-v1';
export const CONSENT_TEMPLATE='SYNTHETIC-FM02-v1';
export const RULE_VERSION='SYNTHETIC-NEGATIVE-ONLY-v1';
export const answer=z.enum(['Yes','No','Unknown']).nullable();
export const syntheticText=z.string().trim().max(500).refine(v=>!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v)&&(operationalDataEnabled()||v===''||v.startsWith('SYNTHETIC')||v.startsWith('จำลอง')||v.startsWith('ผู้รับบริการจำลอง')),'ใช้ข้อความจำลองที่ขึ้นต้น SYNTHETIC หรือ จำลอง เท่านั้น');
export const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>!Number.isNaN(Date.parse(v))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v,'วันที่ไม่ถูกต้อง')
 .refine(v=>!isLikelyBuddhistEraYear(v),'DATE_LIKELY_BUDDHIST_ERA'); // H2: a BE year sent as CE (Plan Rev 3.4 §7.2)
// date/exposureAt are accepted only for legacy drafts; the current request form asks only for the Yes/No answer.
const fact=z.strictObject({answer,date:date.nullable().optional(),exposureAt:z.iso.datetime().nullable().optional()});
export const requestSchema=z.strictObject({
 documentContractVersion:z.literal(DCC_REQUEST_CONTRACT).optional(),
 patient:z.strictObject({syntheticName:syntheticText,dob:date.nullable(),ageYears:z.number().int().min(0).max(100).nullable().optional(),phone:z.string().trim().max(32).refine(v=>operationalDataEnabled()?v===''||/^\+?[0-9][0-9 ()-]{5,24}$/.test(v):/^SYNTHETIC(?:-[A-Z0-9]+)*$|^$/.test(v)).nullable(),address:syntheticText.nullable(),identifier:z.string().trim().max(64).refine(v=>operationalDataEnabled()?v===''||validThaiCitizenId(v):/^SYNTHETIC-[A-Z0-9-]+$/.test(v)).nullable().optional(),identifierType:z.enum(['Synthetic','Unknown','ThaiNationalId','Passport','HospitalId','Other']).refine(v=>operationalDataEnabled()||['Synthetic','Unknown'].includes(v)).nullable().optional(),entitlement:syntheticText.nullable().optional()}),
 pregnancy:z.strictObject({type:z.enum(['Singleton','Twins','Unknown']).nullable(),edd:date.nullable(),ultrasoundDate:date.nullable().optional(),art:answer.optional(),abortion:z.number().int().min(0).max(50).nullable().optional(),collectionDate:date.nullable(),collectionTime:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable(),collectionSource:z.enum(['ANC','LAB_PAPER','SYNTHETIC_PATIENT']).nullable(),weightKg:z.number().finite().min(0).max(500).nullable(),heightCm:z.number().finite().min(0).max(300).nullable(),gravida:z.number().int().min(0).max(50).nullable(),para:z.number().int().min(0).max(50).nullable(),vanishingTwin:answer,vanishingDate:date.nullable(),vanishingGaDays:z.number().int().min(0).max(300).nullable(),drawEightWeeksAfterLoss:answer.optional(),fetalSex:z.enum(['Want','DoNotWant','Unspecified']).nullable(),sca:z.enum(['Want','DoNotWant','Unspecified']).nullable()}),
 history:z.strictObject({transfusion4months:fact,heparin24h:fact,immune1month:fact,albumin4weeks:fact,exogenousDna4weeks:fact,cancerTreatment:answer,gaUnder8:answer,tumor:answer,tumorDetails:syntheticText.nullable(),priorChromosomeTest:answer,priorTestMethod:syntheticText.nullable(),priorTestResult:syntheticText.nullable(),otherHistory:answer,otherDetails:syntheticText.nullable()}),
 acknowledgments:z.strictObject({conditionA:answer,conditionB:answer}),
 ordering:z.strictObject({doctorVersionId:z.uuid().nullable(),facility:syntheticText.nullable(),reason:syntheticText.nullable(),coordinator:syntheticText.nullable().optional(),phone:syntheticText.nullable().optional(),email:z.email().max(254).refine(v=>operationalDataEnabled()||/^synthetic[\w.-]*@example\.(?:test|invalid)$/.test(v)).nullable().optional()})
});
export type RequestDraft=z.infer<typeof requestSchema>;
export const emptyRequest:RequestDraft={documentContractVersion:DCC_REQUEST_CONTRACT,patient:{syntheticName:'',dob:null,phone:null,address:null},pregnancy:{type:null,edd:null,collectionDate:null,collectionTime:null,collectionSource:null,weightKg:null,heightCm:null,gravida:null,para:null,vanishingTwin:null,vanishingDate:null,vanishingGaDays:null,fetalSex:null,sca:null},history:{transfusion4months:{answer:null},heparin24h:{answer:null},immune1month:{answer:null},albumin4weeks:{answer:null},exogenousDna4weeks:{answer:null},cancerTreatment:null,gaUnder8:null,tumor:null,tumorDetails:null,priorChromosomeTest:null,priorTestMethod:null,priorTestResult:null,otherHistory:null,otherDetails:null},acknowledgments:{conditionA:null,conditionB:null},ordering:{doctorVersionId:null,facility:null,reason:null}};
export function calculations(d:RequestDraft){
 const p=d.pregnancy;
 const gaDays=p.edd&&p.collectionDate?280+Math.round((Date.parse(p.collectionDate)-Date.parse(p.edd))/86400000):null;
 const bmi=p.weightKg!==null&&p.heightCm!==null&&p.heightCm>0?p.weightKg/(p.heightCm/100)**2:null;
 const birth=d.patient.dob,at=p.collectionDate;
 const ageYears=birth&&at&&birth<=at?Number(at.slice(0,4))-Number(birth.slice(0,4))-(at.slice(5)<birth.slice(5)?1:0):null;
 return {gaDays,gaWeeks:gaDays!==null?Math.floor(gaDays/7):null,gaRemainder:gaDays!==null?gaDays%7:null,bmi,ageYears};
}
export function requestIssues(d:RequestDraft){
 const issues:string[]=operationalDataEnabled()?dccRequiredIssues(d):[];const p=d.pregnancy,h=d.history,c=calculations(d);
 for(const k of ['type','edd','collectionDate','weightKg','heightCm'] as const)if(p[k]===null||p[k]==='Unknown')issues.push('pregnancy.'+k);
 for(const k of ['transfusion4months','heparin24h','immune1month'] as const)if(h[k].answer===null||h[k].answer==='Unknown')issues.push('history.'+k);
 for(const k of ['cancerTreatment','gaUnder8','tumor','priorChromosomeTest'] as const)if(h[k]===null||h[k]==='Unknown')issues.push('history.'+k);
 if(h.tumor==='Yes'&&!h.tumorDetails)issues.push('history.tumorDetails');
 if(h.priorChromosomeTest==='Yes'&&(!h.priorTestMethod||!h.priorTestResult))issues.push('history.priorChromosomeTest.details');
 if(h.otherHistory==='Yes'&&!h.otherDetails)issues.push('history.otherDetails');
 if(p.type==='Singleton'&&(!p.fetalSex||p.fetalSex==='Unspecified'))issues.push('pregnancy.fetalSex');
 if(p.type==='Twins'&&p.fetalSex!==null&&p.fetalSex!=='Unspecified')issues.push('pregnancy.twinsNoEachFetusSex');
 if(d.patient.dob&&p.collectionDate&&d.patient.dob>p.collectionDate)issues.push('patient.dob');
 if(!p.vanishingTwin||p.vanishingTwin==='Unknown')issues.push('pregnancy.vanishingTwin');
 if(p.vanishingTwin==='Yes'&&(!p.vanishingDate||p.vanishingGaDays===null))issues.push('pregnancy.vanishingDetails');
 if(c.bmi===null)issues.push('pregnancy.bmi.NotEvaluable');
 // A/B facts are retained; threshold authority remains pending. No developer-selected interval makes a case eligible.
 if(!d.ordering.doctorVersionId)issues.push('ordering.doctorVersionId');
 return issues;
}
/** Progress for a stored draft that may predate or bypass the schema (registry list, display only). Missing sections and facts
 * count as unanswered; it never throws and never relaxes the save/confirm validation, which still parses with requestSchema. */
export function requestProgressIssues(raw:unknown):string[]{
 const r=(raw&&typeof raw==='object'?raw:{}) as Record<string,Record<string,unknown>|undefined>;const merged:Record<string,unknown>={};
 for(const [section,base] of Object.entries(emptyRequest) as [string,unknown][]){
  // A scalar contract marker comes only from the stored draft; never backfill it from the new-draft defaults.
  if(base===null||typeof base!=='object'||Array.isArray(base)){merged[section]=r[section];continue;}
  const given=r[section]&&typeof r[section]==='object'?r[section]!:{};const out:Record<string,unknown>={...base,...given};
  for(const [k,v] of Object.entries(base))if(v&&typeof v==='object'&&!Array.isArray(v))out[k]={...v,...(given[k]&&typeof given[k]==='object'?given[k] as object:{})};merged[section]=out;}
 return requestIssues(merged as RequestDraft);
}
export function evaluateClinical(d:RequestDraft,dateConflict=false){
 const c=calculations(d),issues=requestIssues(d),h=d.history;
 const invalid=c.gaDays!==null&&(c.gaDays<0||c.gaDays>315)||!!(d.patient.dob&&d.pregnancy.collectionDate&&d.patient.dob>d.pregnancy.collectionDate)||c.ageYears!==null&&c.ageYears<0;
 const answerConflict=c.gaDays!==null&&['Yes','No'].includes(h.gaUnder8??'')&&((c.gaDays<56)!==(h.gaUnder8==='Yes'));
 const negative=[h.transfusion4months.answer,h.heparin24h.answer,h.immune1month.answer,h.cancerTreatment,h.gaUnder8].includes('Yes');
 const state=dateConflict||invalid||answerConflict?'ClinicalDataConflict':negative?'BlockedWithReason':issues.length?'PendingData':'PendingClinicalReview';
 return {state,passed:false as const,ruleVersion:RULE_VERSION,issues,calculations:c,reason:state==='BlockedWithReason'?'SYNTHETIC_NEGATIVE_EXAMPLE_ONLY':'CLINICAL_APPROVAL_PENDING'};
}
export const consentClauses=[
 'จำลอง: รับทราบว่าเป็นการตรวจคัดกรอง ไม่ใช่การวินิจฉัย',
 'จำลอง: ขอบเขตการรายงานของครรภ์เดี่ยวและความประสงค์ทราบเพศต้องชัดเจน',
 'จำลอง: ครรภ์แฝดรายงานโครโมโซม Y ไม่ระบุเพศทารกแต่ละคน',
 'จำลอง: รับทราบข้อจำกัดและความคลาดเคลื่อนของการคัดกรอง',
 'จำลอง: ผลเสี่ยงสูงต้องรับคำปรึกษาจากบุคลากรที่มีอำนาจ',
 'จำลอง: ผลเสี่ยงต่ำไม่ยืนยันการไม่มีความผิดปกติทั้งหมด',
 'จำลอง: การตรวจนี้ไม่ครอบคลุมโรคหรือความผิดปกติทุกชนิด',
 'จำลอง: รับทราบการใช้ตัวอย่างและข้อมูลสำหรับบริการตามขอบเขตที่อนุมัติ',
 'จำลอง: อาจมีกรณีไม่สามารถรายงานผลได้ ต้องรับคำแนะนำ',
 'จำลอง: อาจต้องเก็บตัวอย่างใหม่ การใช้ยินยอมกับรอบใหม่ยังรอนโยบาย',
 'จำลอง: รับทราบสิทธิในการตัดสินใจและถอนความยินยอมตามกระบวนการ',
 'จำลอง: ระยะเก็บตัวอย่างและข้อมูลต้องรอ Clinical/DPO/DCC รับรองแยกตามชนิด'
] as const;
export const paperItems=[
 {id:'requestComplete',label:'1. Request ครบถ้วน',options:['Complete','Incomplete','Unknown']},
 {id:'decision',label:'2. การตัดสินใจ Consent',options:['Granted','Declined','Unspecified']},
 {id:'signatures',label:'3. ลายเซ็นตามแบบฟอร์ม',options:['Complete','Incomplete','Unknown']},
 {id:'representative',label:'4. ผู้แทนโดยชอบธรรม',options:['NotRequired','Complete','Missing','Unknown']},
 {id:'history1to5',label:'5. คำตอบข้อ 1–5 ของรอบนี้',options:['AllNo','AnyYes','Unanswered']},
 {id:'ga',label:'6. GA ณ วันเจาะของรอบนี้',options:['Under8','8to10','Over10to18','Over18','Unknown']},
 {id:'bmi',label:'7. BMI',options:['AtMost40','Over40','Unknown']},
 {id:'conditionA',label:'8. การรับทราบเงื่อนไข A',options:['Present','Missing','NotApplicable','Unknown']},
 {id:'conditionB',label:'9. การรับทราบเงื่อนไข B',options:['Present','Missing','NotApplicable','Unknown']},
 {id:'vanishingTwin',label:'10. Vanishing twin',options:['None','Documented','NotMet','Unknown']},
 {id:'pregnancyType',label:'11. ประเภทครรภ์',options:['Singleton','Twins','Unknown']},
 {id:'fetalSex',label:'12. ความประสงค์ทราบเพศครรภ์เดี่ยว',options:['Want','DoNotWant','Unspecified','NotApplicable']},
 {id:'collectionDate',label:'13. วันที่เจาะของรอบนี้',options:[]},
 {id:'dob',label:'14. วันเกิดตามใบส่งตรวจ (ใช้ตรวจเทียบผล)',options:[]},
 {id:'edd',label:'15. กำหนดคลอดตามใบส่งตรวจ (ใช้ตรวจเทียบอายุครรภ์)',options:[]}
] as const;
export const paperSchema=z.strictObject({requestComplete:z.enum(['Complete','Incomplete','Unknown']).nullable(),decision:z.enum(['Granted','Declined','Unspecified']).nullable(),signatures:z.enum(['Complete','Incomplete','Unknown']).nullable(),representative:z.enum(['NotRequired','Complete','Missing','Unknown']).nullable(),history1to5:z.enum(['AllNo','AnyYes','Unanswered']).nullable(),ga:z.enum(['Under8','8to10','Over10to18','Over18','Unknown']).nullable(),bmi:z.enum(['AtMost40','Over40','Unknown']).nullable(),conditionA:z.enum(['Present','Missing','NotApplicable','Unknown']).nullable(),conditionB:z.enum(['Present','Missing','NotApplicable','Unknown']).nullable(),vanishingTwin:z.enum(['None','Documented','NotMet','Unknown']).nullable(),pregnancyType:z.enum(['Singleton','Twins','Unknown']).nullable(),fetalSex:z.enum(['Want','DoNotWant','Unspecified','NotApplicable']).nullable(),collectionDate:date.nullable(),dob:date.nullable().optional(),edd:date.nullable().optional()});
export type PaperPanel=z.infer<typeof paperSchema>;
export function paperStatus(p:PaperPanel,kind:'REQUEST'|'CONSENT',conflict:boolean){
 if(kind==='CONSENT')return p.signatures==='Complete'&&['NotRequired','Complete'].includes(p.representative??'')&&p.decision==='Declined'?'Declined':p.signatures==='Complete'&&['NotRequired','Complete'].includes(p.representative??'')&&p.decision==='Granted'?'Verified':'Pending';
 if(conflict||p.requestComplete!=='Complete'||p.history1to5!=='AllNo'||!['8to10','Over10to18','Over18'].includes(p.ga??'')||!['AtMost40','Over40'].includes(p.bmi??'')||!p.collectionDate||!['None','Documented'].includes(p.vanishingTwin??'')||!['Singleton','Twins'].includes(p.pregnancyType??''))return 'Pending';
 if((p.ga==='8to10'||p.bmi==='Over40')&&p.conditionA!=='Present'||p.ga==='Over18'&&p.conditionB!=='Present')return 'Pending';
 if(p.pregnancyType==='Singleton'&&!['Want','DoNotWant'].includes(p.fetalSex??''))return 'Pending';
 if(p.pregnancyType==='Twins'&&p.fetalSex!=='NotApplicable')return 'Pending';
 return 'Verified';
}
