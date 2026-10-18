import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Storage for Run photos: a local Windows directory (D:\NIPT-CBH\RunPhotos) or a UNC share (\\LAB-SERVER\NIPT-Photos) chosen by
// an administrator. Files are content-addressed below the root, so a key never contains user input. Unlike the clinical
// FileStore, network roots are allowed here; every relative key is still confined to the root and symlinks below it are
// refused. A slow or offline share fails fast through a short timeout and a per-root circuit breaker, so a storage outage
// only disables photos and never waits on, or blocks, other work.
export class PhotoStorageError extends Error{constructor(public code:string){super(code);}}
const sha256=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
export const photoKey=(hash:string)=>{if(!/^[a-f0-9]{64}$/.test(hash))throw new PhotoStorageError('INVALID_HASH');return `sha256/${hash.slice(0,2)}/${hash.slice(2,4)}/${hash}`;};

const RESERVED=/^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(\..*)?$/i;
/** Syntax check of an administrator-entered root. Returns the normalized absolute path or throws a PhotoStorageError code. */
export function validateRootPath(input:string,platform:NodeJS.Platform=process.platform,env:Partial<NodeJS.ProcessEnv>=process.env):string{
 const raw=input.trim();
 if(!raw||raw.length>400)throw new PhotoStorageError('PATH_LENGTH');
 if(/[\u0000-\u001f\u007f]/.test(raw))throw new PhotoStorageError('PATH_CONTROL_CHARACTER');
 const win=platform==='win32',p=win?path.win32:path.posix;
 if(win){
  if(/^\\\\[?.]\\/.test(raw)||/^\/\/[?.]\//.test(raw))throw new PhotoStorageError('PATH_DEVICE_NAMESPACE');
  const unc=/^\\\\[^\\/]+[\\/][^\\/]+/.test(raw),drive=/^[A-Za-z]:\\/.test(raw);
  if(!unc&&!drive)throw new PhotoStorageError('PATH_NOT_ABSOLUTE');
  if(/[<>"|?*]/.test(raw.slice(2)))throw new PhotoStorageError('PATH_INVALID_CHARACTER');
 }else if(!raw.startsWith('/'))throw new PhotoStorageError('PATH_NOT_ABSOLUTE');
 const segments=raw.split(win?/[\\/]+/:/\/+/).filter(Boolean);
 for(const s of segments.slice(win&&/^[A-Za-z]:/.test(raw)?1:0)){
  if(s==='.'||s==='..')throw new PhotoStorageError('PATH_TRAVERSAL');
  if(win&&(RESERVED.test(s)||/[ .]$/.test(s)))throw new PhotoStorageError('PATH_RESERVED_NAME');
 }
 const normalized=p.normalize(raw).replace(/[\\/]+$/,'')||raw;
 if(win&&/^[A-Za-z]:$/.test(normalized))throw new PhotoStorageError('PATH_DRIVE_ROOT');
 if(!win&&normalized==='/')throw new PhotoStorageError('PATH_DRIVE_ROOT');
 // Never inside folders the web server publishes or builds.
 const fold=(x:string)=>win?x.toLowerCase():x,inside=(root:string)=>{const r=p.relative(fold(root),fold(normalized));return r===''||(!r.startsWith('..')&&!p.isAbsolute(r));};
 const app=process.cwd();if(p.isAbsolute(app)&&[p.join(app,'public'),p.join(app,'.next'),p.join(app,'src')].some(inside))throw new PhotoStorageError('PATH_PUBLISHED_BY_WEB');
 // Optional installation policy: a semicolon-separated list of roots the administrator may choose from.
 const allowed=(env.NIPT_RUN_PHOTO_ALLOWED_ROOTS??'').split(';').map(x=>x.trim()).filter(Boolean);
 if(allowed.length&&!allowed.some(inside))throw new PhotoStorageError('PATH_OUTSIDE_ALLOWED_ROOTS');
 return normalized;
}

/** Installation default used until an administrator chooses a path: inside the existing file store volume. */
export const defaultRoot=(env:Partial<NodeJS.ProcessEnv>=process.env)=>path.resolve(/* turbopackIgnore: true */ env.RUN_PHOTO_DEFAULT_ROOT||path.join(env.FILE_STORE_ROOT||'data/files','run-photos'));

const TIMEOUT_MS=()=>Math.min(60000,Math.max(1000,Number(process.env.RUN_PHOTO_STORAGE_TIMEOUT_MS)||12000));
const OPEN_MS=30000;
const breaker=new Map<string,number>();
const UNAVAILABLE=new Set(['ENOENT','EACCES','EPERM','EBUSY','ETIMEDOUT','EHOSTUNREACH','ENETUNREACH','ECONNREFUSED','ECONNRESET','EIO','ENOTCONN','UNKNOWN','EAGAIN','ENOSPC','EROFS','ENODEV']);
async function guarded<T>(root:string,op:()=>Promise<T>,options:{breaker?:boolean}={}):Promise<T>{
 const key=root.toLowerCase();
 if(options.breaker!==false&&(breaker.get(key)??0)>Date.now())throw new PhotoStorageError('STORAGE_UNAVAILABLE');
 let timer:NodeJS.Timeout|undefined;
 try{
  const result=await Promise.race([op(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new PhotoStorageError('STORAGE_TIMEOUT')),TIMEOUT_MS());})]);
  breaker.delete(key);return result;
 }catch(e){
  const code=(e as NodeJS.ErrnoException).code;
  if(e instanceof PhotoStorageError){if(['STORAGE_TIMEOUT','STORAGE_UNAVAILABLE'].includes(e.code))breaker.set(key,Date.now()+OPEN_MS);throw e;}
  if(code&&UNAVAILABLE.has(code)){if(code!=='ENOENT')breaker.set(key,Date.now()+OPEN_MS);throw new PhotoStorageError(code==='ENOENT'?'FILE_MISSING':code==='ENOSPC'?'STORAGE_FULL':code==='EACCES'||code==='EPERM'||code==='EROFS'?'STORAGE_ACCESS_DENIED':'STORAGE_UNAVAILABLE');}
  throw e;
 }finally{clearTimeout(timer);}
}
/** Test-only: forget circuit breaker state between cases. */
export const resetPhotoStorageBreaker=()=>breaker.clear();

