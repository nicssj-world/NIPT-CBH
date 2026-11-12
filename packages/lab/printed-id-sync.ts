import type {Queryable} from '../db/connection';
import {attemptEvent,attemptFacts,candidatePrintedId,type Staff} from './core';

/**
 * Owner 2026-11-12: the Printed Sample ID is frozen when an attempt is placed into a batch, from the pregnancy type known at that moment.
 * A LAB-registered case often has no pregnancy type yet (defaults to Singleton); when the paper Request review or the deferred clinical
 * metadata later records Twins, the frozen ID would lack the "D" the tube label and the Halos file carry, and the result import would not match.
 * Called after every write that can change the pregnancy type of a round: it recomputes the ID for that round's attempts and updates it
 * while no Halos/NIFTY export has frozen the old text. Returns the attempts it changed and the ones it could not (already exported).
 */
export async function resyncPrintedSampleIds(db:Queryable,user:Staff,roundId:string){
 const changed:string[]=[],blocked:string[]=[];
 const rows=await attemptFacts(db,'a.round_id=$1 AND a.printed_sample_id IS NOT NULL',[roundId]);
 for(const r of rows){
  const next=candidatePrintedId({...r,printed_sample_id:null});
  if(next.status!=='YES'||!next.id||next.id===r.printed_sample_id)continue;
  // Only the Twin suffix may be added or removed; any other difference is lineage the sync must not rewrite.
  const strip=(s:string)=>s.replace(/D(?=R?-\d+$)/,'');
  if(strip(next.id)!==strip(r.printed_sample_id!))continue;
  const exported=(await db.query("SELECT 1 FROM lab_bench_export e CROSS JOIN LATERAL jsonb_array_elements(e.mapping) m WHERE m->>'attemptId'=$1 LIMIT 1",[r.attempt_id])).rows.length>0
   ||(await db.query("SELECT 1 FROM p4b_halos_export e CROSS JOIN LATERAL jsonb_array_elements(e.source->'members') m WHERE m->>'exportSampleId' IN ($1,$2) LIMIT 1",[r.printed_sample_id,next.id])).rows.length>0;
  if(exported){blocked.push(r.attempt_id);continue;}
  await db.query('UPDATE analytical_attempt SET printed_sample_id=$2 WHERE id=$1',[r.attempt_id,next.id]);
  await attemptEvent(db,user,{attemptId:r.attempt_id,caseId:r.case_id,type:'PRINTED_ID_ASSIGNED',details:{printedSampleId:next.id,previous:r.printed_sample_id,reason:'PREGNANCY_TYPE_CHANGED'}});
  await db.query('UPDATE lab_batch SET version=version+1 WHERE id=(SELECT batch_id FROM lab_slot_assignment WHERE attempt_id=$1 AND removed_at IS NULL)',[r.attempt_id]);
  changed.push(r.attempt_id);
 }
 return {changed,blocked};
}
