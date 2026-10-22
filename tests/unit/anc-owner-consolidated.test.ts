import {describe,it,expect} from 'vitest';
import {calculations,emptyRequest,requestIssues} from '../../packages/p2/schema';

describe('Owner 2026-10-23 ANC request corrections',()=>{
 it('calculates completed age at collection, ignoring stale manually entered age',()=>{
  const d=structuredClone(emptyRequest);d.patient.dob='1989-05-19';d.patient.ageYears=99;
  d.pregnancy.collectionDate='2026-05-18';expect(calculations(d).ageYears).toBe(36);
  d.pregnancy.collectionDate='2026-05-19';expect(calculations(d).ageYears).toBe(37);
  d.pregnancy.collectionDate='2027-05-18';expect(calculations(d).ageYears).toBe(37);
  d.patient.dob=null;expect(calculations(d).ageYears).toBeNull();
  d.patient.dob='2027-05-19';expect(calculations(d).ageYears).toBeNull();
 });
 it('does not invent age before collection date is recorded',()=>{
  const d=structuredClone(emptyRequest);d.patient.dob='1989-05-19';d.patient.ageYears=37;
  expect(calculations(d).ageYears).toBeNull();
 });
 it('does not require a SCA preference absent from the Owner Request template',()=>{
  const d=structuredClone(emptyRequest);d.pregnancy.sca=null;
  expect(requestIssues(d).filter(x=>x.startsWith('pregnancy.sca'))).toEqual([]);
  d.pregnancy.sca='DoNotWant';expect(requestIssues(d).filter(x=>x.startsWith('pregnancy.sca'))).toEqual([]);
 });
});
