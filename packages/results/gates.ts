// Final Result Release Gate RG-01..RG-13 and Redraw Notice Release Gate RN-01..RN-07 (Plan §5.9.2–§5.9.3, D-27, D-37).
// Three-valued like the Batch Gate. Unlike P4, there is no policy that proceeds past PENDING: release is never eligible while an
// Owner decision (OD-04/05/07/08/09/16) is open, and no setting, role or API can turn FAIL or PENDING into PASS.
// `dependency: 'P4b'` marks predicates that can only pass once P4b delivers QC4/QC5, Analysis completion and FinalQcAccepted.
export type Tri='PASS'|'FAIL'|'PENDING';
export type Cmp='MATCH'|'MISMATCH'|'NOT_AVAILABLE';
export type RgCode='RG-01'|'RG-02'|'RG-03'|'RG-04'|'RG-05'|'RG-06'|'RG-07'|'RG-08'|'RG-09'|'RG-10'|'RG-11'|'RG-12'|'RG-13';
export type RnCode='RN-01'|'RN-02'|'RN-03'|'RN-04'|'RN-05'|'RN-06'|'RN-07';
export type Governance='OD-04'|'OD-05'|'OD-07'|'OD-08'|'OD-09'|'OD-16';
export type GatePredicate={code:RgCode|RnCode;status:Tri;reason:string;governance?:Governance;dependency?:'P4b'};
export const RG_RULE_VERSION='P7-RG-CLOSED-CLINICAL-v2',RN_RULE_VERSION='P5-RN-SYNTHETIC-v1';
export type Purpose='VALIDATION'|'CERTIFY_ATTEMPT';

export type CrossCheck={hn:Cmp;dob:Cmp;pregnancy:Cmp;collectionDate:Cmp;gestationalAge:Cmp;labNumber:Cmp};
export type ResultFacts={
 templateKind:'SINGLETON'|'TWIN';templateApproved:boolean;missing:string[];pdfQc:string|null;
 linked:boolean;linkMode:'MANUAL_REVIEWED'|'AUTO_UNIQUE'|null;openProposal:boolean;cross:CrossCheck;
 attemptState:string|null;attemptIsLatest:boolean;hold:boolean;qc1Accepted:boolean;nonMeasuredQc1:boolean;batchCancelled:boolean;activeSlot:boolean;
 upstreamCurrent:boolean;upstreamReason:string|null;analysisAccepted:boolean;finalQcAccepted:boolean;
 isCurrentRound:boolean;roundState:string;roundNumber:number;openRepeat:boolean;
 openIdentityIssues:number;clinicalState:string|null;consentRevoked:boolean;consent:'GRANTED'|'DECLINED'|'PAPER_SELECTED'|'NONE';
 pregnancy:'Singleton'|'Twins'|null;sexPreference:string|null;sexShown:boolean;
 versionState:string;latestInSeries:boolean;activeReleaseInSeries:boolean;reviewedCurrent:boolean;
 certifierRoleActive:boolean;
 operationalReviewed?:boolean;
};
export type NoticeFacts={
 templateApproved:boolean;linked:boolean;openProposal:boolean;cross:CrossCheck;redrawForRound:boolean;redrawRequestedAt:Date|null;importedAt:Date;
 openIdentityIssues:number;consentRevoked:boolean;versionState:string;latestInSeries:boolean;reviewedCurrent:boolean;
};
const p=(code:GatePredicate['code'],status:Tri,reason:string,extra:Pick<GatePredicate,'governance'|'dependency'>={}):GatePredicate=>({code,status,reason,...extra});
/** Properties that must MATCH, and properties a template may not print (NOT_AVAILABLE allowed) but that must never contradict. */
export const LINK_KEYS={RESULT:{required:['hn','dob','pregnancy','collectionDate','gestationalAge'],optional:[]},REDRAW_NOTICE:{required:['hn'],optional:['dob','collectionDate']}} as const satisfies Record<string,{required:readonly (keyof CrossCheck)[];optional:readonly (keyof CrossCheck)[]}>;
export function crossFailures(c:CrossCheck,kind:keyof typeof LINK_KEYS){const k=LINK_KEYS[kind];return [...k.required.filter(x=>c[x]!=='MATCH'),...k.optional.filter(x=>c[x]==='MISMATCH')];}
/** Open versions (§5.7): linked and not yet released, superseded or voided. */
export const OPEN_STATES:readonly string[]=['Linked','ValidationBlocked','PendingCertification'];
const crossPredicate=(code:'RG-04'|'RN-04',c:CrossCheck,kind:keyof typeof LINK_KEYS,identityIssues:number)=>{
 if(identityIssues>0&&code==='RN-04')return p(code,'FAIL','IDENTITY_ISSUE_OPEN');
 const bad=crossFailures(c,kind);
 return bad.length?p(code,'FAIL',`${bad.some(k=>c[k]==='MISMATCH')?'MISMATCH':'NOT_AVAILABLE'}_${bad.map(k=>k.toUpperCase()).join('_')}`):p(code,'PASS','CROSS_CHECK_MATCH');
};

