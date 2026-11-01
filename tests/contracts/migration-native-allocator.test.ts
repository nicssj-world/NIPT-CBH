import {receivedCase,rowVersion,type ResultFixture} from '../helpers/results';
import {ingestMigrationPdfs} from '../../packages/migration/bulk-pdf';import {syntheticReportPdf} from '../../tools/his-simulator/result-pdf';
import {acceptAndRelease} from '../../packages/results/service';import {SETTINGS} from '../../packages/settings/catalog';
import {proposeSetting,validateSetting,approveSetting,activateSetting} from '../../packages/settings/service';
import {it,expect,vi} from 'vitest';import {Client} from 'pg';import {randomBytes,createHash,randomUUID} from 'node:crypto';
import {readFile,mkdtemp,rm} from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import {developmentEnvironment} from '../../tools/migration/runtime-launch';import {migrate} from '../../tools/migrate';
import {addUser} from '../helpers/database';import type {PGlite} from '@electric-sql/pglite';import {syntheticCase,labUsers,receiveS1,tx} from '../helpers/lab';
import type {Queryable} from '../../packages/db/connection';
import {FileStore} from '../../packages/storage';import {simpleXlsx} from '../../packages/workbook/simple-xlsx';
import {buildMigrationPlan} from '../../packages/migration/planner';import {executeMigration} from '../../packages/migration/service';
import {pinAllocatorEvidence} from '../../packages/migration/high-watermark';import {applyAllocatorHandover} from '../../packages/migration/identifiers';
it.skipIf(process.env.NIPT_MIGRATION_NATIVE_TEST!=='yes')('dedicated native PostgreSQL app_rw handover + concurrent receipts preserve source authority and uniqueness',async()=>{
 const config=await developmentEnvironment('owner'),url=new URL(config.DATABASE_URL);
 if(url.hostname!=='127.0.0.1'||url.port!=='20369'||url.pathname!=='/nipt_migration_development')throw Error('DEDICATED_DEVELOPMENT_CLUSTER_REQUIRED');
 const dbName='nipt_migration_native_contract_'+randomBytes(5).toString('hex'),adminUrl=new URL(url);adminUrl.pathname='/postgres';
 const admin=new Client({connectionString:adminUrl.toString()});await admin.connect();await admin.query('CREATE DATABASE '+dbName);
 const testUrl=new URL(url);testUrl.pathname='/'+dbName;const owner=new Client({connectionString:testUrl.toString()});await owner.connect();
 const clients:Client[]=[];const root=await mkdtemp(path.join(os.tmpdir(),'migration-native-'));
 vi.stubEnv('NIPT_MODE','synthetic');
 try{
  await migrate(owner);await owner.query(await readFile('packages/db/roles.sql','utf8'));await owner.query(await readFile('packages/p6/grants.sql','utf8'));
  const app=async()=>{const c=new Client({connectionString:testUrl.toString()});await c.connect();await c.query('SET ROLE app_rw');clients.push(c);return {query:<T>(sql:string,values?:unknown[])=>c.query(sql,values).then(r=>({rows:r.rows as T[]}))} as Queryable;};
  const a=await app(),b=await app(),user=await addUser(owner as unknown as PGlite),u=await labUsers(owner);
  const cases=await Promise.all([tx(a,d=>syntheticCase(d,{staff:u.staff,unit:u.unit})),tx(b,d=>syntheticCase(d,{staff:u.staff,unit:u.unit}))]);
  const clock=(await owner.query<{today:string;at:string}>("SELECT p4_bangkok_date(now())::text today,clock_timestamp()::text at")).rows[0],date=clock.today,month=date.slice(0,7)+'-01';
  const input={mapping:{name:'native-synthetic.xlsx',bytes:simpleXlsx('Mapping',[['LN','LN Halos'],['99009900001',date.slice(2,4)+'B'+date.slice(2).replaceAll('-','')+'137']])},halos:[]};
  const plan=buildMigrationPlan(input),execution=await executeMigration(a,user,input,{planDigest:plan.digest,uncheckedAcknowledged:true},{store:new FileStore(root),verifyBackup:async()=>({manifestSha256:'a'.repeat(64),verification:'CREATION_VERIFIED'})});
  await expect(tx(a,d=>receiveS1(d,cases[0]))).rejects.toThrow('ALLOCATOR_HANDOVER_PENDING');
  const proof=pinAllocatorEvidence({version:1,source:'GENOMIC_READ_ONLY_ALLOCATOR',sourceIdentity:'synthetic-native-source',capturedAt:new Date(clock.at).toISOString(),mappingSha256:plan.sources[0].sha256,registryPairsSha256:plan.registryPairsSha256,registryPairCount:1,months:[{month,lastValue:152}],sourceFrozen:true});
  const handovers=await Promise.all([applyAllocatorHandover(a,user,execution.id,proof),applyAllocatorHandover(b,user,execution.id,proof)]);
  expect(handovers.filter(x=>x.replayed)).toHaveLength(1);expect((await owner.query('SELECT 1 FROM migration_allocator_handover')).rows).toHaveLength(1);
  await Promise.all(cases.map((c,i)=>tx(i===0?a:b,d=>receiveS1(d,c))));
  expect((await owner.query<{sequence_value:number}>('SELECT sequence_value FROM specimen_lab_number ORDER BY sequence_value')).rows.map(r=>r.sequence_value)).toEqual([153,154]);
  await expect(a.query('UPDATE ln_halos_monthly_sequence SET last_value=1')).rejects.toThrow('permission denied');
  expect((await owner.query('SELECT 1 FROM job_outbox')).rows).toHaveLength(0);
  const f={db:owner,u,store:new FileStore(root),run:<T>(fn:(d:Queryable)=>Promise<T>)=>tx(a,fn)} as unknown as ResultFixture;
  const setting=await f.run(d=>proposeSetting(d,u.certifier,'result_management',{...SETTINGS.result_management.default,linkageMode:'UNIQUE_AUTO_LINK'},'Synthetic native migration PDF test'));
  await f.run(d=>validateSetting(d,u.certifier,setting,async()=>true));await f.run(d=>approveSetting(d,u.approver,setting));await f.run(d=>activateSetting(d,u.approver,setting));
  const c=await receivedCase(f,{ln:'9905'+String(Date.now()).slice(-6),name:'Miss Somying Testcase'}),sha=createHash('sha256').update('SYNTHETIC NATIVE HALOS SOURCE').digest('hex');
  await owner.query("INSERT INTO file_asset(sha256,storage_key,byte_size,media_type) VALUES($1,$1,29,'application/octet-stream')",[sha]);
  const evidenceExecution=(await owner.query<{id:string}>("INSERT INTO migration_execution(plan_digest,plan,created_by,state) VALUES($1,'{}',$2,'COMPLETED') RETURNING id",[sha,user.id])).rows[0].id;
  const source=(await owner.query<{id:string}>("INSERT INTO migration_source(execution_id,kind,sha256,original_name,run_label) VALUES($1,'HALOS_RUN',$2,'synthetic-halos.xlsx','Run001/2026') RETURNING id",[evidenceExecution,sha])).rows[0].id;
  await owner.query("INSERT INTO migration_historical_run(execution_id,run_year,run_number,run_label,source_sha256) VALUES($1,2026,1,'Run001/2026',$2)",[evidenceExecution,sha]);
  const record=(await owner.query<{id:string}>("INSERT INTO migration_record(execution_id,source_key,row_number,ln,ln_halos,classification,case_id,round_id,attempt_id,his_pdf_exists,state) VALUES($1,'native',2,$2,$3,'QUALIFIED_PDF_PENDING',$4,$5,$6,true,'IMPORTED') RETURNING id",[evidenceExecution,c.ln,c.labNumber,c.caseId,c.roundId,c.attemptId])).rows[0].id;
  await owner.query("INSERT INTO migration_analysis(record_id,source_id,analysis_key,sheet,row_number,run_label,sample_raw,attempt_number,classification,advice_status,raw,values,is_current,attempt_id) VALUES($1,$2,'native-current','result',2,'Run001/2026',$3,1,'ANALYSIS','QUALIFIED','{}','{}',true,$4)",[record,source,'\t'+c.labNumber,c.attemptId]);
  vi.stubEnv('NIPT_MODE','operational');vi.stubEnv('APP_ORIGIN','https://127.0.0.1:20368');await owner.query("UPDATE nipt_runtime_config SET mode='operational'");
  const bulk=await f.run(d=>ingestMigrationPdfs(d,u.staff,f.store,[{name:`${c.ln} Somying Testcase.pdf`,bytes:syntheticReportPdf({kind:'SINGLETON',collection:'10-Oct-2026',labNumber:c.labNumber,hn:c.hn,name:'SOMYING TESTCASE'})}]));
  expect(bulk.imported).toBe(1);const versionId=bulk.rows[0].versionId!;
  const release=await f.run(async d=>acceptAndRelease(d,u.certifier,{versionId,expectedRowVersion:(await rowVersion(f,versionId)).row_version,idempotencyKey:randomUUID().replaceAll('-',''),externalFinalCertified:true,identityAndValuesMatchPdf:true,disclosureReviewed:true,abnormalAcknowledged:true}));
  expect(release).toMatchObject({outcome:'CertifiedReleased',outboundSuppressed:true});
  await a.query('UPDATE migration_record SET his_pdf_exists=false,row_version=row_version+1 WHERE id=$1',[record]);
  expect((await owner.query<{ok:boolean}>('SELECT migration_result_review_current($1) ok',[versionId])).rows[0].ok).toBe(true);
  expect((await owner.query('SELECT 1 FROM job_outbox')).rows).toHaveLength(0);
  // Same final-publication lock the real worker holds. Source invalidation must wait for that checkpoint.
  await a.query('SET ROLE worker_rw');await a.query('BEGIN');expect((await a.query<{ok:boolean}>('SELECT p6_lock_current_release($1,0) ok',[release.releaseId])).rows[0].ok).toBe(true);
  const pid=(await b.query<{pid:number}>('SELECT pg_backend_pid() pid')).rows[0].pid;
  const mutation=b.query("UPDATE migration_record SET exceptions='[{\"code\":\"SYNTHETIC_SOURCE_CHANGE\",\"severity\":\"REVIEW_BEFORE_RELEASE\"}]',row_version=row_version+1 WHERE id=$1",[record]);
  let blocked=false;for(let n=0;n<50;n++){blocked=(await owner.query<{blocked:boolean}>("SELECT wait_event_type='Lock' blocked FROM pg_stat_activity WHERE pid=$1",[pid])).rows[0]?.blocked===true;if(blocked)break;await new Promise(resolve=>setTimeout(resolve,20));}
  expect(blocked).toBe(true);await a.query('COMMIT');await mutation;
  expect((await owner.query<{ok:boolean}>('SELECT p6_release_eligible($1,0) ok',[release.releaseId])).rows[0].ok).toBe(false);
  expect((await owner.query('SELECT 1 FROM result_qc5_review')).rows).toHaveLength(0);

 }finally{vi.unstubAllEnvs();for(const c of clients)await c.end();await owner.end();if(!/^nipt_migration_native_contract_[a-f0-9]{10}$/.test(dbName))throw Error('TEST_DATABASE_NAME_INVALID');await admin.query('DROP DATABASE '+dbName);await admin.end();await rm(root,{recursive:true,force:true});}
},60000);
