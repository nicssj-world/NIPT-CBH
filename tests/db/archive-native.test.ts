import {afterAll,beforeAll,expect,it} from 'vitest';
import {Client} from 'pg';
import {assertSyntheticDatabase} from '../../packages/db/connection';
import {migrate} from '../../tools/migrate';
import {runArchiveCycle} from '../../packages/results/archive-worker';
import {runArchiveProbeCycle} from '../../packages/results/archive-worker';
import {readFile} from 'node:fs/promises';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {FileStore} from '../../packages/storage';
import {enableArchive,queueArchiveProbe,retryFailedArchive} from '../../packages/results/archive-settings';
import {clearWorkerQueue} from '../../packages/jobs/admin-clear';

const url=process.env.NIPT_ARCHIVE_TEST_DATABASE_URL;
let client:Client;
beforeAll(async()=>{if(!url)return;assertSyntheticDatabase(url);client=new Client({connectionString:url});await client.connect();await migrate(client);});
afterAll(async()=>{await client?.end();});
it.skipIf(!url)('native PostgreSQL migrates with archive disabled and runs an empty archive cycle',async()=>{
 expect((await client.query('SELECT enabled FROM pdf_archive_config WHERE singleton')).rows).toEqual([{enabled:false}]);
 await expect(runArchiveCycle(client,{get:async()=>{throw Error('unexpected read');}})).resolves.toBeUndefined();
 expect((await client.query('SELECT id FROM pdf_archive_job')).rows).toHaveLength(0);
 await client.query(await readFile('packages/db/roles.sql','utf8'));
 await client.query('SET ROLE worker_rw');
 try{await runArchiveProbeCycle(client);await runArchiveCycle(client,{get:async()=>{throw Error('unexpected read');}});}finally{await client.query('RESET ROLE');}
});
it.skipIf(!url)('native worker archives only the post-cutoff synthetic fixture with matching bytes',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'nipt-archive-native-'));
 const store=new FileStore(path.join(root,'source')),archive=path.join(root,'archive');
 const {mkdir}=await import('node:fs/promises');await mkdir(archive);
 const actor=randomUUID(),bytes=Buffer.from('%PDF-1.7 synthetic archive test'),sha=await store.put(bytes),round=randomUUID();
 const caseId=randomUUID(),versionId=randomUUID(),releaseId=randomUUID(),oldCase=randomUUID(),oldVersion=randomUUID(),oldRelease=randomUUID(),oldRound=randomUUID();
 await client.query('BEGIN');
 try{
  // Fixture insertion bypasses clinical authority only in this rolled-back disposable database transaction.
  await client.query('SET LOCAL session_replication_role=replica');
  await client.query("INSERT INTO app_user(id,username,display_name,password_hash) VALUES($1,$2,'Synthetic','$argon2id$v=19$synthetic')",[actor,`archive.${randomUUID()}`]);
  await client.query("INSERT INTO role_assignment(user_id,role) VALUES($1,'APP_ADMIN')",[actor]);
  for(const id of [caseId,oldCase])await client.query("INSERT INTO nipt_case(id,registration_origin,identity_key) VALUES($1,'LAB_DIRECT',$2)",[id,createHash('sha256').update(id).digest('hex')]);
  await client.query("INSERT INTO file_asset(sha256,byte_size,media_type,storage_key) VALUES($1,$2,'application/pdf',$3)",[sha,bytes.length,sha]);
  const oldBytes=Buffer.from('%PDF old synthetic'),oldSha=await store.put(oldBytes);
  await client.query("INSERT INTO file_asset(sha256,byte_size,media_type,storage_key) VALUES($1,$2,'application/pdf',$3)",[oldSha,oldBytes.length,oldSha]);
  for(const [c,v,r,rel,hash,when] of [[caseId,versionId,round,releaseId,sha,'1 minute'],[oldCase,oldVersion,oldRound,oldRelease,oldSha,'2 hours']]){
   await client.query("INSERT INTO result_report_version(id,intake_file_id,sha256,kind,template_kind,template_version,parser_version,parsed,case_id,round_id,imported_by) VALUES($1,$2,$3,'RESULT','SINGLETON','fixture','fixture','{}',$4,$5,$6)",[v,randomUUID(),hash,c,r,actor]);
   await client.query("INSERT INTO result_release(id,version_id,case_id,round_id,kind,channel,certified_by,certified_at) VALUES($1,$2,$3,$4,'RESULT','NIPT_ANC_VIEW',$5,clock_timestamp()-$6::interval)",[rel,v,c,r,actor,when]);
   await client.query('INSERT INTO result_release_completed(release_id,version_id,actor_id,created_at) VALUES($1,$2,$3,clock_timestamp()-$4::interval)',[rel,v,actor,when]);
  }
  await client.query("INSERT INTO pdf_archive_window(root_path,activated_by,activated_at) VALUES($1,$2,clock_timestamp()-interval '1 hour')",[archive,actor]);
  await client.query('UPDATE pdf_archive_config SET enabled=true,root_path=$1 WHERE singleton',[archive]);
  await client.query('SET LOCAL session_replication_role=origin');await client.query('SET LOCAL ROLE worker_rw');
  const hisBefore=(await client.query<{n:string}>('SELECT count(*)::text n FROM job_outbox')).rows[0].n;
  await runArchiveCycle(client,store,async()=>({state:'FAILED',sha256:sha,reason:'ARCHIVE_IO_FAILED'}));
  expect((await client.query<{state:string;attempts:number}>('SELECT state,attempts FROM pdf_archive_job')).rows).toEqual([{state:'PENDING',attempts:1}]);
  await client.query('SAVEPOINT publication_race');
  await client.query("UPDATE pdf_archive_job SET next_attempt_at=clock_timestamp()-interval '1 second'");
  await runArchiveCycle(client,store,async()=>{
   const id=(await client.query<{id:string}>('SELECT id FROM pdf_archive_job')).rows[0].id;
   await client.query('SET LOCAL ROLE app_rw');
   await clearWorkerQueue(client,{id:actor,roles:['APP_ADMIN'],unitIds:[],permissions:[]},{action:'CLEAR_SELECTED',scope:'ARCHIVE',ids:[id]});
   await client.query('SET LOCAL ROLE worker_rw');
   return {state:'FAILED',sha256:sha,reason:'ARCHIVE_IO_FAILED'};
  });
  expect((await client.query<{state:string;last_error:string}>('SELECT state,last_error FROM pdf_archive_job')).rows[0]).toEqual({state:'FAILED',last_error:'ARCHIVE_RECONCILIATION_REQUIRED'});
  const uncertainId=(await client.query<{id:string}>('SELECT id FROM pdf_archive_job')).rows[0].id;
  await client.query('SET LOCAL ROLE app_rw');
  await expect(retryFailedArchive(client,{id:actor,roles:['APP_ADMIN'],unitIds:[],permissions:[]},uncertainId)).rejects.toThrow('ARCHIVE_RETRY_UNAVAILABLE');
  await client.query('ROLLBACK TO SAVEPOINT publication_race');
  await client.query("UPDATE pdf_archive_job SET state='FAILED',attempts=5,claim_token=NULL,claimed_until=NULL");
  const jobId=(await client.query<{id:string}>('SELECT id FROM pdf_archive_job')).rows[0].id;
  await client.query('SET LOCAL ROLE app_rw');
  await client.query('SAVEPOINT spoofed_admin');
  await expect(client.query('SELECT pdf_archive_retry($1,$2)',[jobId,actor])).rejects.toThrow();
  await client.query('ROLLBACK TO SAVEPOINT spoofed_admin');
  // app_rw cannot change archive job state even with a forged Admin UUID.
  await client.query('SAVEPOINT deny_direct_retry');
  await expect(client.query("UPDATE pdf_archive_job SET state='PENDING' WHERE id=$1",[jobId])).rejects.toThrow(/permission denied/);
  await client.query('ROLLBACK TO SAVEPOINT deny_direct_retry');
  await client.query('SAVEPOINT deny_clear_non_admin');
  await expect(client.query('SELECT request_archive_queue_clear($1,$2)',[jobId,randomUUID()])).rejects.toThrow('FORBIDDEN');
  await client.query('ROLLBACK TO SAVEPOINT deny_clear_non_admin');
  await client.query('SAVEPOINT valid_clear');
  await clearWorkerQueue(client,{id:actor,roles:['APP_ADMIN'],unitIds:[],permissions:[]},{action:'CLEAR_SELECTED',scope:'ARCHIVE',ids:[jobId]});
  expect((await client.query<{state:string}>('SELECT state FROM pdf_archive_job WHERE id=$1',[jobId])).rows[0].state).toBe('CANCELLED');
  await client.query('ROLLBACK TO SAVEPOINT valid_clear');
  const retry=await retryFailedArchive(client,{id:actor,roles:['APP_ADMIN'],unitIds:[],permissions:[]},jobId);
  expect(retry).toMatchObject({state:'PENDING_PROBE'});
  expect((await client.query<{state:string}>('SELECT state FROM pdf_archive_job WHERE id=$1',[jobId])).rows[0].state).toBe('FAILED');
  // Only the worker's successful real path probe can requeue the FAILED job.
  await client.query('SET LOCAL ROLE worker_rw');
  await runArchiveProbeCycle(client);
  expect((await client.query<{state:string;attempts:number}>('SELECT state,attempts FROM pdf_archive_job WHERE id=$1',[jobId])).rows[0]).toEqual({state:'PENDING',attempts:0});
  const staleToken=randomUUID();
  await client.query("UPDATE pdf_archive_job SET claim_token=$1,claimed_until=clock_timestamp()-interval '1 second' WHERE id=$2",[staleToken,jobId]);
  await runArchiveCycle(client,store);await runArchiveCycle(client,store);
  const jobs=(await client.query<{release_id:string;state:string}>('SELECT release_id,state FROM pdf_archive_job')).rows;
  expect(jobs).toEqual([{release_id:releaseId,state:'ARCHIVED'}]);
  const stale=await client.query("UPDATE pdf_archive_job SET state='PENDING',archived_at=NULL WHERE id=$1 AND claim_token=$2",[jobId,staleToken]);expect(stale.rowCount).toBe(0);
  expect(await readFile(path.join(archive,caseId,`${versionId}.pdf`))).toEqual(bytes);
  expect((await client.query<{n:string}>('SELECT count(*)::text n FROM job_outbox')).rows[0].n).toBe(hisBefore);
 }finally{await client.query('ROLLBACK');await rm(root,{recursive:true,force:true});}
});
it.skipIf(!url)('a restricted worker probes a synthetic directory before an administrator enables it',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'nipt-archive-probe-native-')),actor=randomUUID();
 const admin={id:actor,roles:['APP_ADMIN'] as const,unitIds:[],permissions:[]};
 await client.query('BEGIN');
 try{
  await client.query("INSERT INTO app_user(id,username,display_name,password_hash) VALUES($1,$2,'Synthetic','$argon2id$v=19$synthetic')",[actor,`archive.${randomUUID()}`]);
  await client.query("INSERT INTO role_assignment(user_id,role) VALUES($1,'APP_ADMIN')",[actor]);
  await client.query('SET LOCAL ROLE app_rw');const id=await queueArchiveProbe(client,admin,root);
  await client.query('SAVEPOINT deny_forged_probe');
  await expect(client.query("UPDATE pdf_archive_probe SET state='PASSED' WHERE id=$1",[id])).rejects.toThrow(/permission denied/);
  await client.query('ROLLBACK TO SAVEPOINT deny_forged_probe');
  await expect(client.query("INSERT INTO pdf_archive_probe(root_path,requested_by,state) VALUES($1,$2,'PASSED')",[root,actor])).rejects.toThrow(/permission denied/);
  await client.query('ROLLBACK TO SAVEPOINT deny_forged_probe');
  await client.query('SET LOCAL ROLE worker_rw');await runArchiveProbeCycle(client);
  await client.query('SET LOCAL ROLE app_rw');
  expect((await client.query<{state:string}>('SELECT state FROM pdf_archive_probe WHERE id=$1',[id])).rows[0].state).toBe('PASSED');
  await enableArchive(client,admin,id);
  expect((await client.query<{enabled:boolean}>('SELECT enabled FROM pdf_archive_config WHERE singleton')).rows[0].enabled).toBe(true);
 }finally{await client.query('ROLLBACK');await rm(root,{recursive:true,force:true});}
});
