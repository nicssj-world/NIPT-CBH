import type {Queryable} from '../db/connection';
import {assertSession,need,attemptFacts,caseVisible,gestationalAge,migrationImportedExclusion,type AttemptRow,type Staff} from './core';
import {listUnifiedRunPage} from './historical-run';
import {bangkokDay,businessDaysBetween,median,tatStatus,type TatState} from '../calendar/business-days';
import {workingCalendar} from '../calendar/holiday-sync';
import {recordPhiAccess} from '../db/phi-access';
import {inOrder} from '../db/in-order';

/**
 * Lab overview for the home page (Owner 2026-11-11). Read-only; every number comes from records the Lab pages already own.
 * - TAT: specimens the Lab has received (specimen_round.received_at) whose current round has no active released result, counted in working days.
 * - GA over 18 weeks: the same open specimens whose gestational age at collection is over 18+0 (same arithmetic as the worklist).
 * - Runs: current Runs not yet released, with the furthest saved step (same flags as the Batch list).
 * - Quality: six Bangkok calendar months of receipts, results, % within TAT, QC failures by stage and repeats by kind.
 */
export const GA_OVER_DAYS=18*7;
const LIST_LIMIT=20;
const MONTHS=6;

export type LabStage='READY'|'IN_RUN'|'QC_FAILED'|'ANALYSIS_DONE'|'AWAITING_RESULT'|'HOLD'|'OTHER';
export type OpenSpecimen={caseId:string;ln:string;hn:string|null;receivedAt:string;stage:LabStage;runLabel:string|null};
export type TatRow=OpenSpecimen&{used:number;left:number;state:TatState;due:string};
export type GaRow=OpenSpecimen&{gaWeeks:number;gaDays:number};
export type RunRow={id:string;runLabel:string;state:string;samples:number;createdAt:string|null;qc_saved:boolean;pool_exported:boolean;pooling_recorded:boolean;seq_files_exported:boolean;seq_recorded:boolean};
export type QualityMonth={month:string;received:number;released:number;withinTat:number;medianDays:number|null;qcFailed:Record<string,number>;repeats:{RE_LIBRARY:number;RE_EXTRACTION:number;RE_SAMPLING:number}};
export type LabOverview={generatedAt:string;policy:{businessDays:number;warnDaysLeft:number};calendar:{missingYears:number[];lastSuccessAt:string|null};
 tat:{open:number;overdue:number;dueSoon:number;rows:TatRow[]};gaOver18:{count:number;rows:GaRow[]};runs:{total:number;rows:RunRow[]};quality:QualityMonth[]};

export function labStage(r:Pick<AttemptRow,'attempt_state'|'hold'|'run_label'>):LabStage{
 if(r.hold)return 'HOLD';
 switch(r.attempt_state){
  case 'Ready':return 'READY';
  case 'Assigned':case 'InProgress':return 'IN_RUN';
  case 'QcFailed':return 'QC_FAILED';
  case 'AnalysisComplete':case 'FinalQcAccepted':return 'ANALYSIS_DONE';
  case 'Final':return 'AWAITING_RESULT';
  default:return 'OTHER';
 }
}

/** Open specimens: the newest live attempt of each current, received round that has no active released result. EQA, historical and removed cases are out. */
async function openSpecimens(db:Queryable,user:Staff){
 const where=`c.current_round_id=a.round_id AND r.received_at IS NOT NULL AND a.state NOT IN ('Cancelled','Superseded','Stopped','BatchCancelled')
  AND c.registration_origin<>'HISTORICAL' AND NOT EXISTS(SELECT 1 FROM eqa_case eq WHERE eq.round_id=a.round_id)
  AND NOT EXISTS(SELECT 1 FROM result_release rr WHERE rr.round_id=a.round_id AND rr.kind='RESULT' AND rr.state='Active')
  AND NOT EXISTS(SELECT 1 FROM historical_reported_result hr WHERE hr.round_id=a.round_id)
  AND NOT EXISTS(SELECT 1 FROM p2_registration_void v WHERE v.case_id=c.id)`+await migrationImportedExclusion(db);
 const newest=new Map<string,AttemptRow>();
 for(const r of await attemptFacts(db,where,[])){
  if(!caseVisible(user,r))continue;
  const seen=newest.get(r.round_id);
  if(!seen||r.attempt_number>seen.attempt_number)newest.set(r.round_id,r);
 }
 return [...newest.values()];
}
const specimen=(r:AttemptRow):OpenSpecimen=>({caseId:r.case_id,ln:r.ln,hn:r.hn??null,receivedAt:new Date(r.received_at!).toISOString(),stage:labStage(r),runLabel:r.run_label??null});

const monthKey=(d:Date|string)=>bangkokDay(d).slice(0,7);
export function lastMonths(now:Date,n=MONTHS){const [y,m]=bangkokDay(now).split('-').map(Number);return Array.from({length:n},(_,i)=>{const t=new Date(Date.UTC(y,m-1-(n-1-i),1));return t.toISOString().slice(0,7);});}

