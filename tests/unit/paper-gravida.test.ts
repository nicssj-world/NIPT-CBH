import {describe,expect,it} from 'vitest';
import {paperSchema} from '../../packages/p2/schema';
const blank=()=>Object.fromEntries(Object.keys(paperSchema.shape).map(k=>[k,null]));
describe('short paper request check carries ครรภ์ที่ (optional, whole number)',()=>{
 it('accepts a value, null, or no key at all',()=>{
  expect(paperSchema.parse({...blank(),gaWeeks:17,gaDays:6,gravida:3}).gravida).toBe(3);
  expect(paperSchema.parse({...blank(),gravida:null}).gravida).toBeNull();
  const {gravida:_omitted,...without}=blank() as Record<string,unknown>;void _omitted;
  expect(paperSchema.parse(without).gravida).toBeUndefined();
 });
 it('rejects fractions, negatives and implausible values; the blank panel now includes the key',()=>{
  for(const bad of [1.5,-1,51,'2'])expect(()=>paperSchema.parse({...blank(),gravida:bad})).toThrow();
  expect(Object.keys(blank())).toContain('gravida');
 });
});
