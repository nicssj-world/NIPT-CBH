import {it,expect,afterEach,beforeEach} from 'vitest';
import type {PGlite} from '@electric-sql/pglite';
import {testDatabase} from '../helpers/database';
import {tx,labUsers,setPendingPolicy,syntheticCase,receiveS1,attemptOf,version} from '../helpers/lab';
import * as batch from '../../packages/lab/batch';
import type {Queryable} from '../../packages/db/connection';
import {MASTER_SHA256} from '../../packages/workbook/master';

// Owner 2026-11-03: a printed Task List can be reopened at any stage and filled into its empty positions. Nothing is locked at Task or Batch level any more;
// a position that already holds measurements keeps its sample (it cannot be taken out from under its values).
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
const occupiedSlot=async(id:string,sheet:number)=>(await db.query<{slot_number:number}>("SELECT a.slot_number FROM lab_slot_assignment a JOIN lab_batch_slot s ON s.batch_id=a.batch_id AND s.slot_number=a.slot_number WHERE a.batch_id=$1 AND s.sheet_number=$2 AND a.removed_at IS NULL ORDER BY a.slot_number LIMIT 1",[id,sheet])).rows[0].slot_number;
const reopen=(id:string,sheetNumber:number)=>run(async t=>batch.reopenPlacement(t,u.staff,{batchId:id,expectedVersion:await V(id),sheetNumber}));
const fillOne=async(id:string,sheetNumber:number)=>{
 const c=await run(t=>syntheticCase(t,u));await run(t=>receiveS1(t,c,new Date(Date.now()-30000)));const extra=await attemptOf(q(),c.roundId);
 await run(async t=>batch.assignToBatch(t,u.staff,{batchId:id,expectedVersion:await V(id),attemptIds:[extra.id],sheetNumber}));
};
const placed=async(id:string,sheet:number)=>(await db.query("SELECT 1 FROM lab_slot_assignment a JOIN lab_batch_slot s ON s.batch_id=a.batch_id AND s.slot_number=a.slot_number WHERE a.batch_id=$1 AND s.sheet_number=$2 AND a.removed_at IS NULL",[id,sheet])).rows.length;

it("a printed Task reopens, takes more patients and prints again, even when other Tasks and later stages are already recorded",async()=>{
 const id=await printedBatch(),first=await occupiedSlot(id,1);
 await record(id,{[`slot.${first}.libraryQc`]:12.5,'qc.1.standard1':10,'pool.concentration':3.4});   // Task 1 measured, pooling recorded
 const r=await reopen(id,3);expect(r.obsoleteRevision).toBeGreaterThan(0);
 expect((await db.query<{state:string}>('SELECT state FROM lab_task_sheet WHERE batch_id=$1 AND sheet_number=3',[id])).rows[0].state).toBe('Amended');
 await fillOne(id,3);expect(await placed(id,3)).toBe(2);
 const printed=await run(async t=>batch.printTaskList(t,u.staff,{batchId:id,expectedVersion:await V(id),sheetNumber:3}));
 expect(printed.finalizedNow).toBe(true);expect(printed.previousRevision).toBeGreaterThan(0);                // a new revision; the old one stays as history
});

it("a position that already holds measurements keeps its sample; the empty positions of the same Task can still be filled",async()=>{
 const id=await printedBatch(),third=await occupiedSlot(id,3);
 await record(id,{[`slot.${third}.libraryQc`]:9.1});
 await reopen(id,3);                                                                    // reopening is not blocked
 await expect(run(async t=>batch.removeFromBatch(t,u.staff,{batchId:id,expectedVersion:await V(id),slot:third,reason:'ย้ายตัวอย่าง'}))).rejects.toThrow('REMOVE_ONLY_BEFORE_BENCH_WORK');
 await fillOne(id,3);expect(await placed(id,3)).toBe(2);
});
