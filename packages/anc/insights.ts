import {z} from 'zod';
import type {Queryable} from '../db/connection';
import type {Staff} from '../lab/core';
import {gestationalAge} from '../lab/core';
import {riskSql,reportedDaySql,type Risk} from '../results/query';
import {bangkokDay,businessDaysBetween,median,percentile} from '../calendar/business-days';
import {readHolidays} from '../calendar/holiday-sync';
import {patientDisplayName} from '../domain/patient-name';
import {ancUnitScope,factsSql} from './service';
import {fiscalYear} from './model';
import {inOrder} from '../db/in-order';

/**
 * ANC overview panel (Owner 2026-11-11), read-only and in the same unit scope as the ANC queue:
 * - High Risk results: every current High Risk result of the nurse units, certified here or reported by the previous system (display only; no "informed" tick, no new step; other results are not listed here);
 * - GA over 18 weeks: cases not yet resulted whose GA at blood collection is over 18+0;
 * - monthly statistics of the fiscal year: sent, resulted, redraws, High Risk results and median working days to the result.
 * Risk words describe the parsed report (results/query.ts riskSql), never a new clinical interpretation.
 */
const LIMIT=20;
export const insightsInput=z.strictObject({fy:z.coerce.number().int().min(2543).max(2743).optional(),unitId:z.uuid().optional()});

export type RecentResult={caseId:string;ln:string;hn:string|null;name:string;releasedAt:string;risk:Risk};
export type GaCase={caseId:string;ln:string;hn:string|null;name:string;gaWeeks:number;gaDays:number;collectionDate:string;received:boolean};
export type AncMonth={month:string;sent:number;released:number;redraw:number;high:number;low:number;unknown:number;medianDays:number|null};
/** Fiscal-year statistics for the ANC statistics tab (same unit scope as the queue). `weekday[0]` = Monday. A case with several units counts in each. */
export type AncStats={totals:{sent:number;released:number;high:number;redraw:number;medianDays:number|null;p90Days:number|null};weekday:number[];units:{unitId:string;name:string;sent:number;released:number;high:number}[]};
export type AncInsights={fiscalYear:number;generatedAt:string;recent:{high:number;total:number;rows:RecentResult[]};gaOver18:{count:number;rows:GaCase[]};monthly:AncMonth[];stats:AncStats};

const nameOf=(n:string|null)=>patientDisplayName(n?.trim()||'ยังไม่มีข้อมูลชื่อ-นามสกุล');
/** The fiscal year's months (October to September, Bangkok) up to the current month. */
export function fiscalMonths(fy:number,now:Date){
 const start=fy-543-1,current=bangkokDay(now).slice(0,7);
 return Array.from({length:12},(_,i)=>{const t=new Date(Date.UTC(start,9+i,1));return t.toISOString().slice(0,7);}).filter(m=>m<=current);
}

