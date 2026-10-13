/** Read-only operator probe. Raw payloads, identities, paths, DB URLs and errors never enter output. */
import {Client} from 'pg';
import {createHash} from 'node:crypto';
import {readdir,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import type {Queryable} from '../../packages/db/connection';
import {assertSyntheticDatabase} from '../../packages/db/connection';
import {verifyAuditChain} from '../../packages/db/audit';
import {readActiveSettings} from '../../packages/settings/service';
import {SETTINGS} from '../../packages/settings/catalog';
export type LedgerEntry={name:string;checksum:string};
export function rolesAreRestricted(rows:{name:string;elevated:boolean;releaseInsert:boolean;auditMutation:boolean}[]){return rows.length===4&&['app_rw','worker_rw','nipt_web','nipt_worker'].every(name=>rows.some(r=>r.name===name&&r.elevated===false&&r.releaseInsert===false&&r.auditMutation===false));}
export interface HealthSignals {now:Date;workerLockHeld:boolean;heartbeatAt:Date|null;lastSuccessAt:Date|null;workerError:boolean;inboundEnabled:boolean;backlog:number;unresolvedReconciliation:number;orphanReceipts:number;releaseRows:number;clinicalAuthority:boolean;auditValid:boolean;migrationsMatch:boolean;rolesRestricted:boolean;}
export function compareLedger(files:LedgerEntry[],ledger:LedgerEntry[]){return files.length>0&&files.length===ledger.length&&new Set(ledger.map(r=>r.name)).size===ledger.length&&files.every(f=>ledger.some(r=>r.name===f.name&&r.checksum===f.checksum));}
export function summarizeHealth(s:HealthSignals){
 const age=(d:Date|null)=>d?(s.now.getTime()-d.getTime())/1000:null;
 const heartbeatAgeSeconds=age(s.heartbeatAt),lastSuccessAgeSeconds=age(s.lastSuccessAt);
 const workerAlive=s.workerLockHeld&&heartbeatAgeSeconds!==null&&Number.isFinite(heartbeatAgeSeconds)&&heartbeatAgeSeconds>=0&&heartbeatAgeSeconds<=90;
 const workerRecentSuccess=lastSuccessAgeSeconds!==null&&Number.isFinite(lastSuccessAgeSeconds)&&lastSuccessAgeSeconds>=0&&lastSuccessAgeSeconds<=90;
 const technicalReady=workerAlive&&workerRecentSuccess&&!s.workerError&&s.backlog===0&&s.unresolvedReconciliation===0&&s.orphanReceipts===0&&s.releaseRows===0&&s.clinicalAuthority===false&&s.auditValid&&s.migrationsMatch&&s.rolesRestricted;
 return {format:'NIPT_P8_OPERATOR_HEALTH_V1',syntheticOnly:true,databaseReachable:true,technicalReady,workerAlive,workerLockHeld:s.workerLockHeld,workerRecentSuccess,heartbeatAgeSeconds,workerError:s.workerError,inboundEnabled:s.inboundEnabled,backlog:s.backlog,unresolvedReconciliation:s.unresolvedReconciliation,orphanReceipts:s.orphanReceipts,migrationsMatch:s.migrationsMatch,auditValid:s.auditValid,rolesRestricted:s.rolesRestricted,releaseRows:s.releaseRows,clinicalAuthority:s.clinicalAuthority,clinicalAcceptance:false,hospitalOperationalAcceptance:false};
}
export function assertRehearsalTarget(raw:string,mode:string|undefined){if(mode!=='synthetic')throw Error('EXPLICIT_SYNTHETIC_MODE_REQUIRED');const u=new URL(raw);if(u.search||u.hash||u.protocol!=='postgresql:'||u.hostname!=='127.0.0.1'||u.port!=='55461'||u.username!=='nipt_p8_synthetic_owner'||u.pathname!=='/nipt_p8_synthetic_admin')throw Error('DEDICATED_P8_OPS_CLUSTER_REQUIRED');}
export async function operatorHealth(db:Queryable,directory=resolve('db/migrations')){
 const files:LedgerEntry[]=[];for(const name of (await readdir(directory)).filter(f=>/^\d+.*\.sql$/.test(f)).sort())files.push({name,checksum:createHash('sha256').update(await readFile(resolve(directory,name),'utf8')).digest('hex')});
 const ledger=(await db.query<LedgerEntry>('SELECT name,checksum FROM schema_migration')).rows;
 const h=(await db.query<{observed_at:Date;details:{lastSuccess?:string;lastError?:unknown}}>("SELECT observed_at,details FROM worker_heartbeat WHERE worker_id='synthetic-worker'")).rows[0];
 const counts=(await db.query<{backlog:string;reconciliation:string;orphans:string;releases:string}>(`SELECT (SELECT count(*) FROM job_outbox o LEFT JOIN integration_job_receipt r ON r.outbox_id=o.id WHERE o.state<>'Cancelled' AND r.outbox_id IS NULL)::text backlog,(SELECT count(*) FROM integration_job_receipt WHERE result->>'state'='RECONCILIATION_REQUIRED')::text reconciliation,(SELECT count(*) FROM integration_job_receipt r LEFT JOIN job_outbox o ON o.id=r.outbox_id WHERE o.id IS NULL OR o.state='Cancelled')::text orphans,(SELECT count(*) FROM result_release)::text releases`)).rows[0];
 const audit=(await db.query<{previous_hash:string;hash:string;payload:string}>('SELECT previous_hash,hash,payload FROM audit_chain ORDER BY sequence')).rows;
 const authority=(await db.query<{authorized:boolean}>('SELECT p5_release_authorized() authorized')).rows[0].authorized;
 const roles=rolesAreRestricted((await db.query<{name:string;elevated:boolean;releaseInsert:boolean;auditMutation:boolean}>(`SELECT rolname name,(rolsuper OR rolcreatedb OR rolcreaterole OR rolbypassrls) elevated,has_table_privilege(oid,'result_release','INSERT') "releaseInsert",has_table_privilege(oid,'audit_chain','UPDATE,DELETE,TRUNCATE') "auditMutation" FROM pg_roles WHERE rolname IN ('app_rw','worker_rw','nipt_web','nipt_worker')`)).rows);
 const workerLockHeld=(await db.query<{held:boolean}>("SELECT EXISTS(SELECT FROM pg_locks WHERE locktype='advisory' AND classid=0 AND objid=75432803 AND objsubid=1 AND granted AND database=(SELECT oid FROM pg_database WHERE datname=current_database())) held")).rows[0].held;
 const settings=await readActiveSettings(db),inbound=SETTINGS.his_inbound.schema.parse(settings.his_inbound??SETTINGS.his_inbound.default);
 return summarizeHealth({now:new Date(),workerLockHeld,heartbeatAt:h?.observed_at??null,lastSuccessAt:h?.details.lastSuccess?new Date(h.details.lastSuccess):null,workerError:!!h?.details.lastError,inboundEnabled:inbound.enabled,backlog:Number(counts.backlog),unresolvedReconciliation:Number(counts.reconciliation),orphanReceipts:Number(counts.orphans),releaseRows:Number(counts.releases),clinicalAuthority:authority,auditValid:verifyAuditChain(audit),migrationsMatch:compareLedger(files,ledger),rolesRestricted:roles});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 let client:Client|undefined;try{const raw=process.env.DATABASE_URL??'';assertSyntheticDatabase(raw);client=new Client({connectionString:raw,connectionTimeoutMillis:5000,statement_timeout:10000});await client.connect();await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');const report=await operatorHealth(client);await client.query('COMMIT');process.stdout.write(JSON.stringify(report)+'\n');if(!report.technicalReady)process.exitCode=1;}catch{process.stdout.write(JSON.stringify({format:'NIPT_P8_OPERATOR_HEALTH_V1',syntheticOnly:true,technicalReady:false,code:'OPERATOR_PROBE_FAILED',clinicalAcceptance:false})+'\n');process.exitCode=1;}finally{await client?.end();}
}
