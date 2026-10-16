import {it,expect} from 'vitest';
import {workerHealth} from '../../packages/jobs/health';
import {workerIdentity,healthFromEvidence} from '../../packages/admin/health';
it('selects runtime worker and rejects stale/future heartbeat independently of inbound enabled',()=>{
 expect(workerIdentity('synthetic')).toBe('synthetic-worker');expect(workerIdentity('operational')).toBe('operational-worker');
 const now=new Date('2026-10-16T00:00:00Z');
 const input={enabled:false,observedAt:now,lastSuccess:null,lastError:null,backlog:0,oldestPendingAt:null};
 expect(workerHealth(input,now).Alive).toBe(true);
 expect(workerHealth({...input,observedAt:new Date(now.getTime()+1000)},now).Alive).toBe(false);
 expect(workerHealth({...input,observedAt:new Date(now.getTime()-100000)},now,60).Alive).toBe(false);
});
it('uses active notification thresholds and does not equate inbound disabled with process offline',()=>{
 const now=new Date();const evidence={mode:'operational' as const,databaseOperational:true,quarantined:false,migrationsMatch:true,workerLockHeld:true,heartbeat:{observed_at:new Date(now.getTime()-65000),details:{lastSuccess:null,lastError:null}},backlog:2,oldest:null,reconciliation:0,p6Retry:0,p6Unresolved:0,scanFailure:false,renderer:'ALIVE' as const};
 const defaults=healthFromEvidence(evidence,{staleSeconds:90,backlogWarning:10},now);expect(defaults.technicalReady).toBe(true);
 const active=healthFromEvidence(evidence,{staleSeconds:60,backlogWarning:2},now);expect(active.technicalReady).toBe(false);expect(active.alerts).toContain('WORKER_OFFLINE');expect(active.alerts).toContain('QUEUE_BACKLOG');
 expect(healthFromEvidence({...evidence,databaseOperational:false},{staleSeconds:90,backlogWarning:10},now).technicalReady).toBe(false);
 expect(healthFromEvidence({...evidence,workerLockHeld:false},{staleSeconds:90,backlogWarning:10},now).technicalReady).toBe(false);
});
