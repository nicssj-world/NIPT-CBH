import {describe,it,expect} from 'vitest';
import fc from 'fast-check';
import {dayDate,monthDate,yearDate,UNKNOWN_DATE,latestPossibleDate,latestPossibleIsBefore,bangkokDay,parseLegacyDate,assertHistoricalDate,daysInMonth} from '../../packages/historical/dates';
import {evaluateEligibility,NO_ACTIVITY,assertPolicy,type EligibilityInput} from '../../packages/historical/eligibility';
import type {EvidenceItem,HistoricalEvent,CutoffVersion} from '../../packages/historical/types';
import {evidenceItemSchema} from '../../packages/historical/types';
import {hashOf,canonicalJson} from '../../packages/historical/hash';

// SYNTHETIC test cutoff only. The real go_live_cutoff is an Owner/Clinical Governance decision (OD-27/AL-8) and is not defaulted anywhere in production code.
const CUT:CutoffVersion={version:1,cutoff:'2026-01-01',effectiveFrom:'2025-12-01',impactReportHash:'a'.repeat(64)};
const POLICY={acceptedAnchorKinds:['FINAL_RESULT_REPORT'] as const};
const item=(over:Partial<EvidenceItem>&{id:string}):EvidenceItem=>({kind:'FINAL_RESULT_REPORT',originalLocation:'SYNTHETIC-CABINET-1',documentDate:dayDate(2025,12,20),appears:null,fileSha256:'b'.repeat(64),provenance:'PAPER_ORIGINAL',sourceRef:null,...over});
const ev=(id:string,date=dayDate(2025,12,10),type:HistoricalEvent['type']='COLLECTION'):HistoricalEvent=>({id,type,date,evidenceItemId:null});
const base=(over:Partial<EligibilityInput>={}):EligibilityInput=>({evidence:[item({id:'e1'})],events:[ev('c1')],cutoff:CUT,activity:NO_ACTIVITY,policy:POLICY,...over});
const codes=(i:EligibilityInput)=>evaluateEligibility(i).reasons.map(r=>r.code);

