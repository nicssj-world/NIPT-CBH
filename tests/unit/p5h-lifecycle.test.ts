import {describe,it,expect} from 'vitest';
import {dayDate} from '../../packages/historical/dates';
import {evaluateEligibility,NO_ACTIVITY,type EligibilityInput} from '../../packages/historical/eligibility';
import {DRAFT_STATES,RECORD_STATES,canDraftTransition,canRecordTransition,assertDraftTransition,draftEditable,decidePromotion,decideRevisionVerification,decideWithdrawal,PROMOTION_NEVER_CREATES,type PromotionInput} from '../../packages/historical/lifecycle';
import {precheckHistoricalDraft,compareIdentity,type PrecheckInput} from '../../packages/historical/precheck';
import {assertCutoffChangeAllowed,appendCutoffVersion,activeCutoffOn,buildImpactReport} from '../../packages/historical/cutoff';
import {outboundBarrier,assertOutboundAllowed,assertNoForbiddenHistoricalEffects,HISTORICAL_OUTBOUND_PROHIBITED} from '../../packages/historical/barrier';
import {historicalAuditEvent,HISTORICAL_AUDIT_ACTIONS} from '../../packages/historical/audit';
import type {CutoffVersion} from '../../packages/historical/types';

const CUT:CutoffVersion={version:1,cutoff:'2026-01-01',effectiveFrom:'2025-12-01',impactReportHash:'a'.repeat(64)};
const elig=(over:Partial<EligibilityInput>={}):EligibilityInput=>({
 evidence:[{id:'e1',kind:'FINAL_RESULT_REPORT',originalLocation:'SYNTHETIC-CABINET-1',documentDate:dayDate(2025,12,20),appears:null,fileSha256:'b'.repeat(64),provenance:'PAPER_ORIGINAL',sourceRef:null}],
 events:[{id:'c1',type:'COLLECTION',date:dayDate(2025,12,10),evidenceItemId:'e1'}],cutoff:CUT,activity:NO_ACTIVITY,policy:{acceptedAnchorKinds:['FINAL_RESULT_REPORT']},...over});
const KEY='idem-key-0000000001';
const promo=(over:Partial<PromotionInput>={}):PromotionInput=>({
 draft:{id:'d1',state:'Submitted',contributorIds:['recorder-1','editor-2']},
 verifier:{id:'verifier-9',hasHistoricalVerifierRole:true},
 attestation:{lnMatchesOriginal:true,anchorDateMatchesOriginal:true,pdfBindingMatchesOriginal:true,identityMatchesOriginal:true,identityIdentifiersChecked:['HN','NAME']},
 idempotencyKey:KEY,reevaluation:elig(),registryFindings:[],...over});

describe('P5H draft and record state machines (Plan §5.11)',()=>{
 const legalDraft=new Set(['Draft>NotEligible','Draft>Submitted','Draft>Abandoned','NotEligible>Draft','NotEligible>Abandoned','Submitted>Discrepancy','Submitted>Conflict','Submitted>Promoted','Discrepancy>Draft']);
 it('allows exactly the transitions of the plan diagram and nothing else',()=>{
  for(const a of DRAFT_STATES)for(const b of DRAFT_STATES)expect(canDraftTransition(a,b),`${a}>${b}`).toBe(legalDraft.has(`${a}>${b}`));
  expect(()=>assertDraftTransition('Draft','Promoted')).toThrow('ILLEGAL_DRAFT_TRANSITION');
  expect(()=>assertDraftTransition('Promoted','Draft')).toThrow();
 });
 it('terminal states and Promoted drafts are not editable',()=>{
  expect(draftEditable('Draft')&&draftEditable('NotEligible')&&draftEditable('Discrepancy')).toBe(true);
  for(const s of ['Submitted','Conflict','Promoted','Abandoned'] as const)expect(draftEditable(s)).toBe(false);
 });
 it('record states: Withdrawn is terminal and only Verified can be withdrawn',()=>{
  const legal=new Set(['Verified>RevisionPending','Verified>Withdrawn','RevisionPending>Verified','RevisionPending>Discrepancy','Discrepancy>RevisionPending']);
  for(const a of RECORD_STATES)for(const b of RECORD_STATES)expect(canRecordTransition(a,b),`${a}>${b}`).toBe(legal.has(`${a}>${b}`));
 });
});

