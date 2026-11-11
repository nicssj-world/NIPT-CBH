import {describe,expect,it} from 'vitest';
import {addDays,bangkokDay,businessDaysBetween,dueDay,isBusinessDay,median,tatStatus} from '../../packages/calendar/business-days';
import {neededYears} from '../../packages/calendar/holiday-sync';

const none=new Set<string>();
const policy={businessDays:8,warnDaysLeft:2};
describe('working days for the Lab TAT (Owner 2026-11-11: 8 working days, warn at 2 left)',()=>{
 it('uses the Bangkok calendar day of an instant',()=>{
  expect(bangkokDay('2026-11-09T16:59:59Z')).toBe('2026-11-09');
  expect(bangkokDay('2026-11-09T17:00:00Z')).toBe('2026-11-10');
  expect(bangkokDay('2026-11-10')).toBe('2026-11-10');
  expect(()=>bangkokDay('not a date')).toThrow('INVALID_DATE');
 });
 it('skips Saturdays and Sundays; the receipt day is day 0',()=>{
  // Mon 2026-11-09 .. Mon 2026-11-16
  expect(isBusinessDay('2026-11-14',none)).toBe(false);
  expect(isBusinessDay('2026-11-15',none)).toBe(false);
  expect(businessDaysBetween('2026-11-09','2026-11-09',none)).toBe(0);
  expect(businessDaysBetween('2026-11-09','2026-11-10',none)).toBe(1);
  expect(businessDaysBetween('2026-11-09','2026-11-16',none)).toBe(5);
  expect(businessDaysBetween('2026-11-16','2026-11-09',none)).toBe(0);
 });
 it('skips synced holidays, including a long Songkran break',()=>{
  const songkran=new Set(['2026-04-13','2026-04-14','2026-04-15']);
  // Fri 2026-04-10 received; Mon-Wed are holidays; Thu 16 is the first working day.
  expect(businessDaysBetween('2026-04-10','2026-04-16',songkran)).toBe(1);
  expect(dueDay('2026-04-10',8,songkran)).toBe('2026-04-27');
  expect(dueDay('2026-04-10',8,none)).toBe('2026-04-22');
 });
 it('a specimen received on a holiday or a weekend starts counting the next working day',()=>{
  expect(businessDaysBetween('2026-11-14','2026-11-16',none)).toBe(1);
  expect(dueDay('2026-11-14',8,none)).toBe('2026-11-25');
 });
 it('crosses the year end',()=>{
  const h=new Set(['2026-12-31','2027-01-01']);
  expect(businessDaysBetween('2026-12-30','2027-01-04',h)).toBe(1);
  expect(addDays('2026-12-31',1)).toBe('2027-01-01');
 });
 it('states the TAT in working days left: ok, due soon (≤ 2 left, 0 = due today), overdue once the due day has passed',()=>{
  const r='2026-11-02T03:00:00Z';// Mon
  expect(tatStatus(r,'2026-11-05T03:00:00Z',none,policy)).toMatchObject({used:3,left:5,state:'ok',due:'2026-11-12'});
  expect(tatStatus(r,'2026-11-10T03:00:00Z',none,policy)).toMatchObject({used:6,left:2,state:'due-soon'});
  expect(tatStatus(r,'2026-11-12T10:00:00Z',none,policy)).toMatchObject({used:8,left:0,state:'due-soon'});
  expect(tatStatus(r,'2026-11-13T01:00:00Z',none,policy)).toMatchObject({used:9,left:-1,state:'overdue'});
  // A weekend does not make anything later overdue.
  expect(tatStatus(r,'2026-11-15T01:00:00Z',none,policy).left).toBe(-1);
 });
 it('median for "median working days to result"',()=>{
  expect(median([])).toBeNull();expect(median([5,1,3])).toBe(3);expect(median([1,2,3,4])).toBe(2.5);
 });
 it('the Worker needs this year, and from October the next year too',()=>{
  expect(neededYears(new Date('2026-09-30T10:00:00Z'))).toEqual([2026]);
  expect(neededYears(new Date('2026-09-30T17:30:00Z'))).toEqual([2026,2027]);
  expect(neededYears(new Date('2026-12-31T20:00:00Z'))).toEqual([2027]);
 });
});
