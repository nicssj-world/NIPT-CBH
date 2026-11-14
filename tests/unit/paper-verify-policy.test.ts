import {expect,it} from 'vitest';
import {authorize,type Principal} from '../../packages/security/policy';

const as=(role:string):Principal=>({id:'00000000-0000-4000-8000-000000000001',roles:[role] as Principal['roles'],unitIds:['u1'],permissions:[]});
it('paper request / consent check: Lab staff and certifiers on every case; ANC, clinical approver and auditor cannot write (Owner 2026-11-14)',()=>{
 for(const origin of ['ANC','LAB_DIRECT'] as const){
  expect(authorize(as('LAB_STAFF'),'paper.verify',{unitId:'u1',origin},'write')).toBe(true);
  expect(authorize(as('LAB_CERTIFIER'),'paper.verify',{unitId:'u1',origin},'write')).toBe(true);
  for(const role of ['ANC_NURSE','ANC_SUPERVISOR','CLINICAL_APPROVER','AUDITOR'])expect([role,origin,authorize(as(role),'paper.verify',{unitId:'u1',origin},'write')]).toEqual([role,origin,false]);
 }
});
