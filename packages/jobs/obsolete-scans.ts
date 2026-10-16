import type {Queryable} from '../db/connection';
import {appendAudit} from '../db/audit';
import {SETTINGS} from '../settings/catalog';

/** Caller owns the transaction. Shared settings lock stabilizes the active pointer
 * through cancellation/delivery; activation already holds its exclusive counterpart. */
export async function cancelObsoleteInboundScans(db:Queryable,actorId?:string):Promise<string[]>{
 await db.query('SELECT pg_advisory_xact_lock_shared(hashtextextended($1,0))',['settings:his_inbound']);
 const active=(await db.query<{id:string;version:number;value:unknown}>(`SELECT r.id,r.version,r.value
  FROM setting_active a JOIN settings_revision r ON r.id=a.revision_id AND r.setting_key=a.setting_key
  WHERE a.setting_key='his_inbound' AND r.state='Active' AND r.risk='INTEGRATION'
  AND r.test_passed AND r.approved_by IS NOT NULL AND r.approved_by<>r.created_by`)).rows[0];
 // Missing/unverified configuration is not evidence that any queued job is obsolete.
 if(!active)return [];
 SETTINGS.his_inbound.schema.parse(active.value);
 const cancelled=(await db.query<{id:string}>(`UPDATE job_outbox j SET state='Cancelled',cancel_epoch=cancel_epoch+1
  WHERE j.kind='synthetic_scan' AND j.state IN ('Pending','Dispatched')
  AND jsonb_typeof(j.payload)='object' AND j.payload-ARRAY['configurationId','trigger']='{}'::jsonb
  AND (NOT (j.payload ? 'trigger') OR j.payload->>'trigger'='INTERVAL')
  AND j.payload->>'configurationId'<>$1
  AND EXISTS(SELECT 1 FROM settings_revision old WHERE old.id::text=j.payload->>'configurationId'
   AND old.setting_key='his_inbound' AND old.state='Archived')
  AND NOT EXISTS(SELECT 1 FROM integration_job_receipt receipt WHERE receipt.outbox_id=j.id)
  RETURNING j.id`,[active.id])).rows;
 for(const {id} of cancelled)await appendAudit(db,{actorId,action:'JOB_CANCELLED_CONFIGURATION_CHANGED',resourceType:'JOB',resourceId:id,details:{outcome:'CANCELLED',reasonCode:'HIS_CONFIGURATION_CHANGED',version:active.version}});
 return cancelled.map(row=>row.id);
}

/** Run on the worker's dedicated connection after singleton acquisition, before boss delivery. */
export async function cancelObsoleteInboundScansAtStartup(db:Queryable):Promise<string[]>{
 await db.query('BEGIN');
 try{const cancelled=await cancelObsoleteInboundScans(db);await db.query('COMMIT');return cancelled;}
 catch(error){await db.query('ROLLBACK');throw error;}
}

/** Dedicated connection, no outer transaction: inbound processing uses its own
 * short transactions/audit locks. Activation waits until processing AND its
 * receipt finish, so it cannot cancel a scan that is still genuinely completing. */
export async function withInboundConfigurationLease<T>(lock:Queryable,work:()=>Promise<T>):Promise<T>{
 await lock.query('SELECT pg_advisory_lock_shared(hashtextextended($1,0))',['settings:his_inbound']);
 try{return await work();}
 finally{await lock.query('SELECT pg_advisory_unlock_shared(hashtextextended($1,0))',['settings:his_inbound']);}
}