export async function ancInsights(db:Queryable,user:Staff,raw:unknown={},now=new Date()):Promise<AncInsights>{
 const f=insightsInput.parse(raw);
 const units=await ancUnitScope(db,user,f.unitId);
 const unitIds=f.unitId?[f.unitId]:units.map(u=>u.id);
 const fy=f.fy??fiscalYear(now.toISOString());
 const facts=`WITH facts AS MATERIALIZED (${factsSql})`;
 // A result counts once: certified in this system, or reported by the previous system and imported (dated by the report date on its PDF).
 const released=`SELECT f.id,f.ln,f.hn,f."patientName",f."unitIds" unit_ids,rr.certified_at,r.received_at,${riskSql} risk
  FROM facts f JOIN result_release rr ON rr.case_id=f.id AND rr.kind='RESULT' AND rr.state='Active' AND rr.round_id=f."currentRoundId"
  JOIN result_report_version v ON v.id=rr.version_id AND v.state='CertifiedReleased' AND v.kind='RESULT'
  JOIN specimen_round r ON r.id=rr.round_id
  UNION ALL SELECT f.id,f.ln,f.hn,f."patientName",f."unitIds" unit_ids,COALESCE((${reportedDaySql})::date::timestamp AT TIME ZONE 'Asia/Bangkok',v.imported_at),r.received_at,${riskSql} risk
  FROM facts f JOIN historical_reported_result h ON h.case_id=f.id AND h.round_id=f."currentRoundId"
  JOIN result_report_version v ON v.id=h.version_id
  JOIN specimen_round r ON r.id=h.round_id`;
 const months=fiscalMonths(fy,now);
 const from=months[0]+'-01';
 const [recent,ga,monthReleased,monthSent,monthRedraw]=await inOrder(
  ()=>db.query<{id:string;ln:string;hn:string|null;patientName:string|null;certified_at:Date;risk:Risk}>(`${facts} SELECT * FROM (${released}) x WHERE risk='HIGH'
   ORDER BY certified_at DESC,id`,[unitIds]),
  ()=>db.query<{id:string;ln:string;hn:string|null;patientName:string|null;received:boolean;round_collection_date:string|null;ga_edd:string|null;ga_request_collection:string|null}>(`${facts}
   SELECT f.id,f.ln,f.hn,f."patientName",f."unitIds" unit_ids,(f."currentReceivedAt" IS NOT NULL) received,r.collection_date::text round_collection_date,
    COALESCE(ga.edd,labreg.edd::text,w.draft#>>'{pregnancy,edd}') ga_edd,COALESCE(ga.cd,w.draft#>>'{pregnancy,collectionDate}') ga_request_collection
   FROM facts f JOIN specimen_round r ON r.id=f."currentRoundId"
   LEFT JOIN p2_workspace w ON w.round_id=r.id
   LEFT JOIN lab_operational_registration labreg ON labreg.round_id=r.id
   LEFT JOIN LATERAL (SELECT x.edd,x.cd FROM (SELECT d.created_at,d.payload->'draft'->'pregnancy'->>'edd' edd,d.payload->'draft'->'pregnancy'->>'collectionDate' cd FROM p2_document_revision d WHERE d.round_id=r.id AND d.kind='REQUEST'
     UNION ALL SELECT p.created_at,p.panel->>'edd',p.panel->>'collectionDate' FROM p2_paper_review p WHERE p.round_id=r.id AND p.kind='REQUEST' AND p.status='Verified') x WHERE x.edd IS NOT NULL ORDER BY x.created_at DESC LIMIT 1) ga ON true
   WHERE f."certifiedReleaseCount"=0 AND NOT COALESCE(f."historicalResult",false) AND COALESCE(f."roundState",'')<>'Cancelled'`,[unitIds]),
  ()=>db.query<{certified_at:Date;received_at:Date|null;risk:Risk;unit_ids:string[]}>(`${facts} SELECT certified_at,received_at,risk FROM (${released}) x WHERE certified_at>=(($2::date)::timestamp AT TIME ZONE 'Asia/Bangkok')`,[unitIds,from]),
  ()=>db.query<{at:Date;unit_ids:string[]}>(`${facts} SELECT f."s1ReceivedAt" at,f."unitIds" unit_ids FROM facts f WHERE f."s1ReceivedAt">=(($2::date)::timestamp AT TIME ZONE 'Asia/Bangkok')`,[unitIds,from]),
  ()=>db.query<{at:Date}>(`${facts} SELECT d.requested_at at FROM redraw_request d JOIN facts f ON f.id=d.case_id WHERE d.state<>'Cancelled' AND d.requested_at>=(($2::date)::timestamp AT TIME ZONE 'Asia/Bangkok')`,[unitIds,from]),
 );
 // Working days to the result skip weekends and the synced holidays (same calendar as the Lab TAT).
 const y=Number(from.slice(0,4)),holidays=await readHolidays(db,y-1,Number(bangkokDay(now).slice(0,4)));
 const byMonth=new Map(months.map(m=>[m,{month:m,sent:0,released:0,redraw:0,high:0,low:0,unknown:0,medianDays:null as number|null}]));
 const days=new Map<string,number[]>();
 const key=(d:Date)=>bangkokDay(d).slice(0,7);
 const weekday=Array<number>(7).fill(0),unitStat=new Map(units.map(u=>[u.id,{unitId:u.id,name:u.name,sent:0,released:0,high:0}])),allDays:number[]=[];
 const unitsOf=(ids:string[]|null)=>(ids??[]).map(id=>unitStat.get(id)).filter((x):x is NonNullable<typeof x>=>!!x&&(!f.unitId||x.unitId===f.unitId));
 for(const r of monthSent.rows){const m=byMonth.get(key(r.at));if(!m)continue;m.sent++;weekday[(new Date(bangkokDay(r.at)+'T00:00:00Z').getUTCDay()+6)%7]++;for(const u of unitsOf(r.unit_ids))u.sent++;}
 for(const r of monthRedraw.rows){const m=byMonth.get(key(r.at));if(m)m.redraw++;}
 for(const r of monthReleased.rows){const m=byMonth.get(key(r.certified_at));if(!m)continue;m.released++;if(r.risk==='HIGH')m.high++;else if(r.risk==='LOW')m.low++;else m.unknown++;for(const u of unitsOf(r.unit_ids)){u.released++;if(r.risk==='HIGH')u.high++;}if(r.received_at){const d=businessDaysBetween(r.received_at,r.certified_at,holidays);allDays.push(d);days.set(m.month,[...(days.get(m.month)??[]),d]);}}
 for(const m of byMonth.values())m.medianDays=median(days.get(m.month)??[]);
 const gaCases=ga.rows.flatMap(r=>{const g=gestationalAge(r);return g&&g.days>18*7?[{caseId:r.id,ln:r.ln,hn:r.hn,name:nameOf(r.patientName),gaWeeks:g.weeks,gaDays:g.remainder,collectionDate:(r.round_collection_date??r.ga_request_collection)!,received:r.received}]:[];})
  .sort((a,b)=>(b.gaWeeks*7+b.gaDays)-(a.gaWeeks*7+a.gaDays));
 return {fiscalYear:fy,generatedAt:now.toISOString(),
  recent:{high:recent.rows.filter(r=>r.risk==='HIGH').length,total:recent.rows.length,rows:recent.rows.slice(0,LIMIT).map(r=>({caseId:r.id,ln:r.ln,hn:r.hn,name:nameOf(r.patientName),releasedAt:new Date(r.certified_at).toISOString(),risk:r.risk}))},
  gaOver18:{count:gaCases.length,rows:gaCases.slice(0,LIMIT)},
  monthly:[...byMonth.values()],
  stats:{totals:{sent:months.reduce((n,m)=>n+byMonth.get(m)!.sent,0),released:months.reduce((n,m)=>n+byMonth.get(m)!.released,0),high:months.reduce((n,m)=>n+byMonth.get(m)!.high,0),redraw:months.reduce((n,m)=>n+byMonth.get(m)!.redraw,0),medianDays:median(allDays),p90Days:percentile(allDays,90)},
   weekday,units:[...unitStat.values()].filter(u=>u.sent+u.released>0).sort((a,b)=>b.sent-a.sent||a.name.localeCompare(b.name,'th'))}};
}
