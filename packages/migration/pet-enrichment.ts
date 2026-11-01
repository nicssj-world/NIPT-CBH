import {readFile} from 'node:fs/promises';
import type {Queryable} from '../db/connection';
import {registerCase,lockLn} from '../db/registration';
import {transactional,errorCode} from '../inbound/tx';
import {lnHnKey} from '../inbound/identity';
import {redactPet} from '../inbound/wire';
import {applyS1} from '../inbound/process';
import {PARSER_VERSION} from '../integrations/pet';
import type {FileStore} from '../storage';
import {readPetArchive,scanHistoricalPetFolder,reconcilePetCandidates,type PetCandidate} from './pet-source';
import {assertSession,type Staff} from '../lab/core';
import {migrationAdmin} from './service';

export async function bindMigrationPet(db:Queryable,user:Staff,recordId:string,c:PetCandidate,store:FileStore,key:Buffer,wardMappings:Record<string,string>={}){
 migrationAdmin(user);if(key.length!==32)throw Error('IDENTITY_LOOKUP_KEY_INVALID');
 return transactional(db)(async d=>{
  await assertSession(d,user);
  const r=(await d.query<{id:string;ln:string;ln_halos:string;case_id:string|null;round_id:string|null;classification:string}>('SELECT * FROM migration_record WHERE id=$1 FOR UPDATE',[recordId])).rows[0];if(!r||r.case_id)return {outcome:'ALREADY_BOUND'};
  if((await d.query<{state:string}>('SELECT x.state FROM migration_execution x JOIN migration_record r ON r.execution_id=x.id WHERE r.id=$1',[recordId])).rows[0]?.state==='CANCELLED')return {outcome:'CANCELLED'};
  if(r.ln!==c.pet.ln)throw Error('MIGRATION_PET_LN_MISMATCH');await lockLn(d,r.ln);
  if(r.ln_halos.slice(12).includes('R'))throw Error('MIGRATION_RESAMPLING_LINEAGE_REVIEW_REQUIRED');
  const units=(await d.query<{id:string;code:string}>('SELECT id,code FROM unit WHERE ($1::uuid IS NOT NULL AND id=$1) OR ($1::uuid IS NULL AND code=$2)',[wardMappings[c.pet.ward]??null,c.pet.ward])).rows;
  if(units.length!==1||!c.pet.ward)throw Error('MIGRATION_PET_WARD_UNMAPPED');const unit=units[0];
  const prior=(await d.query<{id:string;hn:string}>('SELECT c.id,i.hn FROM nipt_case c JOIN case_ln l ON l.case_id=c.id LEFT JOIN p2_case_identity i ON i.case_id=c.id WHERE l.ln=$1',[r.ln])).rows;
  if(prior.length)throw Error('MIGRATION_EXISTING_OPERATIONAL_CASE_REQUIRES_RECONCILIATION');
  const created=await registerCase(d,{ln:r.ln,identityKey:lnHnKey(r.ln,c.pet.hn,key),origin:'LAB_DIRECT',actorId:user.id,idempotencyKey:'migration_'+r.id});if(!created.caseId)throw Error('MIGRATION_PET_IDENTITY_CONFLICT');
  const caseId=created.caseId,round=(await d.query<{id:string;case_ln_id:string}>('SELECT id,case_ln_id FROM specimen_round WHERE case_id=$1 AND round_number=1',[caseId])).rows[0];
  await d.query('INSERT INTO case_unit_scope(case_id,unit_id) VALUES($1,$2)',[caseId,unit.id]);
  await d.query('INSERT INTO p2_case_identity(case_id,hn,synthetic) VALUES($1,$2,NOT nipt_operational_enabled())',[caseId,c.pet.hn]);
  await d.query('UPDATE migration_record SET case_id=$2,round_id=$3 WHERE id=$1',[r.id,caseId,round.id]);
  const base=/^(\d{2}B(\d{2})(\d{2})(\d{2})(\d{3}))(?:D?R?)(?:-[12])?$/.exec(r.ln_halos);if(!base)throw Error('MIGRATION_IDENTIFIER_LINEAGE_REVIEW_REQUIRED');
  // Reserve the original before applying PET, so its normal receipt trigger returns it unchanged.
  await d.query('SELECT migration_reserve_original_number($1,$2)',[r.id,user.id]);
  const sha=await store.put(c.bytes);
  await d.query("INSERT INTO file_asset(sha256,byte_size,media_type,storage_key) VALUES($1,$2,'application/octet-stream',$3) ON CONFLICT(sha256) DO NOTHING",[sha,c.bytes.length,`sha256/${sha.slice(0,2)}/${sha.slice(2,4)}/${sha}`]);
  const logicalPath=`inbound/${c.pet.receivedAt.slice(0,10).replaceAll('-','')}/${c.pet.filename}`;
  const file=(await d.query<{id:string}>("INSERT INTO his_inbound_file(sha256,state,filename,parsed,ln,source_path,path_version,byte_size,parser_version) VALUES($1,'Ready',$2,$3,$4,NULL,1,$5,$6) ON CONFLICT(sha256) DO UPDATE SET sha256=excluded.sha256 RETURNING id",[sha,c.pet.filename,JSON.stringify(redactPet(c.pet,key)),c.pet.ln,c.bytes.length,PARSER_VERSION])).rows[0];
  await d.query('INSERT INTO his_inbound_source(source_id,source_path,sha256,inbound_file_id,byte_size) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',['MIGRATION_ARCHIVE',logicalPath,sha,file.id,c.bytes.length]);
  await applyS1(d,{id:file.id},c.pet,{case_ln_id:round.case_ln_id,case_id:caseId,origin:'LAB_DIRECT'},'REGISTRATION',user.id);
  await d.query('INSERT INTO migration_pet_binding(record_id,inbound_file_id,source_sha256,ward,unit_id) VALUES($1,$2,$3,$4,$5)',[r.id,file.id,sha,c.pet.ward,unit.id]);
  const analyses=(await d.query<{id:string;sample_raw:string;attempt_number:number;is_current:boolean}>("SELECT * FROM migration_analysis WHERE record_id=$1 AND classification='ANALYSIS' ORDER BY attempt_number,id",[r.id])).rows;
  for(const a of analyses){
   const attempt:{id:string}=(await d.query<{id:string}>('INSERT INTO analytical_attempt(case_id,round_id,attempt_number,state,printed_sample_id,historical_source_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING id',[caseId,round.id,a.attempt_number,a.is_current?'Ready':'Superseded',a.sample_raw.trim(),a.id])).rows[0];
   await d.query('UPDATE migration_analysis SET attempt_id=$2 WHERE id=$1',[a.id,attempt.id]);if(a.is_current)await d.query('UPDATE migration_record SET attempt_id=$2 WHERE id=$1',[r.id,attempt.id]);
  }
  if(!analyses.length){const attempt=(await d.query<{id:string}>("INSERT INTO analytical_attempt(case_id,round_id,attempt_number,state) VALUES($1,$2,1,'Ready') RETURNING id",[caseId,round.id])).rows[0];await d.query('UPDATE migration_record SET attempt_id=$2 WHERE id=$1',[r.id,attempt.id]);}
  await d.query("INSERT INTO migration_record_event(record_id,actor_id,event,details) VALUES($1,$2,'PET_BOUND',$3)",[r.id,user.id,{sourceSha256:sha,sourceName:c.sourceName,relativePath:c.relativePath,ward:c.pet.ward,unitId:unit.id}]);return {outcome:'BOUND',caseId,roundId:round.id};
 });
}
export async function enrichMigrationPets(db:Queryable,user:Staff,id:string,store:FileStore,key:Buffer,wardMappings:Record<string,string>={}){
 migrationAdmin(user);const x=(await db.query<{pet_source:{kind:'FOLDER'|'ZIP';path:string}|null;ward_mappings?:Record<string,string>}>('SELECT * FROM migration_execution WHERE id=$1',[id])).rows[0];if(!x?.pet_source)return {matched:0,pending:0,issues:[{code:'PET_SOURCE_NOT_CONFIGURED'}]};
 wardMappings={...x.ward_mappings,...wardMappings};
 const scan=x.pet_source.kind==='ZIP'?readPetArchive(await readFile(x.pet_source.path),x.pet_source.path):await scanHistoricalPetFolder(x.pet_source.path);
 const reconciled=reconcilePetCandidates(scan.candidates);
 const candidates=new Map(reconciled.candidates.map(c=>[c.pet.ln,c]));let matched=0,pending=0;const issues=[...scan.issues,...reconciled.issues].map(i=>({code:i.code}));
 const rows=(await db.query<{id:string;ln:string}>("SELECT id,ln FROM migration_record WHERE execution_id=$1 AND state='IMPORTED' AND case_id IS NULL ORDER BY row_number",[id])).rows;
 for(const r of rows){if((await db.query<{state:string}>('SELECT state FROM migration_execution WHERE id=$1',[id])).rows[0]?.state==='CANCELLED')break;const c=candidates.get(r.ln);if(!c){pending++;continue;}try{const result=await bindMigrationPet(db,user,r.id,c,store,key,wardMappings);if(result.outcome==='CANCELLED')break;matched++;}catch(e){pending++;const code=errorCode(e);issues.push({code});await db.query("INSERT INTO migration_record_event(record_id,actor_id,event,details) VALUES($1,$2,'PET_ENRICHMENT_WARNING',$3)",[r.id,user.id,{code}]);}}
 return {matched,pending,issues};
}
