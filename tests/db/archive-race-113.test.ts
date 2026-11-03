import {afterAll,beforeAll,expect,it} from 'vitest';
import type {PGlite} from '@electric-sql/pglite';
import {randomUUID} from 'node:crypto';
import {mkdir,mkdtemp,readdir,readFile,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {testDatabase,addUser} from '../helpers/database';
import {FileStore} from '../../packages/storage';
import {runArchiveCycle} from '../../packages/results/archive-worker';
import {publishFinalReport} from '../../packages/results/archive-core';
import {applyQueueClearRequests} from '../../packages/jobs/queue-clear-worker';
import type {Principal} from '../../packages/security/policy';

// Archive cancel/publish races through the real runArchiveCycle, the real FileStore and (where stated) the real no-replace publisher on a temp
// folder standing in for the NAS. Synthetic data only.
let db:PGlite,admin:Principal,root:string,nas:string,store:FileStore;
beforeAll(async()=>{
 db=await testDatabase();admin=await addUser(db,'APP_ADMIN','synthetic.archiverace113');
 root=await mkdtemp(path.join(os.tmpdir(),'nipt-archive-race-113-'));nas=path.join(root,'nas');store=new FileStore(path.join(root,'store'));
 await mkdir(nas);   // the NAS root exists on a real share; the publisher never creates it
 await db.exec('BEGIN');await db.exec('SET LOCAL session_replication_role=replica');
 await db.query("INSERT INTO pdf_archive_window(root_path,activated_by,activated_at) VALUES($1,$2,clock_timestamp()-interval '2 hours')",[nas,admin.id]);
 await db.query("UPDATE pdf_archive_config SET enabled=true,root_path=$1 WHERE singleton",[nas]);
 await db.exec('COMMIT');
});
afterAll(async()=>{await db?.close();if(path.basename(root).startsWith('nipt-archive-race-113-'))await rm(root,{recursive:true,force:true});});

/** One certified release that the archive cycle will pick up (ordinary LAB_DIRECT patient case). */
async function release(){
 const bytes=Buffer.from('%PDF-1.7 SYNTHETIC '+randomUUID()),sha=await store.put(bytes),c=randomUUID(),r=randomUUID(),v=randomUUID(),rel=randomUUID();
 await db.exec('BEGIN');
 try{
  await db.exec('SET LOCAL session_replication_role=replica');
  await db.query("INSERT INTO nipt_case(id,registration_origin,identity_key) VALUES($1,'LAB_DIRECT',$2)",[c,c.replace(/-/g,'')+c.replace(/-/g,'')]);
  await db.query("INSERT INTO file_asset(sha256,byte_size,media_type,storage_key) VALUES($1,$2,'application/pdf',$1)",[sha,bytes.length]);
  await db.query("INSERT INTO result_report_version(id,intake_file_id,sha256,kind,template_kind,template_version,parser_version,parsed,case_id,round_id,imported_by) VALUES($1,$2,$3,'RESULT','SINGLETON','f','f','{}',$4,$5,$6)",[v,randomUUID(),sha,c,r,admin.id]);
  await db.query("INSERT INTO result_release(id,version_id,case_id,round_id,kind,channel,certified_by,certified_at) VALUES($1,$2,$3,$4,'RESULT','NIPT_ANC_VIEW',$5,clock_timestamp()-interval '1 minute')",[rel,v,c,r,admin.id]);
  await db.query('INSERT INTO result_release_completed(release_id,version_id,actor_id) VALUES($1,$2,$3)',[rel,v,admin.id]);
  await db.exec('COMMIT');
 }catch(e){await db.exec('ROLLBACK');throw e;}
 return {releaseId:rel,caseId:c,versionId:v,sha,bytes};
}
const job=async(releaseId:string)=>(await db.query<{id:string;state:string;last_error:string|null;claim_token:string|null}>('SELECT id,state,last_error,claim_token FROM pdf_archive_job WHERE release_id=$1',[releaseId])).rows[0];
const request=async(id:string)=>db.query("INSERT INTO worker_queue_clear_request(scope,job_id,requested_by,state_before) VALUES('ARCHIVE',$1,$2,'PENDING')",[id,admin.id]);
const outcome=async(id:string)=>(await db.query<{outcome:string;detail:string}>("SELECT o.outcome,o.detail FROM worker_queue_clear_outcome o JOIN worker_queue_clear_request q ON q.id=o.request_id WHERE q.job_id=$1",[id])).rows[0];
const gate=()=>{let open:()=>void=()=>undefined;const p=new Promise<void>(r=>{open=r;});return {p,open};};
const claimedJobs=async()=>(await db.query<{id:string}>("SELECT id FROM pdf_archive_job WHERE claim_token IS NOT NULL")).rows;

it('cancel requested while the file is being published: the file is the truth, the job ends ARCHIVED and the clear is COMPLETED_NOT_CHANGED',async()=>{
 const rel=await release();const g=gate();let started:()=>void=()=>undefined;const begun=new Promise<void>(r=>{started=r;});
 const cycle=runArchiveCycle(db,store,async(rootPath,intent)=>{started();await g.p;return publishFinalReport(rootPath,intent);});
 await begun;
 const j=await job(rel.releaseId);expect(j.claim_token).not.toBeNull();
 await request(j.id);
 expect(await applyQueueClearRequests(db)).toMatchObject({pending:1,resolved:0});   // the claimed job is asked to stop, nothing is decided yet
 expect((await db.query('SELECT cancellation_requested_at FROM pdf_archive_job WHERE id=$1',[j.id])).rows[0]).toEqual({cancellation_requested_at:expect.anything()});
 g.open();await cycle;
 expect(await job(rel.releaseId)).toMatchObject({state:'ARCHIVED'});
 expect(await readFile(path.join(nas,rel.caseId,`${rel.versionId}.pdf`))).toEqual(rel.bytes);
 await applyQueueClearRequests(db);
 expect(await outcome(j.id)).toMatchObject({outcome:'COMPLETED_NOT_CHANGED'});
});

it('cancel requested during publication and the publication fails: ARCHIVE_RECONCILIATION_REQUIRED, never CANCELLED',async()=>{
 const rel=await release();const g=gate();let started:()=>void=()=>undefined;const begun=new Promise<void>(r=>{started=r;});
 const cycle=runArchiveCycle(db,store,async()=>{started();await g.p;throw Error('ARCHIVE_IO_FAILED');});
 await begun;const j=await job(rel.releaseId);await request(j.id);await applyQueueClearRequests(db);
 g.open();await cycle;
 expect(await job(rel.releaseId)).toMatchObject({state:'FAILED',last_error:'ARCHIVE_RECONCILIATION_REQUIRED',claim_token:null});
 await applyQueueClearRequests(db);
 expect(await outcome(j.id)).toMatchObject({outcome:'RECONCILIATION_REQUIRED'});
});

it('cancel requested before any claim: CANCELLED and the NAS is never written',async()=>{
 const rel=await release();
 // The cycle creates the job when it runs; make it exist unclaimed by running a cycle whose publisher refuses first.
 await runArchiveCycle(db,store,async()=>{throw Error('ARCHIVE_IO_FAILED');});
 const j=await job(rel.releaseId);expect(j.state).toBe('PENDING');
 await request(j.id);await applyQueueClearRequests(db);
 let published=0;
 await runArchiveCycle(db,store,async(rootPath,intent)=>{published++;return publishFinalReport(rootPath,intent);});
 expect(published).toBe(0);
 expect((await job(rel.releaseId)).state).toBe('CANCELLED');
 await expect(readdir(path.join(nas,rel.caseId))).rejects.toThrow();
 expect(await outcome(j.id)).toMatchObject({outcome:'CANCELLED'});
});

it('worker crash after the file was written but before the job was updated: the retry is idempotent and the NAS holds exactly one identical file',async()=>{
 const rel=await release();
 // The crashed worker had claimed the job and published; its claim then expired with no outcome recorded.
 await runArchiveCycle(db,store,async()=>{throw Error('ARCHIVE_IO_FAILED');});
 const j=await job(rel.releaseId);
 await publishFinalReport(nas,{caseId:rel.caseId,versionId:rel.versionId,sha256:rel.sha,bytes:rel.bytes});
 await db.query("UPDATE pdf_archive_job SET claim_token=gen_random_uuid(),claimed_until=clock_timestamp()-interval '1 minute',next_attempt_at=clock_timestamp()-interval '1 minute' WHERE id=$1",[j.id]);
 await runArchiveCycle(db,store,publishFinalReport);
 expect(await job(rel.releaseId)).toMatchObject({state:'ARCHIVED'});
 const files=(await readdir(path.join(nas,rel.caseId))).filter(f=>!f.startsWith('.'));
 expect(files).toEqual([`${rel.versionId}.pdf`]);
 expect(await readFile(path.join(nas,rel.caseId,files[0]))).toEqual(rel.bytes);
 expect(await claimedJobs()).toEqual([]);
});

it('a different file already at the destination is never replaced',async()=>{
 const rel=await release();
 await runArchiveCycle(db,store,async()=>{throw Error('ARCHIVE_IO_FAILED');});
 const dir=path.join(nas,rel.caseId);await mkdir(dir,{recursive:true});
 await writeFile(path.join(dir,`${rel.versionId}.pdf`),Buffer.from('%PDF different bytes'));
 await db.query("UPDATE pdf_archive_job SET next_attempt_at=clock_timestamp()-interval '1 minute' WHERE release_id=$1",[rel.releaseId]);
 await runArchiveCycle(db,store,publishFinalReport);
 expect((await job(rel.releaseId)).state).not.toBe('ARCHIVED');
 expect((await readFile(path.join(dir,`${rel.versionId}.pdf`))).toString()).toBe('%PDF different bytes');
});
