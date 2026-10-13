import {it,expect} from 'vitest';
import {Client} from 'pg';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {migrate} from '../../tools/migrate';
import {assertSyntheticDatabase,type Queryable} from '../../packages/db/connection';
import {labUsers,docDeps,tx,version} from '../helpers/lab';
import {completedPool,dnbInput,issueF5Simulation} from '../helpers/sequencing';
import * as s from '../../packages/sequencing/service';
import * as rec from '../../packages/lab/records';
it.skipIf(!process.env.NIPT_TEST_DATABASE_URL)('native P4c app_rw: idempotent create race, optimistic conflicts, immutable evidence, rollback and upstream Stop-use',async()=>{
 const url=process.env.NIPT_TEST_DATABASE_URL!;assertSyntheticDatabase(url);const owner=new Client({connectionString:url});await owner.connect();const clients:Client[]=[],docs=await docDeps();
 const session=async()=>{const c=new Client({connectionString:url});await c.connect();await c.query('SET ROLE app_rw');clients.push(c);return c as unknown as Queryable;};
 try{
  await migrate(owner);await owner.query(await readFile('packages/db/roles.sql','utf8'));const u=await labUsers(owner);
  await owner.query("UPDATE lab_batch SET state='Cancelled',cancelled_by=$1,cancelled_at=now(),cancel_reason='SYNTHETIC P4c native isolation' WHERE state='Draft'",[u.staff.id]);
  const f=await completedPool(owner,u,docs.deps),[a,b]=await Promise.all([session(),session()]);
  const input=dnbInput(f.batchId,f.poolSnapshotId,await version(owner,f.batchId),u.staff.id);
  const race=await Promise.all([a,b].map(db=>tx(db,t=>s.createDnb(t,u.staff,input))));expect(race[0]).toEqual(race[1]);const id=race[0].id!;
  expect((await owner.query('SELECT count(*)::int n FROM p4c_dnb_attempt WHERE batch_id=$1',[f.batchId])).rows[0].n).toBe(1);
  await expect(a.query("UPDATE p4c_dnb_attempt SET reason='synthetic tamper' WHERE id=$1",[id])).rejects.toThrow(/permission/);
  await expect(a.query("INSERT INTO p4c_dnb_observation(dnb_id,field,value,unit,source,event_time,event_precision,recorded_by) VALUES($1,'QC3','20','ng/uL','DIRECT_ENTRY',clock_timestamp(),'MINUTE',$2)",[id,u.staff.id])).rejects.toThrow('DNB_PRODUCT_REQUIRED');
  await issueF5Simulation(a,u.staff,f.batchId,id,docs.deps);
  const start={batchId:f.batchId,dnbId:id,expectedVersion:await version(owner,f.batchId),transition:'DNB_START',reason:'จำลอง เริ่ม DNB native'};
  const startRace=await Promise.allSettled([a,b].map(db=>tx(db,t=>s.transition(t,u.staff,{...start,requestId:randomUUID()}))));expect(startRace.filter(r=>r.status==='fulfilled')).toHaveLength(1);
  await tx(a,async t=>s.transition(t,u.staff,{batchId:f.batchId,dnbId:id,expectedVersion:await version(t,f.batchId),requestId:randomUUID(),transition:'DNB_END',reason:'จำลอง จบ DNB native'}));
  const observation={batchId:f.batchId,dnbId:id,expectedVersion:await version(owner,f.batchId),requestId:randomUUID(),field:'QC3',value:'20',unit:'ng/uL',source:'DIRECT_ENTRY'};
  const obsRace=await Promise.all([a,b].map(db=>tx(db,t=>s.recordObservation(t,u.staff,observation))));expect(obsRace[0]).toEqual(obsRace[1]);
  await expect(a.query("INSERT INTO p4c_dnb_review(observation_id,result,reviewer_id,note) VALUES($1,'Confirmed',$2,'synthetic self review')",[obsRace[0].id,u.staff.id])).rejects.toThrow('SECOND_PERSON_REQUIRED');
  await owner.query('BEGIN');await rec.decideStageQc1(owner,u.certifier,{attemptId:f.attempts[0].id,decision:'Hold',reason:'จำลอง native atomic rollback'});
  expect((await owner.query("SELECT 1 FROM p4c_dnb_event WHERE dnb_id=$1 AND event_type='STOP_USE'",[id])).rowCount).toBe(1);await owner.query('ROLLBACK');
  expect((await owner.query("SELECT 1 FROM p4c_dnb_event WHERE dnb_id=$1 AND event_type='STOP_USE'",[id])).rowCount).toBe(0);
  // Native competing source mutation and observation write serialize under the same Batch row.
  const expectedVersion=await version(owner,f.batchId);
  await Promise.allSettled([tx(a,t=>rec.decideStageQc1(t,u.certifier,{attemptId:f.attempts[0].id,decision:'Hold',reason:'จำลอง native source race'})),
   tx(b,t=>s.recordObservation(t,u.staff,{...observation,requestId:randomUUID(),expectedVersion,field:'STD1'}))]);
  expect((await tx(b,t=>s.workspace(t,u.staff,f.batchId))).current?.stopUse).toBe(true);
  await expect(tx(b,async t=>s.recordObservation(t,u.staff,{...observation,requestId:randomUUID(),expectedVersion:await version(t,f.batchId),field:'STD2'}))).rejects.toThrow('POOL_STOP_USE');
 }finally{for(const c of clients)await c.end();await owner.end();await docs.close();}
},120000);
