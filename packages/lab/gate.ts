// Batch Gate (Plan §5.9.1, D-68): Assignment Gate and Finalize Gate share BG-01..07; each stage adds its own predicates.
// Predicates are three-valued. PENDING means an Owner/clinical decision does not exist yet (OD-01, OD-08, OD-16): it is never
// silently converted to PASS. Only the maker-checker `laboratory.pendingGovernanceGate = PROCEED_SYNTHETIC_LABELLED`
// policy lets a synthetic batch proceed past PENDING, and the result is labelled as such. FAIL is never overridable.
export type Tri = "PASS" | "FAIL" | "PENDING";
export type GateCode = "BG-01" | "BG-02" | "BG-03" | "BG-04" | "BG-05" | "BG-06" | "BG-07" | "BG-08A" | "BG-09A" | "BG-08F" | "BG-09F" | "BG-10F";
export type Predicate = { code: GateCode; status: Tri; reason: string; governance?: "OD-01" | "OD-08" | "OD-16" };
export type PendingPolicy = "HOLD" | "PROCEED_SYNTHETIC_LABELLED";
export const GATE_RULE_VERSION = "P4-BG-SYNTHETIC-v1";

export type CommonFacts = {
  labOperationalRoute?: boolean;
  isCurrentRound: boolean; roundNumber: number; roundState: string; receivedSource: string | null; analysisStarted: boolean; isRepeatChild: boolean; previouslyFinalized: boolean;
  openIdentityIssues: number; lnVerifiedByPet: boolean; receiptIdentityAndLabel: boolean;
  consentRevoked: boolean; consentRoundEvidence: "GRANTED" | "DECLINED" | "PAPER_SELECTED" | "NONE";
  requestRoundEvidence: "VERIFIED" | "NONE";
  clinicalState: string | null; collectionDates: string[];specimenAccepted?:boolean;
};
export type AssignmentFacts = CommonFacts & { attemptState: string; hasActiveSlot: boolean; onHold: boolean; resumeDecisionRequired: boolean; repeatOrderState: string | null; printedIdAvailable: "YES" | "PREGNANCY_UNCONFIRMED" | "OD03_FORMAT_PENDING" };
export type FinalizeFacts = CommonFacts & { attemptState: string; activeSlotsInThisSheet: number; activeSlotsElsewhere: number; onHold: boolean; resumeDecisionRequired: boolean; repeatOrderState: string | null; sheetPlanCheckedAtVersion: boolean };

const p = (code: GateCode, status: Tri, reason: string, governance?: Predicate["governance"]): Predicate => ({ code, status, reason, ...(governance ? { governance } : {}) });

export function commonPredicates(f: CommonFacts): Predicate[] {
  const channelOk = (f.receivedSource === "HIS_PET_RECEIPT" && f.roundState === "ReceivedInHIS") || (f.roundNumber >= 2 && f.receivedSource === "NIPT_LOCAL_RECEIPT" && f.roundState === "ReceivedInNIPT");
  const bg01 = !f.isCurrentRound ? p("BG-01", "FAIL", "NOT_CURRENT_ROUND") : !channelOk ? p("BG-01", "FAIL", f.roundState === "RedrawRequested" ? "REDRAW_REQUESTED" : "NOT_RECEIVED")
    : f.analysisStarted && !f.isRepeatChild && !f.previouslyFinalized ? p("BG-01", "FAIL", "ANALYSIS_STARTED_REQUIRES_REPEAT_LINEAGE") : p("BG-01", "PASS", "RECEIVED_CURRENT_ROUND");
  const bg03 = f.openIdentityIssues > 0 ? p("BG-03", "FAIL", "IDENTITY_ISSUE_OPEN") : f.receivedSource==='HIS_PET_RECEIPT' ? (f.lnVerifiedByPet ? p("BG-03", "PASS", "LN_VERIFIED_BY_PET") : p("BG-03", "FAIL", "LN_NOT_VERIFIED"))
    : f.receiptIdentityAndLabel ? p("BG-03", "PASS", "RECEIPT_IDENTITY_AND_LABEL_CHECKED") : p("BG-03", "FAIL", "RECEIPT_CHECK_INCOMPLETE");
  const bg04 = f.consentRevoked ? p("BG-04", "FAIL", "CONSENT_REVOKED") : f.consentRoundEvidence === "GRANTED" ? p("BG-04", "PASS", "CONSENT_GRANTED")
    : f.consentRoundEvidence === "PAPER_SELECTED" ? p("BG-04", "PASS", "PAPER_CONSENT_SELECTED")
    : f.consentRoundEvidence === "DECLINED" ? p("BG-04", "FAIL", "CONSENT_DECLINED") : f.labOperationalRoute ? p("BG-04", "PASS", "LAB_PAPER_CONSENT_PRESENT") : f.roundNumber >= 2 ? p("BG-04", "PENDING", "REDRAW_CONSENT_APPLICABILITY", "OD-16") : p("BG-04", "FAIL", "CONSENT_NOT_GRANTED");
  const bg05 = f.labOperationalRoute ? p("BG-05","PASS","LAB_PAPER_REQUEST_PRESENT") : f.requestRoundEvidence === "VERIFIED" ? p("BG-05", "PASS", "REQUEST_VERIFIED") : f.roundNumber >= 2 ? p("BG-05", "PENDING", "REDRAW_REQUEST_APPLICABILITY", "OD-16") : p("BG-05", "FAIL", "REQUEST_NOT_VERIFIED");
  const bg06 = f.labOperationalRoute&&!f.clinicalState ? p("BG-06","PASS","OWNER_LAB_DIRECT_PAPER_ROUTE") : f.clinicalState==='ClinicalPassed'?p('BG-06','PASS','CURRENT_CLINICAL_REVIEW_ACCEPTED'):f.clinicalState === "PendingClinicalReview" ? p("BG-06", "PENDING", "CLINICAL_RULES_NOT_APPROVED", "OD-08") : f.clinicalState ? p("BG-06", "FAIL", `CLINICAL_${f.clinicalState.replace(/[^A-Za-z]/g, "_").toUpperCase()}`) : p("BG-06", "FAIL", "CLINICAL_NOT_ASSESSED");
  const dates = new Set(f.collectionDates);
  const bg07 = dates.size === 1 ? p("BG-07", "PASS", "COLLECTION_DATE_CONSISTENT") : dates.size === 0 ? p("BG-07", "FAIL", "COLLECTION_DATE_MISSING") : p("BG-07", "FAIL", "COLLECTION_DATE_CONFLICT");
  return [bg01, f.labOperationalRoute?p('BG-02','PASS','LAB_SPECIMEN_PRESENT'):f.specimenAccepted?p('BG-02','PASS','SPECIMEN_ACCEPTED'):p("BG-02", "PENDING", "SPECIMEN_ACCEPTANCE_POLICY", "OD-01"), bg03, bg04, bg05, bg06, bg07];
}

