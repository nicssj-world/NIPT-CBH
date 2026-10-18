import {it,expect} from 'vitest';
import {emptyRequest,requestIssues,requestProgressIssues} from '../../packages/p2/schema';

// The registry list shows request progress for every case. A stored draft that lacks sections (fixture rows, older or migrated
// data) must show as incomplete, never break the whole list (found 2026-10-19: one partial draft made /api/p2/cases return 400).
it('a partial stored draft reports its unanswered fields instead of throwing',()=>{
 const partial={patient:{dob:'1996-03-31'},pregnancy:{type:'Singleton',edd:'2027-04-22',fetalSex:'DoNotWant'}};
 expect(()=>requestIssues(partial as never)).toThrow();
 const missing=requestProgressIssues(partial);
 expect(missing).toContain('history.transfusion4months');expect(missing).toContain('patient.syntheticName');expect(missing).toContain('ordering.doctorVersionId');
 expect(missing).not.toContain('pregnancy.type');expect(missing).not.toContain('pregnancy.edd');
});
it('a complete-shape draft gives exactly the same issues as requestIssues; junk input does not throw',()=>{
 const d=structuredClone(emptyRequest);d.patient.syntheticName='SYNTHETIC ชื่อ';d.history.transfusion4months={answer:'Yes',date:null};
 expect(requestProgressIssues(d)).toEqual(requestIssues(d));
 for(const junk of [null,undefined,'x',42,{history:null},{history:{transfusion4months:'Yes'}}])expect(()=>requestProgressIssues(junk)).not.toThrow();
});
