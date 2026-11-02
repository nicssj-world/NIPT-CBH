// Build provenance and cache rules of the Next.js build (used by tools/win-installer/build-package.ts and tools/release/preflight.mjs).
//  * A build is described by a STAMP written next to it (.next/nipt-build-stamp.json): the source revision, a digest of every input that shapes the output
//    (lockfile, Node version, Next config, TypeScript config, package.json), BUILD_ID and the hash of the standalone server.
//  * `--skip-build` may only reuse .next when the stamp still matches the current checkout in every one of those fields. Otherwise it is refused (STALE_BUILD_*),
//    so a .next or BUILD_ID of another revision can never be packaged.
//  * Turbopack's persistent compilation cache (.next/cache/turbopack) may be restored from a shared directory keyed by Next + Node + platform + lockfile.
//    It never contains BUILD_ID or output files: `next build` always produces a fresh .next from the sources; the cache only saves compilation work.
import {createHash} from 'node:crypto';
import {readFileSync,existsSync,writeFileSync,mkdirSync,renameSync,rmSync,cpSync,readdirSync,statSync} from 'node:fs';
import path from 'node:path';

export const STAMP_FORMAT='NIPT_BUILD_STAMP_V1';
const sha=b=>createHash('sha256').update(b).digest('hex');
const fileSha=(root,rel)=>{const f=path.join(root,rel);return existsSync(f)?sha(readFileSync(f)):'absent';};

export function lockfileSha256(root){return fileSha(root,'package-lock.json');}

/** Digest of everything besides the sources themselves that changes what `next build` produces. */
export function inputsDigest(root,{nodeVersion=process.version}={}){
 const parts={lock:lockfileSha256(root),node:nodeVersion,platform:process.platform,
  nextConfig:['next.config.ts','next.config.mjs','next.config.js'].map(f=>fileSha(root,f)).join(','),tsconfig:fileSha(root,'tsconfig.json'),packageJson:fileSha(root,'package.json')};
 return {digest:sha(JSON.stringify(parts)),parts};
}

export function writeBuildStamp(root,revision){
 const out=path.join(root,'.next');
 const server=path.join(root,'.next','standalone','server.js');
 const stamp={format:STAMP_FORMAT,revision,inputs:inputsDigest(root),buildId:readFileSync(path.join(out,'BUILD_ID'),'utf8').trim(),
  serverSha256:existsSync(server)?sha(readFileSync(server)):null,createdAt:new Date().toISOString()};
 writeFileSync(path.join(out,'nipt-build-stamp.json'),JSON.stringify(stamp,null,1));
 return stamp;
}

/** {ok:true,stamp} when the build in <root>/.next is exactly the build of <revision> with the current inputs; otherwise {ok:false,code,detail}. */
export function verifyBuildStamp(root,revision){
 const file=path.join(root,'.next','nipt-build-stamp.json');
 if(!existsSync(file))return {ok:false,code:'STALE_BUILD_NO_STAMP',detail:'.next has no nipt-build-stamp.json: it was not produced by the stamped build; run the build again'};
 let stamp;try{stamp=JSON.parse(readFileSync(file,'utf8'));}catch{return {ok:false,code:'STALE_BUILD_STAMP_UNREADABLE',detail:'the build stamp is not valid JSON'};}
 if(stamp.format!==STAMP_FORMAT)return {ok:false,code:'STALE_BUILD_STAMP_FORMAT',detail:String(stamp.format)};
 if(stamp.revision!==revision)return {ok:false,code:'STALE_BUILD_OTHER_REVISION',detail:`.next was built from ${String(stamp.revision).slice(0,12)}, the checkout is ${revision.slice(0,12)}`};
 const now=inputsDigest(root);
 if(stamp.inputs?.digest!==now.digest){
  const changed=Object.keys(now.parts).filter(k=>stamp.inputs?.parts?.[k]!==now.parts[k]);
  return {ok:false,code:'STALE_BUILD_INPUTS_CHANGED',detail:`build inputs changed since the build: ${changed.join(', ')||'unknown'}`};
 }
 let buildId;try{buildId=readFileSync(path.join(root,'.next','BUILD_ID'),'utf8').trim();}catch{return {ok:false,code:'STALE_BUILD_NO_BUILD_ID',detail:'.next/BUILD_ID is missing'};}
 if(buildId!==stamp.buildId)return {ok:false,code:'STALE_BUILD_ID_CHANGED',detail:`BUILD_ID ${buildId} differs from the stamped ${stamp.buildId}`};
 const server=path.join(root,'.next','standalone','server.js');
 if(!existsSync(server)||sha(readFileSync(server))!==stamp.serverSha256)return {ok:false,code:'STALE_BUILD_ARTIFACT_CHANGED',detail:'.next/standalone/server.js is missing or differs from the stamped hash'};
 return {ok:true,stamp};
}

