import {z} from 'zod';
import type {Pool} from 'pg';
import type {FileStore} from '../storage';
import {withTransaction,type Queryable} from '../db/connection';
import {appendAudit} from '../db/audit';
import {testResultFolder,scanResultFolder,previewFolderFiles,FolderError} from './folder';
import {parseIntake} from './intake';
import {resultSettings,limitsOf,type P5JobKind} from './service';

// Worker side of the P5 jobs. Expected folder problems (wrong path, missing folder, unsafe name) become a stored receipt with an
// error code so the person who pressed the button sees the reason; nothing is retried silently and nothing is written to the folder.
const payloadSchema=z.object({actorId:z.uuid().optional(),trigger:z.enum(['MANUAL','SCHEDULED']).optional(),paths:z.array(z.object({path:z.string(),sha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict()).max(50).optional()}).strict();
const EXPECTED=/^(SIMULATOR_PATH_REQUIRED|SIMULATOR_ROOT_REQUIRED|SIMULATOR_MARKER_REQUIRED|UNSAFE_PATH|SYMLINK_PROHIBITED|NOT_DIRECTORY|PATH_ESCAPE|RESULT_FILE_REQUIRED|NETWORK_PATH_PROHIBITED)$/;
export async function runResultJob(pool:Pool,id:string,kind:P5JobKind,rawPayload:unknown,root:string,store:FileStore):Promise<Record<string,unknown>>{
 const payload=payloadSchema.parse(rawPayload??{}),s=await resultSettings(pool),limits=limitsOf(s);
 // A scheduled job has no person behind it: it may only list. Preview/parse always belong to the person who asked for them.
 if(payload.trigger==='SCHEDULED'&&kind!=='synthetic_result_scan')throw Error('SCHEDULED_SCAN_LIST_ONLY');
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

/** A23 scheduled folder scan: 0 = off. One listing job per interval bucket (idempotent across worker restarts), audited, no actor. */
export const scheduledScanKey=(minutes:number,now:number)=>`p5-scheduled-scan:${minutes}:${Math.floor(now/(minutes*60000))}`;
export async function queueScheduledScan(db:Queryable,minutes:number,now=Date.now()){
 if(!Number.isInteger(minutes)||minutes<=0)return null;
 const r=(await db.query<{id:string}>("INSERT INTO job_outbox(kind,payload,idempotency_key) VALUES('synthetic_result_scan',$1,$2) ON CONFLICT(idempotency_key) DO NOTHING RETURNING id",[JSON.stringify({trigger:'SCHEDULED'}),scheduledScanKey(minutes,now)])).rows[0];
 if(r)await appendAudit(db,{action:'RESULT_SCHEDULED_SCAN_QUEUED',resourceType:'JOB',resourceId:r.id,details:{count:minutes,outcome:'LIST_ONLY',synthetic:true}});
 return r?.id??null;
}
