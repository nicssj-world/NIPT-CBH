/** Focused P8 native operations additions; retains every new synthetic DB and evidence directory. */
import {Client,escapeIdentifier} from 'pg';
import {randomUUID,randomBytes} from 'node:crypto';
import {execFile,spawn,type ChildProcess} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,readFile,writeFile,cp,readdir,unlink} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {assertRehearsalTarget,operatorHealth} from './health';
import {migrate} from '../migrate';
import {appendAudit} from '../../packages/db/audit';
import {FileStore} from '../../packages/storage';
import {inventory} from '../../deploy/scripts/backup-format.mjs';
const execute=promisify(execFile),raw=process.env.NIPT_P8_OPS_URL??'';
assertRehearsalTarget(raw,process.env.NIPT_MODE);
const id=randomUUID().replaceAll('-',''),root=path.resolve('.local/p8/operations-'+id),sourceName='nipt_p8_synthetic_ops_'+id,restoreName='nipt_synthetic_restore_p8_'+id;
const adminUrl=new URL(raw),urlFor=(name:string,user=adminUrl.username)=>{const u=new URL(adminUrl);u.pathname='/'+name;u.username=user;return u.toString();};
await mkdir(root,{recursive:true});const key=path.join(root,'backup.key');await writeFile(key,randomBytes(32),{flag:'wx',mode:0o600});
const admin=new Client({connectionString:raw});await admin.connect();await admin.query('CREATE DATABASE '+escapeIdentifier(sourceName));await admin.query('CREATE DATABASE '+escapeIdentifier(restoreName));
const db=new Client({connectionString:urlFor(sourceName)}),restored=new Client({connectionString:urlFor(restoreName)});await db.connect();await restored.connect();
const env={...process.env,NIPT_MODE:'synthetic',DATABASE_URL:urlFor(sourceName),FILE_STORE_ROOT:path.join(root,'files'),BACKUP_KEY_FILE:key,BACKUP_SOURCE_QUIESCENT:'yes',RESTORE_TO_NEW_SYNTHETIC_DATABASE:'yes',RESTORE_DATABASE_URL:urlFor(restoreName),PG_BIN:process.env.PG_BIN??'C:\\Program Files\\pgsql\\bin'};
const script=(file:string,args:string[]=[],extra:Record<string,string|undefined>={})=>execute(process.execPath,[...(file.endsWith('.ts')?['--import','tsx']:[]),file,...args],{env:{...env,...extra},maxBuffer:1024*1024});
const wait=async<T>(probe:()=>Promise<T|undefined>,label:string,timeout=45000)=>{const until=Date.now()+timeout;while(Date.now()<until){const value=await probe();if(value!==undefined)return value;await new Promise(r=>setTimeout(r,200));}throw Error(label);};
let worker:Awaited<ReturnType<typeof import('../../packages/jobs/worker').startWorker>>|undefined,renderer:Awaited<ReturnType<typeof import('../../apps/renderer/main').startRenderer>>|undefined,child:ChildProcess|undefined;
try{
 const startup=performance.now();await script('tools/prepare-db.ts');const startupMs=performance.now()-startup;
 const initial=await operatorHealth(db);assert.equal(initial.workerAlive,false);assert.equal(initial.inboundEnabled,false);assert.equal(initial.technicalReady,false);
 const ledgerBefore=(await db.query('SELECT name,checksum FROM schema_migration ORDER BY name')).rows;await migrate(db);assert.deepEqual((await db.query('SELECT name,checksum FROM schema_migration ORDER BY name')).rows,ledgerBefore);
 const migrationCopy=path.join(root,'migration-probe');await cp('db/migrations',migrationCopy,{recursive:true});
 const first=(await readdir(migrationCopy)).filter(f=>/^\d+.*\.sql$/.test(f)).sort()[0],firstSql=await readFile(path.join(migrationCopy,first),'utf8');await writeFile(path.join(migrationCopy,first),firstSql+'\n-- SYNTHETIC P8 DRIFT PROBE\n');await assert.rejects(migrate(db,migrationCopy),/Migration checksum mismatch/);await writeFile(path.join(migrationCopy,first),firstSql);
 await writeFile(path.join(migrationCopy,'999_p8_failed_probe.sql'),'CREATE TABLE p8_failed_transaction_probe(id integer); SELECT p8_intentionally_missing_function();');await assert.rejects(migrate(db,migrationCopy),/does not exist/);assert.equal((await db.query("SELECT to_regclass('public.p8_failed_transaction_probe') name")).rows[0].name,null);assert.deepEqual((await db.query('SELECT name,checksum FROM schema_migration ORDER BY name')).rows,ledgerBefore);await unlink(path.join(migrationCopy,'999_p8_failed_probe.sql'));
 const roleChecks=[];for(const user of ['nipt_web','nipt_worker']){const c=new Client({connectionString:urlFor(sourceName,user)});await c.connect();try{const r=(await c.query('SELECT current_user username,current_setting(\'is_superuser\') superuser')).rows[0];assert.equal(r.username,user);assert.equal(r.superuser,'off');for(const sql of ["INSERT INTO result_release DEFAULT VALUES","UPDATE audit_chain SET payload=payload","CREATE TABLE public.p8_forbidden_ddl(id integer)"]){await assert.rejects(c.query(sql),(e:unknown)=>(e as {code:string}).code==='42501');}roleChecks.push({login:user,notSuperuser:true,releaseWriteDenied:true,auditRewriteDenied:true,ddlDenied:true});}finally{await c.end();}}
 // The real worker connects as the reviewed login, not the migration owner.
 Object.assign(process.env,env,{DATABASE_URL:urlFor(sourceName,'nipt_worker'),RENDERER_PORT:'3301',RENDERER_HOST:'127.0.0.1',RENDERER_URL:'http://127.0.0.1:3301',RENDERER_TOKEN_FILE:path.resolve('data/keys/renderer-token')});delete process.env.NIPT_P6_SANDBOX_ENABLED;
 const {startWorker}=await import('../../packages/jobs/worker'),{startRenderer}=await import('../../apps/renderer/main'),{pool}=await import('../../packages/db/connection');
 const queue=async(label:string)=>(await db.query("INSERT INTO job_outbox(kind,payload,idempotency_key) VALUES('synthetic_pdf',$1,$2) RETURNING id",[{synthetic:true,reference:'SYNTHETIC-P8-OPS-'+label,label:'ทดสอบกู้คืนงานจำลอง'},'SYNTHETIC-P8-'+label+'-'+id])).rows[0].id as string;
 const failedId=await queue('RETRY');child=spawn(process.execPath,['--import','tsx','apps/worker/main.ts'],{env:process.env,stdio:'ignore',windowsHide:true});
 await wait(async()=>{const h=await operatorHealth(db);return h.workerAlive&&h.workerError?true:undefined;},'RENDERER_FAILURE_NOT_OBSERVED');
 assert.equal((await db.query('SELECT count(*)::int n FROM integration_job_receipt WHERE outbox_id=$1',[failedId])).rows[0].n,0);
 const failureHealth=await operatorHealth(db);assert.equal(failureHealth.workerAlive,true);assert.equal(failureHealth.workerError,true);assert.equal(failureHealth.technicalReady,false);
 const killedPid=child.pid;assert(killedPid);const exited=new Promise<void>(r=>child!.once('exit',()=>r()));assert.equal(child.kill('SIGKILL'),true);await exited;child=undefined;
 const pendingId=await queue('PENDING');assert.equal((await db.query('SELECT state FROM job_outbox WHERE id=$1',[pendingId])).rows[0].state,'Pending');
 renderer=await startRenderer();const recoveryStart=performance.now();worker=await startWorker();
 const receipts=await wait(async()=>{const r=(await db.query('SELECT outbox_id,result FROM integration_job_receipt WHERE outbox_id=ANY($1::uuid[]) ORDER BY outbox_id',[[failedId,pendingId]])).rows;return r.length===2?r:undefined;},'DURABLE_RECOVERY_NOT_COMPLETED');const recoveryMs=performance.now()-recoveryStart;
 const store=new FileStore(env.FILE_STORE_ROOT);for(const r of receipts){const bytes=await store.get(r.result.assetHash);assert.equal(bytes.subarray(0,5).toString(),'%PDF-');}
 await wait(async()=>{const h=await operatorHealth(db);return h.technicalReady?h:undefined;},'RECOVERY_HEALTH_NOT_READY');
 await worker.stop();worker=await startWorker();await worker.cycle();await new Promise(r=>setTimeout(r,1500));assert.deepEqual((await db.query('SELECT outbox_id,result FROM integration_job_receipt WHERE outbox_id=ANY($1::uuid[]) ORDER BY outbox_id',[[failedId,pendingId]])).rows,receipts);
 const restartIdleHealth=await operatorHealth(db);assert.equal(restartIdleHealth.workerAlive,true);assert.equal(restartIdleHealth.technicalReady,false);
 const freshId=await queue('POSTRESTART');await worker.cycle();await wait(async()=>{const r=(await db.query('SELECT outbox_id,result FROM integration_job_receipt WHERE outbox_id=$1',[freshId])).rows[0];return r||undefined;},'POST_RESTART_SMOKE_MISSING');
 receipts.splice(0,receipts.length,...(await db.query('SELECT outbox_id,result FROM integration_job_receipt ORDER BY outbox_id')).rows);assert.equal(receipts.length,3);
 const healthy=await wait(async()=>{const h=await operatorHealth(db);return h.technicalReady?h:undefined;},'POST_RESTART_HEALTH_NOT_READY');assert.equal(healthy.clinicalAuthority,false);assert.equal(healthy.releaseRows,0);await worker.stop();worker=undefined;await pool().end();await new Promise<void>((r,j)=>renderer!.close(e=>e?j(e):r()));renderer=undefined;
 await db.query('BEGIN');await appendAudit(db,{action:'P8_OPERATIONS_REHEARSAL',resourceType:'SYNTHETIC_OPERATIONS',details:{synthetic:true,count:2}});await db.query('COMMIT');
 const barrierAt=new Date().toISOString(),backupStart=performance.now();const backup=JSON.parse((await script('deploy/scripts/backup.mjs',[path.join(root,'backups')])).stdout);const backupMs=performance.now()-backupStart;
 const restoreStart=performance.now(),restoredFiles=path.join(root,'restored-files');await script('deploy/scripts/restore.mjs',[backup.backupBase,restoredFiles,path.join(root,'restored-p6-archive')]);const restoreMs=performance.now()-restoreStart;
 assert.deepEqual((await restored.query('SELECT outbox_id,result FROM integration_job_receipt ORDER BY outbox_id')).rows,receipts);assert.deepEqual((await restored.query('SELECT name,checksum FROM schema_migration ORDER BY name')).rows,ledgerBefore);assert.deepEqual(await inventory(restoredFiles),await inventory(env.FILE_STORE_ROOT));
 // Reapply reviewed roles as required by no-owner/no-acl restoration, without activating restored runtime.
 await restored.query(await readFile('packages/db/roles.sql','utf8'));await restored.query(await readFile('packages/p6/grants.sql','utf8'));const restoredHealth=await operatorHealth(restored);assert.equal(restoredHealth.auditValid,true);assert.equal(restoredHealth.migrationsMatch,true);assert.equal(restoredHealth.clinicalAuthority,false);assert.equal(restoredHealth.releaseRows,0);assert.equal(restoredHealth.rolesRestricted,true);
 const report={format:'NIPT_P8_OPERATIONS_REHEARSAL_V1',syntheticOnly:true,sourceName,restoreName,postgres:(await db.query('SHOW server_version')).rows[0].server_version,startupMs,recoveryMs,backupMs,restoreMs,barrierAt,observedRpo:{lostCommittedJobReceipts:0,sourceQuiescent:true,hospitalThresholdAccepted:false},migrationCount:ledgerBefore.length,migrationIdempotent:true,changedMigrationRejected:true,failedMigrationRolledBack:true,roleChecks,rendererFailureObserved:true,workerStoppedThenRestarted:true,ownedWorkerPidKilled:killedPid,unexpectedProcessTermination:true,durableRetryRecovered:true,pendingJobRecovered:true,receiptCount:receipts.length,repeatedRestartDuplicateReceipts:0,pdfHashesVerified:true,receiptLedgerAssetRestoreEqual:true,initialHealth:initial,failureHealth,restartIdleHealth,healthy,restoredHealth,clinicalAcceptance:false,hospitalOperationalAcceptance:false,limitations:['No mid-render host crash or power loss; owned worker process kill after recorded retry only','No hospital RPO/RTO threshold supplied','Restored runtime not activated; retained isolated evidence only','P7 full recovery matrix reused; no repeat','Native loopback observation; final signed Compose rehearsal is separate']};
 await writeFile(path.join(root,'report.json'),JSON.stringify(report,null,2));process.stdout.write(JSON.stringify({report:path.join(root,'report.json'),startupMs,recoveryMs,backupMs,restoreMs,receiptCount:receipts.length})+'\n');
}finally{if(child){child.kill('SIGKILL');}await worker?.stop();if(renderer)await new Promise<void>((r,j)=>renderer!.close(e=>e?j(e):r()));await db.end();await restored.end();await admin.end();}