// ───────────── shared compilation cache ─────────────
export function cacheKey(root,{nextVersion}={}){
 const next=nextVersion??JSON.parse(readFileSync(path.join(root,'node_modules','next','package.json'),'utf8')).version;
 return sha(JSON.stringify({next,node:process.version,platform:process.platform,arch:process.arch,lock:lockfileSha256(root)})).slice(0,16);
}
const CACHE_PARTS=['turbopack'];
/** Restores .next/cache/turbopack from the shared cache. Returns {restored,key,reason}. Never fails the build: a missing or damaged cache is simply cold. */
export function restoreBuildCache(root,cacheRoot){
 if(!cacheRoot)return {restored:false,reason:'NIPT_BUILD_CACHE_DIR not set'};
 const key=cacheKey(root),src=path.join(cacheRoot,key);
 if(!existsSync(path.join(src,'COMPLETE')))return {restored:false,key,reason:'no complete cache for this Next/Node/lockfile'};
 const dest=path.join(root,'.next','cache');
 try{
  for(const part of CACHE_PARTS)if(existsSync(path.join(src,part))&&!existsSync(path.join(dest,part)))cpSync(path.join(src,part),path.join(dest,part),{recursive:true});
  return {restored:true,key};
 }catch(e){rmSync(dest,{recursive:true,force:true});return {restored:false,key,reason:'restore failed: '+e.message};}
}
/** Saves the cache of a SUCCESSFUL build (copy to a temporary name, then rename: a reader never sees a half-written cache). Keeps the 3 newest keys. */
export function saveBuildCache(root,cacheRoot){
 if(!cacheRoot)return {saved:false,reason:'NIPT_BUILD_CACHE_DIR not set'};
 const key=cacheKey(root),dest=path.join(cacheRoot,key),tmp=dest+'.tmp-'+process.pid,from=path.join(root,'.next','cache');
 if(!CACHE_PARTS.some(p=>existsSync(path.join(from,p))))return {saved:false,key,reason:'the build produced no cache'};
 try{
  mkdirSync(cacheRoot,{recursive:true});rmSync(tmp,{recursive:true,force:true});mkdirSync(tmp);
  for(const part of CACHE_PARTS)if(existsSync(path.join(from,part)))cpSync(path.join(from,part),path.join(tmp,part),{recursive:true});
  writeFileSync(path.join(tmp,'COMPLETE'),new Date().toISOString());
  rmSync(dest,{recursive:true,force:true});renameSync(tmp,dest);
  const keys=readdirSync(cacheRoot).filter(n=>/^[0-9a-f]{16}$/.test(n)).map(n=>({n,t:statSync(path.join(cacheRoot,n)).mtimeMs})).sort((a,b)=>b.t-a.t);
  for(const old of keys.slice(3))rmSync(path.join(cacheRoot,old.n),{recursive:true,force:true});
  return {saved:true,key};
 }catch(e){rmSync(tmp,{recursive:true,force:true});return {saved:false,key,reason:'save failed: '+e.message};}
}
