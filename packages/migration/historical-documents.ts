import type {Queryable} from '../db/connection';
/**
 * A migrated Historical case whose result was already issued by the previous system (89 of the 137 cases at Owner acceptance: HALOS Qualified,
 * official PDF pending/reviewed/released) is not put through request/consent preparation again: no request revision or consent signature is
 * created retroactively and no signing evidence is invented. Genuine evidence already in the system is unchanged. Cases still in progress
 * (NO_HALOS, current Rerun) follow the ordinary request/consent workflow, and new ANC registrations are not affected.
 */
export const HISTORICAL_RESULT_READY_CLASSIFICATIONS=['QUALIFIED_PDF_PENDING','PDF_REVIEW','CERTIFIED_RELEASED'] as const;
export const HISTORICAL_RESULT_READY_SQL=`('QUALIFIED_PDF_PENDING','PDF_REVIEW','CERTIFIED_RELEASED')`;
/** Actions (by permission) that would author request/consent evidence for the current round. */
export const RETROACTIVE_DOCUMENT_ACTIONS:ReadonlySet<string>=new Set(['request.edit','consent.prepare']);
export async function historicalResultReady(db:Queryable,caseId:string){
 if(!(await db.query<{present:boolean}>("SELECT to_regclass('public.migration_record') IS NOT NULL present")).rows[0]?.present)return false;
 return (await db.query(`SELECT 1 FROM migration_record WHERE case_id=$1 AND state='IMPORTED' AND classification IN ${HISTORICAL_RESULT_READY_SQL} LIMIT 1`,[caseId])).rows.length>0;
}
