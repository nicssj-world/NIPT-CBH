import type {Queryable} from '../db/connection';
import {appendAudit} from '../db/audit';
import {lockLn} from '../db/registration';
import {transactional} from '../inbound/tx';
import {assertSession,LabError,type Staff} from '../lab/core';
import {canonical,hash,type SourceInput} from './model';
import {buildMigrationPlan} from './planner';
import {excelAllocatorEvidence,pinAllocatorEvidence,registryPairsDigest} from './high-watermark';
import {migrationAdmin,verifiedMigrationBackup,type MigrationDeps} from './service';
import {previewLnHalosImport} from './ln-halos-import';

/** One transaction fences issuance while the source, mapping and monthly counter are committed. */
export async function commitLnHalosImport(db:Queryable,user:Staff,source:SourceInput,options:{sourceFrozen:boolean},deps:MigrationDeps){
 migrationAdmin(user);
 if(!options.sourceFrozen)throw new LabError('SOURCE_ALLOCATION_NOT_FROZEN',409);
 const backup=await (deps.verifyBackup??verifiedMigrationBackup)();
 const backupTime=backup.at?Date.parse(backup.at):NaN;
 if(!Number.isFinite(backupTime)||backupTime>Date.now()||Date.now()-backupTime>86400000)throw new LabError('VERIFIED_BACKUP_TOO_OLD_OR_UNDATED',409);
 const original=buildMigrationPlan({mapping:source,halos:[]});
 const sha=await deps.store.put(source.bytes);
 return transactional(db)(async d=>{
  await assertSession(d,user);
  for(const ln of [...new Set(original.mappings.filter(m=>/^[0-9]+$/.test(m.hisLn)).map(m=>m.hisLn))].sort())await lockLn(d,ln);
  await d.query('SELECT pg_advisory_xact_lock(75432872)');
  const preview=await previewLnHalosImport(d,source);
  if(preview.rows.length===0||preview.rows.some(r=>r.status==='INVALID'))throw new LabError('MAPPING_REVIEW_REQUIRED',409);
  const accepted=new Set(preview.rows.filter(r=>r.status==='NEW'||r.status==='EXISTING').map(r=>r.row));
  const mappings=original.mappings.filter(m=>accepted.has(m.rowNumber)).map(m=>({...m,valid:true,exceptions:[]}));
  const digest=hash(canonical({kind:'LN_HALOS_IMPORT_V1',source:sha,rows:mappings.map(m=>m.sourceKey)}));
  const plan={...original,mappings,registryPairsSha256:registryPairsDigest(mappings),digest,lnHalosImport:true,lnHalosHeld:preview.rows.filter(r=>r.status==='CONFLICT')};
  const prior=(await d.query<{id:string}>("SELECT e.id FROM migration_execution e WHERE e.plan_digest=$1 AND e.plan->>'lnHalosImport'='true' AND e.state='COMPLETED' AND EXISTS(SELECT 1 FROM migration_allocator_handover h WHERE h.execution_id=e.id)",[digest])).rows[0];
  if(prior){
   await d.query(`INSERT INTO migration_record_event(record_id,actor_id,event,details)
    SELECT r.id,$2,'PET_MATCH_AUTHORIZED',jsonb_build_object('executionId',$1::uuid::text) FROM migration_execution_record x
    JOIN migration_record r ON r.id=x.record_id WHERE x.execution_id=$1::uuid AND r.state='IMPORTED' AND r.case_id IS NULL`,[prior.id,user.id]);
   await appendAudit(d,{actorId:user.id,action:'MIGRATION_EXECUTION_RESUME_REQUESTED',resourceType:'migration_execution',resourceId:prior.id,details:{outcome:'MATCH_AUTHORIZED'}});
   return {executionId:prior.id,imported:0,replayed:true,held:preview.rows.filter(r=>r.status==='CONFLICT').length};
  }
  await d.query("INSERT INTO file_asset(sha256,byte_size,media_type,storage_key) VALUES($1,$2,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',$3) ON CONFLICT(sha256) DO NOTHING",[sha,source.bytes.length,`sha256/${sha.slice(0,2)}/${sha.slice(2,4)}/${sha}`]);
  const execution=(await d.query<{id:string}>("INSERT INTO migration_execution(plan_digest,plan,created_by,backup_evidence,state) VALUES($1,$2,$3,$4,'COMPLETED') RETURNING id",[plan.digest,JSON.stringify(plan),user.id,JSON.stringify(backup)])).rows[0];
  await d.query("INSERT INTO migration_source(execution_id,kind,sha256,original_name) VALUES($1,'GENOMIC_MAPPING',$2,$3)",[execution.id,sha,source.name]);
  let imported=0;
  for(const m of plan.mappings){
   const old=(await d.query<{id:string}>("SELECT id FROM migration_record WHERE state<>'EXCEPTION' AND ln=$1 AND ln_halos=$2 FOR UPDATE",[m.hisLn,m.halosId])).rows[0];
   const record=old??(await d.query<{id:string}>("INSERT INTO migration_record(execution_id,source_key,row_number,ln,ln_halos,classification,state) VALUES($1,$2,$3,$4,$5,'NO_HALOS','IMPORTED') RETURNING id",[execution.id,m.sourceKey,m.rowNumber,m.hisLn,m.halosId])).rows[0];
   if(!old)imported++;
   await d.query('INSERT INTO migration_execution_record(execution_id,record_id,source_key,row_number) VALUES($1,$2,$3,$4)',[execution.id,record.id,m.sourceKey,m.rowNumber]);
   await d.query("INSERT INTO migration_record_event(record_id,actor_id,event,details) VALUES($1,$2,$3,$4)",[record.id,user.id,old?'SOURCE_REUSED':'SOURCE_IMPORTED',JSON.stringify({executionId:execution.id})]);
  }
  const now=(await d.query<{at:Date}>('SELECT clock_timestamp() at')).rows[0].at;
  const evidence=pinAllocatorEvidence({...excelAllocatorEvidence(plan.mappings,sha,{sourceIdentity:'owner-confirmed-excel-mapping',capturedAt:new Date(now).toISOString()}),months:preview.months});
  await d.query('SELECT migration_apply_allocator_handover($1,$2,$3)',[execution.id,user.id,JSON.stringify(evidence)]);
  await appendAudit(d,{actorId:user.id,action:'MIGRATION_EXECUTION_STARTED',resourceType:'migration_execution',resourceId:execution.id,details:{count:plan.mappings.length}});
  await appendAudit(d,{actorId:user.id,action:'MIGRATION_ALLOCATOR_HANDOVER',resourceType:'migration_execution',resourceId:execution.id,details:{outcome:'HANDOVER_APPLIED',count:evidence.months.length}});
  return {executionId:execution.id,imported,replayed:false,held:preview.rows.filter(r=>r.status==='CONFLICT').length};
 });
}
