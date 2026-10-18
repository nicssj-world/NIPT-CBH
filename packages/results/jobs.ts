import {z} from 'zod';
import type {Pool} from 'pg';
import type {FileStore} from '../storage';
import {withTransaction} from '../db/connection';
import {testResultFolder,scanResultFolder,previewFolderFiles,FolderError} from './folder';
import {parseIntake} from './intake';
import {resultSettings,limitsOf,type P5JobKind} from './service';

// Worker side of the P5 jobs. Expected folder problems (wrong path, missing folder, unsafe name) become a stored receipt with an
// error code so the person who pressed the button sees the reason; nothing is retried silently and nothing is written to the folder.
const payloadSchema=z.object({actorId:z.uuid().optional(),trigger:z.enum(['MANUAL','SCHEDULED']).optional(),paths:z.array(z.object({path:z.string(),sha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict()).max(50).optional()}).strict();
const EXPECTED=/^(SHARE_[A-Z_]+|UNSAFE_SHARE_PATH|SIMULATOR_PATH_REQUIRED|SIMULATOR_ROOT_REQUIRED|SIMULATOR_MARKER_REQUIRED|UNSAFE_PATH|SYMLINK_PROHIBITED|NOT_DIRECTORY|PATH_ESCAPE|RESULT_FILE_REQUIRED|NETWORK_PATH_PROHIBITED)$/;
export async function runResultJob(pool:Pool,id:string,kind:P5JobKind,rawPayload:unknown,root:string,store:FileStore):Promise<Record<string,unknown>>{
 const payload=payloadSchema.parse(rawPayload??{}),s=await resultSettings(pool),limits=limitsOf(s);
 // Owner 2026-10-18: scanning is on demand only. A scheduled job left in the queue from before is closed without reading the folder.
 if(payload.trigger==='SCHEDULED')return {trigger:'SCHEDULED',files:[],folders:0,truncated:false,errorCode:'SCHEDULED_SCAN_DISABLED'};
 if(kind!=='synthetic_result_scan'&&kind!=='synthetic_result_test_path'&&!payload.actorId)throw Error('ACTOR_REQUIRED');
 try{
  if(kind==='synthetic_result_test_path')return {...await testResultFolder(root,s.pdfSourcePath,{recursive:s.scanSubfolders,maxFiles:s.maxFilesPerScan}),folder:s.pdfSourcePath};
  if(kind==='synthetic_result_scan')return {...await scanResultFolder(pool,root,s.pdfSourcePath,{recursive:s.scanSubfolders,maxFiles:s.maxFilesPerScan,maxBytes:limits.maxBytes,acceptZip:s.acceptZip}),trigger:payload.trigger??'MANUAL',errorCode:null};
  if(kind==='synthetic_result_preview'){const ids=await withTransaction(db=>previewFolderFiles(db,store,root,s.pdfSourcePath,payload.paths??[],payload.actorId!,id,limits));return {intakes:ids.length,errorCode:null};}
  const n=await withTransaction(async db=>{const rows=(await db.query<{id:string}>("SELECT id FROM result_intake_file WHERE job_id=$1 AND actor_id=$2 AND parent_id IS NULL AND state='Quarantined' ORDER BY created_at",[id,payload.actorId])).rows;for(const r of rows)await parseIntake(db,store,r.id,limits);return rows.length;});
  return {intakes:n,errorCode:null};
 }catch(e){
  const code=e instanceof Error?((e as NodeJS.ErrnoException).code==='ENOENT'?'FOLDER_NOT_FOUND':e.message):'';
  if(e instanceof FolderError||EXPECTED.test(code)||code==='FOLDER_NOT_FOUND')return {passed:false,errorCode:code,folder:s.pdfSourcePath};
  throw e;
 }
}
