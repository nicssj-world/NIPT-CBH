import {it,expect} from 'vitest';
import {Client} from 'pg';
import {readFile} from 'node:fs/promises';
import {migrate} from '../../tools/migrate';
import {assertSyntheticDatabase,type Queryable} from '../../packages/db/connection';
import {labUsers,docDeps,tx,version} from '../helpers/lab';
import {poolingFixture,POOL_SCENARIO} from '../helpers/pooling';
import * as s from '../../packages/pooling/service';
import * as rec from '../../packages/lab/records';
it.skipIf(!process.env.NIPT_TEST_DATABASE_URL)('native P4b app_rw: concurrent create/crosscheck, immutable evidence, atomic source invalidation',async()=>{
 const url=process.env.NIPT_TEST_DATABASE_URL!;assertSyntheticDatabase(url);
 const owner=new Client({connectionString:url});await owner.connect();const clients:Client[]=[],docs=await docDeps();
 const session=async()=>{const c=new Client({connectionString:url});await c.connect();await c.query('SET ROLE app_rw');clients.push(c);return c as unknown as Queryable;};
 try{
  await migrate(owner);await owner.query(await readFile('packages/db/roles.sql','utf8'));const u=await labUsers(owner);
  await owner.query("UPDATE lab_batch SET state='Cancelled',cancelled_by=$1,cancelled_at=now(),cancel_reason='SYNTHETIC P4b native isolation' WHERE state='Draft'",[u.staff.id]);
  const fixture=await poolingFixture(owner,u,docs.deps),[a,b]=await Promise.all([session(),session()]);
  const input={batchId:fixture.batchId,expectedVersion:await version(owner,fixture.batchId),scenario:POOL_SCENARIO,reason:'จำลอง Native concurrent pool'};
  const race=await Promise.allSettled([a,b].map(db=>tx(db,t=>s.createPool(t,u.staff,input))));expect(race.filter(r=>r.status==='fulfilled')).toHaveLength(1);
  const pool=(await owner.query<{id:string}>('SELECT id FROM p4b_pool_attempt WHERE batch_id=$1',[fixture.batchId])).rows[0];
  const check={batchId:fixture.batchId,poolId:pool.id,expectedVersion:await version(owner,fixture.batchId),values:[{slot:2,value:'128'},{slot:3,value:'128'}]};
  const checked=await Promise.allSettled([a,b].map(db=>tx(db,t=>s.crosscheck(t,u.staff,check))));expect(checked.filter(r=>r.status==='fulfilled')).toHaveLength(1);
  expect((await owner.query("SELECT 1 FROM p4b_pool_event WHERE pool_id=$1 AND event_type='CROSSCHECK_PASS'",[pool.id])).rowCount).toBe(1);
  await expect(a.query("UPDATE p4b_pool_attempt SET reason='synthetic tamper' WHERE id=$1",[pool.id])).rejects.toThrow(/permission/);
  await expect(a.query("INSERT INTO p4b_pool_observation(pool_id,field,slot,value,source,event_time,event_precision,recorded_by) VALUES($1,'TRANSFER',2,'{\"checked\":true}','DIRECT_ENTRY',clock_timestamp(),'MINUTE',$2)",[pool.id,u.staff.id])).rejects.toThrow('POOL_EXECUTION_ANCHOR_REQUIRED');
  // Native transaction rollback restores both upstream and Stop-use evidence.
  await owner.query('BEGIN');await rec.decideStageQc1(owner,u.certifier,{attemptId:fixture.attempts[0].id,decision:'Hold',reason:'จำลอง Native rollback'});
  expect((await owner.query("SELECT 1 FROM p4b_pool_event WHERE pool_id=$1 AND event_type='STOP_USE'",[pool.id])).rowCount).toBe(1);await owner.query('ROLLBACK');
  expect((await owner.query("SELECT 1 FROM p4b_pool_event WHERE pool_id=$1 AND event_type='STOP_USE'",[pool.id])).rowCount).toBe(0);
  await tx(a,t=>rec.decideStageQc1(t,u.certifier,{attemptId:fixture.attempts[0].id,decision:'Hold',reason:'จำลอง Native source invalidation'}));
  const w=await tx(b,t=>s.workspace(t,u.staff,fixture.batchId));expect(w.current?.stopUse).toBe(true);
  await expect(tx(b,t=>s.crosscheck(t,u.staff,{...check,expectedVersion:w.version}))).rejects.toThrow('POOL_STOP_USE');
 }finally{for(const c of clients)await c.end();await owner.end();await docs.close();}
},120000);
