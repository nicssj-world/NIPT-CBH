import {describe,it,expect} from 'vitest';
import {mapLegacyOrder,type LegacyOrder,type LegacyResult,type LegacyExport} from '../../packages/historical/legacy-map';
import {evaluateEligibility,NO_ACTIVITY} from '../../packages/historical/eligibility';
import {evidenceCompleteness,displayValue,notInEvidence,present,presentOrAbsent,pastCertificationSchema,historicalResultImportSchema,NOT_IN_EVIDENCE_TEXT,RESULT_VALUE_KEYS,type HistoricalFacts} from '../../packages/historical/evidence';
import {evidenceItemSchema} from '../../packages/historical/types';
import type {CutoffVersion} from '../../packages/historical/types';

// All rows are SYNTHETIC; shapes follow NIPTY database.py DDL (nipt_orders / nipt_results / nipt_exports).
const CUT:CutoffVersion={version:1,cutoff:'2026-01-01',effectiveFrom:'2025-12-01',impactReportHash:'a'.repeat(64)};
const order=(o:Partial<LegacyOrder>={}):LegacyOrder=>({id:7,ln:'2500100001',hn:'SYN-HN-7',dspname:'Synthetic Patient G',namePrefix:'',nameFirst:'',nameLast:'',dob:'1992-02-02',requestDate:'2025-11-03',specimenDate:'2025-11-04',confirmDate:'',deletedAt:null,source:'pet',...o});
const result=(o:Partial<LegacyResult>={}):LegacyResult=>({id:70,orderId:7,hn:'SYN-HN-7',labLn:'',patientName:'',dob:'',collectionDate:'04-Nov-2025',receivedDate:'05-Nov-2025',reportedDate:'25-Dec-2025',t21:'Not Detected',t18:'Not Detected',t13:'Not Detected',sexXo:'',sexXxx:'',sexXxy:'',sexXyy:'',fetalGender:'',fetalFraction:'',qcStatus:'',resultType:'final',fileHash:'',pdfSha256Verified:'c'.repeat(64),...o});
const exp=(o:Partial<LegacyExport>={}):LegacyExport=>({id:900,orderId:7,resultId:70,exportedAt:'2025-12-26 09:00:00',exportAttempt:1,resOk:true,pdfOk:true,...o});
const seedOf=(r:ReturnType<typeof mapLegacyOrder>)=>{if(r.kind!=='SEED')throw new Error('expected seed');return r.seed;};
const POLICY={acceptedAnchorKinds:['FINAL_RESULT_REPORT'] as const};
const elig=(s:ReturnType<typeof seedOf>)=>evaluateEligibility({evidence:s.evidence,events:s.events,cutoff:CUT,activity:NO_ACTIVITY,policy:POLICY});

