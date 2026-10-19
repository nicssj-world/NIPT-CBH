import {it,expect,vi} from 'vitest';
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

it('operational registry progress preserves the scalar semantic contract for current drafts and leaves legacy drafts incomplete',()=>{
 vi.stubEnv('NIPT_MODE','operational');vi.stubEnv('APP_ORIGIN','https://127.0.0.1:19991');
 try{
  const current=structuredClone(emptyRequest);Object.assign(current.patient,{syntheticName:'ผู้ทดสอบ สมมติ',dob:'2000-01-01',entitlement:'SELF_PAY'});
  Object.assign(current.pregnancy,{type:'Singleton',edd:'2027-04-22',collectionDate:'2026-10-10',collectionSource:'ANC',weightKg:60,heightCm:160,vanishingTwin:'No',fetalSex:'DoNotWant',sca:'DoNotWant'});
  for(const k of ['transfusion4months','heparin24h','immune1month','albumin4weeks','exogenousDna4weeks'] as const)current.history[k].answer='No';
  Object.assign(current.history,{cancerTreatment:'No',gaUnder8:'No',tumor:'No',priorChromosomeTest:'No',otherHistory:'No'});
  Object.assign(current.ordering,{doctorVersionId:'00000000-0000-4000-8000-000000000001',facility:'หน่วยทดสอบ',reason:'ข้อมูลทดสอบ'});
  expect(requestIssues(current)).toEqual([]);expect(requestProgressIssues(current)).toEqual([]);
  const legacy=structuredClone(current);delete legacy.documentContractVersion;
  expect(requestProgressIssues(legacy)).toEqual(['history.documentContractVersion']);expect(legacy.documentContractVersion).toBeUndefined();
 }finally{vi.unstubAllEnvs();}
});
