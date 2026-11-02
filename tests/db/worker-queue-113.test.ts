import {beforeAll,afterAll,it,expect} from 'vitest';
import type {PGlite} from '@electric-sql/pglite';
import {testDatabase,addUser} from '../helpers/database';
import {readWorkerQueueOverview} from '../../packages/jobs/admin-center';
import {requestWorkerQueueClear} from '../../packages/jobs/queue-clear';
import {applyQueueClearRequests,type BossLike} from '../../packages/jobs/queue-clear-worker';
import type {Principal} from '../../packages/security/policy';

let db:PGlite,admin:Principal,staff:Principal;
beforeAll(async()=>{
 db=await testDatabase();
 admin=await addUser(db,'APP_ADMIN','synthetic.queue113.admin');
 staff=await addUser(db,'LAB_STAFF','synthetic.queue113.lab');
});
afterAll(async()=>{await db?.close();});

const outbox=async(state:'Pending'|'Dispatched'|'Cancelled',receipt=false)=>{
 const id=(await db.query<{id:string}>("INSERT INTO job_outbox(kind,payload,idempotency_key,state) VALUES('synthetic_scan',$1,gen_random_uuid()::text,$2) RETURNING id",[{patientName:'SYNTHETIC_PRIVATE'},state])).rows[0].id;
 if(receipt)await db.query("INSERT INTO integration_job_receipt(outbox_id,result) VALUES($1,'{}')",[id]);
 return id;
};
const outcome=async(job:string)=>(await db.query<{outcome:string;detail:string}>(`SELECT o.outcome,o.detail FROM worker_queue_clear_outcome o
 JOIN worker_queue_clear_request q ON q.id=o.request_id WHERE q.job_id=$1`,[job])).rows[0];
const stateOf=async(id:string)=>(await db.query<{state:string;cancel_epoch:number}>('SELECT state,cancel_epoch FROM job_outbox WHERE id=$1',[id])).rows[0];
const fakeBoss=(states:Record<string,string>):BossLike&{cancelled:string[]}=>{
 const cancelled:string[]=[];
 return {cancelled,
  getJobById:async(_n,id)=>states[id]?{state:states[id]}:null,
  cancel:async(_n,id)=>{cancelled.push(id);if(['created','retry'].includes(states[id]))states[id]='cancelled';}};
};

it('overview shows evidence-derived status per category and never leaks payload',async()=>{
 const pending=await outbox('Pending'),done=await outbox('Dispatched',true);
 const data=await readWorkerQueueOverview(db,admin,{scope:'OUTBOX'});
 expect(data.rows.find(r=>r.id===pending)?.status).toBe('PENDING');
 expect(data.rows.find(r=>r.id===done)?.status).toBe('COMPLETED');
 expect(data.counts.some(c=>c.scope==='OUTBOX'&&c.kind==='synthetic_scan'&&c.status==='PENDING'&&c.count>=1)).toBe(true);
 expect(JSON.stringify(data)).not.toContain('SYNTHETIC_PRIVATE');
 await expect(readWorkerQueueOverview(db,staff)).rejects.toThrow();
 await expect(readWorkerQueueOverview(db,admin,{pageSize:7})).rejects.toThrow();
});

it('web only records a request: no job state changes and the request is immutable and idempotent',async()=>{
 const a=await outbox('Pending'),b=await outbox('Pending');
 await expect(requestWorkerQueueClear(db,staff,{action:'CLEAR_ALL',scope:'ALL'})).rejects.toThrow('FORBIDDEN');
 await expect(requestWorkerQueueClear(db,admin,{action:'CLEAR_SELECTED',scope:'ALL',ids:[a]})).rejects.toThrow('JOB_SELECTION_REQUIRED');
 await expect(requestWorkerQueueClear(db,admin,{action:'CLEAR_ALL',scope:'OUTBOX',ids:[a]})).rejects.toThrow('JOB_SELECTION_NOT_ALLOWED');
 expect(await requestWorkerQueueClear(db,admin,{action:'CLEAR_SELECTED',scope:'OUTBOX',ids:[a]})).toEqual({requested:1,alreadyRequested:0});
 expect(await requestWorkerQueueClear(db,admin,{action:'CLEAR_SELECTED',scope:'OUTBOX',ids:[a]})).toEqual({requested:0,alreadyRequested:1});
 expect(await stateOf(a)).toMatchObject({state:'Pending',cancel_epoch:0});
 expect((await readWorkerQueueOverview(db,admin,{status:'CANCEL_REQUESTED'})).rows.map(r=>r.id)).toContain(a);
 await expect(db.query('DELETE FROM worker_queue_clear_request')).rejects.toThrow(/append-only/i);
 expect((await stateOf(b)).state).toBe('Pending');
});

