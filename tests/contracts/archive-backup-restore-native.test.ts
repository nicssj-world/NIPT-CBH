import {it,expect} from 'vitest';
import {Client} from 'pg';
import {randomBytes,createHash,randomUUID} from 'node:crypto';
import {mkdtemp,readFile,rm,cp,mkdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {migrate} from '../../tools/migrate';
import {assertSyntheticDatabase} from '../../packages/db/connection';
import {FileStore} from '../../packages/storage';

it.skipIf(!process.env.NIPT_TEST_DATABASE_URL)('isolated native pg_dump and pg_restore preserve archive schema, checksum, user and FileStore bytes',async()=>{
 const baseUrl=new URL(process.env.NIPT_TEST_DATABASE_URL!);assertSyntheticDatabase(baseUrl.toString());
 const root=await mkdtemp(path.join(os.tmpdir(),'nipt-112-dr-synthetic-'));
 const pgBin=['C:/Program Files/pgsql','C:/Program Files/PostgreSQL/17'].map(v=>path.join(v,'bin'))
  .find(b=>requireBinary(path.join(b,'pg_dump.exe'))&&requireBinary(path.join(b,'pg_restore.exe')));
 if(!pgBin)throw Error('SYNTHETIC_PG_BACKUP_BINARIES_UNAVAILABLE');
 const suffix=randomBytes(4).toString('hex'),srcName='nipt_synthetic_dr_source_'+suffix,dstName='nipt_synthetic_dr_restore_'+suffix;
 const server=new URL(baseUrl);server.pathname='/postgres';
 const admin=new Client({connectionString:server.toString()});await admin.connect();
 const source=new URL(baseUrl),target=new URL(baseUrl);source.pathname='/'+srcName;target.pathname='/'+dstName;
 let src:Client|null=null,dst:Client|null=null;
 const run=(exe:string,args:string[])=>{
  const r=spawnSync(exe,args,{encoding:'utf8',windowsHide:true,timeout:30000,stdio:['ignore','pipe','pipe']});
  if(r.status!==0||r.error)throw Error('SYNTHETIC_DR_COMMAND_FAILED_'+path.basename(exe));
 };
 try{
  await admin.query('CREATE DATABASE '+srcName);await admin.query('CREATE DATABASE '+dstName);
  assertSyntheticDatabase(source.toString());assertSyntheticDatabase(target.toString());
  src=new Client({connectionString:source.toString()});await src.connect();await migrate(src);
  const actor=randomUUID(),bytes=Buffer.from('%PDF-1.7 SYNTHETIC BACKUP RESTORE');
  const original=new FileStore(path.join(root,'original'));
  const sha=await original.put(bytes);
  await src.query("INSERT INTO app_user(id,username,display_name,password_hash) VALUES($1,$2,'Synthetic','$argon2id$v=19$synthetic')",[actor,'synthetic.backup.'+suffix]);
  await src.query("INSERT INTO file_asset(sha256,byte_size,media_type,storage_key) VALUES($1,$2,'application/pdf',$1)",[sha,bytes.length]);
  const migrationCount=Number((await src.query('SELECT count(*)::int c FROM schema_migration')).rows[0].c);
  const dump=path.join(root,'database.dump');
  run(path.join(pgBin,'pg_dump.exe'),['--format=custom','--file',dump,'--dbname',source.toString()]);
  const archiveHash=createHash('sha256').update(await readFile(dump)).digest('hex');
  expect(archiveHash).toMatch(/^[0-9a-f]{64}$/);
  const copyRoot=path.join(root,'restored-files');await mkdir(copyRoot);
  await cp(path.join(root,'original'),copyRoot,{recursive:true});
  run(path.join(pgBin,'pg_restore.exe'),['--no-owner','--dbname',target.toString(),dump]);
  dst=new Client({connectionString:target.toString()});await dst.connect();
  expect(Number((await dst.query('SELECT count(*)::int c FROM schema_migration')).rows[0].c)).toBe(migrationCount);
  expect((await dst.query('SELECT id FROM app_user WHERE id=$1',[actor])).rows).toHaveLength(1);
  expect((await dst.query('SELECT sha256,byte_size::int byte_size FROM file_asset WHERE sha256=$1',[sha])).rows).toEqual([{sha256:sha,byte_size:bytes.length}]);
  const restored=new FileStore(copyRoot);
  const recovered=await restored.get(sha);
  expect(createHash('sha256').update(recovered).digest('hex')).toBe(sha);
  expect(recovered).toEqual(bytes);
  expect((await dst.query('SELECT enabled FROM pdf_archive_config WHERE singleton')).rows).toEqual([{enabled:false}]);
 }finally{
  await src?.end();await dst?.end();
  for(const name of [srcName,dstName]){
   try{await admin.query('DROP DATABASE IF EXISTS '+name);}catch{}
  }
  await admin.end();
  if(path.basename(root).startsWith('nipt-112-dr-synthetic-'))await rm(root,{recursive:true,force:true});
 }
},120000);
function requireBinary(file:string){return existsSync(file);}
