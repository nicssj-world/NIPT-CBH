import type {Queryable} from '../db/connection';
import {need,type Staff} from '../lab/core';
/** Provisional records are readable LAB queue entries, not invented registered/received cases. */
export async function migrationWorklist(db:Queryable,user:Staff){
 need(user,'worksheet.read','read');
 const exists=(await db.query<{present:boolean}>("SELECT to_regclass('public.migration_record') IS NOT NULL present")).rows[0]?.present;
 if(!exists)return {rows:[],total:0};
 const rows=(await db.query<{id:string;ln:string;ln_halos:string;classification:string;case_id:string|null;exceptions:unknown}>(`SELECT m.id,m.ln,m.ln_halos,m.classification,m.case_id,m.exceptions FROM migration_record m
 WHERE m.state='IMPORTED' AND m.classification IN ('NO_HALOS','RERUN')
 AND (m.case_id IS NULL OR (m.classification='RERUN' AND NOT EXISTS(SELECT 1 FROM analytical_attempt a JOIN analytical_attempt source ON source.id=m.attempt_id WHERE a.round_id=source.round_id AND a.attempt_number>source.attempt_number))) ORDER BY m.ln,m.id LIMIT 200`)).rows;
 const total=Number((await db.query<{n:string}>(`SELECT count(*)::text n FROM migration_record m WHERE m.state='IMPORTED' AND m.classification IN ('NO_HALOS','RERUN')
 AND (m.case_id IS NULL OR (m.classification='RERUN' AND NOT EXISTS(SELECT 1 FROM analytical_attempt a JOIN analytical_attempt source ON source.id=m.attempt_id WHERE a.round_id=source.round_id AND a.attempt_number>source.attempt_number)))`)).rows[0].n);
 return {rows,total:Math.max(total,rows.length)};
}
