import {promises as fs} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import type {Queryable} from '../db/connection';
import {confined,type FileStore} from '../storage';
import {assertSimulatorRoot} from '../integrations/scanner';
import {registerIntake,parseIntake,type IntakeLimits} from './intake';
import {QuarantineError} from './extract';

// NIPTY workflow (import.html Section B, file_scanner.py): configured PDF folder → Test Path → Scan Folder (recursive, .pdf/.zip)
// → select → Preview. Runs in the worker, read-only: no mkdir, touch, rename or delete. In synthetic mode the folder must live
// under the simulator root (simulator/results[/…]); a hospital path is refused with SIMULATOR_PATH_REQUIRED.
export const RESULT_FILE=/\.(pdf|zip)$/i;
export const MAX_DEPTH=8;
export class FolderError extends Error{}
export function resultFolder(setting:string){
 const m=/^simulator\/(results(?:\/[^/\\:\0\r\n]+)*)$/.exec(setting);
 if(!m||m[1].split('/').some(x=>x==='.'||x==='..'))throw new FolderError('SIMULATOR_PATH_REQUIRED');
 return m[1];
}
type Found={path:string;folder:string;name:string;size:number;modifiedAt:string};
async function walk(root:string,relative:string,recursive:boolean,limit:number){
 const found:Found[]=[];let folders=0,truncated=false;
 const visit=async(sub:string,depth:number)=>{
  if(found.length>=limit){truncated=true;return;}
  const dir=await confined(root,sub?`${relative}/${sub}`:relative);
  const entries=(await fs.readdir(dir,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name));
  for(const e of entries){
   if(e.isSymbolicLink()||e.name.startsWith('.')||/[\\:\0\r\n]/.test(e.name))continue;
   const rel=sub?`${sub}/${e.name}`:e.name;
   if(e.isDirectory()){if(recursive&&depth<MAX_DEPTH){folders++;await visit(rel,depth+1);}continue;}
   if(!e.isFile()||!RESULT_FILE.test(e.name))continue;
   if(found.length>=limit){truncated=true;return;}
   const st=await fs.lstat(path.join(dir,e.name));if(!st.isFile())continue;
   found.push({path:rel,folder:sub,name:e.name,size:st.size,modifiedAt:st.mtime.toISOString()});
  }
 };
 await visit('',0);return {found,folders,truncated};
}

/** Test Path: marker → folder exists → listable → count result files. Counts and codes only, no file names or contents. */
export async function testResultFolder(root:string,setting:string,o:{recursive:boolean;maxFiles:number}){
 const checks:{code:string;passed:boolean}[]=[],report={passed:false,checks,files:0,folders:0,errorCode:null as string|null};
 const step=async(code:string,fn:()=>Promise<void>)=>{try{await fn();checks.push({code,passed:true});return true;}catch(e){checks.push({code,passed:false});report.errorCode=e instanceof Error&&/^[A-Z_]+$/.test(e.message)?e.message:(e as NodeJS.ErrnoException).code==='ENOENT'?'FOLDER_NOT_FOUND':'FOLDER_UNREADABLE';return false;}};
 let relative='';
 if(!await step('SYNTHETIC_PATH',async()=>{relative=resultFolder(setting);}))return report;
 if(!await step('SYNTHETIC_ROOT_MARKER',()=>assertSimulatorRoot(root)))return report;
 if(!await step('RESULT_FOLDER_EXISTS',async()=>{const st=await fs.lstat(await confined(root,relative));if(st.isSymbolicLink()||!st.isDirectory())throw new FolderError('NOT_A_FOLDER');}))return report;
 if(!await step('RESULT_FOLDER_READABLE',async()=>{const w=await walk(root,relative,o.recursive,o.maxFiles);report.files=w.found.length;report.folders=w.folders;}))return report;
 checks.push({code:'RESULT_FILES_FOUND',passed:report.files>0});
 report.passed=checks.slice(0,4).every(c=>c.passed);
 return report;
}

const hashFile=async(file:string)=>createHash('sha256').update(await fs.readFile(file)).digest('hex');
/** Scan Folder: every .pdf/.zip (sub-folders included), newest first, with SHA-256 and whether these bytes were already imported. */
export async function scanResultFolder(db:Queryable,root:string,setting:string,o:{recursive:boolean;maxFiles:number;maxBytes:number;acceptZip:boolean}){
 const relative=resultFolder(setting);await assertSimulatorRoot(root);
 const w=await walk(root,relative,o.recursive,o.maxFiles);
 w.found.sort((a,b)=>b.modifiedAt.localeCompare(a.modifiedAt)||a.path.localeCompare(b.path));
 const files:(Found&{sha256:string|null;status:'NEW'|'IMPORTED'|'DUPLICATE_IN_SCAN'|'TOO_LARGE'|'ZIP_NOT_ACCEPTED'|'EMPTY'})[]=[];const seen=new Set<string>();
 for(const f of w.found){
  if(!o.acceptZip&&/\.zip$/i.test(f.name)){files.push({...f,sha256:null,status:'ZIP_NOT_ACCEPTED'});continue;}
  if(f.size===0){files.push({...f,sha256:null,status:'EMPTY'});continue;}
  if(f.size>o.maxBytes){files.push({...f,sha256:null,status:'TOO_LARGE'});continue;}
  const sha=await hashFile(await confined(root,`${relative}/${f.path}`));
  files.push({...f,sha256:sha,status:seen.has(sha)?'DUPLICATE_IN_SCAN':'NEW'});seen.add(sha);
 }
 const hashes=files.map(f=>f.sha256).filter((x):x is string=>!!x);
 const imported=new Set(hashes.length?(await db.query<{sha256:string}>('SELECT sha256 FROM result_report_version WHERE sha256=ANY($1)',[hashes])).rows.map(r=>r.sha256):[]);
 for(const f of files)if(f.sha256&&imported.has(f.sha256))f.status='IMPORTED';
 return {folder:setting,files,folders:w.folders,truncated:w.truncated};
}

/** Preview: re-read each selected file, require the bytes scanned earlier, quarantine and parse. Returns intake ids. */
export async function previewFolderFiles(db:Queryable,store:FileStore,root:string,setting:string,selection:{path:string;sha256:string}[],actorId:string,jobId:string,limits:IntakeLimits){
 const relative=resultFolder(setting);await assertSimulatorRoot(root);const ids:string[]=[];
 for(const s of selection){
  if(!RESULT_FILE.test(s.path))throw new FolderError('RESULT_FILE_REQUIRED');
  const file=await confined(root,`${relative}/${s.path}`),st=await fs.lstat(file);
  if(st.isSymbolicLink()||!st.isFile())throw new FolderError('RESULT_FILE_REQUIRED');
  if(st.size>limits.maxBytes||st.size===0){continue;}
  const bytes=await fs.readFile(file);
  const id=await registerIntake(db,store,{source:'FOLDER',relativePath:s.path,originalName:path.basename(s.path),actorId,jobId},bytes);ids.push(id);
  if(createHash('sha256').update(bytes).digest('hex')!==s.sha256){await db.query("UPDATE result_intake_file SET state='Rejected',reject_code='CHANGED_SINCE_SCAN',decided_at=now() WHERE id=$1",[id]);continue;}
  try{await parseIntake(db,store,id,limits);}catch(e){if(!(e instanceof QuarantineError))throw e;}
 }
 return ids;
}