export function assignmentPredicates(f: AssignmentFacts): Predicate[] {
  const bg08 = f.attemptState !== "Ready" ? p("BG-08A", "FAIL", `ATTEMPT_${f.attemptState.toUpperCase()}`) : f.hasActiveSlot ? p("BG-08A", "FAIL", "ACTIVE_SLOT_EXISTS")
    : f.onHold ? p("BG-08A", "FAIL", "ATTEMPT_ON_HOLD") : f.resumeDecisionRequired ? p("BG-08A", "FAIL", "RESUME_DECISION_REQUIRED")
    : f.printedIdAvailable === "PREGNANCY_UNCONFIRMED" ? p("BG-08A", "FAIL", "PREGNANCY_TYPE_UNCONFIRMED") : f.printedIdAvailable === "OD03_FORMAT_PENDING" ? p("BG-08A", "FAIL", "PRINTED_ID_FORMAT_PENDING_OD03")
    : p("BG-08A", "PASS", "ATTEMPT_READY");
  const bg09 = !f.isRepeatChild ? p("BG-09A", "PASS", "NOT_A_REPEAT") : f.repeatOrderState === "RepeatPendingBatch" ? p("BG-09A", "PASS", "REPEAT_PENDING_BATCH") : p("BG-09A", "FAIL", "REPEAT_ORDER_NOT_PENDING_BATCH");
  return [...commonPredicates(f), bg08, bg09];
}

export function finalizePredicates(f: FinalizeFacts): Predicate[] {
  const bg08 = f.attemptState !== "Assigned" ? p("BG-08F", "FAIL", `ATTEMPT_${f.attemptState.toUpperCase()}`) : f.activeSlotsInThisSheet !== 1 || f.activeSlotsElsewhere !== 0 ? p("BG-08F", "FAIL", "SLOT_NOT_EXACT")
    : f.onHold ? p("BG-08F", "FAIL", "ATTEMPT_ON_HOLD") : f.resumeDecisionRequired ? p("BG-08F", "FAIL", "RESUME_DECISION_REQUIRED") : p("BG-08F", "PASS", "ASSIGNED_EXACT_SLOT");
  const bg09 = !f.isRepeatChild ? p("BG-09F", "PASS", "NOT_A_REPEAT") : f.repeatOrderState === "RepeatInProgress" ? p("BG-09F", "PASS", "REPEAT_IN_PROGRESS") : p("BG-09F", "FAIL", "REPEAT_ORDER_NOT_IN_PROGRESS");
  const bg10 = f.sheetPlanCheckedAtVersion ? p("BG-10F", "PASS", "PLAN_CHECKED_CURRENT_VERSION") : p("BG-10F", "FAIL", "PLAN_CHECK_STALE");
  return [...commonPredicates(f), bg08, bg09, bg10];
}

export function decide(predicates: Predicate[], policy: PendingPolicy) {
  const failed = predicates.filter(x => x.status === "FAIL"), pending = predicates.filter(x => x.status === "PENDING");
  const eligible = failed.length === 0 && (pending.length === 0 || policy === "PROCEED_SYNTHETIC_LABELLED");
  return { eligible, syntheticPendingAccepted: eligible && pending.length > 0, failed: failed.map(x => x.reason), pending: pending.map(x => `${x.governance}:${x.reason}`), predicates, ruleVersion: GATE_RULE_VERSION, policy };
}
export type GateDecision = ReturnType<typeof decide>;
