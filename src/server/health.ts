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

/** OWNER-LAB-059 operations evidence, measured on each request (no stored history, no synthetic uptime). A value that cannot be
 *  measured is returned as null/UNKNOWN so the page never shows it as healthy. */
export async function tlsEvidence(origin=process.env.APP_ORIGIN):Promise<{protocol:'https'|'http'|'UNKNOWN';validTo:string|null;daysLeft:number|null;subject:string|null;error:string|null}>{
 if(!origin)return {protocol:'UNKNOWN',validTo:null,daysLeft:null,subject:null,error:'APP_ORIGIN_NOT_SET'};
 let url:URL;try{url=new URL(origin);}catch{return {protocol:'UNKNOWN',validTo:null,daysLeft:null,subject:null,error:'APP_ORIGIN_INVALID'};}
 if(url.protocol!=='https:')return {protocol:'http',validTo:null,daysLeft:null,subject:null,error:null};
 const tls=await import('node:tls');
 return new Promise(done=>{
  const socket=tls.connect({host:url.hostname,port:Number(url.port||443),servername:/^\d+\.\d+\.\d+\.\d+$/.test(url.hostname)?undefined:url.hostname,rejectUnauthorized:false,timeout:2000},()=>{
   const cert=socket.getPeerCertificate();socket.end();
   if(!cert?.valid_to){done({protocol:'https',validTo:null,daysLeft:null,subject:null,error:'NO_CERTIFICATE'});return;}
   const validTo=new Date(cert.valid_to);done({protocol:'https',validTo:validTo.toISOString(),daysLeft:Math.floor((validTo.getTime()-Date.now())/86_400_000),subject:typeof cert.subject?.CN==='string'?cert.subject.CN:null,error:null});
  });
  socket.on('timeout',()=>{socket.destroy();done({protocol:'https',validTo:null,daysLeft:null,subject:null,error:'TLS_TIMEOUT'});});
  socket.on('error',e=>done({protocol:'https',validTo:null,daysLeft:null,subject:null,error:(e as NodeJS.ErrnoException).code??'TLS_ERROR'}));
 });
}
export async function operationsEvidence(db:Queryable=pool()){
 const {inboundHealth}=await import('../../packages/inbound/health');
 const settings=await readActiveSettings(db);
 const inboundSettings=SETTINGS.his_inbound.schema.parse(settings.his_inbound??SETTINGS.his_inbound.default);
 const outboundSettings=settings.his_outbound?SETTINGS.his_outbound.schema.safeParse(settings.his_outbound):null;
 const started=performance.now();await db.query('SELECT 1');const dbLatencyMs=Math.round((performance.now()-started)*10)/10;
 const [inbound,outbound,queues,tls]=await Promise.all([
  inboundHealth(db,inboundSettings),
  db.query<{written:number;pending:number;retry:number;attention:number;last_written:Date|null}>(`SELECT
    count(*) FILTER(WHERE model->>'state' IN ('OK_OBSERVED','AWAITING_CONFIRMATION','PICKED_UP_UNCONFIRMED','SYNTHETIC_CONFIRMED'))::int written,
    count(*) FILTER(WHERE model->>'state' IN ('PREPARED','PDF_VERIFIED','RES_VERIFIED','BACKUP_VERIFIED'))::int pending,
    count(*) FILTER(WHERE model->>'state'='RETRY_PENDING')::int retry,
    count(*) FILTER(WHERE model->>'state' IN ('FAILED_NEEDS_ADMIN','RECONCILIATION_REQUIRED','UNKNOWN_TIMEOUT'))::int attention,
    max(updated_at) FILTER(WHERE model->>'state' IN ('OK_OBSERVED','AWAITING_CONFIRMATION','PICKED_UP_UNCONFIRMED','SYNTHETIC_CONFIRMED')) last_written FROM p6_transfer`),
  db.query<{kind:string;pending:number;oldest:Date|null}>(`SELECT o.kind,count(*)::int pending,min(o.created_at) oldest FROM job_outbox o LEFT JOIN integration_job_receipt r ON r.outbox_id=o.id
    WHERE o.state<>'Cancelled' AND r.outbox_id IS NULL GROUP BY o.kind ORDER BY count(*) DESC LIMIT 8`),
  tlsEvidence()]);
 const o=outbound.rows[0];
 return {checkedAt:new Date().toISOString(),dbLatencyMs,inbound:{enabled:inboundSettings.enabled,intervalSeconds:inboundSettings.intervalSeconds,lastSuccess:inbound.LastSuccess,lastError:inbound.LastError,share:inbound.shareStatus,alive:inbound.Alive,healthy:inbound.healthy,readyBacklog:inbound.readyBacklog,waitingOkOverdue:inbound.waitingOkOverdue},
  outbound:{configured:!!outboundSettings?.success,enabled:outboundSettings?.success?outboundSettings.data.enabled:false,target:outboundSettings?.success?outboundSettings.data.target:null,written:o.written,pending:o.pending,retry:o.retry,attention:o.attention,lastWritten:o.last_written?.toISOString()??null,hisAck:'NOT_IMPLEMENTED' as const},
  queues:queues.rows.map(q=>({kind:q.kind,pending:q.pending,oldest:q.oldest?.toISOString()??null})),tls};
}
