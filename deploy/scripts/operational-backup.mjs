/** Operational continuation of the existing backup entry points. Streaming AES-GCM,
 * deployment-owned targets, stopped-worker snapshot and fresh quarantined restore.
 * Synthetic V1/V2 formats and their safety gates remain unchanged.
 */
import * as fs from 'node:fs/promises';
import {createReadStream,createWriteStream} from 'node:fs';
import {createCipheriv,createDecipheriv,createHash,randomBytes,randomUUID} from 'node:crypto';
import {Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {spawn,execFileSync} from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import {Client} from 'pg';
import {canonical,safeName} from './backup-format.mjs';
export const OPERATIONAL_FORMAT='NIPT_OPERATIONAL_BACKUP_V1';
const digest=b=>createHash('sha256').update(b).digest('hex');
const inside=(root,p)=>{const r=path.relative(path.resolve(root),path.resolve(p));return r===''||!path.isAbsolute(r)&&r!=='..'&&!r.startsWith('..'+path.sep);};
const account=()=>process.platform==='win32'?execFileSync(path.join(process.env.SystemRoot??'C:/Windows','System32/whoami.exe'),[],{encoding:'utf8',windowsHide:true}).trim():os.userInfo().username;
export function validatePolicyTarget(p,identity,database,target,kind){
 if(p?.version!==1||!path.isAbsolute(p.backupRoot??'')||!path.isAbsolute(p.restoreRoot??'')||!/^nipt_operational_restore_[a-z0-9_]*$/.test(p.restoreDatabasePrefix??''))throw Error('OPERATIONS_POLICY_INVALID');
 if(p.serviceAccount?.toLowerCase()!==identity.toLowerCase())throw Error('OPERATIONS_IDENTITY_MISMATCH');
 if(p.sourceDatabase!==database)throw Error('OPERATIONS_DATABASE_MISMATCH');
 if(!inside(kind==='backup'?p.backupRoot:p.restoreRoot,target))throw Error('OPERATIONS_TARGET_OUTSIDE_POLICY');return true;
}
async function checked(target,{fresh=false}={}){
 const absolute=path.resolve(target);let cursor=path.parse(absolute).root;
 for(const segment of absolute.slice(cursor.length).split(path.sep).filter(Boolean)){cursor=path.join(cursor,segment);try{const s=await fs.lstat(cursor);if(s.isSymbolicLink()||s.isFile()&&s.nlink!==1)throw Error('OPERATIONS_LINK_PROHIBITED');if(fresh&&cursor===absolute)throw Error('OPERATIONS_FRESH_TARGET_REQUIRED');}catch(e){if(e.code!=='ENOENT')throw e;}}
 return absolute;
}
async function secureDirectory(directory,identity){if(process.platform==='win32'){try{execFileSync(path.join(process.env.SystemRoot??'C:/Windows','System32/icacls.exe'),[directory,'/inheritance:r','/grant:r',identity+':(OI)(CI)F'],{windowsHide:true,stdio:'ignore'});}catch{throw Error('OPERATIONS_ACL_FAILED');}}else await fs.chmod(directory,0o700);}
const hashFile=async file=>{const h=createHash('sha256');for await(const b of createReadStream(await checked(file)))h.update(b);return h.digest('hex');};
export async function encryptFile(source,destination,key,aad){
 await checked(source);await checked(destination,{fresh:true});const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv),plain=createHash('sha256'),encrypted=createHash('sha256');let bytes=0;
 cipher.setAAD(Buffer.from(aad));
 await pipeline(createReadStream(source),new Transform({transform(b,e,cb){bytes+=b.length;plain.update(b);cb(null,b);}}),cipher,new Transform({transform(b,e,cb){encrypted.update(b);cb(null,b);}}),createWriteStream(destination,{flags:'wx',mode:0o600}));
 return {bytes,sha256:plain.digest('hex'),cipherSha256:encrypted.digest('hex'),iv:iv.toString('hex'),tag:cipher.getAuthTag().toString('hex')};
}
export async function decryptFile(source,destination,key,aad,entry){
 if(await hashFile(source)!==entry.cipherSha256)throw Error('BACKUP_CIPHERTEXT_MISMATCH');await checked(destination,{fresh:true});
 const decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(entry.iv,'hex'));decipher.setAAD(Buffer.from(aad));decipher.setAuthTag(Buffer.from(entry.tag,'hex'));const h=createHash('sha256');let size=0;
 await pipeline(createReadStream(source),decipher,new Transform({transform(b,e,cb){h.update(b);size+=b.length;cb(null,b);}}),createWriteStream(destination,{flags:'wx',mode:0o600}));
 if(size!==entry.bytes||h.digest('hex')!==entry.sha256)throw Error('BACKUP_PLAINTEXT_MISMATCH');
}
async function inventory(root){const rows=[];async function walk(rel=''){for(const e of (await fs.readdir(await checked(path.join(root,rel)),{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){const name=rel?rel+'/'+e.name:e.name;safeName(name);const file=await checked(path.join(root,...name.split('/')));if(e.isDirectory())await walk(name);else if(e.isFile())rows.push({path:name,bytes:(await fs.stat(file)).size,sha256:await hashFile(file)});else throw Error('OPERATIONS_UNSUPPORTED_FILE');}}await walk();return rows;}
function targetUrl(raw,expected){const u=new URL(raw??'');if(!['postgres:','postgresql:'].includes(u.protocol)||decodeURIComponent(u.pathname.slice(1))!==expected||u.hash||u.searchParams.has('uselibpqcompat'))throw Error('OPERATIONS_DATABASE_TARGET_REQUIRED');if(!['localhost','127.0.0.1','[::1]','db','postgres'].includes(u.hostname)&&u.searchParams.get('sslmode')!=='verify-full')throw Error('DATABASE_VERIFIED_TLS_REQUIRED');return u;}
const fingerprint=u=>digest(canonical({host:u.hostname,port:u.port||'5432',database:decodeURIComponent(u.pathname.slice(1))}));
async function policy(env,target,kind){if(env.NIPT_MODE!=='operational'||!env.NIPT_OPERATIONAL_DATABASE||!env.NIPT_BACKUP_POLICY_FILE)throw Error('OPERATIONAL_BACKUP_CONFIGURATION_REQUIRED');const p=JSON.parse(await fs.readFile(await checked(env.NIPT_BACKUP_POLICY_FILE),'utf8'));validatePolicyTarget(p,account(),env.NIPT_OPERATIONAL_DATABASE,target,kind);return p;}
const quote=s=>'"'+s.replaceAll('"','""')+'"';
const binary=(env,name)=>path.join(env.PG_BIN??'',name+(process.platform==='win32'?'.exe':''));
async function pgTool(env,name,args,u){await new Promise((resolve,reject)=>{const child=spawn(binary(env,name),args,{windowsHide:true,env:{...env,PGHOST:u.hostname,PGPORT:u.port||'5432',PGUSER:decodeURIComponent(u.username),PGPASSWORD:decodeURIComponent(u.password),PGDATABASE:decodeURIComponent(u.pathname.slice(1))},stdio:'ignore'});child.on('error',()=>reject(Error('POSTGRES_TOOL_FAILED')));child.on('exit',c=>c===0?resolve():reject(Error('POSTGRES_TOOL_FAILED')));});}
async function mode(db){if(!(await db.query('SELECT nipt_operational_enabled() enabled')).rows[0]?.enabled)throw Error('RUNTIME_DATABASE_MODE_MISMATCH');}
async function quiesce(db){const r=(await db.query('SELECT pg_try_advisory_lock(75432804) acquired')).rows[0];if(!r.acquired)throw Error('WORKER_OR_WRITER_NOT_QUIESCENT');const worker=(await db.query("SELECT EXISTS(SELECT FROM pg_locks WHERE locktype='advisory' AND classid=0 AND objid=75432803 AND granted AND database=(SELECT oid FROM pg_database WHERE datname=current_database())) busy")).rows[0];if(worker.busy)throw Error('WORKER_NOT_QUIESCENT');if((await db.query("SELECT to_regclass('pgboss.job') present")).rows[0].present&&(await db.query("SELECT 1 FROM pgboss.job WHERE state='active' LIMIT 1")).rowCount)throw Error('QUEUE_NOT_QUIESCENT');}
async function tableDigests(db){const tables=(await db.query("SELECT n.nspname schema,c.relname name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind IN ('r','p') AND n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND c.relname<>'nipt_restore_state' ORDER BY 1,2")).rows;const rows=[];for(const t of tables){const r=(await db.query(`SELECT count(*)::text n,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' ORDER BY md5(to_jsonb(t)::text)),'')) hash FROM ${quote(t.schema)}.${quote(t.name)} t`)).rows[0];rows.push({...t,...r});}return rows;}
export async function operationalBackup(output,env=process.env){
 const p=await policy(env,output,'backup'),u=targetUrl(env.DATABASE_URL,p.sourceDatabase),db=new Client({connectionString:u.toString()}),key=await fs.readFile(await checked(env.BACKUP_KEY_FILE??''));if(key.length!==32)throw Error('BACKUP_KEY_REQUIRED');
 const root=path.join(await checked(output),'operational-'+Date.now()+'-'+randomUUID());await checked(root,{fresh:true});await fs.mkdir(root,{recursive:true,mode:0o700});await secureDirectory(root,p.serviceAccount);const dump=path.join(root,'.database.dump');
 try{await db.connect();await mode(db);if(env.BACKUP_SOURCE_QUIESCENT!=='yes')throw Error('QUIESCENT_OPERATIONAL_SOURCE_REQUIRED');await quiesce(db);await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ');await db.query("SET LOCAL lock_timeout='5s'");
  const tables=await tableDigests(db);for(const t of tables)await db.query(`LOCK TABLE ${quote(t.schema)}.${quote(t.name)} IN SHARE MODE`);
  const snapshot=(await db.query('SELECT pg_export_snapshot() snapshot')).rows[0].snapshot;
  if(!env.FILE_STORE_ROOT)throw Error('BACKUP_FILE_STORE_REQUIRED');
  const roots=[{id:'files',root:await checked(env.FILE_STORE_ROOT)}];
  const transfers=(await db.query("SELECT release_draft->'settings'->'connection' connection FROM p6_transfer WHERE authority='CERTIFIED_RESULT'")).rows;
  const required=[...new Set(transfers.flatMap(r=>r.connection?[r.connection.resPath,r.connection.pdfPath,r.connection.backupPath]:[]))];
  if(!Array.isArray(p.outboundRoots)||required.some(r=>!p.outboundRoots.some(x=>path.resolve(x.root)===path.resolve(r))))throw Error('BACKUP_OUTBOUND_ROOT_UNAUTHORIZED');
  for(const [i,r]of p.outboundRoots.entries())roots.push({id:'outbound-'+i,root:await checked(r.root)});
  for(const a of roots){if(inside(a.root,root)||inside(root,a.root))throw Error('BACKUP_SOURCE_TARGET_OVERLAP');}
  const before=[];for(const r of roots)before.push(...(await inventory(r.root)).map(f=>({...f,rootId:r.id})));
  for(const a of (await db.query('SELECT storage_key,sha256,byte_size FROM file_asset')).rows){const f=before.find(f=>f.rootId==='files'&&f.path===a.storage_key);if(!f||f.sha256!==a.sha256||f.bytes!==Number(a.byte_size))throw Error('BACKUP_REFERENCED_ASSET_MISSING_OR_CHANGED');}
  await pgTool(env,'pg_dump',['--format=custom','--exclude-table-data=public.nipt_restore_state','--snapshot',snapshot,'--file',dump],u);
  const master=await checked(env.NIPT_TASK_MASTER_PATH??'');const masterHash=JSON.parse(await fs.readFile('packages/workbook/master-manifest.json','utf8')).sha256;if(await hashFile(master)!==masterHash)throw Error('TASK_MASTER_SHA256_MISMATCH');
  const entries=[];const sources=[{rootId:'database',path:'database.dump',source:dump},{rootId:'master',path:'owner-master.xlsx',source:master,sha256:masterHash},...before.map(f=>({...f,source:path.join(roots.find(r=>r.id===f.rootId).root,...f.path.split('/'))}))];
  for(const [i,f]of sources.entries()){const name=String(i).padStart(8,'0')+'.enc',aad=OPERATIONAL_FORMAT+':'+name,encrypted=await encryptFile(f.source,path.join(root,name),key,aad);if(f.sha256&&encrypted.sha256!==f.sha256)throw Error('BACKUP_SOURCE_CHANGED');entries.push({rootId:f.rootId,path:f.path,name,...encrypted});}
  const after=[];for(const r of roots)after.push(...(await inventory(r.root)).map(f=>({...f,rootId:r.id})));if(canonical(before)!==canonical(after))throw Error('BACKUP_SOURCE_CHANGED');
  const manifest={format:OPERATIONAL_FORMAT,sourceFingerprint:fingerprint(u),createdAt:new Date().toISOString(),roots,entries,tables,sourceRevision:env.NIPT_SOURCE_SHA??null,migrationLedger:(await db.query('SELECT name,checksum FROM schema_migration ORDER BY name')).rows};
  const raw=Buffer.from(canonical(manifest));if(raw.length>32*1024*1024)throw Error('BACKUP_MANIFEST_METADATA_LIMIT');const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',key,iv);c.setAAD(Buffer.from(OPERATIONAL_FORMAT));const bytes=Buffer.concat([c.update(raw),c.final()]);await fs.writeFile(path.join(root,'manifest.enc'),bytes,{flag:'wx',mode:0o600});
  const metadata={format:OPERATIONAL_FORMAT,createdAt:manifest.createdAt,manifestSha256:digest(bytes),iv:iv.toString('hex'),tag:c.getAuthTag().toString('hex')};await fs.writeFile(path.join(root,'metadata.json'),JSON.stringify(metadata),{flag:'wx',mode:0o600});await db.query('COMMIT');await fs.unlink(dump);
  return {backupBase:root,format:OPERATIONAL_FORMAT,fileCount:entries.length,createdAt:manifest.createdAt,manifestSha256:metadata.manifestSha256};
 }finally{key.fill(0);await db.query('ROLLBACK').catch(()=>{});await db.end().catch(()=>{});}
}
export async function operationalRestore(base,destination,env=process.env){
 const p=await policy(env,destination,'restore');if(env.RESTORE_TO_NEW_OPERATIONAL_DATABASE!=='yes')throw Error('EXPLICIT_NEW_OPERATIONAL_RESTORE_REQUIRED');const target=new URL(env.RESTORE_DATABASE_URL??'');const database=decodeURIComponent(target.pathname.slice(1));if(!database.startsWith(p.restoreDatabasePrefix)||!/^[a-z0-9_]{1,63}$/.test(database))throw Error('FRESH_OPERATIONAL_RESTORE_DATABASE_REQUIRED');const u=targetUrl(target.toString(),database),source=targetUrl(env.DATABASE_URL,p.sourceDatabase);if(fingerprint(u)===fingerprint(source))throw Error('RESTORE_SOURCE_TARGET_IDENTICAL');
 await checked(destination,{fresh:true});await checked(base);const meta=JSON.parse(await fs.readFile(await checked(path.join(base,'metadata.json')),'utf8'));if(meta.format!==OPERATIONAL_FORMAT)throw Error('UNKNOWN_BACKUP');const encrypted=await fs.readFile(await checked(path.join(base,'manifest.enc')));if(encrypted.length>32*1024*1024+32||digest(encrypted)!==meta.manifestSha256)throw Error('BACKUP_MANIFEST_MISMATCH');
 const key=await fs.readFile(await checked(env.BACKUP_KEY_FILE));if(key.length!==32)throw Error('BACKUP_KEY_REQUIRED');const db=new Client({connectionString:u.toString()});
 try{const c=createDecipheriv('aes-256-gcm',key,Buffer.from(meta.iv,'hex'));c.setAAD(Buffer.from(OPERATIONAL_FORMAT));c.setAuthTag(Buffer.from(meta.tag,'hex'));const manifest=JSON.parse(Buffer.concat([c.update(encrypted),c.final()]));if(manifest.format!==OPERATIONAL_FORMAT||manifest.sourceFingerprint!==fingerprint(source))throw Error('BACKUP_SOURCE_IDENTITY_MISMATCH');
  if(!Array.isArray(manifest.roots)||new Set(manifest.roots.map(r=>r.id)).size!==manifest.roots.length||manifest.roots.some(r=>!/^files$|^outbound-\d+$/.test(r.id)||!path.isAbsolute(r.root)||r.id.startsWith('outbound-')&&!p.outboundRoots.some(x=>path.resolve(x.root)===path.resolve(r.root))))throw Error('BACKUP_ROOT_POLICY_MISMATCH');
  if(!Array.isArray(manifest.entries)||new Set(manifest.entries.map(e=>e.name)).size!==manifest.entries.length)throw Error('BACKUP_MANIFEST_MISMATCH');
  await db.connect();const occupied=(await db.query("SELECT EXISTS(SELECT FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND c.relkind IN ('r','p','v','m','S','f')) OR EXISTS(SELECT FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public') occupied")).rows[0].occupied;if(occupied)throw Error('RESTORE_DATABASE_NOT_EMPTY');
  await fs.mkdir(destination,{recursive:true,mode:0o700});await secureDirectory(destination,p.serviceAccount);
  for(const e of manifest.entries){safeName(e.path);if(!/^[0-9]{8}\.enc$/.test(e.name)||!['database','master',...manifest.roots.map(r=>r.id)].includes(e.rootId)||!/^(database|master|files|outbound-\d+)$/.test(e.rootId))throw Error('BACKUP_UNSAFE_ENTRY');const target=path.join(destination,e.rootId,...e.path.split('/'));await fs.mkdir(path.dirname(target),{recursive:true,mode:0o700});await decryptFile(path.join(base,e.name),target,key,OPERATIONAL_FORMAT+':'+e.name,e);}
  await pgTool(env,'pg_restore',['--single-transaction','--exit-on-error','--no-owner','--dbname',database,path.join(destination,'database/database.dump')],u);await mode(db);
  if(canonical(await tableDigests(db))!==canonical(manifest.tables))throw Error('RESTORE_DATABASE_DIGEST_MISMATCH');if(canonical((await db.query('SELECT name,checksum FROM schema_migration ORDER BY name')).rows)!==canonical(manifest.migrationLedger))throw Error('RESTORE_MIGRATION_LEDGER_MISMATCH');
  const restoreId=randomUUID();await db.query('INSERT INTO nipt_restore_state(singleton,quarantined,restore_id,source_fingerprint,verified) VALUES(true,true,$1,$2,true)',[restoreId,manifest.sourceFingerprint]);
  const receipt={format:OPERATIONAL_FORMAT,restoreId,sourceFingerprint:manifest.sourceFingerprint,targetFingerprint:fingerprint(u),manifestSha256:meta.manifestSha256,restoreVerified:true,quarantined:true,activated:false,tableCount:manifest.tables.length,fileCount:manifest.entries.length,tableDigest:digest(canonical(manifest.tables)),outbound:manifest.roots.filter(r=>r.id.startsWith('outbound-')).map(r=>({...r,files:manifest.entries.filter(e=>e.rootId===r.id).map(e=>({path:e.path,sha256:e.sha256}))})),createdAt:new Date().toISOString()};await fs.writeFile(path.join(destination,'restore-receipt.json'),JSON.stringify(receipt),{flag:'wx',mode:0o600});return receipt;
 }finally{key.fill(0);await db.end().catch(()=>{});}
}
/** Explicit operator cutover: source is persistently fenced before target activation.
 * Does not rewrite frozen P6 plans or authorize alternate destinations. Destination
 * restoration/ACLs remain the operator's independently verified policy responsibility.
 */
export async function activateRestored(destination,env=process.env){
 const p=await policy(env,destination,'restore');if(env.RESTORE_SOURCE_FENCED!=='yes')throw Error('RESTORE_SOURCE_FENCE_APPROVAL_REQUIRED');const receipt=JSON.parse(await fs.readFile(await checked(path.join(destination,'restore-receipt.json')),'utf8'));if(!receipt.restoreVerified||!receipt.quarantined)throw Error('RESTORE_RECEIPT_REQUIRED');
 const su=targetUrl(env.DATABASE_URL,p.sourceDatabase),tu=new URL(env.RESTORE_DATABASE_URL??'');if(!decodeURIComponent(tu.pathname.slice(1)).startsWith(p.restoreDatabasePrefix))throw Error('FRESH_OPERATIONAL_RESTORE_DATABASE_REQUIRED');if(fingerprint(su)!==receipt.sourceFingerprint||fingerprint(tu)!==receipt.targetFingerprint)throw Error('RESTORE_RECEIPT_TARGET_MISMATCH');
 const source=new Client({connectionString:su.toString()}),target=new Client({connectionString:tu.toString()});try{await source.connect();await quiesce(source);if(digest(canonical(await tableDigests(source)))!==receipt.tableDigest)throw Error('RESTORE_SOURCE_CHANGED_SINCE_BACKUP');await source.query('UPDATE nipt_restore_state SET quarantined=true');
  for(const r of receipt.outbound){if(!p.outboundRoots.some(x=>path.resolve(x.root)===path.resolve(r.root)))throw Error('BACKUP_OUTBOUND_ROOT_UNAUTHORIZED');for(const f of r.files){safeName(f.path);const original=path.join(r.root,...f.path.split('/')),restored=path.join(destination,r.id,...f.path.split('/'));if(await hashFile(restored)!==f.sha256)throw Error('RESTORE_ASSET_CHANGED');try{if(await hashFile(original)!==f.sha256)throw Error('RESTORE_OUTBOUND_COLLISION');}catch(e){if(e.code!=='ENOENT')throw e;await checked(original,{fresh:true});await fs.mkdir(path.dirname(original),{recursive:true});await fs.copyFile(restored,original,1);}}}
  await target.connect();await mode(target);if(digest(canonical(await tableDigests(target)))!==receipt.tableDigest)throw Error('RESTORE_DATABASE_CHANGED');const changed=await target.query('UPDATE nipt_restore_state SET quarantined=false WHERE restore_id=$1 AND verified AND source_fingerprint=$2',[receipt.restoreId,receipt.sourceFingerprint]);if(changed.rowCount!==1)throw Error('RESTORE_RECEIPT_TARGET_MISMATCH');receipt.activated=true;receipt.quarantined=false;await fs.writeFile(path.join(destination,'restore-receipt.json'),JSON.stringify(receipt),{mode:0o600});return {activated:true,sourceFenced:true,restoreId:receipt.restoreId};}finally{await source.end().catch(()=>{});await target.end().catch(()=>{});}
}
