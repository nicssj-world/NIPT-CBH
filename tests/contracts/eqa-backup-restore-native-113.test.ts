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

// Isolated native pg_dump / pg_restore (synthetic databases only). A restore must bring back the certified EQA PDF bytes by hash AND keep every
// database guard that makes EQA un-transmittable: a restored database that lost a trigger would silently reopen the HIS path.
it.skipIf(!process.env.NIPT_TEST_DATABASE_URL)('backup and restore keep the certified EQA PDF (by SHA-256), the EQA classification and every no-HIS guard',async()=>{
 const baseUrl=new URL(process.env.NIPT_TEST_DATABASE_URL!);assertSyntheticDatabase(baseUrl.toString());
 const root=await mkdtemp(path.join(os.tmpdir(),'nipt-113-eqa-dr-synthetic-'));
 const pgBin=['C:/Program Files/pgsql','C:/Program Files/PostgreSQL/17'].map(v=>path.join(v,'bin')).find(b=>existsSync(path.join(b,'pg_dump.exe'))&&existsSync(path.join(b,'pg_restore.exe')));
 if(!pgBin)throw Error('SYNTHETIC_PG_BACKUP_BINARIES_UNAVAILABLE');
 const suffix=randomBytes(4).toString('hex'),srcName='nipt_synthetic_eqa_dr_source_'+suffix,dstName='nipt_synthetic_eqa_dr_restore_'+suffix;
 const server=new URL(baseUrl);server.pathname='/postgres';
 const admin=new Client({connectionString:server.toString()});await admin.connect();
 const source=new URL(baseUrl),target=new URL(baseUrl);source.pathname='/'+srcName;target.pathname='/'+dstName;
 let src:Client|null=null,dst:Client|null=null;
 const run=(exe:string,args:string[])=>{const r=spawnSync(exe,args,{encoding:'utf8',windowsHide:true,timeout:60000,stdio:['ignore','pipe','pipe']});if(r.status!==0||r.error)throw Error('SYNTHETIC_DR_COMMAND_FAILED_'+path.basename(exe)+' '+String(r.stderr).slice(0,600));};
 try{
  await admin.query('CREATE DATABASE '+srcName);await admin.query('CREATE DATABASE '+dstName);
  assertSyntheticDatabase(source.toString());assertSyntheticDatabase(target.toString());
  src=new Client({connectionString:source.toString()});await src.connect();await migrate(src);
  const intake=randomUUID(),attempt=randomUUID(),actor=randomUUID(),caseId=randomUUID(),roundId=randomUUID(),lnId=randomUUID(),version=randomUUID(),release=randomUUID();
  const pdf=Buffer.from('%PDF-1.7 SYNTHETIC CERTIFIED EQA REPORT '+suffix),store=new FileStore(path.join(root,'original')),sha=await store.put(pdf);
  await src.query('BEGIN');await src.query('SET LOCAL session_replication_role=replica');
  await src.query("INSERT INTO app_user(id,username,display_name,password_hash) VALUES($1,$2,'Synthetic','$argon2id$v=19$synthetic')",[actor,'synthetic.eqa.dr.'+suffix]);
  await src.query("INSERT INTO nipt_case(id,registration_origin,identity_key,current_round_id) VALUES($1,'LAB_DIRECT',$2,$3)",[caseId,createHash('sha256').update(caseId).digest('hex'),roundId]);
  await src.query("INSERT INTO case_ln(id,case_id,ln) VALUES($1,$2,'0099113777')",[lnId,caseId]);
  await src.query("INSERT INTO specimen_round(id,case_id,case_ln_id,round_number,state) VALUES($1,$2,$3,1,'Expected')",[roundId,caseId,lnId]);
  await src.query("INSERT INTO eqa_case(case_id,round_id,organizer,program_year,sample_ref,surname,first_name,dob,ga_weeks,ga_days,collection_date,pregnancy,registered_by) VALUES($1,$2,'GenQA/EMQN',2026,'03NIPT26','POLSON','Tonya','1988-08-23',11,1,'2026-10-19','Singleton',$3)",[caseId,roundId,actor]);
  await src.query("INSERT INTO analytical_attempt(id,case_id,round_id,attempt_number,overall_ordinal,state) VALUES($1,$2,$3,1,1,'FinalQcAccepted')",[attempt,caseId,roundId]);
  await src.query("INSERT INTO file_asset(sha256,byte_size,media_type,storage_key) VALUES($1,$2,'application/pdf',$1)",[sha,pdf.length]);
  await src.query("INSERT INTO result_intake_file(id,source,original_name,sha256,byte_size,container,state,actor_id) VALUES($1,'UPLOAD','synthetic.pdf',$2,$3,'PDF','Imported',$4)",[intake,sha,pdf.length,actor]);
  await src.query("INSERT INTO result_report_version(id,intake_file_id,sha256,kind,template_kind,template_version,parser_version,parsed,case_id,round_id,attempt_id,link_mode,series_version,imported_by,state) VALUES($1,$2,$3,'RESULT','SINGLETON','f','f','{}',$4,$5,$6,'MANUAL_REVIEWED',1,$7,'CertifiedReleased')",[version,intake,sha,caseId,roundId,attempt,actor]);
  await src.query("INSERT INTO result_release(id,version_id,case_id,round_id,kind,channel,certified_by) VALUES($1,$2,$3,$4,'RESULT','NIPT_ANC_VIEW',$5)",[release,version,caseId,roundId,actor]);
  await src.query('COMMIT');
  const migrationCount=Number((await src.query('SELECT count(*)::int c FROM schema_migration')).rows[0].c);
  const dump=path.join(root,'database.dump');
  run(path.join(pgBin,'pg_dump.exe'),['--format=custom','--file',dump,'--dbname',source.toString()]);
  const copyRoot=path.join(root,'restored-files');await mkdir(copyRoot);await cp(path.join(root,'original'),copyRoot,{recursive:true});
  run(path.join(pgBin,'pg_restore.exe'),['--no-owner','--dbname',target.toString(),dump]);
  dst=new Client({connectionString:target.toString()});await dst.connect();
  // 1. Data and bytes.
  expect(Number((await dst.query('SELECT count(*)::int c FROM schema_migration')).rows[0].c)).toBe(migrationCount);
  expect((await dst.query("SELECT name FROM schema_migration WHERE name ~ '^18[3-6]_' ORDER BY name")).rows.map(r=>r.name)).toEqual(['183_eqa_case_no_his.sql','184_eqa_round1_local_receipt.sql','185_eqa_release_guard.sql','186_worker_queue_retry.sql']);
  expect((await dst.query('SELECT sample_ref,organizer FROM eqa_case WHERE case_id=$1',[caseId])).rows).toEqual([{sample_ref:'03NIPT26',organizer:'GenQA/EMQN'}]);
  expect((await dst.query('SELECT v.sha256 FROM result_release r JOIN result_report_version v ON v.id=r.version_id WHERE r.id=$1',[release])).rows).toEqual([{sha256:sha}]);
  const recovered=await new FileStore(copyRoot).get(sha);
  expect(createHash('sha256').update(recovered).digest('hex')).toBe(sha);expect(recovered).toEqual(pdf);
  // 2. Every guard exists again, with the wrapper over the composed eligibility function.
  const triggers=(await dst.query<{t:string}>("SELECT tgname t FROM pg_trigger WHERE NOT tgisinternal AND tgname IN ('eqa_case_immutable','eqa_case_insert_guard','eqa_his_order_guard','eqa_transfer_guard','eqa_outbox_guard','specimen_round_local_receipt_guard') ORDER BY 1")).rows.map(r=>r.t);
  expect(triggers).toEqual(['eqa_case_immutable','eqa_case_insert_guard','eqa_his_order_guard','eqa_outbox_guard','eqa_transfer_guard','specimen_round_local_receipt_guard']);
  expect((await dst.query<{s:string}>("SELECT prosrc s FROM pg_proc WHERE proname='p6_release_eligible'")).rows[0].s).toContain('eqa_unfiltered_release_eligible');
  expect((await dst.query<{s:string}>("SELECT prosrc s FROM pg_proc WHERE proname='eqa_unfiltered_release_eligible'")).rows).toHaveLength(1);
  // 3. And they still refuse, in the restored database.
  const refused=async(sql:string,args:unknown[])=>{await dst!.query('SAVEPOINT s').catch(()=>undefined);try{await dst!.query(sql,args);return 'OK';}catch(e){return String((e as Error).message);}};
  expect(await refused("INSERT INTO job_outbox(kind,payload,idempotency_key) VALUES('result_release_completed',$1,$2)",[JSON.stringify({releaseId:release}),randomUUID()])).toMatch(/EQA_NO_HIS_OUTBOUND/);
  expect(await refused("UPDATE eqa_case SET organizer='X' WHERE case_id=$1",[caseId])).toMatch(/append-only/i);
  expect((await dst.query<{ok:boolean}>('SELECT p6_release_eligible($1,0) ok',[release])).rows[0].ok).toBe(false);
 }finally{
  await src?.end();await dst?.end();
  for(const name of [srcName,dstName]){try{await admin.query('DROP DATABASE IF EXISTS '+name);}catch{/* best effort */}}
  await admin.end();
  if(path.basename(root).startsWith('nipt-113-eqa-dr-synthetic-'))await rm(root,{recursive:true,force:true});
 }
},180000);
