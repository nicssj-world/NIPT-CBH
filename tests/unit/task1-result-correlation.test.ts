import {it,expect} from 'vitest';
import {autoMatchCandidate,type Candidate} from '../../packages/results/service';

const candidate=(id:string,latest:boolean,current=true):Candidate=>({caseId:'case-1',ln:'990001234567',hn:'9900012345',origin:'LAB_DIRECT',lnHalos:'26B261023001',matchedOn:['HN','LAB_NUMBER'],cross:{hn:'MATCH',dob:'MATCH',pregnancy:'MATCH',collectionDate:'MATCH',gestationalAge:'MATCH',labNumber:'MATCH'},round:{id:'round-S2',number:2,state:'Received',current,collectionDate:'2026-10-23'},attempt:{id,number:5,state:'InProgress',printedSampleId:'26B261023001R-1',latest}});
const outcome={kind:'RESULT',nameConflicts:0,openRevision:false};
it('repeated R-1 text resolves only through the one current-round latest internal attempt',()=>{
 const historical=candidate('attempt-3',false),current=candidate('attempt-5',true);
 expect(autoMatchCandidate([historical,current],outcome)?.attempt.id).toBe('attempt-5');
 expect(autoMatchCandidate([current,candidate('ambiguous-attempt',true)],outcome)).toBeNull();
 expect(autoMatchCandidate([current,{...candidate('other-patient',true),caseId:'case-2'}],outcome)).toBeNull();
 expect(autoMatchCandidate([{...current,cross:{...current.cross,collectionDate:'MISMATCH'}}],outcome)).toBeNull();
 expect(autoMatchCandidate([{...current,cross:{...current.cross,hn:'MISMATCH'}}],outcome)).toBeNull();
});
it('pending No Call selection and unrecognized external No Call never become a clean normal result or revision bypass',()=>{
 expect(autoMatchCandidate([candidate('attempt-5',true)],{...outcome,kind:'UNKNOWN'})).toBeNull();
 expect(autoMatchCandidate([candidate('attempt-5',true)],{...outcome,openRevision:true})).toBeNull();
 expect(autoMatchCandidate([candidate('attempt-5',true)],{...outcome,nameConflicts:1})).toBeNull();
});
