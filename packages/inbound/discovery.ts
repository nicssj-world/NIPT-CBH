import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {promises as fs} from 'node:fs';
import type {Queryable} from '../db/connection';
import {confined,sha256,type FileStore} from '../storage';
import {parsePet,PARSER_VERSION} from '../integrations/pet';
import {sectionOf,classifyPet,redactPet,NIPT_SECTION,MAX_PET_BYTES} from './wire';
import {errorCode} from './tx';
import {type InboundSource,inboundReadError,inboundAccessError} from './source';
import {supersedeParseErrors} from './file-review';
import {appendAudit} from '../db/audit';
const sourceFile=(o:DiscoveryOptions,rel:string)=>o.source?o.source.file(rel):confined(o.root,rel);

export interface DiscoveryCounts{dayFolders:number;petSeen:number;notNipt:number;waitingOk:number;waitingNew:number;okArrived:number;unchanged:number;sameContent:number;stored:number;newPathVersion:number;parseError:number;readError:number;}
export const emptyCounts=():DiscoveryCounts=>({dayFolders:0,petSeen:0,notNipt:0,waitingOk:0,waitingNew:0,okArrived:0,unchanged:0,sameContent:0,stored:0,newPathVersion:0,parseError:0,readError:0});

/** Day folders (YYYYMMDD, Asia/Bangkok), oldest first, including today (AT-HISIN-10). */
export function lookbackFolders(lookbackDays:number,now:Date){
 if(!Number.isInteger(lookbackDays)||lookbackDays<1||lookbackDays>90)throw Error('INVALID_LOOKBACK');
 return Array.from({length:lookbackDays},(_,i)=>new Date(now.getTime()-(lookbackDays-1-i)*86_400_000).toLocaleDateString('en-CA',{timeZone:'Asia/Bangkok'}).replace(/-/g,''));
}
const missing=(e:unknown)=>inboundReadError(e);
async function hashFile(path:string){
 const hash=createHash('sha256');
 for await(const chunk of createReadStream(path))hash.update(chunk as Buffer);
 return hash.digest('hex');
}
export interface DiscoveryOptions{root:string;lookbackDays:number;now?:Date;lookupKey:Buffer;source?:InboundSource;}

/**
 * Read-only discovery (LOCKED §7.2, D-03). Uses only lstat/readdir/readFile under the confined root — never
 * mkdir, write, rename, touch or delete. `.pet` is read only when its `.ok` sentinel exists. Non-NIPT content is
 * counted and never stored. One unreadable or malformed file never stops the scan.
 */
export async function discoverInbound(db:Queryable,store:FileStore,options:DiscoveryOptions){
 const counts=emptyCounts(),stored:string[]=[],readErrors:string[]=[],now=options.now??new Date();
 for(const day of lookbackFolders(options.lookbackDays,now)){
  let entries:string[];
  try{entries=await fs.readdir(await sourceFile(options,'inbound/'+day));}catch(e){if(missing(e))continue;throw Error(inboundAccessError(e));}
  counts.dayFolders++;
  for(const name of entries.sort()){
   const parts=sectionOf(name);if(!parts)continue;
   counts.petSeen++;
   if(parts.section!==NIPT_SECTION){counts.notNipt++;continue;}
   try{const id=await discoverOne(db,store,options,counts,`inbound/${day}/${name}`,name,parts.ln,now);if(id)stored.push(id);}
   catch(e){counts.readError++;readErrors.push(inboundAccessError(e));}
  }
 }
 return {counts,stored,readErrors};
}

