import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';

// Route files may only export handlers, so the action map is checked from source: certification has one entry point, "ส่ง HIS".
describe('single certification point',()=>{
 it('the version route offers no acceptRelease, certify or acceptInternal action',()=>{
  const src=readFileSync('src/app/api/p5/results/[id]/route.ts','utf8');
  const map=src.slice(src.indexOf('const actions:'),src.indexOf('export async function POST'));
  for(const key of ['acceptRelease','certify','acceptInternal'])expect(map).not.toMatch(new RegExp(`\b${key}\s*:`));
  expect(map).toMatch(/\bvoid\s*:/);
 });
});
