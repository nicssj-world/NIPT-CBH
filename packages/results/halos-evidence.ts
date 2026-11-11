import type {Queryable} from '../db/connection';

/** Exact internal PDF/confirmed HALOS binding; never an attempt-wide shortcut for other reports. */
export async function halosReportEvidence(db:Queryable,versionId:string){
 const row=(await db.query<{row_id:string|null;reviewed:boolean}>(`SELECT task3_halos_report_row($1) row_id,
  EXISTS(SELECT 1 FROM result_qc5_review q WHERE q.version_id=$1 AND task3_halos_qc5_valid(q)) reviewed`,[versionId])).rows[0];
 return row?.row_id?{rowId:row.row_id,reviewed:row.reviewed}:null;
}