async function discoverOne(db:Queryable,store:FileStore,options:DiscoveryOptions,counts:DiscoveryCounts,rel:string,name:string,filenameLn:string,now:Date):Promise<string|null>{
 const sourceId=options.source?.id??'SIMULATOR';
 try{const ok=await fs.lstat(await sourceFile(options,rel.replace(/\.pet$/i,'.ok')));if(!ok.isFile())throw Error('SHARE_NOT_FILE');}
 catch(e){if(!missing(e))throw e;counts.waitingOk++;
  const inserted=await db.query('INSERT INTO his_inbound_waiting(source_id,source_path,first_seen_at,last_seen_at) VALUES($3,$1,$2,$2) ON CONFLICT(source_id,source_path) DO NOTHING RETURNING source_path',[rel,now,sourceId]);
  if(inserted.rows.length)counts.waitingNew++;else await db.query('UPDATE his_inbound_waiting SET last_seen_at=$2 WHERE source_id=$3 AND source_path=$1',[rel,now,sourceId]);
  return null;}
 if((await db.query('UPDATE his_inbound_waiting SET ok_seen_at=$2 WHERE source_path=$1 AND source_id=$3 AND ok_seen_at IS NULL RETURNING source_path',[rel,now,sourceId])).rows.length)counts.okArrived++;
 const path=await sourceFile(options,rel),st=await fs.lstat(path);
 if(!st.isFile())throw Error('NOT_REGULAR_FILE');
 const mtime=st.mtime;
 const source=async(hash:string,fileId:string|null,size:number)=>{await db.query(`INSERT INTO his_inbound_source(source_id,source_path,sha256,inbound_file_id,byte_size,source_mtime)
  SELECT $1,$2,$4,CASE WHEN $3::uuid IS NOT NULL AND EXISTS(SELECT 1 FROM his_inbound_file WHERE id=$3 AND sha256=$4) THEN $3::uuid ELSE NULL END,$5,$6
  ON CONFLICT DO NOTHING`,[sourceId,rel,fileId,hash,size,mtime]);};
 const pathVersion=async()=>Number((await db.query<{n:number}>(`SELECT (SELECT count(*) FROM his_inbound_file WHERE source_path=$1)+
  (SELECT count(*) FROM his_inbound_file_purge WHERE source_path=$1) AS n`,[rel])).rows[0].n)+1;
 const parseError=async(hash:string,size:number,code:string)=>{
  // PHI-minimal: hash and error code only; the source file stays on the share for re-reading.
  const r=await db.query<{id:string}>("INSERT INTO his_inbound_file(sha256,state,filename,ln,source_path,path_version,byte_size,parser_version,error_code) VALUES($1,'ParseError',$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(sha256) DO NOTHING RETURNING id",[hash,name,filenameLn,rel,await pathVersion(),size,PARSER_VERSION,code]);
  const skipped=await db.query('SELECT 1 FROM his_inbound_file_purge WHERE sha256=$1',[hash]);
  const existing=r.rows[0]?null:(await db.query<{id:string}>('SELECT id FROM his_inbound_file WHERE sha256=$1',[hash])).rows[0];
  await source(hash,r.rows[0]?.id??existing?.id??null,size);
  if(skipped.rows.length||existing)counts.sameContent++;else counts.parseError++;
  return null;
 };
 if(st.size>MAX_PET_BYTES){
  const hash=await hashFile(path),after=await fs.lstat(path);
  if(after.size!==st.size||after.mtimeMs!==st.mtimeMs)throw Error('SOURCE_FILE_CHANGED_DURING_READ');
  return parseError(hash,st.size,'FILE_TOO_LARGE');
 }
 const bytes=await fs.readFile(path),hash=sha256(bytes);
 const purged=(await db.query('SELECT 1 FROM his_inbound_file_purge WHERE sha256=$1',[hash])).rows.length>0;
 // A deleted ParseError keeps a tombstone so the same broken bytes are not reported again. It must not hide a valid PET for ever (Owner 2026-11-09):
 // when the reader now accepts those exact bytes, they are ingested like any new file and the tombstone is superseded below.
 if(purged){
  let readableNow=false;
  if(classifyPet(bytes)==='NIPT'){try{redactPet(parsePet(bytes,name),options.lookupKey);readableNow=true;}catch{/* still unreadable: stays skipped */}}
  if(!readableNow){await source(hash,null,bytes.length);counts.sameContent++;return null;}
  if((await db.query('INSERT INTO his_inbound_file_purge_release(sha256) VALUES($1) ON CONFLICT DO NOTHING RETURNING sha256',[hash])).rows.length)
   await appendAudit(db,{action:'INBOUND_PURGED_FILE_REACCEPTED',resourceType:'his_inbound_file',details:{outcome:'REACCEPTED',reasonCode:'READABLE_NOW',previousState:'Deleted',resultingState:'Ready',synthetic:process.env.NIPT_MODE!=='operational'}});
 }
 const existing=(await db.query<{id:string;state:string;ln:string|null;source_path:string|null;path_version:number|null}>('SELECT id,state,ln,source_path,path_version FROM his_inbound_file WHERE sha256=$1',[hash])).rows[0];
 if(existing){
  // A rewritten PET can preserve both size and mtime. Only its bytes prove unchanged content.
  const prior=(await db.query('SELECT 1 FROM his_inbound_source WHERE source_path=$1 AND sha256=$2 AND source_id=$3 AND source_mtime=$4',[rel,hash,sourceId,mtime])).rows.length>0;
  await source(hash,existing.id,bytes.length);
  if(existing.state!=='ParseError'&&existing.ln)await supersedeParseErrors(db,rel,existing.ln,await pathVersion());
  if(prior)counts.unchanged++;else counts.sameContent++;return null;
 }
 const kind=classifyPet(bytes);
 if(kind==='NOT_NIPT'){counts.notNipt++;return null;}
 if(kind==='INVALID_ENCODING')return parseError(hash,bytes.length,'INVALID_ENCODING');
 if(kind==='MALFORMED')return parseError(hash,bytes.length,'INVALID_FIELDS');
 let parsed:ReturnType<typeof redactPet>;
 try{parsed=redactPet(parsePet(bytes,name),options.lookupKey);}catch(e){return parseError(hash,bytes.length,errorCode(e));}
 const version=await pathVersion();
 await store.put(bytes);
 const r=await db.query<{id:string}>("INSERT INTO his_inbound_file(sha256,state,filename,parsed,ln,source_path,path_version,byte_size,parser_version) VALUES($1,'Ready',$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(sha256) DO NOTHING RETURNING id",[hash,name,JSON.stringify(parsed),parsed.ln,rel,version,bytes.length,PARSER_VERSION]);
 if(!r.rows[0]){
  const winner=(await db.query<{id:string}>('SELECT id FROM his_inbound_file WHERE sha256=$1',[hash])).rows[0];
  await source(hash,winner?.id??null,bytes.length);counts.sameContent++;return null;
 }
 await source(hash,r.rows[0].id,bytes.length);
 await supersedeParseErrors(db,rel,parsed.ln,version);
 counts.stored++;if(version>1)counts.newPathVersion++;
 return r.rows[0].id;
}
