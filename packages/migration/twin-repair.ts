import type {Queryable} from '../db/connection';
import {appendAudit} from '../db/audit';
import {assertSession,LabError,type Staff} from '../lab/core';
import {transactional} from '../inbound/tx';
/**
 * Owner decision 2026-11-02: attach a twin ("<LN Halos>D-<n>") analysis that was imported before the parser knew the D form to the case and
 * first attempt that already exist. The evidence checks and the audited correction live in migration_repair_twin_attachments (migration 177);
 * repeating the call changes nothing once a row is repaired. No case, attempt or analysis is created.
 */
export async function repairTwinAttachments(db:Queryable,user:Staff){
 if(!user.roles.includes('APP_ADMIN'))throw new LabError('FORBIDDEN',403);
 return transactional(db)(async d=>{
  await assertSession(d,user);
  const r=(await d.query<{r:{repaired:number;skipped:number;records:string[]}}>('SELECT migration_repair_twin_attachments($1) r',[user.id])).rows[0].r;
  await appendAudit(d,{actorId:user.id,action:'MIGRATION_TWIN_REPAIR',resourceType:'migration_record',details:{outcome:r.repaired?'REPAIRED':'NOTHING_TO_REPAIR',count:r.repaired}});
  return r;
 });
}
/**
 * Owner decision 2026-11-02: every sample imported from Genomic-CBH was requested and consented on paper. Existing workspaces of migrated cases are
 * set to the Paper channel markers (a version step, nothing else); new ones are created as Paper by the workspace itself. No document, signature
 * or approval is created.
 */
export async function backfillPaperMarkers(db:Queryable,user:Staff){
 if(!user.roles.includes('APP_ADMIN'))throw new LabError('FORBIDDEN',403);
 return transactional(db)(async d=>{
  await assertSession(d,user);
  const rows=(await d.query<{case_id:string}>(`UPDATE p2_workspace w SET request_mode='Paper',consent_mode='Paper',version=w.version+1,updated_by=$1,updated_at=clock_timestamp()
   FROM migration_record m WHERE m.case_id=w.case_id AND m.round_id=w.round_id AND m.state='IMPORTED' AND (w.request_mode<>'Paper' OR w.consent_mode<>'Paper') RETURNING w.case_id`,[user.id])).rows;
  for(const row of rows)await d.query("INSERT INTO case_event(case_id,event_type,details) VALUES($1,'HISTORICAL_PAPER_MARKERS',$2)",[row.case_id,{actorId:user.id,paperRequest:true,paperConsent:true,clinicalAcceptance:false}]);
  await appendAudit(d,{actorId:user.id,action:'MIGRATION_PAPER_MARKERS',resourceType:'nipt_case',details:{outcome:rows.length?'BACKFILLED':'NOTHING_TO_BACKFILL',count:rows.length}});
  return {updated:rows.length};
 });
}
