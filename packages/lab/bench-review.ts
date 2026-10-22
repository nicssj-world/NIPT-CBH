import type {Queryable} from '../db/connection';
import {LabError,need,audit,type Staff} from './core';
import {loadRuntimeMaster} from '../workbook/runtime';
import {inspectTaskMaster,validateTaskValues} from '../workbook/master';
import {parseBeInput} from '../domain/thai-date';
import {calculateOwnerPooling,type PhysicalQc} from '../pooling/owner-master';
import type {PlacementPayload} from './batch';

/** Existing authorised result review also reviews the current paper worksheets.
 * No fabricated legacy executions, observations, HALOS imports or event times.
 */
export async function reviewBenchForResult(db:Queryable,user:Staff,attemptId:string,input:{revision?:number;measurementsReviewed?:boolean;reason:string}){
 need(user,'qc.accept');need(user,'result.certify');
 const assignment=(await db.query<{batch_id:string}>(`SELECT a.batch_id FROM lab_slot_assignment a JOIN analytical_attempt x ON x.id=a.attempt_id WHERE a.attempt_id=$1 AND a.removed_at IS NULL AND EXISTS(SELECT 1 FROM lab_operational_registration l WHERE l.case_id=x.case_id AND l.paper_request AND l.paper_consent)`,[attemptId])).rows;
 if(assignment.length!==1)return null;
 if(input.measurementsReviewed!==true)throw new LabError('OWNER_WORKSHEET_REVIEW_CONFIRMATION_REQUIRED',409);
 const batchId=assignment[0].batch_id;
 // Result locks already hold the attempt; never wait on an assignment's batch lock.
 await db.query('SELECT id FROM lab_batch WHERE id=$1 FOR UPDATE NOWAIT',[batchId]);
 const r=(await db.query<{id:string;revision:number;values:Record<string,unknown>;created_by:string;source_snapshot:{placements:{payload:PlacementPayload}[]}}>(`SELECT * FROM task_workbook_revision WHERE batch_id=$1 ORDER BY revision DESC LIMIT 1`,[batchId])).rows[0];
 if(!r||r.revision!==input.revision)throw new LabError('TASK_DRAFT_VERSION_CONFLICT',409);
 if(r.created_by===user.id)throw new LabError('SECOND_PERSON_REQUIRED',403);
 const master=await loadRuntimeMaster(),matrix=inspectTaskMaster(master);validateTaskValues(master,r.values);
 const missing=matrix.bindings.filter(f=>f.sheet==='Seq Task-G50'&&(r.values[f.key]===null||r.values[f.key]===undefined||f.dataType==='text'&&!String(r.values[f.key]).trim()||f.dataType==='checkbox'&&r.values[f.key]!==true)).map(f=>f.key);
 if(missing.length)throw new LabError('OWNER_SEQ_OBSERVATIONS_REQUIRED',409,{fields:missing});
 if(!parseBeInput(String(r.values['seq.date'])).ok)throw new LabError('OWNER_SEQ_WORK_DATE_INVALID',422);
 const rows:PhysicalQc[]=r.source_snapshot.placements.flatMap(p=>p.payload.slots).sort((a,b)=>a.slot-b.slot).map(s=>({slot:s.slot,sampleId:s.printedSampleId??s.printedControlId??'',kind:s.control==='positive'?'PC':s.control==='negative'?'NC':s.control==='blank'?'BLANK':s.attemptId?'PATIENT':'EMPTY',concentration:typeof r.values[`slot.${s.slot}.libraryQc`]==='number'?String(r.values[`slot.${s.slot}.libraryQc`]):null}));
 try{calculateOwnerPooling(master,rows);}catch(e){throw new LabError('OWNER_POOL_CALCULATION_INVALID',409,{reason:e instanceof Error?e.message:'INVALID'});}
 const ready=(await db.query<{ready:boolean}>('SELECT lab_bench_measurements_ready($1) ready',[batchId])).rows[0].ready;
 if(!ready)throw new LabError('OWNER_WORKSHEET_MEASUREMENTS_REQUIRED',409);
 const actual=(await db.query<{id:string}>(`SELECT id FROM lab_actual_pooling WHERE batch_id=$1 AND lab_bench_attempt_actually_pooled($2,id) ORDER BY recorded_at DESC,id DESC LIMIT 1`,[batchId,attemptId])).rows[0];
 if(!actual)throw new LabError('ACTUAL_POOLING_REQUIRED',409);
 const prior=(await db.query<{id:string}>(`SELECT id FROM lab_bench_review WHERE workbook_revision_id=$1 AND reviewer_id=$2 AND actual_pooling_id=$3 AND lab_bench_review_current(id)`,[r.id,user.id,actual.id])).rows[0];
 if(prior)return prior;
 const reviewed=(await db.query<{id:string}>(`INSERT INTO lab_bench_review(batch_id,workbook_revision_id,source_sha256,criteria_reference,qc_measurements_reviewed,pooling_reviewed,sequencing_reviewed,reason,reviewer_id,actual_pooling_id) VALUES($1,$2,lab_bench_revision_sha($2),'OWNER-MASTER-LAB-20261022',true,true,true,$3,$4,$5) RETURNING id`,[batchId,r.id,input.reason,user.id,actual.id])).rows[0];
 await audit(db,user,'LAB_OWNER_WORKSHEETS_REVIEWED','lab_bench_review',reviewed.id,{version:r.revision,outcome:'REVIEWED_ACTUAL_MEASUREMENTS',ruleVersion:'OWNER-MASTER-LAB-20261022'});
 return reviewed;
}