describe('P5H promotion decision (D-46, AT-HIST-06/09/11/16)',()=>{
 it('promotes a verified, eligible, conflict-free draft and states what it creates and never creates',()=>{
  const d=decidePromotion(promo());
  expect(d.kind).toBe('PROMOTE');
  if(d.kind!=='PROMOTE')return;
  expect(d.creates).toEqual({caseOrigin:'HISTORICAL',caseLn:{source:'HISTORICAL_DOCUMENT',verification:'DOCUMENT_VERIFIED'},historicalRecordState:'Verified'});
  for(const x of ['his_order','release','his_export','report_version','specimen_round','analytical_attempt','batch_slot','qc_record','current_user_certification','consent_snapshot','signature_asset'])expect(d.neverCreates).toContain(x);
  expect(d.evaluation.outcome).toBe('Submitted');
 });
 it('AT-HIST-11: the recorder or any editor cannot verify their own draft',()=>{
  for(const id of ['recorder-1','editor-2'])expect(decidePromotion(promo({verifier:{id,hasHistoricalVerifierRole:true}}))).toEqual({kind:'REJECT',code:'SELF_VERIFICATION_PROHIBITED'});
 });
 it('requires the Historical Verifier role',()=>{
  expect(decidePromotion(promo({verifier:{id:'v',hasHistoricalVerifierRole:false}}))).toEqual({kind:'REJECT',code:'FORBIDDEN'});
 });
 it('AT-HIST-11: only a Submitted draft can be promoted (NotEligible/Discrepancy/Conflict/Draft/Abandoned refused)',()=>{
  for(const s of ['Draft','NotEligible','Discrepancy','Conflict','Abandoned'] as const)expect(decidePromotion(promo({draft:{id:'d',state:s,contributorIds:['r']}}))).toEqual({kind:'REJECT',code:'DRAFT_NOT_SUBMITTED'});
 });
 it('AT-HIST-11: promotion is idempotent for the same key and refused for another key',()=>{
  const done={id:'d',state:'Promoted' as const,contributorIds:['r'],promotedIdempotencyKey:KEY};
  expect(decidePromotion(promo({draft:done}))).toEqual({kind:'ALREADY_PROMOTED'});
  expect(decidePromotion(promo({draft:done,idempotencyKey:'idem-key-0000000002'}))).toEqual({kind:'REJECT',code:'ALREADY_PROMOTED'});
  expect(decidePromotion(promo({idempotencyKey:'short'}))).toEqual({kind:'REJECT',code:'IDEMPOTENCY_KEY_INVALID'});
 });
 it('an unchecked attestation item is a rejection, not a pass',()=>{
  for(const k of ['lnMatchesOriginal','anchorDateMatchesOriginal','pdfBindingMatchesOriginal','identityMatchesOriginal'] as const)
   expect(decidePromotion(promo({attestation:{...promo().attestation,[k]:null}}))).toEqual({kind:'REJECT',code:'ATTESTATION_INCOMPLETE'});
 });
 it('identity needs two independent identifiers checked against the original',()=>{
  expect(decidePromotion(promo({attestation:{...promo().attestation,identityIdentifiersChecked:['HN']}}))).toEqual({kind:'REJECT',code:'IDENTITY_NEEDS_TWO_INDEPENDENT_IDENTIFIERS'});
  expect(decidePromotion(promo({attestation:{...promo().attestation,identityIdentifiersChecked:['HN','HN']}})).kind).toBe('REJECT');
  expect(decidePromotion(promo({attestation:{...promo().attestation,identityIdentifiersChecked:[]}})).kind).toBe('REJECT');
 });
 it('AT-HIST-09: a mismatch with the original returns Discrepancy listing the field, and creates nothing',()=>{
  expect(decidePromotion(promo({attestation:{...promo().attestation,identityMatchesOriginal:false,anchorDateMatchesOriginal:false}}))).toEqual({kind:'DISCREPANCY',fields:['anchorDate','identity']});
 });
 it('AT-HIST-16: a case registered meanwhile, or NIPT activity at promotion time, makes the draft a Conflict',()=>{
  expect(decidePromotion(promo({reevaluation:elig({activity:{...NO_ACTIVITY,caseLnExists:true}})}))).toMatchObject({kind:'CONFLICT',reasons:[{code:'LN_ALREADY_REGISTERED'}]});
  expect(decidePromotion(promo({reevaluation:elig({activity:{...NO_ACTIVITY,petApplied:true,inBatch:true}})}))).toMatchObject({kind:'CONFLICT'});
  expect(decidePromotion(promo({registryFindings:[{code:'IDENTITY_CONFLICT_SAME_HN',ref:'c'}]}))).toEqual({kind:'CONFLICT',reasons:[{code:'IDENTITY_CONFLICT_SAME_HN',ref:'c'}]});
  expect(decidePromotion(promo({reevaluation:elig({activity:{...NO_ACTIVITY,unlinkedIntakeHisReceivedAt:['2026-01-02T03:00:00Z']}})})).kind).toBe('CONFLICT');
 });
 it('a date/Anchor failure at re-evaluation refuses promotion and creates no case',()=>{
  expect(decidePromotion(promo({reevaluation:elig({evidence:[]})}))).toMatchObject({kind:'REJECT',code:'REEVALUATION_NOT_ELIGIBLE',reasons:[{code:'NO_ANCHOR'}]});
  expect(decidePromotion(promo({reevaluation:elig({cutoff:null})}))).toMatchObject({kind:'REJECT',code:'REEVALUATION_NOT_ELIGIBLE'});
 });
 it('AT-HIST-16 (pure part): whichever side wins the LN, there is never a second Case',()=>{
  // Registration first: promotion sees the registered LN. Promotion first: the later registration precheck sees a HISTORICAL case_ln.
  expect(decidePromotion(promo({reevaluation:elig({activity:{...NO_ACTIVITY,caseLnExists:true}})})).kind).toBe('CONFLICT');
  const later=precheckHistoricalDraft({ln:'2600100001',identifiers:{hn:'SYN-HN-1'},caseLns:[{ln:'2600100001',caseId:'c1',origin:'HISTORICAL',version:1}],activeDrafts:[],intakes:[],patients:[]});
  expect(later).toEqual({outcome:'QUEUE',findings:[{code:'LN_EXISTS_IN_CASE_LN',ref:'HISTORICAL:v1'}]});
 });
 it('revision verification and withdrawal are two-person',()=>{
  const v={id:'v9',hasHistoricalVerifierRole:true};
  expect(decideRevisionVerification({recordState:'RevisionPending',editorIds:['e1'],verifier:v,matchesOriginal:true})).toEqual({kind:'VERIFIED'});
  expect(decideRevisionVerification({recordState:'RevisionPending',editorIds:['e1'],verifier:v,matchesOriginal:false})).toEqual({kind:'DISCREPANCY'});
  expect(decideRevisionVerification({recordState:'RevisionPending',editorIds:['v9'],verifier:v,matchesOriginal:true})).toEqual({kind:'REJECT',code:'SELF_VERIFICATION_PROHIBITED'});
  expect(decideRevisionVerification({recordState:'Verified',editorIds:[],verifier:v,matchesOriginal:true})).toEqual({kind:'REJECT',code:'NO_REVISION_PENDING'});
  expect(decideRevisionVerification({recordState:'RevisionPending',editorIds:[],verifier:{id:'x',hasHistoricalVerifierRole:false},matchesOriginal:true})).toEqual({kind:'REJECT',code:'FORBIDDEN'});
  expect(decideWithdrawal({recordState:'Verified',proposerId:'a',approverId:'b',reason:'misclassified'})).toEqual({kind:'WITHDRAW'});
  expect(decideWithdrawal({recordState:'Verified',proposerId:'a',approverId:'a',reason:'x'})).toEqual({kind:'REJECT',code:'TWO_PERSON_REQUIRED'});
  expect(decideWithdrawal({recordState:'Verified',proposerId:'a',approverId:'b',reason:'  '})).toEqual({kind:'REJECT',code:'REASON_REQUIRED'});
  expect(decideWithdrawal({recordState:'RevisionPending',proposerId:'a',approverId:'b',reason:'x'})).toEqual({kind:'REJECT',code:'ONLY_VERIFIED_CAN_BE_WITHDRAWN'});
 });
});

