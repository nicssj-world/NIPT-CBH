import {it,expect,afterEach,beforeEach} from 'vitest';
import type {PGlite} from '@electric-sql/pglite';
import {randomUUID} from 'node:crypto';
import {testDatabase} from '../helpers/database';
import {tx,labUsers,setPendingPolicy,syntheticCase,receiveS1,attemptOf,version} from '../helpers/lab';
import * as batch from '../../packages/lab/batch';
import type {Queryable} from '../../packages/db/connection';
import {MASTER_SHA256} from '../../packages/workbook/master';

// Owner 2026-11-03: a printed Task List with empty positions can be reopened and filled while no bench work is recorded for THAT Task.
// Measurements of another Task of the same Batch no longer lock it; later stages (pooling, sequencing) and the Task's own measurements still do.
let db:PGlite,u:Awaited<ReturnType<typeof labUsers>>;
beforeEach(async()=>{db=await testDatabase();u=await labUsers(db);});
afterEach(async()=>{await db.close();});
const q=()=>db as unknown as Queryable,run=<T>(fn:(t:Queryable)=>Promise<T>)=>tx(q(),fn),V=(id:string)=>version(q(),id);
const record=async(batchId:string,values:Record<string,unknown>)=>{   // a synthetic workbook revision carrying only the given measurements
 await db.query("INSERT INTO task_workbook_revision(batch_id,revision,master_sha256,source_sha256,source_snapshot,values,created_by) VALUES($1,1,$2,$3,'{}',$4,$5)",[batchId,MASTER_SHA256,'b'.repeat(64),JSON.stringify(values),u.staff.id]);
};
async function printedBatch(){
 await setPendingPolicy(q(),u,'PROCEED_SYNTHETIC_LABELLED');
 const cases=[];for(let i=0;i<2;i++){const c=await run(t=>syntheticCase(t,u));await run(t=>receiveS1(t,c,new Date(Date.now()-(2-i)*60000)));cases.push(c);}
 const attempts=await Promise.all(cases.map(c=>attemptOf(q(),c.roundId)));
 const b=await run(t=>batch.createBatch(t,u.staff));
 await run(async t=>batch.assignToBatch(t,u.staff,{batchId:b.batchId,expectedVersion:await V(b.batchId),attemptIds:[attempts[0].id],sheetNumber:1}));
 await run(async t=>batch.assignToBatch(t,u.staff,{batchId:b.batchId,expectedVersion:await V(b.batchId),attemptIds:[attempts[1].id],sheetNumber:3}));
 for(const sheetNumber of [1,3]){
  await run(async t=>batch.updateSheetPlan(t,u.staff,{batchId:b.batchId,expectedVersion:await V(b.batchId),sheetNumber,plannedWorkDate:'2026-11-03',plannedOperator:null,plannedExtractionLot:null,plannedExtractionExpiry:null,plannedLibraryLot:null,plannedLibraryExpiry:null}));
  await run(async t=>batch.printTaskList(t,u.staff,{batchId:b.batchId,expectedVersion:await V(b.batchId),sheetNumber}));
 }
 return b.batchId;
}
const slotOf=async(id:string,sheet:number)=>(await db.query<{slot_number:number}>('SELECT slot_number FROM lab_batch_slot WHERE batch_id=$1 AND sheet_number=$2 ORDER BY slot_number LIMIT 1',[id,sheet])).rows[0].slot_number;
const reopen=(id:string,sheetNumber:number)=>run(async t=>batch.reopenPlacement(t,u.staff,{batchId:id,expectedVersion:await V(id),sheetNumber}));

it("another Task's measurements do not lock a printed Task: it reopens, takes more patients, and prints again",async()=>{
 const id=await printedBatch(),first=await slotOf(id,1);
 await record(id,{[`slot.${first}.libraryQc`]:12.5,'qc.1.standard1':10});            // Task 1 has bench work
 const r=await reopen(id,3);expect(r.obsoleteRevision).toBeGreaterThan(0);
 expect((await db.query<{state:string}>('SELECT state FROM lab_task_sheet WHERE batch_id=$1 AND sheet_number=3',[id])).rows[0].state).toBe('Amended');
 await expect(reopen(id,1)).rejects.toThrow('REOPEN_ONLY_BEFORE_BENCH_WORK');         // Task 1 itself is locked
 // fill one more patient into Task 3's empty positions
 const c=await run(t=>syntheticCase(t,u));await run(t=>receiveS1(t,c,new Date(Date.now()-30000)));const extra=await attemptOf(q(),c.roundId);
 await run(async t=>batch.assignToBatch(t,u.staff,{batchId:id,expectedVersion:await V(id),attemptIds:[extra.id],sheetNumber:3}));
 expect((await db.query("SELECT 1 FROM lab_slot_assignment a JOIN lab_batch_slot s ON s.batch_id=a.batch_id AND s.slot_number=a.slot_number WHERE a.batch_id=$1 AND s.sheet_number=3 AND a.removed_at IS NULL",[id])).rows).toHaveLength(2);
 const printed=await run(async t=>batch.printTaskList(t,u.staff,{batchId:id,expectedVersion:await V(id),sheetNumber:3}));
 expect(printed.finalizedNow).toBe(true);expect(printed.previousRevision).toBeGreaterThan(0);                // a new revision; the old one stays as history
});

it("the Task's own measurement, or any later stage, still locks it",async()=>{
 const own=await printedBatch(),third=await slotOf(own,3);
 await record(own,{[`slot.${third}.libraryQc`]:9.1});
 await expect(reopen(own,3)).rejects.toThrow('REOPEN_ONLY_BEFORE_BENCH_WORK');
 await db.close();db=await testDatabase();u=await labUsers(db);
 const later=await printedBatch();
 await record(later,{'pool.concentration':3.4});                                       // pooling recorded: every Task feeds it
 await expect(reopen(later,3)).rejects.toThrow('REOPEN_ONLY_BEFORE_BENCH_WORK');
 void randomUUID;
});
