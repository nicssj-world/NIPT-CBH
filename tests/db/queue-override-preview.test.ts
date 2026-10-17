import {it,expect,beforeEach,afterEach} from 'vitest';
import type {PGlite} from '@electric-sql/pglite';
import {testDatabase} from '../helpers/database';
import {tx,labUsers,setPendingPolicy,syntheticCase,receiveS1,attemptOf} from '../helpers/lab';
import * as batch from '../../packages/lab/batch';
import type {Queryable} from '../../packages/db/connection';

// P0-3 (unblocked part): the user learns before submitting that a selection overtakes FIFO; the preview and the assign
// enforcement use one server computation. FIFO ordering itself is unchanged (OD-A pending).
let db:PGlite,u:Awaited<ReturnType<typeof labUsers>>;
beforeEach(async()=>{db=await testDatabase();u=await labUsers(db);});
afterEach(async()=>{await db.close();});
const q=()=>db as unknown as Queryable,run=<T>(fn:(t:Queryable)=>Promise<T>)=>tx(q(),fn);
it('preview reports the same overtaken count that assign enforces; FIFO head needs no reason; override is recorded',async()=>{
 await setPendingPolicy(q(),u,'PROCEED_SYNTHETIC_LABELLED');
 const ids:string[]=[];for(let i=0;i<3;i++){const c=await run(t=>syntheticCase(t,u));await run(t=>receiveS1(t,c,new Date(Date.now()-(3-i)*60000)));ids.push((await attemptOf(q(),c.roundId)).id);}
 expect(await run(t=>batch.previewAssignment(t,u.staff,{attemptIds:[ids[0]]}))).toEqual({overtaken:0,reasonRequired:false});
 expect(await run(t=>batch.previewAssignment(t,u.staff,{attemptIds:[ids[2]]}))).toEqual({overtaken:2,reasonRequired:true});
 await expect(run(t=>batch.previewAssignment(t,u.anc,{attemptIds:[ids[2]]}))).rejects.toMatchObject({code:'FORBIDDEN'});
 const b=await run(t=>batch.createBatch(t,u.staff));
 await expect(run(t=>batch.assignToBatch(t,u.staff,{batchId:b.batchId,expectedVersion:0,attemptIds:[ids[2]]}))).rejects.toMatchObject({code:'QUEUE_OVERRIDE_REASON_REQUIRED',details:{overtaken:2}});
 const r=await run(t=>batch.assignToBatch(t,u.staff,{batchId:b.batchId,expectedVersion:0,attemptIds:[ids[2]],queueOverrideReason:'จำลอง ผู้ใช้เลือกแทรกคิว'}));
 expect(r.placed).toHaveLength(1);
 expect((await db.query<{type:string;reason:string}>("SELECT event_type type,reason FROM attempt_event WHERE attempt_id=$1 AND event_type='QUEUE_OVERRIDE'",[ids[2]])).rows).toEqual([{type:'QUEUE_OVERRIDE',reason:'จำลอง ผู้ใช้เลือกแทรกคิว'}]);
 expect(await run(t=>batch.previewAssignment(t,u.staff,{attemptIds:[ids[0]]}))).toEqual({overtaken:0,reasonRequired:false}); // placed work leaves the queue
});