async function rootDirectory(root:string){
 if(!(await fs.stat(root)).isDirectory())throw new PhotoStorageError('ROOT_NOT_DIRECTORY');
 return fs.realpath(root);
}
/** Resolve a fixed relative key below the root, refusing symlinks/junctions below the root and any escape. */
async function confinedKey(root:string,relative:string,create:boolean){
 if(!/^(sha256\/[a-f0-9]{2}\/[a-f0-9]{2}\/[a-f0-9]{64}|stage\/[a-f0-9-]{36}|\.nipt-photo-probe\/[a-f0-9-]{36})$/.test(relative))throw new PhotoStorageError('UNSAFE_KEY');
 const base=await rootDirectory(root),parts=relative.split('/');let current=base;
 for(let i=0;i<parts.length;i++){
  current=path.join(current,parts[i]);
  try{const st=await fs.lstat(current);if(st.isSymbolicLink())throw new PhotoStorageError('SYMLINK_PROHIBITED');if(i<parts.length-1&&!st.isDirectory())throw new PhotoStorageError('NOT_DIRECTORY');}
  catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;if(create&&i<parts.length-1){await fs.mkdir(current).catch((m:NodeJS.ErrnoException)=>{if(m.code!=='EEXIST')throw m;});const st=await fs.lstat(current);if(st.isSymbolicLink()||!st.isDirectory())throw new PhotoStorageError('SYMLINK_PROHIBITED');}}
 }
 const rel=path.relative(base,current);if(!rel||rel.startsWith('..')||path.isAbsolute(rel))throw new PhotoStorageError('PATH_ESCAPE');
 return current;
}

