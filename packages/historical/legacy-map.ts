import {normalizeLn} from '../domain';
import {parseLegacyDate} from './dates';
import {presentOrAbsent,RESULT_VALUE_KEYS,type EvidenceValue} from './evidence';
import type {EvidenceItem,HistoricalEvent,Reason} from './types';
import type {Identifiers} from './precheck';

/**
 * Pure mapping of legacy NIPTY database rows to a Historical Draft seed (docs/p5h-historical-backfill-foundation.md §2).
 * Row shapes mirror NIPTY `nipt_orders`, `nipt_results`, `nipt_exports` (database.py DDL, read from NIPTY_handover.zip source only).
 * Input is synthetic or supplied by an Owner-authorized, DPO-approved migration run (Q-G7) — this module reads no database, file or share.
 * It never emits a release, export, certification, signature or HIS field; legacy export rows become informational evidence only.
 */
export type LegacyOrder={id:number;ln:string;hn:string;dspname:string;namePrefix:string;nameFirst:string;nameLast:string;dob:string;requestDate:string;specimenDate:string;confirmDate:string;deletedAt:string|null;source:'stat'|'pet'|string};
export type LegacyResult={id:number;orderId:number|null;hn:string;labLn:string;patientName:string;dob:string;collectionDate:string;receivedDate:string;reportedDate:string;t21:string;t18:string;t13:string;sexXo:string;sexXxx:string;sexXxy:string;sexXyy:string;fetalGender:string;fetalFraction:string;qcStatus:string;resultType:string;fileHash:string;/** SHA-256 recomputed by the migration run from the actual PDF, or null when the file is unavailable. */pdfSha256Verified:string|null};
export type LegacyExport={id:number;orderId:number;resultId:number|null;exportedAt:string;exportAttempt:number;resOk:boolean;pdfOk:boolean};

export type LegacySeed={
 ln:string;identifiers:Identifiers;
 evidence:EvidenceItem[];events:HistoricalEvent[];
 resultValues:Record<string,Record<typeof RESULT_VALUE_KEYS[number],EvidenceValue<string>>>;
 /** Report versions in recorded order; `currentVersion` stays null — nothing is inferred (legacy has redraw notices and re-issues). */
 reportVersions:{evidenceItemId:string;ordinal:number;reportedDateRaw:string}[];currentVersion:null;
 notes:Reason[];
};
export type LegacyMapResult={kind:'SEED';seed:LegacySeed}|{kind:'SKIPPED';reason:Reason};

const SHA=/^[a-f0-9]{64}$/;
const fullName=(o:LegacyOrder)=>[o.namePrefix,o.nameFirst,o.nameLast].map(s=>s.trim()).filter(Boolean).join(' ')||o.dspname.trim();

