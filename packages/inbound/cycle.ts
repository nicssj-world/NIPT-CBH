import type {Queryable} from '../db/connection';
import type {FileStore} from '../storage';
import {appendAudit} from '../db/audit';
import {assertSimulatorRoot} from '../integrations/scanner';
import {discoverInbound,emptyCounts} from './discovery';
import {processPending,type InboundDeps} from './process';
import {errorCode} from './tx';
import {type InboundSource,inboundAccessError} from './source';

export type ScanTrigger='INTERVAL'|'MANUAL'|'DEEP';
export interface CycleOptions{trigger:ScanTrigger;lookbackDays:number;intervalSeconds:number;actorId?:string;now?:()=>Date;configurationSince?:Date;}
export const MAX_BACKOFF_SECONDS=900;

/** Interval scans back off exponentially after consecutive share/scan failures; manual and deep scans always run. */
export function backoffSeconds(consecutiveFailures:number,intervalSeconds:number){
 return consecutiveFailures<1?0:Math.min(MAX_BACKOFF_SECONDS,intervalSeconds*2**(consecutiveFailures-1));
}
/** OWNER-LAB-055/059: `since` = when the worker first used the current inbound configuration, so failures recorded under an
 *  older (wrong) folder never delay the first scan of the folder the administrator just corrected. */
export async function consecutiveFailures(db:Queryable,since?:Date){
 const rows=(await db.query<{outcome:string;finished_at:Date}>("SELECT outcome,finished_at FROM his_inbound_scan_run WHERE outcome<>'SKIPPED_BACKOFF' AND ($1::timestamptz IS NULL OR started_at>=$1) ORDER BY finished_at DESC LIMIT 20",[since??null])).rows;
 let n=0;for(const r of rows){if(r.outcome!=='SHARE_UNAVAILABLE'&&r.outcome!=='FAILED')break;n++;}
 return {count:n,lastFinishedAt:rows[0]?new Date(rows[0].finished_at):null};
}

/**
 * One inbound cycle on the synthetic simulator: verify the marked read-only root, discover, then match pending
 * intakes. Every cycle (including skipped/failed) leaves an immutable scan-run row for health and retry evidence.
 */
export async function runInboundCycle(db:Queryable,deps:InboundDeps&{root:string;store:FileStore;source?:InboundSource},options:CycleOptions){
 const clock=options.now??(()=>new Date()),started=clock();
 const record=async(outcome:string,counts:Record<string,number>,code:string|null)=>{
  await db.query('INSERT INTO his_inbound_scan_run(trigger,lookback_days,started_at,finished_at,outcome,counts,error_code,actor_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[options.trigger,options.lookbackDays,started,clock(),outcome,JSON.stringify(counts),code,options.actorId??null]);
  if(outcome!=='SKIPPED_BACKOFF')await appendAudit(db,{actorId:options.actorId,action:'INBOUND_SCAN_COMPLETED',resourceType:'his_inbound_scan_run',details:{outcome,reasonCode:options.trigger,count:counts.stored??0,synthetic:true}});
 };
 if(options.trigger==='INTERVAL'){
  const f=await consecutiveFailures(db,options.configurationSince),wait=backoffSeconds(f.count,options.intervalSeconds);
  if(wait&&f.lastFinishedAt&&started.getTime()-f.lastFinishedAt.getTime()<wait*1000){await record('SKIPPED_BACKOFF',{consecutiveFailures:f.count,backoffSeconds:wait},null);return {outcome:'SKIPPED_BACKOFF' as string,counts:{} as Record<string,number>,failures:[] as {id:string;code:string}[],stored:[] as string[]};}
 }
 try{if(deps.source)await deps.source.assert();else await assertSimulatorRoot(deps.root);}
 catch(e){const code=deps.source?inboundAccessError(e):'INBOUND_SHARE_UNAVAILABLE';await record('SHARE_UNAVAILABLE',emptyCounts() as unknown as Record<string,number>,code);throw Error(code);}
 let discovered;
 try{discovered=await discoverInbound(db,deps.store,{root:deps.root,lookbackDays:options.lookbackDays,now:started,lookupKey:deps.lookupKey,source:deps.source});}
 catch(e){const code=errorCode(e);await record('FAILED',emptyCounts() as unknown as Record<string,number>,code);throw Error(code);}
 if(deps.source)await deps.source.assert();
 const processed=await processPending(db,deps);
 const counts:Record<string,number>={...discovered.counts,...Object.fromEntries(Object.entries(processed.outcomes).map(([k,v])=>['outcome_'+k,v])),processingFailed:processed.failures.length};
 const failed=processed.failures.length+discovered.counts.readError;
 const outcome=failed?'PARTIAL':'SUCCESS';
 await record(outcome,counts,failed?(processed.failures[0]?.code??discovered.readErrors[0]??'PROCESSING_FAILED'):null);
 return {outcome,counts,failures:processed.failures,stored:discovered.stored};
}
