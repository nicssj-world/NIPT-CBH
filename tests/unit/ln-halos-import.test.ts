import {describe, expect, it} from 'vitest';
import {simpleXlsx} from '../../packages/workbook/simple-xlsx';
import {inspectLnHalosWorkbook} from '../../packages/migration/ln-halos-import';

const source=(rows:string[][])=>({name:'mapping.xlsx',bytes:simpleXlsx('LN Mapping',[['LN','LN Halos'],...rows])});

describe('LN Halos import inspection',()=>{
 it('preserves the two identifiers and derives monthly high water',()=>{
  const r=inspectLnHalosWorkbook(source([['001234','26B261105055'],['001235','26B261104054']]));
  expect(r.rows.map(x=>[x.ln,x.lnHalos,x.issues])).toEqual([['001234','26B261105055',[]],['001235','26B261104054',[]]]);
  expect(r.months).toEqual([{month:'2026-11-01',lastValue:55}]);
 });
 it('flags inconsistent dates, years, zero sequence, and repeated monthly sequences',()=>{
  const r=inspectLnHalosWorkbook(source([['1','26B261131001'],['2','25B261105002'],['3','26B261105000'],['4','26B261104003'],['5','26B261105003']]));
  expect(r.rows.map(x=>x.issues)).toEqual([['INVALID_DATE'],['INVALID_YEAR'],['INVALID_SEQUENCE'],['DUPLICATE_MONTHLY_SEQUENCE'],['DUPLICATE_MONTHLY_SEQUENCE']]);
  expect(r.months).toEqual([{month:'2026-11-01',lastValue:3}]);
 });
 it('flags repeated or conflicting identifiers rather than selecting an arbitrary row',()=>{
  const r=inspectLnHalosWorkbook(source([['1','26B261105001'],['1','26B261105001'],['2','26B261105002'],['2','26B261105003']]));
  expect(r.rows[1].duplicateOf).toBe(2);
  expect(r.rows.slice(2).every(x=>x.issues.length>0)).toBe(true);
 });
 it('keeps the first exact pair and skips its repeated copy',()=>{
  const r=inspectLnHalosWorkbook(source([['1','26B261105001'],['1','26B261105001']]));
  expect(r.rows[0].issues).toEqual([]);
  expect(r.rows[1].duplicateOf).toBe(2);
 });
 it('rejects the sequence range reserved for EQA patients cannot use',()=>{
  const r=inspectLnHalosWorkbook(source([['1','26B261105900']]));
  expect(r.rows[0].issues).toContain('EQA_RANGE_RESERVED');
  expect(r.months).toEqual([]);
 });
});
