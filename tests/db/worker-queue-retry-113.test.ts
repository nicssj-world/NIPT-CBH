import {beforeAll,afterAll,it,expect,vi} from 'vitest';
import type {PGlite} from '@electric-sql/pglite';
import {randomUUID} from 'node:crypto';
import {testDatabase,addUser} from '../helpers/database';
import {readWorkerQueueOverview} from '../../packages/jobs/admin-center';
import {requestWorkerQueueRetry,RETRY_SAFE_KINDS} from '../../packages/jobs/queue-retry';
import {applyQueueRetryRequests,type RetryBossLike} from '../../packages/jobs/queue-retry-worker';
import {requestWorkerQueueClear} from '../../packages/jobs/queue-clear';
import {requestHisRetry} from '../../packages/settings/his-monitoring';
import {registerFixture,reserveFixture} from '../../packages/p6/journal';
import {syntheticProfile} from '../../packages/p6/res';
import type {SyntheticDraft} from '../../packages/p6/transfer';
import type {Principal} from '../../packages/security/policy';

const sandboxId='SYNTHETIC-'+randomUUID();
const make=(n:number):SyntheticDraft=>({fixtureId:`SYNTHETIC-WORKFLOW-${n}`,reportVersionId:`SYNTHETIC-VERSION-${n}`,roundId:`SYNTHETIC-ROUND-${n}`,attemptId:`SYNTHETIC-ATTEMPT-${n}`,origin:'LAB_DIRECT',lnGeneration:1,roundNumber:1,epoch:0,input:{order:{ln:`99000${String(n).padStart(7,'0')}`,hn:`SYNTHETIC-HN-${n}`,dspname:'นาง SYNTHETIC  SYNTHETIC',dob:'20000101',sex:'F',specimen_date:'20261010070000'},result:null,generatedAt:'20261011123456',approvedAt:'20261011110000',certifierHisId:'SYNTHETIC^SYNTHETIC'},profile:{...syntheticProfile},pdf:Buffer.from('%PDF-1.4 SYNTHETIC'),settings:{version:'SYNTHETIC-CONFIG-1',resDirectory:'simulator/p6/res',pdfDirectory:'simulator/p6/cfs',backupDirectory:'simulator/p6/backup',retryDelaysMs:[1,2],confirmationTimeoutMs:1000}});
let db:PGlite,admin:Principal,staff:Principal;
beforeAll(async()=>{vi.stubEnv('NIPT_MODE','synthetic');db=await testDatabase();admin=await addUser(db,'APP_ADMIN','synthetic.retry113.admin');staff=await addUser(db,'LAB_STAFF','synthetic.retry113.lab');});
afterAll(async()=>{await db?.close();vi.unstubAllEnvs();});

const job=async(kind:string,state='Dispatched',receipt=false)=>{
 const id=(await db.query<{id:string}>("INSERT INTO job_outbox(kind,payload,idempotency_key,state) VALUES($1,'{}',gen_random_uuid()::text,$2) RETURNING id",[kind,state])).rows[0].id;
 if(receipt)await db.query("INSERT INTO integration_job_receipt(outbox_id,result) VALUES($1,'{}')",[id]);
 return id;
};
const outcome=async(id:string)=>(await db.query<{outcome:string;reason:string}>('SELECT o.outcome,o.reason FROM worker_queue_retry_outcome o JOIN worker_queue_retry_request r ON r.id=o.request_id WHERE r.job_id=$1 ORDER BY r.requested_at DESC LIMIT 1',[id])).rows[0];
const request=(ids:string[])=>requestWorkerQueueRetry(db,admin,{scope:'OUTBOX',ids});
const boss=(states:Record<string,string>):RetryBossLike&{retried:string[]}=>{
 const retried:string[]=[];
 return {retried,getJobById:async(_n,id)=>states[id]?{state:states[id]}:null,retry:async(_n,id)=>{retried.push(id);if(states[id]==='failed')states[id]='retry';}};
};

it('the retry request is admin-only, idempotent while open, and immutable',async()=>{
 const id=await job('synthetic_scan');
 await expect(requestWorkerQueueRetry(db,staff,{scope:'OUTBOX',ids:[id]})).rejects.toThrow('FORBIDDEN');
 await expect(requestWorkerQueueRetry(db,admin,{scope:'OUTBOX',ids:[]})).rejects.toThrow();
 await expect(requestWorkerQueueRetry(db,admin,{scope:'ARCHIVE',ids:[id]} as never)).rejects.toThrow();
 expect(await request([id,randomUUID()])).toEqual({requested:1,alreadyRequested:0,unknown:1});
 expect(await request([id])).toEqual({requested:0,alreadyRequested:1,unknown:0});
 await expect(db.query('DELETE FROM worker_queue_retry_request')).rejects.toThrow(/append-only/i);
 expect((await readWorkerQueueOverview(db,admin,{status:'RETRY_REQUESTED'})).rows.map(r=>r.id)).toContain(id);
});

