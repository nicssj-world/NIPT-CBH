import {z} from 'zod';

/**
 * Evidence values and completeness (Plan §9.11 items 4–5, §5.11 "ความครบของหลักฐาน", OD-23, AT-HIST-01/03/07).
 * A value that does not appear in the evidence is NOT_IN_EVIDENCE — never "Normal", never a default (Baseline §14).
 */
export type EvidenceValue<T>={state:'PRESENT';value:T;evidenceItemId:string}|{state:'NOT_IN_EVIDENCE'};
export const NOT_IN_EVIDENCE_TEXT='ไม่ปรากฏในหลักฐาน';
export const present=<T,>(value:T,evidenceItemId:string):EvidenceValue<T>=>({state:'PRESENT',value,evidenceItemId});
export const notInEvidence=<T,>():EvidenceValue<T>=>({state:'NOT_IN_EVIDENCE'});
export const displayValue=(v:EvidenceValue<string|number|boolean>)=>v.state==='PRESENT'?String(v.value):NOT_IN_EVIDENCE_TEXT;
/** Empty/blank text is treated as absent, so an empty string can never masquerade as a recorded value. */
export const presentOrAbsent=(value:string|null|undefined,evidenceItemId:string):EvidenceValue<string>=>{const t=(value??'').trim();return t?present(t,evidenceItemId):notInEvidence();};

/**
 * "Past certification" is text as written on the original. The schema is strict: there is no user id, role, time or signature field, so
 * a current system user can never be recorded as the certifier of a historical result (Plan §6.3 item 17, AT-HIST-07).
 */
export const pastCertificationSchema=z.discriminatedUnion('state',[
 z.strictObject({state:z.literal('AS_WRITTEN'),text:z.string().trim().min(1).max(200),evidenceItemId:z.string().min(1).max(80)}),
 z.strictObject({state:z.literal('NOT_IN_EVIDENCE')}),
]);
export type PastCertification=z.infer<typeof pastCertificationSchema>;

export const RESULT_VALUE_KEYS=['t21','t18','t13','sexXo','sexXxx','sexXxy','sexXyy','fetalGender','fetalFraction','qcStatus'] as const;
/**
 * Historical result import: file + parsed values + past certification. No release, epoch, export, report_version, current certifier
 * or HIS fields exist in this shape (Plan §11.11, §6.2 `historical_result_import`).
 */
export type HistoricalResultImport={
 pdfEvidenceItemId:string;
 pdfSha256:string;
 values:Record<typeof RESULT_VALUE_KEYS[number],EvidenceValue<string>>;
 pastCertification:PastCertification;
};
const resultValueSchema=z.discriminatedUnion('state',[
 z.strictObject({state:z.literal('PRESENT'),value:z.string().trim().min(1).max(120),evidenceItemId:z.string().min(1).max(80)}),
 z.strictObject({state:z.literal('NOT_IN_EVIDENCE')}),
]);
export const historicalResultImportSchema=z.strictObject({
 pdfEvidenceItemId:z.string().min(1).max(80),
 pdfSha256:z.string().regex(/^[a-f0-9]{64}$/),
 values:z.strictObject({t21:resultValueSchema,t18:resultValueSchema,t13:resultValueSchema,sexXo:resultValueSchema,sexXxx:resultValueSchema,sexXxy:resultValueSchema,sexXyy:resultValueSchema,fetalGender:resultValueSchema,fetalFraction:resultValueSchema,qcStatus:resultValueSchema}),
 pastCertification:pastCertificationSchema,
});

/** Facts transcribed from the original(s). OD-18 decides how many of these are required; completeness never changes eligibility. */
export type HistoricalFacts={
 hn:EvidenceValue<string>;name:EvidenceValue<string>;dob:EvidenceValue<string>;originalLocation:EvidenceValue<string>;
 collectionDate:EvidenceValue<string>;reportDate:EvidenceValue<string>;
 requestPaperPresent:EvidenceValue<boolean>;consentPaperPresent:EvidenceValue<boolean>;consentDecisionAsWritten:EvidenceValue<string>;
 pregnancyType:EvidenceValue<string>;resultPdf:EvidenceValue<string>;
};
/** OD-18 minimum-dataset options (a) and (b). Option (c) — transcribe every field — is undefined in the plan and is deliberately not implemented. */
export type MinimumProfile='OD18_A_IDENTITY_AND_ORIGINAL'|'OD18_B_BALANCED';
const PROFILE_REQUIRED:Record<MinimumProfile,readonly (keyof HistoricalFacts)[]>={
 OD18_A_IDENTITY_AND_ORIGINAL:['hn','name','dob','originalLocation'],
 // Plan OD-18 (b): (a) + collection/report date + Request/Consent presence + Consent decision as written + pregnancy type; the result PDF is "ถ้ามี" (optional).
 OD18_B_BALANCED:['hn','name','dob','originalLocation','collectionDate','reportDate','requestPaperPresent','consentPaperPresent','consentDecisionAsWritten','pregnancyType'],
};
export type Completeness={status:'COMPLETE'|'PARTIAL';missing:string[]};
export function evidenceCompleteness(facts:HistoricalFacts,profile:MinimumProfile):Completeness{
 const required=PROFILE_REQUIRED[profile];
 if(!required)throw new Error('PROFILE_NOT_DEFINED');
 const missing=required.filter(k=>facts[k].state!=='PRESENT').map(String);
 return {status:missing.length?'PARTIAL':'COMPLETE',missing};
}
