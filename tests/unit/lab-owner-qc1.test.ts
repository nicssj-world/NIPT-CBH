import {it,expect} from 'vitest';
import {qc1Candidates} from '../../packages/lab/qc';
it('Owner 2026-10-22 QC1 uses only Master >=2 for patient/PC/NC, with no obsolete 3/50 bounds',()=>{
 for(const kind of ['PATIENT','PC','NC'] as const)for(const [value,outcome]of [['1.999','BELOW_MIN'],['2','WITHIN'],['2.999','WITHIN'],['50.001','WITHIN']] as const){
  expect(qc1Candidates(value,kind,'OWNER_MASTER')).toEqual([{code:'QC1-OWNER-MASTER-20261022',approved:true,outcome}]);
 }
});
it('Owner QC1 BLANK accepts zero through 0.60 inclusively, and rejects >0.60 without conflating Pooling volume',()=>{
 for(const [value,outcome]of [['0','WITHIN'],['0.6','WITHIN'],['0.601','ABOVE_MAX']] as const)expect(qc1Candidates(value,'BLANK','OWNER_MASTER')[0].outcome).toBe(outcome);
 expect(()=>qc1Candidates('-1','PATIENT','OWNER_MASTER')).toThrow('QC1_VALUE_INVALID');
});
