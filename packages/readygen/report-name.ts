import type {Queryable} from '../db/connection';
import {SETTINGS} from '../settings/catalog';
import {readActiveSettings} from '../settings/service';
import type {Parsed} from '../results/parser';
import {renderDownloadName,reportRunToken,DEFAULT_DOWNLOAD_TEMPLATE,type FilenameValues} from './filename';

/** Follow only the report's matched attempt. Unrelated/latest runs and wall-clock dates are never fallbacks. */
export async function attemptRunToken(db:Queryable,attemptId:string){
 const runs=(await db.query<{run_number:number;run_year:number}>(`SELECT DISTINCT run_number,run_year FROM (
  SELECT b.run_number,b.run_year FROM lab_slot_assignment s JOIN lab_batch b ON b.id=s.batch_id WHERE s.attempt_id=$1 AND s.removed_at IS NULL
  UNION ALL SELECT h.run_number,h.run_year FROM migration_analysis a JOIN migration_historical_run h ON h.run_label=a.run_label
   JOIN migration_source ms ON ms.id=a.source_id AND ms.sha256=h.source_sha256 WHERE a.attempt_id=$1
 ) source_runs`,[attemptId])).rows;
 if(runs.length!==1)throw Error(runs.length?'REPORT_RUN_AMBIGUOUS':'REPORT_RUN_REQUIRED');
 return reportRunToken(runs[0].run_number,runs[0].run_year);
}
export async function configuredReportName(db:Queryable,attemptId:string,values:FilenameValues,options:{historical?:boolean}={}){
 const active=await readActiveSettings(db),template=SETTINGS.report_output.schema.parse(active.report_output??SETTINGS.report_output.default).downloadNameTemplate||DEFAULT_DOWNLOAD_TEMPLATE;
 let run:string|undefined;
 if(template.includes('{run}'))try{run=await attemptRunToken(db,attemptId);}catch(error){
  // Old imported reports can predate run lineage. Keep them downloadable without inventing a run.
  if(!options.historical||!(error instanceof Error)||error.message!=='REPORT_RUN_REQUIRED')throw error;
  return renderDownloadName('{hn}_{hisLn}',values);
 }
 return renderDownloadName(template,{...values,run});
}
/** One PDF name for ANC/Lab download and CFS. Already reserved transfers and finalized internal reports retain their frozen name. */
export async function reportDownloadName(db:Queryable,versionId:string,options:{historical?:boolean}={}){
 const r=(await db.query<{attempt_id:string;ln:string;ln_halos:string|null;hn:string|null;parsed:Parsed;template_kind:string;created_at:Date;certified_at:Date|null;series:number|null;series_version:number|null;internal_name:string|null;internal_patient:string|null;internal_code:string|null;transfer_name:string|null}>(`SELECT v.attempt_id,l.ln,n.ln_halos,i.hn,v.parsed,v.template_kind,v.imported_at created_at,rel.certified_at,rel.series,v.series_version,
  ir.download_name internal_name,ir.bindings#>>'{values,patientName}' internal_patient,ir.template_code internal_code,
  (SELECT t.pdf_name FROM p6_transfer t WHERE t.report_version_id=v.id::text AND t.authority='CERTIFIED_RESULT' ORDER BY t.created_at DESC,t.id DESC LIMIT 1) transfer_name
  FROM result_report_version v JOIN specimen_round s ON s.id=v.round_id JOIN case_ln l ON l.id=s.case_ln_id
  LEFT JOIN specimen_lab_number n ON n.round_id=s.id LEFT JOIN p2_case_identity i ON i.case_id=v.case_id
  LEFT JOIN internal_report ir ON ir.version_id=v.id
  LEFT JOIN LATERAL (SELECT r.certified_at,(SELECT count(*)::int FROM result_release x WHERE x.round_id=r.round_id AND x.kind=r.kind AND x.certified_at<=r.certified_at) series
   FROM result_release r WHERE r.version_id=v.id ORDER BY r.certified_at DESC LIMIT 1) rel ON true WHERE v.id=$1`,[versionId])).rows[0];
 if(!r)throw Error('REPORT_NOT_FOUND');
 if(r.transfer_name||r.internal_name)return (r.transfer_name??r.internal_name)!;
 return configuredReportName(db,r.attempt_id,{hisLn:r.ln,hn:r.hn??'',lnHalos:r.ln_halos??'',sampleId:r.parsed.identifiers.labNumber.value??r.ln_halos??r.ln,
  patientName:r.internal_patient??r.parsed.identifiers.patientName.value??'',reportDate:!options.historical&&r.certified_at?bangkokDay(r.certified_at):r.parsed.identifiers.reportedDate?.value??bangkokDay(r.created_at),template:r.internal_code??r.template_kind,version:String(r.series??r.series_version??1)},options);
}
const bangkokDay=(date:Date|string)=>new Date(new Date(date).getTime()+7*3600000).toISOString().slice(0,10);