it('a retry is refused when an effect may exist, and never changes the job',async()=>{
 const withReceipt=await job('synthetic_scan','Dispatched',true),exportJob=await job('synthetic_export'),hisRetry=await job('synthetic_outbound_retry'),
  cleared=await job('synthetic_scan'),cancelled=await job('synthetic_scan','Cancelled'),pending=await job('synthetic_scan','Pending');
 await db.query("INSERT INTO worker_queue_clear_request(scope,job_id,requested_by,state_before) VALUES('OUTBOX',$1,$2,'Dispatched')",[cleared,admin.id]);
 const ids=[withReceipt,exportJob,hisRetry,cleared,cancelled,pending];
 await request(ids);
 const b=boss(Object.fromEntries(ids.map(i=>[i,'failed'])));
 await applyQueueRetryRequests(db,b);
 expect(b.retried).toEqual([]);
 const reasons=await Promise.all(ids.map(async i=>(await outcome(i))?.reason));
 expect(reasons).toEqual(['RECEIPT_EXISTS','KIND_NOT_RETRY_SAFE','KIND_NOT_RETRY_SAFE','CLEAR_REQUESTED','JOB_CANCELLED','NOT_DISPATCHED']);
 expect((RETRY_SAFE_KINDS as readonly string[]).includes('synthetic_export')).toBe(false);
 expect((RETRY_SAFE_KINDS as readonly string[]).includes('synthetic_outbound_retry')).toBe(false);
 expect((await db.query<{state:string}>('SELECT state FROM job_outbox WHERE id=$1',[exportJob])).rows[0].state).toBe('Dispatched');
});

it('only a queue job that pg-boss reports failed is retried; the second click cannot retry it twice',async()=>{
 const failed=await job('synthetic_scan'),active=await job('synthetic_scan'),gone=await job('synthetic_pdf'),release=await job('result_release_completed');
 const states:Record<string,string>={[failed]:'failed',[active]:'active',[release]:'failed'};
 const b=boss(states);
 await request([failed,active,gone,release]);
 expect(await applyQueueRetryRequests(db,undefined)).toMatchObject({retried:0});
 expect(await outcome(failed)).toBeUndefined();
 const totals=await applyQueueRetryRequests(db,b);
 expect([...b.retried].sort()).toEqual([failed,release].sort());
 expect(totals.retried).toBe(2);
 expect(await outcome(failed)).toMatchObject({outcome:'RETRIED'});
 expect(await outcome(active)).toMatchObject({outcome:'REFUSED',reason:'QUEUE_JOB_NOT_FAILED'});
 expect(await outcome(gone)).toMatchObject({outcome:'REFUSED',reason:'QUEUE_JOB_MISSING'});
 // The retried job has moved on; a second request is refused rather than retried again.
 states[failed]='completed';
 await request([failed]);
 await applyQueueRetryRequests(db,b);
 expect(await outcome(failed)).toMatchObject({outcome:'REFUSED',reason:'QUEUE_JOB_NOT_FAILED'});
 expect(b.retried.filter(i=>i===failed)).toHaveLength(1);
 expect(await applyQueueRetryRequests(db,b)).toEqual({retried:0,refused:0,pending:0});
});

it('a clear requested after a retry request wins: the retry is refused',async()=>{
 const id=await job('synthetic_scan');
 await request([id]);
 await requestWorkerQueueClear(db,admin,{action:'CLEAR_SELECTED',scope:'OUTBOX',ids:[id]});
 const b=boss({[id]:'failed'});
 await applyQueueRetryRequests(db,b);
 expect(b.retried).toEqual([]);
 expect(await outcome(id)).toMatchObject({reason:'CLEAR_REQUESTED'});
});

it('HIS transfers are listed with honest statuses; only RETRY_PENDING can be retried and unknown outcomes never are',async()=>{
 const ids:Record<string,string>={};
 let n=700;
 for(const state of ['PREPARED','AWAITING_CONFIRMATION','PICKED_UP_UNCONFIRMED','UNKNOWN_TIMEOUT','RETRY_PENDING','SYNTHETIC_CONFIRMED','CANCELLED']){
  const d=make(n++);
  await registerFixture(db,d,sandboxId);
  const t=await reserveFixture(db,d.fixtureId);
  ids[state]=t.id;
  await db.exec('BEGIN');
  try{
   await db.exec('SET LOCAL session_replication_role=replica');
   await db.query("UPDATE p6_transfer SET model=jsonb_set(model,'{state}',to_jsonb($2::text)) WHERE id=$1",[t.id,state]);
   await db.exec('COMMIT');
  }catch(e){await db.exec('ROLLBACK');throw e;}
 }
 const d=await readWorkerQueueOverview(db,admin,{scope:'HIS_TRANSFER',pageSize:100});
 const status=Object.fromEntries(d.rows.map(r=>[r.id,r.status]));
 expect(status[ids.PREPARED]).toBe('RUNNING');
 expect(status[ids.AWAITING_CONFIRMATION]).toBe('AWAITING_HIS');
 expect(status[ids.PICKED_UP_UNCONFIRMED]).toBe('AWAITING_HIS');
 expect(status[ids.UNKNOWN_TIMEOUT]).toBe('RECONCILIATION_REQUIRED');
 expect(status[ids.RETRY_PENDING]).toBe('RETRY');
 expect(status[ids.SYNTHETIC_CONFIRMED]).toBe('COMPLETED');
 expect(status[ids.CANCELLED]).toBe('CANCELLED');
 expect(JSON.stringify(d)).not.toMatch(/SYNTHETIC-HN|dspname|res_destination/);
 for(const state of ['PREPARED','AWAITING_CONFIRMATION','PICKED_UP_UNCONFIRMED','UNKNOWN_TIMEOUT','SYNTHETIC_CONFIRMED','CANCELLED'])
  await expect(requestHisRetry(db,admin,ids[state])).rejects.toThrow(/HIS_RETRY_NOT_ALLOWED|FORBIDDEN/);
 expect((await db.query("SELECT 1 FROM job_outbox WHERE kind='synthetic_outbound_retry' AND payload ? 'transferId'")).rows).toHaveLength(0);
 await expect(requestWorkerQueueClear(db,admin,{action:'CLEAR_SELECTED',scope:'ALL',ids:[ids.UNKNOWN_TIMEOUT]})).rejects.toThrow();
});
