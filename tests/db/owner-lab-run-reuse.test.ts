import {describe,it,expect,beforeEach,afterEach} from 'vitest';
import type {PGlite} from '@electric-sql/pglite';
import {testDatabase} from '../helpers/database';
import {tx,labUsers,setPendingPolicy,syntheticCase,receiveS1,docDeps,attemptOf,version} from '../helpers/lab';
import * as batch from '../../packages/lab/batch';
import type {Queryable} from '../../packages/db/connection';
import {listUnifiedRunPage} from '../../packages/lab/historical-run';
import {orderRepeat} from '../../packages/lab/intake';
import * as records from '../../packages/lab/records';
import {MASTER_SHA256} from '../../packages/workbook/master';

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
 it.each([['slot.2.extractionQc',2.5],['slot.2.transferChecked','✓']] as const)('does not return worked specimens to Ready when the only recorded evidence is %s',async(key,value)=>{
  const c=await readySpecimen(),b=await run(t=>batch.createBatch(t,u.staff));await assign(b.batchId,c.roundId);await finalize(b.batchId);
  await db.query("INSERT INTO task_workbook_revision(batch_id,revision,master_sha256,source_sha256,source_snapshot,values,created_by) VALUES($1,1,$2,repeat('a',64),'{}',$3,$4)",[b.batchId,MASTER_SHA256,JSON.stringify({[key]:value}),u.staff.id]);
  await expect(run(async t=>batch.cancelBatch(t,u.certifier,{batchId:b.batchId,expectedVersion:await version(t,b.batchId),reason:'SYNTHETIC must retain physical work'}))).rejects.toMatchObject({code:'CANCEL_ONLY_BEFORE_EXECUTION'});
  expect(await attemptOf(q(db),c.roundId)).toMatchObject({state:'Assigned'});
 });
 it('requires recall of an old cancelled Run working copy before the same specimen can start in another Run',async()=>{
  const c=await readySpecimen(),old=await run(t=>batch.createBatch(t,u.staff));await assign(old.batchId,c.roundId);await finalize(old.batchId);
  const pre=await run(async t=>records.issuePreWork(t,u.staff,{batchId:old.batchId,expectedVersion:await version(t,old.batchId),sheetNumber:1},docs.deps));
  const copy=await run(t=>records.printDocument(t,u.staff,{documentId:pre.id,kind:'WORKING_COPY'},docs.deps));
  await run(async t=>batch.cancelBatch(t,u.certifier,{batchId:old.batchId,expectedVersion:await version(t,old.batchId),reason:'SYNTHETIC cancelled before work'}));
  const next=await run(t=>batch.createBatch(t,u.staff));await assign(next.batchId,c.roundId);await finalize(next.batchId);
  await run(async t=>records.issuePreWork(t,u.staff,{batchId:next.batchId,expectedVersion:await version(t,next.batchId),sheetNumber:1},docs.deps));
  await expect(run(async t=>batch.startExecution(t,u.staff,{batchId:next.batchId,expectedVersion:await version(t,next.batchId),sheetNumber:1}))).rejects.toMatchObject({code:'RECALL_PENDING'});
  await run(t=>records.recallCopy(t,u.certifier,{copyId:copy.copyId,note:'SYNTHETIC recalled obsolete working copy'}));
  await run(async t=>batch.startExecution(t,u.staff,{batchId:next.batchId,expectedVersion:await version(t,next.batchId),sheetNumber:1}));
  await expect(run(async t=>batch.cancelBatch(t,u.certifier,{batchId:next.batchId,expectedVersion:await version(t,next.batchId),reason:'SYNTHETIC cannot cancel started work'}))).rejects.toMatchObject({code:'CANCEL_ONLY_BEFORE_EXECUTION'});
 });
 it('returns a printed repeat attempt and its still-open repeat order without consuming another attempt',async()=>{
  const c=await readySpecimen(),original=await run(t=>batch.createBatch(t,u.staff));await assign(original.batchId,c.roundId);await finalize(original.batchId);
  const parent=await attemptOf(q(db),c.roundId);
  await db.query("UPDATE analytical_attempt SET state='InProgress' WHERE id=$1",[parent.id]);
  await db.query("UPDATE analytical_attempt SET state='QcFailed',qc_failed_stage='QC1' WHERE id=$1",[parent.id]);
  const repeat=await run(t=>orderRepeat(t,u.staff,{attemptId:parent.id,level:'RE_LIBRARY',reasonCode:'QC1_LOW',note:'SYNTHETIC repeat fixture'}));
  const abandoned=await run(t=>batch.createBatch(t,u.staff));
  const assigned=await run(t=>batch.assignToBatch(t,u.staff,{batchId:abandoned.batchId,expectedVersion:0,attemptIds:[repeat.attemptId]}));
  expect(assigned.rejected).toEqual([]);await finalize(abandoned.batchId);
  await run(async t=>batch.trashBatch(t,u.certifier,{batchId:abandoned.batchId,expectedVersion:await version(t,abandoned.batchId),reason:'SYNTHETIC cancelled before repeat work'}));
  expect((await db.query('SELECT id,state FROM analytical_attempt WHERE id=$1',[repeat.attemptId])).rows[0]).toEqual({id:repeat.attemptId,state:'Ready'});
  expect((await db.query('SELECT state,closed_at FROM repeat_work_order WHERE id=$1',[repeat.repeatOrderId])).rows[0]).toEqual({state:'RepeatPendingBatch',closed_at:null});
  expect((await db.query<{n:number}>('SELECT count(*)::int n FROM analytical_attempt WHERE round_id=$1',[c.roundId])).rows[0].n).toBe(2);
 });
 it('returns printed and unprinted specimens from a cancelled unstarted Run to the older Run Task List 2, and hides the cancelled Run',async()=>{
  const first=await readySpecimen(10),printed=await readySpecimen(9),unprinted=await readySpecimen(8);
  const older=await run(t=>batch.createBatch(t,u.staff));await assign(older.batchId,first.roundId);await finalize(older.batchId);
  const abandoned=await run(t=>batch.createBatch(t,u.staff));await assign(abandoned.batchId,printed.roundId);await finalize(abandoned.batchId);
  const unprintedAttempt=await attemptOf(q(db),unprinted.roundId);
  await run(async t=>batch.assignToBatch(t,u.staff,{batchId:abandoned.batchId,expectedVersion:await version(t,abandoned.batchId),sheetNumber:2,attemptIds:[unprintedAttempt.id]}));
  const identity=(await attemptOf(q(db),printed.roundId)).printed_sample_id;
  const snapshots=(await db.query('SELECT * FROM lab_placement_snapshot WHERE batch_id=$1',[abandoned.batchId])).rows;
  await run(async t=>batch.trashBatch(t,u.certifier,{batchId:abandoned.batchId,expectedVersion:await version(t,abandoned.batchId),reason:'SYNTHETIC cancelled before lab work'}));
  expect(await attemptOf(q(db),printed.roundId)).toMatchObject({state:'Ready',printed_sample_id:identity});
  expect(await attemptOf(q(db),unprinted.roundId)).toMatchObject({state:'Ready'});
  const proposal=await run(t=>batch.previewFill(t,u.staff,{batchId:older.batchId,sheetNumber:2}));
  expect(proposal.candidates.map(c=>c.attemptId)).toEqual([(await attemptOf(q(db),printed.roundId)).id,unprintedAttempt.id]);
  await run(async t=>batch.fillFromQueue(t,u.staff,{batchId:older.batchId,expectedVersion:await version(t,older.batchId),sheetNumber:2,attemptIds:proposal.candidates.map(c=>c.attemptId)}));
  expect((await db.query<{slot_number:number}>('SELECT slot_number FROM lab_slot_assignment WHERE batch_id=$1 AND removed_at IS NULL ORDER BY slot_number',[older.batchId])).rows.map(r=>r.slot_number)).toEqual([2,17,18]);
  for(const listing of [await run(t=>batch.listBatchPage(t,u.staff,{})),await run(t=>listUnifiedRunPage(t,u.staff,{}))]){
   expect(listing.rows.map(r=>r.id)).not.toContain(abandoned.batchId);expect(listing.page.total).toBe(1);
  }
  expect((await run(t=>listUnifiedRunPage(t,u.staff,{q:abandoned.runLabel}))).page.total).toBe(0);
  expect((await db.query('SELECT * FROM lab_placement_snapshot WHERE batch_id=$1',[abandoned.batchId])).rows).toEqual(snapshots);
  expect((await db.query("SELECT event_type FROM lab_batch_event WHERE batch_id=$1 AND event_type='BATCH_CANCELLED'",[abandoned.batchId])).rows).toHaveLength(1);
 });
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
