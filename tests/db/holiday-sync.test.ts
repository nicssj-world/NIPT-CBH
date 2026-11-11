import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import type {PGlite} from '@electric-sql/pglite';
import {testDatabase,addUser} from '../helpers/database';
import type {Queryable} from '../../packages/db/connection';
import {coveredYears,ensureHolidays,readHolidays,readSyncState,syncHolidays,tatSettings,workingCalendar,type Fetcher} from '../../packages/calendar/holiday-sync';
import {saveSystemSetting} from '../../packages/settings/direct';

let db:PGlite,adminId:string;
const run=<T,>(work:(q:Queryable)=>Promise<T>)=>work(db as unknown as Queryable);
const ics=(events:[string,string,string?][])=>['BEGIN:VCALENDAR',...events.flatMap(([d,n,desc])=>['BEGIN:VEVENT',`DTSTART;VALUE=DATE:${d}`,`SUMMARY:${n}`,`DESCRIPTION:${desc??'วันหยุดนักขัตฤกษ์'}`,'END:VEVENT']),'END:VCALENDAR'].join('\r\n');
const serve=(body:string):Fetcher=>async()=>({ok:true,status:200,headers:{get:()=>null},text:async()=>body});
const down:Fetcher=async()=>{throw TypeError('fetch failed');};

beforeAll(async()=>{db=await testDatabase();adminId=(await addUser(db,'APP_ADMIN','synthetic.holiday.admin')).id;});
afterAll(async()=>{await db?.close();});

describe('holiday calendar sync (Owner 2026-11-11: one sync gives the whole year)',()=>{
 it('starts empty: no holidays, never synced',async()=>{
  expect(await coveredYears(db as unknown as Queryable)).toEqual([]);
  expect(await readSyncState(db as unknown as Queryable)).toMatchObject({lastSuccessAt:null,holidayCount:0,years:[]});
 });
 it('stores the public holidays of every year in the calendar and audits the manual sync by count only',async()=>{
  const r=await syncHolidays(run,{trigger:'MANUAL',actorId:adminId,fetcher:serve(ics([['20260413','วันสงกรานต์'],['20260414','วันสงกรานต์'],['20260214','วันวาเลนไทน์','วันสำคัญ'],['20270101','วันขึ้นปีใหม่']]))});
  expect(r).toMatchObject({ok:true,count:3,years:[2026,2027]});
  expect([...await readHolidays(db as unknown as Queryable,2026,2027)].sort()).toEqual(['2026-04-13','2026-04-14','2027-01-01']);
  expect(await readSyncState(db as unknown as Queryable)).toMatchObject({holidayCount:3,years:[2026,2027],trigger:'MANUAL',lastErrorCode:null});
  const audit=(await db.query<{details:Record<string,unknown>}>("SELECT details FROM audit_chain WHERE action='HOLIDAY_CALENDAR_SYNC' ORDER BY sequence DESC LIMIT 1")).rows[0];
  expect(audit.details).toMatchObject({outcome:'SYNCED',count:3});
 });
 it('a new sync replaces the years it covers (a cancelled holiday disappears) and keeps the others',async()=>{
  await syncHolidays(run,{trigger:'MANUAL',actorId:adminId,fetcher:serve(ics([['20260413','วันสงกรานต์'],['20260415','วันหยุดพิเศษ']]))});
  expect([...await readHolidays(db as unknown as Queryable,2026,2027)].sort()).toEqual(['2026-04-13','2026-04-15','2027-01-01']);
 });
 it('a failed download keeps the stored holidays and records only a code',async()=>{
  const r=await syncHolidays(run,{trigger:'MANUAL',actorId:adminId,fetcher:down});
  expect(r).toEqual({ok:false,code:'ICAL_UNREACHABLE'});
  expect((await readHolidays(db as unknown as Queryable,2026,2026)).size).toBe(2);
  expect(await readSyncState(db as unknown as Queryable)).toMatchObject({lastErrorCode:'ICAL_UNREACHABLE'});
 });
 it('the Worker does nothing when the needed years are present, and waits after a recent failed attempt',async()=>{
  expect(await ensureHolidays(run,new Date('2026-06-01T03:00:00Z'),down)).toEqual({action:'NONE'});
  // In 2028 the year 2028 is needed; an attempt three hours earlier failed, so the Worker waits instead of retrying.
  await db.query("UPDATE holiday_sync_state SET last_attempt_at='2028-02-01T00:00:00Z' WHERE id=1");
  expect(await ensureHolidays(run,new Date('2028-02-01T03:00:00Z'),down)).toEqual({action:'WAIT',missing:[2028]});
 });
 it('the Worker syncs once when a needed year is missing and the last attempt is old',async()=>{
  await db.query("UPDATE holiday_sync_state SET last_attempt_at=now()-interval '2 days' WHERE id=1");
  const r=await ensureHolidays(run,new Date('2028-02-01T03:00:00Z'),serve(ics([['20280101','วันขึ้นปีใหม่']])));
  expect(r).toMatchObject({action:'SYNC',missing:[2028],result:{ok:true,years:[2028]}});
  expect(await readSyncState(db as unknown as Queryable)).toMatchObject({trigger:'WORKER'});
 });
 it('the administrator saves the TAT setting in one step (GENERAL, no approver) and it is used at once',async()=>{
  const admin=(await db.query<{id:string}>("SELECT id FROM app_user WHERE username='synthetic.holiday.admin'")).rows[0];
  const principal={id:admin.id,roles:['APP_ADMIN'],unitIds:[],permissions:[]} as never;
  await expect(saveSystemSetting(db as unknown as Queryable,principal,'tat',{businessDays:8,warnDaysLeft:2,holidayIcalUrl:'http://plain.example/x.ics'})).rejects.toThrow();
  const r=await saveSystemSetting(db as unknown as Queryable,principal,'tat',{businessDays:10,warnDaysLeft:3,holidayIcalUrl:'https://calendar.example/basic.ics'});
  expect(r).toMatchObject({saved:true,active:true});
  expect(await tatSettings(db as unknown as Queryable)).toEqual({businessDays:10,warnDaysLeft:3,holidayIcalUrl:'https://calendar.example/basic.ics'});
  await saveSystemSetting(db as unknown as Queryable,principal,'tat',{businessDays:8,warnDaysLeft:2,holidayIcalUrl:'https://calendar.example/basic.ics'});
 });
 it('the dashboards read holidays, the active policy and the years with no calendar',async()=>{
  const c=await workingCalendar(db as unknown as Queryable,new Date('2029-03-01T03:00:00Z'));
  expect(c.policy).toEqual({businessDays:8,warnDaysLeft:2});
  expect(c.missingYears).toEqual([2029]);
  expect(c.holidays.has('2028-01-01')).toBe(true);
 });
});
