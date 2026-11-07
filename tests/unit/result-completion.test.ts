import {it,expect} from 'vitest';
import {completionPreview} from '../../packages/results/completion';
import type {Candidate} from '../../packages/results/service';

const candidate:Candidate={caseId:'case',ln:'001234',hn:'0012',origin:'ANC',lnHalos:'26B261100001',matchedOn:['HN','LAB_NUMBER'],
 cross:{hn:'MATCH',dob:'MATCH',pregnancy:'MATCH',collectionDate:'MATCH',gestationalAge:'MATCH',labNumber:'MATCH'},round:{id:'round',number:1,state:'ReceivedInHIS',current:true,collectionDate:'2026-11-01'},attempt:{id:'attempt',number:1,state:'AnalysisComplete',printedSampleId:'26B261100001-1',latest:true}};
it('offers one-confirm completion only for exactly the clean latest identity and a final PDF',()=>{
 expect(completionPreview([candidate],{kind:'RESULT',openRevision:false}).candidate?.ln).toBe('001234');
 expect(completionPreview([candidate,{...candidate,caseId:'other'}],{kind:'RESULT',openRevision:false}).ready).toBe(false);
 expect(completionPreview([candidate],{kind:'RESULT',openRevision:true}).ready).toBe(false);
 expect(completionPreview([candidate],{kind:'REDRAW_NOTICE',openRevision:false}).ready).toBe(false);
});
