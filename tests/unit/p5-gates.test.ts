import {describe,it,expect} from 'vitest';
import {resultPredicates,noticePredicates,decideGate,type ResultFacts,type NoticeFacts,type CrossCheck} from '../../packages/results/gates';

const match:CrossCheck={hn:'MATCH',dob:'MATCH',pregnancy:'MATCH',collectionDate:'MATCH',gestationalAge:'MATCH',labNumber:'MATCH'};
// Theoretical accepted facts exercise the pure predicate's PASS branch. The runtime evidence
// reader always returns both clinical acceptance flags false; no clinical acceptance fixture exists.
const ideal:ResultFacts={templateKind:'SINGLETON',templateApproved:true,missing:[],pdfQc:'PASS',linked:true,linkMode:'MANUAL_REVIEWED',openProposal:false,cross:match,
 attemptState:'FinalQcAccepted',upstreamCurrent:true,upstreamReason:null,analysisAccepted:true,finalQcAccepted:true,attemptIsLatest:true,hold:false,qc1Accepted:true,nonMeasuredQc1:false,batchCancelled:false,activeSlot:true,isCurrentRound:true,roundState:'ReceivedInHIS',roundNumber:1,openRepeat:false,
 openIdentityIssues:0,clinicalState:'Pass',consentRevoked:false,consent:'GRANTED',pregnancy:'Singleton',sexPreference:'DoNotWant',sexShown:false,versionState:'PendingCertification',latestInSeries:true,activeReleaseInSeries:false,reviewedCurrent:true,certifierRoleActive:true};
