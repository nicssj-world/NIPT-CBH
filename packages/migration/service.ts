import {readFile} from 'node:fs/promises';
import type {Queryable} from '../db/connection';
import {transactional,errorCode} from '../inbound/tx';
import {lockLn} from '../db/registration';
import {appendAudit} from '../db/audit';
import {assertSession,LabError,type Staff} from '../lab/core';
import type {FileStore} from '../storage';
import {buildMigrationPlan,type MigrationPlanInput,type MigrationPlan} from './planner';
import {hash} from './model';
import {readOperationsStatus,databaseFingerprint} from '../../deploy/scripts/operations-status.mjs';

export type BackupEvidence={manifestSha256:string;verification:string;at?:string};
export type MigrationDeps={store:FileStore;verifyBackup?:()=>Promise<BackupEvidence>};
export type ExecutionOptions={planDigest:string;uncheckedAcknowledged:boolean;backupEvidence?:{sha256:string;manifestPath?:string};petSource?:{kind:'FOLDER'|'ZIP';path:string};wardMappings?:Record<string,string>};
export function migrationAdmin(user:Staff){if(!user.roles.includes('APP_ADMIN'))throw new LabError('FORBIDDEN',403);}
export async function verifiedMigrationBackup():Promise<BackupEvidence>{
 const e=process.env;if(!e.NIPT_OPERATIONS_STATUS_FILE||!e.NIPT_OPERATIONS_STATUS_PUBLIC_KEY_FILE||!e.DATABASE_URL)throw new LabError('VERIFIED_BACKUP_REQUIRED',409);
 const p=await readOperationsStatus(e.NIPT_OPERATIONS_STATUS_FILE,e.NIPT_OPERATIONS_STATUS_PUBLIC_KEY_FILE,databaseFingerprint(e.DATABASE_URL));
 if(!p.backup)throw new LabError('VERIFIED_BACKUP_REQUIRED',409);
 return {manifestSha256:p.backup.manifestSha256,verification:p.backup.verification,at:p.backup.at};
}
async function archive(db:Queryable,store:FileStore,bytes:Buffer,mediaType:string){
 const sha=await store.put(bytes);await db.query('INSERT INTO file_asset(sha256,byte_size,media_type,storage_key) VALUES($1,$2,$3,$4) ON CONFLICT(sha256) DO NOTHING',[sha,bytes.length,mediaType,`sha256/${sha.slice(0,2)}/${sha.slice(2,4)}/${sha}`]);return sha;
}
type ExecutionRow={id:string;plan:MigrationPlan;state:string;created_by:string;pet_source:ExecutionOptions['petSource']|null;ward_mappings:Record<string,string>};
export async function prepareMigrationExecution(db:Queryable,user:Staff,input:MigrationPlanInput,options:ExecutionOptions,deps:MigrationDeps){
 migrationAdmin(user);const plan=buildMigrationPlan(input);
 if(options.planDigest!==plan.digest)throw new LabError('MIGRATION_PLAN_CHANGED',409);
 if(plan.mappings.some(m=>!m.hisPdfExists)&&!options.uncheckedAcknowledged)throw new LabError('UNCHECKED_MEANING_ACK_REQUIRED',422);
 const backup=await (deps.verifyBackup??verifiedMigrationBackup)();
 if(options.backupEvidence&&backup.manifestSha256!==options.backupEvidence.sha256)throw new LabError('BACKUP_RECEIPT_CHANGED',409);
 const tx=transactional(db);
 const id=await tx(async d=>{
  await assertSession(d,user);await d.query('SELECT pg_advisory_xact_lock(hashtextextended($1,75432870))',[plan.digest]);
  await d.query('SELECT pg_advisory_xact_lock(75432872)'); // Same cutover lock as the normal allocator and explicit handover.
  const prior=(await d.query<{id:string}>('SELECT id FROM migration_execution WHERE plan_digest=$1',[plan.digest])).rows[0];if(prior)return prior.id;
  const row=(await d.query<{id:string}>('INSERT INTO migration_execution(plan_digest,plan,created_by,backup_evidence,watermark,pet_source,ward_mappings) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id',[plan.digest,JSON.stringify(plan),user.id,JSON.stringify(backup),JSON.stringify(input.watermark??null),JSON.stringify(options.petSource??null),JSON.stringify(options.wardMappings??{})])).rows[0];
  for(const s of plan.sources){const source=s.kind==='GENOMIC_MAPPING'?input.mapping:input.halos.find(h=>hash(h.bytes)===s.sha256);if(!source)throw Error('MIGRATION_SOURCE_MISSING');
   await archive(d,deps.store,source.bytes,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
   await d.query('INSERT INTO migration_source(execution_id,kind,sha256,original_name,run_label) VALUES($1,$2,$3,$4,$5) ON CONFLICT(execution_id,kind,sha256) DO NOTHING',[row.id,s.kind,s.sha256,s.name,s.runLabel??null]);
  }
  await appendAudit(d,{actorId:user.id,action:'MIGRATION_EXECUTION_STARTED',resourceType:'migration_execution',resourceId:row.id,details:{count:plan.mappings.length}});return row.id;
 });
 return readMigrationExecution(db,user,id);
}
/** Synchronous compatibility wrapper. Preparation itself performs no patient/run/analysis import. */
export async function executeMigration(db:Queryable,user:Staff,input:MigrationPlanInput,options:ExecutionOptions,deps:MigrationDeps){
 const prepared=await prepareMigrationExecution(db,user,input,options,deps);
 return resumeMigration(db,user,prepared.id,deps);
}
async function markMigrationRunning(db:Queryable,user:Staff,id:string,allowCancelled:boolean,auditRequest=false){
 migrationAdmin(user);return transactional(db)(async d=>{
  await assertSession(d,user);
  const row=(await d.query<{state:string}>('SELECT state FROM migration_execution WHERE id=$1 FOR UPDATE',[id])).rows[0];if(!row)throw new LabError('NOT_FOUND',404);
  if(row.state==='COMPLETED'||row.state==='CANCELLED'&&!allowCancelled)return false;
  if(row.state!=='RUNNING')await d.query("UPDATE migration_execution SET state='RUNNING',row_version=row_version+1 WHERE id=$1",[id]);
  if(auditRequest)await appendAudit(d,{actorId:user.id,action:'MIGRATION_EXECUTION_RESUME_REQUESTED',resourceType:'migration_execution',resourceId:id,details:{outcome:'RUNNING'}});
  return true;
 });
}
/** Explicit request commits intent now; a later cancellation still wins over the deferred default resume callback. */
export async function requestMigrationResume(db:Queryable,user:Staff,id:string){
 await markMigrationRunning(db,user,id,true,true);return readMigrationExecution(db,user,id);
}
type StoredRecord={id:string;ln:string;ln_halos:string;state:string;case_id:string|null;round_id:string|null;attempt_id:string|null};
const cancelled=async(db:Queryable,id:string)=>(await db.query<{state:string}>('SELECT state FROM migration_execution WHERE id=$1',[id])).rows[0]?.state==='CANCELLED';
async function linkExecutionRecord(db:Queryable,executionId:string,recordId:string,sourceKey:string,rowNumber:number){
 await db.query('INSERT INTO migration_execution_record(execution_id,record_id,source_key,row_number) VALUES($1,$2,$3,$4) ON CONFLICT(execution_id,source_key) DO NOTHING',[executionId,recordId,sourceKey,rowNumber]);
}
export async function resumeMigration(db:Queryable,user:Staff,id:string,deps:MigrationDeps,options:{resumeCancelled?:boolean}={}){
 migrationAdmin(user);const tx=transactional(db);
 const execution=(await db.query<ExecutionRow>('SELECT * FROM migration_execution WHERE id=$1',[id])).rows[0];if(!execution)throw new LabError('NOT_FOUND',404);
 if(!await markMigrationRunning(db,user,id,options.resumeCancelled===true,options.resumeCancelled===true))return readMigrationExecution(db,user,id);
 const plan=execution.plan,failedSources=new Map<string,string>();
 for(const run of plan.runs){
  if(await cancelled(db,id))return readMigrationExecution(db,user,id);
  try{await tx(async d=>{
   await assertSession(d,user);await d.query('SELECT pg_advisory_xact_lock(75432811)');const match=/^Run(\d+)\/(\d{4})$/.exec(run.runLabel);if(!match)throw Error('RUN_LABEL_INVALID');
   const prior=(await d.query<{source_sha256:string}>('SELECT source_sha256 FROM migration_historical_run WHERE run_label=$1',[run.runLabel])).rows[0];
   if(prior&&prior.source_sha256!==run.sourceSha256)throw Error('MIGRATION_RUN_CONFLICT');
   if(!prior)await d.query('INSERT INTO migration_historical_run(execution_id,run_year,run_number,run_label,source_sha256) VALUES($1,$2,$3,$4,$5)',[id,Number(match[2]),Number(match[1]),run.runLabel,run.sourceSha256]);
   await d.query('INSERT INTO lab_batch_sequence(run_year,last_value) VALUES($1,$2) ON CONFLICT(run_year) DO UPDATE SET last_value=greatest(lab_batch_sequence.last_value,excluded.last_value)',[Number(match[2]),Number(match[1])]);
  });}catch(e){failedSources.set(run.sourceSha256,errorCode(e));}
 }
 for(const mapping of plan.mappings){
  if(await cancelled(db,id))return readMigrationExecution(db,user,id);
  try{await tx(async d=>{
   await assertSession(d,user);await lockLn(d,mapping.hisLn);await d.query('SELECT pg_advisory_xact_lock(hashtextextended($1,75432871))',[mapping.halosId]);
   const linked=(await d.query<StoredRecord>('SELECT r.* FROM migration_execution_record x JOIN migration_record r ON r.id=x.record_id WHERE x.execution_id=$1 AND x.source_key=$2 FOR UPDATE OF r',[id,mapping.sourceKey])).rows[0];
   if(linked?.state==='IMPORTED')return;
   const prior=linked??(await d.query<StoredRecord>('SELECT * FROM migration_record WHERE execution_id=$1 AND source_key=$2 FOR UPDATE',[id,mapping.sourceKey])).rows[0];
   const reserved=(await d.query<StoredRecord>("SELECT * FROM migration_record WHERE (ln=$1 OR ln_halos=$2) AND state<>'EXCEPTION' ORDER BY id FOR UPDATE",[mapping.hisLn,mapping.halosId])).rows;
   if(reserved.some(r=>r.ln!==mapping.hisLn||r.ln_halos!==mapping.halosId))throw Error('MIGRATION_IDENTIFIER_CONFLICT');
   const reused=mapping.valid?reserved[0]:undefined;
   const analyses=plan.analyses.filter(a=>a.mappingRow===mapping.rowNumber);
   const runIssues=analyses.filter(a=>failedSources.has(a.sourceSha256)).map(a=>({code:failedSources.get(a.sourceSha256)!,severity:'REVIEW_BEFORE_RELEASE',sourceSha256:a.sourceSha256}));
   const exceptions=[...mapping.exceptions,...runIssues];
   const state=mapping.valid?'IMPORTED':'EXCEPTION';
   const record=reused??prior??(await d.query<StoredRecord>(`INSERT INTO migration_record(execution_id,source_key,ln,ln_halos,row_number,classification,his_pdf_exists,state,exceptions) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,[id,mapping.sourceKey,mapping.hisLn,mapping.halosId,mapping.rowNumber,mapping.classification,mapping.hisPdfExists,state,JSON.stringify(exceptions)])).rows[0];
   await linkExecutionRecord(d,id,record.id,mapping.sourceKey,mapping.rowNumber);
   if(prior&&!reused)await d.query('UPDATE migration_record SET state=$2,exceptions=$3 WHERE id=$1',[record.id,state,JSON.stringify(exceptions)]);
   if(reused&&runIssues.length)await d.query('UPDATE migration_record SET exceptions=exceptions||$2::jsonb,row_version=row_version+1 WHERE id=$1',[record.id,JSON.stringify(runIssues)]);
   let pendingBinding=false;
   for(const a of analyses){
    if(failedSources.has(a.sourceSha256))continue;
    if((await d.query('SELECT 1 FROM migration_analysis WHERE analysis_key=$1',[a.key])).rows.length)continue;
    const source=(await d.query<{id:string}>('SELECT id FROM migration_source WHERE execution_id=$1 AND sha256=$2',[id,a.sourceSha256])).rows[0];
    const oldAnalysis=reused&&(await d.query("SELECT 1 FROM migration_analysis WHERE record_id=$1 AND classification='ANALYSIS' LIMIT 1",[record.id])).rows.length>0;
    const mustBind=!!reused&&(!!record.case_id||!!oldAnalysis);if(mustBind&&a.role==='ANALYSIS')pendingBinding=true;
    await d.query(`INSERT INTO migration_analysis(record_id,source_id,analysis_key,sheet,row_number,run_label,chip_id,lane_id,barcode_id,sample_raw,attempt_number,classification,advice_status,raw,values,sampleinfo,interpretation,previous_key,superseded_by,is_current,origin_analysis_key)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) ON CONFLICT(analysis_key) DO NOTHING`,[record.id,source.id,a.key,a.sheet,a.rowNumber,a.runLabel,a.values.chipId??null,a.values.laneId??null,a.values.barcodeId??null,a.sampleRaw,a.attemptOrdinal,a.role,a.adviceStatus,JSON.stringify(a.raw),JSON.stringify(a.values),JSON.stringify(a.sampleinfo),JSON.stringify(a.interpretation),a.previousKey,a.supersededBy,!mustBind&&mapping.currentAnalysisKey===a.key,a.originAnalysisKey]);
   }
   if(pendingBinding){await d.query(`UPDATE migration_record SET exceptions=exceptions||jsonb_build_array(jsonb_build_object('code','PENDING_ANALYTICAL_BINDING','severity','REVIEW_BEFORE_RELEASE')),row_version=row_version+1 WHERE id=$1 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(exceptions) e WHERE e->>'code'='PENDING_ANALYTICAL_BINDING')`,[record.id]);}
   // A delta mapping alone never downgrades the current classification or clears a prior HIS declaration.
   await d.query("INSERT INTO migration_record_event(record_id,actor_id,event,details) VALUES($1,$2,$3,$4)",[record.id,user.id,pendingBinding?'PENDING_ANALYTICAL_BINDING':reused?'SOURCE_REUSED':'SOURCE_IMPORTED',{executionId:id,classification:reused?undefined:mapping.classification}]);
  });}catch(e){const code=errorCode(e);await tx(async d=>{
   if(await cancelled(d,id))return;
   const r=(await d.query<{id:string}>(`INSERT INTO migration_record(execution_id,source_key,ln,ln_halos,row_number,classification,state,exceptions) VALUES($1,$2,$3,$4,$5,$6,'EXCEPTION',$7) ON CONFLICT(execution_id,source_key) DO UPDATE SET state='EXCEPTION',exceptions=excluded.exceptions RETURNING id`,[id,mapping.sourceKey,mapping.hisLn,mapping.halosId,mapping.rowNumber,mapping.classification,JSON.stringify([{code,severity:'REVIEW_BEFORE_RELEASE'}])])).rows[0];
   await linkExecutionRecord(d,id,r.id,mapping.sourceKey,mapping.rowNumber);
  });}
 }
 if(await cancelled(db,id))return readMigrationExecution(db,user,id);
 // Controls, unmatched rows and sampleinfo retain provenance without creating cases; cancelled work writes none.
 await tx(async d=>{
  if(await cancelled(d,id))return;
  for(const a of plan.analyses.filter(a=>a.mappingRow===null&&!failedSources.has(a.sourceSha256))){
   const source=(await d.query<{id:string}>('SELECT id FROM migration_source WHERE execution_id=$1 AND sha256=$2',[id,a.sourceSha256])).rows[0];
   await d.query(`INSERT INTO migration_analysis(source_id,analysis_key,sheet,row_number,run_label,chip_id,lane_id,barcode_id,sample_raw,attempt_number,classification,advice_status,raw,values,origin_analysis_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) ON CONFLICT(analysis_key) DO NOTHING`,[source.id,a.key,a.sheet,a.rowNumber,a.runLabel,a.values.chipId??null,a.values.laneId??null,a.values.barcodeId??null,a.sampleRaw,a.attemptOrdinal,a.role,a.adviceStatus,JSON.stringify(a.raw),JSON.stringify(a.values),a.originAnalysisKey]);
  }
  for(const r of plan.runs.filter(r=>!failedSources.has(r.sourceSha256))){const source=(await d.query<{id:string}>('SELECT id FROM migration_source WHERE execution_id=$1 AND sha256=$2',[id,r.sourceSha256])).rows[0];for(const a of r.sampleinfoRows)await d.query(`INSERT INTO migration_analysis(source_id,analysis_key,sheet,row_number,run_label,sample_raw,classification,advice_status,raw,values) VALUES($1,$2,'sampleinfo',$3,$4,$5,'SAMPLEINFO','REVIEW',$6,$7) ON CONFLICT(analysis_key) DO NOTHING`,[source.id,`${r.sourceSha256}:sampleinfo:${a.rowNumber}`,a.rowNumber,r.runLabel,a.sampleRaw,JSON.stringify(a.raw),JSON.stringify(a.values)]);}
 });
 await tx(async d=>{
  const pending=(await d.query<{n:string}>("SELECT count(*)::text n FROM migration_execution_record x JOIN migration_record r ON r.id=x.record_id WHERE x.execution_id=$1 AND (r.state='EXCEPTION' OR EXISTS(SELECT 1 FROM jsonb_array_elements(r.exceptions) e WHERE e->>'severity'='REVIEW_BEFORE_RELEASE'))",[id])).rows[0];
  await d.query("UPDATE migration_execution SET state=CASE WHEN state='CANCELLED' THEN state ELSE $2 END,last_error=$3,row_version=row_version+1 WHERE id=$1",[id,Number(pending.n)||failedSources.size?'PARTIAL':'COMPLETED',failedSources.size?'MIGRATION_RUN_CONFLICT':null]);
 });
 void deps;return readMigrationExecution(db,user,id);
}
export async function readMigrationExecution(db:Queryable,user:Staff,id:string){
 migrationAdmin(user);const execution=(await db.query<ExecutionRow>('SELECT id,state,created_at,plan,pet_source,ward_mappings FROM migration_execution WHERE id=$1',[id])).rows[0];if(!execution)throw new LabError('NOT_FOUND',404);
 const records=(await db.query<{id:string;row_version:number;ln:string;ln_halos:string;classification:string;his_pdf_exists:boolean;state:string;exceptions:unknown}>(`SELECT r.id,x.source_key,r.ln,r.ln_halos,CASE
 WHEN EXISTS(SELECT 1 FROM result_release l JOIN result_report_version v ON v.id=l.version_id WHERE l.state='Active' AND l.kind='RESULT' AND v.state='CertifiedReleased' AND (v.case_id,v.round_id,v.attempt_id)=(r.case_id,r.round_id,r.attempt_id)) THEN 'CERTIFIED_RELEASED'
 WHEN EXISTS(SELECT 1 FROM result_report_version v WHERE v.kind='RESULT' AND v.state IN ('Linked','ValidationBlocked','PendingCertification') AND (v.case_id,v.round_id,v.attempt_id)=(r.case_id,r.round_id,r.attempt_id)) THEN 'PDF_REVIEW'
 ELSE r.classification END classification,r.his_pdf_exists,r.row_version,r.state,r.exceptions,r.case_id,r.round_id,r.attempt_id FROM (SELECT execution_id,record_id,source_key,row_number FROM migration_execution_record UNION ALL SELECT r.execution_id,r.id,r.source_key,r.row_number FROM migration_record r WHERE NOT EXISTS(SELECT 1 FROM migration_execution_record l WHERE l.execution_id=r.execution_id AND l.record_id=r.id)) x JOIN migration_record r ON r.id=x.record_id WHERE x.execution_id=$1 ORDER BY x.row_number`,[id])).rows;
 const actual=(await db.query<{analyses:number;runs:number}>(`SELECT
 (SELECT count(*)::int FROM migration_analysis a JOIN migration_source s ON s.id=a.source_id WHERE a.sheet IN ('result','repeat') AND (s.execution_id=$1 OR a.record_id=ANY($2::uuid[]))) analyses,
 (SELECT count(*)::int FROM migration_historical_run h WHERE h.execution_id=$1 OR EXISTS(SELECT 1 FROM migration_analysis a JOIN migration_source s ON s.id=a.source_id WHERE a.record_id=ANY($2::uuid[]) AND h.run_label=a.run_label AND h.source_sha256=s.sha256)) runs`,[id,records.map(r=>r.id)])).rows[0];
 const summary={...execution.plan.counts,mappingRows:execution.plan.mappings?.length??records.length,validMappings:records.filter(r=>r.state==='IMPORTED').length,analyses:actual.analyses,runs:actual.runs,noHalos:records.filter(r=>r.classification==='NO_HALOS').length,rerun:records.filter(r=>r.classification==='RERUN').length,qualifiedPdfPending:records.filter(r=>r.classification==='QUALIFIED_PDF_PENDING').length,pdfReview:records.filter(r=>r.classification==='PDF_REVIEW').length,certifiedReleased:records.filter(r=>r.classification==='CERTIFIED_RELEASED').length,hisPdfExists:records.filter(r=>r.his_pdf_exists).length,exceptions:records.reduce((n,r)=>n+(Array.isArray(r.exceptions)?r.exceptions.length:0),0)};
 const receipt=(await db.query<{id:string;evidence_sha256:string;evidence:{months:Array<{month:string;lastValue:number}>};applied_months:unknown;created_at:Date}>('SELECT id,evidence_sha256,evidence,applied_months,created_at FROM migration_allocator_handover WHERE execution_id=$1 ORDER BY created_at DESC LIMIT 1',[id])).rows[0];
 const allocatorHandover={...execution.plan.watermark,applied:!!receipt,...(receipt?{readyForHandover:true,reasons:[],id:receipt.id,evidenceSha256:receipt.evidence_sha256,authoritativeMonths:receipt.evidence.months,months:receipt.applied_months,appliedAt:receipt.created_at}:{} )};
 const progress={total:execution.plan.mappings?.length??records.length,processed:records.length,pending:Math.max(0,(execution.plan.mappings?.length??records.length)-records.length),imported:records.filter(r=>r.state==='IMPORTED').length,exceptions:records.filter(r=>r.state==='EXCEPTION').length};
 return {id:execution.id,state:execution.state,summary,progress,inputCounts:execution.plan.counts,exceptions:execution.plan.exceptions,allocatorHandover,wardMappings:execution.ward_mappings,records};
}
export async function cancelMigration(db:Queryable,user:Staff,id:string){migrationAdmin(user);await transactional(db)(async d=>{await assertSession(d,user);await d.query("UPDATE migration_execution SET state='CANCELLED',row_version=row_version+1 WHERE id=$1 AND state IN ('RUNNING','PARTIAL')",[id]);});return readMigrationExecution(db,user,id);}
export async function updateMigrationRecord(db:Queryable,user:Staff,id:string,input:{expectedRowVersion:number;hisPdfExists?:boolean;classification?:string;reason?:string}){
 migrationAdmin(user);return transactional(db)(async d=>{await assertSession(d,user);
 const row=(await d.query<{id:string;row_version:number;classification:string}>('SELECT * FROM migration_record WHERE id=$1 FOR UPDATE',[id])).rows[0];if(!row)throw new LabError('NOT_FOUND',404);if(row.row_version!==input.expectedRowVersion)throw new LabError('VERSION_CONFLICT',409);
 if(input.hisPdfExists===true&&!['QUALIFIED_PDF_PENDING','PDF_REVIEW','CERTIFIED_RELEASED'].includes(row.classification))throw new LabError('HIS_FLAG_RESULT_READY_REQUIRED',409);
 if(input.classification&&input.classification!==row.classification)throw new LabError('REPREVIEW_CLASSIFICATION_REQUIRED',409);
 await d.query('UPDATE migration_record SET his_pdf_exists=coalesce($2,his_pdf_exists),row_version=row_version+1 WHERE id=$1',[id,input.hisPdfExists??null]);
 await d.query("INSERT INTO migration_record_event(record_id,actor_id,event,details) VALUES($1,$2,'HIS_PRESENCE_CHANGED',$3)",[id,user.id,{hisPdfExists:input.hisPdfExists??null}]);return {id,rowVersion:row.row_version+1};
 });
}
export async function readStoredPlanSources(db:Queryable,store:FileStore,id:string){const rows=(await db.query<{kind:string;original_name:string;sha256:string;run_label:string|null}>('SELECT kind,original_name,sha256,run_label FROM migration_source WHERE execution_id=$1',[id])).rows;return Promise.all(rows.map(async s=>({...s,bytes:await store.get(s.sha256)})));}
export async function readPetSourceBytes(file:string){return readFile(file);}
