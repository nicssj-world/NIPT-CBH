import {describe,it,expect,beforeEach,afterEach} from 'vitest';
import type {PGlite} from '@electric-sql/pglite';
import {testDatabase} from '../helpers/database';
import {tx,labUsers,setPendingPolicy,syntheticCase,receiveS1,docDeps,attemptOf,version} from '../helpers/lab';
import * as batch from '../../packages/lab/batch';
import type {Queryable} from '../../packages/db/connection';

// OWNER-LAB-030 (Owner 2026-10-26, handoff 10): deleting an UNUSED Batch gives its Run number back for the next Batch;
// a Batch that was printed/executed/has evidence never gives its number back. Synthetic fixtures only.
let db:PGlite,u:Awaited<ReturnType<typeof labUsers>>,docs:Awaited<ReturnType<typeof docDeps>>;
beforeEach(async()=>{db=await testDatabase();u=await labUsers(db);docs=await docDeps();});
afterEach(async()=>{await db.close();await docs.close();});
const q=(d:PGlite)=>d as unknown as Queryable;
const run=<T>(fn:(t:Queryable)=>Promise<T>)=>tx(q(db),fn);
async function readySpecimen(minutesAgo=5){
 await setPendingPolicy(q(db),u,'PROCEED_SYNTHETIC_LABELLED');
 const c=await run(t=>syntheticCase(t,u));await run(t=>receiveS1(t,c,new Date(Date.now()-minutesAgo*60000)));return c;
}
const assign=async(batchId:string,roundId:string)=>run(async t=>batch.assignToBatch(t,u.staff,{batchId,expectedVersion:await version(t,batchId),attemptIds:[(await attemptOf(t,roundId)).id]}));
const trash=(batchId:string,reason?:string)=>run(async t=>batch.trashBatch(t,u.staff,{batchId,expectedVersion:await version(t,batchId),...(reason?{reason}:{})}));
const finalize=async(batchId:string)=>{
 await run(async t=>batch.updateSheetPlan(t,u.staff,{batchId,expectedVersion:await version(t,batchId),sheetNumber:1,plannedWorkDate:'2026-10-12',plannedOperator:'จำลอง ผู้ปฏิบัติ',plannedExtractionLot:null,plannedExtractionExpiry:null,plannedLibraryLot:null,plannedLibraryExpiry:null}));
 await run(async t=>batch.planCheck(t,u.staff,{batchId,expectedVersion:await version(t,batchId),sheetNumber:1,confirm:{controlsAtTemplate:true,identifiersMatch:true,noDuplicates:true}}));
 await run(async t=>batch.finalizeSheet(t,u.staff,{batchId,expectedVersion:await version(t,batchId),sheetNumber:1}));
};
const labels=async()=>(await db.query<{run_label:string;released:boolean;state:string}>('SELECT run_label,run_released_at IS NOT NULL released,state FROM lab_batch ORDER BY created_at,run_label')).rows;

