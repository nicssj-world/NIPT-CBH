import type {Queryable} from '../db/connection';
import {digest} from '../pooling/calculation';
import {MASTER_SHA256} from '../workbook/master';
import type {PlacementPayload} from './batch';
import {LabError} from './core';

/** Exact-attempt worksheet provenance; transcription never confers QC acceptance. */
export async function benchAttemptEvidence(db:Queryable,attemptId:string){
 const assigned=(await db.query<{batch_id:string;slot_number:number;run_label:string;owner_paper_route:boolean}>(`SELECT x.batch_id,x.slot_number,b.run_label,(EXISTS(SELECT 1 FROM analytical_attempt a JOIN lab_operational_registration l ON l.case_id=a.case_id WHERE a.id=x.attempt_id AND l.paper_request AND l.paper_consent) OR EXISTS(SELECT 1 FROM task_workbook_revision w WHERE w.batch_id=x.batch_id)) owner_paper_route FROM lab_slot_assignment x JOIN lab_batch b ON b.id=x.batch_id WHERE x.attempt_id=$1 AND x.removed_at IS NULL AND b.state<>'Cancelled'`,[attemptId])).rows;
 if(assigned.length!==1)return null;
 const a=assigned[0],draft=(await db.query<{id:string;revision:number;master_sha256:string;source_sha256:string;source_snapshot:{placements:{id:string;content_hash:string;payload:PlacementPayload}[]};values:Record<string,unknown>}>(`SELECT * FROM task_workbook_revision WHERE batch_id=$1 ORDER BY revision DESC LIMIT 1`,[a.batch_id])).rows[0];
 if(!draft)return null;
 const frozen=draft.source_snapshot.placements;
 if(!Array.isArray(frozen))throw new LabError('TASK_PLACEMENT_HASH_MISMATCH',409);
 for(const p of frozen)if(digest(p.payload)!==p.content_hash)throw new LabError('TASK_PLACEMENT_HASH_MISMATCH',409);
 const slot=frozen.flatMap(p=>p.payload.slots).find(s=>s.slot===a.slot_number&&s.attemptId===attemptId);
 if(!slot)return null;
 const current=(await db.query<{id:string;content_hash:string}>(`SELECT DISTINCT ON(t.sheet_number) p.id,p.content_hash FROM lab_placement_snapshot p JOIN lab_task_sheet t ON t.id=p.sheet_id WHERE t.batch_id=$1 ORDER BY t.sheet_number,p.revision DESC`,[a.batch_id])).rows;
 const placementCurrent=current.length===frozen.length&&current.every(p=>frozen.some(f=>f.id===p.id&&f.content_hash===p.content_hash));
 const actualPooling=(await db.query<{id:string;current:boolean;pooled:boolean}>(`SELECT id,lab_actual_pooling_current(id) current,lab_bench_attempt_actually_pooled($1,id) pooled FROM lab_actual_pooling WHERE batch_id=$2 ORDER BY recorded_at DESC,id DESC LIMIT 1`,[attemptId,a.batch_id])).rows[0]??null;
 const values=draft.values,concentration=values[`slot.${a.slot_number}.libraryQc`];
 const exports=(await db.query<{id:string;kind:string;file_sha256:string}>(`SELECT id,kind,file_sha256 FROM lab_bench_export WHERE workbook_revision_id=$1 ORDER BY created_at`,[draft.id])).rows;
 return {batchId:a.batch_id,runLabel:a.run_label,slot:a.slot_number,attemptId,roundId:slot.roundId,printedSampleId:slot.printedSampleId,ownerPaperRoute:a.owner_paper_route,
  revision:draft.revision,masterSha256:draft.master_sha256,sourceSha256:draft.source_sha256,current:placementCurrent&&draft.master_sha256===MASTER_SHA256,
  actualPooling,
  concentration:typeof concentration==='number'?concentration:null,
  qcStandardCount:Object.entries(values).filter(([k,v])=>/^qc\.[123]\.(standard1|standard2|standard2Concentration)$/.test(k)&&typeof v==='number').length,
  poolConcentration:typeof values['pool.concentration']==='number'?values['pool.concentration']:null,
  sequencing:Object.fromEntries(Object.entries(values).filter(([k])=>k.startsWith('seq.'))),exports,qcAcceptance:false as const};
}
