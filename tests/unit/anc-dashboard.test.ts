import {describe,it,expect} from 'vitest';
import {fiscalYear,matches,project,type CaseFacts} from '../../packages/anc/model';
const facts=(patch:Partial<CaseFacts>={}):CaseFacts=>({id:'case',ln:'001',hn:null,unitIds:['u'],currentRoundId:'round',roundNumber:1,roundState:'Expected',s1ReceivedAt:null,currentReceivedAt:null,analysisStarted:false,documentsReady:false,reportState:null,activeReleaseCount:0,certifiedReleaseCount:0,redraw:false,repeat:false,hold:false,urgent:false,consentRevoked:false,identityIssue:false,...patch});
const now=new Date('2026-10-17T03:00:00Z');
describe('ANC shared aggregate and queue predicates',()=>{
 it('uses Bangkok S1 receipt for fiscal year across the UTC boundary',()=>{
  expect(fiscalYear('2026-09-30T16:59:59Z')).toBe(2569);
  expect(fiscalYear('2026-09-30T17:00:00Z')).toBe(2570);
 });
 it('maps all seven stages and never treats Completed as released',()=>{
  const cases:[Partial<CaseFacts>,string][]=[ [{},'documents'],[{documentsReady:true},'expected'],[{roundState:'Completed',currentReceivedAt:'2026-10-12Z',s1ReceivedAt:'2026-10-12Z'},'received'],[{analysisStarted:true},'analysis'],[{analysisStarted:true,reportState:'PendingCertification'},'review'],[{activeReleaseCount:1,certifiedReleaseCount:1},'released'],[{roundNumber:2,redraw:true},'followup'] ];
  for(const [patch,stage] of cases)expect(project(facts(patch),now).stage).toBe(stage);
  expect(project(facts({roundNumber:2}),now).stage).toBe('documents');
 });
 it('rejects ambiguous and voided-version Active releases and missing S1 evidence',()=>{
  for(const patch of [{activeReleaseCount:2,certifiedReleaseCount:2},{activeReleaseCount:1,certifiedReleaseCount:0},{activeReleaseCount:1,certifiedReleaseCount:1,currentReceivedAt:'2026-10-12Z'}]){
   const c=project(facts(patch),now);expect(c.stage).toBe('exception');expect(c.released).toBe(false);
  }
 });
 it('pending remains all years and current S2 does not move the S1 fiscal cohort',()=>{
  const c=project(facts({s1ReceivedAt:'2025-10-12T00:00:00Z',roundNumber:2,currentReceivedAt:'2026-10-16T00:00:00Z',analysisStarted:true,redraw:false}),now);
  expect(matches(c,{kpi:'pending',fy:2570})).toBe(true);
  expect(matches(c,{kpi:'sent',fy:2570})).toBe(false);
  expect(matches(c,{kpi:'sent',fy:2569})).toBe(true);
 });
 it('uses identical composed predicates for count and paged drilldown with flags',()=>{
  const items=Array.from({length:211},(_,i)=>project(facts({id:String(i),s1ReceivedAt:'2026-10-12T00:00:00Z',hold:i%2===0}),now));
  const filter={kpi:'pending' as const,flag:'hold' as const};const filtered=items.filter(c=>matches(c,filter));
  expect(filtered.length).toBe(106);expect(filtered.slice(100,120)).toHaveLength(6);
  expect(project(facts({hold:true,urgent:true,repeat:true,consentRevoked:true,identityIssue:true}),now).flags).toEqual(expect.arrayContaining(['hold','urgent','repeat','consent_revoked','identity_issue']));
 });
});