describe('P5H duplicate and identity pre-check (AT-HIST-05/12)',()=>{
 const input=(o:Partial<PrecheckInput>={}):PrecheckInput=>({ln:'2600100001',identifiers:{hn:'SYN-HN-1',name:'Synthetic Patient A',dob:'1990-05-01'},caseLns:[],activeDrafts:[],intakes:[],patients:[],...o});
 it('is clear when nothing collides',()=>expect(precheckHistoricalDraft(input())).toEqual({outcome:'CLEAR',findings:[]}));
 it('finds an LN already in case_ln for every origin; leading zeros are significant',()=>{
  for(const origin of ['ANC','LAB_DIRECT','HISTORICAL'] as const)expect(precheckHistoricalDraft(input({caseLns:[{ln:'2600100001',caseId:'c',origin,version:1}]})).findings[0].code).toBe('LN_EXISTS_IN_CASE_LN');
  expect(precheckHistoricalDraft(input({ln:'0123',caseLns:[{ln:'123',caseId:'c',origin:'ANC',version:1}]})).outcome).toBe('CLEAR');
  expect(precheckHistoricalDraft(input({ln:'0123',caseLns:[{ln:'0123',caseId:'c',origin:'ANC',version:2}]})).outcome).toBe('QUEUE');
  expect(()=>precheckHistoricalDraft(input({ln:'12A'}))).toThrow();
 });
 it('finds another active draft (not itself) and any intake for the LN',()=>{
  expect(precheckHistoricalDraft(input({activeDrafts:[{id:'d2',ln:'2600100001'}]})).findings).toEqual([{code:'ACTIVE_DRAFT_EXISTS',ref:'d2'}]);
  expect(precheckHistoricalDraft(input({activeDrafts:[{id:'d2',ln:'2600100001'}],selfDraftId:'d2'})).outcome).toBe('CLEAR');
  expect(precheckHistoricalDraft(input({intakes:[{ln:'2600100001',state:'Unlinked'}]})).findings).toEqual([{code:'INTAKE_EXISTS_FOR_LN',ref:'Unlinked'}]);
 });
 it('never links by HN alone: HN-only match is queued unlinked, HN with differing name or DOB is a conflict',()=>{
  const p=(i:object)=>({caseId:'c9',identifiers:i});
  expect(precheckHistoricalDraft(input({identifiers:{hn:'SYN-HN-1'},patients:[p({hn:'SYN-HN-1'})]})).findings).toEqual([{code:'HN_ONLY_MATCH_NOT_LINKED',ref:'c9'}]);
  expect(precheckHistoricalDraft(input({patients:[p({hn:'SYN-HN-1',name:'Someone Else',dob:'1990-05-01'})]})).findings).toEqual([{code:'IDENTITY_CONFLICT_SAME_HN',ref:'c9'}]);
  expect(precheckHistoricalDraft(input({patients:[p({hn:'SYN-HN-1',name:'Synthetic Patient A',dob:'1991-05-01'})]})).findings).toEqual([{code:'IDENTITY_CONFLICT_SAME_HN',ref:'c9'}]);
  expect(precheckHistoricalDraft(input({patients:[p({hn:'SYN-HN-1',name:'  synthetic   patient a ',dob:'1990-05-01'})]})).findings).toEqual([{code:'IDENTITY_MATCH_EXISTING_PATIENT_REVIEW',ref:'c9'}]);   // still queued for a person; nothing auto-links
  expect(precheckHistoricalDraft(input({patients:[p({hn:'SYN-HN-2',name:'Synthetic Patient A',dob:'1990-05-01'})]})).findings).toEqual([{code:'POSSIBLE_DUPLICATE_PATIENT_DIFFERENT_HN',ref:'c9'}]);
  expect(precheckHistoricalDraft(input({patients:[p({hn:'SYN-HN-2',name:'Other Person',dob:'1990-05-01'})]})).outcome).toBe('CLEAR');
 });
 it('identity comparison needs two comparable identifiers to call a match',()=>{
  expect(compareIdentity({hn:'1'},{hn:'1'}).outcome).toBe('INSUFFICIENT');
  expect(compareIdentity({hn:'1',name:'a'},{hn:'1',name:'a'}).outcome).toBe('MATCH');
  expect(compareIdentity({hn:'1',name:'a'},{hn:'1',name:'b'}).differing).toEqual(['name']);
  expect(compareIdentity({hn:'',name:null},{hn:'1'}).comparable).toEqual([]);
 });
});

