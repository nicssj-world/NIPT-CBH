import {it,expect,beforeEach,afterEach} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {mkdtemp,readdir,copyFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {testDatabase} from '../helpers/database';
import {labUsers,tx,syntheticCase,receiveS1,setPendingPolicy,attemptOf,version} from '../helpers/lab';
import * as batch from '../../packages/lab/batch';
import {MASTER_SHA256} from '../../packages/workbook/master';
import {migrate} from '../../tools/migrate';
import type {Queryable} from '../../packages/db/connection';
let db:PGlite,u:Awaited<ReturnType<typeof labUsers>>;
beforeEach(async()=>{db=await testDatabase();u=await labUsers(db);await setPendingPolicy(db,u,'PROCEED_SYNTHETIC_LABELLED');});
afterEach(async()=>{await db.close();});
async function legacy(count=2,started=false,fixedId?:string){
 const b=await tx(db,t=>batch.createBatch(fixedId?{query:async<T>(sql:string,values?:unknown[])=>{
  if(sql.startsWith('INSERT INTO lab_batch('))return t.query<T>(sql.replace('lab_batch(','lab_batch(id,').replace('VALUES(','VALUES($7,'),[...values!,fixedId]);
  return t.query<T>(sql,values);
 }} as Queryable:t,u.staff));const ids:string[]=[];
 for(let n=0;n<count;n++){const c=await tx(db,t=>syntheticCase(t,u));await tx(db,t=>receiveS1(t,c));ids.push((await attemptOf(db,c.roundId)).id);}
 await tx(db,t=>batch.assignToBatch(t,u.staff,{batchId:b.batchId,expectedVersion:0,attemptIds:ids}));
 await tx(db,async t=>batch.updateSheetPlan(t,u.staff,{batchId:b.batchId,expectedVersion:await version(t,b.batchId),sheetNumber:1,plannedWorkDate:'2026-11-09',plannedOperator:'SYNTHETIC',plannedExtractionLot:null,plannedExtractionExpiry:null,plannedLibraryLot:null,plannedLibraryExpiry:null}));
 await tx(db,async t=>batch.printTaskList(t,u.staff,{batchId:b.batchId,expectedVersion:await version(t,b.batchId),sheetNumber:1}));
 for(const id of ids){
  if(started){await db.query("UPDATE analytical_attempt SET state='InProgress' WHERE id=$1",[id]);await db.query("INSERT INTO attempt_event(attempt_id,case_id,event_type,from_state,to_state) SELECT id,case_id,'STATE_CHANGED','Assigned','InProgress' FROM analytical_attempt WHERE id=$1",[id]);}
  await db.query("UPDATE analytical_attempt SET state='BatchCancelled' WHERE id=$1",[id]);
  await db.query("INSERT INTO attempt_event(attempt_id,case_id,event_type,from_state,to_state) SELECT id,case_id,'STATE_CHANGED',$2,'BatchCancelled' FROM analytical_attempt WHERE id=$1",[id,started?'InProgress':'Assigned']);
 }
 // Production's Run007 was cancelled by the pre-2026-11-12 code, which kept the Run number: reproduce that by skipping today's release step.
 await tx(db,async t=>batch.cancelBatch({query:async<T>(sql:string,values?:unknown[])=>sql.startsWith('UPDATE lab_batch SET run_released_at')?t.query<T>('SELECT 1 WHERE false'):t.query<T>(sql,values)} as Queryable,u.certifier,{batchId:b.batchId,expectedVersion:await version(t,b.batchId),reason:'SYNTHETIC legacy cancellation'}));
 return {...b,ids};
}
const recover=(id:string,n=2)=>tx(db,t=>t.query<{result:string}>('SELECT lab_recover_cancelled_unstarted_run($1,$2) result',[id,n]));
it('applies the real migration to the exact 15-attempt legacy Run and keeps the migration ledger rerunnable',async()=>{
 await db.close();db=new PGlite();
 const devRoot=path.resolve('.local/dev'),baseline=await mkdtemp(path.join(devRoot,'before-recovery-'));
 try{
  for(const file of await readdir('db/migrations'))if(/^\d+.*\.sql$/.test(file)&&Number(file.match(/^\d+/)![0])<207)await copyFile(path.join('db/migrations',file),path.join(baseline,file));
  await migrate(db,baseline);u=await labUsers(db);await setPendingPolicy(db,u,'PROCEED_SYNTHETIC_LABELLED');
  await db.query("INSERT INTO lab_batch_sequence(run_year,last_value) VALUES(extract(year FROM now() AT TIME ZONE 'Asia/Bangkok')::int,6)");
  const b=await legacy(15,false,'58847492-6d52-4802-9230-0c8b0d206fa0');expect(b.runLabel).toContain('Run007/');
  await migrate(db,path.resolve('db/migrations'));
  expect((await db.query<{n:number}>("SELECT count(*)::int n FROM analytical_attempt WHERE state='Ready'")).rows[0].n).toBe(15);
  expect((await db.query<{n:number}>("SELECT count(*)::int n FROM attempt_event WHERE details->>'repair'='CANCELLED_RUN_BEFORE_EXECUTION'")).rows[0].n).toBe(15);
  await migrate(db,path.resolve('db/migrations'));
  expect((await db.query<{n:number}>("SELECT count(*)::int n FROM attempt_event WHERE details->>'repair'='CANCELLED_RUN_BEFORE_EXECUTION'")).rows[0].n).toBe(15);
  // Migration 225 gave the cancelled Run007 number back once (no duplicate event on rerun), so the next Batch is Run007 again.
  expect((await db.query<{n:number}>("SELECT count(*)::int n FROM lab_batch_event WHERE batch_id=$1 AND event_type='RUN_NUMBER_RELEASED' AND details->>'migration'='225_release_run007_number'",[b.batchId])).rows[0].n).toBe(1);
  expect((await tx(db,t=>batch.createBatch(t,u.staff))).runLabel).toContain('Run007/');
 }finally{
  if(!path.resolve(baseline).startsWith(devRoot+path.sep))throw Error('UNSAFE_TEST_CLEANUP');
  await rm(baseline,{recursive:true});
 }
},120000);
it('restores exactly the original attempts, identifiers and FIFO eligibility, records system evidence and is idempotent',async()=>{
 const b=await legacy();const before=(await db.query("SELECT to_jsonb(a)-'state' preserved FROM analytical_attempt a ORDER BY id")).rows;
 const rounds=(await db.query('SELECT * FROM specimen_round ORDER BY id')).rows;
 const numbers=(await db.query('SELECT * FROM specimen_lab_number ORDER BY round_id')).rows;
 const snapshots=(await db.query('SELECT * FROM lab_placement_snapshot')).rows;
 expect((await recover(b.batchId)).rows[0].result).toBe('RECOVERED:2');
 expect((await db.query<{state:string}>('SELECT state FROM analytical_attempt')).rows.every(r=>r.state==='Ready')).toBe(true);
 expect((await db.query("SELECT to_jsonb(a)-'state' preserved FROM analytical_attempt a ORDER BY id")).rows).toEqual(before);
 expect((await db.query('SELECT * FROM specimen_round ORDER BY id')).rows).toEqual(rounds);
 expect((await db.query('SELECT * FROM specimen_lab_number ORDER BY round_id')).rows).toEqual(numbers);
 expect((await db.query('SELECT * FROM lab_placement_snapshot')).rows).toEqual(snapshots);
 expect((await db.query("SELECT * FROM attempt_event WHERE details->>'repair'='CANCELLED_RUN_BEFORE_EXECUTION'")).rows).toHaveLength(2);
 expect((await recover(b.batchId)).rows[0].result).toBe('ALREADY_RECOVERED');
 const next=await tx(db,t=>batch.createBatch(t,u.staff));
 const proposal=await tx(db,t=>batch.previewFill(t,u.staff,{batchId:next.batchId,sheetNumber:2}));expect(new Set(proposal.candidates.map(c=>c.attemptId))).toEqual(new Set(b.ids));
});
it('refuses a count mismatch atomically',async()=>{
 const b=await legacy();await expect(recover(b.batchId,15)).rejects.toThrow('CANCELLED_RUN_RECOVERY_COUNT_MISMATCH');
 expect((await db.query<{state:string}>("SELECT state FROM analytical_attempt")).rows.every(r=>r.state==='BatchCancelled')).toBe(true);
});
it('refuses an attempt with prior execution history',async()=>{
 const b=await legacy(2,true);await expect(recover(b.batchId)).rejects.toThrow('CANCELLED_RUN_RECOVERY_UNSAFE');
});
it('preserves the printed identity guard and keeps repair functions privileged',async()=>{
 const b=await legacy();
 await expect(tx(db,t=>t.query("UPDATE analytical_attempt SET state='Ready',printed_sample_id='SYNTHETIC-CHANGED' WHERE id=$1",[b.ids[0]]))).rejects.toThrow('PRINTED_SAMPLE_ID_IMMUTABLE');
 const access=await db.query<{n:number}>("SELECT count(*)::int n FROM pg_proc p CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) acl WHERE p.proname IN ('lab_recover_cancelled_unstarted_run','lab_cancelled_unstarted_attempt_recoverable') AND acl.grantee=0 AND acl.privilege_type='EXECUTE'");
 expect(access.rows[0].n).toBe(0);
});
it.each([['slot.2.extractionQc',2],['slot.2.transferChecked','✓']] as const)('refuses persisted physical evidence %s and leaves every attempt untouched',async(key,value)=>{
 const b=await legacy();await db.query("INSERT INTO task_workbook_revision(batch_id,revision,master_sha256,source_sha256,source_snapshot,values,created_by) VALUES($1,1,$2,repeat('a',64),'{}',$3,$4)",[b.batchId,MASTER_SHA256,JSON.stringify({[key]:value}),u.staff.id]);
 await expect(recover(b.batchId)).rejects.toThrow('CANCELLED_RUN_RECOVERY_UNSAFE');
 expect((await db.query<{state:string}>('SELECT state FROM analytical_attempt')).rows.every(r=>r.state==='BatchCancelled')).toBe(true);
});
