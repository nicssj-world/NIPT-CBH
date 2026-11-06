import type {Queryable} from '../db/connection';

export interface InboundScanState {
 configuration_id:string;heartbeat_at:Date;started_at:Date;finished_at:Date;trigger:string;outcome:string;
 counts:Record<string,number>;error_code:string|null;last_success_at:Date|null;last_error_at:Date|null;last_error_code:string|null;consecutive_failures:number;
}
/** Read the active configuration's projection. Never let a prior configuration's heartbeat stand in for it.
 * Pre-summary installations may use their historical events until the first summary has been written. */
export async function currentInboundScan(db:Queryable,configurationId?:string):Promise<InboundScanState|null>{
 const active=configurationId??(await db.query<{revision_id:string}>("SELECT revision_id FROM setting_active WHERE setting_key='his_inbound'")).rows[0]?.revision_id;
 const state=(await db.query<InboundScanState>(`SELECT * FROM his_inbound_scan_state ${active?'WHERE configuration_id=$1':''} ORDER BY heartbeat_at DESC LIMIT 1`,active?[active]:[])).rows[0];
 if(state)return state;
 if((await db.query('SELECT 1 FROM his_inbound_scan_state LIMIT 1')).rows.length)return null;
 // Configuration-aware legacy fallback: configurations never used by a worker have no scan evidence.
 const since=active?(await db.query<{at:Date|null}>("SELECT min(created_at) at FROM audit_chain WHERE action='INBOUND_CONFIGURATION_USED' AND resource_id::text=$1",[active])).rows[0]?.at:null;
 if(active&&!since)return null;
 const runs=(await db.query<{started_at:Date;finished_at:Date;trigger:string;outcome:string;counts:Record<string,number>;error_code:string|null}>("SELECT started_at,finished_at,trigger,outcome,counts,error_code FROM his_inbound_scan_run WHERE ($1::timestamptz IS NULL OR started_at>=$1) ORDER BY finished_at DESC,id DESC",[since??null])).rows;
 const latest=runs[0],actual=runs.filter(r=>r.outcome!=='SKIPPED_BACKOFF');
 if(!latest||!actual[0])return null;
 let failures=0;for(const run of actual){if(!['FAILED','SHARE_UNAVAILABLE'].includes(run.outcome))break;failures++;}
 const success=actual.find(r=>r.outcome==='SUCCESS'),error=actual.find(r=>['FAILED','SHARE_UNAVAILABLE','PARTIAL'].includes(r.outcome));
 return {...latest,error_code:actual[0].error_code,configuration_id:active??'LEGACY',heartbeat_at:latest.finished_at,started_at:actual[0].started_at,finished_at:actual[0].finished_at,last_success_at:success?.finished_at??null,last_error_at:error?.finished_at??null,last_error_code:error?.error_code??null,consecutive_failures:failures};
}
