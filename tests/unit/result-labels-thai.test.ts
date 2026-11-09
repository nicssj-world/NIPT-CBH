import {describe,expect,it} from 'vitest';
import {reasonText,STATE_TEXT} from '../../src/components/p5/labels';

// Owner 2026-11-09: system words ("Gate", raw MIGRATION_* codes) are not shown to staff.
describe('results board wording',()=>{
 const MIGRATION=['MIGRATION_EVIDENCE_VERIFIED','MIGRATION_OFFICIAL_PDF_REVIEW_REQUIRED','MIGRATION_PDF_UNREADABLE','MIGRATION_LINK_REQUIRED','MIGRATION_PDF_IDENTITY_UNRESOLVED',
  'MIGRATION_CURRENT_ANALYTICAL_PROVENANCE_REQUIRED','MIGRATION_AUTHENTIC_QUALIFIED_ANALYSIS_REQUIRED','MIGRATION_HISTORICAL_REVIEW_REQUIRED','MIGRATION_DISCLOSURE_REVIEW_REQUIRED',
  'MIGRATION_CURRENT_REVIEWED_VERSION_REQUIRED','MIGRATION_EXACT_MATCH_REQUIRED','MIGRATION_REVIEW_PRECONDITION_FAILED'];
 it('every MIGRATION_* reason is shown in Thai, never as the raw code',()=>{
  for(const code of MIGRATION){const t=reasonText(code);expect(t).not.toBe(code);expect(t).toMatch(/[ก-๙]/);expect(t).not.toContain('MIGRATION_');}
 });
 it('a gate item keeps its RG number and shows the Thai reason',()=>{
  expect(reasonText('RG-04:MIGRATION_PDF_IDENTITY_UNRESOLVED')).toBe('RG-04 '+reasonText('MIGRATION_PDF_IDENTITY_UNRESOLVED'));
 });
 it('the word "Gate" is not shown: a blocked result says it has not met the conditions',()=>{
  expect(STATE_TEXT.ValidationBlocked).toBe('ยังไม่ผ่านเงื่อนไขส่งผล');
  expect(reasonText('CLINICAL_RULES_NOT_APPROVED')).not.toMatch(/Gate/);
  expect(reasonText('CLINICAL_SOMETHING')).toBe('เงื่อนไขทางคลินิก: SOMETHING');
  for(const text of Object.values(STATE_TEXT))expect(text).not.toMatch(/Gate/);
 });
});
