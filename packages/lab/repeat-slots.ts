import type {Queryable} from '../db/connection';

/**
 * Attempts that no longer go through Pooling or vendor export: QC failed, stopped, batch cancelled,
 * or replaced by a child attempt after any Re-xxx order (orderRepeat marks the parent Superseded).
 * Keep identical to the repeating test in migration 204 (lab_bench_measurements_ready).
 */
export const REPEAT_ATTEMPT_STATES=['QcFailed','Superseded','Stopped','BatchCancelled'] as const;

export async function repeatAttemptIds(db:Queryable,slots:{attemptId?:string|null}[]):Promise<Set<string>>{
 const ids=slots.map(s=>s.attemptId).filter((x):x is string=>!!x);
 if(!ids.length)return new Set();
 const rows=(await db.query<{id:string}>('SELECT id::text id FROM analytical_attempt WHERE state=ANY($2) AND id::text=ANY($1)',[ids,[...REPEAT_ATTEMPT_STATES]])).rows;
 return new Set(rows.map(r=>r.id));
}
