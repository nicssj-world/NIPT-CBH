import {z} from 'zod';
import type {Queryable} from '../db/connection';
import type {Staff} from '../lab/core';
import {gestationalAge} from '../lab/core';
import {riskSql,reportedDaySql,trisomyHighSql,scaHighSql,type Risk} from '../results/query';
import {addDays,bangkokDay,businessDaysBetween,median,percentile,tatStatus,type TatPolicy} from '../calendar/business-days';
import {workingCalendar} from '../calendar/holiday-sync';
import {ancUnitScope,factsSql} from './service';
import {fiscalYear} from './model';
import {inOrder} from '../db/in-order';
import {patientDisplayName} from '../domain/patient-name';
import {currentPetPatientJoin} from './current-patient';
import {ageOnDate} from '../p2/schema';

/**
 * ANC overview panel (Owner 2026-11-11), read-only and in the same unit scope as the ANC queue:
 * - High Risk (Owner 2026-11-12): a count of the High Risk results of the LATEST Run (the newest Run that has a certified result of the nurse units). Display only; no "informed" tick;
 * - GA over 18 weeks: a count of the cases not yet resulted whose GA at blood collection is over 18+0;
 * - both counts are cards that filter the ANC queue to exactly those cases (`ancFocusIds`);
 * - monthly statistics of the fiscal year: sent, resulted, redraws, High Risk results and median working days to the result.
 * Risk words describe the parsed report (results/query.ts riskSql), never a new clinical interpretation.
 */
/** `view=dashboard` (Owner 2026-11-14): the Dashboard shows counts only, so the card popups' names are not sent. */
export const insightsInput=z.strictObject({fy:z.coerce.number().int().min(2543).max(2743).optional(),unitId:z.uuid().optional(),view:z.enum(['dashboard']).optional()});

/** A case listed in a card popup: names are shown only to a user who may already see them in the queue (same unit scope). */
export type CardCase={caseId:string;ln:string;hn:string|null;name:string;releasedAt:string|null};
export type GaCase=CardCase&{gaWeeks:number;gaDays:number;collectionDate:string;received:boolean};
const nameOf=(n:string|null)=>patientDisplayName(n?.trim()||'ยังไม่มีข้อมูลชื่อ-นามสกุล');
/** `highTrisomy` / `highSca`: High Risk for chromosomes 13/18/21 and for the sex chromosomes (Owner 2026-11-14); a result with both counts in each, once in `high`. */
export type AncMonth={month:string;sent:number;released:number;redraw:number;high:number;highTrisomy:number;highSca:number;low:number;unknown:number;medianDays:number|null};
/** Fiscal-year statistics for the ANC statistics tab (same unit scope as the queue). `weekday[0]` = Monday. A case with several units counts in each. */
export type AncStats={totals:{sent:number;released:number;high:number;highTrisomy:number;highSca:number;redraw:number;medianDays:number|null;p90Days:number|null};weekday:number[];age:AncAge;units:{unitId:string;name:string;sent:number;released:number;high:number}[]};
/**
 * Maternal age (Owner 2026-11-14) of the cases sent in the fiscal year (first blood sample received), in whole years at the first blood draw
 * (round 1 collection date, else the receipt day). Birth date as the patient display shows it: the identity-matched HIS PET, else (no PET or a PET without one) the ANC request.
 * `high` = cases of the group whose current result is High Risk (riskSql). Groups follow the usual maternal-age bands; 35+ = advanced maternal age.
 */
