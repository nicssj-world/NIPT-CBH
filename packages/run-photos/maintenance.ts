import {createHash} from 'node:crypto';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import type {Queryable} from '../db/connection';
import {appendAudit} from '../db/audit';
import {getPhoto,photoKey,testPhotoRoot,validateRootPath,PhotoStorageError} from './store';

// Installer/IT maintenance for Run photo files. The database is backed up by the existing Backup/Restore tooling; photo files
// can live on a separate share and be large, so they get their own verified copy: every file referenced by the database is
// copied with its SHA-256 into a manifest, and a restore re-checks every byte. Nothing here deletes a photo.
export const PHOTO_BACKUP_FORMAT='NIPT_RUN_PHOTO_BACKUP_V1';
const sha=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
type FileRef={rootId:string;rootPath:string;sha256:string;bytes:number;photoIds:string[];kind:'original'|'thumb'};
async function referencedFiles(db:Queryable):Promise<FileRef[]>{
 const rows=(await db.query<{root_id:string;root_path:string;sha256:string;bytes:string;photo_ids:string[];kind:'original'|'thumb'}>(`
  SELECT f.root_id,c.root_path,f.sha256,max(f.bytes)::text bytes,array_agg(f.photo_id::text ORDER BY f.photo_id) photo_ids,min(f.kind) kind FROM (
   SELECT root_id,sha256,byte_size bytes,id photo_id,'original' kind FROM run_photo
   UNION ALL SELECT root_id,thumb_sha256,thumb_bytes,id,'thumb' FROM run_photo WHERE thumb_sha256 IS NOT NULL) f
  JOIN run_photo_root_current c ON c.root_id=f.root_id GROUP BY f.root_id,c.root_path,f.sha256 ORDER BY f.root_id,f.sha256`)).rows;
 return rows.map(r=>({rootId:r.root_id,rootPath:r.root_path,sha256:r.sha256,bytes:Number(r.bytes),photoIds:r.photo_ids,kind:r.kind}));
}
async function* walk(dir:string):AsyncGenerator<string>{
 let entries;try{entries=await fs.readdir(dir,{withFileTypes:true});}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return;throw e;}
 for(const e of entries){const p=path.join(dir,e.name);if(e.isSymbolicLink())continue;if(e.isDirectory())yield* walk(p);else if(e.isFile())yield p;}
}
/** Database ↔ file consistency: every referenced file exists with its recorded hash; files nobody references are listed. */
export async function verifyPhotoStorage(db:Queryable){
 const files=await referencedFiles(db),roots=[...new Set(files.map(f=>f.rootPath))];
 const missing:FileRef[]=[],mismatched:FileRef[]=[],unavailable:FileRef[]=[];let ok=0;
 for(const f of files){
  try{await getPhoto(f.rootPath,f.sha256);ok++;}
  catch(e){const code=e instanceof PhotoStorageError?e.code:'ERROR';(code==='FILE_MISSING'?missing:code==='HASH_MISMATCH'?mismatched:unavailable).push(f);}
 }
 const known=new Set(files.map(f=>f.rootPath+'|'+f.sha256)),orphans:{rootPath:string;sha256:string}[]=[];
 const registered=(await db.query<{root_path:string}>('SELECT root_path FROM run_photo_root_current')).rows.map(r=>r.root_path);
 for(const root of new Set([...roots,...registered]))for await(const file of walk(path.join(root,'sha256'))){const h=path.basename(file);if(/^[a-f0-9]{64}$/.test(h)&&!known.has(root+'|'+h))orphans.push({rootPath:root,sha256:h});}
 const summary=(f:FileRef)=>({rootId:f.rootId,sha256:f.sha256,kind:f.kind,photoIds:f.photoIds});
 return {checked:files.length,ok,missing:missing.map(summary),mismatched:mismatched.map(summary),unavailable:unavailable.map(summary),orphans,consistent:missing.length+mismatched.length+unavailable.length===0};
}
/** Verified copy of every referenced photo file into a new, empty folder, with a manifest of roots, hashes and photo ids. */
export async function backupPhotos(db:Queryable,destination:string){
 const dest=path.resolve(destination);
 try{if((await fs.readdir(dest)).length)throw new PhotoStorageError('BACKUP_DESTINATION_NOT_EMPTY');}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
 await fs.mkdir(dest,{recursive:true});
 const files=await referencedFiles(db),roots=(await db.query<{root_id:string;root_path:string;state:string;source:string}>('SELECT root_id,root_path,state,source FROM run_photo_root_current ORDER BY root_id')).rows;
 for(const f of files){
  const bytes=await getPhoto(f.rootPath,f.sha256),target=path.join(dest,f.rootId,...photoKey(f.sha256).split('/'));
  await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,bytes,{flag:'wx'});
  if(sha(await fs.readFile(target))!==f.sha256)throw new PhotoStorageError('BACKUP_VERIFY_FAILED');
 }
 const manifest={format:PHOTO_BACKUP_FORMAT,createdAt:new Date().toISOString(),roots:roots.map(r=>({id:r.root_id,path:r.root_path,state:r.state,source:r.source})),
  files:files.map(f=>({rootId:f.rootId,sha256:f.sha256,bytes:f.bytes,kind:f.kind,photoIds:f.photoIds}))};
 const text=JSON.stringify(manifest,null,1);
 await fs.writeFile(path.join(dest,'manifest.json'),text,{flag:'wx'});await fs.writeFile(path.join(dest,'manifest.sha256'),sha(Buffer.from(text))+'\n',{flag:'wx'});
 return {destination:dest,files:files.length,bytes:files.reduce((s,f)=>s+f.bytes,0),manifestSha256:sha(Buffer.from(text))};
}
type Manifest={format:string;roots:{id:string;path:string}[];files:{rootId:string;sha256:string;bytes:number}[]};
export async function readPhotoBackup(source:string):Promise<Manifest>{
 const text=await fs.readFile(path.join(source,'manifest.json'),'utf8');
 if((await fs.readFile(path.join(source,'manifest.sha256'),'utf8')).trim()!==sha(Buffer.from(text)))throw new PhotoStorageError('BACKUP_MANIFEST_TAMPERED');
 const m=JSON.parse(text) as Manifest;if(m.format!==PHOTO_BACKUP_FORMAT)throw new PhotoStorageError('BACKUP_FORMAT_UNKNOWN');
 for(const f of m.files)if(!/^[a-f0-9-]{36}$/.test(f.rootId)||!/^[a-f0-9]{64}$/.test(f.sha256))throw new PhotoStorageError('BACKUP_MANIFEST_INVALID');
 return m;
}
/** Restores the files of one root from a backup into a folder (content-addressed: an identical file is left as it is). */
export async function restorePhotos(source:string,rootId:string,targetPath:string){
 const m=await readPhotoBackup(source),target=validateRootPath(targetPath);let written=0,present=0;
 await fs.mkdir(target,{recursive:true});
 for(const f of m.files.filter(x=>x.rootId===rootId)){
  const bytes=await fs.readFile(path.join(source,f.rootId,...photoKey(f.sha256).split('/')));
  if(sha(bytes)!==f.sha256||bytes.length!==f.bytes)throw new PhotoStorageError('BACKUP_FILE_CORRUPT');
  const dest=path.join(target,...photoKey(f.sha256).split('/'));
  try{const existing=await fs.readFile(dest);if(sha(existing)!==f.sha256)throw new PhotoStorageError('RESTORE_TARGET_CONFLICT');present++;continue;}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
  await fs.mkdir(path.dirname(dest),{recursive:true});await fs.writeFile(dest,bytes,{flag:'wx'});
  if(sha(await fs.readFile(dest))!==f.sha256)throw new PhotoStorageError('RESTORE_VERIFY_FAILED');written++;
 }
 return {rootId,target,written,present};
}
/**
 * After a disaster-recovery restore to a different server/path, records where an existing root's files now are. Every file the
 * database references under that root must already be present at the new path with its hash; history keeps the old path.
 */
export async function relocateRoot(db:Queryable,rootId:string,newPath:string,reason:string){
 const target=validateRootPath(newPath);
 if(reason.trim().length<8)throw new PhotoStorageError('REASON_REQUIRED');
 const files=(await referencedFiles(db)).filter(f=>f.rootId===rootId);
 if(!(await db.query('SELECT 1 FROM run_photo_storage_root WHERE id=$1',[rootId])).rows.length)throw new PhotoStorageError('ROOT_NOT_FOUND');
 for(const f of files)await getPhoto(target,f.sha256);
 const receipt=await testPhotoRoot(target);if(!receipt.ok)throw new PhotoStorageError('RELOCATION_TARGET_TEST_FAILED');
 await db.query("INSERT INTO run_photo_root_location(root_id,root_path,kind,test_receipt,reason) VALUES($1,$2,'RELOCATED',$3,$4)",[rootId,target,JSON.stringify(receipt),reason.trim()]);
 await appendAudit(db,{action:'RUN_PHOTO_ROOT_RELOCATED',resourceType:'run_photo_storage_root',resourceId:rootId,details:{outcome:'RELOCATED',count:files.length}});
 return {rootId,path:target,verifiedFiles:files.length};
}