it('worker cancels a Pending job, keeps a completed receipt, and applies the request once',async()=>{
 const pending=await outbox('Pending'),finished=await outbox('Dispatched',true);
 await db.query(`INSERT INTO worker_queue_clear_request(scope,job_id,requested_by,state_before)
  VALUES('OUTBOX',$1,$3,'Pending'),('OUTBOX',$2,$3,'Dispatched')`,[pending,finished,admin.id]);
 const totals=await applyQueueClearRequests(db,undefined);
 expect(totals.pending).toBeGreaterThanOrEqual(0);
 expect(await stateOf(pending)).toMatchObject({state:'Cancelled',cancel_epoch:1});
 expect(await outcome(pending)).toMatchObject({outcome:'CANCELLED'});
 expect(await stateOf(finished)).toMatchObject({state:'Dispatched',cancel_epoch:0});
 expect(await outcome(finished)).toMatchObject({outcome:'COMPLETED_NOT_CHANGED'});
 expect((await db.query('SELECT 1 FROM integration_job_receipt WHERE outbox_id=$1',[finished])).rows).toHaveLength(1);
 expect(await applyQueueClearRequests(db,undefined)).toEqual({resolved:0,pending:expect.any(Number)});
});

it('a dispatched job is cancelled only when pg-boss proves it had not started; otherwise reconciliation is required',async()=>{
 const notStarted=await outbox('Dispatched'),started=await outbox('Dispatched'),gone=await outbox('Dispatched');
 for(const id of [notStarted,started,gone])await db.query("INSERT INTO worker_queue_clear_request(scope,job_id,requested_by,state_before) VALUES('OUTBOX',$1,$2,'Dispatched')",[id,admin.id]);
 // Without pg-boss evidence the request stays unresolved; nothing is called cancelled.
 await applyQueueClearRequests(db,undefined);
 expect(await outcome(notStarted)).toBeUndefined();
 expect(await stateOf(notStarted)).toMatchObject({state:'Dispatched'});
 const boss=fakeBoss({[notStarted]:'created',[started]:'active'});
 await applyQueueClearRequests(db,boss);
 expect(boss.cancelled).toEqual([notStarted]);
 expect(await outcome(notStarted)).toMatchObject({outcome:'CANCELLED',detail:'QUEUE_JOB_CANCELLED_BEFORE_START'});
 expect(await stateOf(notStarted)).toMatchObject({state:'Cancelled',cancel_epoch:1});
 expect(await outcome(started)).toMatchObject({outcome:'RECONCILIATION_REQUIRED',detail:'QUEUE_JOB_ACTIVE'});
 expect(await stateOf(started)).toMatchObject({state:'Dispatched',cancel_epoch:0});
 expect(await outcome(gone)).toMatchObject({outcome:'RECONCILIATION_REQUIRED',detail:'QUEUE_JOB_NOT_FOUND'});
 const status=(await readWorkerQueueOverview(db,admin,{status:'RECONCILIATION_REQUIRED'})).rows.map(r=>r.id);
 expect(status).toEqual(expect.arrayContaining([started,gone]));
});

it('a job that starts while the cancel is applied is not reported cancelled',async()=>{
 const racing=await outbox('Dispatched');
 await db.query("INSERT INTO worker_queue_clear_request(scope,job_id,requested_by,state_before) VALUES('OUTBOX',$1,$2,'Dispatched')",[racing,admin.id]);
 const states:Record<string,string>={[racing]:'created'};
 const boss:BossLike={getJobById:async(_n,id)=>({state:states[id]}),cancel:async(_n,id)=>{states[id]='active';}};
 await applyQueueClearRequests(db,boss);
 expect(await outcome(racing)).toMatchObject({outcome:'RECONCILIATION_REQUIRED',detail:'QUEUE_JOB_STARTED_DURING_CANCEL'});
 expect((await stateOf(racing)).state).toBe('Dispatched');
});