describe('P5H cutoff change control (D-50, OD-27, AT-HIST-14/15)',()=>{
 const v2:CutoffVersion={version:2,cutoff:'2025-12-15',effectiveFrom:'2025-12-10',impactReportHash:'c'.repeat(64)};
 it('interim OD-27: changing the cutoff after any HISTORICAL case exists is refused; other options are not guessed',()=>{
  expect(()=>assertCutoffChangeAllowed({hasHistoricalCase:false,od27:'PENDING'})).not.toThrow();
  expect(()=>assertCutoffChangeAllowed({hasHistoricalCase:true,od27:'PENDING'})).toThrow('OD27_REQUIRED');
  expect(()=>assertCutoffChangeAllowed({hasHistoricalCase:true,od27:'C_FROZEN_AFTER_FIRST_PROMOTION'})).toThrow('CUTOFF_FROZEN_AFTER_FIRST_PROMOTION');
  expect(()=>assertCutoffChangeAllowed({hasHistoricalCase:true,od27:'A_CHANGE_WITH_IMPACT_REVIEW'})).toThrow('OD27_OPTION_NOT_IMPLEMENTED');
  expect(()=>assertCutoffChangeAllowed({hasHistoricalCase:true,od27:'B_CHANGE_NO_REVIEW'})).toThrow('OD27_OPTION_NOT_IMPLEMENTED');
 });
 it('versions are insert-only, sequential and frozen; the active version is chosen by effective day',()=>{
  const list=appendCutoffVersion([],CUT);
  expect(()=>appendCutoffVersion(list,{...CUT,version:3})).toThrow('CUTOFF_VERSION_NOT_SEQUENTIAL');
  expect(()=>appendCutoffVersion([],{...CUT,version:2})).toThrow('CUTOFF_VERSION_NOT_SEQUENTIAL');
  expect(()=>appendCutoffVersion(list,{...v2,effectiveFrom:'2025-11-01'})).toThrow('CUTOFF_EFFECTIVE_FROM_REGRESSION');
  expect(()=>appendCutoffVersion(list,{...v2,cutoff:'2025-13-01'})).toThrow('INVALID_CUTOFF');
  const both=appendCutoffVersion(list,v2);
  expect(()=>{(both[0] as {cutoff:string}).cutoff='2030-01-01';}).toThrow();   // frozen
  expect(activeCutoffOn(both,'2025-11-30')).toBeNull();
  expect(activeCutoffOn(both,'2025-12-09')?.version).toBe(1);
  expect(activeCutoffOn(both,'2025-12-10')?.version).toBe(2);
 });
 it('impact report is deterministic, read-only and does not change stored evaluations',()=>{
  const e1=evaluateEligibility(elig());
  const earlier=evaluateEligibility(elig({evidence:[{...elig().evidence[0],documentDate:dayDate(2025,6,1)}],events:[{id:'c1',type:'COLLECTION',date:dayDate(2025,6,1),evidenceItemId:null}]}));
  const items=[{id:'case-b',kind:'PROMOTED_CASE' as const,evaluationHash:earlier.hash,snapshot:earlier.snapshot},{id:'case-a',kind:'PROMOTED_CASE' as const,evaluationHash:e1.hash,snapshot:e1.snapshot},{id:'draft-1',kind:'SUBMITTED_DRAFT' as const,evaluationHash:e1.hash,snapshot:e1.snapshot}];
  const before=JSON.stringify(items);
  const r=buildImpactReport(CUT,v2,items);
  expect(r).toMatchObject({from:1,to:2,unaffected:['case-b'],wouldNoLongerQualify:['case-a'],draftsToReevaluate:['draft-1']});
  expect(buildImpactReport(CUT,v2,[...items].reverse()).hash).toBe(r.hash);
  expect(r.hash).toMatch(/^[a-f0-9]{64}$/);
  expect(JSON.stringify(items)).toBe(before);
  expect(evaluateEligibility(elig()).hash).toBe(e1.hash);   // original evaluation is unchanged by the existence of v2 (AT-HIST-14)
  const moved=buildImpactReport(CUT,{...v2,cutoff:'2026-06-01'},items);   // moving the cutoff later keeps everyone qualified
  expect(moved.wouldNoLongerQualify).toEqual([]);
 });
});

