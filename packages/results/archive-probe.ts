import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {publishNoClobber} from './archive-core';

/** Run in the archive worker process so the probe uses its effective OS identity. */
export async function probeArchiveRoot(root:string):Promise<{ok:true}|{ok:false;reason:string}>{
 const dir=path.join(root,`.nipt-archive-probe-${randomUUID()}`);
 const stage=path.join(dir,'stage'),published=path.join(dir,'published'),renamed=path.join(dir,'renamed');
 let created=false,handle:Awaited<ReturnType<typeof fs.open>>|undefined,reason:string|undefined;
 try{
  await fs.mkdir(dir);created=true;
  const bytes=randomBytes(128),hash=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
  handle=await fs.open(stage,'wx');await handle.writeFile(bytes);await handle.sync();await handle.close();handle=undefined;
  if(hash(await fs.readFile(stage))!==hash(bytes))throw Error('ARCHIVE_PROBE_READBACK_MISMATCH');
  // The archive core uses an atomic no-replace hard link; the share must support it.
  await publishNoClobber(stage,published,hash(bytes));
  if(hash(await fs.readFile(published))!==hash(bytes))throw Error('ARCHIVE_PROBE_PUBLICATION_MISMATCH');
  await fs.rename(published,renamed);
  if(hash(await fs.readFile(renamed))!==hash(bytes))throw Error('ARCHIVE_PROBE_RENAME_MISMATCH');
 }catch(error){
  const code=error instanceof Error&&(error as NodeJS.ErrnoException).code;
  reason=code&&/^[A-Z0-9_]+$/.test(code)?`ARCHIVE_PROBE_${code}`:error instanceof Error&&/^ARCHIVE_[A-Z_]+$/.test(error.message)?error.message:'ARCHIVE_PROBE_IO_FAILED';
 }finally{
  await handle?.close().catch(()=>{reason='ARCHIVE_PROBE_CLEANUP_FAILED';});
  if(created){for(const file of [stage,published,renamed])await fs.unlink(file).catch(error=>{if((error as NodeJS.ErrnoException).code!=='ENOENT')reason='ARCHIVE_PROBE_CLEANUP_FAILED';});await fs.rmdir(dir).catch(()=>{reason='ARCHIVE_PROBE_CLEANUP_FAILED';});}
 }
 return reason?{ok:false,reason}:{ok:true};
}
