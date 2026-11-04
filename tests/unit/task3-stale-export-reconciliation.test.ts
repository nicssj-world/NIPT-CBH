import {describe,expect,it} from 'vitest';
import {isReportablePatientEvidence} from '../../packages/readygen/halos-import';

describe('HALOS patient evidence from the paired NIFTY/HALOS export',()=>{
 it('keeps an identified patient result reportable even when the later pooling state made its export stale',()=>{
  expect(isReportablePatientEvidence(
   {classification:'STALE_EXPORT',attemptId:'attempt-1',roundId:'round-1',caseId:'case-1'},
  )).toBe(true);
 });

 it.each([
  ['an unmatched sample',{classification:'UNMATCHED',attemptId:null,roundId:null,caseId:null}],
  ['an ambiguous sample',{classification:'AMBIGUOUS',attemptId:null,roundId:null,caseId:null}],
  ['stale evidence without an attempt',{classification:'STALE_EXPORT',attemptId:null,roundId:'round-1',caseId:'case-1'}],
 ] as const)('keeps the row blocked for %s',(_label,evidence)=>{
  expect(isReportablePatientEvidence(
   evidence,
  )).toBe(false);
 });
});
