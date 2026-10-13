import {randomUUID} from 'node:crypto';
import type {Queryable} from '../../packages/db/connection';
import type {Principal} from '../../packages/security/policy';
import {bangkokToday} from '../../packages/lab/core';
import {f4Html} from '../../packages/pdf/f4';
import {f5Html} from '../../packages/pdf/f5';
import {issueF5} from '../../packages/sequencing/documents';
import type {DocDeps} from '../../packages/lab/records';
import * as pool from '../../packages/pooling/service';
import * as docs from '../../packages/pooling/documents';
import {POOL_SCENARIO,poolingFixture} from './pooling';
import {tx,version} from './lab';
/** Real restricted synthetic services, including actual F4 original and immutable HOLD snapshot. */
export async function completedPool(db:Queryable,u:{staff:Principal;certifier:Principal;approver:Principal;unit:string},deps:DocDeps,count=2,controls:'PATIENT_ONLY'|'PATIENT_PC_NC'='PATIENT_ONLY'){
 const scenario={...POOL_SCENARIO,controls,...(count>2?{desiredVolume:'8192'}:{})};
 const f=await poolingFixture(db,u,deps,count),created=await tx(db,async t=>pool.createPool(t,u.staff,{batchId:f.batchId,expectedVersion:await version(t,f.batchId),scenario,reason:'จำลอง Pool สำหรับ DNB'}));
 const poolId=created.id,call=async(fn:(t:Queryable,u:Principal,d:unknown)=>Promise<unknown>,extra:Record<string,unknown>={},actor=u.staff)=>tx(db,async t=>fn(t,actor,{batchId:f.batchId,poolId,expectedVersion:await version(t,f.batchId),...extra}));
 const row=(await db.query<pool.PoolRow>('SELECT * FROM p4b_pool_attempt WHERE id=$1',[poolId])).rows[0];
 await call(pool.crosscheck,{values:row.selected_slots.map(slot=>({slot,value:row.payload.calculation.rows.find(r=>r.slot===slot)!.planned!}))});
 const docDeps={store:deps.store,render:async(d:Parameters<typeof f4Html>[0])=>Buffer.from('%PDF-1.4\n'+f4Html(d))};
 const issue=async(kind:'PRE_WORK'|'COMPLETED')=>{await call((t,u,d)=>docs.issueSyntheticDocument(t,u,d,docDeps,true),{kind,purpose:'SYNTHETIC_SIMULATION'});await call((t,u,d)=>docs.issueSyntheticDocument(t,u,d,docDeps),{kind,purpose:'SYNTHETIC_SIMULATION'});};
 await issue('PRE_WORK');await call(pool.transition,{transition:'START',reason:'จำลอง เริ่ม Pool ของ DNB'});
 for(const m of row.payload.members)await call(pool.recordPoolObservation,{field:'TRANSFER',slot:m.slot,value:{checked:true},source:'DIRECT_ENTRY'});
 await call(pool.recordPoolObservation,{field:'BUFFER',value:{value:row.payload.calculation.plannedBuffer!,unit:'uL'},source:'DIRECT_ENTRY'});
 await call(pool.transition,{transition:'END',reason:'จำลอง จบ Pool ของ DNB'});
 for(const field of ['QC2','STD1','STD2'])await call(pool.recordPoolObservation,{field,value:{value:'3.3',unit:'ng/uL'},source:'DIRECT_ENTRY'});
 for(const o of await pool.observations(db,poolId))await call(pool.reviewPoolObservation,{observationId:o.id,result:'Confirmed',note:'จำลอง ตรวจสอบค่า Pool'},u.certifier);
 await call(pool.decideQc2,{decision:'SyntheticReviewed',criteriaVersion:pool.QC2_CRITERIA,reason:'จำลอง ตรวจสอบ QC2 Pool'},u.certifier);await issue('COMPLETED');
 const snapshot=(await db.query<{id:string}>('SELECT id FROM p4b_pool_snapshot WHERE pool_id=$1',[poolId])).rows[0];return {...f,poolId,poolSnapshotId:snapshot.id};
}
export const dnbInput=(batchId:string,poolSnapshotId:string,expectedVersion:number,operatorId:string)=>({batchId,poolSnapshotId,expectedVersion,requestId:randomUUID(),purpose:'SYNTHETIC_SIMULATION' as const,
 actualDate:bangkokToday(),preparation:{method:'UNRESOLVED_OD32_WC05' as const,operatorId,equipmentId:'SYNTHETIC-DNB-EQUIPMENT',lots:[{name:'Synthetic reagent',lot:'SYN-DNB-001',expiry:'2099-12-31'}],qubitSamples:3,preclean:true,loadingReagentPrepared:true},reason:'จำลอง เตรียม DNB attempt'});
export async function issueF5Simulation(db:Queryable,user:Principal,batchId:string,dnbId:string,deps:DocDeps,kind:'PRE_WORK'|'COMPLETED'='PRE_WORK'){
 const f5Deps={store:deps.store,render:async(d:Parameters<typeof f5Html>[0])=>Buffer.from('%PDF-1.4\n'+f5Html(d))};
 const input=async(t:Queryable)=>({batchId,dnbId,expectedVersion:await version(t,batchId),kind,purpose:'SYNTHETIC_SIMULATION'});
 await tx(db,async t=>issueF5(t,user,await input(t),f5Deps,true));return tx(db,async t=>issueF5(t,user,await input(t),f5Deps));
}