export function resultPredicates(f:ResultFacts,purpose:Purpose):GatePredicate[]{
 const out:GatePredicate[]=[];
 out.push(f.templateApproved?p('RG-01','PASS','TEMPLATE_APPROVED'):p('RG-01','PENDING','TEMPLATE_AND_PIC_NOT_APPROVED',{governance:'OD-07'}));
 out.push(f.missing.length?p('RG-02','FAIL',`UNREADABLE_${f.missing.map(x=>x.toUpperCase()).join('_')}`):f.templateKind==='SINGLETON'&&f.pdfQc!=='PASS'?p('RG-02','FAIL','PDF_QC_NOT_PASS'):p('RG-02','PASS','REQUIRED_VALUES_READABLE'));
 out.push(!f.linked?p('RG-03','FAIL','NOT_LINKED'):f.openProposal?p('RG-03','FAIL','LINK_PROPOSAL_OPEN'):p('RG-03','PASS',`LINKED_${f.linkMode}`));
 out.push(crossPredicate('RG-04',f.cross,'RESULT',0));
 out.push(!f.isCurrentRound?p('RG-05','FAIL','NOT_CURRENT_ROUND'):f.roundState==='RedrawRequested'?p('RG-05','FAIL','REDRAW_REQUESTED'):f.openRepeat?p('RG-05','FAIL','REPEAT_ORDER_OPEN')
  :!f.attemptIsLatest||['Superseded','BatchCancelled','Stopped','Cancelled'].includes(f.attemptState??'')?p('RG-05','FAIL',`ATTEMPT_NOT_CURRENT_${String(f.attemptState).toUpperCase()}`):p('RG-05','PASS','CURRENT_ROUND_CURRENT_ATTEMPT'));
 out.push(f.batchCancelled?p('RG-06','FAIL','BATCH_CANCELLED'):f.upstreamReason?p('RG-06','FAIL',f.upstreamReason,{dependency:'P4b'}):!['AnalysisComplete','FinalQcAccepted','Final'].includes(f.attemptState??'')?p('RG-06','FAIL','ANALYSIS_COMPLETION_NOT_RECORDED',{dependency:'P4b'})
  :!f.activeSlot?p('RG-06','FAIL','NO_ACTIVE_SLOT'):!f.upstreamCurrent?p('RG-06','FAIL','UPSTREAM_EVIDENCE_MISSING',{dependency:'P4b'}):!f.analysisAccepted?p('RG-06','FAIL','CLINICAL_ANALYSIS_ADAPTER_PENDING',{dependency:'P4b'}):p('RG-06','PASS','ANALYSIS_COMPLETE'));
 // RG-07 (v6.2, AT-QC-EARLY-02): only FinalQcAccepted counts; QC1 Accepted alone is never read as "all QC passed".
 out.push(f.hold?p('RG-07','FAIL','QC_HOLD_OPEN'):f.nonMeasuredQc1?p('RG-07','FAIL','QC1_SLOT_NOT_MEASURED'):f.upstreamReason?p('RG-07','FAIL',f.upstreamReason,{dependency:'P4b'}):f.attemptState==='FinalQcAccepted'?(!f.upstreamCurrent?p('RG-07','FAIL','UPSTREAM_EVIDENCE_MISSING',{dependency:'P4b'}):!f.finalQcAccepted?p('RG-07','FAIL','CLINICAL_FINAL_QC_ADAPTER_PENDING',{dependency:'P4b'}):p('RG-07','PASS','FINAL_QC_ACCEPTED'))
  :f.qc1Accepted?p('RG-07','FAIL','QC1_ONLY_NOT_FINAL_QC_ACCEPTED',{dependency:'P4b'}):p('RG-07','FAIL','FINAL_QC_NOT_ACCEPTED',{dependency:'P4b'}));
 out.push(f.openIdentityIssues>0?p('RG-08','FAIL','IDENTITY_ISSUE_OPEN'):p('RG-08','PASS','NO_IDENTITY_CONFLICT'));
 out.push(['Pass','AcknowledgedConditions'].includes(f.clinicalState??'')?p('RG-09','PASS','CLINICAL_GATE_PASS'):f.clinicalState==='PendingClinicalReview'?p('RG-09','PENDING','CLINICAL_RULES_NOT_APPROVED',{governance:'OD-08'}):p('RG-09','FAIL',f.clinicalState?`CLINICAL_${f.clinicalState.replace(/[^A-Za-z]/g,'_').toUpperCase()}`:'CLINICAL_NOT_ASSESSED'));
 out.push(f.consentRevoked?p('RG-10','FAIL','CONSENT_REVOKED'):f.consent==='GRANTED'?p('RG-10','PASS','CONSENT_GRANTED'):f.consent==='PAPER_SELECTED'?p('RG-10','PASS','PAPER_CONSENT_SELECTED'):f.consent==='DECLINED'?p('RG-10','FAIL','CONSENT_DECLINED'):f.roundNumber>=2?p('RG-10','PENDING','REDRAW_CONSENT_APPLICABILITY',{governance:'OD-16'}):p('RG-10','FAIL','CONSENT_NOT_GRANTED'));
 // RG-11 proposed OD-09 rule: a singleton report that shows fetal sex is blocked unless the recorded wish is "Want".
 out.push(f.templateKind==='TWIN'&&f.operationalReviewed?p('RG-11','PASS','TWIN_DISCLOSURE_REVIEWED'):f.templateKind==='TWIN'?p('RG-11','PENDING','TWIN_Y_CHROMOSOME_DISCLOSURE_RULE',{governance:'OD-09'})
  :!f.sexShown?p('RG-11','PASS','SEX_NOT_SHOWN'):f.sexPreference==='Want'&&f.operationalReviewed?p('RG-11','PASS','DISCLOSURE_REVIEWED'):f.sexPreference==='Want'?p('RG-11','PENDING','DISCLOSURE_RULE_PROPOSED_ONLY',{governance:'OD-09'})
  :f.sexPreference==='DoNotWant'?p('RG-11','FAIL','SEX_SHOWN_BUT_NOT_WANTED'):p('RG-11','FAIL','SEX_PREFERENCE_NOT_RECORDED'));
 out.push(!f.latestInSeries?p('RG-12','FAIL','NOT_LATEST_VERSION'):f.activeReleaseInSeries?p('RG-12','FAIL','ACTIVE_RELEASE_EXISTS'):!f.reviewedCurrent?p('RG-12','FAIL','REVIEW_NOT_RECORDED')
  :!OPEN_STATES.includes(f.versionState)?p('RG-12','FAIL',`VERSION_${f.versionState.toUpperCase()}`):p('RG-12','PASS','LATEST_REVIEWED_VERSION'));
 if(purpose==='CERTIFY_ATTEMPT')out.push(!f.certifierRoleActive?p('RG-13','FAIL','CERTIFIER_ROLE_NOT_ACTIVE'):f.operationalReviewed?p('RG-13','PASS','AUTHORIZED_SESSION_CONFIRMATION'):p('RG-13','PENDING','CONFIRMATION_METHOD_AND_GOVERNANCE_SIGNOFF',{governance:'OD-05'}));
 return out;
}

