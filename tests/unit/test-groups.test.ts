import {describe,it,expect} from 'vitest';
import {existsSync} from 'node:fs';
import {OWNER_ASSET_TESTS,AFTER_BUILD_TESTS} from '../test-groups';

// The default `npm test` leaves these groups to their own commands; the lists must stay exact so nothing drops out unnoticed.
describe('test groups',()=>{
 it('every listed test file exists',()=>{
  expect([...OWNER_ASSET_TESTS,...AFTER_BUILD_TESTS].filter(f=>!existsSync(f))).toEqual([]);
 });
 it('no file is in both groups or listed twice',()=>{
  const all=[...OWNER_ASSET_TESTS,...AFTER_BUILD_TESTS];
  expect(new Set(all).size).toBe(all.length);
 });
});
