import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {renderToStaticMarkup} from 'react-dom/server';
import {createElement} from 'react';
import {HisAncProgress} from '../../src/components/lab/his-anc-import';

// Owner 2026-11-18: the import showed nothing while filling and nothing when done. A strip like "กำลังส่ง HIS" replaces the confirm button.
const html=(p:Parameters<typeof HisAncProgress>[0])=>renderToStaticMarkup(createElement(HisAncProgress,p));
describe('HIS ANC import progress strip',()=>{
 it('while filling: a moving bar, how many, and do not close the page',()=>{
  const out=html({total:42,result:null});
  expect(out).toContain('class="his-progress"');expect(out).toContain('role="status"');
  expect(out).toContain('กำลังเติมข้อมูล 42 ราย…');expect(out).toContain('อย่าปิดหน้านี้จนกว่าจะเสร็จ');
  expect(out).toContain('his-indeterminate');expect(out).not.toContain('ปิด</button>');
 });
 it('done: green strip, how many were filled, the case list is updated, and a close button',()=>{
  const out=html({total:42,result:{applied:42,failed:0},onDismiss:()=>{}});
  expect(out).toContain('class="his-progress done"');
  expect(out).toContain('เติมข้อมูลเสร็จแล้ว 42 ราย');expect(out).toContain('รายการเคสในหน้านี้อัปเดตแล้ว — ปุ่มเปลี่ยนเป็น &quot;แก้ไข&quot;');
  expect(out).not.toContain('his-indeterminate');expect(out).toContain('ปิด</button>');
 });
 it('some failed: not green, both counts, and where to look',()=>{
  const out=html({total:42,result:{applied:40,failed:2},onDismiss:()=>{}});
  expect(out).toContain('class="his-progress"');
  expect(out).toContain('เติมข้อมูลแล้ว 40 ราย · บันทึกไม่สำเร็จ 2 ราย');expect(out).toContain('ดูรายละเอียดในตารางด้านล่าง');
 });
 it('the import shows the strip instead of the confirm button while filling and after, and refreshes the page once filled',()=>{
  const src=readFileSync('src/components/lab/his-anc-import.tsx','utf8');
  expect(src).toMatch(/\{!result&&busy!=='apply'&&<button/);
  expect(src).toMatch(/\(busy==='apply'\|\|result\)&&<HisAncProgress/);
  expect(src).toMatch(/setResult\(data as Result\);startTransition\(\(\)=>router\.refresh\(\)\)/);
 });
});
