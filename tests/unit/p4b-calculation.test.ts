import {describe,it,expect} from 'vitest';
import {calculate,compareCrosscheck,selectCrosscheck,digest} from '../../packages/pooling/calculation';
import {POOL_SCENARIO} from '../helpers/pooling';
const rows=(N:number,c='10')=>Array.from({length:N},(_,i)=>({slot:i+1,kind:'PATIENT' as const,concentration:c}));
describe('FS-03..07 explicit unapproved synthetic scenarios',()=>{
 it.each([1,2,16,47])('N=%i has no blank/phantom rows and Decimal total',N=>{
  const c=calculate(rows(N),POOL_SCENARIO);expect(c.N).toBe(N);expect(c.rows).toHaveLength(N);expect(c.total).toBe('256.000000000000000000000000');expect(c.buffer).toBe('512.000000000000000000000000');expect(c.clinicalUsable).toBe(false);expect(c.holds).toContain('OD-29');
 });
 it('uses Decimal rather than binary floating-point; captures precision and rounding',()=>{const c=calculate(rows(2,'3'),POOL_SCENARIO);expect(c.rows[0].planned).toBe('426.67');expect(c.precision).toBe(40);expect(c.errors).toContain('NEGATIVE_BUFFER');});
 it.each(['0','-1','NaN','Infinity','1e2','','0.00000000'])('invalid concentration %s blocks totals',v=>expect(calculate(rows(1,v),POOL_SCENARIO).valid).toBe(false));
 it('blocks N=0, duplicate positions, zero parameters, round-to-zero and negative buffer',()=>{
  expect(calculate([],POOL_SCENARIO).valid).toBe(false);expect(calculate([rows(1)[0],rows(1)[0]],POOL_SCENARIO).errors).toContain('DUPLICATE_POSITION');
  expect(calculate(rows(1),{...POOL_SCENARIO,targetPmol:'0'}).valid).toBe(false);
  expect(calculate(rows(1,'999999'),POOL_SCENARIO).errors).toContain('ROUNDED_VOLUME_ZERO');expect(calculate(rows(1,'0.1'),POOL_SCENARIO).errors).toContain('NEGATIVE_BUFFER');
 });
 it('deterministic seeded sampling without replacement, min(3,N), exact set/precision comparison',()=>{
  const c=calculate(rows(4),POOL_SCENARIO),slots=selectCrosscheck([1,2,3,4],'SYNTHETIC-SEED');
  expect(slots).toEqual(selectCrosscheck([4,2,1,3],'SYNTHETIC-SEED'));expect(new Set(slots).size).toBe(3);
  expect(selectCrosscheck([1],'seed')).toEqual([1]);expect(selectCrosscheck([],'seed')).toEqual([]);
  const values=slots.map(slot=>({slot,value:'64'}));expect(compareCrosscheck(c,slots,values)).toBe(true);
  expect(compareCrosscheck(c,slots,values.map(v=>({...v,value:'64.01'})))).toBe(false);expect(compareCrosscheck(c,slots,[values[0],values[0],values[0]])).toBe(false);
 });
 it('canonical SHA survives JSON persistence and detects any evidence change',()=>{const p={at:new Date('2026-10-13T00:00:00Z'),nested:{b:2,a:1}};expect(digest(p)).toBe(digest(JSON.parse(JSON.stringify(p))));expect(digest(p)).not.toBe(digest({...p,nested:{a:2,b:2}}));});
});
