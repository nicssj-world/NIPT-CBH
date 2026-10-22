import {it,expect} from 'vitest';
import {commonPredicates,type CommonFacts} from '../../packages/lab/gate';
const facts:CommonFacts={labOperationalRoute:true,isCurrentRound:true,roundNumber:2,roundState:'ReceivedInHIS',receivedSource:'HIS_PET_RECEIPT',analysisStarted:false,isRepeatChild:false,previouslyFinalized:false,openIdentityIssues:0,lnVerifiedByPet:true,receiptIdentityAndLabel:false,consentRevoked:false,consentRoundEvidence:'NONE',requestRoundEvidence:'NONE',clinicalState:null,collectionDates:['2026-10-22']};
it('recorded LAB paper consent covers S2 without a fabricated digital consent or an extra receipt approval',()=>{
 expect(commonPredicates(facts).find(p=>p.code==='BG-04')?.status).toBe('PASS');
 expect(commonPredicates({...facts,consentRoundEvidence:'DECLINED'}).find(p=>p.code==='BG-04')?.status).toBe('FAIL');
 expect(commonPredicates({...facts,consentRevoked:true}).find(p=>p.code==='BG-04')?.status).toBe('FAIL');
 expect(commonPredicates({...facts,labOperationalRoute:false}).find(p=>p.code==='BG-04')?.status).toBe('PENDING');
});
