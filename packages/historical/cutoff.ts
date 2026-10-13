import {isIsoDay} from './dates';
import {hashOf} from './hash';
import type {EligibilitySnapshot} from './eligibility';
import type {CutoffVersion} from './types';

/**
 * `go_live_cutoff` change control (D-50, OD-27, AT-HIST-14/15). The cutoff VALUE is an Owner/Clinical Governance decision and is never
 * defaulted here. OD-27 is open: only the interim behaviour recorded in the plan ("ระหว่างรอ OD-27: เปลี่ยนค่าไม่ได้เมื่อมีเคส HISTORICAL")
 * is implemented, and it mirrors the existing DB trigger `settings_activation_guard` (OD27_REQUIRED). Options (a) and (b) are refused rather than guessed.
 */
export type Od27Choice='PENDING'|'A_CHANGE_WITH_IMPACT_REVIEW'|'B_CHANGE_NO_REVIEW'|'C_FROZEN_AFTER_FIRST_PROMOTION';
export function assertCutoffChangeAllowed(i:{hasHistoricalCase:boolean;od27:Od27Choice}):void{
 if(!i.hasHistoricalCase)return;
 if(i.od27==='PENDING')throw new Error('OD27_REQUIRED');
 if(i.od27==='C_FROZEN_AFTER_FIRST_PROMOTION')throw new Error('CUTOFF_FROZEN_AFTER_FIRST_PROMOTION');
 throw new Error('OD27_OPTION_NOT_IMPLEMENTED');
}

/** Versions are insert-only and strictly increasing; a new version never edits an older one. */
export function appendCutoffVersion(existing:readonly CutoffVersion[],next:CutoffVersion):CutoffVersion[]{
 if(!isIsoDay(next.cutoff)||!isIsoDay(next.effectiveFrom))throw new Error('INVALID_CUTOFF');
 const last=existing.at(-1);
 if(last&&next.version!==last.version+1)throw new Error('CUTOFF_VERSION_NOT_SEQUENTIAL');
 if(!last&&next.version!==1)throw new Error('CUTOFF_VERSION_NOT_SEQUENTIAL');
 if(last&&next.effectiveFrom<last.effectiveFrom)throw new Error('CUTOFF_EFFECTIVE_FROM_REGRESSION');
 return [...existing,Object.freeze({...next})];
}
/** The version in force on a calendar day (Asia/Bangkok): the latest version whose effectiveFrom ≤ day. null ⇒ no cutoff configured ⇒ eligibility fails closed. */
export function activeCutoffOn(versions:readonly CutoffVersion[],day:string):CutoffVersion|null{
 if(!isIsoDay(day))throw new Error('INVALID_DAY');
 let found:CutoffVersion|null=null;
 for(const v of versions)if(v.effectiveFrom<=day)found=v;
 return found;
}

export type ImpactItem={id:string;kind:'SUBMITTED_DRAFT'|'PROMOTED_CASE';evaluationHash:string;snapshot:EligibilitySnapshot};
export type ImpactReport={
 from:number;to:number;fromCutoff:string;toCutoff:string;
 unaffected:string[];
 /** Promoted cases whose stored evidence would NOT qualify under the new cutoff → review queue (OD-27 (a)); nothing is changed automatically. */
 wouldNoLongerQualify:string[];
 /** Submitted drafts: the next promotion re-evaluates them under the version then active. */
 draftsToReevaluate:string[];
 hash:string;
};
/** Deterministic, read-only impact report. Uses stored snapshots only (never recomputes or alters an evaluation). */
export function buildImpactReport(from:CutoffVersion,to:CutoffVersion,items:readonly ImpactItem[]):ImpactReport{
 const unaffected:string[]=[],wouldNoLongerQualify:string[]=[],draftsToReevaluate:string[]=[];
 for(const it of [...items].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0)){
  if(it.kind==='SUBMITTED_DRAFT'){draftsToReevaluate.push(it.id);continue;}
  const s=it.snapshot;
  const anchorOk=s.anchor!==null&&s.anchor.date<to.cutoff;
  const eventsOk=s.events.every(e=>e.latestPossible!==null&&e.latestPossible<to.cutoff);
  (anchorOk&&eventsOk?unaffected:wouldNoLongerQualify).push(it.id);
 }
 const body={from:from.version,to:to.version,fromCutoff:from.cutoff,toCutoff:to.cutoff,unaffected,wouldNoLongerQualify,draftsToReevaluate};
 return {...body,hash:hashOf(body)};
}
