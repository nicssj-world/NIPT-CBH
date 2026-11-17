import {it,expect} from 'vitest';
import {testDatabase} from '../helpers/database';
import {labUsers,syntheticCase,receiveS1,attemptOf,tx,setPendingPolicy,version} from '../helpers/lab';
import {actionCenter,cancelRepeat} from '../../packages/lab/intake';
import {attemptFacts} from '../../packages/lab/core';
import {createBatch,assignToBatch,updateSheetPlan,planCheck,finalizeSheet} from '../../packages/lab/batch';
import {readFileSync} from 'node:fs';
import {FileStore} from '../../packages/storage';
import {saveWorkbookDraft} from '../../packages/workbook/service';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import type {PGlite} from '@electric-sql/pglite';

// Owner 2026-11-17: "ยกเลิกคำสั่งตรวจซ้ำ" removes a repeat ordered by mistake as if it was never ordered, while its new attempt is not on a
// Task List. The earlier attempt returns to the state it had before; the next order gets -2 again; statistics do not count it.
type Child={attemptId:string;attemptNumber:number;printedSampleId:string};
it('a repeat ordered by mistake is cancelled as if never ordered; refused once the new attempt is on a Task List; a repeat of a repeat reopens its own order',async()=>{
 const db=await testDatabase(),root=await mkdtemp(path.join(tmpdir(),'repeat-undo-'));try{
 const u=await labUsers(db);await setPendingPolicy(db,u,'PROCEED_SYNTHETIC_LABELLED');
 const c=await tx(db,t=>syntheticCase(t,u));await tx(db,t=>receiveS1(t,c));const a=await attemptOf(db,c.roundId);
 const deps={master:readFileSync('.local/lab-owner-evidence/lab-combined-master.xlsx'),store:new FileStore(root),render:async()=>{throw Error('NOT_REQUESTED');}};
 const runWith=async(attemptId:string)=>{
  const b=await tx(db,t=>createBatch(t,u.staff)),V=()=>version(db,b.batchId);
  await tx(db,async t=>assignToBatch(t,u.staff,{batchId:b.batchId,expectedVersion:await V(),attemptIds:[attemptId]}));
  await tx(db,async t=>updateSheetPlan(t,u.staff,{batchId:b.batchId,expectedVersion:await V(),sheetNumber:1,plannedWorkDate:'2026-11-17',plannedOperator:'SYNTHETIC',plannedExtractionLot:null,plannedExtractionExpiry:null,plannedLibraryLot:null,plannedLibraryExpiry:null}));
  await tx(db,async t=>planCheck(t,u.staff,{batchId:b.batchId,expectedVersion:await V(),sheetNumber:1,confirm:{controlsAtTemplate:true,identifiersMatch:true,noDuplicates:true}}));
  await tx(db,async t=>finalizeSheet(t,u.staff,{batchId:b.batchId,expectedVersion:await V(),sheetNumber:1}));
  const slot=(await db.query<{slot_number:number}>('SELECT slot_number FROM lab_slot_assignment WHERE attempt_id=$1 AND removed_at IS NULL',[attemptId])).rows[0].slot_number;
  await tx(db,async t=>saveWorkbookDraft(t,u.staff,{batchId:b.batchId,expectedVersion:await V(),expectedRevision:0,values:{[`slot.${slot}.libraryQc`]:1,'pool.concentration':3.2,'seq.dnbConcentration':2,'seq.q30':95,'seq.date':'17/11/2569','seq.operator':'SYNTHETIC'}},deps));
 };
 const order=(attemptId:string)=>tx(db,t=>actionCenter(t,u.staff,{attemptId,kind:'RE_LIBRARY',stage:'QC1',reasonCode:'QC1_LOW',note:'SYNTHETIC QC1 below the limit'})) as Promise<Child>;
 const fact=async(id:string)=>(await attemptFacts(db as unknown as PGlite,'a.id=$1',[id]))[0];
 const count=async(sql:string,args:unknown[])=>(await db.query<{n:number}>(`SELECT count(*)::int n FROM ${sql}`,args)).rows[0].n;
 const qcFailures=()=>count(`attempt_event e JOIN analytical_attempt x ON x.id=e.attempt_id WHERE e.event_type='STATE_CHANGED' AND e.to_state='QcFailed' AND x.case_id=$1`,[c.caseId]);

 // Not a repeat: nothing to cancel.
 await expect(tx(db,t=>cancelRepeat(t,u.staff,{attemptId:a.id}))).rejects.toThrow('REPEAT_UNDO_NOT_A_REPEAT');

 // 1. Ordered by mistake, cancelled: the attempt is back in its batch as before, nothing of the order is left, statistics see nothing.
 await runWith(a.id);
 const before=await fact(a.id);expect(before.attempt_state).toBe('Assigned');
 const first=await order(a.id);
 expect(first.attemptNumber).toBe(2);expect(first.printedSampleId).toMatch(/-2$/);
 const firstOrdinal=(await fact(first.attemptId)).overall_ordinal;
 // Under the web application's own database role, as in Production (the function pauses table triggers as the schema owner).
 await db.exec(readFileSync('packages/db/roles.sql','utf8'));await db.query('SET ROLE app_rw');
 let undone;try{undone=await tx(db,t=>cancelRepeat(t,u.staff,{attemptId:first.attemptId}));}finally{await db.query('RESET ROLE');}
 expect(undone).toMatchObject({parentAttemptId:a.id,restoredState:'Assigned'});
 // The triggers are back on afterwards: the attempt guards still refuse an illegal change.
 await expect(db.query("UPDATE analytical_attempt SET state='Final' WHERE id=$1",[a.id])).rejects.toThrow();
 const back=await fact(a.id);
 expect(back.attempt_state).toBe('Assigned');expect(back.qc_failed_stage).toBeNull();expect(back.slot_batch_id).toBe(before.slot_batch_id);
 expect(await count('analytical_attempt WHERE id=$1',[first.attemptId])).toBe(0);
 expect(await count('repeat_work_order WHERE case_id=$1',[c.caseId])).toBe(0);
 // Only the history from before the order is left (placing it on the Task List: Ready -> Assigned); nothing the order wrote.
 expect((await db.query<{t:string}>(`SELECT event_type||':'||coalesce(from_state,'')||'>'||coalesce(to_state,'') t FROM attempt_event WHERE attempt_id=$1 AND event_type IN ('FAILURE_CONFIRMED','STATE_CHANGED') ORDER BY sequence`,[a.id])).rows.map(r=>r.t)).toEqual(['STATE_CHANGED:Ready>Assigned']);
 expect(await qcFailures()).toBe(0);
 // What happened stays on record: the case history and the audit chain.
 expect(await count(`case_event WHERE case_id=$1 AND event_type='LAB_REPEAT_CANCELLED'`,[c.caseId])).toBe(1);
 expect(await count(`audit_chain WHERE action='LAB_REPEAT_CANCELLED' AND resource_id=$1`,[a.id])).toBe(1);

 // 2. Ordered again: the same -2, the same ordinal — the cancelled order used up nothing.
 const second=await order(a.id);
 expect(second.attemptNumber).toBe(2);expect(second.printedSampleId).toBe(first.printedSampleId);
 expect((await fact(second.attemptId)).overall_ordinal).toBe(firstOrdinal);

 // 3. Once -2 is on a Task List it cannot be cancelled (it goes on as usual), and the refusal changes nothing.
 await runWith(second.attemptId);
 await expect(tx(db,t=>cancelRepeat(t,u.staff,{attemptId:second.attemptId}))).rejects.toThrow('REPEAT_UNDO_ALREADY_PLACED');
 expect((await fact(second.attemptId)).attempt_state).toBe('Assigned');expect((await fact(a.id)).attempt_state).toBe('Superseded');

 // 4. A repeat of a repeat (-2 fails -> -3) cancelled: -2 is back in its batch and its own repeat order is open again.
 const third=await order(second.attemptId);expect(third.attemptNumber).toBe(3);
 expect((await db.query<{state:string}>('SELECT w.state FROM repeat_work_order w JOIN analytical_attempt x ON x.repeat_order_id=w.id WHERE x.id=$1',[second.attemptId])).rows[0].state).toBe('RepeatFailed');
 expect(await tx(db,t=>cancelRepeat(t,u.staff,{attemptId:third.attemptId}))).toMatchObject({parentAttemptId:second.attemptId,restoredState:'Assigned'});
 expect((await fact(second.attemptId)).attempt_state).toBe('Assigned');
 expect((await db.query<{state:string;closed_at:Date|null}>('SELECT w.state,w.closed_at FROM repeat_work_order w JOIN analytical_attempt x ON x.repeat_order_id=w.id WHERE x.id=$1',[second.attemptId])).rows[0]).toEqual({state:'RepeatInProgress',closed_at:null});
 expect(await count('analytical_attempt WHERE round_id=$1',[c.roundId])).toBe(2);
 expect(await qcFailures()).toBe(1); // the genuine -1 failure (step 2) stays; the cancelled -2 failure does not
 }finally{await db.close();await rm(root,{recursive:true,force:true});}
},120000);
