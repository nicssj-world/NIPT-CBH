import {it,expect,afterEach,beforeEach} from 'vitest';
import type {PGlite} from '@electric-sql/pglite';
import {testDatabase} from '../helpers/database';
import {tx,labUsers,setPendingPolicy,syntheticCase,receiveS1,attemptOf,version} from '../helpers/lab';
import * as batch from '../../packages/lab/batch';
import type {Queryable} from '../../packages/db/connection';

// Owner 2026-11-03: marking a sample Urgent is its own reason; nobody is asked to type one. The standing reason is recorded on the Urgent event.
// A normal sample still cannot replace a position that holds another sample (only Urgent / Repeat may), and position 40 still needs an Urgent sample.
let db:PGlite,u:Awaited<ReturnType<typeof labUsers>>;
beforeEach(async()=>{db=await testDatabase();u=await labUsers(db);});
afterEach(async()=>{await db.close();});
const q=()=>db as unknown as Queryable,run=<T>(fn:(t:Queryable)=>Promise<T>)=>tx(q(),fn),V=(id:string)=>version(q(),id);
const received=async(ageSeconds:number)=>{const c=await run(t=>syntheticCase(t,u));await run(t=>receiveS1(t,c,new Date(Date.now()-ageSeconds*1000)));return attemptOf(q(),c.roundId);};
const exact=(batchId:string,attemptId:string,slot:number,mode:'MANUAL'|'URGENT'|'REPEAT',queueOverrideReason?:string)=>run(async t=>batch.assignExact(t,u.staff,{batchId,expectedVersion:await V(batchId),attemptId,slot,mode,...(queueOverrideReason?{queueOverrideReason}:{})}));

it("Urgent fill needs no typed reason, records the standing reason, and replaces an occupied position; a normal sample cannot",async()=>{
 await setPendingPolicy(q(),u,'PROCEED_SYNTHETIC_LABELLED');
 const first=await received(300),second=await received(200),third=await received(100);
 const b=await run(t=>batch.createBatch(t,u.staff)),id=b.batchId;
 await exact(id,first.id,2,'MANUAL');                                                    // an ordinary placement into an empty position, no reason typed
 await expect(exact(id,second.id,2,'MANUAL')).rejects.toThrow('EXACT_SLOT_UNAVAILABLE');  // a normal sample cannot take an occupied position
 await exact(id,second.id,2,'URGENT');                                                   // Urgent replaces it, no reason typed
 expect((await db.query<{reason:string|null}>("SELECT reason FROM attempt_event WHERE attempt_id=$1 AND event_type='URGENT_SET'",[second.id])).rows.map(r=>r.reason)).toEqual([batch.URGENT_FILL_REASON]);
 expect((await db.query<{state:string}>('SELECT state FROM analytical_attempt WHERE id=$1',[first.id])).rows[0].state).toBe('Ready');   // the replaced sample is back in the queue
 expect((await db.query<{state:string}>('SELECT state FROM analytical_attempt WHERE id=$1',[second.id])).rows[0].state).toBe('Assigned');
 await exact(id,third.id,3,'URGENT');                                                    // Urgent into an empty position that overtakes the queue: still no reason asked

 // Controls are fixed: positive (1) and negative (25) can never be replaced, not even by an Urgent sample.
 await expect(exact(id,first.id,1,'URGENT')).rejects.toThrow('CONTROL_SLOT_PROTECTED');
 await expect(exact(id,first.id,25,'URGENT')).rejects.toThrow('CONTROL_SLOT_PROTECTED');
 // The Blank control (40) is the only control position that can be given up, and only to an Urgent sample, with the Urgent-40 mode on.
 await expect(exact(id,first.id,40,'URGENT')).rejects.toThrow('CONTROL_SLOT_PROTECTED');                  // mode off: protected like the others
 await run(async t=>batch.setUrgentSlot40(t,u.staff,{batchId:id,expectedVersion:await V(id),enabled:true}));
 await expect(exact(id,first.id,40,'MANUAL')).rejects.toThrow('URGENT_ATTEMPT_REQUIRED');               // a normal sample still cannot
 await exact(id,first.id,40,'URGENT');                                                                   // an Urgent one takes the Blank position, no reason typed
 expect((await db.query<{slot_number:number}>('SELECT slot_number FROM lab_slot_assignment WHERE attempt_id=$1 AND removed_at IS NULL',[first.id])).rows[0].slot_number).toBe(40);
});