describe('P5H legacy NIPTY row mapping (source/schema mapping, no release or export is ever derived)',()=>{
 it('maps an order with a verified final PDF into evidence, dated events and an eligible seed',()=>{
  const s=seedOf(mapLegacyOrder(order(),[result()],[]));
  expect(s.ln).toBe('2500100001');
  expect(s.identifiers).toEqual({hn:'SYN-HN-7',name:'Synthetic Patient G',dob:'1992-02-02'});
  expect(s.evidence.map(e=>[e.id,e.kind,e.provenance])).toEqual([['legacy-order-7','LEGACY_DB_RECORD','LEGACY_NIPTY_DB_FIELD'],['legacy-result-70','FINAL_RESULT_REPORT','LEGACY_NIPTY_FILE']]);
  expect(s.events.map(e=>[e.type,e.date.precision==='DAY'?e.date.value:null])).toEqual([['ORDER_REQUEST','2025-11-03'],['COLLECTION','2025-11-04'],['COLLECTION','2025-11-04'],['RECEIPT','2025-11-05'],['REPORT','2025-12-25']]);
  expect(s.evidence.every(e=>evidenceItemSchema.safeParse(e).success)).toBe(true);
  expect(elig(s).outcome).toBe('Submitted');
 });
 it('uses name parts when present, else the legacy display name; dob falls back to the result row',()=>{
  expect(seedOf(mapLegacyOrder(order({namePrefix:'Ms.',nameFirst:'Syn',nameLast:'Thetic'}),[],[])).identifiers.name).toBe('Ms. Syn Thetic');
  expect(seedOf(mapLegacyOrder(order({dob:''}),[result({dob:'02-Feb-1992'})],[])).identifiers.dob).toBe('1992-02-02');
  expect(seedOf(mapLegacyOrder(order({dob:''}),[],[])).identifiers.dob).toBeNull();
 });
 it('a final result without its verified PDF cannot be an Anchor (AT-HIST-01: PDF kept with hash)',()=>{
  const r=mapLegacyOrder(order(),[result({pdfSha256Verified:null})],[]);
  const s=seedOf(r);
  expect(s.evidence.find(e=>e.id==='legacy-result-70')).toMatchObject({kind:'LEGACY_DB_RECORD',fileSha256:null});
  expect(s.notes).toContainEqual({code:'PDF_NOT_AVAILABLE_NO_ANCHOR',ref:'70'});
  expect(elig(s).reasons.map(x=>x.code)).toEqual(['NO_ANCHOR']);
  expect(seedOf(mapLegacyOrder(order(),[result({pdfSha256Verified:'not-a-hash'})],[])).evidence[1].kind).toBe('LEGACY_DB_RECORD');
 });
 it('a recomputed PDF hash that differs from the legacy file_hash is flagged, not silently trusted',()=>{
  expect(seedOf(mapLegacyOrder(order(),[result({fileHash:'d'.repeat(64)})],[])).notes).toContainEqual({code:'LEGACY_FILE_HASH_MISMATCH',ref:'70'});
  expect(seedOf(mapLegacyOrder(order(),[result({fileHash:'C'.repeat(64)})],[])).notes.some(n=>n.code==='LEGACY_FILE_HASH_MISMATCH')).toBe(false);
 });
 it('a redraw notice is evidence but never a final result or Anchor, and has no result values',()=>{
  const s=seedOf(mapLegacyOrder(order(),[result({id:71,resultType:'redraw_notice',reportedDate:'10-Nov-2025',t21:''})],[]));
  expect(s.evidence[1].kind).toBe('REDRAW_NOTICE');
  expect(s.events.find(e=>e.id==='result-71-report')?.type).toBe('OTHER');
  expect(s.reportVersions).toEqual([]);expect(s.resultValues).toEqual({});
  expect(elig(s).reasons.map(x=>x.code)).toEqual(['NO_ANCHOR']);
 });
 it('multiple final results are all kept as report versions and none is picked as current',()=>{
  const s=seedOf(mapLegacyOrder(order(),[result({id:70}),result({id:72,reportedDate:'28-Dec-2025'}),result({id:71,resultType:'redraw_notice'})],[]));
  expect(s.reportVersions.map(v=>[v.evidenceItemId,v.ordinal])).toEqual([['legacy-result-70',1],['legacy-result-72',2]]);
  expect(s.currentVersion).toBeNull();
  expect(s.notes).toContainEqual({code:'MULTIPLE_FINAL_RESULTS_REQUIRE_REVIEW'});
 });
 it('unreadable legacy result cells stay NOT_IN_EVIDENCE — never Normal (v1.3.1 silent-blank lesson)',()=>{
  const s=seedOf(mapLegacyOrder(order(),[result({t18:'',sexXo:'  '})],[]));
  const v=s.resultValues['legacy-result-70'];
  expect(v.t21).toEqual({state:'PRESENT',value:'Not Detected',evidenceItemId:'legacy-result-70'});
  expect(v.t18).toEqual({state:'NOT_IN_EVIDENCE'});expect(v.sexXo).toEqual({state:'NOT_IN_EVIDENCE'});expect(v.fetalFraction).toEqual({state:'NOT_IN_EVIDENCE'});
  expect(Object.keys(v)).toEqual([...RESULT_VALUE_KEYS]);
  expect(displayValue(v.t18)).toBe(NOT_IN_EVIDENCE_TEXT);
 });
 it('an unreadable or Buddhist-era date fails closed (the legacy 45-day matcher failed open)',()=>{
  const s=seedOf(mapLegacyOrder(order({specimenDate:'garbage'}),[result({receivedDate:'05-Nov-2568'})],[]));
  expect(s.notes).toContainEqual({code:'LEGACY_DATE_UNPARSEABLE',ref:'nipt_orders.specimen_date'});
  expect(s.notes).toContainEqual({code:'LEGACY_DATE_AMBIGUOUS_YEAR_ERA',ref:'nipt_results.received_date'});
  expect(elig(s).reasons.map(x=>x.code)).toEqual(['EVENT_DATE_UNKNOWN','EVENT_DATE_UNKNOWN']);
  expect(elig(s).outcome).toBe('NotEligible');
  // An empty source cell invents no event at all.
  expect(seedOf(mapLegacyOrder(order({specimenDate:''}),[],[])).events.map(e=>e.type)).toEqual(['ORDER_REQUEST']);
 });
 it('differing collection dates from order and PDF are both kept and flagged; the later one governs eligibility',()=>{
  const s=seedOf(mapLegacyOrder(order({specimenDate:'2025-11-04'}),[result({collectionDate:'02-Jan-2026'})],[]));
  expect(s.notes).toContainEqual({code:'LEGACY_DATE_DISAGREEMENT',ref:'COLLECTION'});
  expect(elig(s).reasons).toContainEqual({code:'EVENT_NOT_BEFORE_CUTOFF',ref:'result-70-collection'});
 });
 it('legacy export history is informational evidence only — no release, export or HIS field is produced',()=>{
  const s=seedOf(mapLegacyOrder(order(),[result()],[exp(),exp({id:901,exportAttempt:2,exportedAt:'2025-12-27 10:00:00'}),exp({id:5,orderId:99})]));
  const logs=s.evidence.filter(e=>e.kind==='LEGACY_EXPORT_LOG');
  expect(logs.map(e=>e.id)).toEqual(['legacy-export-900','legacy-export-901']);
  expect(s.notes.filter(n=>n.code==='LEGACY_EXPORT_NOT_A_RELEASE')).toHaveLength(2);
  const json=JSON.stringify(s);
  for(const forbidden of ['"release"','his_export','hisExport','releasedAt','certifiedBy','signature','report_version','his_order'])expect(json).not.toContain(forbidden);
  expect(elig(s).outcome).toBe('Submitted');   // an export log never counts as an Anchor
  expect(elig(seedOf(mapLegacyOrder(order(),[],[exp()]))).reasons.map(x=>x.code)).toEqual(['NO_ANCHOR']);
 });
 it('a soft-deleted legacy order is reported as skipped, not silently dropped or imported',()=>{
  expect(mapLegacyOrder(order({deletedAt:'2025-12-01 10:00:00'}),[result()],[])).toEqual({kind:'SKIPPED',reason:{code:'LEGACY_SOFT_DELETED_ORDER',ref:'7'}});
 });
 it('LN keeps leading zeros and rejects non-numeric values',()=>{
  expect(seedOf(mapLegacyOrder(order({ln:' 0012345 '}),[],[])).ln).toBe('0012345');
  expect(()=>mapLegacyOrder(order({ln:'12-3'}),[],[])).toThrow();
 });
});