export type AncAge={groups:{label:string;sent:number;high:number}[];known:number;unknown:number;unknownHigh:number;median:number|null;over35:number};
export const AGE_BANDS=[{label:'ต่ำกว่า 20 ปี',max:19},{label:'20–24 ปี',max:24},{label:'25–29 ปี',max:29},{label:'30–34 ปี',max:34},{label:'35–39 ปี',max:39},{label:'40 ปีขึ้นไป',max:Infinity}] as const;
export function ageGroups(ages:{age:number|null;high:boolean}[]):AncAge{
 const groups=AGE_BANDS.map(b=>({label:b.label,sent:0,high:0})),known:number[]=[];let unknown=0,unknownHigh=0;
 for(const a of ages){if(a.age===null||a.age<10||a.age>65){unknown++;if(a.high)unknownHigh++;continue;}known.push(a.age);const g=groups[AGE_BANDS.findIndex(b=>a.age!<=b.max)];g.sent++;if(a.high)g.high++;}
 return {groups,known:known.length,unknown,unknownHigh,median:median(known),over35:known.filter(a=>a>=35).length};
}
/**
 * Dashboard (Owner 2026-11-14), current work only:
 * - `tat`: cases sent and received by the Lab that have no result yet, in working days since the Lab received the current round, against the
 *   Lab TAT policy and holiday calendar (the same tatStatus as the Lab overview). `aging[i]` = cases that have used i working days (last = that many or more).
 * - `recent`: the last 14 Bangkok days, cases sent (first blood sample received) and results released per day (same rows as the monthly figures).
 */
export type AncTat={policy:TatPolicy;open:number;overdue:number;dueSoon:number;aging:{days:number;ok:number;dueSoon:number;overdue:number}[]};
export type AncRecentDay={day:string;sent:number;released:number};
export const RECENT_DAYS=14;
export type AncInsights={fiscalYear:number;generatedAt:string;tat:AncTat;recent:AncRecentDay[];units:{id:string;name:string}[];highRisk:{count:number;runLabel:string|null;rows:CardCase[]};gaOver18:{count:number;rows:GaCase[]};monthly:AncMonth[];stats:AncStats};

/** The fiscal year's months (October to September, Bangkok) up to the current month. */
export function fiscalMonths(fy:number,now:Date){
 const start=fy-543-1,current=bangkokDay(now).slice(0,7);
 return Array.from({length:12},(_,i)=>{const t=new Date(Date.UTC(start,9+i,1));return t.toISOString().slice(0,7);}).filter(m=>m<=current);
}

type GaRaw={id:string;ln:string;hn:string|null;patientName:string|null;received:boolean;round_collection_date:string|null;ga_edd:string|null;ga_request_collection:string|null};
/** Cases of the nurse units without a result (certified or imported) whose GA at blood collection is over 18+0, as case ids. */
const GA_SQL=`
   SELECT f.id,f.ln,f.hn,f."patientName",f."unitIds" unit_ids,(f."currentReceivedAt" IS NOT NULL) received,r.collection_date::text round_collection_date,
    COALESCE(ga.edd,labreg.edd::text,w.draft#>>'{pregnancy,edd}') ga_edd,COALESCE(ga.cd,w.draft#>>'{pregnancy,collectionDate}') ga_request_collection
   FROM facts f JOIN specimen_round r ON r.id=f."currentRoundId"
   LEFT JOIN p2_workspace w ON w.round_id=r.id
   LEFT JOIN lab_operational_registration labreg ON labreg.round_id=r.id
   LEFT JOIN LATERAL (SELECT x.edd,x.cd FROM (SELECT d.created_at,d.payload->'draft'->'pregnancy'->>'edd' edd,d.payload->'draft'->'pregnancy'->>'collectionDate' cd FROM p2_document_revision d WHERE d.round_id=r.id AND d.kind='REQUEST'
     UNION ALL SELECT p.created_at,p.panel->>'edd',p.panel->>'collectionDate' FROM p2_paper_review p WHERE p.round_id=r.id AND p.kind='REQUEST' AND p.status='Verified') x WHERE x.edd IS NOT NULL ORDER BY x.created_at DESC LIMIT 1) ga ON true
   WHERE f."certifiedReleaseCount"=0 AND NOT COALESCE(f."historicalResult",false) AND COALESCE(f."roundState",'')<>'Cancelled'`;
