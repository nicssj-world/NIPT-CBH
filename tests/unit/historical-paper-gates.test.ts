import {it,expect} from 'vitest';
import {commonPredicates,type CommonFacts} from '../../packages/lab/gate';
// Owner 2026-11-02: a case imported from Genomic-CBH was requested and consented on paper. Neither is "missing an electronic form" or a clinical
// assessment; the physical specimen acceptance (BG-02) and every other gate stay as they are for work done in NIPT-CBH.
const base:CommonFacts={isCurrentRound:true,roundNumber:1,roundState:'ReceivedInHIS',receivedSource:'HIS_PET_RECEIPT',analysisStarted:false,isRepeatChild:false,previouslyFinalized:false,
 openIdentityIssues:0,lnVerifiedByPet:true,receiptIdentityAndLabel:false,consentRevoked:false,consentRoundEvidence:'NONE',requestRoundEvidence:'NONE',clinicalState:null,collectionDates:['2026-10-14']};
const by=(f:CommonFacts)=>Object.fromEntries(commonPredicates(f).map(p=>[p.code,p]));
it('an ordinary received case without request, consent or clinical assessment is still blocked on each of them',()=>{
 const g=by(base);
 expect(g['BG-04'].status).not.toBe('PASS');expect(g['BG-05'].status).not.toBe('PASS');expect(g['BG-06'].status).not.toBe('PASS');expect(g['BG-02']).toMatchObject({status:'PASS',reason:'HIS_RECEIPT_BY_PET'});
});
it('a historical paper case passes request, consent, clinical and acceptance; a verified PET receipt is the HIS receipt',()=>{
 const g=by({...base,lnVerifiedByPet:false,historicalPaper:true,consentRoundEvidence:'PAPER_SELECTED'});
 expect(g['BG-04']).toMatchObject({status:'PASS',reason:'HISTORICAL_PAPER_CONSENT'});
 expect(g['BG-02']).toMatchObject({status:'PASS',reason:'HISTORICAL_MIGRATION'});
expect(g['BG-05']).toMatchObject({status:'PASS',reason:'HISTORICAL_PAPER_REQUEST'}); expect(g['BG-06']).toMatchObject({status:'PASS',reason:'HISTORICAL_PAPER_ROUTE'}); expect(g['BG-02']).toMatchObject({status:'PASS',reason:'HISTORICAL_MIGRATION'}); expect(by({...base,receivedSource:'HIS_PET_RECEIPT',lnVerifiedByPet:true})['BG-02']).toMatchObject({status:'PASS',reason:'HIS_RECEIPT_BY_PET'}); expect(by({...base,receivedSource:'HIS_PET_RECEIPT',lnVerifiedByPet:false})['BG-02'].status).toBe('PENDING');
});
it('paper does not hide a revoked or declined consent, an open identity issue, or an existing clinical failure',()=>{
 const paper={...base,historicalPaper:true,consentRoundEvidence:'PAPER_SELECTED' as const};
 expect(by({...paper,consentRevoked:true})['BG-04'].status).toBe('FAIL');
 expect(by({...paper,consentRoundEvidence:'DECLINED'})['BG-04'].status).toBe('FAIL');
 expect(by({...paper,openIdentityIssues:1})['BG-03'].status).toBe('FAIL');
 expect(by({...paper,clinicalState:'ClinicalRejected'})['BG-06'].status).toBe('FAIL');
});
it('a historical case with a clinical review that only lacks data is not held; a real clinical conflict still is',()=>{
 const h={...base,lnVerifiedByPet:false,historicalPaper:true,consentRoundEvidence:'PAPER_SELECTED' as const};
 expect(by({...h,clinicalState:'PendingData'})['BG-06'].status).toBe('PASS');
 expect(by({...h,clinicalState:'ClinicalDataConflict'})['BG-06'].status).toBe('FAIL');
 expect(by({...base,clinicalState:'PendingData'})['BG-06'].status).toBe('FAIL'); // a case of NIPT-CBH keeps the gate
});
