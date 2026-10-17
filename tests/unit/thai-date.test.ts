import {describe,it,expect} from 'vitest';
import fc from 'fast-check';
import {isoDate,parseBeInput,formatBe,formatBeText,formatBeDateTime,displayBe,isRealIsoDate,bangkokIsoDay} from '../../packages/domain/thai-date';
import {formatControlCode,formatPrintedControlId,formatLnHalos} from '../../packages/lab/rules';

describe('Thai BE date standard (Plan Rev 3.4 §7)',()=>{
 it('parses typed BE dates into ISO CE and formats them back as 4-digit BE',()=>{
  expect(parseBeInput('17/10/2569')).toEqual({ok:true,iso:'2026-10-17'});
  expect(parseBeInput('1/2/2570')).toEqual({ok:true,iso:'2027-02-01'});
  expect(formatBe('2026-10-17')).toBe('17/10/2569');
  expect(formatBeText('2026-10-17')).toBe('17 ต.ค. 2569');
 });
 it('rejects non-existent dates and handles leap years by the CE year',()=>{
  expect(parseBeInput('31/02/2569')).toEqual({ok:false,code:'INVALID_DATE'});
  expect(parseBeInput('29/02/2567')).toEqual({ok:true,iso:'2024-02-29'}); // 2024 CE is a leap year
  expect(parseBeInput('29/02/2569')).toEqual({ok:false,code:'INVALID_DATE'}); // 2026 CE is not
  expect(parseBeInput('31/04/2569')).toEqual({ok:false,code:'INVALID_DATE'});
 });
 it('rejects a CE-looking year in a BE field instead of guessing (OD-N)',()=>{
  expect(parseBeInput('17/10/2026')).toEqual({ok:false,code:'USE_BE_YEAR'});
  expect(parseBeInput('17/10/69')).toEqual({ok:false,code:'FORMAT'});
  expect(parseBeInput('')).toEqual({ok:false,code:'EMPTY'});
 });
 it('crosses the year boundary correctly',()=>{
  expect(parseBeInput('31/12/2569')).toEqual({ok:true,iso:'2026-12-31'});
  expect(parseBeInput('01/01/2570')).toEqual({ok:true,iso:'2027-01-01'});
 });
 it('never converts twice: a BE-range ISO year is refused, not shifted again',()=>{
  expect(()=>formatBe('2569-10-17')).toThrow('DATE_LIKELY_BUDDHIST_ERA');
  expect(()=>formatBe('17/10/2569')).toThrow('ISO_DATE_REQUIRED');
  expect(displayBe('2569-10-17')).toBe('2569-10-17'); // display never crashes on bad stored data
  expect(displayBe(null)).toBe('—');
 });
 it('round-trips every real date between 1925 and 2399 CE (property)',()=>{
  fc.assert(fc.property(fc.date({min:new Date('1925-01-01T00:00:00Z'),max:new Date('2399-12-31T00:00:00Z'),noInvalidDate:true}),d=>{
   const iso=d.toISOString().slice(0,10);const be=formatBe(iso);const back=parseBeInput(be);
   return back.ok&&back.iso===iso&&Number(be.slice(6))===Number(iso.slice(0,4))+543;
  }),{numRuns:500});
 });
 it('server guard: hard-blocks only non-existent dates and BE years sent as CE',()=>{
  expect(isoDate.safeParse('2026-10-17').success).toBe(true);
  expect(isoDate.safeParse('1990-01-01').success).toBe(true); // old dates stay valid (historical/backdated)
  expect(isoDate.safeParse('2035-12-31').success).toBe(true); // far dates are not a hard error
  expect(isoDate.safeParse('2026-02-31').error?.issues[0].message).toBe('INVALID_DATE');
  expect(isoDate.safeParse('2569-10-17').error?.issues[0].message).toBe('DATE_LIKELY_BUDDHIST_ERA');
  expect(isRealIsoDate('2024-02-29')).toBe(true);expect(isRealIsoDate('2023-02-29')).toBe(false);
 });
 it('formats instants in Asia/Bangkok regardless of device timezone (midnight boundary)',()=>{
  expect(formatBeDateTime('2026-10-16T16:59:00Z')).toBe('16/10/2569 23:59');
  expect(formatBeDateTime('2026-10-16T17:00:00Z')).toBe('17/10/2569 00:00');
  expect(bangkokIsoDay(new Date('2026-12-31T17:00:00Z'))).toBe('2027-01-01');
 });
 it('identifiers stay Gregorian: a BE-displayed date still yields the Owner-locked CE codes',()=>{
  const parsed=parseBeInput('17/10/2569');if(!parsed.ok)throw new Error('parse');
  expect(formatControlCode('positive',parsed.iso)).toBe('26N120261017');
  expect(formatPrintedControlId('negative',parsed.iso)).toBe('26N220261017-1');
  expect(formatPrintedControlId('blank',parsed.iso)).toBe('26N320261017-1');
  expect(formatLnHalos(1,new Date('2026-10-17T03:00:00Z'))).toBe('26B261017001');
 });
});