/** Writes bytes once under their SHA-256 key: staged, fsynced, then renamed into place and read back to verify. */
export async function putPhoto(root:string,bytes:Buffer){
 const hash=sha256(bytes),key=photoKey(hash);
 return guarded(root,async()=>{
  // The root itself is never created here: a folder that vanished (unplugged drive, unmapped share) is reported, not recreated.
  const dest=await confinedKey(root,key,true);
  try{const existing=await fs.readFile(dest);if(sha256(existing)===hash)return {hash,key,existed:true};throw new PhotoStorageError('IMMUTABLE_COLLISION');}
  catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
  const tmp=await confinedKey(root,`stage/${randomUUID()}`,true);
  let file;try{
   file=await fs.open(tmp,'wx',0o600);await file.writeFile(bytes);await file.sync();await file.close();file=undefined;
   // Hard links are not available on every SMB share; a rename within one root is, and a concurrent identical upload only
   // replaces the file with the same bytes.
   await fs.rename(tmp,dest);
  }finally{await file?.close().catch(()=>undefined);await fs.unlink(tmp).catch(()=>undefined);}
  if(sha256(await fs.readFile(dest))!==hash)throw new PhotoStorageError('WRITE_VERIFY_FAILED');
  return {hash,key,existed:false};
 });
}
/** Reads and verifies a stored file; a changed or truncated file is reported, never served. */
export async function getPhoto(root:string,hash:string){
 return guarded(root,async()=>{const bytes=await fs.readFile(await confinedKey(root,photoKey(hash),false));if(sha256(bytes)!==hash)throw new PhotoStorageError('HASH_MISMATCH');return bytes;});
}
export async function photoExists(root:string,hash:string){
 try{await getPhoto(root,hash);return 'OK' as const;}catch(e){return e instanceof PhotoStorageError?e.code:'ERROR';}
}

export const storageAccount=()=>{try{return process.platform==='win32'?execFileSync(path.join(process.env.SystemRoot??'C:/Windows','System32/whoami.exe'),[],{encoding:'utf8',windowsHide:true,timeout:5000}).trim():os.userInfo().username;}catch{return 'UNKNOWN';}};
export type StorageTest={ok:boolean;account:string;host:string;testedAt:string;elapsedMs:number;freeBytes:number|null;checks:{name:'EXISTS'|'DIRECTORY'|'WRITE'|'READ_BACK'|'DELETE';ok:boolean;code?:string}[]};
/**
 * Live access test run by this process, i.e. the same account that writes photos: the directory exists, a 64 KiB probe can be
 * written, flushed, read back byte-for-byte and deleted. Nothing is created other than the probe folder.
 */
export async function testPhotoRoot(root:string,options:{create?:boolean}={}):Promise<StorageTest>{
 const started=Date.now(),checks:StorageTest['checks']=[];let freeBytes:number|null=null;
 const step=async(name:StorageTest['checks'][number]['name'],fn:()=>Promise<void>)=>{if(checks.some(c=>!c.ok)){checks.push({name,ok:false,code:'SKIPPED'});return;}
  try{await guarded(root,fn,{breaker:false});checks.push({name,ok:true});}catch(e){const code=e instanceof PhotoStorageError?e.code:(e as NodeJS.ErrnoException).code??'ERROR';checks.push({name,ok:false,code:/^[A-Z0-9_]{1,40}$/.test(code)?code:'ERROR'});}};
 await step('EXISTS',async()=>{if(options.create)await fs.mkdir(root,{recursive:true});await fs.stat(root);});
 await step('DIRECTORY',async()=>{if(!(await fs.stat(root)).isDirectory())throw new PhotoStorageError('ROOT_NOT_DIRECTORY');});
 const id=randomUUID(),probe=randomBytes(65536);let file='';
 await step('WRITE',async()=>{file=await confinedKey(root,`.nipt-photo-probe/${id}`,true);const h=await fs.open(/* turbopackIgnore: true */ file,'wx',0o600);try{await h.writeFile(probe);await h.sync();}finally{await h.close();}});
 await step('READ_BACK',async()=>{if(!probe.equals(await fs.readFile(/* turbopackIgnore: true */ file)))throw new PhotoStorageError('READ_BACK_MISMATCH');});
 await step('DELETE',async()=>{await fs.unlink(file);await fs.rmdir(path.dirname(file)).catch(()=>undefined);});
 if(file&&checks.some(c=>!c.ok))await fs.unlink(file).catch(()=>undefined);
 if(checks.every(c=>c.ok)){try{const s=await fs.statfs(root);freeBytes=Number(s.bavail)*Number(s.bsize);}catch{freeBytes=null;}breaker.delete(root.toLowerCase());}
 return {ok:checks.every(c=>c.ok),account:storageAccount(),host:os.hostname(),testedAt:new Date().toISOString(),elapsedMs:Date.now()-started,freeBytes,checks};
}
