import {it,expect,afterEach,beforeEach} from 'vitest';
import type {PGlite} from '@electric-sql/pglite';
import {testDatabase} from '../helpers/database';
import {tx,labUsers,setPendingPolicy,syntheticCase,receiveS1,attemptOf,version} from '../helpers/lab';
import * as batch from '../../packages/lab/batch';
import * as intake from '../../packages/lab/intake';
import type {Queryable} from '../../packages/db/connection';
import {MASTER_SHA256} from '../../packages/workbook/master';

// Owner 2026-11-03: drag a sample to another position of the Task List (move into an empty position, swap with an occupied one) without being asked for a reason,
// even after the plan was confirmed. Controls stay fixed; the Blank 40 takes only an Urgent sample; a position that already holds measurements keeps its sample.
let db:PGlite,u:Awaited<ReturnType<typeof labUsers>>;
beforeEach(async()=>{db=await testDatabase();u=await labUsers(db);});
afterEach(async()=>{await db.close();});
const q=()=>db as unknown as Queryable,run=<T>(fn:(t:Queryable)=>Promise<T>)=>tx(q(),fn),V=(id:string)=>version(q(),id);
const received=async(age:number)=>{const c=await run(t=>syntheticCase(t,u));await run(t=>receiveS1(t,c,new Date(Date.now()-age*1000)));return attemptOf(q(),c.roundId);};
const place=(id:string,attemptId:string,slot:number)=>run(async t=>batch.assignExact(t,u.staff,{batchId:id,expectedVersion:await V(id),attemptId,slot,mode:'MANUAL'}));
const move=(id:string,fromSlot:number,toSlot:number)=>run(async t=>batch.moveSlot(t,u.staff,{batchId:id,expectedVersion:await V(id),fromSlot,toSlot}));
const at=async(id:string,slot:number)=>(await db.query<{attempt_id:string}>('SELECT attempt_id FROM lab_slot_assignment WHERE batch_id=$1 AND slot_number=$2 AND removed_at IS NULL',[id,slot])).rows[0]?.attempt_id??null;

it("move into an empty position and swap with an occupied one, no reason, even after the plan is confirmed; controls are fixed",async()=>{
 await setPendingPolicy(q(),u,'PROCEED_SYNTHETIC_LABELLED');
 const a=await received(300),b=await received(200);
 const id=(await run(t=>batch.createBatch(t,u.staff))).batchId;
 await place(id,a.id,2);await place(id,b.id,3);
 await run(async t=>batch.updateSheetPlan(t,u.staff,{batchId:id,expectedVersion:await V(id),sheetNumber:1,plannedWorkDate:'2026-11-03',plannedOperator:null,plannedExtractionLot:null,plannedExtractionExpiry:null,plannedLibraryLot:null,plannedLibraryExpiry:null}));
 await run(async t=>batch.planCheck(t,u.staff,{batchId:id,expectedVersion:await V(id),sheetNumber:1,confirm:{controlsAtTemplate:true,identifiersMatch:true,noDuplicates:true}}));   // PlanChecked: this used to demand a reason
 expect(await move(id,2,3)).toMatchObject({swapped:true});                              // swap
 expect([await at(id,2),await at(id,3)]).toEqual([b.id,a.id]);
 expect(await move(id,3,5)).toMatchObject({swapped:false});                             // move into an empty position
 expect([await at(id,3),await at(id,5)]).toEqual([null,a.id]);
 await expect(move(id,5,1)).rejects.toThrow('CONTROL_SLOT_PROTECTED');                  // positive control (1) and negative control (25) never take part
 await expect(move(id,5,25)).rejects.toThrow('CONTROL_SLOT_PROTECTED');
});

it("a position that already holds measurements cannot give its sample away or take another",async()=>{
 await setPendingPolicy(q(),u,'PROCEED_SYNTHETIC_LABELLED');
 const a=await received(300),b=await received(200);
 const id=(await run(t=>batch.createBatch(t,u.staff))).batchId;
 await place(id,a.id,2);await place(id,b.id,3);
 await db.query("INSERT INTO task_workbook_revision(batch_id,revision,master_sha256,source_sha256,source_snapshot,values,created_by) VALUES($1,1,$2,$3,'{}',$4,$5)",[id,MASTER_SHA256,'b'.repeat(64),JSON.stringify({'slot.3.libraryQc':11.2}),u.staff.id]);
 await expect(move(id,2,3)).rejects.toThrow('MOVE_ONLY_BEFORE_BENCH_WORK');            // swap would hand position 3's values to another sample
 await expect(move(id,3,6)).rejects.toThrow('MOVE_ONLY_BEFORE_BENCH_WORK');
 expect(await move(id,2,6)).toMatchObject({swapped:false});                             // other positions move freely
});

it("the Blank 40 takes only an Urgent sample",async()=>{
 await setPendingPolicy(q(),u,'PROCEED_SYNTHETIC_LABELLED');
 const normal=await received(300),urgent=await received(200);
 const id=(await run(t=>batch.createBatch(t,u.staff))).batchId;
 await place(id,normal.id,2);await place(id,urgent.id,3);
 await run(t=>intake.setUrgent(t,u.staff,{attemptId:urgent.id,urgent:true}));
 await expect(move(id,2,40)).rejects.toThrow('CONTROL_SLOT_PROTECTED');                // Urgent-40 mode is off: protected like the other controls
 await run(async t=>batch.setUrgentSlot40(t,u.staff,{batchId:id,expectedVersion:await V(id),enabled:true}));
 await expect(move(id,2,40)).rejects.toThrow('URGENT_ATTEMPT_REQUIRED');               // a normal sample cannot
 expect(await move(id,3,40)).toMatchObject({swapped:false});                            // an Urgent one can
 await expect(move(id,2,40)).rejects.toThrow('URGENT_ATTEMPT_REQUIRED');               // swapping a normal sample into 40 would put it there too
 expect(await at(id,40)).toBe(urgent.id);
});
