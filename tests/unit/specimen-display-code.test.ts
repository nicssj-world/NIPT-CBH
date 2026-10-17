import {describe,it,expect} from 'vitest';
import fc from 'fast-check';
import {specimenDisplayCode,printedSampleId,effectiveLnHalos} from '../../packages/lab/rules';
import {buildTubeLabelsHtml,tubeLabelStickers,codeFontSize} from '../../packages/lab/labels';

const base='26B261017001';
describe('OD-R1 / OD-R1a specimen display code',()=>{
 it('S1 BASE, S1 Twins BASED, S2 BASER, S2 Twins BASEDR (D before R)',()=>{
  expect(specimenDisplayCode(base,'Singleton',false)).toBe('26B261017001');
  expect(specimenDisplayCode(base,'Twins',false)).toBe('26B261017001D');
  expect(specimenDisplayCode(base,'Singleton',true)).toBe('26B261017001R');
  expect(specimenDisplayCode(base,'Twins',true)).toBe('26B261017001DR');
 });
 it('accepts only an unsuffixed base: input that already carries D or R is rejected (not "idempotent")',()=>{
  for(const bad of ['26B261017001D','26B261017001R','26B261017001DR','26B261017001-1','26b261017001',''])
   expect(()=>specimenDisplayCode(bad,'Singleton',true),bad).toThrow('INVALID_LN_HALOS');
 });
 it('property: every valid base gives ^\\d{2}B\\d{9}D?R?$, no RR/DD, D before R',()=>{
  fc.assert(fc.property(fc.stringMatching(/^\d{2}B\d{9}$/),fc.constantFrom('Singleton','Twins','Unknown',null),fc.boolean(),(b,p,r)=>{
   const code=specimenDisplayCode(b,p as 'Singleton'|'Twins'|'Unknown'|null,r);
   return /^\d{2}B\d{9}D?R?$/.test(code)&&!/RR|DD|RD/.test(code)&&code.startsWith(b);
  }),{numRuns:300});
 });
 it('printed Sample ID of a PET S2 is the same R code (no second suffix layer); snapshot LN Halos stays the base',()=>{
  expect(printedSampleId({base,pregnancy:'Singleton',attemptNumber:1,repeatLevel:null,earlierReLibraryCount:0,roundNumber:2,receivedSource:'HIS_PET_RECEIPT'})).toBe('26B261017001R');
  expect(printedSampleId({base,pregnancy:'Twins',attemptNumber:1,repeatLevel:null,earlierReLibraryCount:0,roundNumber:2,receivedSource:'HIS_PET_RECEIPT'})).toBe('26B261017001DR');
  expect(printedSampleId({base,pregnancy:'Singleton',attemptNumber:1,repeatLevel:null,earlierReLibraryCount:0,roundNumber:1,receivedSource:'HIS_PET_RECEIPT'})).toBe('26B261017001-1');
  expect(effectiveLnHalos(base,'Twins')).toBe('26B261017001D'); // HALOS compares this snapshot value; unchanged
 });
});
describe('OD-R1a labels: same 4 stickers / 8 halves; OD-R1b fit only where a code overflows',()=>{
 it('CODE/CODE · CODE/CODE · CODE/CODE-1 · CODE-2/CODE-3 with CODE = BASE[D][R]',()=>{
  expect(tubeLabelStickers('26B261017001DR')).toEqual([['26B261017001DR','26B261017001DR'],['26B261017001DR','26B261017001DR'],['26B261017001DR','26B261017001DR-1'],['26B261017001DR-2','26B261017001DR-3']]);
 });
 it('S1 codes (≤ 15 characters) keep 6.5 pt; only the 16-character BASEDR-n halves are reduced, modestly',()=>{
  for(const code of ['26B261017001','26B261017001-3','26B261017001D-3','26B261017001R-3','26B261017001DR'])expect(codeFontSize(code),code).toBe(6.5);
  for(const code of ['26B261017001DR-1','26B261017001DR-2','26B261017001DR-3']){const s=codeFontSize(code);expect(s).toBeLessThan(6.5);expect(s).toBeGreaterThanOrEqual(6);}
 });
 it('S1 label HTML carries no size override (layout unchanged); corners keep the base NNN on S2',()=>{
  const s1=buildTubeLabelsHtml([{ln:'261015007701',lnHalos:base,patientName:null},{ln:'261015007702',lnHalos:base+'D',patientName:null}]);
  expect(s1).not.toMatch(/class="ln-halos" style=/);
  const s2=buildTubeLabelsHtml([{ln:'261015007701',lnHalos:base+'DR',patientName:null}]);
  expect((s2.match(/class="ln-halos" style="font-size: 6\.\dpt"/g)??[]).length).toBe(3); // only DR-1/-2/-3 halves
  expect((s2.match(/>001<\/span>/g)??[]).length).toBe(32);
 });
});
