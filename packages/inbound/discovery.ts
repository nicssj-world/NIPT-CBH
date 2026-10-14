import {promises as fs} from 'node:fs';
import type {Queryable} from '../db/connection';
import {confined,sha256,type FileStore} from '../storage';
import {parsePet,PARSER_VERSION} from '../integrations/pet';
import {sectionOf,classifyPet,redactPet,NIPT_SECTION,MAX_PET_BYTES} from './wire';
import {errorCode} from './tx';
import {type InboundSource,inboundReadError,inboundAccessError} from './source';
const sourceFile=(o:DiscoveryOptions,rel:string)=>o.source?o.source.file(rel):confined(o.root,rel);

export interface DiscoveryCounts{dayFolders:number;petSeen:number;notNipt:number;waitingOk:number;okArrived:number;unchanged:number;sameContent:number;stored:number;newPathVersion:number;parseError:number;readError:number;}
export const emptyCounts=():DiscoveryCounts=>({dayFolders:0,petSeen:0,notNipt:0,waitingOk:0,okArrived:0,unchanged:0,sameContent:0,stored:0,newPathVersion:0,parseError:0,readError:0});

/** Day folders (YYYYMMDD, Asia/Bangkok), oldest first, including today (AT-HISIN-10). */
export function lookbackFolders(lookbackDays:number,now:Date){
 if(!Number.isInteger(lookbackDays)||lookbackDays<1||lookbackDays>90)throw Error('INVALID_LOOKBACK');
 return Array.from({length:lookbackDays},(_,i)=>new Date(now.getTime()-(lookbackDays-1-i)*86_400_000).toLocaleDateString('en-CA',{timeZone:'Asia/Bangkok'}).replace(/-/g,''));
}
const missing=(e:unknown)=>inboundReadError(e);
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
 catch(e){if(!missing(e))throw e;counts.waitingOk++;await db.query('INSERT INTO his_inbound_waiting(source_id,source_path,first_seen_at,last_seen_at) VALUES($3,$1,$2,$2) ON CONFLICT(source_id,source_path) DO UPDATE SET last_seen_at=excluded.last_seen_at',[rel,now,sourceId]);return null;}
 if((await db.query('UPDATE his_inbound_waiting SET ok_seen_at=$2 WHERE source_path=$1 AND source_id=$3 AND ok_seen_at IS NULL RETURNING source_path',[rel,now,sourceId])).rows.length)counts.okArrived++;
 const path=await sourceFile(options,rel),st=await fs.lstat(path);
 if(!st.isFile())throw Error('NOT_REGULAR_FILE');
 const mtime=st.mtime;
 if((await db.query('SELECT 1 FROM his_inbound_source WHERE source_path=$1 AND byte_size=$2 AND source_mtime=$3 AND source_id=$4 LIMIT 1',[rel,st.size,mtime,sourceId])).rows.length){counts.unchanged++;return null;}
 const source=async(hash:string,fileId:string|null,size:number)=>{await db.query('INSERT INTO his_inbound_source(source_id,source_path,sha256,inbound_file_id,byte_size,source_mtime) VALUES($6,$1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',[rel,hash,fileId,size,mtime,sourceId]);};
 const pathVersion=async()=>Number((await db.query<{n:number}>('SELECT count(*)::int AS n FROM his_inbound_file WHERE source_path=$1',[rel])).rows[0].n)+1;
 const parseError=async(hash:string,size:number,code:string)=>{
  // PHI-minimal: hash and error code only; the source file stays on the share for re-reading.
  const r=await db.query<{id:string}>("INSERT INTO his_inbound_file(sha256,state,filename,ln,source_path,path_version,byte_size,parser_version,error_code) VALUES($1,'ParseError',$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(sha256) DO NOTHING RETURNING id",[hash,name,filenameLn,rel,await pathVersion(),size,PARSER_VERSION,code]);
  await source(hash,r.rows[0]?.id??null,size);counts.parseError++;return null;
 };
 if(st.size>MAX_PET_BYTES)return parseError(sha256(Buffer.from(`${rel}|${st.size}|${mtime.toISOString()}`)),st.size,'FILE_TOO_LARGE');
 const bytes=await fs.readFile(path),hash=sha256(bytes);
 const existing=(await db.query<{id:string}>('SELECT id FROM his_inbound_file WHERE sha256=$1',[hash])).rows[0];
 if(existing){await source(hash,existing.id,bytes.length);counts.sameContent++;return null;}
 const kind=classifyPet(bytes);
 if(kind==='NOT_NIPT'){counts.notNipt++;return null;}
 if(kind==='INVALID_ENCODING')return parseError(hash,bytes.length,'INVALID_ENCODING');
 if(kind==='MALFORMED')return parseError(hash,bytes.length,'INVALID_FIELDS');
 let parsed:ReturnType<typeof redactPet>;
 try{parsed=redactPet(parsePet(bytes,name),options.lookupKey);}catch(e){return parseError(hash,bytes.length,errorCode(e));}
 const version=await pathVersion();
 await store.put(bytes);
 const r=await db.query<{id:string}>("INSERT INTO his_inbound_file(sha256,state,filename,parsed,ln,source_path,path_version,byte_size,parser_version) VALUES($1,'Ready',$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(sha256) DO NOTHING RETURNING id",[hash,name,JSON.stringify(parsed),parsed.ln,rel,version,bytes.length,PARSER_VERSION]);
 await source(hash,r.rows[0]?.id??null,bytes.length);
 if(!r.rows[0])return null;
 counts.stored++;if(version>1)counts.newPathVersion++;
 return r.rows[0].id;
}
