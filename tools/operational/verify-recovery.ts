/** Recovery continuation of the disposable positive journey, using its actual workflow data. */
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {execFileSync,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import type {Pool} from 'pg';
import {Pool as Database} from 'pg';
import {operationalBackup,operationalRestore,activateRestored} from '../../deploy/scripts/operational-backup.mjs';
import {assertDatabaseMode} from '../../packages/db/connection';
import {migrate} from '../migrate';
import {operatorHealth} from '../p8/health';
import {PgBoss} from 'pg-boss';
import {activeHis} from '../../packages/settings/his';
import {createHash} from 'node:crypto';
type Context={db:Pool;base:string;ownerUrl:string;env:NodeJS.ProcessEnv;stopWriters:()=>Promise<void>;restart:(env:NodeJS.ProcessEnv)=>Promise<void>;waitFor:(fn:()=>Promise<boolean>,label:string,timeout?:number)=>Promise<void>;events:string[]};
export async function verifyOperationalRecovery(c:Context){
 const {db,base,ownerUrl,env,events,waitFor}=c;
 const account=process.platform==='win32'?execFileSync(path.join(process.env.SystemRoot??'C:/Windows','System32/whoami.exe'),[],{encoding:'utf8',windowsHide:true}).trim():process.env.USER;
 const backupRoot=path.join(base,'backups'),restoreRoot=path.join(base,'restores'),policy=path.join(base,'backup-policy.json'),key=path.join(base,'backup.key');
 const outboundRoots=['res','pdf','backup'].map(n=>({root:path.join(base,'outbound',n)}));
 await fs.writeFile(policy,JSON.stringify({version:1,serviceAccount:account,sourceDatabase:'nipt_operational_test',backupRoot,restoreRoot,restoreDatabasePrefix:'nipt_operational_restore_',outboundRoots}));await fs.writeFile(key,randomBytes(32));
 const recovery:NodeJS.ProcessEnv={...env,DATABASE_URL:ownerUrl,PG_BIN:process.env.NIPT_OPERATIONAL_TEST_PG_BIN,NIPT_BACKUP_POLICY_FILE:policy,BACKUP_KEY_FILE:key,BACKUP_SOURCE_QUIESCENT:'yes',RESTORE_TO_NEW_OPERATIONAL_DATABASE:'yes',RESTORE_SOURCE_FENCED:'yes'};
 await assert.rejects(operationalBackup(backupRoot,recovery),/WORKER_OR_WRITER_NOT_QUIESCENT/);events.push('LIVE_WORKER_BACKUP_REJECTED');
 await waitFor(async()=>!(await db.query("SELECT 1 FROM pgboss.job WHERE state='active' LIMIT 1")).rowCount,'QUEUE_DRAIN');
 await c.stopWriters();
 // Deliberately pending application work must survive the snapshot and be completed once by the restored Worker.
 const cfg=await activeHis(db,'his_inbound'),pendingJob=(await db.query("INSERT INTO job_outbox(kind,payload,idempotency_key) VALUES('synthetic_scan',$1,$2) RETURNING id",[{trigger:'MANUAL',configurationId:cfg.id},'LOCAL_RESTORE_PENDING_'+randomUUID()])).rows[0].id;
 assert.equal((await db.query('SELECT count(*)::int n FROM integration_job_receipt WHERE outbox_id=$1',[pendingJob])).rows[0].n,0);events.push('PENDING_WORK_INCLUDED_IN_QUIESCENT_BACKUP');
 const backup=await operationalBackup(backupRoot,recovery);events.push('QUIESCENT_OPERATIONAL_ENCRYPTED_BACKUP');
 const database='nipt_operational_restore_'+randomUUID().replaceAll('-','');await db.query('CREATE DATABASE '+database);
 const restoreUrl=new URL(ownerUrl);restoreUrl.pathname='/'+database;recovery.RESTORE_DATABASE_URL=restoreUrl.toString();
 const destination=path.join(restoreRoot,'verified');const receipt=await operationalRestore(backup.backupBase,destination,recovery);
 const restored=new Database({connectionString:restoreUrl.toString()});
 try{await migrate(restored);await assert.rejects(assertDatabaseMode(restored),/RESTORED_RUNTIME_QUARANTINED/);
  const roles=(await restored.query("SELECT has_table_privilege('app_rw','nipt_restore_state','UPDATE') app,has_function_privilege('app_rw','nipt_runtime_quarantined()','EXECUTE') probe")).rows[0];assert.deepEqual(roles,{app:false,probe:true});
  const state=async()=>({cases:(await restored.query('SELECT id,current_round_id FROM nipt_case ORDER BY id')).rows,rounds:(await restored.query('SELECT * FROM specimen_round ORDER BY id')).rows,releases:(await restored.query('SELECT * FROM result_release ORDER BY id')).rows,transfers:(await restored.query('SELECT id,plan,model FROM p6_transfer ORDER BY id')).rows});
  const queueAccess=(await restored.query("SELECT has_schema_privilege('worker_rw','pgboss','USAGE') usage,has_schema_privilege('worker_rw','pgboss','CREATE') create_schema,has_table_privilege('worker_rw','pgboss.job','SELECT,INSERT,UPDATE,DELETE') queue_rw,has_table_privilege('app_rw','pgboss.job','SELECT') app_read")).rows[0];assert.deepEqual(queueAccess,{usage:true,create_schema:false,queue_rw:true,app_read:false});
  const before=await state();assert.equal(before.cases.length,45);assert.equal(before.releases.length,2);assert.equal(before.transfers.length,2);events.push('RESTORE_ALL_TABLE_DIGESTS_ASSETS_LINEAGE_AUDIT_ACL_AND_MIGRATION_REAPPLY');
  await activateRestored(destination,recovery);await assertDatabaseMode(restored);await assert.rejects(assertDatabaseMode(db),/RESTORED_RUNTIME_QUARANTINED/);events.push('SOURCE_FENCED_RESTORED_TARGET_ACTIVATED');
  const restoredEnv={...env,DATABASE_URL:restoreUrl.toString(),NIPT_OPERATIONAL_DATABASE:database,FILE_STORE_ROOT:path.join(destination,'files'),NIPT_TASK_MASTER_PATH:path.join(destination,'master','owner-master.xlsx')};
  await c.restart(restoredEnv);
  await waitFor(async()=>{const h=await operatorHealth(restored,undefined,{mode:'operational',webRole:'nipt_test_app',workerRole:'nipt_test_worker',probes:{web:true,renderer:true,fileStorage:true,backup:'CHECKSUM_VERIFIED'}});return h.workerAlive&&h.backlog===0&&!h.workerError;},'RESTORED_WORKER_IDLE',120000);
  assert.equal((await restored.query('SELECT count(*)::int n FROM integration_job_receipt WHERE outbox_id=$1',[pendingJob])).rows[0].n,1);
  const producer=new PgBoss(restoreUrl.toString());await producer.start();try{assert.equal(await producer.send('synthetic_scan',{outboxId:pendingJob},{id:pendingJob}),null);}finally{await producer.stop();}
  assert.equal((await restored.query('SELECT count(*)::int n FROM pgboss.job WHERE id=$1',[pendingJob])).rows[0].n,1);events.push('RESTORED_PENDING_JOB_COMPLETED_ONCE_DUPLICATE_MESSAGE_REJECTED');
  for(const r of receipt.outbound as {root:string;files:{path:string;sha256:string}[]}[]){for(const f of r.files)assert.equal(createHash('sha256').update(await fs.readFile(path.join(r.root,...f.path.split('/')))).digest('hex'),f.sha256);}
  assert.deepEqual(await state(),before);events.push('RESTORED_WORKER_RESTART_NO_DUPLICATE_RELEASE_OR_TRANSFER');
  // Read actual HTTP probes in a separate process so Node trusts only this disposable TLS certificate.
  let health:Record<string,unknown>|undefined;await waitFor(async()=>{try{health=JSON.parse((await promisify(execFile)(process.execPath,['--import','tsx','tools/p8/health.ts'],{env:{...restoredEnv,NODE_EXTRA_CA_CERTS:path.join(base,'tls.crt'),NIPT_WEB_DB_ROLE:'nipt_test_app',NIPT_WORKER_DB_ROLE:'nipt_test_worker',NIPT_LAST_BACKUP_PATH:backup.backupBase},encoding:'utf8',windowsHide:true})).stdout);return health?.technicalReady===true;}catch{return false;}},'RESTORED_ACTUAL_HEALTH',90000);assert.equal(health?.technicalReady,true);events.push('ACTUAL_WEB_RENDERER_DB_WORKER_QUEUE_BACKUP_HEALTH');
  await fs.writeFile(path.join(base,'recovery-evidence.json'),JSON.stringify({backup,receipt,health,events,sourceFenced:true,noDuplicatePublication:true},null,2));
 }finally{await restored.end();}
}
