import {mkdtemp,mkdir,writeFile,rm,readdir,lstat,readFile,utimes} from 'node:fs/promises';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import type {PGlite} from '@electric-sql/pglite';
import {testDatabase,addUser} from './database';
import {registerP2,type Staff} from '../../packages/p2/service';
import {identityLookup} from '../../packages/security/envelope';
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

async function tx<T>(db:PGlite,fn:()=>Promise<T>){await db.query('BEGIN');try{const r=await fn();await db.query('COMMIT');return r;}catch(e){await db.query('ROLLBACK');throw e;}}
const registrars=new WeakMap<PGlite,Promise<{unit:string;anc:Staff;lab:Staff}>>();
/** One synthetic unit with an ANC nurse scoped to it and a Lab registrar per fixture database. */
export function registrar(db:PGlite){
 let r=registrars.get(db);
 if(!r){r=(async()=>{const unit=(await db.query<{id:string}>("INSERT INTO unit(code,name) VALUES('SYNTHETIC_P3_UNIT','หน่วยจำลอง P3') RETURNING id")).rows[0].id;const anc=await addUser(db,'ANC_NURSE','synthetic.p3.registrar.anc'),lab=await addUser(db,'LAB_STAFF','synthetic.p3.registrar.lab');return {unit,anc:{...anc,unitIds:[unit]},lab};})();registrars.set(db,r);}
 return r;
}
export type RegisterSpec={ln:string;hn:string;origin?:'ANC'|'LAB_DIRECT';identifierSource?:'TUBE_LABEL'|'REQUEST_FORM'|'PATIENT_DOCUMENT';idempotencyKey?:string};
/** The integrated path: P2 registerP2 (scope, immutable HN, LN lock) with the D-49 intake hook in one transaction. */
export async function registerP2Case(f:Pick<InboundFixture,'db'|'lookupKey'|'store'>,input:RegisterSpec){
 const {unit,anc,lab}=await registrar(f.db),origin=input.origin??'ANC';
 return tx(f.db,()=>registerP2(f.db,origin==='ANC'?anc:lab,{ln:input.ln,hn:input.hn,unitId:unit,origin,idempotencyKey:input.idempotencyKey??'p3_'+randomUUID().replaceAll('-',''),...(origin==='LAB_DIRECT'||input.identifierSource?{identifierSource:input.identifierSource??'TUBE_LABEL'}:{})},f.lookupKey,{store:f.store}));
}
export async function register(f:Pick<InboundFixture,'db'|'lookupKey'|'store'>,input:RegisterSpec){const r=await registerP2Case(f,input);if(!r.caseId)throw Error('REGISTRATION_NOT_CREATED');return r.caseId;}
/** A P2-identified case created before the registration hook existed (pre-integration data): only the worker rematch links it. */
export async function registerWithoutHook(f:Pick<InboundFixture,'db'|'lookupKey'>,input:{ln:string;hn:string;origin?:'ANC'|'LAB_DIRECT'}){
 const {unit}=await registrar(f.db);
 return tx(f.db,async()=>{const r=await registerCase(f.db,{ln:input.ln,identityKey:lnHnKey(input.ln,input.hn,f.lookupKey),origin:input.origin??'ANC',idempotencyKey:'p3_'+randomUUID().replaceAll('-','')});await f.db.query('INSERT INTO case_unit_scope(case_id,unit_id) VALUES($1,$2)',[r.caseId,unit]);await f.db.query('INSERT INTO p2_case_identity(case_id,hn) VALUES($1,$2)',[r.caseId,input.hn]);return r.caseId!;});
}
/** P1 synthetic legacy registration: digest of SYNTHETIC-ID-…, no P2 identity. Never upgraded by LN equality. */
export async function registerP1Legacy(f:Pick<InboundFixture,'db'|'lookupKey'>,input:{ln:string;legacyId:string}){
 return tx(f.db,async()=>(await registerCase(f.db,{ln:input.ln,identityKey:identityLookup(input.legacyId,f.lookupKey),origin:'ANC',idempotencyKey:'p1_'+randomUUID().replaceAll('-','')})).caseId!);
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
