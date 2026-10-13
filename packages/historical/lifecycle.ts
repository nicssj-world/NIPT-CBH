import {evaluateEligibility,type EligibilityInput,type EligibilityResult} from './eligibility';
import type {Reason} from './types';

/** Historical Draft state machine (Plan §5.11 diagram). A Draft is staging, never a Case. */
export const DRAFT_STATES=['Draft','NotEligible','Submitted','Discrepancy','Conflict','Promoted','Abandoned'] as const;
export type DraftState=typeof DRAFT_STATES[number];
const DRAFT_NEXT:Record<DraftState,readonly DraftState[]>={
 Draft:['NotEligible','Submitted','Abandoned'],
 NotEligible:['Draft','Abandoned'],
 Submitted:['Discrepancy','Conflict','NotEligible','Promoted'],   // Owner baseline Q-P5H-02(b): a failed re-evaluation returns the row to NotEligible
 Discrepancy:['Draft'],
 Conflict:[],   // no exit in the plan diagram: resolution path is an open question (Q-P5H-05)
 Promoted:[],
 Abandoned:[],
};
export const canDraftTransition=(from:DraftState,to:DraftState)=>DRAFT_NEXT[from].includes(to);
export function assertDraftTransition(from:DraftState,to:DraftState){if(!canDraftTransition(from,to))throw new Error('ILLEGAL_DRAFT_TRANSITION');}
/** A Promoted draft cannot be edited (Plan §6.3 item 19); Abandoned/Conflict are terminal and keep their evidence. */
export const draftEditable=(s:DraftState)=>s==='Draft'||s==='NotEligible'||s==='Discrepancy';

/** `historical_record` of a Promoted Case (Plan §5.11). Withdrawn is reached only through the two-person queue (D-18). */
export const RECORD_STATES=['Verified','RevisionPending','Discrepancy','Withdrawn'] as const;
export type RecordState=typeof RECORD_STATES[number];
const RECORD_NEXT:Record<RecordState,readonly RecordState[]>={Verified:['RevisionPending','Withdrawn'],RevisionPending:['Verified','Discrepancy'],Discrepancy:['RevisionPending'],Withdrawn:[]};
export const canRecordTransition=(from:RecordState,to:RecordState)=>RECORD_NEXT[from].includes(to);

/** Independent identifiers a verifier must have checked against the original. LN is not an identity evidence (it is its own check). */
export const IDENTITY_CHECK_KEYS=['HN','NAME','DOB','NATIONAL_ID'] as const;
export type Attestation={
 lnMatchesOriginal:boolean|null;
 anchorDateMatchesOriginal:boolean|null;
 pdfBindingMatchesOriginal:boolean|null;
 identityIdentifiersChecked:readonly (typeof IDENTITY_CHECK_KEYS[number])[];
 identityMatchesOriginal:boolean|null;
};
export type DraftFacts={
 id:string;state:DraftState;
 /** Everyone who recorded or revised this draft's evidence (Plan §6.3 item 17: verifier ≠ recorder/editor). */
 contributorIds:readonly string[];
 promotedIdempotencyKey?:string|null;
};
export type Verifier={id:string;hasHistoricalVerifierRole:boolean};
export type PromotionInput={
 draft:DraftFacts;verifier:Verifier;attestation:Attestation;idempotencyKey:string;
 /** Fresh facts read under the LN lock at promotion time (re-evaluation, D-46). */
 reevaluation:EligibilityInput;
 /** Registry duplicates/identity conflicts found by the pre-check at promotion time. */
 registryFindings:readonly Reason[];
};

/** What a successful Promotion may create — and, equally important, what it must never create (Plan §4.8 H4, §6.3 items 15/16/21). */
export const PROMOTION_CREATES={
 caseOrigin:'HISTORICAL',
 caseLn:{source:'HISTORICAL_DOCUMENT',verification:'DOCUMENT_VERIFIED'},
 historicalRecordState:'Verified',
} as const;
export const PROMOTION_NEVER_CREATES=['his_order','his_received_at','specimen_round','analytical_attempt','batch_slot','qc_record','report_version','release','his_export','current_user_certification','consent_snapshot','signature_asset'] as const;

export type PromotionDecision=
 |{kind:'PROMOTE';evaluation:EligibilityResult;creates:typeof PROMOTION_CREATES;neverCreates:typeof PROMOTION_NEVER_CREATES;idempotencyKey:string}
 |{kind:'ALREADY_PROMOTED'}
 |{kind:'DISCREPANCY';fields:string[]}
 |{kind:'CONFLICT';reasons:Reason[]}
 |{kind:'NOT_ELIGIBLE';evaluation:EligibilityResult;reasons:Reason[]}
 |{kind:'REJECT';code:string;reasons?:Reason[]};