describe('P5H evidence values, completeness and past certification (AT-HIST-01/03/07, OD-23)',()=>{
 const full:HistoricalFacts={
  hn:present('SYN-HN-7','e1'),name:present('Synthetic Patient G','e1'),dob:present('1992-02-02','e1'),originalLocation:present('SYNTHETIC-CABINET-1','e1'),
  collectionDate:present('2025-11-04','e1'),reportDate:present('2025-12-25','e2'),requestPaperPresent:present(true,'e3'),consentPaperPresent:present(true,'e4'),
  consentDecisionAsWritten:present('ยินยอม (ตามที่เขียน)','e4'),pregnancyType:present('Singleton','e3'),resultPdf:notInEvidence(),
 };
 it('absent values are NOT_IN_EVIDENCE, blank text is absent, and false/0 are real values',()=>{
  expect(presentOrAbsent('  ','e')).toEqual({state:'NOT_IN_EVIDENCE'});expect(presentOrAbsent(null,'e')).toEqual({state:'NOT_IN_EVIDENCE'});expect(presentOrAbsent(undefined,'e')).toEqual({state:'NOT_IN_EVIDENCE'});
  expect(displayValue(present(false,'e'))).toBe('false');expect(displayValue(present(0,'e'))).toBe('0');expect(displayValue(notInEvidence())).toBe('ไม่ปรากฏในหลักฐาน');
 });
 it('completeness lists the missing items; the optional result PDF does not make OD-18(b) partial',()=>{
  expect(evidenceCompleteness(full,'OD18_B_BALANCED')).toEqual({status:'COMPLETE',missing:[]});
  const partial={...full,consentDecisionAsWritten:notInEvidence<string>(),pregnancyType:notInEvidence<string>()};
  expect(evidenceCompleteness(partial,'OD18_B_BALANCED')).toEqual({status:'PARTIAL',missing:['consentDecisionAsWritten','pregnancyType']});
  expect(evidenceCompleteness(partial,'OD18_A_IDENTITY_AND_ORIGINAL').status).toBe('COMPLETE');
  expect(evidenceCompleteness({...full,originalLocation:notInEvidence<string>()},'OD18_A_IDENTITY_AND_ORIGINAL').missing).toEqual(['originalLocation']);
  expect(()=>evidenceCompleteness(full,'OD18_C_FULL' as never)).toThrow();   // option (c) is undefined in the plan and deliberately unsupported
 });
 it('past certification is text as written; no user, role, time or signature can be attached',()=>{
  expect(pastCertificationSchema.safeParse({state:'AS_WRITTEN',text:'ลงชื่อตามต้นฉบับ',evidenceItemId:'e2'}).success).toBe(true);
  expect(pastCertificationSchema.safeParse({state:'NOT_IN_EVIDENCE'}).success).toBe(true);
  for(const extra of [{certifiedByUserId:'u1'},{role:'LAB_CERTIFIER'},{certifiedAt:'2026-01-02T00:00:00Z'},{signature:'x'}])
   expect(pastCertificationSchema.safeParse({state:'AS_WRITTEN',text:'x',evidenceItemId:'e',...extra}).success).toBe(false);
  expect(pastCertificationSchema.safeParse({state:'AS_WRITTEN',text:'',evidenceItemId:'e'}).success).toBe(false);
 });
 it('a historical result import has no release, export or HIS field and requires the PDF hash',()=>{
  const values=Object.fromEntries(RESULT_VALUE_KEYS.map(k=>[k,{state:'NOT_IN_EVIDENCE'}]));
  const ok={pdfEvidenceItemId:'e2',pdfSha256:'c'.repeat(64),values,pastCertification:{state:'NOT_IN_EVIDENCE'}};
  expect(historicalResultImportSchema.safeParse(ok).success).toBe(true);
  for(const extra of [{releaseId:'r'},{hisExportId:'h'},{reportVersionId:'v'},{epoch:1},{certifiedBy:'u'}])expect(historicalResultImportSchema.safeParse({...ok,...extra}).success).toBe(false);
  expect(historicalResultImportSchema.safeParse({...ok,pdfSha256:'abc'}).success).toBe(false);
  expect(historicalResultImportSchema.safeParse({...ok,values:{...values,t21:{state:'PRESENT',value:'',evidenceItemId:'e'}}}).success).toBe(false);
  expect(historicalResultImportSchema.safeParse({...ok,values:{...values,t21:undefined}}).success).toBe(false);
 });
});
