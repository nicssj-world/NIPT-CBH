/** Read model of the Runs imported from Genomic-CBH (Run001-003/2026). They are not NIPT-CBH batches (no lab_batch, no Task List, no execution): they are the
 *  HALOS analysis workbooks that were run before go-live. Everything shown is read from migration_historical_run / migration_analysis / migration_record,
 *  so nothing is created, no QC or result is implied, and a Run shows exactly what its source workbook holds. */
import type {Queryable} from '../db/connection';
import {recordPhiAccess} from '../db/phi-access';
import {assertSession,need,type Staff} from './core';

export type HistoricalRunRow={runLabel:string;runYear:number;runNumber:number;samples:number;controls:number;technicalRepeats:number;withPdf:number};
export type HistoricalRunSlot={slot:number;kind:'SAMPLE'|'CONTROL'|'REPEAT'|'EMPTY';label:string|null;hisLn:string|null;lnHalos:string|null;caseId:string|null;attempt:number|null;advice:string|null;hasPdf:boolean;template:'PC'|'NC'|'BLANK'|null};
export type HistoricalRunDetail={runLabel:string;slots:HistoricalRunSlot[];samples:number;controls:number;technicalRepeats:number;withPdf:number;slotCount:number};
const TEMPLATE_CONTROL:Record<number,'PC'|'NC'|'BLANK'>={1:'PC',25:'NC',40:'BLANK'}; // Task List 1-3 layout: PC slot 1, NC slot 25, Blank slot 40

export async function listHistoricalRuns(db:Queryable,user:Staff):Promise<HistoricalRunRow[]>{
 await assertSession(db,user);need(user,'worksheet.read','read');
 return (await db.query<HistoricalRunRow>(`SELECT h.run_label "runLabel",h.run_year "runYear",h.run_number "runNumber",
   (SELECT count(*) FROM migration_analysis a WHERE a.run_label=h.run_label AND a.sheet='result' AND a.classification='ANALYSIS')::int samples,
   (SELECT count(*) FROM migration_analysis a WHERE a.run_label=h.run_label AND a.sheet IN ('result','repeat') AND a.classification='CONTROL')::int controls,
   (SELECT count(*) FROM migration_analysis a WHERE a.run_label=h.run_label AND a.sheet='repeat')::int "technicalRepeats",
   (SELECT count(DISTINCT m.id) FROM migration_analysis a JOIN migration_record m ON m.id=a.record_id JOIN historical_reported_result r ON r.record_id=m.id WHERE a.run_label=h.run_label AND a.sheet='result')::int "withPdf"
  FROM migration_historical_run h ORDER BY h.run_year DESC,h.run_number DESC`)).rows;
}

export async function historicalRunDetail(db:Queryable,user:Staff,runLabel:string):Promise<HistoricalRunDetail|null>{
 await assertSession(db,user);need(user,'worksheet.read','read');
 if(!/^Run\d{3}\/\d{4}$/.test(runLabel))return null;
 if(!(await db.query('SELECT 1 FROM migration_historical_run WHERE run_label=$1',[runLabel])).rows.length)return null;
 const rows=(await db.query<{sheet:string;classification:string;attempt_number:number|null;advice_status:string;barcode_id:string|null;sample_raw:string;row_number:number;ln:string|null;ln_halos:string|null;case_id:string|null;has_pdf:boolean}>(
  `SELECT a.sheet,a.classification,a.attempt_number,a.advice_status,a.barcode_id,a.sample_raw,a.row_number,m.ln,m.ln_halos,m.case_id,
    EXISTS(SELECT 1 FROM historical_reported_result r WHERE r.record_id=m.id) has_pdf
   FROM migration_analysis a LEFT JOIN migration_record m ON m.id=a.record_id
   WHERE a.run_label=$1 AND a.sheet IN ('result','repeat') ORDER BY a.row_number`,[runLabel])).rows;
 const bySlot=new Map<number,typeof rows[number]>(),extra:typeof rows=[];
 for(const r of rows){const s=Number(r.barcode_id);if(Number.isInteger(s)&&s>=1&&s<=48&&r.sheet==='result'&&!bySlot.has(s))bySlot.set(s,r);else extra.push(r);}
 const toSlot=(slot:number,r:typeof rows[number]|undefined):HistoricalRunSlot=>{
  const template=TEMPLATE_CONTROL[slot]??null;
  if(!r)return {slot,kind:'EMPTY',label:template==='BLANK'?'BLANK':null,hisLn:null,lnHalos:null,caseId:null,attempt:null,advice:null,hasPdf:false,template};
  const control=r.classification==='CONTROL';
  return {slot,kind:control?'CONTROL':r.sheet==='repeat'?'REPEAT':'SAMPLE',label:control?r.sample_raw:null,hisLn:control?null:r.ln,lnHalos:control?null:r.ln_halos,caseId:r.case_id,attempt:r.attempt_number,advice:r.advice_status,hasPdf:r.has_pdf,template};
 };
 const slots:HistoricalRunSlot[]=[];for(let s=1;s<=48;s++)slots.push(toSlot(s,bySlot.get(s)));
 // technical repeats (sheet "repeat") and any row without a usable position are listed after the 48 slots, never dropped
 for(const r of extra)slots.push({...toSlot(0,r),slot:Number(r.barcode_id)||0});
 const caseIds=[...new Set(rows.map(r=>r.case_id).filter((x):x is string=>!!x))].slice(0,200);
 if(caseIds.length)await recordPhiAccess(db,user.id,caseIds,'REGISTRY_VIEW');
 return {runLabel,slots,slotCount:48,
  samples:rows.filter(r=>r.sheet==='result'&&r.classification==='ANALYSIS').length,controls:rows.filter(r=>r.classification==='CONTROL').length,
  technicalRepeats:rows.filter(r=>r.sheet==='repeat').length,withPdf:new Set(slots.filter(s=>s.hasPdf&&s.caseId).map(s=>s.caseId)).size};
}