const status=(f:Partial<ResultFacts>,code:string,purpose:'VALIDATION'|'CERTIFY_ATTEMPT'='VALIDATION')=>resultPredicates({...ideal,...f},purpose).find(p=>p.code===code)!;
describe('RG-01..RG-13 (Plan §5.9.2)',()=>{
 it('state strings never substitute for clinical evidence; upstream invalidation remains visible before adapter HOLD',()=>{
  expect(status({analysisAccepted:false},'RG-06').reason).toBe('CLINICAL_ANALYSIS_ADAPTER_PENDING');
  expect(status({finalQcAccepted:false},'RG-07').reason).toBe('CLINICAL_FINAL_QC_ADAPTER_PENDING');
  for(const code of ['RG-06','RG-07'])expect(status({upstreamCurrent:false,upstreamReason:'UPSTREAM_POOL_STOP_USE',analysisAccepted:false,finalQcAccepted:false},code).reason).toBe('UPSTREAM_POOL_STOP_USE');
 });
 it('even ideal facts are not eligible at certification: OD-05 keeps RG-13 PENDING',()=>{
  const d=decideGate(resultPredicates(ideal,'CERTIFY_ATTEMPT'),'RG');expect(d.eligible).toBe(false);expect(d.pending).toEqual(['RG-13:OD-05:CONFIRMATION_METHOD_AND_GOVERNANCE_SIGNOFF']);
  expect(decideGate(resultPredicates(ideal,'VALIDATION'),'RG').eligible).toBe(true);
 });
 it('unapproved template/PIC is PENDING OD-07 and blocks (RG-01)',()=>{expect(status({templateApproved:false},'RG-01')).toMatchObject({status:'PENDING',governance:'OD-07'});});
 it('unreadable required value or PDF QC not PASS fails RG-02',()=>{expect(status({missing:['xo']},'RG-02').reason).toBe('UNREADABLE_XO');expect(status({pdfQc:'FAIL'},'RG-02').reason).toBe('PDF_QC_NOT_PASS');});
 it('an open link proposal fails RG-03',()=>{expect(status({openProposal:true},'RG-03').status).toBe('FAIL');});
 it('conflicting lab numbers fail RG-04; an unavailable optional lab number remains allowed',()=>{
  expect(status({cross:{...match,labNumber:'MISMATCH'}},'RG-04')).toMatchObject({status:'FAIL',reason:'MISMATCH_LABNUMBER'});
  expect(status({cross:{...match,labNumber:'NOT_AVAILABLE'}},'RG-04')).toMatchObject({status:'PASS',reason:'CROSS_CHECK_MATCH'});
  expect(status({cross:{...match,dob:'NOT_AVAILABLE'}},'RG-04')).toMatchObject({status:'FAIL',reason:'NOT_AVAILABLE_DOB'});
 });
 it('AT-RG-05: DOB / pregnancy / round collection date mismatch fails RG-04',()=>{for(const k of ['dob','pregnancy','collectionDate'] as const)expect(status({cross:{...match,[k]:'MISMATCH'}},'RG-04').status).toBe('FAIL');expect(status({cross:{...match,hn:'NOT_AVAILABLE'}},'RG-04').status).toBe('FAIL');});
 it('AT-RG-02 / AT-RG-04: old round, superseded attempt, redraw, open repeat fail RG-05',()=>{
  expect(status({isCurrentRound:false},'RG-05').reason).toBe('NOT_CURRENT_ROUND');expect(status({roundState:'RedrawRequested'},'RG-05').reason).toBe('REDRAW_REQUESTED');
  expect(status({openRepeat:true},'RG-05').reason).toBe('REPEAT_ORDER_OPEN');expect(status({attemptState:'Superseded'},'RG-05').status).toBe('FAIL');expect(status({attemptIsLatest:false},'RG-05').status).toBe('FAIL');
 });
 it('AT-RG-03 / AT-RG-06: cancelled batch or no analysis completion fails RG-06',()=>{expect(status({batchCancelled:true},'RG-06').reason).toBe('BATCH_CANCELLED');expect(status({attemptState:'InProgress'},'RG-06')).toMatchObject({status:'FAIL',dependency:'P4b'});});
 it('AT-RG-01 / AT-QC-EARLY-02: QC1 Accepted is never read as final QC (RG-07)',()=>{
  expect(status({attemptState:'InProgress',qc1Accepted:true},'RG-07')).toMatchObject({status:'FAIL',reason:'QC1_ONLY_NOT_FINAL_QC_ACCEPTED',dependency:'P4b'});
  expect(status({attemptState:'AnalysisComplete'},'RG-07').status).toBe('FAIL');expect(status({hold:true},'RG-07').reason).toBe('QC_HOLD_OPEN');expect(status({nonMeasuredQc1:true},'RG-07').reason).toBe('QC1_SLOT_NOT_MEASURED');
 });
 it('AT-RG-07: identity conflict, revoked consent, missing round applicability',()=>{
  expect(status({openIdentityIssues:1},'RG-08').status).toBe('FAIL');expect(status({consentRevoked:true},'RG-10').status).toBe('FAIL');
  expect(status({consent:'NONE',roundNumber:2},'RG-10')).toMatchObject({status:'PENDING',governance:'OD-16'});expect(status({consent:'PAPER_SELECTED'},'RG-10')).toMatchObject({status:'PASS',reason:'PAPER_CONSENT_SELECTED'});expect(status({clinicalState:'PendingClinicalReview'},'RG-09')).toMatchObject({status:'PENDING',governance:'OD-08'});
 });
 it('AT-RES-05: sex shown but not wanted is blocked; twins wait for OD-09 (RG-11)',()=>{
  expect(status({sexShown:true,sexPreference:'DoNotWant'},'RG-11').reason).toBe('SEX_SHOWN_BUT_NOT_WANTED');expect(status({sexShown:true,sexPreference:null},'RG-11').status).toBe('FAIL');
  expect(status({sexShown:true,sexPreference:'Want'},'RG-11').status).toBe('PENDING');expect(status({templateKind:'TWIN'},'RG-11').governance).toBe('OD-09');
 });
 it('RG-12 needs latest reviewed version without another active release; RG-13 needs an active certifier',()=>{
  expect(status({reviewedCurrent:false},'RG-12').reason).toBe('REVIEW_NOT_RECORDED');expect(status({latestInSeries:false},'RG-12').status).toBe('FAIL');
  expect(status({versionState:'Superseded'},'RG-12','CERTIFY_ATTEMPT').status).toBe('FAIL');expect(status({versionState:'ValidationBlocked'},'RG-12','CERTIFY_ATTEMPT').status).toBe('PASS');expect(status({certifierRoleActive:false},'RG-13','CERTIFY_ATTEMPT').reason).toBe('CERTIFIER_ROLE_NOT_ACTIVE');
 });
});
describe('RN-01..RN-07 (Plan §5.9.3)',()=>{
 const notice:NoticeFacts={templateApproved:true,linked:true,openProposal:false,cross:match,redrawForRound:true,redrawRequestedAt:new Date('2026-10-10'),importedAt:new Date('2026-10-11'),openIdentityIssues:0,consentRevoked:false,versionState:'PendingCertification',latestInSeries:true,reviewedCurrent:true};
 const rn=(f:Partial<NoticeFacts>,code:string)=>noticePredicates({...notice,...f}).find(p=>p.code===code)!;
 it('AT-RG-08: no QC acceptance needed, but blocked without a Redraw order of that round',()=>{expect(rn({},'RN-06').status).toBe('PASS');expect(rn({redrawForRound:false},'RN-03').status).toBe('FAIL');});
 it('AT-LIN-05: a notice imported before the Redraw order fails RN-03',()=>{expect(rn({redrawRequestedAt:new Date('2026-10-12')},'RN-03').reason).toBe('NOTICE_IMPORTED_BEFORE_REDRAW_ORDER');});
 it('channel stays PENDING OD-07, so a notice is never eligible yet',()=>{expect(decideGate(noticePredicates(notice),'RN').pending).toEqual(['RN-07:OD-07:NOTICE_CHANNEL_NIPT_ONLY_PENDING']);});
});
