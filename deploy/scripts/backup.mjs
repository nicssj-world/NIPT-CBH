import {operationalBackup} from './operational-backup.mjs';
import {execFileSync} from 'node:child_process';
import {createCipheriv,randomBytes} from 'node:crypto';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import {Client} from 'pg';
import {FORMAT,canonical,sha,checkedPath,disjoint,inventory,pack,p6Coverage,MAX_ARCHIVE_BYTES,checkSize,readBoundedFile} from './backup-format.mjs';

if(process.env.NIPT_MODE==='operational'){
 try{process.stdout.write(JSON.stringify(await (operationalBackup(process.argv[2]??process.env.BACKUP_DESTINATION)))+'\n');}catch(e){process.stderr.write((/^[A-Z0-9_]+$/.test(e.message)?e.message:'OPERATIONAL_RECOVERY_FAILED')+'\n');process.exitCode=1;}
}else{
if(process.env.NIPT_MODE!=='synthetic')throw Error('P1_SYNTHETIC_ONLY');
if(process.env.BACKUP_SOURCE_QUIESCENT!=='yes')throw Error('QUIESCENT_SYNTHETIC_SOURCE_REQUIRED');
const url=new URL(process.env.DATABASE_URL??'');
if(!['postgres:','postgresql:'].includes(url.protocol)||!['127.0.0.1','localhost','db'].includes(url.hostname)||!/^\/[a-z0-9_]*synthetic[a-z0-9_]*$/.test(url.pathname)||url.search||url.hash)throw Error('SYNTHETIC_DATABASE_REQUIRED');
const source=await checkedPath(process.env.FILE_STORE_ROOT??'data/files'),p6Root=await checkedPath(process.env.P6_SANDBOX_ROOT??'.local/p6-sandbox',{missing:true});
const output=await checkedPath(process.argv[2]??'backups',{missing:true});
const keyPath=await checkedPath(process.env.BACKUP_KEY_FILE??'');disjoint(source,p6Root,output,keyPath);
const key=await fs.readFile(keyPath);if(key.length!==32)throw Error('BACKUP_KEY_REQUIRED');
await fs.mkdir(output,{recursive:true});const stage=await fs.mkdtemp(path.join(output,'.staging-'));
const stamp=new Date().toISOString().replaceAll(/[:.]/g,'-'),base=path.join(output,`nipt-synthetic-${stamp}-${randomBytes(4).toString('hex')}`);
const db=new Client({connectionString:url.toString()});let complete=false;
try{
 await db.connect();await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ');await db.query("SET LOCAL lock_timeout='5s'");
 const tables=(await db.query("SELECT n.nspname schema,c.relname name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind IN ('r','p') AND n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' ORDER BY n.nspname,c.relname")).rows;
 const ident=s=>'"'+s.replaceAll('"','""')+'"';
 for(const t of tables)await db.query(`LOCK TABLE ${ident(t.schema)}.${ident(t.name)} IN SHARE MODE`);
 const snapshot=(await db.query('SELECT pg_export_snapshot() snapshot')).rows[0].snapshot;
 const p6=await p6Coverage(db),roots=[{prefix:'files',root:source},...p6.sandboxIds.map(id=>({prefix:'p6-sandbox/'+id,root:path.join(p6Root,id)}))];
 const before=[],budget={bytes:1024};
 for(const r of roots){const rows=await inventory(r.root,budget);if(r.prefix.startsWith('p6-sandbox/')){
   if((await fs.readFile(await checkedPath(path.join(r.root,'.p6-synthetic-root')),'utf8'))!=='NIPT_P6_SYNTHETIC_ONLY_V1\n')throw Error('BACKUP_P6_MARKER');
   if(rows.some(f=>f.path.startsWith('stage/')))throw Error('BACKUP_P6_NOT_DRAINED');
  }before.push(...rows.map(f=>({...f,path:r.prefix+'/'+f.path})));}
 const dump=path.join(stage,'database.dump'),pgDump=path.join(process.env.PG_BIN??'',process.platform==='win32'?'pg_dump.exe':'pg_dump');
 execFileSync(pgDump,['--format=custom','--snapshot',snapshot,'--file',dump],{env:{...process.env,PGHOST:url.hostname,PGPORT:url.port||'5432',PGUSER:decodeURIComponent(url.username),PGPASSWORD:decodeURIComponent(url.password),PGDATABASE:url.pathname.slice(1)},stdio:['ignore','ignore','pipe']});
 const dumpSize=(await fs.stat(dump)).size;checkSize(512+Math.ceil(dumpSize/512)*512,MAX_ARCHIVE_BYTES-budget.bytes);budget.bytes+=512+Math.ceil(dumpSize/512)*512;
 const entries=[{path:'database.dump',bytes:await readBoundedFile(dump,dumpSize)}];
 for(const r of roots)for(const f of before.filter(f=>f.path.startsWith(r.prefix+'/'))){const relative=f.path.slice(r.prefix.length+1),bytes=await readBoundedFile(await checkedPath(path.join(r.root,...relative.split('/'))),f.bytes);if(sha(bytes)!==f.sha256||bytes.length!==f.bytes)throw Error('BACKUP_SOURCE_CHANGED');entries.push({path:f.path,bytes});}
 const after=[],afterBudget={bytes:1024};for(const r of roots)after.push(...(await inventory(r.root,afterBudget)).map(f=>({...f,path:r.prefix+'/'+f.path})));
 if(canonical(before)!==canonical(after))throw Error('BACKUP_SOURCE_CHANGED');
 const files=entries.map(e=>({path:e.path,bytes:e.bytes.length,sha256:sha(e.bytes)})).sort((a,b)=>a.path.localeCompare(b.path,'en'));
 const manifest={format:FORMAT,syntheticOnly:true,consistency:'QUIESCENT_SOURCE',files,p6};
 const manifestBytes=Buffer.from(canonical(manifest));checkSize(512+Math.ceil(manifestBytes.length/512)*512,MAX_ARCHIVE_BYTES-budget.bytes);entries.push({path:'manifest.json',bytes:manifestBytes});
 const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from(FORMAT));
 const encrypted=Buffer.concat([cipher.update(pack(entries)),cipher.final()]);
 await fs.writeFile(base+'.enc',encrypted,{flag:'wx',mode:0o600});
 await fs.writeFile(base+'.json',JSON.stringify({format:FORMAT,iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),sha256:sha(encrypted),createdAt:new Date().toISOString()}),{flag:'wx',mode:0o600});
 await db.query('COMMIT');complete=true;process.stdout.write(JSON.stringify({backupBase:base,format:FORMAT,fileCount:files.length,encryptedBytes:encrypted.length})+'\n');
}finally{
 key.fill(0);await db.query('ROLLBACK').catch(()=>{});await db.end().catch(()=>{});await fs.rm(stage,{recursive:true,force:true});
 if(!complete){await fs.rm(base+'.enc',{force:true});await fs.rm(base+'.json',{force:true});}
}

}
