import {parseMapping} from './mapping';
import type {SourceInput} from './model';
import type {Queryable} from '../db/connection';

/** Inspect only: no database changes or inferred patient identity. */
export function inspectLnHalosWorkbook(input:SourceInput){
 const parsed=parseMapping(input);
 const rows=parsed.mappings.map(m=>({row:m.rowNumber,ln:m.hisLn,lnHalos:m.halosId,issues:m.exceptions.map(e=>e.code),duplicateOf:null as number|null}));
 const byLn=new Map<string,Set<string>>(),byHalos=new Map<string,Set<string>>(),firstPair=new Map<string,number>();
 for(const r of rows){byLn.set(r.ln,(byLn.get(r.ln)??new Set()).add(r.lnHalos));byHalos.set(r.lnHalos,(byHalos.get(r.lnHalos)??new Set()).add(r.ln));}
 for(const r of rows){
  if(r.ln&&r.lnHalos&&byLn.get(r.ln)?.size===1&&byHalos.get(r.lnHalos)?.size===1){
   r.issues=r.issues.filter(i=>i!=='MAPPING_DUPLICATE_LN'&&i!=='MAPPING_DUPLICATE_HALOS');
   const pair=JSON.stringify([r.ln,r.lnHalos]);r.duplicateOf=firstPair.get(pair)??null;if(r.duplicateOf===null)firstPair.set(pair,r.row);
  }
 }
 const sequences=new Map<string,typeof rows>();
 for(const row of rows){
  const h=row.lnHalos;
  if(!/^\d{2}B\d{9}$/.test(h)){row.issues.push('INVALID_HALOS_FORMAT');continue;}
  const year=Number(h.slice(3,5))+2000,month=Number(h.slice(5,7)),day=Number(h.slice(7,9)),seq=Number(h.slice(9));
  if(h.slice(0,2)!==h.slice(3,5))row.issues.push('INVALID_YEAR');
  const date=new Date(Date.UTC(year,month-1,day));
  if(date.getUTCFullYear()!==year||date.getUTCMonth()!==month-1||date.getUTCDate()!==day)row.issues.push('INVALID_DATE');
  if(seq===0)row.issues.push('INVALID_SEQUENCE');
  if(seq>=900)row.issues.push('EQA_RANGE_RESERVED');
  if(row.issues.length===0&&row.duplicateOf===null){const key=h.slice(3,7)+h.slice(9);sequences.set(key,[...(sequences.get(key)??[]),row]);}
 }
 for(const group of sequences.values())if(group.length>1)for(const row of group)row.issues.push('DUPLICATE_MONTHLY_SEQUENCE');
 const maxima=new Map<string,number>();
 for(const row of rows){if(row.issues.some(i=>['INVALID_HALOS_FORMAT','INVALID_YEAR','INVALID_DATE','INVALID_SEQUENCE','EQA_RANGE_RESERVED'].includes(i)))continue;const h=row.lnHalos,month=`20${h.slice(3,5)}-${h.slice(5,7)}-01`;maxima.set(month,Math.max(maxima.get(month)??0,Number(h.slice(9))));}
 return {source:parsed.source,rows,months:[...maxima].sort(([a],[b])=>a.localeCompare(b)).map(([month,lastValue])=>({month,lastValue}))};
}