describe('P5H outbound barrier and forbidden effects (LD-10, D-43, AT-HIST-04/13)',()=>{
 it('historical origin can never pass the barrier, whatever its LN status',()=>{
  for(const ln of ['DOCUMENT_VERIFIED','VERIFIED_BY_PET','AWAITING_PET','RETIRED','']){
   expect(outboundBarrier({origin:'HISTORICAL',lnVerification:ln})).toEqual({allowed:false,code:HISTORICAL_OUTBOUND_PROHIBITED});
   expect(()=>assertOutboundAllowed({origin:'HISTORICAL',lnVerification:ln})).toThrow(HISTORICAL_OUTBOUND_PROHIBITED);
  }
 });
 it('is deny-by-default: unknown origin or an LN not verified by .pet is refused; only verified current cases pass',()=>{
  expect(outboundBarrier({origin:'historical',lnVerification:'VERIFIED_BY_PET'})).toEqual({allowed:false,code:'UNKNOWN_ORIGIN'});
  expect(outboundBarrier({origin:'',lnVerification:'VERIFIED_BY_PET'}).allowed).toBe(false);
  expect(outboundBarrier({origin:'ANC',lnVerification:'DOCUMENT_VERIFIED'})).toEqual({allowed:false,code:'LN_NOT_VERIFIED_BY_PET'});
  expect(outboundBarrier({origin:'LAB_DIRECT',lnVerification:'AWAITING_PET'}).allowed).toBe(false);
  expect(outboundBarrier({origin:'ANC',lnVerification:'VERIFIED_BY_PET'})).toEqual({allowed:true});
  expect(outboundBarrier({origin:'LAB_DIRECT',lnVerification:'VERIFIED_BY_PET'})).toEqual({allowed:true});
 });
 it('refuses any planned historical effect that would fabricate clinical release evidence',()=>{
  for(const e of PROMOTION_NEVER_CREATES)expect(()=>assertNoForbiddenHistoricalEffects(['historical_record',e])).toThrow(`HISTORICAL_FORBIDDEN_EFFECT:${e}`);
  expect(()=>assertNoForbiddenHistoricalEffects(['nipt_case','case_ln','historical_record','historical_event'])).not.toThrow();
 });
});