const gaCasesOf=(rows:GaRaw[]):GaCase[]=>rows.flatMap(r=>{const g=gestationalAge(r);return g&&g.days>18*7?[{caseId:r.id,ln:r.ln,hn:r.hn,name:nameOf(r.patientName),releasedAt:null,gaWeeks:g.weeks,gaDays:g.remainder,collectionDate:(r.round_collection_date??r.ga_request_collection)!,received:r.received}]:[];})
 .sort((x,y)=>(y.gaWeeks*7+y.gaDays)-(x.gaWeeks*7+x.gaDays));
/** The latest Run = the newest lab_batch that holds the attempt of a certified result of these cases; its High Risk results (risk by riskSql). */
const HIGH_RUN_SQL=`, hr AS (SELECT f.id,b.id batch_id,b.run_label,b.created_at,f.ln,f.hn,f."patientName",rr.certified_at,${riskSql} risk
  FROM facts f JOIN result_release rr ON rr.case_id=f.id AND rr.kind='RESULT' AND rr.state='Active' AND rr.round_id=f."currentRoundId"
  JOIN result_report_version v ON v.id=rr.version_id AND v.state='CertifiedReleased' AND v.kind='RESULT'
  JOIN lab_slot_assignment sa ON sa.attempt_id=v.attempt_id JOIN lab_batch b ON b.id=sa.batch_id)
 SELECT DISTINCT id,ln,hn,"patientName",run_label,risk,certified_at FROM hr WHERE batch_id=(SELECT batch_id FROM hr ORDER BY created_at DESC,batch_id LIMIT 1)`;

/** Birth date (PET, else ANC request when the PET has none), the first draw day and whether the current result is High Risk, for the age statistics. */
const AGE_COLUMNS=`COALESCE(NULLIF(pet_patient.dob,''),anc_patient.dob) dob,
 COALESCE((SELECT s.collection_date::text FROM specimen_round s WHERE s.case_id=f.id AND s.round_number=1),to_char(f."s1ReceivedAt" AT TIME ZONE 'Asia/Bangkok','YYYY-MM-DD')) ref,
 COALESCE((SELECT bool_or((${riskSql})='HIGH') FROM result_report_version v WHERE v.case_id=f.id AND v.round_id=f."currentRoundId" AND v.kind='RESULT'
  AND (EXISTS(SELECT 1 FROM result_release rr WHERE rr.version_id=v.id AND rr.kind='RESULT' AND rr.state='Active' AND v.state='CertifiedReleased') OR EXISTS(SELECT 1 FROM historical_reported_result h WHERE h.version_id=v.id))),false) high`;
const AGE_JOINS=`JOIN nipt_case c ON c.id=f.id LEFT JOIN p2_case_identity i ON i.case_id=c.id ${currentPetPatientJoin} LEFT JOIN LATERAL anc_workspace_patient(c.id) anc_patient ON true`;

