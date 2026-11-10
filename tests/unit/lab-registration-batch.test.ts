import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {CHOOSE_UNRESOLVED,isDuplicate,summarize,toRegister,type Entry} from '../../src/components/p2/lab-registration-batch';

const pet=(ln:string)=>({fileId:'f'+ln,ln,hn:'H'+ln,name:'ใจดี^^นาง สมศรี',dob:'2540-01-01',sex:'F',specimenAt:'',receivedAt:'',orderAt:'',ward:'ANC',roundNumber:1});
const e=(id:string,state:Entry['state'],o:Partial<Entry>={}):Entry=>({id,key:'k'+id,ln:'069011100'+id,hn:'',state,...o});

describe('Lab registration list: only matched numbers are registered and the result is summarised (Owner 2026-11-09)',()=>{
 it('only matched entries are registered; not matched, waiting and already-registered entries never are',()=>{
  const items=[e('1','matched',{pet:pet('0690111001')}),e('2','failed',{reason:'x'}),e('3','matching'),e('4','choose'),e('5','registered',{pet:pet('0690111005')}),e('6','matched')];
  expect(toRegister(items).map(i=>i.id)).toEqual(['1']);   // 6 is "matched" without a PET record: never sent
 });
 it('Owner 2026-11-10: the list shows the newest scan first but entries are registered in scan order (first scan first, so it gets the first LN Halos)',()=>{
  const newestFirst=[e('3','matched',{pet:pet('0690111003')}),e('2','matched',{pet:pet('0690111002')}),e('1','matched',{pet:pet('0690111001')})];
  expect(toRegister(newestFirst).map(i=>i.id)).toEqual(['1','2','3']);
  expect(newestFirst.map(i=>i.id)).toEqual(['3','2','1']);   // the caller's list is not reordered
 });
 it('the summary counts registered and not-matched entries and lists the numbers to check with the reason',()=>{
  const items=[e('1','registered'),e('2','registered'),e('3','failed',{reason:'ไม่พบ PET'}),e('4','choose'),e('5','failed',{ln:'',hn:'66123',reason:'ซ้ำ'})];
  expect(summarize(items)).toEqual({registered:2,failed:3,failedEntries:[{label:'0690111003',reason:'ไม่พบ PET'},{label:'0690111004',reason:CHOOSE_UNRESOLVED},{label:'HN 66123',reason:'ซ้ำ'}]});
 });
 it('the same patient may appear once in a sitting; a failed earlier entry does not block a retry',()=>{
  const items=[e('1','matched',{pet:pet('0690111001')}),e('2','failed',{pet:pet('0690111002')})];
  expect(isDuplicate(items,'9',pet('0690111001'))).toBe(true);
  expect(isDuplicate(items,'9',pet('0690111002'))).toBe(false);
  expect(isDuplicate(items,'1',pet('0690111001'))).toBe(false);   // an entry is never a duplicate of itself
 });
 it('the dialog is paper-only, never opens the case page by itself, and its status words are on screen',()=>{
  const src=readFileSync('src/components/p2/lab-registration.tsx','utf8');
  expect(src).toContain("consentMode:'Paper'");
  expect(src).not.toContain("'Electronic'");
  expect(src).not.toContain('router.push');
  for(const text of ['จับคู่ PET สำเร็จ','จับคู่ PET ไม่สำเร็จ','ยืนยันลงทะเบียน','สรุปผลการลงทะเบียน','เลขที่ต้องตรวจสอบ'])expect(src).toContain(text);
 });
});
