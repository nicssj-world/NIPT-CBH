import {it,expect} from 'vitest';
import {testDatabase} from '../helpers/database';
import {labUsers,syntheticCase,receiveS1,attemptOf,tx,setPendingPolicy,version} from '../helpers/lab';
import {confirmFailure,noCall,orderRepeat,orderRedraw} from '../../packages/lab/intake';
import {attemptFacts} from '../../packages/lab/core';
import {worklistRow} from '../../packages/lab/worklist';
import {authorize} from '../../packages/security/policy';
import {createBatch,assignToBatch,updateSheetPlan,planCheck,finalizeSheet} from '../../packages/lab/batch';
import {readFileSync} from 'node:fs';
import {FileStore} from '../../packages/storage';
import {saveWorkbookDraft} from '../../packages/workbook/service';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';

it.each(['QC1','QC2','QC3','QC4','SEQUENCING'] as const)('confirmed %s failure is deliberate; No Call waits without QC PASS, release or HIS job',async(stage)=>{
 const db=await testDatabase(),root=await mkdtemp(path.join(tmpdir(),'task1-failure-'));try{
 const u=await labUsers(db);await setPendingPolicy(db,u,'PROCEED_SYNTHETIC_LABELLED');
 const c=await tx(db,t=>syntheticCase(t,u));await tx(db,t=>receiveS1(t,c));const a=await attemptOf(db,c.roundId);
 const fail={attemptId:a.id,stage,confirmed:true,note:'SYNTHETIC confirmed failure after actual QC measurement'};
 await expect(tx(db,t=>confirmFailure(t,u.staff,fail))).rejects.toThrow('FAILURE_REQUIRES_LOCKED_EXECUTED_ATTEMPT');
 await expect(tx(db,t=>noCall(t,u.staff,{attemptId:a.id,note:'SYNTHETIC No Call'}))).rejects.toThrow('NO_CALL_REQUIRES_CONFIRMED_FAILURE_AFTER_FOUR');
 const b=await tx(db,t=>createBatch(t,u.staff)),V=()=>version(db,b.batchId);
 await tx(db,async t=>assignToBatch(t,u.staff,{batchId:b.batchId,expectedVersion:await V(),attemptIds:[a.id]}));
 await tx(db,async t=>updateSheetPlan(t,u.staff,{batchId:b.batchId,expectedVersion:await V(),sheetNumber:1,plannedWorkDate:'2026-10-23',plannedOperator:'SYNTHETIC',plannedExtractionLot:null,plannedExtractionExpiry:null,plannedLibraryLot:null,plannedLibraryExpiry:null}));
 await tx(db,async t=>planCheck(t,u.staff,{batchId:b.batchId,expectedVersion:await V(),sheetNumber:1,confirm:{controlsAtTemplate:true,identifiersMatch:true,noDuplicates:true}}));
 await tx(db,async t=>finalizeSheet(t,u.staff,{batchId:b.batchId,expectedVersion:await V(),sheetNumber:1}));
 await expect(tx(db,t=>confirmFailure(t,u.staff,fail))).rejects.toThrow('FAILED_STAGE_EVIDENCE_REQUIRED');
 const deps={master:readFileSync('.local/lab-owner-evidence/lab-combined-master.xlsx'),store:new FileStore(root),render:async()=>{throw Error('NOT_REQUESTED');}};
 const draft=await tx(db,async t=>saveWorkbookDraft(t,u.staff,{batchId:b.batchId,expectedVersion:await V(),expectedRevision:0,values:{'slot.2.libraryQc':1,'pool.concentration':3.2,'seq.dnbConcentration':2,'seq.q30':50,'seq.date':'23/10/2569','seq.operator':'SYNTHETIC'}},deps));
 // Numbers alone do not confirm failure.
 expect((await attemptFacts(db,'a.id=$1',[a.id]))[0].attempt_state).toBe('Assigned');
 await tx(db,t=>confirmFailure(t,u.staff,fail));const failed=(await attemptFacts(db,'a.id=$1',[a.id]))[0];expect(failed.attempt_state).toBe('QcFailed');
 expect((await db.query<{details:{revisionId:string}}>("SELECT details FROM attempt_event WHERE attempt_id=$1 AND event_type='FAILURE_CONFIRMED'",[a.id])).rows[0].details.revisionId).toBe(draft.id);
 expect(worklistRow({...failed,overall_ordinal:4},'HOLD').outcomeStatus).toBe('รอพิจารณาหลังครบ 4 ครั้ง');
 expect(worklistRow({...failed,overall_ordinal:4,attempt_state:'Assigned'},'HOLD').outcomeStatus).toBeNull();
 expect(authorize(u.staff,'redraw.order')).toBe(true);expect(authorize(u.staff,'attempt.noCall')).toBe(true);expect(authorize(u.staff,'result.certify')).toBe(false);
 // Case-scoped ordinal allocation is exercised in task1-lineage; use four distinct immutable rounds/attempts here.
 for(let n=2;n<=4;n++){
  const parent=(await db.query<{id:string}>('SELECT id FROM analytical_attempt WHERE case_id=$1 ORDER BY overall_ordinal DESC LIMIT 1',[c.caseId])).rows[0].id;
  const order=(await db.query<{id:string}>("INSERT INTO repeat_work_order(case_id,round_id,reason_code,state,parent_attempt_id,level,note,requested_by) VALUES($1,$2,'OTHER','RepeatFailed',$3,'RE_LIBRARY','SYNTHETIC unsuccessful fixture',$4) RETURNING id",[c.caseId,c.roundId,parent,u.staff.id])).rows[0].id;
  await db.query("INSERT INTO analytical_attempt(case_id,round_id,attempt_number,repeat_order_id,state,qc_failed_stage) VALUES($1,$2,$3,$4,'QcFailed','SEQUENCING')",[c.caseId,c.roundId,n,order]);
 }
 const last=(await attemptFacts(db,'a.case_id=$1 ORDER BY a.overall_ordinal DESC LIMIT 1',[c.caseId]))[0];
 const before=(await db.query('SELECT * FROM job_outbox')).rows;
 const outcome=await tx(db,t=>noCall(t,u.staff,{attemptId:last.attempt_id}));expect(outcome.status).toBe('รอรับ PDF No Call');
 const after=(await attemptFacts(db,'a.id=$1',[last.attempt_id]))[0];expect(after.attempt_state).toBe('QcFailed');expect(worklistRow(after,'HOLD').outcomeStatus).toBe('รอรับ PDF No Call');
 expect((await db.query('SELECT * FROM job_outbox')).rows).toEqual(before);expect((await db.query('SELECT * FROM result_release')).rows).toHaveLength(0);
 await expect(tx(db,t=>orderRepeat(t,u.staff,{attemptId:last.attempt_id,level:'RE_LIBRARY',reasonCode:'OTHER',note:'SYNTHETIC cannot overwrite final No Call intent'}))).rejects.toThrow('NO_CALL_AWAITING_EXTERNAL_PDF');
 await expect(tx(db,t=>orderRedraw(t,u.staff,{caseId:c.caseId,reasonCode:'OTHER',note:'SYNTHETIC cannot change active No Call outcome'}))).rejects.toThrow('NO_CALL_AWAITING_EXTERNAL_PDF');
 }finally{await db.close();await rm(root,{recursive:true,force:true});}
},120000);