export async function ancInsights(db:Queryable,user:Staff,raw:unknown={},now=new Date()):Promise<AncInsights>{
 const f=insightsInput.parse(raw);
 const units=await ancUnitScope(db,user,f.unitId);
 const unitIds=f.unitId?[f.unitId]:units.map(u=>u.id);
 const fy=f.fy??fiscalYear(now.toISOString());
 const facts=`WITH facts AS MATERIALIZED (${factsSql})`;
 // A result counts once: certified in this system, or reported by the previous system and imported (dated by the report date on its PDF).
 const released=`SELECT f.id,f.ln,f.hn,f."patientName",f."unitIds" unit_ids,rr.certified_at,r.received_at,${riskSql} risk,${trisomyHighSql} hi_t,${scaHighSql} hi_s
  FROM facts f JOIN result_release rr ON rr.case_id=f.id AND rr.kind='RESULT' AND rr.state='Active' AND rr.round_id=f."currentRoundId"
  JOIN result_report_version v ON v.id=rr.version_id AND v.state='CertifiedReleased' AND v.kind='RESULT'
  JOIN specimen_round r ON r.id=rr.round_id
  UNION ALL SELECT f.id,f.ln,f.hn,f."patientName",f."unitIds" unit_ids,COALESCE((${reportedDaySql})::date::timestamp AT TIME ZONE 'Asia/Bangkok',v.imported_at),r.received_at,${riskSql} risk,${trisomyHighSql} hi_t,${scaHighSql} hi_s
  FROM facts f JOIN historical_reported_result h ON h.case_id=f.id AND h.round_id=f."currentRoundId"
  JOIN result_report_version v ON v.id=h.version_id
  JOIN specimen_round r ON r.id=h.round_id`;
 const months=fiscalMonths(fy,now);
 const from=months[0]+'-01';
 // The last 14 days may begin before the fiscal year (early October): read from whichever is earlier; the monthly figures skip days outside their months.
 const today=bangkokDay(now),recentFrom=addDays(today,-(RECENT_DAYS-1)),readFrom=recentFrom<from?recentFrom:from;
 const [latest,ga,monthReleased,monthSent,monthRedraw,open]=await inOrder(
  ()=>db.query<{id:string;ln:string;hn:string|null;patientName:string|null;run_label:string;risk:Risk;certified_at:Date}>(`${facts}${HIGH_RUN_SQL}`,[unitIds]),
  ()=>db.query<GaRaw>(`${facts}${GA_SQL}`,[unitIds]),
  ()=>db.query<{certified_at:Date;received_at:Date|null;risk:Risk;hi_t:boolean;hi_s:boolean;unit_ids:string[]}>(`${facts} SELECT certified_at,received_at,risk,hi_t,hi_s,unit_ids FROM (${released}) x WHERE certified_at>=(($2::date)::timestamp AT TIME ZONE 'Asia/Bangkok')`,[unitIds,readFrom]),
  ()=>db.query<{at:Date;unit_ids:string[];dob:string|null;ref:string|null;high:boolean}>(`${facts} SELECT f."s1ReceivedAt" at,f."unitIds" unit_ids,${AGE_COLUMNS} FROM facts f ${AGE_JOINS} WHERE f."s1ReceivedAt">=(($2::date)::timestamp AT TIME ZONE 'Asia/Bangkok')`,[unitIds,readFrom]),
  ()=>db.query<{at:Date}>(`${facts} SELECT d.requested_at at FROM redraw_request d JOIN facts f ON f.id=d.case_id WHERE d.state<>'Cancelled' AND d.requested_at>=(($2::date)::timestamp AT TIME ZONE 'Asia/Bangkok')`,[unitIds,from]),
  // Open work for the TAT figures: sent (S1 received), current round received by the Lab, no result in this system or the previous one.
  ()=>db.query<{at:Date}>(`${facts} SELECT f."currentReceivedAt" at FROM facts f WHERE f."s1ReceivedAt" IS NOT NULL AND f."currentReceivedAt" IS NOT NULL AND f."certifiedReleaseCount"=0 AND f."activeReleaseCount"=0
   AND NOT COALESCE(f."historicalResult",false) AND COALESCE(f."roundState",'') NOT IN ('Cancelled','Expected')`,[unitIds]),
 );
 // Working days to the result skip weekends and the synced holidays (same calendar as the Lab TAT).
 const cal=await workingCalendar(db,now,Number(readFrom.slice(0,4))-1),holidays=cal.holidays,policy=cal.policy;
 const byMonth=new Map(months.map(m=>[m,{month:m,sent:0,released:0,redraw:0,high:0,highTrisomy:0,highSca:0,low:0,unknown:0,medianDays:null as number|null}]));
 const days=new Map<string,number[]>();
 const key=(d:Date)=>bangkokDay(d).slice(0,7);
 const weekday=Array<number>(7).fill(0),unitStat=new Map(units.map(u=>[u.id,{unitId:u.id,name:u.name,sent:0,released:0,high:0}])),allDays:number[]=[];
 const unitsOf=(ids:string[]|null)=>(ids??[]).map(id=>unitStat.get(id)).filter((x):x is NonNullable<typeof x>=>!!x&&(!f.unitId||x.unitId===f.unitId));
 const ages:{age:number|null;high:boolean}[]=[];
 const recent=new Map(Array.from({length:RECENT_DAYS},(_,i)=>{const day=addDays(recentFrom,i);return [day,{day,sent:0,released:0}];}));
 for(const r of monthSent.rows){const d=recent.get(bangkokDay(r.at));if(d)d.sent++;}
 for(const r of monthReleased.rows){const d=recent.get(bangkokDay(r.certified_at));if(d)d.released++;}
 const top=policy.businessDays+4,aging=Array.from({length:top+1},(_,days)=>({days,ok:0,dueSoon:0,overdue:0}));let overdue=0,dueSoon=0;
 for(const r of open.rows){const t=tatStatus(r.at,now,holidays,policy),b=aging[Math.min(Math.max(0,t.used),top)];if(t.state==='overdue'){b.overdue++;overdue++;}else if(t.state==='due-soon'){b.dueSoon++;dueSoon++;}else b.ok++;}
 for(const r of monthSent.rows){const m=byMonth.get(key(r.at));if(!m)continue;m.sent++;ages.push({age:ageOnDate(r.dob&&/^\d{4}-\d{2}-\d{2}$/.test(r.dob)?r.dob:null,r.ref),high:r.high});weekday[(new Date(bangkokDay(r.at)+'T00:00:00Z').getUTCDay()+6)%7]++;for(const u of unitsOf(r.unit_ids))u.sent++;}
 for(const r of monthRedraw.rows){const m=byMonth.get(key(r.at));if(m)m.redraw++;}
 for(const r of monthReleased.rows){const m=byMonth.get(key(r.certified_at));if(!m)continue;m.released++;if(r.risk==='HIGH'){m.high++;if(r.hi_t)m.highTrisomy++;if(r.hi_s)m.highSca++;}else if(r.risk==='LOW')m.low++;else m.unknown++;for(const u of unitsOf(r.unit_ids)){u.released++;if(r.risk==='HIGH')u.high++;}if(r.received_at){const d=businessDaysBetween(r.received_at,r.certified_at,holidays);allDays.push(d);days.set(m.month,[...(days.get(m.month)??[]),d]);}}
 for(const m of byMonth.values())m.medianDays=median(days.get(m.month)??[]);
 const high:CardCase[]=latest.rows.filter(r=>r.risk==='HIGH').sort((x,y)=>+new Date(y.certified_at)-+new Date(x.certified_at)).map(r=>({caseId:r.id,ln:r.ln,hn:r.hn,name:nameOf(r.patientName),releasedAt:new Date(r.certified_at).toISOString()}));
 const gaCases=gaCasesOf(ga.rows);
 const brief=f.view==='dashboard';
 return {fiscalYear:fy,generatedAt:now.toISOString(),units:units.map(u=>({id:u.id,name:u.name})),
  tat:{policy,open:open.rows.length,overdue,dueSoon,aging},recent:[...recent.values()],
  highRisk:{count:high.length,runLabel:latest.rows[0]?.run_label??null,rows:brief?[]:high},
  gaOver18:{count:gaCases.length,rows:brief?[]:gaCases},
  monthly:[...byMonth.values()],
  stats:{totals:{sent:months.reduce((n,m)=>n+byMonth.get(m)!.sent,0),released:months.reduce((n,m)=>n+byMonth.get(m)!.released,0),high:months.reduce((n,m)=>n+byMonth.get(m)!.high,0),highTrisomy:months.reduce((n,m)=>n+byMonth.get(m)!.highTrisomy,0),highSca:months.reduce((n,m)=>n+byMonth.get(m)!.highSca,0),redraw:months.reduce((n,m)=>n+byMonth.get(m)!.redraw,0),medianDays:median(allDays),p90Days:percentile(allDays,90)},
   weekday,age:ageGroups(ages),units:[...unitStat.values()].filter(u=>u.sent+u.released>0).sort((a,b)=>b.sent-a.sent||a.name.localeCompare(b.name,'th'))}};
}
