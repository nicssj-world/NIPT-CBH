import {afterAll,beforeAll,expect,it} from 'vitest';
import {Client} from 'pg';
import {PgBoss} from 'pg-boss';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {assertSyntheticDatabase} from '../../packages/db/connection';
import {migrate} from '../../tools/migrate';
import {requestWorkerQueueClear} from '../../packages/jobs/queue-clear';
import {applyQueueClearRequests} from '../../packages/jobs/queue-clear-worker';
import {readPgBossQueueOverview,readWorkerQueueOverview} from '../../packages/jobs/admin-center';

const url=process.env.NIPT_ARCHIVE_TEST_DATABASE_URL;
let setup:Client,admin:string;
const open=async()=>{const c=new Client({connectionString:url});await c.connect();return c;};
beforeAll(async()=>{
 if(!url)return;
 assertSyntheticDatabase(url);
 setup=await open();
 await migrate(setup);
 await setup.query(await readFile('packages/db/roles.sql','utf8'));
 admin=(await setup.query<{id:string}>("INSERT INTO app_user(username,display_name,password_hash) VALUES('synthetic.native113','Synthetic','$argon2id$v=19$synthetic') RETURNING id")).rows[0].id;
 await setup.query("INSERT INTO role_assignment(user_id,role) VALUES($1,'APP_ADMIN')",[admin]);
});
afterAll(async()=>{await setup?.end();});

const job=async(state:string)=>(await setup.query<{id:string}>("INSERT INTO job_outbox(kind,payload,idempotency_key,state) VALUES('synthetic_scan','{}',gen_random_uuid()::text,$1) RETURNING id",[state])).rows[0].id;
const asRole=async<T>(role:string,body:(c:Client)=>Promise<T>)=>{
 const c=await open();
 try{await c.query('BEGIN');await c.query(`SET LOCAL ROLE ${role}`);return await body(c);}finally{await c.query('ROLLBACK').catch(()=>{});await c.end();}
};
const denied=async(c:Client,sql:string,args:unknown[]=[])=>{
 await c.query('SAVEPOINT s');
 await expect(c.query(sql,args)).rejects.toThrow(/permission denied|append-only|row-level/i);
 await c.query('ROLLBACK TO SAVEPOINT s');
};

it.skipIf(!url)('role boundaries: web requests, Worker records outcomes, nobody edits or deletes either',async()=>{
 const id=await job('Pending'),archiveRequest=randomUUID();
 await asRole('app_rw',async c=>{
  await c.query("INSERT INTO worker_queue_clear_request(scope,job_id,requested_by,state_before) VALUES('OUTBOX',$1,$2,'Pending')",[id,admin]);
  await denied(c,"INSERT INTO worker_queue_clear_outcome(request_id,outcome) SELECT id,'CANCELLED' FROM worker_queue_clear_request");
  await denied(c,'UPDATE worker_queue_clear_request SET state_before=\'x\'');
  await denied(c,'DELETE FROM worker_queue_clear_request');
  await denied(c,"UPDATE pdf_archive_job SET state='CANCELLED'");
  await denied(c,"UPDATE pdf_archive_job SET cancellation_requested_at=now()");
  void archiveRequest;
 });
 await setup.query("INSERT INTO worker_queue_clear_request(scope,job_id,requested_by,state_before) VALUES('OUTBOX',$1,$2,'Pending') ON CONFLICT DO NOTHING",[id,admin]);
 await asRole('worker_rw',async c=>{
  await denied(c,"INSERT INTO worker_queue_clear_request(scope,job_id,requested_by,state_before) VALUES('OUTBOX',gen_random_uuid(),$1,'x')",[admin]);
  await c.query("INSERT INTO worker_queue_clear_outcome(request_id,outcome) SELECT id,'CANCELLED' FROM worker_queue_clear_request WHERE job_id=$1",[id]);
  await denied(c,"UPDATE worker_queue_clear_outcome SET outcome='COMPLETED_NOT_CHANGED'");
  await denied(c,'DELETE FROM worker_queue_clear_outcome');
 });
});

