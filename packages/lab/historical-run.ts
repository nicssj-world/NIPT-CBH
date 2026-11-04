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

/** Unified Batch / Task List index: historical Runs remain read-only but share search, sort and pagination.
 * Sort on recorded run_year / run_number, NEVER migration insert time. */
export async function listUnifiedRunPage(db:Queryable,user:Staff,input:{q?:string;page?:string|number;pageSize?:string|number}={}){
 await assertSession(db,user);need(user,'worksheet.read','read');
 const q=String(input.q??'').trim().toLowerCase().slice(0,40);
 const requestedSize=Number(input.pageSize??25);
 const size=[10,25,50,100].includes(requestedSize)?requestedSize:25;
 const pageRequested=Math.max(1,Math.floor(Number(input.page??1)||1));
 const releaseColumn=(await db.query<{present:boolean}>("SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='lab_batch' AND column_name='run_released_at') present")).rows[0]?.present;
 const base=`WITH combined AS (
  SELECT b.run_label,b.run_year,b.run_number,b.id,'CURRENT'::text source,b.state,
    b.created_at,
    (SELECT count(*) FROM lab_slot_assignment a WHERE a.batch_id=b.id AND a.removed_at IS NULL)::int samples,
    ARRAY(SELECT t.state FROM lab_task_sheet t WHERE t.batch_id=b.id ORDER BY t.sheet_number) sheet_states,
    0::int controls,0::int technical_repeats,0::int with_pdf,
    -- The bench (QC / Pooling / Sequencing) records on its own worksheet and never moves lab_batch.state, so the list reads it directly.
    COALESCE((SELECT lab_actual_pooling_current(p.id) FROM lab_actual_pooling p WHERE p.batch_id=b.id AND p.note<>'AUTO_RECORDED_FROM_SAVED_TASK_AT_EXPORT' ORDER BY p.recorded_at DESC,p.id DESC LIMIT 1),false) pooling_recorded,
    EXISTS(SELECT 1 FROM lab_bench_export e WHERE e.batch_id=b.id AND e.kind='HALOS_TASK_XLSX') seq_files_exported
  FROM lab_batch b WHERE NOT EXISTS (SELECT 1 FROM lab_batch_removal d WHERE d.batch_id=b.id) ${releaseColumn?"AND b.run_released_at IS NULL":""}
  UNION ALL
  SELECT h.run_label,h.run_year,h.run_number,NULL::uuid,'HISTORICAL'::text,'Historical'::text,
    NULL::timestamptz,
    (SELECT count(*) FROM migration_analysis a WHERE a.run_label=h.run_label AND a.sheet='result' AND a.classification='ANALYSIS')::int,
    ARRAY[]::text[],
    (SELECT count(*) FROM migration_analysis a WHERE a.run_label=h.run_label AND a.sheet IN ('result','repeat') AND a.classification='CONTROL')::int,
    (SELECT count(*) FROM migration_analysis a WHERE a.run_label=h.run_label AND a.sheet='repeat')::int,
    (SELECT count(DISTINCT m.id) FROM migration_analysis a JOIN migration_record m ON m.id=a.record_id JOIN historical_reported_result r ON r.record_id=m.id WHERE a.run_label=h.run_label AND a.sheet='result')::int,
    false,false
  FROM migration_historical_run h
 ) SELECT * FROM combined WHERE ($1::text='' OR strpos(lower(run_label),$1)>0)`;
 const total=Number((await db.query<{n:string}>(`SELECT count(*)::text n FROM (${base}) filtered`,[q])).rows[0]?.n??0);
 const totalPages=Math.max(1,Math.ceil(total/size));
 const number=Math.min(pageRequested,totalPages);
 const offset=(number-1)*size;
 type Unified={run_label:string;run_year:number;run_number:number;id:string|null;source:'CURRENT'|'HISTORICAL';state:string;created_at:Date|null;samples:number;sheet_states:string[];controls:number;technical_repeats:number;with_pdf:number;pooling_recorded:boolean;seq_files_exported:boolean};
 const rows=(await db.query<Unified>(`${base} ORDER BY run_year DESC,run_number DESC,CASE source WHEN 'CURRENT' THEN 0 ELSE 1 END,run_label DESC LIMIT $2 OFFSET $3`,[q,size,offset])).rows;
 return {rows,page:{number,size,total,totalPages}};
}
