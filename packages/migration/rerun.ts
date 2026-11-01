import type {Queryable} from '../db/connection';
/** Only a source-backed current historical Rerun can use the normal Repeat action without inventing a QC failure. */
export async function migrationRerunAttempts(db:Queryable,attemptIds:readonly string[]){
 const found=new Set<string>();if(!attemptIds.length)return found;
 if(!(await db.query<{present:boolean}>("SELECT to_regclass('public.migration_analysis') IS NOT NULL present")).rows[0]?.present)return found;
 const rows=(await db.query<{attempt_id:string}>(`SELECT a.attempt_id FROM migration_analysis a JOIN migration_record m ON m.id=a.record_id
 JOIN migration_source s ON s.id=a.source_id JOIN migration_historical_run h ON h.run_label=a.run_label AND h.source_sha256=s.sha256
 JOIN analytical_attempt t ON t.id=a.attempt_id JOIN nipt_case c ON c.id=t.case_id
 WHERE a.attempt_id=ANY($1::uuid[]) AND a.is_current AND a.classification='ANALYSIS' AND a.advice_status='RERUN'
 AND a.values->>'operationAdvice'='Rerun' AND a.values->>'physicianAdvice'='Rerun'
 AND m.state='IMPORTED' AND (m.case_id,m.round_id,m.attempt_id)=(t.case_id,t.round_id,t.id) AND c.current_round_id=t.round_id
 AND t.attempt_number=(SELECT max(x.attempt_number) FROM analytical_attempt x WHERE x.round_id=t.round_id)`,[[...attemptIds]])).rows;
 for(const r of rows)found.add(r.attempt_id);return found;
}