const CONFLICT_CODES=new Set(['LN_ALREADY_REGISTERED','NIPT_ACTIVITY_PET_APPLIED','NIPT_ACTIVITY_RECEIVED','NIPT_ACTIVITY_BATCH','NIPT_ACTIVITY_RELEASED','UNLINKED_INTAKE_AFTER_CUTOFF']);

/**
 * Pure promotion decision (AT-HIST-06/09/11/16). The caller applies the result inside ONE transaction holding the LN advisory lock; this
 * function performs no write. Order of checks is fail-closed: identity of actor, state, attestation, then duplicate/activity re-evaluation.
 */
export function decidePromotion(i:PromotionInput):PromotionDecision{
 if(!/^[A-Za-z0-9_-]{16,128}$/.test(i.idempotencyKey))return {kind:'REJECT',code:'IDEMPOTENCY_KEY_INVALID'};
 if(i.draft.state==='Promoted')return i.draft.promotedIdempotencyKey===i.idempotencyKey?{kind:'ALREADY_PROMOTED'}:{kind:'REJECT',code:'ALREADY_PROMOTED'};
 if(!i.verifier.hasHistoricalVerifierRole)return {kind:'REJECT',code:'FORBIDDEN'};
 if(i.draft.contributorIds.includes(i.verifier.id))return {kind:'REJECT',code:'SELF_VERIFICATION_PROHIBITED'};
 if(i.draft.state!=='Submitted')return {kind:'REJECT',code:'DRAFT_NOT_SUBMITTED'};

 const a=i.attestation;
 const checks:[string,boolean|null][]=[['ln',a.lnMatchesOriginal],['anchorDate',a.anchorDateMatchesOriginal],['pdfBinding',a.pdfBindingMatchesOriginal],['identity',a.identityMatchesOriginal]];
 if(checks.some(([,v])=>v===null))return {kind:'REJECT',code:'ATTESTATION_INCOMPLETE'};
 if(new Set(a.identityIdentifiersChecked).size<2)return {kind:'REJECT',code:'IDENTITY_NEEDS_TWO_INDEPENDENT_IDENTIFIERS'};
 const wrong=checks.filter(([,v])=>v===false).map(([k])=>k);
 if(wrong.length)return {kind:'DISCREPANCY',fields:wrong};

 if(i.registryFindings.length)return {kind:'CONFLICT',reasons:[...i.registryFindings]};
 const evaluation=evaluateEligibility(i.reevaluation);
 const conflict=evaluation.reasons.filter(r=>CONFLICT_CODES.has(r.code));
 if(conflict.length)return {kind:'CONFLICT',reasons:conflict};
 // Date/Anchor/cutoff failure at re-evaluation (Q-P5H-02(b)): the row goes back to NotEligible with the reasons; nothing is created.
 if(evaluation.outcome!=='Submitted')return {kind:'NOT_ELIGIBLE',evaluation,reasons:evaluation.reasons};
 return {kind:'PROMOTE',evaluation,creates:PROMOTION_CREATES,neverCreates:PROMOTION_NEVER_CREATES,idempotencyKey:i.idempotencyKey};
}

/** Second-person confirmation of a post-promotion Revision (Plan §5.11 record diagram, §6.3 item 17). */
export function decideRevisionVerification(i:{recordState:RecordState;editorIds:readonly string[];verifier:Verifier;matchesOriginal:boolean}):{kind:'VERIFIED'|'DISCREPANCY'}|{kind:'REJECT';code:string}{
 if(!i.verifier.hasHistoricalVerifierRole)return {kind:'REJECT',code:'FORBIDDEN'};
 if(i.recordState!=='RevisionPending')return {kind:'REJECT',code:'NO_REVISION_PENDING'};
 if(i.editorIds.includes(i.verifier.id))return {kind:'REJECT',code:'SELF_VERIFICATION_PROHIBITED'};
 return {kind:i.matchesOriginal?'VERIFIED':'DISCREPANCY'};
}

/** Withdrawal of a mis-classified historical Case: proposer ≠ approver, reason mandatory, record never deleted (D-18, Plan §5.11). */
export function decideWithdrawal(i:{recordState:RecordState;proposerId:string;approverId:string;reason:string}):{kind:'WITHDRAW'}|{kind:'REJECT';code:string}{
 if(i.recordState!=='Verified')return {kind:'REJECT',code:'ONLY_VERIFIED_CAN_BE_WITHDRAWN'};
 if(i.proposerId===i.approverId)return {kind:'REJECT',code:'TWO_PERSON_REQUIRED'};
 if(!i.reason.trim())return {kind:'REJECT',code:'REASON_REQUIRED'};
 return {kind:'WITHDRAW'};
}
