import {beforeAll,afterAll,it,expect,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import type {PGlite} from '@electric-sql/pglite';
import {testDatabase,addUser} from '../helpers/database';
import {tx} from '../helpers/lab';
import type {Staff} from '../../packages/lab/core';
import {FileStore} from '../../packages/storage';
import {finalizeReports,batchZip} from '../../packages/readygen/reports';
import {readArchive,writeArchive} from '../../packages/workbook/archive';
import {enqueueReportBatch,readReportBatch,listReportBatches,runReportBatchItem,reportBatchZip,REPORT_BATCH_JOB} from '../../packages/readygen/batch-jobs';

vi.mock('../../packages/readygen/reports',()=>({finalizeReports:vi.fn(),batchZip:vi.fn()}));
let db:PGlite,user:Staff,other:Staff;
const deps={store:new FileStore('.local/dev/data/batch-tests')};
const confirmation={reportContentVerified:true,identityAndValuesMatchReport:true,disclosureReviewed:true,abnormalAcknowledged:true} as const;
const request=()=>({idempotencyKey:randomUUID(),release:true,releaseConfirmations:confirmation,items:[{rowId:randomUUID()},{rowId:randomUUID()}]});
beforeAll(async()=>{vi.stubEnv('NIPT_MODE','operational');vi.stubEnv('APP_ORIGIN','https://synthetic.invalid');db=await testDatabase();user=await addUser(db,'APP_ADMIN','synthetic.batch');other=await addUser(db,'APP_ADMIN','synthetic.other');},120000);
afterAll(async()=>{await db?.close();vi.unstubAllEnvs();});

it('enqueues one immutable request and per-item outbox jobs; replay and refresh retain identity-bound status',async()=>{
 const input=request(),batch=await tx(db,t=>enqueueReportBatch(t,user,input));
 expect(batch.state).toBe('QUEUED');expect(batch.total).toBe(2);
 expect((await db.query('SELECT * FROM job_outbox WHERE kind=$1',[REPORT_BATCH_JOB])).rows).toHaveLength(2);
 expect((await tx(db,t=>enqueueReportBatch(t,user,input))).batchId).toBe(batch.batchId);
 await expect(tx(db,t=>enqueueReportBatch(t,user,{...input,items:[input.items[0]]}))).rejects.toThrow('IDEMPOTENCY_KEY_REUSED');
 await expect(readReportBatch(db,other,batch.batchId)).rejects.toThrow('NOT_FOUND');
 expect((await listReportBatches(db,user)).items.some(x=>x.batchId===batch.batchId)).toBe(true);
 expect((await listReportBatches(db,other)).items).toEqual([]);
});

it('commits partial outcomes and replays safely after a worker loses its receipt, preserving original finalization ZIP IDs',async()=>{
 const input=request(),batch=await tx(db,t=>enqueueReportBatch(t,user,input));
 const jobs=(await db.query<{id:string;payload:{itemId:string}}>('SELECT j.id,j.payload FROM job_outbox j JOIN internal_report_request_item i ON i.outbox_id=j.id WHERE i.request_id=$1 ORDER BY i.ordinal',[batch.batchId])).rows;
 const finalized=randomUUID();
 vi.mocked(finalizeReports).mockImplementationOnce(async(t,actor,_deps,raw)=>{await t.query("INSERT INTO internal_report_batch(id,operator_id,idempotency_key,requested,outcome) VALUES($1,$2,$3,'{}','[]')",[finalized,actor.id,(raw as {idempotencyKey:string}).idempotencyKey]);return {batchId:finalized,replayed:false,items:[{rowId:input.items[0].rowId,outcome:'FINAL',versionId:randomUUID()}]};});
 const first=await tx(db,t=>runReportBatchItem(t,jobs[0].id,jobs[0].payload,deps));
 expect(first.state).toBe('FINAL');
 const calls=vi.mocked(finalizeReports).mock.calls.length;
 expect(await tx(db,t=>runReportBatchItem(t,jobs[0].id,jobs[0].payload,deps))).toEqual(first);
 expect(vi.mocked(finalizeReports).mock.calls).toHaveLength(calls);
 const running=await readReportBatch(db,user,batch.batchId);expect(running.completed).toBe(1);expect(running.state).toBe('RUNNING');
 vi.mocked(finalizeReports).mockImplementationOnce(async(t,actor,_deps,raw)=>{const id=randomUUID();await t.query("INSERT INTO internal_report_batch(id,operator_id,idempotency_key,requested,outcome) VALUES($1,$2,$3,'{}','[]')",[id,actor.id,(raw as {idempotencyKey:string}).idempotencyKey]);return {batchId:id,replayed:false,items:[{rowId:input.items[1].rowId,outcome:'HOLD',holds:[{code:'CONSENT_REVOKED'}]}]};});
 await tx(db,t=>runReportBatchItem(t,jobs[1].id,jobs[1].payload,deps));
 const finished=await readReportBatch(db,user,batch.batchId);expect(finished.state).toBe('COMPLETED');expect(finished.completed).toBe(2);
 expect(finished.items.map(x=>x.outcome?.outcome)).toEqual(['FINAL','HOLD']);expect(finished.zipBatchIds).toContain(finalized);
 const sent=vi.mocked(finalizeReports).mock.calls.at(-1)!;
 expect(sent[1].roles).toContain('APP_ADMIN');expect(sent[3]).toMatchObject({items:[input.items[1]],release:true});
 // One parent download combines each child's existing ZIP without losing the original PDF bytes or hold outcomes.
 vi.mocked(batchZip).mockImplementation(async(_t,_actor,_store,id)=>{const name='pdf/001-synthetic.pdf',files=id===finalized?[{name:'run042569_0001_0002.pdf',zipMember:name,internalReportId:randomUUID(),versionId:null,sha256:'a'.repeat(64)}]:[];
  const parts=new Map<string,Buffer>();if(files.length)parts.set(name,Buffer.from('original PDF bytes'));parts.set('manifest.json',Buffer.from('{}'));
  return {bytes:writeArchive(parts),filename:'child.zip',manifest:{batchId:id,createdAt:new Date(),operatorId:user.id,files,notIncluded:[]}};
 });
 const zip=await reportBatchZip(db,user,deps.store,batch.batchId),parts=readArchive(zip.bytes),manifest=JSON.parse(parts.get('manifest.json')!.toString());
 expect(manifest.files).toHaveLength(1);expect(parts.get(manifest.files[0].zipMember)?.toString()).toBe('original PDF bytes');expect(manifest.items[1].outcome.outcome).toBe('HOLD');
 await expect(reportBatchZip(db,other,deps.store,batch.batchId)).rejects.toThrow('NOT_FOUND');
});

it('rechecks current actor authority and never fabricates session, roles or release confirmations',async()=>{
 await expect(tx(db,t=>enqueueReportBatch(t,user,{...request(),releaseConfirmations:undefined}))).rejects.toThrow();
 const actor=await addUser(db,'APP_ADMIN','synthetic.revoked'),input=request(),batch=await tx(db,t=>enqueueReportBatch(t,actor,input));
 const job=(await db.query<{id:string;payload:unknown}>('SELECT j.id,j.payload FROM job_outbox j JOIN internal_report_request_item i ON i.outbox_id=j.id WHERE i.request_id=$1 ORDER BY i.ordinal',[batch.batchId])).rows[0];
 await db.query('UPDATE app_user SET enabled=false WHERE id=$1',[actor.id]);
 const calls=vi.mocked(finalizeReports).mock.calls.length;
 expect(await tx(db,t=>runReportBatchItem(t,job.id,job.payload,deps))).toMatchObject({state:'ERROR',code:'FORBIDDEN'});
 expect(vi.mocked(finalizeReports).mock.calls).toHaveLength(calls);
});

it('rolls back interrupted work and retries the same item key, then exposes exhausted renderer failures',async()=>{
 const input=request(),batch=await tx(db,t=>enqueueReportBatch(t,user,input));
 const job=(await db.query<{id:string;payload:unknown}>('SELECT j.id,j.payload FROM job_outbox j JOIN internal_report_request_item i ON i.outbox_id=j.id WHERE i.request_id=$1 ORDER BY i.ordinal',[batch.batchId])).rows[0];
 vi.mocked(finalizeReports).mockRejectedValueOnce(Error('WORD_UNAVAILABLE'));
 await expect(tx(db,t=>runReportBatchItem(t,job.id,job.payload,deps,0))).rejects.toThrow('WORD_UNAVAILABLE');
 expect((await readReportBatch(db,user,batch.batchId)).completed).toBe(0);
 const key=(vi.mocked(finalizeReports).mock.calls.at(-1)![3] as {idempotencyKey:string}).idempotencyKey;
 vi.mocked(finalizeReports).mockRejectedValueOnce(Error('WORD_UNAVAILABLE'));
 expect(await tx(db,t=>runReportBatchItem(t,job.id,job.payload,deps,3))).toMatchObject({state:'ERROR',code:'WORD_UNAVAILABLE'});
 expect((vi.mocked(finalizeReports).mock.calls.at(-1)![3] as {idempotencyKey:string}).idempotencyKey).toBe(key);
 expect((await readReportBatch(db,user,batch.batchId)).items[0].outcome?.code).toBe('WORD_UNAVAILABLE');
});

it('a suspended or revoked originating session prevents the worker from signing after enqueue',async()=>{
 const sid=(await db.query<{id:string}>("INSERT INTO app_session(user_id,token_hash,csrf_hash,idle_expires_at,absolute_expires_at) VALUES($1,$2,$3,now()+interval '30 minutes',now()+interval '8 hours') RETURNING id",[user.id,'a'.repeat(64),'b'.repeat(64)])).rows[0].id;
 const actor={...user,sessionId:sid},batch=await tx(db,t=>enqueueReportBatch(t,actor,request()));
 const job=(await db.query<{id:string;payload:unknown}>('SELECT j.id,j.payload FROM job_outbox j JOIN internal_report_request_item i ON i.outbox_id=j.id WHERE i.request_id=$1 ORDER BY i.ordinal',[batch.batchId])).rows[0];
 await db.query('UPDATE app_session SET signing_suspended=true WHERE id=$1',[sid]);
 const calls=vi.mocked(finalizeReports).mock.calls.length;
 expect(await tx(db,t=>runReportBatchItem(t,job.id,job.payload,deps))).toMatchObject({state:'ERROR',code:'STAFF_SESSION_SUSPENDED'});
 expect(vi.mocked(finalizeReports).mock.calls).toHaveLength(calls);
});

it('uses the original finalization ledger and safety checks, retaining actionable per-row failures',async()=>{
 const actual=await vi.importActual<typeof import('../../packages/readygen/reports')>('../../packages/readygen/reports');
 vi.mocked(finalizeReports).mockImplementationOnce(actual.finalizeReports);
 const input={...request(),items:[{rowId:randomUUID()}]},batch=await tx(db,t=>enqueueReportBatch(t,user,input));
 const job=(await db.query<{id:string;payload:unknown}>('SELECT j.id,j.payload FROM job_outbox j JOIN internal_report_request_item i ON i.outbox_id=j.id WHERE i.request_id=$1',[batch.batchId])).rows[0];
 expect(await tx(db,t=>runReportBatchItem(t,job.id,job.payload,deps))).toMatchObject({state:'ERROR',code:'NOT_FOUND'});
 const finished=await readReportBatch(db,user,batch.batchId);expect(finished.state).toBe('COMPLETED');expect(finished.zipBatchIds).toHaveLength(1);
 const ledger=(await db.query<{outcome:unknown}>('SELECT outcome FROM internal_report_batch WHERE id=$1',[finished.zipBatchIds[0]])).rows[0];
 expect(ledger.outcome).toEqual([{rowId:input.items[0].rowId,outcome:'ERROR',code:'NOT_FOUND'}]);
});

it('shows queue cancellation after refresh instead of leaving a cancelled job waiting forever',async()=>{
 const batch=await tx(db,t=>enqueueReportBatch(t,user,request()));
 await db.query("UPDATE job_outbox SET state='Cancelled',cancel_epoch=cancel_epoch+1 WHERE id IN (SELECT outbox_id FROM internal_report_request_item WHERE request_id=$1)",[batch.batchId]);
 const status=await readReportBatch(db,user,batch.batchId);expect(status.state).toBe('COMPLETED');expect(status.completed).toBe(2);
 expect(status.items.map(i=>i.outcome?.code)).toEqual(['JOB_CANCELLED','JOB_CANCELLED']);
});
