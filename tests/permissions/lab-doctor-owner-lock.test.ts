import {expect,it} from 'vitest';
import {authorize,type Principal,type Role} from '../../packages/security/policy';
it('LAB-04 shares authorized doctor management with ANC while IT and auditors cannot write',()=>{
 const staff=(role:Role):Principal=>({id:'staff',roles:[role],unitIds:[],permissions:[]});
 for(const role of ['LAB_STAFF','LAB_CERTIFIER','ANC_NURSE','ANC_SUPERVISOR','APP_ADMIN'] as const)expect(authorize(staff(role),'doctor.manage',{},'write')).toBe(true);
 for(const role of ['IT_OPERATOR','AUDITOR'] as const)expect(authorize(staff(role),'doctor.manage',{},'write')).toBe(false);
});