export function noticePredicates(f:NoticeFacts):GatePredicate[]{
 // RN-02 also carries the version currency/review conditions that RG-12 carries for results.
 return [
  f.templateApproved?p('RN-01','PASS','NOTICE_TEMPLATE_APPROVED'):p('RN-01','PENDING','NOTICE_TEMPLATE_NOT_APPROVED',{governance:'OD-07'}),
  !f.linked?p('RN-02','FAIL','NOT_LINKED'):f.openProposal?p('RN-02','FAIL','LINK_PROPOSAL_OPEN'):!f.latestInSeries?p('RN-02','FAIL','NOT_LATEST_VERSION'):!f.reviewedCurrent?p('RN-02','FAIL','REVIEW_NOT_RECORDED')
   :!OPEN_STATES.includes(f.versionState)?p('RN-02','FAIL',`VERSION_${f.versionState.toUpperCase()}`):p('RN-02','PASS','LINKED_TO_REDRAW_ROUND'),
  // AT-LIN-05: the operational Redraw order exists first; a notice imported before the order does not pass.
  !f.redrawForRound?p('RN-03','FAIL','NO_REDRAW_ORDER_FOR_ROUND'):f.redrawRequestedAt&&f.redrawRequestedAt>f.importedAt?p('RN-03','FAIL','NOTICE_IMPORTED_BEFORE_REDRAW_ORDER'):p('RN-03','PASS','REDRAW_ORDER_EXISTS'),
  crossPredicate('RN-04',f.cross,'REDRAW_NOTICE',f.openIdentityIssues),
  f.consentRevoked?p('RN-05','FAIL','CONSENT_REVOKED'):p('RN-05','PASS','CONSENT_NOT_WITHDRAWN'),
  p('RN-06','PASS','QC_NOT_REQUIRED_FOR_NOTICE'),
  p('RN-07','PENDING','NOTICE_CHANNEL_NIPT_ONLY_PENDING',{governance:'OD-07'})
 ];
}

export function decideGate(predicates:GatePredicate[],gate:'RG'|'RN'){
 const failed=predicates.filter(x=>x.status==='FAIL'),pending=predicates.filter(x=>x.status==='PENDING');
 return {gate,eligible:failed.length===0&&pending.length===0,failed:failed.map(x=>`${x.code}:${x.reason}`),pending:pending.map(x=>`${x.code}:${x.governance}:${x.reason}`),
  waitsForP4b:predicates.some(x=>x.dependency==='P4b'&&x.status!=='PASS'),predicates,ruleVersion:gate==='RG'?RG_RULE_VERSION:RN_RULE_VERSION};
}
export type GateDecision=ReturnType<typeof decideGate>;
