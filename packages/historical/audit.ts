import {safeDetails} from '../db/audit';

/**
 * Sanitised audit vocabulary for P5H (Plan §3.5 item 7, REQ-HIST-09, AT-HIST-06/11). Events carry codes, versions and counts only —
 * never an LN, HN, name, date of birth, evidence text or file name. Built on the existing `safeDetails` allow-list so the hash chain stays
 * PHI-free. Persisting them (`appendAudit`) is the caller's job inside the same transaction as the decision.
 */
export const HISTORICAL_AUDIT_ACTIONS=[
 'HIST_DRAFT_CREATED','HIST_PRECHECK_QUEUED','HIST_SUBMIT_NOT_ELIGIBLE','HIST_SUBMITTED','HIST_DRAFT_ABANDONED',
 'HIST_PROMOTE_REJECTED','HIST_PROMOTE_CONFLICT','HIST_PROMOTE_DISCREPANCY','HIST_PROMOTED',
 'HIST_REVISION_REQUESTED','HIST_REVISION_VERIFIED','HIST_REVISION_DISCREPANCY','HIST_WITHDRAWN',
 'HIST_CUTOFF_CHANGE_REJECTED','HIST_OUTBOUND_BLOCKED','HIST_ORIGIN_CONVERSION_REJECTED',
 'HIST_BATCH_UPLOADED','HIST_BATCH_STAGED','HIST_BATCH_FAILED','HIST_ROW_CORRECTED','HIST_BATCH_VIEWED','HIST_FILE_VIEWED','HIST_BATCH_CONFIRMED',
] as const;
export type HistoricalAuditAction=typeof HISTORICAL_AUDIT_ACTIONS[number];
export type HistoricalAuditEvent={actorId?:string;action:HistoricalAuditAction;resourceType:'HISTORICAL_DRAFT'|'HISTORICAL_RECORD'|'HISTORICAL_BATCH'|'GO_LIVE_CUTOFF'|'OUTBOUND';resourceId?:string;details:Record<string,string|number|boolean>};
export function historicalAuditEvent(e:{actorId?:string;action:HistoricalAuditAction;resourceType:HistoricalAuditEvent['resourceType'];resourceId?:string;outcome:string;reasonCode?:string;ruleVersion?:string;version?:number;count?:number}):HistoricalAuditEvent{
 if(!(HISTORICAL_AUDIT_ACTIONS as readonly string[]).includes(e.action))throw new Error('Invalid audit vocabulary');
 const details:Record<string,string|number|boolean>={outcome:e.outcome,synthetic:true};
 if(e.reasonCode!==undefined)details.reasonCode=e.reasonCode;
 if(e.ruleVersion!==undefined)details.ruleVersion=e.ruleVersion;
 if(e.version!==undefined)details.version=e.version;
 if(e.count!==undefined)details.count=e.count;
 safeDetails(details);   // throws "Unsafe audit details" for anything outside the sanitised vocabulary
 return {actorId:e.actorId,action:e.action,resourceType:e.resourceType,resourceId:e.resourceId,details};
}