/** Database-backed preview. All decisions are rechecked when committing the import. */
export async function previewLnHalosImport(db:Queryable,input:SourceInput){
 const inspection=inspectLnHalosWorkbook(input);
 const valid=inspection.rows.filter(r=>r.issues.length===0&&r.duplicateOf===null);
 const observations=valid.length?(await db.query<{ln:string;halos:string;exact:boolean;case_only:boolean;conflict:boolean;ln_conflict:boolean;halos_conflict:boolean;sequence_conflict:boolean;pending_pet:boolean}>(`
  WITH input AS (SELECT * FROM unnest($1::text[],$2::text[]) AS t(ln,halos))
  SELECT i.ln,i.halos,
   (EXISTS(SELECT 1 FROM migration_record m WHERE m.state='IMPORTED' AND m.ln=i.ln AND m.ln_halos=i.halos)
    OR EXISTS(SELECT 1 FROM case_ln c JOIN specimen_lab_number n ON n.case_id=c.case_id WHERE c.ln=i.ln AND n.ln_halos=i.halos)) exact,
   (EXISTS(SELECT 1 FROM case_ln c JOIN specimen_lab_number n ON n.case_id=c.case_id WHERE c.ln=i.ln AND n.ln_halos=i.halos)
    AND NOT EXISTS(SELECT 1 FROM migration_record m WHERE m.state='IMPORTED' AND m.ln=i.ln AND m.ln_halos=i.halos)) case_only,
   (EXISTS(SELECT 1 FROM migration_record m WHERE m.state<>'EXCEPTION' AND m.ln=i.ln AND m.ln_halos<>i.halos)
    OR EXISTS(SELECT 1 FROM case_ln c WHERE c.ln=i.ln AND NOT EXISTS(SELECT 1 FROM specimen_lab_number n WHERE n.case_id=c.case_id AND n.ln_halos=i.halos))) ln_conflict,
   (EXISTS(SELECT 1 FROM migration_record m WHERE m.state<>'EXCEPTION' AND m.ln<>i.ln AND m.ln_halos=i.halos)
    OR EXISTS(SELECT 1 FROM case_ln c JOIN specimen_lab_number n ON n.case_id=c.case_id WHERE c.ln<>i.ln AND n.ln_halos=i.halos)) halos_conflict,
   (EXISTS(SELECT 1 FROM migration_record m WHERE m.state<>'EXCEPTION' AND m.ln_halos<>i.halos AND m.ln_halos ~ '^[0-9]{2}B[0-9]{9}$' AND substring(m.ln_halos,4,4)=substring(i.halos,4,4) AND substring(m.ln_halos,10,3)=substring(i.halos,10,3))
    OR EXISTS(SELECT 1 FROM specimen_lab_number n WHERE n.original_round_id IS NULL AND n.ln_halos<>i.halos AND substring(n.ln_halos,4,4)=substring(i.halos,4,4) AND substring(n.ln_halos,10,3)=substring(i.halos,10,3))) sequence_conflict,
   (EXISTS(SELECT 1 FROM migration_record m WHERE m.state<>'EXCEPTION' AND ((m.ln=i.ln AND m.ln_halos<>i.halos) OR (m.ln<>i.ln AND m.ln_halos=i.halos)))
    OR EXISTS(SELECT 1 FROM migration_record m WHERE m.state<>'EXCEPTION' AND m.ln_halos<>i.halos AND m.ln_halos ~ '^[0-9]{2}B[0-9]{9}$' AND substring(m.ln_halos,4,4)=substring(i.halos,4,4) AND substring(m.ln_halos,10,3)=substring(i.halos,10,3))
    OR EXISTS(SELECT 1 FROM specimen_lab_number n WHERE n.original_round_id IS NULL AND n.ln_halos<>i.halos AND substring(n.ln_halos,4,4)=substring(i.halos,4,4) AND substring(n.ln_halos,10,3)=substring(i.halos,10,3))
    OR EXISTS(SELECT 1 FROM case_ln c JOIN specimen_lab_number n ON n.case_id=c.case_id WHERE (c.ln=i.ln AND n.ln_halos<>i.halos) OR (c.ln<>i.ln AND n.ln_halos=i.halos))
    OR EXISTS(SELECT 1 FROM case_ln c WHERE c.ln=i.ln AND NOT EXISTS(SELECT 1 FROM specimen_lab_number n WHERE n.case_id=c.case_id AND n.ln_halos=i.halos))) conflict,
   EXISTS(SELECT 1 FROM his_inbound_file f WHERE f.ln=i.ln AND f.state IN ('Ready','Unlinked')) pending_pet
  FROM input i`,[valid.map(r=>r.ln),valid.map(r=>r.lnHalos)])).rows:[];
 const byLn=new Map(observations.map(r=>[r.ln,r]));
 return {...inspection,rows:inspection.rows.map(row=>{
  const found=byLn.get(row.ln);
  const conflicting=row.issues.length>0&&row.issues.every(i=>i==='MAPPING_DUPLICATE_LN'||i==='MAPPING_DUPLICATE_HALOS'||i==='DUPLICATE_MONTHLY_SEQUENCE');
  const status=conflicting?'CONFLICT':row.issues.length?'INVALID':row.duplicateOf!==null?'DUPLICATE':found?.conflict?'CONFLICT':found?.case_only?'EXISTING_CASE':found?.exact?'EXISTING':'NEW';
  const issues=[...row.issues,...(found?.ln_conflict?['LN_ALREADY_LINKED']:[]),...(found?.halos_conflict?['HALOS_ALREADY_LINKED']:[]),...(found?.sequence_conflict?['MONTH_SEQUENCE_USED']:[])];
  return {...row,issues,status,pendingPet:found?.pending_pet??false};
 })};
}
