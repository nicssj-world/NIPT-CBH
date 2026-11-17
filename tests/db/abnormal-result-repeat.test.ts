import {it,expect} from 'vitest';
import {testDatabase} from '../helpers/database';
import {labUsers,syntheticCase,receiveS1,attemptOf,tx,setPendingPolicy,version} from '../helpers/lab';
import {actionCenter} from '../../packages/lab/intake';
import {attemptFacts} from '../../packages/lab/core';
import {createBatch,assignToBatch,updateSheetPlan,planCheck,finalizeSheet} from '../../packages/lab/batch';
import {readFileSync} from 'node:fs';
import {FileStore} from '../../packages/storage';
import {saveWorkbookDraft} from '../../packages/workbook/service';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';

// Owner 2026-11-17: Sequencing succeeded but the result is abnormal -> repeat exactly like any Re-Library / Re-Extraction
// (new attempt -2 / -3 that goes back to the Task List); only the recorded stage differs, for the statistics.
it('an abnormal result after a recorded run is repeated like any Re-xx: stage ABNORMAL_RESULT, new attempt -2, back on a Task List, not a QC failure',async()=>{
 const db=await testDatabase(),root=await mkdtemp(path.join(tmpdir(),'abnormal-repeat-'));try{
 const u=await labUsers(db);await setPendingPolicy(db,u,'PROCEED_SYNTHETIC_LABELLED');
 const c=await tx(db,t=>syntheticCase(t,u));await tx(db,t=>receiveS1(t,c));const a=await attemptOf(db,c.roundId);
 const b=await tx(db,t=>createBatch(t,u.staff)),V=()=>version(db,b.batchId);
 const place=async(batchId:string,attemptId:string,Vb:()=>Promise<number>)=>{
  await tx(db,async t=>assignToBatch(t,u.staff,{batchId,expectedVersion:await Vb(),attemptIds:[attemptId]}));
  await tx(db,async t=>updateSheetPlan(t,u.staff,{batchId,expectedVersion:await Vb(),sheetNumber:1,plannedWorkDate:'2026-11-17',plannedOperator:'SYNTHETIC',plannedExtractionLot:null,plannedExtractionExpiry:null,plannedLibraryLot:null,plannedLibraryExpiry:null}));
  await tx(db,async t=>planCheck(t,u.staff,{batchId,expectedVersion:await Vb(),sheetNumber:1,confirm:{controlsAtTemplate:true,identifiersMatch:true,noDuplicates:true}}));
  await tx(db,async t=>finalizeSheet(t,u.staff,{batchId,expectedVersion:await Vb(),sheetNumber:1}));
 };
 await place(b.batchId,a.id,V);
 const order={attemptId:a.id,kind:'RE_LIBRARY',stage:'ABNORMAL_RESULT',reasonCode:'ABNORMAL_RESULT',note:'SYNTHETIC abnormal result, repeat to confirm'};
 // No recorded run and no confirmed HALOS result yet: refused, with a message that names the way on (import HALOS or record the run).
 await expect(tx(db,t=>actionCenter(t,u.staff,order))).rejects.toThrow('ABNORMAL_RESULT_EVIDENCE_REQUIRED');
 expect((await attemptFacts(db,'a.id=$1',[a.id]))[0].attempt_state).toBe('Assigned');
 const deps={master:readFileSync('.local/lab-owner-evidence/lab-combined-master.xlsx'),store:new FileStore(root),render:async()=>{throw Error('NOT_REQUESTED');}};
 await tx(db,async t=>saveWorkbookDraft(t,u.staff,{batchId:b.batchId,expectedVersion:await V(),expectedRevision:0,values:{'slot.2.libraryQc':1,'pool.concentration':3.2,'seq.dnbConcentration':2,'seq.q30':95,'seq.date':'17/11/2569','seq.operator':'SYNTHETIC'}},deps));

 const r=await tx(db,t=>actionCenter(t,u.staff,order)) as {attemptId:string;attemptNumber:number;printedSampleId:string|null};
 const parent=(await attemptFacts(db,'a.id=$1',[a.id]))[0];
 expect(parent.attempt_state).toBe('Superseded');expect(parent.qc_failed_stage).toBe('ABNORMAL_RESULT');
 expect((await db.query<{stage:string}>("SELECT stage FROM attempt_event WHERE attempt_id=$1 AND event_type='FAILURE_CONFIRMED'",[a.id])).rows[0].stage).toBe('ABNORMAL_RESULT');
 const w=(await db.query<{reason_code:string;level:string;state:string}>('SELECT reason_code,level,state FROM repeat_work_order WHERE parent_attempt_id=$1',[a.id])).rows[0];
 expect(w).toEqual({reason_code:'ABNORMAL_RESULT',level:'RE_LIBRARY',state:'RepeatPendingBatch'});
 // The new attempt is the -2 of the same specimen round, waiting for a Task List.
 expect(r.attemptNumber).toBe(2);expect(r.printedSampleId).toMatch(/-2$/);
 const child=(await attemptFacts(db,'a.id=$1',[r.attemptId]))[0];expect(child.attempt_state).toBe('Ready');expect(child.round_id).toBe(c.roundId);
 // It goes back on a Task List of a new Run.
 const b2=await tx(db,t=>createBatch(t,u.staff));await place(b2.batchId,r.attemptId,()=>version(db,b2.batchId));
 expect((await attemptFacts(db,'a.id=$1',[r.attemptId]))[0].attempt_state).toBe('Assigned');
 // Statistics: a repeat, but not a QC failure.
 const qc=(await db.query<{n:number}>(`SELECT count(*)::int n FROM attempt_event e JOIN analytical_attempt x ON x.id=e.attempt_id WHERE e.event_type='STATE_CHANGED' AND e.to_state='QcFailed'
  AND COALESCE(e.stage,x.qc_failed_stage) IS DISTINCT FROM 'ABNORMAL_RESULT' AND x.case_id=$1`,[c.caseId])).rows[0].n;
 expect(qc).toBe(0);
 }finally{await db.close();await rm(root,{recursive:true,force:true});}
},120000);