describe('P5H audit events carry codes only (REQ-HIST-09)',()=>{
 it('builds sanitised events inside the existing vocabulary',()=>{
  const e=historicalAuditEvent({actorId:'u1',action:'HIST_PROMOTE_REJECTED',resourceType:'HISTORICAL_DRAFT',resourceId:'d1',outcome:'REJECTED',reasonCode:'SELF_VERIFICATION_PROHIBITED',version:1,count:0,ruleVersion:'P5H-ELIGIBILITY-SYNTHETIC-v1'});
  expect(e.details).toEqual({outcome:'REJECTED',synthetic:true,reasonCode:'SELF_VERIFICATION_PROHIBITED',version:1,count:0,ruleVersion:'P5H-ELIGIBILITY-SYNTHETIC-v1'});
  expect(HISTORICAL_AUDIT_ACTIONS.every(a=>/^[A-Za-z_][A-Za-z0-9_.-]{0,79}$/.test(a))).toBe(true);
 });
 it('rejects free text such as an LN, HN, name or date in any audit field',()=>{
  const ok={action:'HIST_SUBMITTED' as const,resourceType:'HISTORICAL_DRAFT' as const,outcome:'OK'};
  for(const bad of ['LN 2600100001','Synthetic Patient A','2025-12-20 10:00','ผู้ป่วย'])expect(()=>historicalAuditEvent({...ok,reasonCode:bad})).toThrow('Unsafe audit details');
  expect(()=>historicalAuditEvent({...ok,outcome:'has space'})).toThrow('Unsafe audit details');
  expect(()=>historicalAuditEvent({...ok,action:'HIST_SOMETHING_ELSE' as never})).toThrow('Invalid audit vocabulary');
 });
});