it.skipIf(!url)('two workers applying the same requests concurrently cancel each job once and record one outcome',async()=>{
 const ids=[await job('Pending'),await job('Pending'),await job('Pending')];
 for(const id of ids)await setup.query("INSERT INTO worker_queue_clear_request(scope,job_id,requested_by,state_before) VALUES('OUTBOX',$1,$2,'Pending')",[id,admin]);
 const run=async()=>{
  const c=await open();
  try{await c.query('BEGIN');await c.query('SET LOCAL ROLE worker_rw');const r=await applyQueueClearRequests(c);await c.query('COMMIT');return r;}
  catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{await c.end();}
 };
 await Promise.all([run(),run(),run()]);
 const rows=(await setup.query<{state:string;cancel_epoch:number;n:string}>(`SELECT j.state,j.cancel_epoch,(SELECT count(*)::text FROM worker_queue_clear_outcome o JOIN worker_queue_clear_request q ON q.id=o.request_id WHERE q.job_id=j.id) n
  FROM job_outbox j WHERE j.id=ANY($1::uuid[])`,[ids])).rows;
 expect(rows).toEqual(ids.map(()=>({state:'Cancelled',cancel_epoch:1,n:'1'})));
});

it.skipIf(!url)('real pg-boss: a queued job is cancelled through the API; a started job requires reconciliation; overview columns are valid',async()=>{
 const boss=new PgBoss(url!);
 boss.on('error',()=>undefined);
 await boss.start();
 try{
  await boss.createQueue('synthetic_scan');
  const queued=await job('Dispatched'),started=await job('Dispatched');
  await boss.send('synthetic_scan',{outboxId:queued},{id:queued,startAfter:3600});
  await boss.send('synthetic_scan',{outboxId:started},{id:started});
  const fetched=await boss.fetch('synthetic_scan',{batchSize:5});
  expect(fetched.map(j=>j.id)).toContain(started);
  for(const id of [queued,started])await setup.query("INSERT INTO worker_queue_clear_request(scope,job_id,requested_by,state_before) VALUES('OUTBOX',$1,$2,'Dispatched')",[id,admin]);
  const totals=await applyQueueClearRequests(setup,boss);
  expect(totals.resolved).toBeGreaterThanOrEqual(2);
  const outcomes=Object.fromEntries((await setup.query<{job_id:string;outcome:string;detail:string}>(`SELECT q.job_id,o.outcome,o.detail FROM worker_queue_clear_outcome o JOIN worker_queue_clear_request q ON q.id=o.request_id WHERE q.job_id=ANY($1::uuid[])`,[[queued,started]])).rows.map(r=>[r.job_id,r]));
  expect(outcomes[queued]).toMatchObject({outcome:'CANCELLED',detail:'QUEUE_JOB_CANCELLED_BEFORE_START'});
  expect(outcomes[started]).toMatchObject({outcome:'RECONCILIATION_REQUIRED',detail:'QUEUE_JOB_ACTIVE'});
  expect((await boss.getJobById('synthetic_scan',queued))?.state).toBe('cancelled');
  expect((await setup.query('SELECT state FROM job_outbox WHERE id=$1',[started])).rows[0]).toEqual({state:'Dispatched'});
  // The Admin page reads the same data through the restricted web role.
  const principal={id:admin,roles:['APP_ADMIN' as const],unitIds:[],permissions:[]};
  const overview=await asRole('app_rw',async c=>({boss:await readPgBossQueueOverview(c,principal),queue:await readWorkerQueueOverview(c,principal,{scope:'OUTBOX'})}));
  expect(overview.boss.counts.some(r=>r.kind==='synthetic_scan'&&r.job_state==='cancelled')).toBe(true);
  expect(overview.boss.items.some(r=>r.job_id===started&&r.job_state==='active')).toBe(true);
  expect(overview.queue.rows.find(r=>r.id===started)?.status).toBe('RECONCILIATION_REQUIRED');
  expect(overview.queue.rows.find(r=>r.id===queued)?.status).toBe('CANCELLED');
 }finally{await boss.stop({graceful:false});}
});

it.skipIf(!url)('web request path works as app_rw end to end and cannot change job state itself',async()=>{
 const id=await job('Pending');
 const principal={id:admin,roles:['APP_ADMIN' as const],unitIds:[],permissions:[]};
 const c=await open();
 try{
  await c.query('BEGIN');await c.query('SET LOCAL ROLE app_rw');
  expect(await requestWorkerQueueClear(c,principal,{action:'CLEAR_SELECTED',scope:'OUTBOX',ids:[id]})).toEqual({requested:1,alreadyRequested:0});
  await c.query('RESET ROLE');await c.query('COMMIT');
 }finally{await c.end();}
 expect((await setup.query('SELECT state,cancel_epoch FROM job_outbox WHERE id=$1',[id])).rows[0]).toEqual({state:'Pending',cancel_epoch:0});
});
