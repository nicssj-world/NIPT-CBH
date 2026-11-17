import {it,expect} from 'vitest';
import {commonPredicates,type CommonFacts} from '../../packages/lab/gate';
const facts:CommonFacts={labOperationalRoute:true,isCurrentRound:true,roundNumber:2,roundState:'ReceivedInHIS',receivedSource:'HIS_PET_RECEIPT',analysisStarted:false,isRepeatChild:false,previouslyFinalized:false,openIdentityIssues:0,lnVerifiedByPet:true,receiptIdentityAndLabel:false,consentRevoked:false,consentRoundEvidence:'NONE',requestRoundEvidence:'NONE',clinicalState:null,collectionDates:['2026-10-22']};
it('recorded LAB paper consent covers S2 without a fabricated digital consent or an extra receipt approval',()=>{
 expect(commonPredicates(facts).find(p=>p.code==='BG-04')?.status).toBe('PASS');
 expect(commonPredicates({...facts,consentRoundEvidence:'DECLINED'}).find(p=>p.code==='BG-04')?.status).toBe('FAIL');
 expect(commonPredicates({...facts,consentRevoked:true}).find(p=>p.code==='BG-04')?.status).toBe('FAIL');
 expect(commonPredicates({...facts,labOperationalRoute:false}).find(p=>p.code==='BG-04')?.status).toBe('PENDING');
});
it('a Lab paper-route case whose paper request check left PendingClinicalReview still passes BG-06, but a real clinical block does not',()=>{
 const bg06=(clinicalState:string|null)=>commonPredicates({...facts,clinicalState}).find(p=>p.code==='BG-06');
 expect(bg06(null)?.status).toBe('PASS');
 expect(bg06('PendingClinicalReview')).toMatchObject({status:'PASS',reason:'OWNER_LAB_DIRECT_PAPER_ROUTE'});
 expect(bg06('ClinicalDataConflict')?.status).toBe('FAIL');
 expect(bg06('BlockedWithReason')?.status).toBe('FAIL');
 expect(bg06('NotEvaluable')?.status).toBe('FAIL');
 expect(commonPredicates({...facts,labOperationalRoute:false,clinicalState:'PendingClinicalReview'}).find(p=>p.code==='BG-06')?.status).toBe('PENDING');
});