async function quality(db:Queryable,now:Date,holidays:ReadonlySet<string>,businessDays:number):Promise<QualityMonth[]>{
 const months=lastMonths(now),from=months[0]+'-01';
 const since=`(($1::date)::timestamp AT TIME ZONE 'Asia/Bangkok')`;
 const scope=`NOT EXISTS(SELECT 1 FROM eqa_case eq WHERE eq.round_id=r.id) AND c.registration_origin<>'HISTORICAL' AND NOT EXISTS(SELECT 1 FROM p2_registration_void v WHERE v.case_id=c.id)`;
 const [received,released,qc,repeats,resampling]=await inOrder(
  ()=>db.query<{at:Date}>(`SELECT r.received_at at FROM specimen_round r JOIN nipt_case c ON c.id=r.case_id WHERE r.received_at>=${since} AND r.state<>'Cancelled' AND ${scope}`,[from]),
  ()=>db.query<{at:Date;received:Date}>(`SELECT rr.certified_at at,r.received_at received FROM result_release rr JOIN specimen_round r ON r.id=rr.round_id JOIN nipt_case c ON c.id=rr.case_id
   WHERE rr.kind='RESULT' AND rr.state='Active' AND rr.certified_at>=${since} AND r.received_at IS NOT NULL AND ${scope}`,[from]),
  ()=>db.query<{at:Date;stage:string|null}>(`SELECT e.created_at at,COALESCE(e.stage,a.qc_failed_stage) stage FROM attempt_event e JOIN analytical_attempt a ON a.id=e.attempt_id
   WHERE e.event_type='STATE_CHANGED' AND e.to_state='QcFailed' AND e.created_at>=${since}`,[from]),
  ()=>db.query<{at:Date;level:string|null}>(`SELECT w.requested_at at,w.level FROM repeat_work_order w WHERE w.state<>'Cancelled' AND w.requested_at>=${since}`,[from]),
  ()=>db.query<{at:Date}>(`SELECT e.created_at at FROM attempt_event e WHERE e.to_state='Stopped' AND e.details->>'redrawRequestId' IS NOT NULL AND e.created_at>=${since}`,[from]),
 );
 const out=new Map(months.map(m=>[m,{month:m,received:0,released:0,withinTat:0,medianDays:null as number|null,qcFailed:{} as Record<string,number>,repeats:{RE_LIBRARY:0,RE_EXTRACTION:0,RE_SAMPLING:0}}]));
 const days=new Map<string,number[]>();
 for(const r of received.rows){const m=out.get(monthKey(r.at));if(m)m.received++;}
 for(const r of released.rows){const m=out.get(monthKey(r.at));if(!m)continue;const used=businessDaysBetween(r.received,r.at,holidays);m.released++;if(used<=businessDays)m.withinTat++;days.set(m.month,[...(days.get(m.month)??[]),used]);}
 for(const r of qc.rows){const m=out.get(monthKey(r.at));if(!m)continue;const s=r.stage??'อื่น ๆ';m.qcFailed[s]=(m.qcFailed[s]??0)+1;}
 for(const r of repeats.rows){const m=out.get(monthKey(r.at));if(m&&(r.level==='RE_LIBRARY'||r.level==='RE_EXTRACTION'))m.repeats[r.level]++;}
 for(const r of resampling.rows){const m=out.get(monthKey(r.at));if(m)m.repeats.RE_SAMPLING++;}
 for(const m of out.values())m.medianDays=median(days.get(m.month)??[]);
 return [...out.values()];
}

export async function labOverview(db:Queryable,user:Staff,now=new Date()):Promise<LabOverview>{
 await assertSession(db,user);need(user,'worksheet.read','read');
 const cal=await workingCalendar(db,now);
 const open=await openSpecimens(db,user);
 const tatAll=open.map(r=>({...specimen(r),...tatStatus(r.received_at!,now,cal.holidays,cal.policy)}));
 const late=tatAll.filter(r=>r.state!=='ok').sort((a,b)=>a.left-b.left||a.receivedAt.localeCompare(b.receivedAt));
 const gaAll=open.flatMap(r=>{const ga=gestationalAge(r);return ga&&ga.days>GA_OVER_DAYS?[{...specimen(r),gaWeeks:ga.weeks,gaDays:ga.remainder}]:[];}).sort((a,b)=>(b.gaWeeks*7+b.gaDays)-(a.gaWeeks*7+a.gaDays));
 const runs=(await listUnifiedRunPage(db,user,{pageSize:50})).rows.filter(r=>r.source==='CURRENT'&&r.id)
  .map(r=>({id:r.id!,runLabel:r.run_label,state:r.state,samples:r.samples,createdAt:r.created_at?new Date(r.created_at).toISOString():null,qc_saved:r.qc_saved,pool_exported:r.pool_exported,pooling_recorded:r.pooling_recorded,seq_files_exported:r.seq_files_exported,seq_recorded:r.seq_recorded}));
 const tatRows=late.slice(0,LIST_LIMIT),gaRows=gaAll.slice(0,LIST_LIMIT);
 // The rows show LN and HN: the same PHI-access record as the Lab worklist (identifiers only, never patient data in the audit).
 const shown=[...tatRows,...gaRows].map(r=>r.caseId);
 if(shown.length)await recordPhiAccess(db,user.id,shown,'REGISTRY_VIEW');
 return {generatedAt:now.toISOString(),policy:cal.policy,calendar:{missingYears:cal.missingYears,lastSuccessAt:cal.sync.lastSuccessAt},
  tat:{open:tatAll.length,overdue:late.filter(r=>r.state==='overdue').length,dueSoon:late.filter(r=>r.state==='due-soon').length,rows:tatRows},
  gaOver18:{count:gaAll.length,rows:gaRows},
  runs:{total:runs.length,rows:runs.sort((a,b)=>Number(a.seq_recorded)-Number(b.seq_recorded)).slice(0,12)},
  quality:await quality(db,now,cal.holidays,cal.policy.businessDays)};
}
