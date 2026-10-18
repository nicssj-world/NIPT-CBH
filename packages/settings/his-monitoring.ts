import {randomUUID} from 'node:crypto';
import {operationalDataEnabled} from '../security/runtime';
import {z} from 'zod';
import type {Queryable} from '../db/connection';
import {appendAudit} from '../db/audit';
import {requirePermission,type Principal} from '../security/policy';
import {loadTransfer} from '../p6/journal';
import {HIS_TEST_KIND} from './his';
export const HIS_RETRY_KIND='synthetic_outbound_retry';
export async function hisMonitoring(db:Queryable){
 const tests=(await db.query("SELECT j.id,j.payload->>'revisionId' revision_id,j.payload->>'version' version,j.created_at,r.result FROM job_outbox j LEFT JOIN integration_job_receipt r ON r.outbox_id=j.id WHERE j.kind=$1 ORDER BY j.created_at DESC LIMIT 50",[HIS_TEST_KIND])).rows;
 const transfers=(await db.query("SELECT id,(SELECT event->>'accessCode' FROM p6_transfer_event e WHERE e.transfer_id=p6_transfer.id AND e.event?'accessCode' ORDER BY e.revision DESC LIMIT 1) access_error,plan->>'settingsVersion' configuration_version,model->>'state' state,(model->>'attempts')::int attempts,model->>'nextRetryAt' next_retry_at,model->'log'->-1->>'code' last_code,revision,updated_at FROM p6_transfer ORDER BY updated_at DESC LIMIT 50")).rows;
 // Settings acceptance: which inbound configuration the running Worker last used, and the last scan result (error + recovery evidence).
 const used=(await db.query<{revision_id:string;version:string|null;used_at:Date}>("SELECT resource_id revision_id,details->>'version' version,created_at used_at FROM audit_chain WHERE action='INBOUND_CONFIGURATION_USED' ORDER BY sequence DESC LIMIT 1")).rows[0]??null;
 const lastScan=(await db.query<{trigger:string;outcome:string;error_code:string|null;finished_at:Date;counts:Record<string,number>}>("SELECT trigger,outcome,error_code,finished_at,counts FROM his_inbound_scan_run ORDER BY finished_at DESC LIMIT 1")).rows[0]??null;
 const active=(await db.query<{revision_id:string}>("SELECT revision_id FROM setting_active WHERE setting_key='his_inbound'")).rows[0]?.revision_id??null;
 return {tests,transfers,inboundWorker:{activeRevisionId:active,lastUsed:used,usesActive:!!used&&used.revision_id===active,lastScan},syntheticOnly:!operationalDataEnabled(),clinicalPublisherEnabled:operationalDataEnabled(),hospitalLanAcceptance:'NOT_RUN'};
}
export async function requestHisRetry(db:Queryable,user:Principal,id:string){
 requirePermission(user,'his.retry',{},'write');const row=await loadTransfer(db,z.uuid().parse(id));
 if(row.model.state!=='RETRY_PENDING')throw Error('HIS_RETRY_NOT_ALLOWED');
 const r=await db.query<{id:string}>("INSERT INTO job_outbox(kind,payload,idempotency_key) VALUES($1,$2,$3) RETURNING id",[HIS_RETRY_KIND,{transferId:id,revision:row.revision},'his-retry:'+randomUUID()]);
 await appendAudit(db,{actorId:user.id,action:'HIS_RETRY_QUEUED',resourceType:'p6_transfer',resourceId:id,details:{synthetic:true}});return {jobId:r.rows[0].id};
}
