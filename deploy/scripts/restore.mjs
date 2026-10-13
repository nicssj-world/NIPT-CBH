import {execFileSync} from 'node:child_process';
import {createDecipheriv} from 'node:crypto';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Client} from 'pg';
import {FORMAT,canonical,sha,checkedPath,disjoint,unpack,extract,p6Coverage,MAX_ARCHIVE_BYTES,readBoundedFile} from './backup-format.mjs';

if(process.env.NIPT_MODE!=='synthetic'||process.env.RESTORE_TO_NEW_SYNTHETIC_DATABASE!=='yes')throw Error('EXPLICIT_NEW_SYNTHETIC_RESTORE_REQUIRED');
if(!process.argv[2]||!process.argv[3])throw Error('BACKUP_BASE_AND_NEW_FILESTORE_REQUIRED');
const base=path.resolve(process.argv[2]),destination=await checkedPath(process.argv[3],{missing:true,fresh:true});
const p6Destination=process.argv[4]?await checkedPath(process.argv[4],{missing:true,fresh:true}):null;
if(p6Destination)disjoint(p6Destination,path.resolve(fileURLToPath(new URL('../../',import.meta.url)),'.local/p6-sandbox'));
const keyPath=await checkedPath(process.env.BACKUP_KEY_FILE??'');
disjoint(destination,...(p6Destination?[p6Destination]:[]),base+'.enc',base+'.json',keyPath);
const url=new URL(process.env.RESTORE_DATABASE_URL??'');
if(!['postgres:','postgresql:'].includes(url.protocol)||!['127.0.0.1','localhost','db'].includes(url.hostname)||!/^\/nipt_synthetic_restore_[a-z0-9_]+$/.test(url.pathname)||url.search||url.hash)throw Error('NEW_SYNTHETIC_RESTORE_DATABASE_REQUIRED');
const meta=JSON.parse(await fs.readFile(await checkedPath(base+'.json'),'utf8'));
if(![FORMAT,'NIPT_SYNTHETIC_BACKUP_V1'].includes(meta.format))throw Error('UNKNOWN_BACKUP');
const encPath=await checkedPath(base+'.enc');if((await fs.stat(encPath)).size>MAX_ARCHIVE_BYTES+32)throw Error('BACKUP_SIZE_LIMIT');
const encrypted=await readBoundedFile(encPath,MAX_ARCHIVE_BYTES+32);if(sha(encrypted)!==meta.sha256)throw Error('BACKUP_CHECKSUM_FAILED');
const key=await fs.readFile(keyPath);if(key.length!==32)throw Error('BACKUP_KEY_REQUIRED');
let stage;const db=new Client({connectionString:url.toString()});
try{
 const iv=Buffer.from(meta.iv,'base64'),tag=Buffer.from(meta.tag,'base64');if(iv.length!==12||tag.length!==16)throw Error('BACKUP_AUTH_METADATA');
 const decipher=createDecipheriv('aes-256-gcm',key,iv);decipher.setAAD(Buffer.from(meta.format));decipher.setAuthTag(tag);
 const entries=unpack(Buffer.concat([decipher.update(encrypted),decipher.final()]));
 if(entries.some(e=>!['database.dump','files','manifest.json','p6-sandbox'].includes(e.path.split('/')[0])||['database.dump','manifest.json'].includes(e.path)&&e.directory||['files','p6-sandbox'].includes(e.path)&&!e.directory||e.path.startsWith('database.dump/')||e.path.startsWith('manifest.json/')))throw Error('BACKUP_UNSAFE_ENTRY');
 const regular=entries.filter(e=>!e.directory),dumpEntry=regular.find(e=>e.path==='database.dump');if(!dumpEntry)throw Error('BACKUP_DATABASE_REQUIRED');
 let manifest;
 if(meta.format===FORMAT){
  const m=regular.find(e=>e.path==='manifest.json');if(!m)throw Error('BACKUP_MANIFEST_REQUIRED');manifest=JSON.parse(m.bytes.toString('utf8'));
  const actual=regular.filter(e=>e.path!=='manifest.json').map(e=>({path:e.path,bytes:e.bytes.length,sha256:sha(e.bytes)})).sort((a,b)=>a.path.localeCompare(b.path,'en'));
  if(manifest.format!==FORMAT||manifest.syntheticOnly!==true||manifest.consistency!=='QUIESCENT_SOURCE'||canonical(actual)!==canonical(manifest.files)||!manifest.p6||!Array.isArray(manifest.p6.sandboxIds))throw Error('BACKUP_MANIFEST_MISMATCH');
  if(manifest.p6.sandboxIds.length&&!p6Destination)throw Error('FRESH_P6_ARCHIVE_ROOT_REQUIRED');
  const ids=[...new Set(regular.filter(e=>e.path.startsWith('p6-sandbox/')).map(e=>e.path.split('/')[1]))].sort();
  if(canonical(ids)!==canonical(manifest.p6.sandboxIds)||ids.some(id=>!/^SYNTHETIC-[A-Za-z0-9_-]{1,90}$/.test(id)))throw Error('BACKUP_P6_COVERAGE');
  for(const id of ids)if(regular.find(e=>e.path===`p6-sandbox/${id}/.p6-synthetic-root`)?.bytes.toString()!=='NIPT_P6_SYNTHETIC_ONLY_V1\n')throw Error('BACKUP_P6_MARKER');
 }else if(entries.some(e=>e.path.startsWith('p6-sandbox')||e.path==='manifest.json'))throw Error('BACKUP_V1_UNEXPECTED_ENTRY');
 await db.connect();
 const occupied=await db.query("SELECT count(*)::int n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND c.relkind IN ('r','p','v','m','S','f')");
 const schemas=await db.query("SELECT count(*)::int n FROM pg_namespace WHERE nspname NOT IN ('public','pg_catalog','information_schema') AND nspname NOT LIKE 'pg_%'");
 const routines=await db.query("SELECT count(*)::int n FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'");
 if(occupied.rows[0].n||schemas.rows[0].n||routines.rows[0].n)throw Error('RESTORE_DATABASE_NOT_EMPTY');
 await fs.mkdir(path.dirname(destination),{recursive:true});stage=await fs.mkdtemp(path.join(path.dirname(destination),'.restore-'));
 await extract(entries,stage);
 const pgRestore=path.join(process.env.PG_BIN??'',process.platform==='win32'?'pg_restore.exe':'pg_restore'),dump=path.join(stage,'database.dump');
 const listing=execFileSync(pgRestore,['--list',dump],{encoding:'utf8'});
 if(meta.format==='NIPT_SYNTHETIC_BACKUP_V1'&&/\bp6_[a-z0-9_]+\b/.test(listing))throw Error('P6_BACKUP_COVERAGE_UNPROVEN');
 execFileSync(pgRestore,['--single-transaction','--exit-on-error','--no-owner','--no-acl','--dbname',url.pathname.slice(1),dump],{env:{...process.env,PGHOST:url.hostname,PGPORT:url.port||'5432',PGUSER:decodeURIComponent(url.username),PGPASSWORD:decodeURIComponent(url.password),PGDATABASE:url.pathname.slice(1)},stdio:['ignore','ignore','pipe']});
 if(manifest&&canonical(await p6Coverage(db))!==canonical(manifest.p6))throw Error('RESTORED_P6_JOURNAL_MISMATCH');
 await checkedPath(destination,{missing:true,fresh:true});await fs.mkdir(destination);await extract(regular.filter(e=>e.path.startsWith('files/')).map(e=>({...e,path:e.path.slice(6)})),destination);
 if(manifest?.p6.sandboxIds.length){await checkedPath(p6Destination,{missing:true,fresh:true});await fs.mkdir(p6Destination,{recursive:true});await extract(regular.filter(e=>e.path.startsWith('p6-sandbox/')).map(e=>({...e,path:e.path.slice(11)})),p6Destination);}
 process.stdout.write(JSON.stringify({format:meta.format,restored:true,p6Activated:false,fileCount:regular.length-1})+'\n');
}finally{key.fill(0);await db.end().catch(()=>{});if(stage)await fs.rm(stage,{recursive:true,force:true});}