describe('P5H dates keep their resolution and never invent a day (AT-HIST-10/15)',()=>{
 it('latest possible date follows the recorded resolution',()=>{
  expect(latestPossibleDate(dayDate(2025,12,31))).toBe('2025-12-31');
  expect(latestPossibleDate(monthDate(2024,2))).toBe('2024-02-29');   // leap year
  expect(latestPossibleDate(monthDate(2025,2))).toBe('2025-02-28');
  expect(latestPossibleDate(yearDate(2025))).toBe('2025-12-31');
  expect(latestPossibleDate(UNKNOWN_DATE)).toBeNull();
 });
 it('rejects impossible calendar dates instead of normalising them',()=>{
  expect(()=>dayDate(2025,2,29)).toThrow('INVALID_HISTORICAL_DATE');
  expect(()=>dayDate(2025,13,1)).toThrow();expect(()=>dayDate(2025,4,31)).toThrow();expect(()=>monthDate(2025,0)).toThrow();expect(()=>yearDate(1800)).toThrow();
  expect(()=>assertHistoricalDate({precision:'DAY',value:'2025-02-30'})).toThrow();
  expect(()=>assertHistoricalDate({precision:'MONTH',value:'2025-1'} as never)).toThrow();
 });
 it('the cutoff day itself is NOT before the cutoff; the day before is',()=>{
  expect(latestPossibleIsBefore(dayDate(2025,12,31),'2026-01-01')).toBe(true);
  expect(latestPossibleIsBefore(dayDate(2026,1,1),'2026-01-01')).toBe(false);
  expect(latestPossibleIsBefore(monthDate(2025,12),'2026-01-01')).toBe(true);
  expect(latestPossibleIsBefore(monthDate(2026,1),'2026-01-01')).toBe(false);
  expect(latestPossibleIsBefore(yearDate(2025),'2026-01-01')).toBe(true);
  expect(latestPossibleIsBefore(yearDate(2026),'2026-01-01')).toBe(false);
  expect(latestPossibleIsBefore(UNKNOWN_DATE,'2026-01-01')).toBe(false);
  expect(()=>latestPossibleIsBefore(dayDate(2025,1,1),'2026-1-1')).toThrow('INVALID_CUTOFF');
 });
 it('compares calendar days in Asia/Bangkok, not UTC',()=>{
  expect(bangkokDay('2025-12-31T16:59:59Z')).toBe('2025-12-31');
  expect(bangkokDay('2025-12-31T17:00:00Z')).toBe('2026-01-01');
  expect(()=>bangkokDay('not a date')).toThrow('INVALID_INSTANT');
 });
 it('legacy date spellings parse; unreadable values become UNKNOWN and never pass (legacy matcher failed open)',()=>{
  expect(parseLegacyDate('25-Dec-2025').date).toEqual(dayDate(2025,12,25));
  expect(parseLegacyDate('2025-12-25').date).toEqual(dayDate(2025,12,25));
  expect(parseLegacyDate('20251225').date).toEqual(dayDate(2025,12,25));
  expect(parseLegacyDate('20251225101500').date).toEqual(dayDate(2025,12,25));
  expect(parseLegacyDate('2025-12-25 10:15:00').date).toEqual(dayDate(2025,12,25));
  expect(parseLegacyDate('')).toEqual({date:UNKNOWN_DATE,issue:'EMPTY'});
  expect(parseLegacyDate(undefined).issue).toBe('EMPTY');
  expect(parseLegacyDate('31-Feb-2025')).toEqual({date:UNKNOWN_DATE,issue:'IMPOSSIBLE_DATE'});
  expect(parseLegacyDate('25/12/2568').issue).toBe('UNPARSEABLE');
  expect(parseLegacyDate('25-Dec-2568')).toEqual({date:UNKNOWN_DATE,issue:'AMBIGUOUS_YEAR_ERA'});   // Buddhist era is never guessed
  expect(parseLegacyDate('01-Jan-1850').issue).toBe('YEAR_OUT_OF_RANGE');
  expect(parseLegacyDate('garbage').issue).toBe('UNPARSEABLE');
 });
 it('property: DAY precision is eligible iff the day is strictly before the cutoff',()=>{
  fc.assert(fc.property(fc.integer({min:2000,max:2040}),fc.integer({min:1,max:12}),fc.integer({min:1,max:28}),fc.integer({min:2000,max:2040}),fc.integer({min:1,max:12}),fc.integer({min:1,max:28}),(y,m,d,cy,cm,cd)=>{
   const day=`${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
   const cutoff=`${cy}-${String(cm).padStart(2,'0')}-${String(cd).padStart(2,'0')}`;
   return latestPossibleIsBefore(dayDate(y,m,d),cutoff)===(day<cutoff);
  }));
 });
 it('property: month and year resolution use the last day of the period',()=>{
  fc.assert(fc.property(fc.integer({min:2000,max:2040}),fc.integer({min:1,max:12}),(y,m)=>{
   const last=`${y}-${String(m).padStart(2,'0')}-${String(daysInMonth(y,m)).padStart(2,'0')}`;
   return latestPossibleDate(monthDate(y,m))===last&&latestPossibleDate(yearDate(y))===`${y}-12-31`&&latestPossibleIsBefore(monthDate(y,m),last)===false;
  }));
 });
});

describe('P5H eligibility evaluation is fail-closed and deterministic (D-46, AT-HIST-06/10/15)',()=>{
 it('passes only with a day-resolution Anchor and all events before cutoff',()=>{
  const r=evaluateEligibility(base());
  expect(r.outcome).toBe('Submitted');expect(r.reasons).toEqual([]);
  expect(r.snapshot.anchor).toEqual({evidenceItemId:'e1',kind:'FINAL_RESULT_REPORT',date:'2025-12-20'});
  expect(r.snapshot.cutoff).toEqual({version:1,cutoff:'2026-01-01'});
 });
 it('AT-HIST-10(1): no Anchor ⇒ NotEligible; Request/Consent papers dated before cutoff are not Anchors',()=>{
  expect(codes(base({evidence:[]}))).toEqual(['NO_ANCHOR']);
  expect(codes(base({evidence:[item({id:'r',kind:'REQUEST_PAPER'}),item({id:'c',kind:'CONSENT_PAPER'})]}))).toEqual(['NO_ANCHOR']);
  expect(codes(base({evidence:[item({id:'n',kind:'REDRAW_NOTICE'})]}))).toEqual(['NO_ANCHOR']);
  expect(codes(base({evidence:[item({id:'l',kind:'LEGACY_DB_RECORD'})]}))).toEqual(['NO_ANCHOR']);
 });
 it('AT-HIST-10(2): Anchor dated by month/year/unknown cannot be used',()=>{
  for(const d of [monthDate(2025,11),yearDate(2025),UNKNOWN_DATE])expect(codes(base({evidence:[item({id:'e1',documentDate:d})]}))).toEqual(['ANCHOR_DATE_NOT_DAY_PRECISION']);
 });
 it('Anchor on or after the cutoff day is refused',()=>{
  expect(codes(base({evidence:[item({id:'e1',documentDate:dayDate(2026,1,1)})]}))).toEqual(['ANCHOR_NOT_BEFORE_CUTOFF']);
  expect(codes(base({evidence:[item({id:'e1',documentDate:dayDate(2026,3,1)})]}))).toEqual(['ANCHOR_NOT_BEFORE_CUTOFF']);
  expect(codes(base({evidence:[item({id:'e1',documentDate:dayDate(2025,12,31)})]}))).toEqual([]);
 });
 it('a later qualifying Anchor rescues an earlier non-qualifying one; the choice is deterministic by id',()=>{
  const r=evaluateEligibility(base({evidence:[item({id:'z',documentDate:dayDate(2025,6,1)}),item({id:'a',documentDate:dayDate(2026,2,1)}),item({id:'m',documentDate:dayDate(2025,7,1)})]}));
  expect(r.outcome).toBe('Submitted');expect(r.snapshot.anchor?.evidenceItemId).toBe('m');
 });
 it('AT-HIST-10(3): month/year events that reach the cutoff make the draft NotEligible; unknown event dates fail closed',()=>{
  expect(codes(base({events:[ev('c1',monthDate(2025,12))]}))).toEqual([]);
  expect(codes(base({events:[ev('c1',monthDate(2026,1))]}))).toEqual(['EVENT_NOT_BEFORE_CUTOFF']);
  expect(codes(base({events:[ev('c1',yearDate(2026))]}))).toEqual(['EVENT_NOT_BEFORE_CUTOFF']);
  expect(codes(base({events:[ev('c1',yearDate(2025))]}))).toEqual([]);
  expect(evaluateEligibility(base({events:[ev('c1',UNKNOWN_DATE)]})).reasons).toEqual([{code:'EVENT_DATE_UNKNOWN',ref:'c1'}]);
  expect(codes(base({events:[ev('c1'),ev('c2',dayDate(2026,1,1))]}))).toEqual(['EVENT_NOT_BEFORE_CUTOFF']);
 });
 it('AT-HIST-10(4): adding an Anchor later makes the same draft eligible',()=>{
  expect(evaluateEligibility(base({evidence:[]})).outcome).toBe('NotEligible');
  expect(evaluateEligibility(base({evidence:[item({id:'late'})]})).outcome).toBe('Submitted');
 });
 it('no cutoff configured ⇒ NotEligible (never assumed), but activity is still reported',()=>{
  const r=evaluateEligibility(base({cutoff:null,activity:{...NO_ACTIVITY,petApplied:true}}));
  expect(r.outcome).toBe('NotEligible');expect(r.reasons.map(x=>x.code)).toEqual(['CUTOFF_NOT_CONFIGURED','NIPT_ACTIVITY_PET_APPLIED']);expect(r.snapshot.cutoff).toBeNull();
 });
 it('AT-HIST-06: any NIPT activity or registered LN makes the LN ineligible',()=>{
  expect(codes(base({activity:{...NO_ACTIVITY,caseLnExists:true}}))).toEqual(['LN_ALREADY_REGISTERED']);
  expect(codes(base({activity:{...NO_ACTIVITY,petApplied:true}}))).toEqual(['NIPT_ACTIVITY_PET_APPLIED']);
  expect(codes(base({activity:{...NO_ACTIVITY,receivedInNipt:true}}))).toEqual(['NIPT_ACTIVITY_RECEIVED']);
  expect(codes(base({activity:{...NO_ACTIVITY,inBatch:true}}))).toEqual(['NIPT_ACTIVITY_BATCH']);
  expect(codes(base({activity:{...NO_ACTIVITY,released:true}}))).toEqual(['NIPT_ACTIVITY_RELEASED']);
 });
 it('AT-HIST-06: an unlinked intake received in HIS on/after the cutoff (Bangkok day) means a current case',()=>{
  expect(codes(base({activity:{...NO_ACTIVITY,unlinkedIntakeHisReceivedAt:['2025-12-31T17:00:00Z']}}))).toEqual(['UNLINKED_INTAKE_AFTER_CUTOFF']);
  expect(codes(base({activity:{...NO_ACTIVITY,unlinkedIntakeHisReceivedAt:['2025-12-31T16:59:59Z']}}))).toEqual([]);
 });
 it('AT-HIST-15 golden: snapshot and hash are stable, order-independent and bound to the cutoff version used',()=>{
  const a=evaluateEligibility(base({events:[ev('c1'),ev('c2',monthDate(2025,11),'RECEIPT')]}));
  const b=evaluateEligibility(base({events:[ev('c2',monthDate(2025,11),'RECEIPT'),ev('c1')],evidence:[item({id:'e1'})]}));
  expect(a.hash).toBe(b.hash);
  expect(a.hash).toBe(hashOf(a.snapshot));
  expect(a.hash).toMatch(/^[a-f0-9]{64}$/);
  const v2:CutoffVersion={...CUT,version:2,cutoff:'2025-12-15',effectiveFrom:'2025-12-10'};
  const under2=evaluateEligibility(base({cutoff:v2,events:[ev('c1'),ev('c2',monthDate(2025,11),'RECEIPT')]}));
  expect(under2.hash).not.toBe(a.hash);
  expect(under2.snapshot.cutoff?.version).toBe(2);
  expect(a.snapshot.cutoff?.version).toBe(1);   // the earlier evaluation is a stored value; a new version never rewrites it
 });
 it('the evaluation policy must name accepted Anchor kinds explicitly and can never accept Request/Consent',()=>{
  expect(()=>assertPolicy({acceptedAnchorKinds:[]})).toThrow('ANCHOR_POLICY_REQUIRED');
  expect(()=>assertPolicy({acceptedAnchorKinds:['CONSENT_PAPER']})).toThrow('ANCHOR_KIND_NOT_PERMITTED');
  expect(()=>assertPolicy({acceptedAnchorKinds:['REQUEST_PAPER']})).toThrow('ANCHOR_KIND_NOT_PERMITTED');
  expect(()=>assertPolicy({acceptedAnchorKinds:['LEGACY_DB_RECORD']})).toThrow('ANCHOR_KIND_NOT_PERMITTED');
  expect(()=>evaluateEligibility(base({policy:{acceptedAnchorKinds:[]}}))).toThrow('ANCHOR_POLICY_REQUIRED');
  expect(assertPolicy({acceptedAnchorKinds:['FINAL_RESULT_REPORT','LAB_CONTROL_RECORD']}).acceptedAnchorKinds).toHaveLength(2);
 });
 it('property: eligibility equals "anchor day < cutoff and every event latest-possible < cutoff"',()=>{
  const dateArb=fc.oneof(
   fc.tuple(fc.integer({min:2024,max:2027}),fc.integer({min:1,max:12}),fc.integer({min:1,max:28})).map(([y,m,d])=>dayDate(y,m,d)),
   fc.tuple(fc.integer({min:2024,max:2027}),fc.integer({min:1,max:12})).map(([y,m])=>monthDate(y,m)),
   fc.integer({min:2024,max:2027}).map(yearDate),fc.constant(UNKNOWN_DATE));
  fc.assert(fc.property(dateArb,fc.array(dateArb,{maxLength:4}),(anchorDate,eventDates)=>{
   const r=evaluateEligibility(base({evidence:[item({id:'e1',documentDate:anchorDate})],events:eventDates.map((d,i)=>ev(`x${i}`,d))}));
   const expected=anchorDate.precision==='DAY'&&latestPossibleIsBefore(anchorDate,CUT.cutoff)&&eventDates.every(d=>latestPossibleIsBefore(d,CUT.cutoff));
   return (r.outcome==='Submitted')===expected&&(r.reasons.length===0)===expected;
  }),{numRuns:300});
 });
 it('canonical JSON refuses undefined so a missing value cannot hash like null',()=>{
  expect(canonicalJson({b:1,a:[2,{d:null,c:'x'}]})).toBe('{"a":[2,{"c":"x","d":null}],"b":1}');
  expect(()=>canonicalJson({a:undefined})).toThrow('CANONICAL_UNDEFINED');
  expect(()=>canonicalJson(Number.NaN)).toThrow('CANONICAL_NON_FINITE');
 });
 it('evidence items are strict: no signature, certifier or release field can be stored (AT-HIST-01/07)',()=>{
  const ok=item({id:'e1'});
  expect(evidenceItemSchema.safeParse(ok).success).toBe(true);
  for(const extra of [{signature:'x'},{signatureAsset:'x'},{certifiedByUserId:'u'},{releasedAt:'2025-01-01'},{consentSnapshotId:'s'},{hisExportId:'h'}])expect(evidenceItemSchema.safeParse({...ok,...extra}).success).toBe(false);
  expect(evidenceItemSchema.safeParse({...ok,documentDate:{precision:'DAY',value:'2025-02-30'}}).success).toBe(false);
  expect(evidenceItemSchema.safeParse({...ok,fileSha256:'xyz'}).success).toBe(false);
 });
});
