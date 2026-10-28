import {it,expect} from 'vitest';
import {spawn,type ChildProcess} from 'node:child_process';
import {Client} from 'pg';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {mkdtemp,mkdir,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {assertSyntheticDatabase} from '../../packages/db/connection';
import {migrate} from '../../tools/migrate';
import {FileStore} from '../../packages/storage';

const delay=(ms:number)=>new Promise(r=>setTimeout(r,ms));
it.skipIf(!process.env.NIPT_TEST_DATABASE_URL)('a killed worker leaves an immutable claim; restarted worker archives once without touching HIS or release',async()=>{
 const url=new URL(process.env.NIPT_TEST_DATABASE_URL!);assertSyntheticDatabase(url.toString());
 const dbName='nipt_synthetic_archive_restart_'+randomBytes(4).toString('hex');
 const server=new URL(url);server.pathname='/postgres';
 const root=await mkdtemp(path.join(os.tmpdir(),'nipt-archive-restart-'));
 const source=path.join(root,'files'),archive=path.join(root,'archive');
 const admin=new Client({connectionString:server.toString(),connectionTimeoutMillis:5000});
 await admin.connect();await admin.query('CREATE DATABASE '+dbName);
 url.pathname='/'+dbName;assertSyntheticDatabase(url.toString());
 const owner=new Client({connectionString:url.toString()});await owner.connect();
 let child:ChildProcess|null=null;
 try{
  await migrate(owner);await owner.query(await readFile('packages/db/roles.sql','utf8'));
  await mkdir(archive);
  const store=new FileStore(source);
  const bytes=Buffer.from('%PDF-1.7 synthetic worker crash fixture');
  const sha=await store.put(bytes);
  const actor=randomUUID(),caseId=randomUUID(),versionId=randomUUID(),roundId=randomUUID(),releaseId=randomUUID();
  await owner.query('BEGIN');
  try{
   await owner.query('SET LOCAL session_replication_role=replica');
   await owner.query("INSERT INTO app_user(id,username,display_name,password_hash) VALUES($1,$2,'Synthetic', '$argon2id$v=19$synthetic')",[actor,'synthetic.restart.'+randomUUID()]);
   await owner.query("INSERT INTO nipt_case(id,registration_origin,identity_key) VALUES($1,'LAB_DIRECT',$2)",[caseId,createHash('sha256').update(caseId).digest('hex')]);
   await owner.query("INSERT INTO file_asset(sha256,byte_size,media_type,storage_key) VALUES($1,$2,'application/pdf',$3)",[sha,bytes.length,sha]);
   await owner.query("INSERT INTO result_report_version(id,intake_file_id,sha256,kind,template_kind,template_version,parser_version,parsed,case_id,round_id,imported_by) VALUES($1,$2,$3,'RESULT','SINGLETON','fixture','fixture','{}',$4,$5,$6)",[versionId,randomUUID(),sha,caseId,roundId,actor]);
   await owner.query("INSERT INTO pdf_archive_window(root_path,activated_by,activated_at) VALUES($1,$2,clock_timestamp()-interval '1 hour')",[archive,actor]);
   await owner.query('UPDATE pdf_archive_config SET enabled=true,root_path=$1 WHERE singleton',[archive]);
   await owner.query("INSERT INTO result_release(id,version_id,case_id,round_id,kind,channel,certified_by,certified_at) VALUES($1,$2,$3,$4,'RESULT','NIPT_ANC_VIEW',$5,clock_timestamp()-interval '1 minute')",[releaseId,versionId,caseId,roundId,actor]);
   await owner.query("INSERT INTO result_release_completed(release_id,version_id,actor_id,created_at) VALUES($1,$2,$3,clock_timestamp()-interval '1 minute')",[releaseId,versionId,actor]);
   await owner.query('SET LOCAL session_replication_role=origin');
   await owner.query('COMMIT');
  }catch(error){await owner.query('ROLLBACK');throw error;}
  const before=(await owner.query('SELECT row_to_json(r)::text release,(SELECT count(*)::int FROM job_outbox) his FROM result_release r WHERE id=$1',[releaseId])).rows[0];
  const childBase={
   ...process.env,NIPT_MODE:'synthetic',NIPT_RESTART_CHILD_GUARD:'1',
   NIPT_RESTART_CHILD_URL:url.toString(),NIPT_RESTART_SOURCE_ROOT:source
  };
  const runChild=(mode:'STALL'|'RECOVER')=>spawn(process.execPath,
   ['--import','tsx','tests/helpers/archive-worker-process.ts'],
   {cwd:process.cwd(),windowsHide:true,env:{...childBase,NIPT_RESTART_CHILD_MODE:mode},stdio:'ignore'});
  child=runChild('STALL');
  let claimed=false;
  for(let i=0;i<90;i++){
   const q=await owner.query<{attempts:number;claim_token:string|null}>('SELECT attempts,claim_token FROM pdf_archive_job WHERE release_id=$1',[releaseId]);
   if(q.rows[0]?.attempts===1&&q.rows[0].claim_token){claimed=true;break;}
   if(child.exitCode!==null)break;
   await delay(100);
  }
  expect(claimed).toBe(true);
  child.kill('SIGKILL');
  await Promise.race([new Promise<void>(resolve=>child!.once('exit',()=>resolve())),delay(5000)]);
  // Advance this disposable fixture's lease to simulate passage of its 10-minute
  // timeout; no production clock or externally owned lease is modified.
  await owner.query("UPDATE pdf_archive_job SET claimed_until=clock_timestamp()-interval '1 second' WHERE release_id=$1",[releaseId]);
  child=runChild('RECOVER');
  const code=await new Promise<number|null>(resolve=>{
   const timer=setTimeout(()=>{child?.kill();resolve(null);},30000);
   child!.once('exit',value=>{clearTimeout(timer);resolve(value);});
  });
  expect(code).toBe(0);
  const row=(await owner.query<{state:string;attempts:number;count:number}>(
   'SELECT j.state,j.attempts,(SELECT count(*)::int FROM pdf_archive_job j2 WHERE j2.release_id=j.release_id) count FROM pdf_archive_job j WHERE j.release_id=$1',[releaseId])).rows[0];
  expect(row).toEqual({state:'ARCHIVED',attempts:2,count:1});
  expect(await readFile(path.join(archive,caseId,versionId+'.pdf'))).toEqual(bytes);
  const after=(await owner.query('SELECT row_to_json(r)::text release,(SELECT count(*)::int FROM job_outbox) his FROM result_release r WHERE id=$1',[releaseId])).rows[0];
  expect(after).toEqual(before);
 }finally{
  if(child&&child.exitCode===null)child.kill();
  await owner.end();await admin.query('DROP DATABASE IF EXISTS '+dbName);await admin.end();
  if(path.basename(root).startsWith('nipt-archive-restart-'))await rm(root,{recursive:true,force:true});
 }
},120000);
