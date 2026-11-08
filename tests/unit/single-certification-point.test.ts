import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';

// Route files may only export handlers, so the action map is checked from source: certification has one entry point, "ส่ง HIS".
const REMOVED=['acceptRelease','certify','acceptInternal'];
const keyRe=(key:string)=>new RegExp(String.raw`\b${key}\s*:`);
const actionsMap=(src:string)=>src.slice(src.indexOf('const actions:'),src.indexOf('export async function POST'));
describe('single certification point',()=>{
 it('the matcher detects a removed action key (guards against a vacuous pattern)',()=>{
  for(const key of REMOVED)expect(`const actions:X={\n ${key}: async()=>1,\n};`).toMatch(keyRe(key));
 });
 it('the version route offers no acceptRelease, certify or acceptInternal action',()=>{
  const map=actionsMap(readFileSync('src/app/api/p5/results/[id]/route.ts','utf8'));
  expect(map).toMatch(/\bvoid\s*:/);
  for(const key of REMOVED)expect(map).not.toMatch(keyRe(key));
 });
});
