import type {Queryable} from '../db/connection';
import {assertSession,LabError,type Staff} from '../lab/core';
import {transactional} from '../inbound/tx';
import {appendAudit} from '../db/audit';
import {assessWatermark,type AllocatorEvidence} from './high-watermark';
import type {MigrationPlan} from './planner';
/** A dedicated admin handover, never part of migration execution, retry, or classification/HIS-checkbox edits. */
export async function applyAllocatorHandover(db:Queryable,user:Staff,executionId:string,evidence?:AllocatorEvidence){
 if(!user.roles.includes('APP_ADMIN'))throw new LabError('FORBIDDEN',403);
 return transactional(db)(async d=>{
  await assertSession(d,user);
  const execution=(await d.query<{plan:MigrationPlan;watermark:AllocatorEvidence|null}>('SELECT plan,watermark FROM migration_execution WHERE id=$1 FOR UPDATE',[executionId])).rows[0];
  if(!execution)throw new LabError('NOT_FOUND',404);
  const proof=evidence??execution.watermark??undefined;
  const now=(await d.query<{at:Date}>('SELECT clock_timestamp() at')).rows[0].at;
  const source=execution.plan.sources.find(s=>s.kind==='GENOMIC_MAPPING');
  const assessment=assessWatermark(proof,execution.plan.mappings,source?.sha256??'',{asOf:new Date(now).toISOString(),maxAgeMs:86400000});
  if(!assessment.readyForHandover)throw new LabError(assessment.reasons[0],409,{reasons:assessment.reasons});
  const result=(await d.query<{result:{id:string;months:Array<{month:string;lastValue:number}>;replayed:boolean}}>('SELECT migration_apply_allocator_handover($1,$2,$3) result',[executionId,user.id,JSON.stringify(proof)])).rows[0].result;
  if(!result.replayed)await appendAudit(d,{actorId:user.id,action:'MIGRATION_ALLOCATOR_HANDOVER',resourceType:'migration_execution',resourceId:executionId,details:{outcome:'HANDOVER_APPLIED',count:result.months.length}});
  return result;
 });
}
