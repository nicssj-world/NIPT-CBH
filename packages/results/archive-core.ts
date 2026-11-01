import {createHash,randomUUID} from 'node:crypto';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {moveNoReplaceWin32} from './win32-no-replace';
import {assertArchiveRootAllowed} from '../../tools/environment-boundary.mjs';

export type ArchiveIntent={caseId:string;versionId:string;sha256:string;bytes:Buffer};
export type ArchiveResult={state:'ARCHIVED'|'PENDING'|'FAILED';sha256:string;reason?:string};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');

/** Atomic publication with immutable destination. Hard link is preferred;
 * Windows shares without hard-link support use MoveFileExW with no REPLACE flag.
 * Both paths must be staged in the same directory. Never use fs.rename here.
 */
export async function publishNoClobber(stage:string,dest:string,expected:string,link:typeof fs.link=fs.link){
 const validateExisting=async()=>{
  const existing=await fs.lstat(dest);
  if(!existing.isFile()||existing.isSymbolicLink())throw Error('ARCHIVE_DESTINATION_UNSAFE');
  if(hash(await fs.readFile(dest))!==expected)throw Error('ARCHIVE_COLLISION');
 };
 try{await link(stage,dest);}catch(error){
  const code=(error as NodeJS.ErrnoException).code;
  if(code==='EEXIST'){await validateExisting();return;}
  const unsupported=['ENOTSUP','EOPNOTSUPP','ENOSYS','EXDEV'];
  // A Windows SMB server may report EPERM/EACCES for unsupported hard links;
  // the native no-replace rename independently verifies permissions.
  if(process.platform==='win32'&&link===fs.link&&code&&[...unsupported,'EPERM','EACCES'].includes(code)){
   const moved=await moveNoReplaceWin32(stage,dest);
   if(moved==='EXISTS')await validateExisting();
   return;
  }
  if(code&&unsupported.includes(code))throw Error('ARCHIVE_PUBLICATION_UNSUPPORTED');
  throw error;
 }
}

/** Validate an explicitly configured archive root; it is never derived from FILE_STORE_ROOT. */
export function archiveRootFromEnvironment(env:NodeJS.ProcessEnv=process.env):string|null{
 if(env.FINAL_REPORT_ARCHIVE_ENABLED!=='true')return null;
 const root=env.FINAL_REPORT_ARCHIVE_ROOT?.trim();
 if(!root)throw Error('ARCHIVE_ROOT_REQUIRED');
 if(process.platform==='win32'&&!/^\\\\[^\\]+\\[^\\]+(?:\\.*)?$/.test(root))throw Error('ARCHIVE_UNC_ROOT_REQUIRED');
 if(process.platform!=='win32'&&(root.startsWith('\\\\')||root.startsWith('//')))throw Error('ARCHIVE_PLATFORM_UNSUPPORTED');
 assertArchiveRootAllowed(root,env);
 return path.resolve(root);
}

/** Publish only bytes already resolved and identity-checked by a trusted worker adapter.
 * Windows fallback uses same-directory native no-replace rename. Actual hospital SMB,
 * ACL, service identity and durability still require post-install acceptance.
 */
export async function publishFinalReport(root:string|null,intent:ArchiveIntent):Promise<ArchiveResult>{
 if(!root)return {state:'PENDING',sha256:intent.sha256,reason:'ARCHIVE_DISABLED'};
 if(!uuid.test(intent.caseId)||!uuid.test(intent.versionId)||!/^[a-f0-9]{64}$/.test(intent.sha256)||hash(intent.bytes)!==intent.sha256)
  return {state:'FAILED',sha256:intent.sha256,reason:'SOURCE_IDENTITY_OR_HASH_INVALID'};
 const dir=path.join(root,intent.caseId),dest=path.join(dir,`${intent.versionId}.pdf`),stage=path.join(dir,`.${intent.versionId}.${randomUUID()}.stage`);
 let handle:Awaited<ReturnType<typeof fs.open>>|undefined;
 try{
  const rootStat=await fs.lstat(root);if(!rootStat.isDirectory()||rootStat.isSymbolicLink())throw Error('ARCHIVE_ROOT_UNSAFE');
  try{await fs.mkdir(dir);}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}
  const directoryStat=await fs.lstat(dir);if(!directoryStat.isDirectory()||directoryStat.isSymbolicLink())throw Error('ARCHIVE_DIRECTORY_UNSAFE');
  handle=await fs.open(stage,'wx',0o600);await handle.writeFile(intent.bytes);await handle.sync();await handle.close();handle=undefined;
  if(hash(await fs.readFile(stage))!==intent.sha256)throw Error('ARCHIVE_STAGE_HASH_MISMATCH');
  await publishNoClobber(stage,dest,intent.sha256);
  const published=await fs.lstat(dest);if(!published.isFile()||published.isSymbolicLink())throw Error('ARCHIVE_DESTINATION_UNSAFE');
  if(hash(await fs.readFile(dest))!==intent.sha256)throw Error('ARCHIVE_PUBLISHED_HASH_MISMATCH');
  try{const directory=await fs.open(dir,'r');try{await directory.sync();}finally{await directory.close();}}catch{/* Some Windows filesystems do not expose directory fsync. File data and publication were verified. */}
  return {state:'ARCHIVED',sha256:intent.sha256};
 }catch(e){const code=(e as NodeJS.ErrnoException)?.code;return {state:'FAILED',sha256:intent.sha256,reason:e instanceof Error&&/^ARCHIVE_[A-Z0-9_]+$/.test(e.message)?e.message:code&&/^[A-Z0-9_]+$/.test(code)?`ARCHIVE_${code}`:'ARCHIVE_IO_FAILED'};}
 finally{await handle?.close().catch(()=>{});await fs.unlink(stage).catch(()=>{});}
}
