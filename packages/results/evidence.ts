import type {Queryable} from '../db/connection';
import {LabError} from '../lab/core';
import {operationalWorkflow} from '../lab/operational';
import {qc4Evidence,handoffVerified} from '../sequencing/service';
import {storedPool} from '../sequencing/service';

export type AttemptEvidence={current:boolean;reason:string|null;analysisAccepted:boolean;finalQcAccepted:boolean;poolId:string|null;dnbId:string|null;sequencingId:string|null};
/** Structural currentness only. Synthetic evidence never confers clinical acceptance.
 * Caller supplies the persisted report's exact attempt, never a patient/round substitute.
 * This read does not implement a clinical mutation adapter or its concurrency protocol.
 */
export async function attemptEvidence(db:Queryable,attemptId:string):Promise<AttemptEvidence>{
 const result:AttemptEvidence={current:false,reason:null,analysisAccepted:false,finalQcAccepted:false,poolId:null,dnbId:null,sequencingId:null};
 const fail=(reason:string)=>({...result,reason});
 const slots=(await db.query<{batch_id:string;slot_number:number;state:string}>(`SELECT s.batch_id,s.slot_number,b.state FROM lab_slot_assignment s JOIN lab_batch b ON b.id=s.batch_id
  WHERE s.attempt_id=$1 AND s.removed_at IS NULL`,[attemptId])).rows;
 // No upstream pipeline yet: the existing state/QC1 predicates explain this absence.
 if(slots.length===0)return result;
 if(slots.length!==1)return fail('UPSTREAM_SLOT_AMBIGUOUS');
 const slot=slots[0];if(slot.state==='Cancelled')return fail('BATCH_CANCELLED');
 const pool=(await db.query<{id:string;member:boolean}>(`SELECT p.id,EXISTS(SELECT 1 FROM jsonb_array_elements(p.payload->'members') m
  WHERE m->>'attemptId'=$2 AND m->>'slot'=$3) member FROM p4b_pool_attempt p WHERE p.batch_id=$1 ORDER BY p.attempt_number DESC LIMIT 1`,[slot.batch_id,attemptId,String(slot.slot_number)])).rows[0];
 if(!pool)return result;
 result.poolId=pool.id;
 if(!pool.member)return fail('UPSTREAM_POOL_MEMBER_STALE');
 const pe=(await db.query<{event_type:string}>('SELECT event_type FROM p4b_pool_event WHERE pool_id=$1',[pool.id])).rows.map(e=>e.event_type);
 const recalledPool=(await db.query(`SELECT 1 FROM p4b_document_copy c JOIN p4b_document doc ON doc.id=c.document_id
  JOIN p4b_pool_event e ON e.pool_id=doc.pool_id AND e.event_type='RECALL' AND e.payload->>'copyId'=c.id::text
  WHERE doc.pool_id=$1 AND c.kind='WORKING_COPY' LIMIT 1`,[pool.id])).rows.length>0;
 if(recalledPool)return fail('UPSTREAM_POOL_RECALLED');
 if(pe.some(e=>['STOP_USE','HOLD','SUPERSEDED'].includes(e))&&(await db.query(`SELECT 1 FROM p4b_document_copy c JOIN p4b_document doc ON doc.id=c.document_id WHERE doc.pool_id=$1 AND c.kind='WORKING_COPY'
  AND NOT EXISTS(SELECT 1 FROM p4b_pool_event e WHERE e.pool_id=$1 AND e.event_type='RECALL' AND e.payload->>'copyId'=c.id::text) LIMIT 1`,[pool.id])).rows.length)return fail('UPSTREAM_POOL_RECALL_PENDING');
 if(pe.includes('STOP_USE'))return fail('UPSTREAM_POOL_STOP_USE');
 if(pe.some(e=>['HOLD','SUPERSEDED'].includes(e)))return fail('UPSTREAM_POOL_INACTIVE');
 const snapshot=(await db.query<{id:string}>('SELECT id FROM p4b_pool_snapshot WHERE pool_id=$1 ORDER BY revision DESC LIMIT 1',[pool.id])).rows[0];
 if(!snapshot)return fail('UPSTREAM_POOL_INCOMPLETE');
 try{await storedPool(db,slot.batch_id,snapshot.id);}catch(e){
  // Expected domain failures remain visible; infrastructure/programming errors propagate.
  if(e instanceof LabError&&['POOL_SNAPSHOT_HASH_MISMATCH','POOL_STOP_USE','PLACEMENT_OR_MEMBERS_CHANGED','SOURCE_INVALID','POOL_RECALLED','COMPLETED_HOLD_POOL_REQUIRED'].includes(e.code))return fail('UPSTREAM_POOL_SOURCE_CHANGED');
  throw e;
 }
 const dnb=(await db.query<{id:string;pool_snapshot_id:string;source_sha256:string;snapshot_hash:string}>(`SELECT d.id,d.pool_snapshot_id,d.source_sha256,s.sha256 snapshot_hash FROM p4c_dnb_attempt d
  JOIN p4b_pool_snapshot s ON s.id=d.pool_snapshot_id WHERE d.batch_id=$1 ORDER BY d.attempt_number DESC LIMIT 1`,[slot.batch_id])).rows[0];
 if(!dnb)return fail('UPSTREAM_DNB_MISSING');
 result.dnbId=dnb.id;
 if(dnb.pool_snapshot_id!==snapshot.id||dnb.source_sha256!==dnb.snapshot_hash)return fail('UPSTREAM_DNB_STALE');
 const de=(await db.query<{event_type:string;payload:Record<string,unknown>}>('SELECT event_type,payload FROM p4c_dnb_event WHERE dnb_id=$1',[dnb.id])).rows;
 if((await db.query(`SELECT 1 FROM p4c_document_copy c JOIN p4c_document doc ON doc.id=c.document_id
  JOIN p4c_dnb_event e ON e.dnb_id=doc.dnb_id AND e.event_type='RECALL' AND e.payload->>'copyId'=c.id::text
  WHERE doc.dnb_id=$1 AND c.kind='WORKING_COPY' LIMIT 1`,[dnb.id])).rows.length)return fail('UPSTREAM_DNB_RECALLED');
 if(de.some(e=>['STOP_USE','HOLD','SUPERSEDED'].includes(e.event_type))&&(await db.query(`SELECT 1 FROM p4c_document_copy c JOIN p4c_document doc ON doc.id=c.document_id WHERE doc.dnb_id=$1 AND c.kind='WORKING_COPY'
  AND NOT EXISTS(SELECT 1 FROM p4c_dnb_event e WHERE e.dnb_id=$1 AND e.event_type='RECALL' AND e.payload->>'copyId'=c.id::text) LIMIT 1`,[dnb.id])).rows.length)return fail('UPSTREAM_DNB_RECALL_PENDING');
 if(de.some(e=>e.event_type==='STOP_USE'))return fail('UPSTREAM_DNB_STOP_USE');
 if(de.some(e=>['HOLD','SUPERSEDED'].includes(e.event_type)))return fail('UPSTREAM_DNB_INACTIVE');
 const sequence=(await db.query<{id:string}>('SELECT id FROM p4c_sequencing_attempt WHERE dnb_id=$1 ORDER BY attempt_number DESC LIMIT 1',[dnb.id])).rows[0];
 if(!sequence)return fail('UPSTREAM_SEQUENCE_MISSING');
 result.sequencingId=sequence.id;
 if(de.some(e=>e.event_type==='SEQUENCE_HOLD'&&e.payload.sequencingId===sequence.id))return fail('UPSTREAM_SEQUENCE_HOLD');
 if(await operationalWorkflow(db)){
  const analysisAccepted=de.some(e=>e.event_type==='ANALYSIS_COMPLETE'&&e.payload.sequencingId===sequence.id)&&await handoffVerified(db,dnb.id)&&(await qc4Evidence(db,dnb.id,sequence.id)).ready;
  const qc5=(await db.query<{ok:boolean}>(`SELECT EXISTS(SELECT 1 FROM result_qc5_review q JOIN result_report_version v ON v.id=q.version_id WHERE q.attempt_id=$1 AND q.sequencing_id=$2 AND v.attempt_id=$1 AND v.state IN ('Linked','ValidationBlocked','PendingCertification','CertifiedReleased') AND NOT EXISTS(SELECT 1 FROM result_report_version newer WHERE newer.round_id=v.round_id AND newer.kind=v.kind AND newer.imported_at>v.imported_at AND newer.state IN ('Linked','ValidationBlocked','PendingCertification','CertifiedReleased'))) ok`,[attemptId,sequence.id])).rows[0]?.ok===true;
  return {...result,current:true,analysisAccepted,finalQcAccepted:analysisAccepted&&qc5};
 }
 return {...result,current:true};
}
