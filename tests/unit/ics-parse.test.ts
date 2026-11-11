import {describe,expect,it} from 'vitest';
import {isDayOff,parseHolidayIcs} from '../../packages/calendar/ics';
import {downloadHolidays,type Fetcher} from '../../packages/calendar/holiday-sync';

// Synthetic calendar in the shape Google publishes for "Holidays in Thailand" (th): public holidays and observances, folded lines.
const ICS=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Google Inc//Google Calendar 70.9054//EN',
 'BEGIN:VEVENT','DTSTART;VALUE=DATE:20260413','DTEND;VALUE=DATE:20260416','SUMMARY:วันสงกรานต์','DESCRIPTION:วันหยุดนักขัตฤกษ์','END:VEVENT',
 'BEGIN:VEVENT','DTSTART;VALUE=DATE:20260214','DTEND;VALUE=DATE:20260215','SUMMARY:วันวาเลนไทน์','DESCRIPTION:วันสำคัญ\\nหากต้องการซ่อนวันสำคัญ ให้ไปที่การตั้งค่า','END:VEVENT',
 'BEGIN:VEVENT','DTSTART;VALUE=DATE:20261207','DTEND;VALUE=DATE:20261208','SUMMARY:วันหยุดชดเชยวันคล้ายวันพระบรมราชสมภพ พระบาทสมเด็จพระบรมชนกา',' ธิเบศร','DESCRIPTION:วันหยุดนักขัตฤกษ์','END:VEVENT',
 'BEGIN:VEVENT','DTSTART;VALUE=DATE:20260101','SUMMARY:New Year\\, Day','DESCRIPTION:Public holiday','END:VEVENT',
 'BEGIN:VEVENT','DTSTART;VALUE=DATE:20260704','SUMMARY:Observance in English','DESCRIPTION:Observance','END:VEVENT',
 'BEGIN:VEVENT','DTSTART:20260105T090000Z','DTEND:20260105T100000Z','SUMMARY:A timed meeting','END:VEVENT',
 'BEGIN:VEVENT','DTSTART;VALUE=DATE:20260601','SUMMARY:Hospital day off','END:VEVENT',
 'BEGIN:VEVENT','DTSTART;VALUE=DATE:20260602','SUMMARY:Cancelled','STATUS:CANCELLED','END:VEVENT',
 'BEGIN:VEVENT','DTSTART;VALUE=DATE:20260230','SUMMARY:Impossible date','END:VEVENT',
 'END:VCALENDAR'].join('\r\n');

describe('holiday iCal reader',()=>{
 it('keeps public holidays and days off, drops observances, timed events, cancelled and impossible dates',()=>{
  expect(parseHolidayIcs(ICS)).toEqual([
   {day:'2026-01-01',name:'New Year, Day'},
   {day:'2026-04-13',name:'วันสงกรานต์'},{day:'2026-04-14',name:'วันสงกรานต์'},{day:'2026-04-15',name:'วันสงกรานต์'},
   {day:'2026-06-01',name:'Hospital day off'},
   {day:'2026-12-07',name:'วันหยุดชดเชยวันคล้ายวันพระบรมราชสมภพ พระบาทสมเด็จพระบรมชนกาธิเบศร'},
  ]);
 });
 it('classifies descriptions in Thai and English',()=>{
  expect(isDayOff('วันหยุดนักขัตฤกษ์')).toBe(true);expect(isDayOff('วันสำคัญ หากต้องการซ่อน')).toBe(false);
  expect(isDayOff('Observance')).toBe(false);expect(isDayOff(undefined)).toBe(true);
 });
 it('refuses text that is not a calendar',()=>{expect(()=>parseHolidayIcs('<html>login</html>')).toThrow('ICS_NOT_CALENDAR');});
});

const response=(body:string,init:{ok?:boolean;status?:number;url?:string;length?:string}={})=>({ok:init.ok??true,status:init.status??200,url:init.url,headers:{get:(n:string)=>n==='content-length'?init.length??null:null},text:async()=>body});
describe('holiday download (no network in tests)',()=>{
 it('returns parsed holidays',async()=>{
  const f:Fetcher=async()=>response(ICS);
  expect((await downloadHolidays('https://calendar.example/basic.ics',f)).length).toBe(6);
 });
 it('fails with stable codes only',async()=>{
  await expect(downloadHolidays('http://calendar.example/basic.ics',async()=>response(ICS))).rejects.toThrow('ICAL_URL_HTTPS_REQUIRED');
  await expect(downloadHolidays('https://calendar.example/x',async()=>response('',{ok:false,status:404}))).rejects.toThrow('ICAL_HTTP_404');
  await expect(downloadHolidays('https://calendar.example/x',async()=>response(ICS,{url:'http://plain.example/x'}))).rejects.toThrow('ICAL_URL_HTTPS_REQUIRED');
  await expect(downloadHolidays('https://calendar.example/x',async()=>response(ICS,{length:'9000000'}))).rejects.toThrow('ICAL_TOO_LARGE');
  await expect(downloadHolidays('https://calendar.example/x',async()=>response('BEGIN:VCALENDAR\r\nEND:VCALENDAR'))).rejects.toThrow('ICAL_NO_HOLIDAYS');
  await expect(downloadHolidays('https://calendar.example/x',async()=>{throw TypeError('fetch failed');})).rejects.toThrow('ICAL_UNREACHABLE');
 });
});
