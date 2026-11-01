import {describe,it,expect} from 'vitest';
import {existsSync,readFileSync} from 'node:fs';

// The default `npm test` leaves these groups to their own commands; the lists must stay exact so nothing drops out unnoticed.
const groups=JSON.parse(readFileSync('tests/test-groups.json','utf8')) as {ownerAssets:{files:string[]};windowsNative:{files:string[]};afterBuild:{files:string[]}};
const all=[...groups.ownerAssets.files,...groups.windowsNative.files,...groups.afterBuild.files];
describe('test groups',()=>{
 it('every listed test file exists',()=>{
  expect(all.filter(f=>!existsSync(f))).toEqual([]);
 });
 it('no file is in both groups or listed twice',()=>{
  expect(new Set(all).size).toBe(all.length);
 });
 it('each group has its own npm script',()=>{
  const scripts=JSON.parse(readFileSync('package.json','utf8')).scripts as Record<string,string>;
  expect(scripts['test:owner-assets']).toContain('vitest.owner-assets.config.ts');
  expect(scripts['test:after-build']).toContain('vitest.after-build.config.ts');
  expect(scripts['test:windows-native']).toContain('vitest.windows-native.config.ts');
 });
});
