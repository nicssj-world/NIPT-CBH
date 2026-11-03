import {afterAll,beforeAll,expect,it} from 'vitest';
import {Client} from 'pg';
import {PgBoss} from 'pg-boss';
import {readFile} from 'node:fs/promises';
import {assertSyntheticDatabase} from '../../packages/db/connection';
import {migrate} from '../../tools/migrate';
import {requestWorkerQueueClear} from '../../packages/jobs/queue-clear';
import {requestWorkerQueueRetry} from '../../packages/jobs/queue-retry';
import {applyQueueClearRequests} from '../../packages/jobs/queue-clear-worker';
import {applyQueueRetryRequests} from '../../packages/jobs/queue-retry-worker';
import {readWorkerQueueOverview} from '../../packages/jobs/admin-center';

// Real PostgreSQL 17 and real pg-boss 12. A "restart" is a second PgBoss instance on new connections after the first one stopped
// without finishing its job, which is exactly what the Worker process looks like to the database after a crash.
const url=process.env.NIPT_ARCHIVE_TEST_DATABASE_URL;
const KIND='synthetic_scan';
let setup:Client,admin:string;
const open=async()=>{const c=new Client({connectionString:url});await c.connect();return c;};
const principal=()=>({id:admin,roles:['APP_ADMIN' as const],unitIds:[],permissions:[]});
const newBoss=async()=>{const b=new PgBoss(url!);b.on('error',()=>undefined);await b.start();await b.createQueue(KIND);await b.updateQueue(KIND,{retryLimit:0});return b;};   // updateQueue: the queue may already exist from another test file with default retries
const outbox=async()=>(await setup.query<{id:string}>("INSERT INTO job_outbox(kind,payload,idempotency_key,state) VALUES($1,'{}',gen_random_uuid()::text,'Dispatched') RETURNING id",[KIND])).rows[0].id;
const status=async(id:string)=>{const c=await open();try{await c.query('BEGIN');await c.query('SET LOCAL ROLE app_rw');const d=await readWorkerQueueOverview(c,principal(),{pageSize:100});await c.query('ROLLBACK');return d.rows.find(r=>r.id===id)?.status;}finally{await c.end();}};
const inTx=async<T>(role:string,fn:(c:Client)=>Promise<T>)=>{const c=await open();try{await c.query('BEGIN');await c.query(`SET LOCAL ROLE ${role}`);const r=await fn(c);await c.query('COMMIT');return r;}catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{await c.end();}};
const retryOutcome=async(id:string)=>(await setup.query<{outcome:string;reason:string}>('SELECT o.outcome,o.reason FROM worker_queue_retry_outcome o JOIN worker_queue_retry_request r ON r.id=o.request_id WHERE r.job_id=$1 ORDER BY r.requested_at DESC LIMIT 1',[id])).rows[0];

beforeAll(async()=>{
 if(!url)return;
 assertSyntheticDatabase(url);
 setup=await open();await migrate(setup);await setup.query(await readFile('packages/db/roles.sql','utf8'));
 admin=(await setup.query<{id:string}>("INSERT INTO app_user(username,display_name,password_hash) VALUES('synthetic.recovery113','Synthetic','$argon2id$v=19$synthetic') RETURNING id")).rows[0].id;
 await setup.query("INSERT INTO role_assignment(user_id,role) VALUES($1,'APP_ADMIN')",[admin]);
});
afterAll(async()=>{await setup?.end();});

it.skipIf(!url)('worker crash mid-job: the job stays RUNNING, a clear is never reported cancelled, nothing is lost',async()=>{
 const id=await outbox();
 const first=await newBoss();
 await first.send(KIND,{outboxId:id},{id});
 expect(await status(id)).toBe('DISPATCHED');
 const fetched=await first.fetch(KIND);expect(fetched.map(j=>j.id)).toEqual([id]);
 await first.stop({graceful:false});   // crash: the job was fetched and never finished
 const restarted=await newBoss();
 try{
  expect((await restarted.getJobById(KIND,id))?.state).toBe('active');
  expect(await status(id)).toBe('RUNNING');
  await inTx('app_rw',c=>requestWorkerQueueClear(c,principal(),{action:'CLEAR_SELECTED',scope:'OUTBOX',ids:[id]}));
  await applyQueueClearRequests(setup,restarted);
  expect(await status(id)).toBe('RECONCILIATION_REQUIRED');
  expect((await restarted.getJobById(KIND,id))?.state).toBe('active');           // not cancelled behind the operator's back
  expect((await setup.query('SELECT state,cancel_epoch FROM job_outbox WHERE id=$1',[id])).rows[0]).toEqual({state:'Dispatched',cancel_epoch:0});
  // a retry of a job that may still be running or have run is refused
  await inTx('app_rw',c=>requestWorkerQueueRetry(c,principal(),{scope:'OUTBOX',ids:[id]}));
  await applyQueueRetryRequests(setup,restarted);
  expect(await retryOutcome(id)).toMatchObject({outcome:'REFUSED',reason:'CLEAR_REQUESTED'});
 }finally{await restarted.stop({graceful:false});}
});