export function mapLegacyOrder(order:LegacyOrder,results:readonly LegacyResult[],exports_:readonly LegacyExport[]):LegacyMapResult{
 const ln=normalizeLn(order.ln);
 if(order.deletedAt)return {kind:'SKIPPED',reason:{code:'LEGACY_SOFT_DELETED_ORDER',ref:String(order.id)}};
 const notes:Reason[]=[];
 const evidence:EvidenceItem[]=[];const events:HistoricalEvent[]=[];
 const orderItemId=`legacy-order-${order.id}`;
 const reqDate=parseLegacyDate(order.requestDate);
 evidence.push({id:orderItemId,kind:'LEGACY_DB_RECORD',originalLocation:null,documentDate:reqDate.date,appears:null,fileSha256:null,provenance:'LEGACY_NIPTY_DB_FIELD',sourceRef:'nipt_orders'});
 const addEvent=(id:string,type:HistoricalEvent['type'],raw:string,evidenceItemId:string,label:string)=>{
  const p=parseLegacyDate(raw);
  if(p.issue&&p.issue!=='EMPTY')notes.push({code:`LEGACY_DATE_${p.issue}`,ref:label});
  if(p.issue==='EMPTY')return;           // no value in the source ⇒ no event; nothing is invented
  events.push({id,type,date:p.date,evidenceItemId});
 };
 addEvent(`order-${order.id}-request`,'ORDER_REQUEST',order.requestDate,orderItemId,'nipt_orders.request_date');
 addEvent(`order-${order.id}-specimen`,'COLLECTION',order.specimenDate,orderItemId,'nipt_orders.specimen_date');

 const mine=results.filter(r=>r.orderId===order.id).sort((a,b)=>a.id-b.id);
 const resultValues:LegacySeed['resultValues']={};
 const reportVersions:LegacySeed['reportVersions']=[];
 let finals=0;
 for(const r of mine){
  const itemId=`legacy-result-${r.id}`;
  const isNotice=r.resultType==='redraw_notice';
  const verified=r.pdfSha256Verified&&SHA.test(r.pdfSha256Verified)?r.pdfSha256Verified:null;
  if(!isNotice&&!verified)notes.push({code:'PDF_NOT_AVAILABLE_NO_ANCHOR',ref:String(r.id)});
  const rep=parseLegacyDate(r.reportedDate);
  evidence.push({
   id:itemId,
   // A redraw notice is not a final result; a final result without its verified PDF cannot serve as an Anchor.
   kind:isNotice?'REDRAW_NOTICE':verified?'FINAL_RESULT_REPORT':'LEGACY_DB_RECORD',
   originalLocation:null,documentDate:rep.date,appears:null,fileSha256:verified,
   provenance:verified?'LEGACY_NIPTY_FILE':'LEGACY_NIPTY_DB_FIELD',sourceRef:'nipt_results',
  });
  if(r.fileHash&&verified&&r.fileHash.toLowerCase()!==verified)notes.push({code:'LEGACY_FILE_HASH_MISMATCH',ref:String(r.id)});
  addEvent(`result-${r.id}-collection`,'COLLECTION',r.collectionDate,itemId,'nipt_results.collection_date');
  addEvent(`result-${r.id}-receipt`,'RECEIPT',r.receivedDate,itemId,'nipt_results.received_date');
  addEvent(`result-${r.id}-report`,isNotice?'OTHER':'REPORT',r.reportedDate,itemId,'nipt_results.reported_date');
  if(!isNotice){
   finals++;
   reportVersions.push({evidenceItemId:itemId,ordinal:finals,reportedDateRaw:r.reportedDate});
   // '' in legacy means "unreadable/unknown", never normal (v1.3.1 lesson: 38 silent blanks).
   resultValues[itemId]=Object.fromEntries(RESULT_VALUE_KEYS.map(k=>[k,presentOrAbsent(r[k],itemId)])) as Record<typeof RESULT_VALUE_KEYS[number],EvidenceValue<string>>;
  }
 }
 if(finals>1)notes.push({code:'MULTIPLE_FINAL_RESULTS_REQUIRE_REVIEW'});
 // Different dates for the same event type from different sources are all kept; eligibility then uses every one of them.
 const colDates=new Set(events.filter(e=>e.type==='COLLECTION'&&e.date.precision==='DAY').map(e=>(e.date as {value:string}).value));
 if(colDates.size>1)notes.push({code:'LEGACY_DATE_DISAGREEMENT',ref:'COLLECTION'});

 for(const x of exports_.filter(e=>e.orderId===order.id).sort((a,b)=>a.id-b.id)){
  const p=parseLegacyDate(x.exportedAt);
  evidence.push({id:`legacy-export-${x.id}`,kind:'LEGACY_EXPORT_LOG',originalLocation:null,documentDate:p.date,appears:null,fileSha256:null,provenance:'LEGACY_NIPTY_DB_FIELD',sourceRef:'nipt_exports'});
  notes.push({code:'LEGACY_EXPORT_NOT_A_RELEASE',ref:String(x.id)});
 }

 const birth=parseLegacyDate(order.dob||mine.map(r=>r.dob).find(Boolean)||'');
 return {kind:'SEED',seed:{
  ln,
  identifiers:{hn:order.hn.trim()||null,name:fullName(order)||null,dob:birth.date.precision==='DAY'?birth.date.value:null},
  evidence,events,resultValues,reportVersions,currentVersion:null,notes,
 }};
}
