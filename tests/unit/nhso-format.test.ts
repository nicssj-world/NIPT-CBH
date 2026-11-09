import {describe,expect,it} from 'vitest';
import {gaParts,nationalIdCopy,nationalIdDisplay} from '../../packages/results/nhso-format';
import {nhsoItems} from '../../src/components/nhso/nhso-dialog';

describe('ลงผลสปสช. display and copy rules',()=>{
 it('shows a 13-digit national ID with dashes and copies it without them',()=>{
  expect(nationalIdDisplay('1101700203451')).toBe('1-1017-00203-45-1');
  expect(nationalIdCopy('1101700203451')).toBe('1101700203451');
  expect(nationalIdCopy('1-1017-00203-45-1')).toBe('1101700203451');
 });
 it('shows anything that is not 13 digits as recorded and treats blank as missing',()=>{
  expect(nationalIdDisplay('SYNTHETIC-ID-1')).toBe('SYNTHETIC-ID-1');
  expect(nationalIdDisplay('  ')).toBeNull();expect(nationalIdCopy(null)).toBeNull();
 });
 it('splits gestational days into weeks and days',()=>{
  expect(gaParts(125)).toEqual({weeks:17,days:6});expect(gaParts(0)).toEqual({weeks:0,days:0});
  expect(gaParts(-1)).toBeNull();expect(gaParts(null)).toBeNull();
 });
 it('lists the seven values in form order, GA weeks and days separate, dates in Buddhist Era, ID digits only',()=>{
  const items=nhsoItems({nationalId:'1101700203451',ageYears:36,gravida:2,gaWeeks:17,gaDays:6,serviceDate:'2026-10-20',testDate:'2026-10-22'});
  expect(items.map(i=>i.key)).toEqual(['id','age','gravida','gaw','gad','service','test']);
  expect(items.map(i=>i.copy)).toEqual(['1101700203451','36','2','17','6','20/10/2569','22/10/2569']);
  expect(items[0].shown).toBe('1-1017-00203-45-1');
 });
 it('leaves a value uncopyable, with a reason, when it is missing',()=>{
  const items=nhsoItems({nationalId:null,ageYears:null,gravida:0,gaWeeks:null,gaDays:null,serviceDate:null,testDate:null});
  expect(items.filter(i=>i.copy===null).map(i=>i.key)).toEqual(['id','age','gaw','gad','service','test']);
  expect(items.find(i=>i.key==='gravida')!.copy).toBe('0');
 });
});
