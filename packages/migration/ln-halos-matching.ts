import type {Queryable} from '../db/connection';
import type {Staff} from '../lab/core';
import type {FileStore} from '../storage';
import {parsePet} from '../integrations/pet';
import {errorCode} from '../inbound/tx';
import {bindMigrationPet} from './pet-enrichment';
import {migrationAdmin} from './service';

/** Uses only PET bytes already held in the application store, never the HIS share. */
export async function matchStoredImportPets(db:Queryable,user:Staff,executionId:string,store:FileStore,key:Buffer){
 migrationAdmin(user);
 const rows=(await db.query<{id:string;ln:string}>(`SELECT r.id,r.ln FROM migration_execution_record x
  JOIN migration_record r ON r.id=x.record_id WHERE x.execution_id=$1 AND r.state='IMPORTED'
  AND r.classification='NO_HALOS' AND r.case_id IS NULL ORDER BY x.row_number`,[executionId])).rows;
 let matched=0,pending=0;const issues:{recordId:string;ln:string;code:string}[]=[];
 const warn=async(r:{id:string;ln:string},code:string)=>{
  issues.push({recordId:r.id,ln:r.ln,code});
  const latest=(await db.query<{event:string;code:string|null}>("SELECT event,details->>'code' code FROM migration_record_event WHERE record_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1",[r.id])).rows[0];
  if(latest?.event!=='PET_MATCH_WARNING'||latest.code!==code)await db.query("INSERT INTO migration_record_event(record_id,actor_id,event,details) VALUES($1,$2,'PET_MATCH_WARNING',$3)",[r.id,user.id,JSON.stringify({code})]);
 };
 for(const r of rows){
  const files=(await db.query<{id:string;sha256:string;filename:string}>(`SELECT f.id,f.sha256,f.filename FROM his_inbound_file f
   WHERE f.ln=$1 AND f.state IN ('Ready','Unlinked') AND NOT EXISTS(SELECT 1 FROM his_intake_issue i
    WHERE i.inbound_file_id=f.id AND i.state IN ('Open','Proposed') AND (i.kind<>'UNLINKED' OR i.state<>'Open')) ORDER BY f.id`,[r.ln])).rows;
  if(files.length!==1){pending++;if(files.length>1)await warn(r,'MULTIPLE_PET_REVIEW_REQUIRED');continue;}
  try{
   const f=files[0],bytes=await store.get(f.sha256),pet=parsePet(bytes,f.filename);
   if(pet.hash!==f.sha256||pet.ln!==r.ln)throw Error('UNVERIFIED_PET');
   const result=await bindMigrationPet(db,user,r.id,{sourceName:'STORED_HIS_PET',relativePath:f.filename,sha256:f.sha256,byteLength:bytes.length,bytes,pet},store,key,{}, {storedOnly:true});
   if(result.outcome==='BOUND'||result.outcome==='ALREADY_BOUND')matched++;else pending++;
  }catch(e){pending++;await warn(r,errorCode(e));}
 }
 return {matched,pending,issues};
}

/** Called by the application reconciliation loop; uses only explicitly confirmed mapping imports. */
export async function reconcilePendingLnImports(db:Queryable,store:FileStore,key:Buffer){
 const executions=(await db.query<{id:string;created_by:string}>(`SELECT e.id,e.created_by FROM migration_execution e
  WHERE e.state='COMPLETED' AND e.plan->>'lnHalosImport'='true'
  AND EXISTS(SELECT 1 FROM migration_execution_record x JOIN migration_record r ON r.id=x.record_id JOIN his_inbound_file f ON f.ln=r.ln AND f.state IN ('Ready','Unlinked') WHERE x.execution_id=e.id AND r.state='IMPORTED' AND r.classification='NO_HALOS' AND r.case_id IS NULL)
  ORDER BY e.created_at`)).rows;
 let matched=0,pending=0,issues=0;
 for(const e of executions){
  const auth=(await db.query<{actor_id:string}>("SELECT actor_id FROM migration_record_event WHERE event='PET_MATCH_AUTHORIZED' AND details->>'executionId'=$1 AND actor_id IS NOT NULL ORDER BY created_at DESC,id DESC LIMIT 1",[e.id])).rows[0]?.actor_id??e.created_by;
  const active=(await db.query<{ok:boolean}>("SELECT EXISTS(SELECT 1 FROM app_user u JOIN role_assignment a ON a.user_id=u.id WHERE u.id=$1 AND u.enabled AND a.role='APP_ADMIN' AND a.effective_from<=now() AND (a.expires_at IS NULL OR a.expires_at>now())) ok",[auth])).rows[0].ok;
  if(!active){
   const rows=(await db.query<{id:string}>("SELECT r.id FROM migration_execution_record x JOIN migration_record r ON r.id=x.record_id WHERE x.execution_id=$1 AND r.state='IMPORTED' AND r.case_id IS NULL",[e.id])).rows;
   for(const r of rows){const last=(await db.query<{event:string;code:string|null}>("SELECT event,details->>'code' code FROM migration_record_event WHERE record_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1",[r.id])).rows[0];if(last?.event!=='PET_MATCH_WARNING'||last.code!=='IMPORT_AUTHORITY_INACTIVE')await db.query("INSERT INTO migration_record_event(record_id,event,details) VALUES($1,'PET_MATCH_WARNING',$2)",[r.id,JSON.stringify({code:'IMPORT_AUTHORITY_INACTIVE'})]);}
   pending+=rows.length;issues+=rows.length;continue;
  }
  const result=await matchStoredImportPets(db,{id:auth,roles:['APP_ADMIN'],unitIds:[],permissions:[]},e.id,store,key);matched+=result.matched;pending+=result.pending;issues+=result.issues.length;
 }
 return {matched,pending,issues};
}
