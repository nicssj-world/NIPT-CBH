import {execFileSync} from 'node:child_process';
import {createCipheriv,randomBytes,createHash} from 'node:crypto';
import {createReadStream,createWriteStream} from 'node:fs';
import {readFile,writeFile,mkdir,mkdtemp,cp,rm,readdir} from 'node:fs/promises';
import {pipeline} from 'node:stream/promises';
import path from 'node:path';
if(process.env.NIPT_MODE!=='synthetic')throw Error('P1_SYNTHETIC_ONLY');
const url=new URL(process.env.DATABASE_URL??'');if(!['127.0.0.1','localhost','db'].includes(url.hostname)||!url.pathname.includes('synthetic'))throw Error('SYNTHETIC_DATABASE_REQUIRED');
const key=await readFile(process.env.BACKUP_KEY_FILE??'');if(key.length!==32)throw Error('BACKUP_KEY_REQUIRED');
const output=path.resolve(process.argv[2]??'backups');await mkdir(output,{recursive:true});const stage=await mkdtemp(path.join(output,'.staging-'));const stamp=new Date().toISOString().replaceAll(/[:.]/g,'-'),base=path.join(output,`nipt-synthetic-${stamp}`);
const pgEnv={...process.env,PGHOST:url.hostname,PGPORT:url.port||'5432',PGUSER:decodeURIComponent(url.username),PGPASSWORD:decodeURIComponent(url.password),PGDATABASE:url.pathname.slice(1)};
const pgDump=path.join(process.env.PG_BIN??'',process.platform==='win32'?'pg_dump.exe':'pg_dump');
try{execFileSync(pgDump,['--format=custom','--file',path.join(stage,'database.dump')],{env:pgEnv,stdio:['ignore','ignore','pipe']});await cp(path.resolve(process.env.FILE_STORE_ROOT??'data/files'),path.join(stage,'files'),{recursive:true,errorOnExist:true,force:false});
 async function noLinks(dir){for(const e of await readdir(dir,{withFileTypes:true})){if(e.isSymbolicLink())throw Error('BACKUP_SYMLINK');if(e.isDirectory())await noLinks(path.join(dir,e.name));}}await noLinks(stage);
 const archive=path.join(stage,'payload.tar');execFileSync('tar',['-cf',archive,'-C',stage,'database.dump','files']);const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from('NIPT_SYNTHETIC_BACKUP_V1'));await pipeline(createReadStream(archive),cipher,createWriteStream(base+'.enc',{flags:'wx',mode:0o600}));const hash=createHash('sha256');for await(const c of createReadStream(base+'.enc'))hash.update(c);await writeFile(base+'.json',JSON.stringify({format:'NIPT_SYNTHETIC_BACKUP_V1',iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),sha256:hash.digest('hex'),createdAt:new Date().toISOString()}),{flag:'wx'});process.stdout.write('Encrypted synthetic DB/files backup created; keys excluded.\n');
}finally{key.fill(0);await rm(stage,{recursive:true,force:true});}
