import {z} from 'zod';
import type {Queryable} from '../db/connection';
import {assertSession,need,type Staff} from '../lab/core';
import {fiscalYear} from '../anc/model';
import {followedRows,type ConfirmRow} from './service';
import {FINDING_KEYS,TRISOMY_KEYS,SCA_KEYS,STATUSES,hasResult,type FindingKey,type ConfirmStatus} from './model';

// Concordance of NIPT screening with the confirmatory result (Owner 2026-11-23), counted per screening finding:
//  % ผลตรงกัน (PPV) = True positive ÷ findings with a confirmatory result (มีผลแล้ว / ใช้ผลหลังคลอด).
//  Mosaic-other counts as not concordant (it stays in the denominator) and is shown on its own. Cases without a result are counted by status, never in the %.
// Counts only (no patient data), over the cases the user may see, by the fiscal year of the screening result.

export type Tally={screened:number;confirmed:number;truePositive:number;falsePositive:number;mosaicOther:number;ppv:number|null};
export type ConfirmStats={fiscalYear:number|null;fiscalYears:number[];cases:{followed:number;withResult:number;concordant:number};status:Record<ConfirmStatus,number>;
 overall:Tally;trisomy:Tally;sca:Tally;byFinding:Record<FindingKey,Tally>};

const empty=():Tally=>({screened:0,confirmed:0,truePositive:0,falsePositive:0,mosaicOther:0,ppv:null});
/** One decimal place, null without a denominator ("—" on screen, never 0 %). */
export const ppvOf=(t:Pick<Tally,'confirmed'|'truePositive'>)=>t.confirmed?Math.round(t.truePositive/t.confirmed*1000)/10:null;

export function tallyRows(rows:ConfirmRow[]){
 const byFinding=Object.fromEntries(FINDING_KEYS.map(k=>[k,empty()])) as Record<FindingKey,Tally>;
 const status=Object.fromEntries(STATUSES.map(s=>[s,0])) as Record<ConfirmStatus,number>;
 const cases={followed:rows.length,withResult:0,concordant:0};
 for(const r of rows){
  status[r.status]++;
  const result=hasResult(r.status)&&r.record;
  if(result){cases.withResult++;if(r.concordant)cases.concordant++;}
  for(const k of r.screen){
   const t=byFinding[k];t.screened++;
   const o=result?r.record!.findings[k]:undefined;if(!o)continue;
   t.confirmed++;if(o==='TRUE_POSITIVE')t.truePositive++;else if(o==='FALSE_POSITIVE')t.falsePositive++;else t.mosaicOther++;
  }
 }
 const sum=(keys:readonly FindingKey[])=>{const t=empty();for(const k of keys)for(const f of ['screened','confirmed','truePositive','falsePositive','mosaicOther'] as const)t[f]+=byFinding[k][f];t.ppv=ppvOf(t);return t;};
 for(const t of Object.values(byFinding))t.ppv=ppvOf(t);
 return {cases,status,byFinding,overall:sum(FINDING_KEYS),trisomy:sum(TRISOMY_KEYS),sca:sum(SCA_KEYS)};
}

const input=z.strictObject({fy:z.union([z.literal('all'),z.coerce.number().int().min(2543).max(2743)]).optional()});

/** `fy` omitted = the current fiscal year; `all` = every year. */
export async function confirmStats(db:Queryable,user:Staff,raw:unknown={},now=new Date()):Promise<ConfirmStats>{
 await assertSession(db,user);need(user,'confirm.read','read');
 const d=input.parse(raw),fy=d.fy==='all'?null:d.fy??fiscalYear(now.toISOString());
 const all=await followedRows(db,user,now);
 return {fiscalYear:fy,fiscalYears:[...new Set(all.map(r=>r.fiscalYear))].sort((a,b)=>b-a),...tallyRows(fy===null?all:all.filter(r=>r.fiscalYear===fy))};
}
