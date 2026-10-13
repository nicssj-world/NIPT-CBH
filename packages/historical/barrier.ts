import {PROMOTION_NEVER_CREATES} from './lifecycle';

/**
 * Outbound barrier (Plan LD-10, D-43, D-47, §6.3 items 8/15, AT-HIST-04/13, R-47). Phase 1 has NO path that sends a historical result to
 * HIS/CFS. This predicate is the application-level mirror of the DB invariants and is meant to be called by P6 (outbound) before it
 * queues, builds, publishes or confirms anything. It is deny-by-default: only a current-case origin whose LN was verified by a `.pet` passes.
 * P5H does not edit P6; wiring this predicate into P6 is a follow-up for the P6 owner (docs/p5h-historical-backfill-foundation.md §8).
 */
export const HISTORICAL_OUTBOUND_PROHIBITED='HISTORICAL_OUTBOUND_PROHIBITED';
export type OutboundSubject={origin:string;lnVerification:string};
export function outboundBarrier(s:OutboundSubject):{allowed:true}|{allowed:false;code:string}{
 if(s.origin==='HISTORICAL')return {allowed:false,code:HISTORICAL_OUTBOUND_PROHIBITED};
 if(s.origin!=='ANC'&&s.origin!=='LAB_DIRECT')return {allowed:false,code:'UNKNOWN_ORIGIN'};
 if(s.lnVerification!=='VERIFIED_BY_PET')return {allowed:false,code:'LN_NOT_VERIFIED_BY_PET'};
 return {allowed:true};
}
export function assertOutboundAllowed(s:OutboundSubject):void{const r=outboundBarrier(s);if(!r.allowed)throw new Error(r.code);}

/** Entity/effect names a historical flow must never produce. A planned effect list containing any of them is rejected. */
export function assertNoForbiddenHistoricalEffects(effects:readonly string[]):void{
 const bad=effects.filter(e=>(PROMOTION_NEVER_CREATES as readonly string[]).includes(e));
 if(bad.length)throw new Error(`HISTORICAL_FORBIDDEN_EFFECT:${bad[0]}`);
}
