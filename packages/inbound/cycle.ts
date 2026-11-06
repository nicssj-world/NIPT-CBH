import type {Queryable} from '../db/connection';
import type {FileStore} from '../storage';
import {appendAudit} from '../db/audit';
import {assertSimulatorRoot} from '../integrations/scanner';
import {discoverInbound,emptyCounts} from './discovery';
import {processPending,type InboundDeps} from './process';
import {errorCode} from './tx';
import {type InboundSource,inboundAccessError} from './source';
import {currentInboundScan,type InboundScanState} from './scan-state';

export type ScanTrigger='INTERVAL'|'MANUAL'|'DEEP';
export interface CycleOptions{trigger:ScanTrigger;lookbackDays:number;intervalSeconds:number;actorId?:string;now?:()=>Date;configurationSince?:Date;configurationId?:string;}
export const MAX_BACKOFF_SECONDS=900;
export function backoffSeconds(consecutiveFailures:number,intervalSeconds:number){
 return consecutiveFailures<1?0:Math.min(MAX_BACKOFF_SECONDS,intervalSeconds*2**(consecutiveFailures-1));
}
/** Compatibility API: failures come from current operational state, never the last meaningful event. */
export async function consecutiveFailures(db:Queryable,since?:Date){
 const state=await currentInboundScan(db);
 return {count:state&&(!since||new Date(state.started_at)>=since)?state.consecutive_failures:0,lastFinishedAt:state?new Date(state.finished_at):null};
}

/** Reuse the existing scanner and matching pipeline; only meaningful cycles append immutable history.
 * The worker's existing configuration lease serializes scans. Summary state contains no patient evidence. */
export async function runInboundCycle(db:Queryable,deps:InboundDeps&{root:string;store:FileStore;source?:InboundSource},options:CycleOptions){
 const clock=options.now??(()=>new Date()),started=clock();
 const configurationId=options.configurationId??`source:${deps.source?.id??deps.root}:${options.configurationSince?.toISOString()??''}`;
 const previous=(await db.query<InboundScanState>('SELECT * FROM his_inbound_scan_state WHERE configuration_id=$1',[configurationId])).rows[0];
 const record=async(outcome:string,counts:Record<string,number>,code:string|null)=>{
  const finished=clock(),skipped=outcome==='SKIPPED_BACKOFF',failed=['FAILED','SHARE_UNAVAILABLE'].includes(outcome);
  const failures=skipped?previous?.consecutive_failures??0:failed?(previous?.consecutive_failures??0)+1:0;
  await db.query(`INSERT INTO his_inbound_scan_state(configuration_id,heartbeat_at,started_at,finished_at,trigger,outcome,counts,error_code,last_success_at,last_error_at,last_error_code,consecutive_failures)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
   ON CONFLICT(configuration_id) DO UPDATE SET heartbeat_at=excluded.heartbeat_at,started_at=excluded.started_at,finished_at=excluded.finished_at,trigger=excluded.trigger,outcome=excluded.outcome,counts=excluded.counts,error_code=excluded.error_code,last_success_at=excluded.last_success_at,last_error_at=excluded.last_error_at,last_error_code=excluded.last_error_code,consecutive_failures=excluded.consecutive_failures`,
   [configurationId,finished,skipped?previous?.started_at??started:started,skipped?previous?.finished_at??finished:finished,options.trigger,outcome,JSON.stringify(skipped?previous?.counts??{}:counts),skipped?previous?.error_code??null:code,outcome==='SUCCESS'?finished:previous?.last_success_at??null,code?finished:previous?.last_error_at??null,code??previous?.last_error_code??null,failures]);
  const changes=Object.entries(counts).some(([k,v])=>v>0&&(['stored','sameContent','newPathVersion','waitingNew','okArrived','parseError','readError','processingFailed'].includes(k)||k.startsWith('outcome_')&&!['outcome_SKIPPED','outcome_DUPLICATE'].includes(k)));
  const transition=!!previous&&(previous.outcome==='SKIPPED_BACKOFF'?previous.consecutive_failures>0:previous.outcome!=='SUCCESS')&&outcome==='SUCCESS';
  if(skipped||options.trigger==='INTERVAL'&&outcome==='SUCCESS'&&!changes&&!transition)return;
  await db.query('INSERT INTO his_inbound_scan_run(trigger,lookback_days,started_at,finished_at,outcome,counts,error_code,actor_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[options.trigger,options.lookbackDays,started,finished,outcome,JSON.stringify(counts),code,options.actorId??null]);
  await appendAudit(db,{actorId:options.actorId,action:'INBOUND_SCAN_COMPLETED',resourceType:'his_inbound_scan_run',details:{outcome,reasonCode:options.trigger,count:counts.stored??0,synthetic:true}});
 };
 if(options.trigger==='INTERVAL'){
  const wait=backoffSeconds(previous?.consecutive_failures??0,options.intervalSeconds);
  if(wait&&previous&&started.getTime()-new Date(previous.finished_at).getTime()<wait*1000){await record('SKIPPED_BACKOFF',{},null);return {outcome:'SKIPPED_BACKOFF' as string,counts:{} as Record<string,number>,failures:[] as {id:string;code:string}[],stored:[] as string[]};}
 }
 try{if(deps.source)await deps.source.assert();else await assertSimulatorRoot(deps.root);}
 catch(e){const code=deps.source?inboundAccessError(e):'INBOUND_SHARE_UNAVAILABLE';await record('SHARE_UNAVAILABLE',emptyCounts() as unknown as Record<string,number>,code);throw Error(code);}
 let discovered,processed;
 try{
  discovered=await discoverInbound(db,deps.store,{root:deps.root,lookbackDays:options.lookbackDays,now:started,lookupKey:deps.lookupKey,source:deps.source});
  if(deps.source)await deps.source.assert();
  processed=await processPending(db,deps);
 }catch(e){const code=errorCode(e);await record('FAILED',emptyCounts() as unknown as Record<string,number>,code);throw Error(code);}
 const counts:Record<string,number>={...discovered.counts,...Object.fromEntries(Object.entries(processed.outcomes).map(([k,v])=>['outcome_'+k,v])),processingFailed:processed.failures.length};
 const failed=processed.failures.length+discovered.counts.readError,outcome=failed?'PARTIAL':'SUCCESS';
 await record(outcome,counts,failed?(processed.failures[0]?.code??discovered.readErrors[0]??'PROCESSING_FAILED'):null);
 return {outcome,counts,failures:processed.failures,stored:discovered.stored};
}
