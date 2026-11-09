import type {Queryable} from '../db/connection';
import {FINALIZED} from './batch';
import {seqRecordedSql} from './historical-run';

/**
 * How far the Lab Run holding a sample has got (Owner 2026-11-09), as a count of completed steps for the ANC progress bar:
 * 0 = on a Task List, 1 = all Task Lists locked (QC next), 2 = QC saved (Pooling next), 3 = Pooling recorded (Sequencing next), 4 = sequencing result saved.
 * Same evidence as the Batch list status and the Run header. null = the round has no live slot in a Run (nothing to show).
 */

export async function analysisSteps(db:Queryable,roundIds:string[]):Promise<Map<string,number|null>>{
 const ids=[...new Set(roundIds.filter(Boolean))];
 if(!ids.length)return new Map();
 const rows=(await db.query<{round_id:string;steps:number|null}>(
  `SELECT r.round_id::text round_id,
    CASE WHEN b.batch_id IS NULL THEN NULL
     WHEN NOT COALESCE(ts.ok,false) THEN 0
     WHEN NOT q.saved THEN 1
     WHEN NOT po.pooled THEN 2
     WHEN NOT s.recorded THEN 3 ELSE 4 END::int steps
   FROM unnest($1::uuid[]) r(round_id)
   LEFT JOIN LATERAL (SELECT x.batch_id FROM lab_slot_assignment x JOIN analytical_attempt a ON a.id=x.attempt_id
     WHERE a.round_id=r.round_id AND x.removed_at IS NULL ORDER BY x.assigned_at DESC LIMIT 1) b ON true
   LEFT JOIN LATERAL (SELECT count(*)>=3 AND bool_and(t.state=ANY($2::text[])) ok FROM lab_task_sheet t WHERE t.batch_id=b.batch_id) ts ON true
   LEFT JOIN LATERAL (SELECT EXISTS(SELECT 1 FROM task_workbook_revision w WHERE w.batch_id=b.batch_id) saved) q ON true
   LEFT JOIN LATERAL (SELECT COALESCE((SELECT lab_actual_pooling_current(p.id) FROM lab_actual_pooling p WHERE p.batch_id=b.batch_id AND p.note<>'AUTO_RECORDED_FROM_SAVED_TASK_AT_EXPORT' ORDER BY p.recorded_at DESC,p.id DESC LIMIT 1),false) pooled) po ON true
   LEFT JOIN LATERAL (SELECT ${seqRecordedSql('b.batch_id')} recorded) s ON true`,[ids,FINALIZED])).rows;
 return new Map(rows.map(r=>[r.round_id,r.steps]));
}
