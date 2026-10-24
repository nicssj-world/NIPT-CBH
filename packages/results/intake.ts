import type {Queryable} from '../db/connection';
import type {FileStore} from '../storage';
import {screen,extract,QuarantineError} from './extract';
import {isZip} from './zip';
import {parseReport} from './parser';

// One intake path for both channels of Plan §11.1 (NIPTY workflow): the worker reads the configured folder, the web receives
// the browser picker. Bytes are content-addressed first (immutable original), then screened and parsed. Nothing here creates a
// report version, a link or a release — that only happens when a person confirms the import after Preview.
export type IntakeLimits={maxBytes:number;acceptZip:boolean};
export type IntakeSource={source:'FOLDER'|'UPLOAD'|'INTERNAL_GENERATED';relativePath:string|null;originalName:string;actorId:string;jobId:string|null;parentId?:string|null;memberName?:string|null};
export const safeName=(name:string)=>{const base=name.split(/[\\/]/).pop()!.replace(/[\r\n\0]/g,'').trim().slice(0,255);if(!base)throw new QuarantineError('FILE_NAME_INVALID');return base;};

export async function registerIntake(db:Queryable,store:FileStore,s:IntakeSource,bytes:Buffer){
 if(!bytes.length)throw new QuarantineError('EMPTY_FILE');
 const hash=await store.put(bytes);
 return (await db.query<{id:string}>('INSERT INTO result_intake_file(source,relative_path,original_name,parent_id,member_name,sha256,byte_size,actor_id,job_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id',
  [s.source,s.parentId?null:s.relativePath,safeName(s.originalName),s.parentId??null,s.memberName?safeName(s.memberName):null,hash,bytes.length,s.actorId,s.jobId])).rows[0].id;
}

/** Screen and parse one Quarantined intake. Batch ZIP members become child intakes with their own hash, screened the same way. */
export async function parseIntake(db:Queryable,store:FileStore,id:string,limits:IntakeLimits):Promise<string>{
 const row=(await db.query<{id:string;state:string;sha256:string;original_name:string;member_name:string|null;parent_id:string|null;source:'FOLDER'|'UPLOAD'|'INTERNAL_GENERATED';actor_id:string;job_id:string|null}>('SELECT id,state,sha256,original_name,member_name,parent_id,source,actor_id,job_id FROM result_intake_file WHERE id=$1 FOR UPDATE',[id])).rows[0];
 if(!row)throw new QuarantineError('INTAKE_NOT_FOUND');if(row.state!=='Quarantined')return row.state;
 const reject=async(code:string)=>{await db.query("UPDATE result_intake_file SET state='Rejected',reject_code=$2,decided_at=now() WHERE id=$1",[id,code]);return 'Rejected';};
 const dup=(await db.query<{id:string}>("SELECT id FROM result_report_version WHERE sha256=$1",[row.sha256])).rows[0];
 if(dup){await db.query("UPDATE result_intake_file SET state='Duplicate',duplicate_of=$2,decided_at=now() WHERE id=$1",[id,dup.id]);return 'Duplicate';}
 let bytes:Buffer;try{bytes=await store.get(row.sha256);}catch{return reject('ORIGINAL_UNREADABLE');}
 try{
  screen(bytes,limits.maxBytes);
  if(isZip(bytes)&&!limits.acceptZip)return reject('ZIP_NOT_ACCEPTED');
  const x=await extract(bytes);
  if(x.container==='ZIP_BATCH'){
   if(row.parent_id)return reject('NESTED_BATCH_ZIP');if(!x.members.length)return reject('ZIP_HAS_NO_REPORT');
   await db.query("UPDATE result_intake_file SET container='ZIP_BATCH',state='Parsed',decided_at=now() WHERE id=$1",[id]);
   for(const m of x.members){let child:string;try{child=await registerIntake(db,store,{source:row.source,relativePath:null,originalName:row.original_name,actorId:row.actor_id,jobId:row.job_id,parentId:id,memberName:m.name},m.bytes);}catch(e){if(e instanceof QuarantineError)continue;throw e;}await parseIntake(db,store,child,limits);}
   return 'Parsed';
  }
  const parsed=parseReport(x.text,row.member_name??row.original_name);
  await db.query("UPDATE result_intake_file SET container=$2,parser_version=$3,template_kind=$4,parsed=$5,state='Parsed',decided_at=now() WHERE id=$1",[id,x.container,parsed.parserVersion,parsed.templateKind,JSON.stringify(parsed)]);
  return 'Parsed';
 }catch(e){if(e instanceof QuarantineError)return reject(e.message);throw e;}
}
