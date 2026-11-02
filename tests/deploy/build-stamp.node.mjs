import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,existsSync,readdirSync,utimesSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {writeBuildStamp,verifyBuildStamp,saveBuildCache,restoreBuildCache,cacheKey} from '../../tools/release/build-stamp.mjs';

const REV='a'.repeat(40);
function fixture(){
 const root=mkdtempSync(path.join(tmpdir(),'stamp-'));
 writeFileSync(path.join(root,'package-lock.json'),'{"lock":1}');writeFileSync(path.join(root,'package.json'),'{}');writeFileSync(path.join(root,'next.config.ts'),'export default {}');writeFileSync(path.join(root,'tsconfig.json'),'{}');
 mkdirSync(path.join(root,'node_modules','next'),{recursive:true});writeFileSync(path.join(root,'node_modules','next','package.json'),'{"version":"16.4.3"}');
 mkdirSync(path.join(root,'.next','standalone'),{recursive:true});writeFileSync(path.join(root,'.next','BUILD_ID'),'build-one');writeFileSync(path.join(root,'.next','standalone','server.js'),'server');
 mkdirSync(path.join(root,'.next','cache','turbopack'),{recursive:true});writeFileSync(path.join(root,'.next','cache','turbopack','data'),'cache');
 return root;
}
test('a build is accepted only for the exact revision and inputs it was stamped with',()=>{
 const root=fixture();
 try{
  assert.equal(verifyBuildStamp(root,REV).code,'STALE_BUILD_NO_STAMP');
  writeBuildStamp(root,REV);
  assert.equal(verifyBuildStamp(root,REV).ok,true);
  assert.equal(verifyBuildStamp(root,'b'.repeat(40)).code,'STALE_BUILD_OTHER_REVISION');
  writeFileSync(path.join(root,'package-lock.json'),'{"lock":2}');
  assert.equal(verifyBuildStamp(root,REV).code,'STALE_BUILD_INPUTS_CHANGED');
  writeFileSync(path.join(root,'package-lock.json'),'{"lock":1}');
  assert.equal(verifyBuildStamp(root,REV).ok,true);
  writeFileSync(path.join(root,'.next','BUILD_ID'),'build-two');
  assert.equal(verifyBuildStamp(root,REV).code,'STALE_BUILD_ID_CHANGED');
  writeFileSync(path.join(root,'.next','BUILD_ID'),'build-one');writeFileSync(path.join(root,'.next','standalone','server.js'),'tampered');
  assert.equal(verifyBuildStamp(root,REV).code,'STALE_BUILD_ARTIFACT_CHANGED');
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('the compilation cache round-trips, never carries BUILD_ID, and is keyed by the lockfile',()=>{
 const a=fixture(),b=fixture(),shared=mkdtempSync(path.join(tmpdir(),'shared-'));
 try{
  assert.equal(restoreBuildCache(b,shared).restored,false);
  assert.equal(saveBuildCache(a,shared).saved,true);
  rmSync(path.join(b,'.next','cache'),{recursive:true,force:true});
  assert.equal(restoreBuildCache(b,shared).restored,true);
  assert.equal(existsSync(path.join(b,'.next','cache','turbopack','data')),true);
  assert.equal(existsSync(path.join(shared,cacheKey(a),'BUILD_ID')),false);
  writeFileSync(path.join(b,'package-lock.json'),'{"lock":9}');rmSync(path.join(b,'.next','cache'),{recursive:true,force:true});
  assert.equal(restoreBuildCache(b,shared).restored,false,'a different lockfile must not reuse the cache');
 }finally{for(const d of [a,b,shared])rmSync(d,{recursive:true,force:true});}
});
test('only the three newest cache keys are kept',()=>{
 const a=fixture(),shared=mkdtempSync(path.join(tmpdir(),'shared-'));
 try{
  for(let i=0;i<5;i++){const k=String(i).repeat(16);mkdirSync(path.join(shared,k));const t=new Date(Date.now()-(10-i)*1000*3600);utimesSync(path.join(shared,k),t,t);}
  saveBuildCache(a,shared);
  assert.equal(readdirSync(shared).filter(n=>/^[0-9a-f]{16}$/.test(n)).length,3);
 }finally{for(const d of [a,shared])rmSync(d,{recursive:true,force:true});}
});
