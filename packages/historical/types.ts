import {z} from 'zod';
import {assertHistoricalDate,type HistoricalDate} from './dates';

/** Plan §6.2 `historical_evidence_item` kinds. Request/Consent paper kinds can never be an Anchor (R-43). */
export const EVIDENCE_KINDS=['REQUEST_PAPER','CONSENT_PAPER','FINAL_RESULT_REPORT','LAB_CONTROL_RECORD','SAMPLE_RECEIPT_RECORD','REDRAW_NOTICE','LEGACY_DB_RECORD','LEGACY_EXPORT_LOG','OTHER'] as const;
export type EvidenceKind=typeof EVIDENCE_KINDS[number];
/** Never accepted as an Anchor whatever the policy says: they pre-date the specimen and prove nothing about completion. */
export const NEVER_ANCHOR_KINDS:readonly EvidenceKind[]=['REQUEST_PAPER','CONSENT_PAPER','REDRAW_NOTICE','LEGACY_EXPORT_LOG','OTHER','LEGACY_DB_RECORD'];
/** LEGACY_DB_RECORD stays excluded until OD-18 names a controlled legacy register as an accepted Anchor (open question Q-P5H-03). */
export const ANCHOR_CAPABLE_KINDS:readonly EvidenceKind[]=['FINAL_RESULT_REPORT','LAB_CONTROL_RECORD','SAMPLE_RECEIPT_RECORD'];

const dateSchema=z.custom<HistoricalDate>(v=>{try{assertHistoricalDate(v as HistoricalDate);return true;}catch{return false;}},'INVALID_HISTORICAL_DATE');

/**
 * Evidence item. `.strict()` is the structural guarantee behind AT-HIST-01/07: there is no signature, certifier, releasedBy or
 * consent-snapshot field to fill — an unknown key (e.g. `signature`, `certifiedByUserId`) is rejected, not ignored.
 */
export const evidenceItemSchema=z.strictObject({
 id:z.string().min(1).max(80),
 kind:z.enum(EVIDENCE_KINDS),
 originalLocation:z.string().trim().min(1).max(200).nullable(),
 documentDate:dateSchema,
 /** What the document shows, exactly as written (e.g. consent decision as it appears); null = not in evidence. */
 appears:z.string().trim().max(200).nullable(),
 /** SHA-256 of an attached file (e.g. scan or PDF), when one exists. */
 fileSha256:z.string().regex(/^[a-f0-9]{64}$/).nullable(),
 provenance:z.enum(['PAPER_ORIGINAL','SCAN_OF_PAPER','LEGACY_NIPTY_DB_FIELD','LEGACY_NIPTY_FILE']),
 /** Legacy source reference (table.column or file kind); never a path to patient data. */
 sourceRef:z.string().trim().max(120).nullable(),
});
export type EvidenceItem=z.infer<typeof evidenceItemSchema>;

export const EVENT_TYPES=['COLLECTION','RECEIPT','REPORT','ORDER_REQUEST','OTHER'] as const;
export const historicalEventSchema=z.strictObject({
 id:z.string().min(1).max(80),
 type:z.enum(EVENT_TYPES),
 date:dateSchema,
 evidenceItemId:z.string().min(1).max(80).nullable(),
});
export type HistoricalEvent=z.infer<typeof historicalEventSchema>;

/** Insert-only cutoff version (D-50). `cutoff` is the first calendar day on which the new system is in use. */
export const cutoffVersionSchema=z.strictObject({
 version:z.number().int().positive(),
 cutoff:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
 effectiveFrom:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
 impactReportHash:z.string().regex(/^[a-f0-9]{64}$/),
});
export type CutoffVersion=z.infer<typeof cutoffVersionSchema>;

export type Reason={code:string;ref?:string};
