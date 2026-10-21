import type {Queryable} from '../db/connection';
import type {FileStore} from '../storage';
import {readPet} from './process';
import {redactPet} from './wire';
import {appendAudit} from '../db/audit';
/** Offline Development-only procedure; application/worker DB roles have no INSERT grant on correction lineage. */
export async function correctLegacyPetClocks(db:Queryable,deps:{store:Pick<FileStore,'get'>;lookupKey:Buffer},actorId:string,reason:string,apply=false){
 if(reason.trim().length<8||deps.lookupKey.length!==32)throw Error('PET_CORRECTION_REASON_AND_KEY_REQUIRED');
 const files=(await db.query<{id:string;sha256:string;filename:string;ln:string;parsed:unknown;round_id:string|null;case_id:string|null}>(`SELECT f.id,f.sha256,f.filename,f.ln,f.parsed,o.round_id,f.case_id FROM his_inbound_file f LEFT JOIN his_order o ON o.inbound_file_id=f.id WHERE f.parser_version='pet-strict-cp874-v1' AND f.parsed IS NOT NULL AND NOT EXISTS(SELECT 1 FROM lab_pet_clock_correction c WHERE c.inbound_file_id=f.id) ORDER BY f.id FOR UPDATE OF f`)).rows;
 const result=[];
 for(const file of files){
  // Every corrected timestamp is reparsed from the immutable hash-verified raw source, not reconstructed from old fields.
  const corrected=redactPet(await readPet(deps.store,file),deps.lookupKey);
  if(apply){
   const id=(await db.query<{id:string}>('INSERT INTO lab_pet_clock_correction(inbound_file_id,round_id,raw_sha256,previous_parsed,corrected_parsed,reason,actor_id) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id',[file.id,file.round_id,file.sha256,file.parsed,corrected,reason,actorId])).rows[0].id;
   if(file.case_id)await db.query("INSERT INTO case_event(case_id,event_type,details) VALUES($1,'PET_CLOCK_CORRECTED',$2)",[file.case_id,{correctionId:id,inboundFileId:file.id,roundId:file.round_id,rawSha256:file.sha256,issuedLabelsPreserved:true}]);
   await appendAudit(db,{actorId,action:'PET_CLOCK_CORRECTED',resourceType:'lab_pet_clock_correction',resourceId:id,details:{outcome:'APPEND_ONLY_OVERLAY',count:1}});
  }
  result.push({inboundFileId:file.id,roundId:file.round_id,rawSha256:file.sha256,applied:apply});
 }
 return result;
}