it.skipIf(!url)('a failed queue job is retried once through the pg-boss API; completion plus receipt ends it; a second request is refused',async()=>{
 const id=await outbox();
 const boss=await newBoss();
 try{
  await boss.send(KIND,{outboxId:id},{id});
  const [job]=await boss.fetch(KIND);expect(job.id).toBe(id);
  await boss.fail(KIND,id,{message:'WORKER_TIMEOUT'});
  expect((await boss.getJobById(KIND,id))?.state).toBe('failed');
  expect(await status(id)).toBe('FAILED');
  // Two tabs click Retry at once: one open request.
  const results=await Promise.all([1,2].map(()=>inTx('app_rw',c=>requestWorkerQueueRetry(c,principal(),{scope:'OUTBOX',ids:[id]}))));
  expect(results.map(r=>r.requested).sort()).toEqual([0,1]);
  expect(await status(id)).toBe('RETRY_REQUESTED');
  // Two Workers apply it at once: pg-boss is asked to retry exactly once.
  let calls=0;const counted={getJobById:boss.getJobById.bind(boss),retry:async(n:string,i:string)=>{calls++;return boss.retry(n,i);}};
  await Promise.all([1,2].map(()=>inTx('worker_rw',c=>applyQueueRetryRequests(c,counted))));
  expect(calls).toBe(1);
  expect(await retryOutcome(id)).toMatchObject({outcome:'RETRIED'});
  expect((await boss.getJobById(KIND,id))?.state).toBe('retry');
  expect(await status(id)).toBe('RETRY');
  // The retried job is picked up, completes and leaves its receipt (what the real handler does).
  const again=await boss.fetch(KIND);expect(again.map(j=>j.id)).toEqual([id]);
  await boss.complete(KIND,id,{});
  await setup.query("INSERT INTO integration_job_receipt(outbox_id,result) VALUES($1,'{}')",[id]);
  expect(await status(id)).toBe('COMPLETED');
  await inTx('app_rw',c=>requestWorkerQueueRetry(c,principal(),{scope:'OUTBOX',ids:[id]}));
  await applyQueueRetryRequests(setup,boss);
  expect(await retryOutcome(id)).toMatchObject({outcome:'REFUSED',reason:'RECEIPT_EXISTS'});
  expect((await boss.getJobById(KIND,id))?.state).toBe('completed');
 }finally{await boss.stop({graceful:false});}
});

it.skipIf(!url)('a dispatched job whose queue job is gone is shown for reconciliation, never guessed',async()=>{
 const boss=await newBoss();
 try{
  const id=await outbox();
  expect(await status(id)).toBe('RECONCILIATION_REQUIRED');   // schema exists (started above) but holds no such job
  await boss.send(KIND,{outboxId:id},{id});
  expect(await status(id)).toBe('DISPATCHED');
 }finally{await boss.stop({graceful:false});}
});

it.skipIf(!url)('role boundaries for retry: web only requests, Worker only records outcomes, neither edits history',async()=>{
 const id=await outbox();
 await inTx('app_rw',c=>requestWorkerQueueRetry(c,principal(),{scope:'OUTBOX',ids:[id]}));
 const denied=async(role:string,sql:string,args:unknown[]=[])=>{const c=await open();try{await c.query('BEGIN');await c.query(`SET LOCAL ROLE ${role}`);await c.query(sql,args);return 'OK';}catch(e){return String((e as Error).message);}finally{await c.query('ROLLBACK').catch(()=>{});await c.end();}};
 expect(await denied('app_rw',"INSERT INTO worker_queue_retry_outcome(request_id,outcome,reason) SELECT id,'RETRIED','QUEUE_JOB_RETRIED' FROM worker_queue_retry_request")).toMatch(/permission denied/i);
 expect(await denied('worker_rw','INSERT INTO worker_queue_retry_request(job_id,requested_by) VALUES(gen_random_uuid(),$1)',[admin])).toMatch(/permission denied/i);
 expect(await denied('app_rw','DELETE FROM worker_queue_retry_request')).toMatch(/permission denied/i);
 expect(await denied('worker_rw','UPDATE worker_queue_retry_outcome SET outcome=\'RETRIED\'')).toMatch(/permission denied/i);
 expect(await denied('app_rw','SELECT * FROM nipt_pg_boss_state_of(ARRAY[gen_random_uuid()])')).toBe('OK');
});
