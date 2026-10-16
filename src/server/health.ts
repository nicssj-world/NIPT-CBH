import {pool,type Queryable} from '../../packages/db/connection';
import {readActiveSettings} from '../../packages/settings/service';
import {SETTINGS} from '../../packages/settings/catalog';
import {runtimeMode} from '../../packages/security/runtime';
import {healthFromEvidence,workerIdentity,type HealthEvidence} from '../../packages/admin/health';
import {createHash} from 'node:crypto';
import {readdir,readFile,statfs} from 'node:fs/promises';
import {resolve} from 'node:path';
import {migrationChecksumMatches} from '../../tools/migration-checksums';
import {backupMonitoring} from '../../packages/admin/backup';
export async function rendererHealth():Promise<HealthEvidence['renderer']>{
 if(!process.env.RENDERER_URL)return 'NOT CONFIGURED';
 try{const u=new URL(process.env.RENDERER_URL);if(!['localhost','127.0.0.1','[::1]','renderer'].includes(u.hostname))return 'OFFLINE';
 const token=process.env.RENDERER_TOKEN_FILE?(await readFile(process.env.RENDERER_TOKEN_FILE,'utf8')).trim():process.env.RENDERER_TOKEN;if(!token)return 'NOT CONFIGURED';
 const r=await fetch(new URL('/health',u),{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(2000),cache:'no-store',redirect:'error'});return r.ok&&(await r.json()).status==='ok'?'ALIVE':'OFFLINE';}catch{return 'OFFLINE';}
}
export async function migrationHealth(db:Queryable){try{const files=(await readdir(resolve('db/migrations'))).filter(x=>/^\d+.*\.sql$/.test(x)).sort();const ledger=(await db.query<{name:string;checksum:string}>('SELECT name,checksum FROM schema_migration')).rows;if(files.length!==ledger.length)return false;for(const r of ledger){if(!files.includes(r.name)||!migrationChecksumMatches(r.name,createHash('sha256').update(await readFile(resolve('db/migrations',r.name),'utf8')).digest('hex'),r.checksum))return false;}return true;}catch{return false;}}
export async function storageHealth(){if(!process.env.FILE_STORE_ROOT)return {status:'NOT CONFIGURED',availableBytes:null};try{const s=await statfs(resolve(process.env.FILE_STORE_ROOT));return {status:'MEASURED',availableBytes:s.bavail*s.bsize};}catch{return {status:'NOT VERIFIED',availableBytes:null};}}
export async function systemHealth(db:Queryable=pool(),mode=runtimeMode(),renderer?:HealthEvidence['renderer']){
 const [heartbeat,backlog,reconciliation,settings,dbMode,locks,migrationsMatch,p6,scan,storage]=await Promise.all([
 db.query<NonNullable<HealthEvidence['heartbeat']>>('SELECT observed_at,details FROM worker_heartbeat WHERE worker_id=$1',[workerIdentity(mode)]),
 db.query<{count:string;oldest:Date|null}>("SELECT count(*)::text AS count,min(o.created_at) AS oldest FROM job_outbox o LEFT JOIN integration_job_receipt r ON r.outbox_id=o.id WHERE o.state<>'Cancelled' AND r.outbox_id IS NULL"),
 db.query<{count:string;oldest:Date|null}>("SELECT count(*)::text AS count,min(completed_at) AS oldest FROM integration_job_receipt WHERE result->>'state'='RECONCILIATION_REQUIRED'"),readActiveSettings(db),
 db.query<{operational:boolean;quarantined:boolean}>('SELECT nipt_operational_enabled() operational,nipt_runtime_quarantined() quarantined'),
 db.query<{held:boolean}>("SELECT EXISTS(SELECT FROM pg_locks WHERE locktype='advisory' AND classid=0 AND objid=75432803 AND granted AND database=(SELECT oid FROM pg_database WHERE datname=current_database())) held"),migrationHealth(db),
 db.query<{retry:string;unresolved:string;worker_error:boolean}>("SELECT count(*) FILTER(WHERE model->>'state'='RETRY_PENDING')::text retry,count(*) FILTER(WHERE model->>'reconciliationRequired'='true' OR model->>'state' IN ('RECONCILIATION_REQUIRED','UNKNOWN_TIMEOUT','FAILED_NEEDS_ADMIN'))::text unresolved,EXISTS(SELECT FROM p6_worker_heartbeat WHERE coalesce(details->>'lastError','')<>'') worker_error FROM p6_transfer"),
 db.query<{failed:boolean}>("SELECT outcome IN ('FAILED','SHARE_UNAVAILABLE','PARTIAL','SKIPPED_BACKOFF') failed FROM his_inbound_scan_run ORDER BY started_at DESC LIMIT 1"),storageHealth()
 ]);
 const notifications=SETTINGS.notifications.schema.parse(settings.notifications??SETTINGS.notifications.default);
 const base=healthFromEvidence({mode,databaseOperational:dbMode.rows[0]?.operational??false,quarantined:dbMode.rows[0]?.quarantined??true,migrationsMatch,workerLockHeld:locks.rows[0]?.held??false,heartbeat:heartbeat.rows[0],backlog:Number(backlog.rows[0].count),oldest:backlog.rows[0].oldest,reconciliation:Number(reconciliation.rows[0].count),p6Retry:Number(p6.rows[0].retry),p6Unresolved:Number(p6.rows[0].unresolved),p6WorkerError:p6.rows[0].worker_error,scanFailure:scan.rows[0]?.failed??false,renderer:renderer??await rendererHealth()},notifications);
 return {...base,reconciliationOldestAt:reconciliation.rows[0].oldest,inboundEnabled:SETTINGS.his_inbound.schema.parse(settings.his_inbound??SETTINGS.his_inbound.default).enabled,web:'ALIVE',postgresql:'ALIVE',storage,
 backup:await backupMonitoring()};
}
