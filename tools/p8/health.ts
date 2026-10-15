/** Read-only operator probe. Raw payloads, identities, paths, DB URLs and errors never enter output. */
import {Client} from 'pg';
import {createHash} from 'node:crypto';
import {readdir,readFile,access} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import type {Queryable} from '../../packages/db/connection';
import {assertRuntimeDatabase} from '../../packages/db/connection';
import {verifyAuditChain} from '../../packages/db/audit';
import {readActiveSettings} from '../../packages/settings/service';
import {SETTINGS} from '../../packages/settings/catalog';
export type LedgerEntry={name:string;checksum:string};
export async function readP6Signals(db:Queryable){
 const row=(await db.query<{pending:string;unresolved:string;worker_error:boolean}>(`SELECT
 (SELECT count(*) FROM p6_transfer WHERE model->>'state' IN ('PREPARED','PDF_VERIFIED','RES_VERIFIED','BACKUP_VERIFIED','OK_OBSERVED','AWAITING_CONFIRMATION','PICKED_UP_UNCONFIRMED','RETRY_PENDING'))::text pending,
 (SELECT count(*) FROM p6_transfer WHERE model->>'reconciliationRequired'='true' OR model->>'state' IN ('RECONCILIATION_REQUIRED','UNKNOWN_TIMEOUT','FAILED_NEEDS_ADMIN') OR coalesce(model->>'state','') NOT IN ('PREPARED','PDF_VERIFIED','RES_VERIFIED','BACKUP_VERIFIED','OK_OBSERVED','AWAITING_CONFIRMATION','PICKED_UP_UNCONFIRMED','RETRY_PENDING','RECONCILIATION_REQUIRED','UNKNOWN_TIMEOUT','FAILED_NEEDS_ADMIN','CANCELLED','SYNTHETIC_CONFIRMED'))::text unresolved,
 EXISTS(SELECT FROM p6_worker_heartbeat WHERE coalesce(details->>'lastError','')<>'') worker_error`)).rows[0];
 return {p6Pending:Number(row.pending),p6Unresolved:Number(row.unresolved),p6WorkerError:row.worker_error};
}
export function rolesAreRestricted(rows:{name:string;elevated:boolean;releaseInsert:boolean;auditMutation:boolean}[],expected=['app_rw','worker_rw','nipt_web','nipt_worker'],releaseGuarded=false){return rows.length===expected.length&&expected.every(name=>rows.some(r=>r.name===name&&r.elevated===false&&(r.releaseInsert===false||releaseGuarded&&[expected[0],expected[2]].includes(r.name))&&r.auditMutation===false));}
export interface HealthSignals {now:Date;workerLockHeld:boolean;heartbeatAt:Date|null;lastSuccessAt:Date|null;workerError:boolean;inboundEnabled:boolean;backlog:number;unresolvedReconciliation:number;orphanReceipts:number;releaseRows:number;clinicalAuthority:boolean;auditValid:boolean;migrationsMatch:boolean;rolesRestricted:boolean;p6Pending:number;p6Unresolved:number;p6WorkerError:boolean;}
export function compareLedger(files:LedgerEntry[],ledger:LedgerEntry[]){return files.length>0&&files.length===ledger.length&&new Set(ledger.map(r=>r.name)).size===ledger.length&&files.every(f=>ledger.some(r=>r.name===f.name&&r.checksum===f.checksum));}
export type HealthContext={mode?:'synthetic'|'operational';quarantined?:boolean;probes?:{web:boolean;renderer:boolean;fileStorage:boolean;backup:string;backupAgeSeconds?:number|null}};
export function summarizeHealth(s:HealthSignals,context:HealthContext={}){
 const operational=context.mode==='operational';
 const age=(d:Date|null)=>d?(s.now.getTime()-d.getTime())/1000:null;
 const heartbeatAgeSeconds=age(s.heartbeatAt),lastSuccessAgeSeconds=age(s.lastSuccessAt);
 const workerAlive=s.workerLockHeld&&heartbeatAgeSeconds!==null&&Number.isFinite(heartbeatAgeSeconds)&&heartbeatAgeSeconds>=0&&heartbeatAgeSeconds<=90;
 const workerRecentSuccess=lastSuccessAgeSeconds!==null&&Number.isFinite(lastSuccessAgeSeconds)&&lastSuccessAgeSeconds>=0&&lastSuccessAgeSeconds<=90;
 const syntheticReady=workerAlive&&workerRecentSuccess&&!s.workerError&&s.backlog===0&&s.unresolvedReconciliation===0&&s.orphanReceipts===0&&s.releaseRows===0&&s.clinicalAuthority===false&&s.auditValid&&s.migrationsMatch&&s.rolesRestricted&&s.p6Pending===0&&s.p6Unresolved===0&&s.p6WorkerError===false;
 const p=context.probes;const technicalReady=operational?workerAlive&&!s.workerError&&s.backlog===0&&s.unresolvedReconciliation===0&&s.orphanReceipts===0&&s.auditValid&&s.migrationsMatch&&s.rolesRestricted&&s.p6Unresolved===0&&!s.p6WorkerError&&context.quarantined===false&&!!p?.web&&!!p?.renderer&&!!p?.fileStorage&&p?.backup==='CHECKSUM_VERIFIED':syntheticReady;
 return {format:operational?'NIPT_OPERATIONAL_HEALTH_V1':'NIPT_P8_OPERATOR_HEALTH_V1',syntheticOnly:!operational,...(operational?{runtimeMode:'operational',quarantined:context.quarantined??true,webReachable:p?.web??false,rendererReachable:p?.renderer??false,fileStorageAccessible:p?.fileStorage??false,backupStatus:p?.backup??'NOT_VERIFIED',backupAgeSeconds:p?.backupAgeSeconds??null}:{}),lastSuccessfulJobAgeSeconds:lastSuccessAgeSeconds,databaseReachable:true,technicalReady,workerAlive,workerLockHeld:s.workerLockHeld,workerRecentSuccess,heartbeatAgeSeconds,workerError:s.workerError,inboundEnabled:s.inboundEnabled,backlog:s.backlog,unresolvedReconciliation:s.unresolvedReconciliation,orphanReceipts:s.orphanReceipts,p6Pending:s.p6Pending,p6Unresolved:s.p6Unresolved,p6WorkerError:s.p6WorkerError,migrationsMatch:s.migrationsMatch,auditValid:s.auditValid,rolesRestricted:s.rolesRestricted,releaseRows:s.releaseRows,clinicalAuthority:s.clinicalAuthority,clinicalAcceptance:false,hospitalOperationalAcceptance:false};
}
export function assertRehearsalTarget(raw:string,mode:string|undefined){if(mode!=='synthetic')throw Error('EXPLICIT_SYNTHETIC_MODE_REQUIRED');const u=new URL(raw);if(u.search||u.hash||u.protocol!=='postgresql:'||u.hostname!=='127.0.0.1'||u.port!=='55461'||u.username!=='nipt_p8_synthetic_owner'||u.pathname!=='/nipt_p8_synthetic_admin')throw Error('DEDICATED_P8_OPS_CLUSTER_REQUIRED');}
export async function operatorHealth(db:Queryable,directory=resolve('db/migrations'),options:HealthContext&{webRole?:string;workerRole?:string}={}){
 const mode=options.mode??(process.env.NIPT_MODE==='operational'?'operational':'synthetic');const expectedRoles=['app_rw','worker_rw',options.webRole??(mode==='operational'?'nipt_app':'nipt_web'),options.workerRole??'nipt_worker'];
 const files:LedgerEntry[]=[];for(const name of (await readdir(directory)).filter(f=>/^\d+.*\.sql$/.test(f)).sort())files.push({name,checksum:createHash('sha256').update(await readFile(resolve(directory,name),'utf8')).digest('hex')});
 const ledger=(await db.query<LedgerEntry>('SELECT name,checksum FROM schema_migration')).rows;
 const h=(await db.query<{observed_at:Date;details:{lastSuccess?:string;lastError?:unknown}}>("SELECT observed_at,details FROM worker_heartbeat WHERE worker_id=$1",[mode==='operational'?'operational-worker':'synthetic-worker'])).rows[0];
 const counts=(await db.query<{backlog:string;reconciliation:string;orphans:string;releases:string}>(`SELECT (SELECT count(*) FROM job_outbox o LEFT JOIN integration_job_receipt r ON r.outbox_id=o.id WHERE o.state<>'Cancelled' AND r.outbox_id IS NULL)::text backlog,(SELECT count(*) FROM integration_job_receipt WHERE result->>'state'='RECONCILIATION_REQUIRED')::text reconciliation,(SELECT count(*) FROM integration_job_receipt r LEFT JOIN job_outbox o ON o.id=r.outbox_id WHERE o.id IS NULL OR o.state='Cancelled')::text orphans,(SELECT count(*) FROM result_release)::text releases`)).rows[0];
 const audit=(await db.query<{previous_hash:string;hash:string;payload:string}>('SELECT previous_hash,hash,payload FROM audit_chain ORDER BY sequence')).rows;
 const authority=(await db.query<{authorized:boolean}>('SELECT p5_release_authorized() authorized')).rows[0].authorized;
 const releaseGuarded=(await db.query<{guarded:boolean}>("SELECT count(*)=2 guarded FROM pg_trigger WHERE tgrelid='result_release'::regclass AND tgname IN ('p5_release_guard','p5_operational_release_guard') AND tgenabled='O' AND NOT tgisinternal")).rows[0].guarded;
 const roles=rolesAreRestricted((await db.query<{name:string;elevated:boolean;releaseInsert:boolean;auditMutation:boolean}>(`SELECT rolname name,(rolsuper OR rolcreatedb OR rolcreaterole OR rolbypassrls) elevated,has_table_privilege(oid,'result_release','INSERT') "releaseInsert",has_table_privilege(oid,'audit_chain','UPDATE,DELETE,TRUNCATE') "auditMutation" FROM pg_roles WHERE rolname=ANY($1::text[])`,[expectedRoles])).rows,expectedRoles,releaseGuarded);
 const workerLockHeld=(await db.query<{held:boolean}>("SELECT EXISTS(SELECT FROM pg_locks WHERE locktype='advisory' AND classid=0 AND objid=75432803 AND objsubid=1 AND granted AND database=(SELECT oid FROM pg_database WHERE datname=current_database())) held")).rows[0].held;
 const settings=await readActiveSettings(db),inbound=SETTINGS.his_inbound.schema.parse(settings.his_inbound??SETTINGS.his_inbound.default);
 return summarizeHealth({now:new Date(),workerLockHeld,heartbeatAt:h?.observed_at??null,lastSuccessAt:h?.details.lastSuccess?new Date(h.details.lastSuccess):null,workerError:!!h?.details.lastError,inboundEnabled:inbound.enabled,backlog:Number(counts.backlog),unresolvedReconciliation:Number(counts.reconciliation),orphanReceipts:Number(counts.orphans),releaseRows:Number(counts.releases),clinicalAuthority:authority,auditValid:verifyAuditChain(audit),migrationsMatch:compareLedger(files,ledger),rolesRestricted:roles,...await readP6Signals(db)},{...options,mode,quarantined:mode==='operational'?(await db.query<{quarantined:boolean}>('SELECT nipt_runtime_quarantined() quarantined')).rows[0]?.quarantined:true});
}
export async function operationalProbes(){
 const get=async(url:string,headers?:Record<string,string>)=>{try{const response=await fetch(url,{headers,redirect:'error',signal:AbortSignal.timeout(5000)});return response.ok&&(await response.json()).status==='ok';}catch{return false;}};
 const token=process.env.RENDERER_TOKEN_FILE?(await readFile(process.env.RENDERER_TOKEN_FILE,'utf8')).trim():process.env.RENDERER_TOKEN;
 const web=await get(new URL('/api/health',process.env.APP_ORIGIN).toString()),renderer=!!token&&await get(new URL('/health',process.env.RENDERER_URL).toString(),{authorization:'Bearer '+token});
 let fileStorage=false;try{await access(process.env.FILE_STORE_ROOT??'data/files',6);fileStorage=true;}catch{}
 let backup='NOT_CONFIGURED',backupAgeSeconds:number|null=null;try{if(process.env.NIPT_LAST_BACKUP_PATH){const root=process.env.NIPT_LAST_BACKUP_PATH,meta=JSON.parse(await readFile(resolve(root,'metadata.json'),'utf8')),bytes=await readFile(resolve(root,'manifest.enc'));backupAgeSeconds=(Date.now()-Date.parse(meta.createdAt))/1000;backup=meta.format==='NIPT_OPERATIONAL_BACKUP_V1'&&createHash('sha256').update(bytes).digest('hex')===meta.manifestSha256&&backupAgeSeconds>=0?'CHECKSUM_VERIFIED':'INVALID';const limit=Number(process.env.NIPT_BACKUP_MAX_AGE_SECONDS);if(limit>0&&backupAgeSeconds>limit)backup='STALE';}}catch{backup='UNREADABLE';}
 return {web,renderer,fileStorage,backup,backupAgeSeconds};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 let client:Client|undefined;try{const raw=process.env.DATABASE_URL??'';assertRuntimeDatabase(raw);const probes=process.env.NIPT_MODE==='operational'?await operationalProbes():undefined;client=new Client({connectionString:raw,connectionTimeoutMillis:5000,statement_timeout:10000});await client.connect();await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');const report=await operatorHealth(client,undefined,{probes,webRole:process.env.NIPT_WEB_DB_ROLE,workerRole:process.env.NIPT_WORKER_DB_ROLE});await client.query('COMMIT');process.stdout.write(JSON.stringify(report)+'\n');if(!report.technicalReady)process.exitCode=1;}catch{process.stdout.write(JSON.stringify({format:'NIPT_P8_OPERATOR_HEALTH_V1',syntheticOnly:process.env.NIPT_MODE!=='operational',technicalReady:false,code:'OPERATOR_PROBE_FAILED',clinicalAcceptance:false})+'\n');process.exitCode=1;}finally{await client?.end();}
}
