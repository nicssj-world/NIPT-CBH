import {describe,expect,it} from 'vitest';
import {LabError} from '../../packages/lab/core';
import {p4Error} from '../../src/server/p4';

describe('Pooling calculation errors explain themselves',()=>{
 it('names the position and the Thai reason instead of the generic message',async()=>{
  const res=p4Error(new LabError('QC_MEASUREMENT_REQUIRED',422,{slot:7})),body=await res.json();
  expect(res.status).toBe(422);
  expect(body.code).toBe('QC_MEASUREMENT_REQUIRED');
  expect(body.error).toMatch(/^ตำแหน่ง 7: /);
 });
 it('keeps a position-less code readable',async()=>{
  const body=await p4Error(new LabError('QC_NINE_STANDARDS_REQUIRED',422)).json();
  expect(body.error).toContain('9 ค่า');
 });
});
