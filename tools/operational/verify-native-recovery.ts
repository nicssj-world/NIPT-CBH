/** Isolated native verification; reuses existing tests and legacy synthetic backup entry points. */
import * as fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import {execFileSync,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomBytes,createHash} from 'node:crypto';
import {Pool} from 'pg';
import {PgBoss} from 'pg-boss';
import {restoreQueueAccess} from '../../deploy/scripts/operational-backup.mjs';
import assert from 'node:assert/strict';
import {migrate} from '../migrate';
import {registerCase} from '../../packages/db/registration';
import {FileStore} from '../../packages/storage';
import {operatorHealth} from '../p8/health';
const bin=process.env.NIPT_OPERATIONAL_TEST_PG_BIN;if(!bin)throw Error('EXISTING_POSTGRES_BIN_REQUIRED');
const base=await fs.mkdtemp(path.resolve('.local/final-native-')),pgdata=path.join(base,'pgdata');
const port=await new Promise<number>(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=(s.address() as net.AddressInfo).port;s.close(()=>resolve(p));});});
const pg=(name:string,args:string[])=>execFileSync(path.join(bin,name+(process.platform==='win32'?'.exe':'')),args,{stdio:'ignore',windowsHide:true});
const url=(name:string)=>`postgresql://nipt_test_owner@127.0.0.1:${port}/${name}`;
pg('initdb',['-D',pgdata,'-U','nipt_test_owner','-A','trust','--no-locale','-E','UTF8']);pg('pg_ctl',['-D',pgdata,'-l',path.join(base,'postgres.log'),'-o',`-p ${port} -h 127.0.0.1`,'-w','start']);
const admin=new Pool({connectionString:url('postgres')}),events:string[]=[];
let operationalChecksumUpgrade:Record<string,unknown>|null=null;
const lookup=path.join(base,'lookup.key'),backupKey=path.join(base,'backup.key');await fs.writeFile(lookup,randomBytes(32));await fs.writeFile(backupKey,randomBytes(32));
const webPassword=path.join(base,'web-password'),workerPassword=path.join(base,'worker-password');await fs.writeFile(webPassword,randomBytes(24).toString('hex'));await fs.writeFile(workerPassword,randomBytes(24).toString('hex'));
const env={...process.env,NIPT_MODE:'synthetic',PG_BIN:bin,DATABASE_URL:url('nipt_synthetic_test_final'),NIPT_TEST_DATABASE_URL:url('nipt_synthetic_test_final'),NIPT_P6_NATIVE_URL:url('nipt_p6_synthetic_final'),NIPT_P7_NATIVE_URL:url('nipt_synthetic_test_final'),FILE_STORE_ROOT:path.join(base,'files'),SIMULATOR_ROOT:path.join(base,'simulator'),IDENTITY_LOOKUP_KEY_FILE:lookup,BACKUP_KEY_FILE:backupKey,SYNTHETIC_SEED_PASSWORD:randomBytes(24).toString('hex'),WEB_DB_PASSWORD_FILE:webPassword,WORKER_DB_PASSWORD_FILE:workerPassword};
async function run(name:string,args:string[],overrides:Partial<NodeJS.ProcessEnv>={}){try{const r=await promisify(execFile)(process.execPath,args,{env:{...env,...overrides},windowsHide:true,maxBuffer:16*1024*1024,timeout:600000});await fs.writeFile(path.join(base,name+'.log'),r.stdout+r.stderr);return r.stdout;}catch(e){const failure=e as {stdout?:string;stderr?:string};await fs.writeFile(path.join(base,name+'.log'),(failure.stdout??'')+(failure.stderr??''));throw e;}}
try{
 await admin.query('CREATE DATABASE nipt_synthetic_test_final');await admin.query('CREATE DATABASE nipt_p6_synthetic_final');
 await run('prepare',['--import','tsx','tools/prepare-db.ts']);await run('seed',['--import','tsx','tools/seed.ts']);
 const baseline=process.env.NIPT_OPERATIONAL_BASELINE_WORKTREE;
 if(baseline&&!process.argv.includes('--focused-p3')){
  const baselineHead=execFileSync('git',['-C',baseline,'rev-parse','HEAD'],{encoding:'utf8'}).trim();assert.equal(baselineHead,'dd547e7b80c106bb0173202ec9bef7283b481ad8');assert.equal(execFileSync('git',['-C',baseline,'status','--porcelain'],{encoding:'utf8'}).trim(),'');
  const historicalDirectory=path.join(baseline,'db/migrations'),names=(await fs.readdir('db/migrations')).filter(n=>n.endsWith('.sql')).sort(),differences=[];
  assert.deepEqual((await fs.readdir(historicalDirectory)).filter(n=>n.endsWith('.sql')).sort(),names);
  for(const name of names){const old=await fs.readFile(path.join(historicalDirectory,name)),current=await fs.readFile(path.join('db/migrations',name));assert.equal(old.toString().replace(/\r\n/g,'\n'),current.toString());if(!old.equals(current))differences.push({name,historical:createHash('sha256').update(old).digest('hex'),canonical:createHash('sha256').update(current).digest('hex')});}
  assert.deepEqual(differences.map(d=>d.name),['084_operational_runtime.sql','086_operational_lab_results.sql','088_p2_operational_clinical_review.sql','092_native_controlled_documents.sql','094_owner_three_sheet_master.sql']);
  await admin.query('CREATE DATABASE nipt_synthetic_operational_checksum_upgrade');const historical=new Pool({connectionString:url('nipt_synthetic_operational_checksum_upgrade')});
  try{
   await migrate(historical,historicalDirectory);
   const client=await historical.connect();try{await client.query('BEGIN');await registerCase(client,{ln:'990000000778',identityKey:'b'.repeat(64),origin:'ANC',idempotencyKey:'LOCAL_HISTORICAL_OPERATIONAL_CHECKSUM_UPGRADE'});await client.query('COMMIT');}finally{client.release();}
   const snapshot=async()=>({ledger:(await historical.query('SELECT * FROM schema_migration ORDER BY name')).rows,cases:(await historical.query('SELECT * FROM nipt_case ORDER BY id')).rows,rounds:(await historical.query('SELECT * FROM specimen_round ORDER BY id')).rows,audit:(await historical.query('SELECT * FROM audit_chain ORDER BY sequence')).rows});const before=await snapshot();
   for(const difference of differences)assert.equal(before.ledger.find(row=>row.name===difference.name)?.checksum,difference.historical);
   await migrate(historical);await migrate(historical);assert.deepEqual(await snapshot(),before);
   const health=await operatorHealth(historical);assert.equal(health.migrationsMatch,true);assert.equal(health.auditValid,true);
   operationalChecksumUpgrade={baseline,baselineHead,differences,ledgerRows:before.ledger.length,ledgerAndExistingCaseRoundAuditUnchanged:true,reappliedTwice:true,migrationsMatch:health.migrationsMatch,auditValid:health.auditValid};events.push('ACTUAL_OPERATIONAL_BASELINE_CHECKSUM_UPGRADE_NO_LEDGER_CASE_ROUND_AUDIT_REWRITE');
  }finally{await historical.end();}
 }
 if(!process.argv.includes('--focused-p3')){
 // A populated P8-era database, with unchanged historical migration bytes.
 const old=path.join(base,'p8-migrations');await fs.mkdir(old);const names=execFileSync('git',['ls-tree','--name-only','7967cd5:db/migrations'],{encoding:'utf8'}).trim().split('\n');
 for(const n of names){const bytes=execFileSync('git',['show','7967cd5:db/migrations/'+n]);assert.equal(createHash('sha256').update(bytes).digest('hex'),createHash('sha256').update(await fs.readFile('db/migrations/'+n)).digest('hex'));await fs.writeFile(path.join(old,n),bytes);}
 await admin.query('CREATE DATABASE nipt_synthetic_p8_upgrade');const upgraded=new Pool({connectionString:url('nipt_synthetic_p8_upgrade')});
 try{await migrate(upgraded,old);const client=await upgraded.connect();try{await client.query('BEGIN');await registerCase(client,{ln:'990000000777',identityKey:'a'.repeat(64),origin:'ANC',idempotencyKey:'LOCAL_P8_UPGRADE_EXISTING_CASE'});await client.query('COMMIT');}finally{client.release();}
  const files=path.join(base,'upgrade-files'),store=new FileStore(files),bytes=Buffer.from('LOCAL TEST P8 EXISTING DOCUMENT'),hash=await store.put(bytes);await upgraded.query("INSERT INTO file_asset(sha256,byte_size,media_type,storage_key) VALUES($1,$2,'text/plain',$3)",[hash,bytes.length,`sha256/${hash.slice(0,2)}/${hash.slice(2,4)}/${hash}`]);
  const oldQueue=new PgBoss(url('nipt_synthetic_p8_upgrade'));await oldQueue.start();await oldQueue.stop();
  const snapshot=async()=>({cases:(await upgraded.query('SELECT * FROM nipt_case ORDER BY id')).rows,rounds:(await upgraded.query('SELECT * FROM specimen_round ORDER BY id')).rows,audit:(await upgraded.query('SELECT * FROM audit_chain ORDER BY sequence')).rows,assets:(await upgraded.query('SELECT * FROM file_asset ORDER BY id')).rows});const before=await snapshot();
  await migrate(upgraded);await migrate(upgraded);await upgraded.query(await fs.readFile('packages/db/roles.sql','utf8'));await restoreQueueAccess(upgraded);assert.deepEqual(await snapshot(),before);events.push('POPULATED_P8_UPGRADE_REAPPLY_EXISTING_CASE_ROUND_AUDIT_ASSET_PRESERVED');
  const out=await run('p8-upgrade-backup',['deploy/scripts/backup.mjs',path.join(base,'upgrade-backups')],{DATABASE_URL:url('nipt_synthetic_p8_upgrade'),FILE_STORE_ROOT:files,P6_SANDBOX_ROOT:path.join(base,'empty-p6'),BACKUP_SOURCE_QUIESCENT:'yes'});const backup=JSON.parse(out.trim());
  await admin.query('CREATE DATABASE nipt_synthetic_restore_upgrade');await run('p8-upgrade-restore',['deploy/scripts/restore.mjs',backup.backupBase,path.join(base,'upgrade-restored-files')],{RESTORE_DATABASE_URL:url('nipt_synthetic_restore_upgrade'),RESTORE_TO_NEW_SYNTHETIC_DATABASE:'yes'});
  const restored=new Pool({connectionString:url('nipt_synthetic_restore_upgrade')});try{await migrate(restored);assert.deepEqual((await restored.query('SELECT * FROM nipt_case ORDER BY id')).rows,before.cases);assert.deepEqual((await restored.query('SELECT * FROM audit_chain ORDER BY sequence')).rows,before.audit);assert.deepEqual(await new FileStore(path.join(base,'upgrade-restored-files')).get(hash),bytes);const acl=(await restored.query("SELECT coalesce(bool_or(a.grantee=0 AND a.privilege_type='EXECUTE'),false) public_execute FROM pg_proc p LEFT JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a ON true WHERE p.oid='nipt_runtime_quarantined()'::regprocedure")).rows[0];assert.equal(acl.public_execute,false);const workerUrl=new URL(url('nipt_synthetic_restore_upgrade'));workerUrl.username='nipt_worker';workerUrl.password=(await fs.readFile(workerPassword,'utf8')).trim();await run('p8-upgrade-restored-worker',['--import','tsx','tools/his-simulator/smoke-worker.ts'],{DATABASE_URL:workerUrl.toString(),FILE_STORE_ROOT:path.join(base,'upgrade-restored-files')});}finally{await restored.end();}events.push('P8_UPGRADE_SYNTHETIC_BACKUP_RESTORE_HASH_HISTORY_REAPPLY_WORKER_QUEUE_ACL');
 }finally{await upgraded.end();}
 }
 if(!process.argv.includes('--focused-upgrade'))await run('native-tests',['node_modules/vitest/vitest.mjs','run',...(process.argv.includes('--focused-p3')?['tests/contracts/p3-native.test.ts']:['tests/contracts','tests/db/concurrency.test.ts'])]);events.push('NATIVE_TESTS_EXECUTED');
 await fs.writeFile(path.join(base,'evidence.json'),JSON.stringify({head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),timestamp:new Date().toISOString(),operationalChecksumUpgrade,events},null,2));process.stdout.write(base+'\n');
}finally{await admin.end();pg('pg_ctl',['-D',pgdata,'-m','immediate','-w','stop']);}
