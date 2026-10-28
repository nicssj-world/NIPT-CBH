import type {Queryable} from '../db/connection';
import type {Principal} from '../security/policy';
import {requirePermission} from '../security/policy';

/** APP_ADMIN-only summary of operational evidence; never return PDF bytes,
 * original NAS UNC paths, patient identifiers or report values. */
export async function readOperationsOverview(db:Queryable,user:Principal){
 requirePermission(user,'settings.read',{},'read');
 const [jobs,releases,access,failures,accessEvents]=await Promise.all([
  db.query<{state:string;count:number}>(`SELECT state,count(*)::int count
    FROM pdf_archive_job GROUP BY state ORDER BY state`),
  db.query<{count:number}>(`SELECT count(*)::int count
    FROM result_release WHERE certified_at>=clock_timestamp()-interval '24 hours'`),
  db.query<{purpose:string;count:number}>(`SELECT purpose,count(*)::int count FROM result_access_log
    WHERE accessed_at>=clock_timestamp()-interval '7 days'
    AND purpose IN ('ANC_RESULT_FILE','ANC_RESULT_PRINT_VIEW','LAB_REVIEW_FILE')
    GROUP BY purpose ORDER BY purpose`),
  db.query<{id:string;state:string;attempts:number;last_error:string|null;updated_at:string}>(`SELECT id,state,attempts,last_error,updated_at
    FROM pdf_archive_job WHERE state='FAILED' OR (state='PENDING'
      AND created_at<clock_timestamp()-interval '30 minutes')
    ORDER BY (state='FAILED') DESC,updated_at DESC LIMIT 30`),
  db.query<{actor_name:string;version_id:string|null;purpose:string;accessed_at:string}>(`SELECT
    COALESCE(u.display_name,u.username,'—') actor_name,l.version_id,l.purpose,l.accessed_at
    FROM result_access_log l LEFT JOIN app_user u ON u.id=l.actor_id
    WHERE l.purpose IN ('ANC_RESULT_FILE','ANC_RESULT_PRINT_VIEW','LAB_REVIEW_FILE')
    ORDER BY l.accessed_at DESC,l.id DESC LIMIT 30`)
 ]);
 return {archiveCounts:jobs.rows,released24h:releases.rows[0]?.count??0,
  pdfAccess7d:access.rows,exceptions:failures.rows,pdfAudit:accessEvents.rows};
}
