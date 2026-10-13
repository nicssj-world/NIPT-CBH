import type {Queryable} from '../db/connection';
import {verifyAuditChain} from '../db/audit';
import {need,type Staff} from '../lab/core';
import type {FileStore} from '../storage';
import {hashOf} from './hash';

type Finding={code:string;resourceId?:string};
/** Diagnostic only. No automatic GA backfill, rematching, eligibility change or clinical release. */
export async function inspectHistoricalIntegrity(db:Queryable,user:Staff,store:FileStore){
 need(user,'history.read','read');need(user,'audit.read','read');
 const issues:Finding[]=[];
 const counts=(await db.query<{state:string;count:number}>("SELECT state,count(*)::int count FROM historical_draft GROUP BY state ORDER BY state")).rows;
 const records=(await db.query<{id:string;valid:boolean}>(`SELECT h.id,
  (c.registration_origin='HISTORICAL' AND d.state='Promoted' AND d.promoted_case_id=h.case_id
   AND e.draft_id=d.id AND e.draft_version=d.version AND e.outcome='Submitted'
   AND v.draft_id=d.id AND v.draft_version=d.version AND v.result='CONFIRMED'
   AND NOT(v.verifier_id=ANY(d.contributor_ids))) valid
  FROM historical_record h JOIN nipt_case c ON c.id=h.case_id JOIN historical_draft d ON d.id=h.draft_id
  JOIN historical_eligibility_evaluation e ON e.id=h.evaluation_id JOIN historical_verification v ON v.id=h.verification_id`)).rows;
 for(const r of records)if(!r.valid)issues.push({code:'HISTORICAL_PROVENANCE_INVALID',resourceId:r.id});
 const forbidden=(await db.query<{id:string}>(`SELECT c.id FROM nipt_case c WHERE c.registration_origin='HISTORICAL' AND
  (EXISTS(SELECT 1 FROM specimen_round r WHERE r.case_id=c.id) OR EXISTS(SELECT 1 FROM his_order o JOIN case_ln l ON l.id=o.case_ln_id WHERE l.case_id=c.id)
   OR EXISTS(SELECT 1 FROM result_report_version v WHERE v.case_id=c.id) OR EXISTS(SELECT 1 FROM result_release r WHERE r.case_id=c.id))`)).rows;
 for(const r of forbidden)issues.push({code:'HISTORICAL_CLINICAL_LINEAGE_PROHIBITED',resourceId:r.id});
 const evaluations=(await db.query<{id:string;snapshot:unknown;hash:string}>("SELECT id,snapshot,hash FROM historical_eligibility_evaluation ORDER BY id")).rows;
 for(const e of evaluations)if(hashOf(e.snapshot)!==e.hash)issues.push({code:'HISTORICAL_EVALUATION_HASH_MISMATCH',resourceId:e.id});
 const revisions=(await db.query<{id:string;data:unknown;revision:unknown}>(`SELECT d.id,d.data,r.data revision FROM historical_draft d
  LEFT JOIN historical_draft_revision r ON r.draft_id=d.id AND r.version=d.version ORDER BY d.id`)).rows;
 for(const d of revisions)if(d.revision===null||hashOf(d.data)!==hashOf(d.revision))issues.push({code:'HISTORICAL_DRAFT_REVISION_MISMATCH',resourceId:d.id});
 const files=(await db.query<{id:string;sha256:string;byte_size:string}>("SELECT id,sha256,byte_size FROM historical_batch_file ORDER BY id")).rows;
 for(const f of files){
  try{const bytes=await store.get(f.sha256);if(BigInt(bytes.length)!==BigInt(f.byte_size))issues.push({code:'HISTORICAL_ORIGINAL_SIZE_MISMATCH',resourceId:f.id});}
  catch(e){const code=(e as NodeJS.ErrnoException).code;if(code==='ENOENT')issues.push({code:'HISTORICAL_ORIGINAL_MISSING',resourceId:f.id});
   else if(e instanceof Error&&['HASH_MISMATCH','INVALID_HASH','SYMLINK_PROHIBITED','UNSAFE_PATH'].includes(e.message))issues.push({code:'HISTORICAL_ORIGINAL_INTEGRITY_FAILED',resourceId:f.id});else throw e;}
 }
 const chain=(await db.query<{previous_hash:string;hash:string;payload:string}>("SELECT previous_hash,hash,payload FROM audit_chain ORDER BY sequence")).rows;
 const auditValid=verifyAuditChain(chain);if(!auditValid)issues.push({code:'AUDIT_CHAIN_INVALID'});
 // A policy change is a review obligation, not permission to rewrite promoted records (OD-27).
 const review=(await db.query<{count:number}>(`SELECT count(*)::int count FROM historical_record h JOIN historical_eligibility_evaluation e ON e.id=h.evaluation_id
  JOIN setting_active a ON a.setting_key='go_live_cutoff' JOIN settings_revision s ON s.id=a.revision_id WHERE e.cutoff_version IS DISTINCT FROM s.version`)).rows[0];
 return {format:'NIPT_P7_HISTORICAL_INTEGRITY_V1',readOnly:true,clinicalRepairAllowed:false,counts,checkedRecords:records.length,checkedEvaluations:evaluations.length,
  checkedFiles:files.length,auditValid,cutoffReviewRequired:review.count,issues};
}
