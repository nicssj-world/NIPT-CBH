import type {RuntimeMode} from '../security/runtime';
import {workerHealth} from '../jobs/health';
export const workerIdentity=(mode:RuntimeMode)=>mode==='operational'?'operational-worker':'synthetic-worker';
export type HealthEvidence={mode:RuntimeMode;databaseOperational:boolean;quarantined:boolean;migrationsMatch:boolean;workerLockHeld:boolean;heartbeat?:{observed_at:Date;details:{lastSuccess?:string|null;lastError?:string|null}};backlog:number;oldest:Date|null;reconciliation:number;p6Retry:number;p6Unresolved:number;p6WorkerError?:boolean;scanFailure:boolean;renderer:'ALIVE'|'OFFLINE'|'NOT CONFIGURED'};
export function healthFromEvidence(e:HealthEvidence,thresholds:{staleSeconds:number;backlogWarning:number},now=new Date()){
 const h=e.heartbeat;
 const error=h?.details.lastError;const safeError=error?(['JOB_FAILED','CYCLE_FAILED','HEARTBEAT_FAILED','RECONCILIATION_REQUIRED'].includes(error)?error:'WORKER_REPORTED_ERROR'):null;
 const success=h?.details.lastSuccess?new Date(h.details.lastSuccess):null;
 const base=workerHealth({enabled:true,observedAt:h?.observed_at??null,lastSuccess:success&&Number.isFinite(success.getTime())?success:null,lastError:safeError,backlog:e.backlog,oldestPendingAt:e.oldest},now,thresholds.staleSeconds,thresholds.backlogWarning);
 const alive=base.Alive&&e.workerLockHeld,modeMatches=e.databaseOperational===(e.mode==='operational');
 const alerts:string[]=[];
 if(e.p6WorkerError)alerts.push('TRANSFER_WORKER_ERROR');
 if(!alive)alerts.push('WORKER_OFFLINE');if(e.backlog>=thresholds.backlogWarning)alerts.push('QUEUE_BACKLOG');if(base.age>thresholds.staleSeconds)alerts.push('QUEUE_STALE');if(base.LastError)alerts.push('WORKER_ERROR');if(e.scanFailure)alerts.push('HIS_SCAN_FAILURE');if(e.p6Retry)alerts.push('TRANSFER_RETRY');if(e.p6Unresolved||e.reconciliation)alerts.push('TRANSFER_RECONCILIATION');if(!modeMatches)alerts.push('RUNTIME_MODE_MISMATCH');if(e.quarantined)alerts.push('RECOVERY_QUARANTINE');if(!e.migrationsMatch)alerts.push('MIGRATION_MISMATCH');if(e.renderer!=='ALIVE')alerts.push('RENDERER_UNAVAILABLE');
 return {...base,Alive:alive,modeMatches,workerId:workerIdentity(e.mode),runtimeMode:e.mode,databaseMode:e.databaseOperational?'operational':'synthetic',quarantined:e.quarantined,migrationsMatch:e.migrationsMatch,renderer:e.renderer,alerts,thresholds,technicalReady:alerts.length===0,healthy:alerts.length===0,unresolvedReconciliation:e.reconciliation+e.p6Unresolved,p6Retry:e.p6Retry,observedAt:h?.observed_at??null,heartbeatAge:h?Math.max(0,Math.round((now.getTime()-h.observed_at.getTime())/1000)):null};
}
