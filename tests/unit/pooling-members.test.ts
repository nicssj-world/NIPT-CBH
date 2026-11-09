import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {actualPoolingMembers} from '../../src/components/p4/pooling-members';

const row=(slot:number,volume:string|null,belowTwo=false)=>({slot,volume,belowTwo});
describe('Pooling has no tick: saving QC2 records the actual pooling by the CSV rule (Owner 2026-11-09)',()=>{
 it('pools only positions that are poolable, have a volume and are at least 2 µL',()=>{
  const rows=[row(1,'3.5'),row(2,'1.9',true),row(3,null),row(4,'4'),row(5,'5')];
  const poolable=(r:{slot:number})=>r.slot!==4;               // slot 4: a Blank, a Re-xxx or an empty position
  expect(actualPoolingMembers(rows,poolable)).toEqual([{slot:1,pooled:true},{slot:2,pooled:false},{slot:3,pooled:false},{slot:4,pooled:false},{slot:5,pooled:true}]);
 });
 it('the bench has no tick, no select-all and no volume override; QC2 is saved with the actual pooling',()=>{
  const src=readFileSync('src/components/p4/lab-bench.tsx','utf8');
  for(const gone of ['type="checkbox"','เลือกตัวอย่างที่ใช้ได้ทั้งหมด','แก้ปริมาตรตำแหน่ง','บันทึก Pooling จริง'])expect(src).not.toContain(gone);
  expect(src).toContain('saveQc2');expect(src).toContain("action:'recordActualPooling'");
  expect(src).toContain("typeof values['pool.concentration']!=='number'");   // QC2 result (pool concentration) is the evidence that pooling happened
 });
});
