import {mkdtemp,mkdir,writeFile,rm,readdir,lstat,readFile,utimes} from 'node:fs/promises';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import type {PGlite} from '@electric-sql/pglite';
import {testDatabase} from './database';
import {FileStore} from '../../packages/storage';
import {registerCase} from '../../packages/db/registration';
import {buildSyntheticPet,type SyntheticPetSpec} from '../../packages/inbound/wire';
import {lnHnKey} from '../../packages/inbound/identity';
import {runInboundCycle,type ScanTrigger} from '../../packages/inbound/cycle';

export interface InboundFixture{db:PGlite;root:string;store:FileStore;lookupKey:Buffer;deps:{store:FileStore;lookupKey:Buffer;root:string};close():Promise<void>;}

/** Disposable PGlite + marked synthetic simulator root + file store. Never touches data/ or another workspace. */
export async function inboundFixture():Promise<InboundFixture>{
 const base=await mkdtemp(path.join(os.tmpdir(),'nipt-p3-')),root=path.join(base,'simulator');
 await mkdir(path.join(root,'inbound'),{recursive:true});await writeFile(path.join(root,'.nipt-synthetic-root'),'NIPT_SYNTHETIC_ONLY_V1');
 const db=await testDatabase(),store=new FileStore(path.join(base,'files')),lookupKey=randomBytes(32);
 return {db,root,store,lookupKey,deps:{store,lookupKey,root},close:async()=>{await db.close();await rm(base,{recursive:true,force:true});}};
}

/** Simulator side (plays HIS): writes `.pet` then optionally its `.ok` sentinel into a day folder. */
export async function writePet(root:string,day:string,spec:SyntheticPetSpec,options:{ok?:boolean;mtime?:Date}={}){
 const pet=buildSyntheticPet(spec),dir=path.join(root,'inbound',day);await mkdir(dir,{recursive:true});
 const file=path.join(dir,pet.filename);await writeFile(file,pet.bytes);if(options.mtime)await utimes(file,options.mtime,options.mtime);
 if(options.ok!==false)await writeFile(file.replace(/\.pet$/,'.ok'),Buffer.alloc(0));
 return {...pet,path:file};
}
export const writeOk=(root:string,day:string,filename:string)=>writeFile(path.join(root,'inbound',day,filename.replace(/\.pet$/,'.ok')),Buffer.alloc(0));

export async function register(db:PGlite,lookupKey:Buffer,input:{ln:string;hn:string;origin?:'ANC'|'LAB_DIRECT'}){
 await db.query('BEGIN');
 try{const r=await registerCase(db,{ln:input.ln,identityKey:lnHnKey(input.ln,input.hn,lookupKey),origin:input.origin??'ANC',idempotencyKey:'p3_'+randomUUID().replaceAll('-','')});await db.query('COMMIT');return r.caseId!;}
 catch(e){await db.query('ROLLBACK');throw e;}
}

export const cycle=(f:InboundFixture,options:{trigger?:ScanTrigger;lookbackDays?:number;now?:Date;intervalSeconds?:number}={})=>
 runInboundCycle(f.db,f.deps,{trigger:options.trigger??'MANUAL',lookbackDays:options.lookbackDays??3,intervalSeconds:options.intervalSeconds??30,now:options.now?()=>options.now!:undefined});

/** Read-only proof: every path, size, mtime and SHA-256 under the simulator tree (AT-HISIN-08). */
export async function treeChecksum(root:string){
 const out:string[]=[];
 async function walk(dir:string){for(const name of (await readdir(dir)).sort()){const p=path.join(dir,name),st=await lstat(p);if(st.isDirectory())await walk(p);else out.push(`${path.relative(root,p)}|${st.size}|${st.mtimeMs}|${createHash('sha256').update(await readFile(p)).digest('hex')}`);}}
 await walk(root);return out;
}

export async function rows<T=Record<string,unknown>>(db:PGlite,sql:string,params:unknown[]=[]){return (await db.query<T>(sql,params)).rows;}
export async function caseState(db:PGlite,caseId:string){
 return {
  rounds:await rows<{round_number:number;state:string;received_source:string|null;received_at:Date|null;collection_date:unknown}>(db,'SELECT round_number,state,received_source,received_at,collection_date FROM specimen_round WHERE case_id=$1 ORDER BY round_number',[caseId]),
  orders:await rows<{id:string;his_received_at:Date}>(db,'SELECT o.id,o.his_received_at FROM his_order o JOIN case_ln l ON l.id=o.case_ln_id WHERE l.case_id=$1',[caseId]),
  ln:(await rows<{verification:string}>(db,'SELECT verification FROM case_ln WHERE case_id=$1',[caseId]))[0]
 };
}
export const openIssues=(db:PGlite,ln?:string)=>rows<{kind:string;state:string;case_id:string|null;details:{fields:string[]}}>(db,`SELECT kind,state,case_id,details FROM his_intake_issue WHERE state IN ('Open','Proposed')${ln?' AND ln=$1':''} ORDER BY kind,created_at`,ln?[ln]:[]);
export const fileStates=(db:PGlite,ln:string)=>rows<{state:string;error_code:string|null}>(db,'SELECT state,error_code FROM his_inbound_file WHERE ln=$1 ORDER BY discovered_at,source_path',[ln]);
