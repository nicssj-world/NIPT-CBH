import Decimal from 'decimal.js';
// QC1 criteria conflict WC-03 / OD-31: WI-T-BM17/18 (3–50 ng/µL) versus the Workbook note (sample + PC/NC ≥ 2, Blank ≤ 0.6).
// Both are PROPOSED_UNAPPROVED (migration 010, lab_qc_criteria_version). The system shows how a value reads against each proposal;
// it never records a Stage QC decision on its own. A human with qc.accept decides, stamped UNAPPROVED_OD31.
export type Qc1RowKind='PATIENT'|'PC'|'NC'|'BLANK';
export type CandidateOutcome='WITHIN'|'BELOW_MIN'|'ABOVE_MAX'|'NOT_APPLICABLE';
export const QC1_CRITERIA=[
 {code:'QC1-WI-BM17-BM18-PROPOSED',status:'PROPOSED_UNAPPROVED' as const,label:'WI-T-BM17/BM18: 3–50 ng/µL (>50 เจือจาง 1:1 แล้ววัดใหม่, <3 สกัดซ้ำ)'},
 {code:'QC1-WORKBOOK-QC-D32-D35-PROPOSED',status:'PROPOSED_UNAPPROVED' as const,label:'Workbook QC!D32–D35: ตัวอย่าง/PC/NC ≥ 2 ng/µL, Blank ≤ 0.6 ng/µL'}
] as const;
export const OWNER_QC1_CRITERIA={code:'QC1-OWNER-MASTER-20261022',status:'OWNER_APPROVED' as const,label:'Master ล่าสุด: ตัวอย่าง/PC/NC ≥ 2.00 ng/µL · BLANK ≤ 0.60 ng/µL'};
export function qc1Candidates(value:string,kind:Qc1RowKind,policy:'LEGACY_REFERENCE'|'OWNER_MASTER'='LEGACY_REFERENCE'){
 if(!(policy==='OWNER_MASTER'?/^\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i:/^\d{1,4}(\.\d{1,3})?$/).test(value))throw new Error('QC1_VALUE_INVALID');
 const v=new Decimal(value);
 if(!v.isFinite())throw new Error('QC1_VALUE_INVALID');
 if(policy==='OWNER_MASTER')return [{code:OWNER_QC1_CRITERIA.code,approved:true,outcome:(kind==='BLANK'?(v.gt('0.6')?'ABOVE_MAX':'WITHIN'):(v.lt(2)?'BELOW_MIN':'WITHIN')) as CandidateOutcome}];
 const wi:CandidateOutcome=kind!=='PATIENT'?'NOT_APPLICABLE':v.lt(3)?'BELOW_MIN':v.gt(50)?'ABOVE_MAX':'WITHIN';
 const workbook:CandidateOutcome=kind==='BLANK'?(v.gt('0.6')?'ABOVE_MAX':'WITHIN'):(v.lt(2)?'BELOW_MIN':'WITHIN');
 return [{code:QC1_CRITERIA[0].code,approved:false,outcome:wi},{code:QC1_CRITERIA[1].code,approved:false,outcome:workbook}];
}
/** Automatic Stage QC decisions are possible only from an APPROVED criteria version; none exists in P4, so this is always null. */
export function automaticQc1Decision(criteria:{status:string}[],candidates:{outcome:CandidateOutcome}[]){
 if(!criteria.length||criteria.some(c=>c.status!=='APPROVED'))return null;
 return candidates.every(c=>c.outcome==='WITHIN'||c.outcome==='NOT_APPLICABLE')?'Accepted':null;
}
