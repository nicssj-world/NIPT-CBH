import {readHalosWorkbook,type HalosRow} from '../readygen/halos-adapter';
import {interpretRow} from '../readygen/interpretation';
import {resolveMigrationIdentity} from './lineage';
import {hash,sourceEvidence,type SourceInput,type MigrationMapping,type MigrationAnalysis,type MigrationRun,type MigrationException} from './model';
const status=(r:HalosRow):MigrationAnalysis['adviceStatus']=>[r.values.operationAdvice,r.values.physicianAdvice].some(v=>/^rerun$/i.test(v?.trim()??''))?'RERUN':r.values.sampleQc?.trim()==='Pass'&&r.values.operationAdvice?.trim()==='Qualified'&&r.values.physicianAdvice?.trim()==='Qualified'?'QUALIFIED':'REVIEW';
export function ingestHalos(source:SourceInput&{runLabel:string},mappings:MigrationMapping[],prior:MigrationAnalysis[]){
 const evidence=sourceEvidence('HALOS_RUN',source,source.runLabel),workbook=readHalosWorkbook(source.bytes),exceptions:MigrationException[]=[],analyses:MigrationAnalysis[]=[];
 const info=workbook.rows.filter(r=>r.sheet==='sampleinfo'),infoIds=info.map(r=>r.sampleKey),valid=mappings.filter(r=>r.valid);
 const add=(code:string,r:HalosRow,severity:MigrationException['severity']='REVIEW_BEFORE_RELEASE')=>exceptions.push({code,severity,sourceSha256:evidence.sha256,sheet:r.sheet,rowNumber:r.rowNumber});
 for(const r of workbook.rows.filter(r=>r.sheet!=='sampleinfo')){
  const resolved=resolveMigrationIdentity(r.sampleKey,valid.map(m=>m.halosId),infoIds);
  const terminal=/^(.+)-([1-9][0-9]?)$/.exec(r.sampleKey),infoKey=resolved.baseId??terminal?.[1]??r.sampleKey;
  const candidates=info.filter(i=>i.sampleKey===infoKey||i.sampleKey===r.sampleKey),i=candidates.length===1?candidates[0]:null;
  // Explicit vendor control designation only. A missing mapping or an N-prefixed ID is never enough.
  const control=!resolved.baseId&&!!i&&/^(?:NC|PC|positive control|negative control|control)$/i.test(i.raw['Patient Name']?.trim()??'');
  const match=resolved.baseId?valid.find(m=>m.halosId===resolved.baseId):undefined;
  const template=i?.values.fetusType?.trim()==='Singleton'?'SINGLETON':i?.values.fetusType?.trim()==='Twin'?'TWIN':null;
  const interpretation=match&&template?interpretRow(r,template):null;
  const origin=[...prior,...analyses].filter(a=>a.sampleKey===r.sampleKey&&a.values.chipId===r.values.chipId&&a.role==='ANALYSIS');
  let role:MigrationAnalysis['role']=control?'CONTROL':match?'ANALYSIS':'UNRESOLVED';
  if(r.sheet==='repeat'&&origin.length===1)role='TECHNICAL_REPEAT';
  if(r.invalid&&!control){role='UNRESOLVED';add(r.invalid,r);}
  if(!control&&!match)add('HALOS_IDENTITY_UNRESOLVED',r);
  if(match&&!i)add('SAMPLEINFO_IDENTITY_AMBIGUOUS_OR_MISSING',r);
  if(match&&!template)add('FETUS_TEMPLATE_UNKNOWN',r);
  if(interpretation?.status==='HOLD')add('HALOS_INTERPRETATION_REVIEW',r,'WARNING');
  if(r.sheet==='repeat'&&!control&&origin.length!==1)add('REPEAT_ORIGIN_UNRESOLVED',r);
  if(origin.length&&r.sheet==='result'){role='UNRESOLVED';add('DUPLICATE_ANALYSIS_IDENTITY',r);}
  analyses.push({key:hash(evidence.sha256+':'+r.sheet+':'+r.rowNumber),mappingRow:match?.rowNumber??null,runLabel:role==='TECHNICAL_REPEAT'?origin[0].runLabel:source.runLabel,sourceSha256:evidence.sha256,sheet:r.sheet as 'result'|'repeat',rowNumber:r.rowNumber,sampleRaw:r.sampleRaw,sampleKey:r.sampleKey,baseId:resolved.baseId,attemptOrdinal:resolved.attemptOrdinal,role,adviceStatus:status(r),values:r.values as Record<string,string>,raw:r.raw,sampleinfo:i?.raw??null,interpretation,previousKey:null,supersededBy:null,originAnalysisKey:role==='TECHNICAL_REPEAT'?origin[0].key:null});
  if(match)for(const e of exceptions.filter(e=>e.sheet===r.sheet&&e.rowNumber===r.rowNumber)){e.sourceKey=match.sourceKey;match.exceptions.push(e);}
 }
 const run:MigrationRun={runLabel:source.runLabel,sourceSha256:evidence.sha256,chipIds:workbook.chipIds,counts:{...workbook.counts,controls:analyses.filter(a=>a.role==='CONTROL').length,unresolved:analyses.filter(a=>a.role==='UNRESOLVED').length,qualified:analyses.filter(a=>a.role==='ANALYSIS'&&a.adviceStatus==='QUALIFIED').length,rerun:analyses.filter(a=>a.role==='ANALYSIS'&&a.adviceStatus==='RERUN').length,technicalRepeat:analyses.filter(a=>a.role==='TECHNICAL_REPEAT').length},sampleinfoRows:info.map(i=>({rowNumber:i.rowNumber,sampleRaw:i.sampleRaw,values:i.values as Record<string,string>,raw:i.raw}))};
 for(const issue of workbook.issues)exceptions.push({code:issue.code,severity:issue.severity==='WARNING'?'WARNING':'REVIEW_BEFORE_RELEASE',sourceSha256:evidence.sha256,sheet:issue.sheet,rowNumber:issue.row});
 return {source:evidence,analyses,run,exceptions};
}
/** Link genuine attempts only; repeated representations cannot supersede an actual result. */
export function linkMigrationAttempts(mappings:MigrationMapping[],analyses:MigrationAnalysis[],exceptions:MigrationException[]){
 for(const m of mappings){const rows=analyses.filter(a=>a.mappingRow===m.rowNumber&&a.role==='ANALYSIS').sort((a,b)=>(a.attemptOrdinal??0)-(b.attemptOrdinal??0)||a.runLabel.localeCompare(b.runLabel));m.analysisKeys=analyses.filter(a=>a.mappingRow===m.rowNumber).map(a=>a.key);const ordinals=rows.map(a=>a.attemptOrdinal);
 if(new Set(ordinals).size!==ordinals.length){const e:MigrationException={code:'ATTEMPT_ORDINAL_AMBIGUOUS',severity:'REVIEW_BEFORE_RELEASE',sourceKey:m.sourceKey,rowNumber:m.rowNumber};m.exceptions.push(e);exceptions.push(e);continue;}
 for(let n=1;n<rows.length;n++){rows[n].previousKey=rows[n-1].key;rows[n-1].supersededBy=rows[n].key;}
 const current=rows.at(-1);m.currentAnalysisKey=current?.key??null;m.classification=current?.adviceStatus==='QUALIFIED'?'QUALIFIED_PDF_PENDING':current?.adviceStatus==='RERUN'?'RERUN':'NO_HALOS';
 }
}