describe('OWNER-LAB-030 run-number reuse',()=>{
 it('empty server starts at Run001; an unused Batch is deleted in one action without a reason and its number is reused',async()=>{
  const a=await run(t=>batch.createBatch(t,u.staff));expect(a.runLabel).toMatch(/^Run001\//);
  const gone=await trash(a.batchId);expect(gone).toMatchObject({runReleased:true,runLabel:a.runLabel});
  const b=await run(t=>batch.createBatch(t,u.staff));
  expect(b).toMatchObject({runLabel:a.runLabel,created:true,reused:true});expect(b.batchId).not.toBe(a.batchId);
  const rows=await labels();expect(rows.filter(r=>!r.released)).toHaveLength(1);expect(rows.filter(r=>r.released)).toHaveLength(1);
  // The abandoned row, its events and audit remain as history.
  expect((await db.query<{n:number}>("SELECT count(*)::int n FROM audit_chain WHERE action IN ('LAB_RUN_NUMBER_RELEASED','LAB_BATCH_CREATED')")).rows[0].n).toBeGreaterThanOrEqual(3);
 });
 it('assigned specimens return to Ready when the unused Batch is deleted, and the next Batch gets the same Run number',async()=>{
  const c=await readySpecimen();const a=await run(t=>batch.createBatch(t,u.staff));
  await assign(a.batchId,c.roundId);expect(await attemptOf(q(db),c.roundId)).toMatchObject({state:'Assigned'});
  expect(await trash(a.batchId)).toMatchObject({runReleased:true});
  expect(await attemptOf(q(db),c.roundId)).toMatchObject({state:'Ready'});
  const b=await run(t=>batch.createBatch(t,u.staff));expect(b.runLabel).toBe(a.runLabel);
  await assign(b.batchId,c.roundId);expect(await attemptOf(q(db),c.roundId)).toMatchObject({state:'Assigned'});
 });
 it('Run002 deleted unused → next Batch gets Run002 (no gap); an evidenced/placed Run is never reused',async()=>{
  const c=await readySpecimen();
  const r1=await run(t=>batch.createBatch(t,u.staff));await assign(r1.batchId,c.roundId);await finalize(r1.batchId);   // Run001 now has placement evidence
  const r2=await run(t=>batch.createBatch(t,u.staff));expect(r2.runLabel).toMatch(/^Run002\//);
  await trash(r2.batchId);
  const r2b=await run(t=>batch.createBatch(t,u.staff));expect(r2b.runLabel).toBe(r2.runLabel);
  // Run001 (placed): trash needs a reason (and authority) and does NOT hand the number back.
  await expect(trash(r1.batchId)).rejects.toMatchObject({code:'REASON_REQUIRED_FOR_USED_BATCH'});
  const cancelled=await run(async t=>batch.trashBatch(t,u.certifier,{batchId:r1.batchId,expectedVersion:await version(t,r1.batchId),reason:'จำลอง ยกเลิกหลังล็อก'}));
  expect(cancelled).toMatchObject({runReleased:false});
  await expect(db.query("UPDATE lab_batch SET run_released_at=now(),run_released_by=$2 WHERE id=$1",[r1.batchId,u.staff.id])).rejects.toThrow(/RUN_RELEASE_REQUIRES_(CANCELLED|UNUSED_BATCH)/);
  const used=(await labels()).filter(r=>r.run_label===r1.runLabel);expect(used).toHaveLength(1);expect(used[0].released).toBe(false);
 });
 it('double-click on delete is harmless; a released number is reused exactly once; the identity of a row can never change',async()=>{
  const a=await run(t=>batch.createBatch(t,u.staff));const v=await version(q(db),a.batchId);
  await run(t=>batch.trashBatch(t,u.staff,{batchId:a.batchId,expectedVersion:v}));
  await expect(run(t=>batch.trashBatch(t,u.staff,{batchId:a.batchId,expectedVersion:v}))).rejects.toBeTruthy();   // stale version / already cancelled
  expect((await labels()).filter(r=>r.released)).toHaveLength(1);
  const b=await run(t=>batch.createBatch(t,u.staff));expect(b.runLabel).toBe(a.runLabel);
  expect(await run(t=>batch.createBatch(t,u.staff))).toMatchObject({batchId:b.batchId,created:false});   // second create returns the open Draft, never a duplicate
  await expect(db.query("UPDATE lab_batch SET run_number=99 WHERE id=$1",[b.batchId])).rejects.toThrow(/RUN_IDENTITY_IMMUTABLE/);
  await expect(db.query("INSERT INTO lab_batch(run_year,run_number,run_label,template_version,formula_version,created_by) SELECT run_year,run_number,run_label,template_version,formula_version,created_by FROM lab_batch WHERE id=$1",[b.batchId])).rejects.toThrow();   // no duplicate active label
 });
 it('a role without batch authority cannot delete a Batch',async()=>{
  const a=await run(t=>batch.createBatch(t,u.staff));
  await expect(run(t=>batch.trashBatch(t,u.auditor,{batchId:a.batchId,expectedVersion:0}))).rejects.toMatchObject({code:'FORBIDDEN'});
 });
});
