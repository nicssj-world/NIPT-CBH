/** Read-only offline classification of the real migration inputs: the same pure planner the Dry Run uses (no database, HIS, allocator, PET or file writes).
 *    node --import tsx tools/migration/offline-plan-report.ts --mapping <genomic.xlsx> --halos <Run001.xlsx>=Run001/2026 --halos <Run002.xlsx>=Run002/2026 [--out <report.json>]
 *  Every mapping row is READY, EXCEPTION (imports, but a REVIEW_BEFORE_RELEASE item must be cleared first) or BLOCKED (the row cannot import). The report carries source row
 *  numbers, classifications and exception codes only: no LN, HN, name or any other patient identifier. Source files are only read. */
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import path from 'node:path';
import {buildMigrationPlan} from '../../packages/migration/planner';
const args=process.argv.slice(2),values=(flag:string)=>args.flatMap((a,i)=>a===flag&&args[i+1]?[args[i+1]]:[]);
const mapping=values('--mapping')[0],halos=values('--halos').map(v=>{const at=v.lastIndexOf('=');return {file:v.slice(0,at),runLabel:v.slice(at+1)};}),out=values('--out')[0];
if(!mapping||!existsSync(mapping))throw Error('MAPPING_REQUIRED (--mapping <file>)');
const read=(file:string)=>({name:path.basename(file),bytes:readFileSync(file)});
const plan=buildMigrationPlan({mapping:read(mapping),halos:halos.map(h=>({...read(h.file),runLabel:h.runLabel}))});
type Status='READY'|'EXCEPTION'|'BLOCKED';
const rows=plan.mappings.map(m=>{
 const blocking=m.exceptions.filter(e=>e.severity==='REVIEW_BEFORE_RELEASE'),warnings=m.exceptions.filter(e=>e.severity==='WARNING');
 const status:Status=!m.valid?'BLOCKED':blocking.length?'EXCEPTION':'READY';
 return {row:m.rowNumber,classification:m.classification,status,blockingCodes:[...new Set(blocking.map(e=>e.code))],warningCodes:[...new Set(warnings.map(e=>e.code))],analysisRows:m.analysisKeys.length,hisPdfExists:m.hisPdfExists};
});
const tally=<T extends string>(items:T[])=>items.reduce<Record<string,number>>((a,k)=>({...a,[k]:(a[k]??0)+1}),{});
const report={format:'NIPT_MIGRATION_OFFLINE_PLAN_REPORT_V1',readOnly:true,containsPatientIdentifiers:false,
 sources:plan.sources.map(s=>({kind:s.kind,sha256:s.sha256,byteLength:s.byteLength,runLabel:s.runLabel??null})),counts:plan.counts,
 byStatus:tally(rows.map(r=>r.status)),byClassification:tally(rows.map(r=>r.classification)),byStatusAndClassification:tally(rows.map(r=>r.status+'/'+r.classification)),
 withWarnings:rows.filter(r=>r.warningCodes.length).map(r=>({row:r.row,classification:r.classification,warningCodes:r.warningCodes})),
 exceptions:plan.exceptions.map(e=>({code:e.code,severity:e.severity,sheet:e.sheet??null,row:e.rowNumber??null})),
 runs:plan.runs.map(r=>({runLabel:r.runLabel,counts:r.counts})),
 // Gates the offline plan cannot decide: they are enforced at Execute time against the actual installation.
 notAssessedOffline:['PET binding and sending-unit mapping per case (needs the PET folder/archive)','LN Halos allocator handover (needs the Genomic-CBH read-only watermark)','backup evidence and administrator Execute authority'],
 allocator:plan.watermark,rows};
if(out)writeFileSync(out,JSON.stringify(report,null,2));
process.stdout.write(JSON.stringify({counts:report.counts,byStatus:report.byStatus,byClassification:report.byClassification,withWarnings:report.withWarnings,allocator:{readyForHandover:plan.watermark.readyForHandover,reasons:plan.watermark.reasons}})+'\n');