const WINDOW='00000000-0000-4000-8000-000000000113';
async function archiveJob(fields:{state:string;claimed?:boolean;expired?:boolean;lastError?:string}){
 const ids={c:crypto.randomUUID(),v:crypto.randomUUID(),r:crypto.randomUUID(),w:crypto.randomUUID(),rd:crypto.randomUUID()};
 const sha='a'.repeat(63)+Math.floor(Math.random()*16).toString(16)+'';
 await db.exec('BEGIN');
 try{
  await db.exec('SET LOCAL session_replication_role=replica');
  await db.query("INSERT INTO nipt_case(id,registration_origin,identity_key) VALUES($1,'LAB_DIRECT',$2)",[ids.c,ids.c.replace(/-/g,'')+ids.c.replace(/-/g,'')]);
  await db.query("INSERT INTO file_asset(sha256,byte_size,media_type,storage_key) VALUES($1,10,'application/pdf',$1) ON CONFLICT DO NOTHING",[sha]);
  await db.query("INSERT INTO pdf_archive_window(id,root_path,activated_by) VALUES($1,'synthetic-root',$2) ON CONFLICT DO NOTHING",[WINDOW,admin.id]);
  const claim=fields.claimed?`gen_random_uuid(),clock_timestamp()${fields.expired?"-interval '1 hour'":"+interval '10 minutes'"}`:'NULL,NULL';
  await db.query(`INSERT INTO pdf_archive_job(id,window_id,release_id,version_id,case_id,source_sha256,state,last_error,claim_token,claimed_until,archived_at)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,${claim},${fields.state==='ARCHIVED'?'clock_timestamp()':'NULL'})`,[ids.rd,WINDOW,ids.r,ids.v,ids.c,sha,fields.state,fields.lastError??null]);
  await db.exec('COMMIT');
 }catch(e){await db.exec('ROLLBACK');throw e;}
 return ids.rd;
}
const request=async(id:string)=>db.query("INSERT INTO worker_queue_clear_request(scope,job_id,requested_by,state_before) VALUES('ARCHIVE',$1,$2,'x')",[id,admin.id]);
const archive=async(id:string)=>(await db.query<{state:string;cancellation_requested_at:Date|null;last_error:string|null}>('SELECT state,cancellation_requested_at,last_error FROM pdf_archive_job WHERE id=$1',[id])).rows[0];

it('archive: unclaimed unpublished job is cancelled; archived job is untouched',async()=>{
 const pending=await archiveJob({state:'PENDING'}),archived=await archiveJob({state:'ARCHIVED'});
 await request(pending);await request(archived);
 await applyQueueClearRequests(db,undefined);
 expect(await archive(pending)).toMatchObject({state:'CANCELLED'});
 expect(await outcome(pending)).toMatchObject({outcome:'CANCELLED'});
 expect(await archive(archived)).toMatchObject({state:'ARCHIVED'});
 expect(await outcome(archived)).toMatchObject({outcome:'COMPLETED_NOT_CHANGED'});
});

it('archive: a live claim is asked to stop, an expired claim or uncertain publication is never called cancelled',async()=>{
 const live=await archiveJob({state:'PENDING',claimed:true}),expired=await archiveJob({state:'PENDING',claimed:true,expired:true}),
  uncertain=await archiveJob({state:'FAILED',lastError:'ARCHIVE_RECONCILIATION_REQUIRED'});
 for(const id of [live,expired,uncertain])await request(id);
 await applyQueueClearRequests(db,undefined);
 expect((await archive(live)).cancellation_requested_at).not.toBeNull();
 expect((await archive(live)).state).toBe('PENDING');
 expect(await outcome(live)).toBeUndefined();
 expect(await archive(expired)).toMatchObject({state:'FAILED',last_error:'ARCHIVE_RECONCILIATION_REQUIRED'});
 expect(await outcome(expired)).toMatchObject({outcome:'RECONCILIATION_REQUIRED'});
 expect(await archive(uncertain)).toMatchObject({state:'FAILED'});
 expect(await outcome(uncertain)).toMatchObject({outcome:'RECONCILIATION_REQUIRED',detail:'PUBLICATION_UNCERTAIN'});
});
