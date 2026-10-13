import {bangkokDay,isIsoDay,latestPossibleDate,latestPossibleIsBefore,type HistoricalDate} from './dates';
import {hashOf} from './hash';
import {ANCHOR_CAPABLE_KINDS,NEVER_ANCHOR_KINDS,type CutoffVersion,type EvidenceItem,type EvidenceKind,type HistoricalEvent,type Reason} from './types';

export const ELIGIBILITY_RULE_VERSION='P5H-ELIGIBILITY-SYNTHETIC-v1';

/**
 * OD-18 (Anchor kinds) is an OPEN Owner decision. The caller must pass the accepted kinds explicitly; there is no production default.
 * Tests use ['FINAL_RESULT_REPORT'] — Plan OD-18 "ระหว่างรอ: การทดสอบใช้ Anchor (a)".
 */
export type EligibilityPolicy={acceptedAnchorKinds:readonly EvidenceKind[]};
export function assertPolicy(p:EligibilityPolicy):EligibilityPolicy{
 if(!p.acceptedAnchorKinds.length)throw new Error('ANCHOR_POLICY_REQUIRED');
 for(const k of p.acceptedAnchorKinds){if(NEVER_ANCHOR_KINDS.includes(k)||!ANCHOR_CAPABLE_KINDS.includes(k))throw new Error('ANCHOR_KIND_NOT_PERMITTED');}
 return p;
}

/** Facts about NIPT activity for the same LN, read by the caller under the LN advisory lock (D-49). */
export type NiptActivity={
 caseLnExists:boolean;       // any origin, any version
 petApplied:boolean;         // an Applied(S1) .pet
 receivedInNipt:boolean;
 inBatch:boolean;
 released:boolean;
 unlinkedIntakeHisReceivedAt:readonly string[]; // ISO instants of unlinked .pet intakes
};
export const NO_ACTIVITY:NiptActivity={caseLnExists:false,petApplied:false,receivedInNipt:false,inBatch:false,released:false,unlinkedIntakeHisReceivedAt:[]};

export type EligibilityInput={
 evidence:readonly EvidenceItem[];
 events:readonly HistoricalEvent[];
 cutoff:CutoffVersion|null;
 activity:NiptActivity;
 policy:EligibilityPolicy;
};
export type EligibilitySnapshot={
 ruleVersion:string;
 cutoff:{version:number;cutoff:string}|null;
 policy:{acceptedAnchorKinds:string[]};
 anchor:{evidenceItemId:string;kind:string;date:string}|null;
 events:{id:string;type:string;precision:string;latestPossible:string|null}[];
 activity:{caseLnExists:boolean;petApplied:boolean;receivedInNipt:boolean;inBatch:boolean;released:boolean;unlinkedIntakeDays:string[]};
 reasons:Reason[];
};
export type EligibilityResult={outcome:'Submitted'|'NotEligible';reasons:Reason[];snapshot:EligibilitySnapshot;hash:string};

/**
 * Submission/Promotion eligibility (Plan §5.11, D-46, AT-HIST-06/10/15). Pure and deterministic: the same input always yields the same
 * snapshot and hash, and the hash never depends on a later cutoff version (the snapshot embeds the version it used — D-50).
 * Fail-closed: no cutoff, no Anchor, unknown dates or any NIPT activity ⇒ NotEligible. A reason is never dropped to make a case pass.
 */
export function evaluateEligibility(input:EligibilityInput):EligibilityResult{
 const policy=assertPolicy(input.policy);
 const reasons:Reason[]=[];
 const cutoff=input.cutoff;
 if(cutoff&&!isIsoDay(cutoff.cutoff))throw new Error('INVALID_CUTOFF');
 if(!cutoff)reasons.push({code:'CUTOFF_NOT_CONFIGURED'});

 // Anchor: accepted kind, day-resolution date, strictly before cutoff. Request/Consent kinds were rejected by assertPolicy.
 const candidates=input.evidence.filter(e=>policy.acceptedAnchorKinds.includes(e.kind)).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
 let anchor:EligibilitySnapshot['anchor']=null;
 if(cutoff){
  const usable=candidates.filter(e=>e.documentDate.precision==='DAY'&&latestPossibleIsBefore(e.documentDate,cutoff.cutoff));
  if(usable.length){const a=usable[0];anchor={evidenceItemId:a.id,kind:a.kind,date:(a.documentDate as Extract<HistoricalDate,{precision:'DAY'}>).value};}
  else if(!candidates.length)reasons.push({code:'NO_ANCHOR'});
  else if(!candidates.some(e=>e.documentDate.precision==='DAY'))reasons.push({code:'ANCHOR_DATE_NOT_DAY_PRECISION'});
  else reasons.push({code:'ANCHOR_NOT_BEFORE_CUTOFF'});
 }

 const events=[...input.events].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
 if(cutoff)for(const ev of events){
  if(ev.date.precision==='UNKNOWN')reasons.push({code:'EVENT_DATE_UNKNOWN',ref:ev.id});
  else if(!latestPossibleIsBefore(ev.date,cutoff.cutoff))reasons.push({code:'EVENT_NOT_BEFORE_CUTOFF',ref:ev.id});
 }

 const a=input.activity;
 if(a.caseLnExists)reasons.push({code:'LN_ALREADY_REGISTERED'});
 if(a.petApplied)reasons.push({code:'NIPT_ACTIVITY_PET_APPLIED'});
 if(a.receivedInNipt)reasons.push({code:'NIPT_ACTIVITY_RECEIVED'});
 if(a.inBatch)reasons.push({code:'NIPT_ACTIVITY_BATCH'});
 if(a.released)reasons.push({code:'NIPT_ACTIVITY_RELEASED'});
 const intakeDays=a.unlinkedIntakeHisReceivedAt.map(bangkokDay).sort();
 if(cutoff&&intakeDays.some(d=>d>=cutoff.cutoff))reasons.push({code:'UNLINKED_INTAKE_AFTER_CUTOFF'});

 const snapshot:EligibilitySnapshot={
  ruleVersion:ELIGIBILITY_RULE_VERSION,
  cutoff:cutoff?{version:cutoff.version,cutoff:cutoff.cutoff}:null,
  policy:{acceptedAnchorKinds:[...policy.acceptedAnchorKinds].sort()},
  anchor,
  events:events.map(e=>({id:e.id,type:e.type,precision:e.date.precision,latestPossible:latestPossibleDate(e.date)})),
  activity:{caseLnExists:a.caseLnExists,petApplied:a.petApplied,receivedInNipt:a.receivedInNipt,inBatch:a.inBatch,released:a.released,unlinkedIntakeDays:intakeDays},
  reasons,
 };
 return {outcome:reasons.length?'NotEligible':'Submitted',reasons,snapshot,hash:hashOf(snapshot)};
}
