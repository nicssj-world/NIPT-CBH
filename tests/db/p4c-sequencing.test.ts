import {beforeEach,afterEach,it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import type {PGlite} from '@electric-sql/pglite';
import type {Queryable} from '../../packages/db/connection';
import type {Principal} from '../../packages/security/policy';
import {testDatabase} from '../helpers/database';
import {labUsers,docDeps,tx,version} from '../helpers/lab';
import {completedPool,dnbInput,issueF5Simulation} from '../helpers/sequencing';
import * as s from '../../packages/sequencing/service';
import * as rec from '../../packages/lab/records';
import {printF5} from '../../packages/sequencing/documents';
import {f5Html} from '../../packages/pdf/f5';
let db:PGlite,u:Awaited<ReturnType<typeof labUsers>>,docs:Awaited<ReturnType<typeof docDeps>>,f:Awaited<ReturnType<typeof completedPool>>,dnbId:string;
beforeEach(async()=>{db=await testDatabase();u=await labUsers(db);docs=await docDeps();f=await completedPool(db,u,docs.deps);const c=await tx(db,async t=>s.createDnb(t,u.staff,dnbInput(f.batchId,f.poolSnapshotId,await version(t,f.batchId),u.staff.id)));dnbId=c.id!;},120000);
afterEach(async()=>{await db.close();await docs.close();});
const call=(fn:(db:Queryable,user:Principal,input:unknown)=>Promise<unknown>,extra:Record<string,unknown>={},actor=u.staff)=>tx(db,async t=>fn(t,actor,{batchId:f.batchId,dnbId,expectedVersion:await version(t,f.batchId),requestId:randomUUID(),...extra}));
async function startEnd(){await issueF5Simulation(db,u.staff,f.batchId,dnbId,docs.deps);await call(s.transition,{transition:'DNB_START',reason:'จำลอง เริ่ม DNB'});await call(s.transition,{transition:'DNB_END',reason:'จำลอง จบ DNB'});}
async function qc(){for(const field of ['STD1','STD2','QC3'])await call(s.recordObservation,{field,value:'20',unit:'ng/uL',source:'DIRECT_ENTRY'});for(const o of await s.observations(db,dnbId))await call(s.reviewObservation,{observationId:o.id,result:'Confirmed',note:'จำลอง คนที่สองตรวจสอบ'},u.certifier);await call(s.decideQc3,{decision:'SyntheticReviewed',criteriaVersion:s.QC3_CRITERIA,reason:'จำลอง ทบทวน QC3'},u.certifier);}
it('stored HOLD snapshot never becomes Accepted; clinical DNB and current adapter are blocked',async()=>{
 await expect(tx(db,t=>s.acceptedPoolAdapter(t,u.staff,{batchId:f.batchId,poolSnapshotId:f.poolSnapshotId}))).rejects.toThrow('POOL_ACCEPTED_REQUIRED');
 await expect(tx(db,async t=>s.operationalGate(t,u.certifier,{batchId:f.batchId,dnbId,expectedVersion:await version(t,f.batchId)}))).rejects.toThrow('OWNER_DECISIONS_HOLD');
 const input=dnbInput(f.batchId,f.poolSnapshotId,await version(db,f.batchId),u.staff.id);
 await expect(tx(db,t=>s.createDnb(t,u.staff,{...input,purpose:'OPERATIONAL'}))).rejects.toThrow('POOL_ACCEPTED_REQUIRED');
 const w=await tx(db,t=>s.workspace(t,u.auditor,f.batchId));expect(w.current).toMatchObject({acceptance:'HOLD',clinicalUsable:false,exportAllowed:false});
 expect((await db.query<{payload:{acceptance:string;exportAllowed:boolean}}>('SELECT payload FROM p4b_pool_snapshot WHERE id=$1',[f.poolSnapshotId])).rows[0].payload).toMatchObject({acceptance:'HOLD',exportAllowed:false});
});
it('DNB actual-date provenance, preparation, server anchors, immutable evidence and strict RBAC',async()=>{
 await expect(call(s.transition,{transition:'DNB_START',reason:'จำลอง ก่อนใบงาน'})).rejects.toThrow('SYNTHETIC_PRE_WORK_REQUIRED');
 await expect(call(s.recordObservation,{field:'QC3',value:'20',unit:'ng/uL',source:'DIRECT_ENTRY'})).rejects.toThrow('DNB_PRODUCT_REQUIRED');
 await expect(call(s.transition,{transition:'HOLD',reason:'จำลอง สิทธิ์ไม่ผ่าน'},u.auditor)).rejects.toThrow('FORBIDDEN');
 await expect(call(s.recordObservation,{field:'QC3',value:'20',unit:'ng/uL',source:'DIRECT_ENTRY',credentials:'forbidden'})).rejects.toThrow();
 await startEnd();await qc();const w=await tx(db,t=>s.workspace(t,u.staff,f.batchId));expect(w.current?.payload.idProvenance).toMatchObject({dateBasis:'actual',operatorId:u.staff.id});
 expect(w.current?.qc3.ready).toBe(true);expect(w.current?.stability.clinicalAccepted).toBe(false);
 await expect(db.query("UPDATE p4c_dnb_observation SET value='40' WHERE dnb_id=$1",[dnbId])).rejects.toThrow(/append-only/);
 await expect(db.query('DELETE FROM p4c_dnb_attempt WHERE id=$1',[dnbId])).rejects.toThrow(/append-only/);
});
it('QC3 separate review and fresh remeasurement, new attempt lineage, partial mapping fails closed',async()=>{
 await startEnd();await qc();let obs=await s.observations(db,dnbId),qc3=obs.find(o=>o.field==='QC3')!;
 await call(s.decideQc3,{decision:'Remeasure',criteriaVersion:s.QC3_CRITERIA,reason:'จำลอง วัด QC3 ซ้ำ'},u.certifier);
 await expect(call(s.createHandoff,{reason:'จำลอง Handoff'})).rejects.toThrow('QC3_SYNTHETIC_REVIEW_REQUIRED');
 await expect(call(s.decideQc3,{decision:'SyntheticReviewed',criteriaVersion:s.QC3_CRITERIA,reason:'จำลอง ค่าเดิมใช้ไม่ได้'},u.certifier)).rejects.toThrow('QC3_REMEASUREMENT_REQUIRED');
 await call(s.recordObservation,{field:'QC3',value:'21',unit:'ng/uL',source:'DIRECT_ENTRY',supersedesId:qc3.id,reason:'จำลอง วัดใหม่ QC3'});
 obs=await s.observations(db,dnbId);qc3=obs.find(o=>o.field==='QC3')!;await call(s.reviewObservation,{observationId:qc3.id,result:'Confirmed',note:'จำลอง ตรวจวัดใหม่'},u.certifier);
 await call(s.decideQc3,{decision:'SyntheticReviewed',criteriaVersion:s.QC3_CRITERIA,reason:'จำลอง ทบทวนค่าใหม่'},u.certifier);
 await call(s.createHandoff,{reason:'จำลอง สร้าง Manifest'});const w=await tx(db,t=>s.workspace(t,u.staff,f.batchId));expect(w.current?.handoffs[0]).toMatchObject({mapping_status:'MAPPING_UNAVAILABLE',file_sha256:null});
 expect(w.current?.handoffs[0].payload.members).toHaveLength(2);expect(w.current?.handoffVerified).toBe(false);
 await expect(call(s.transferHandoff,{handoffId:w.current!.handoffs[0].id,fileHash:'a'.repeat(64),status:'Complete',evidenceHash:'b'.repeat(64),evidenceReference:'synthetic observed transfer',purpose:'SYNTHETIC_SIMULATION'})).rejects.toThrow('MAPPING_UNAVAILABLE');
 await call(s.transition,{transition:'HOLD',reason:'จำลอง ทำ DNB ใหม่'});const old=dnbId,newAttempt=await tx(db,async t=>s.createDnb(t,u.staff,dnbInput(f.batchId,f.poolSnapshotId,await version(t,f.batchId),u.staff.id)));dnbId=newAttempt.id!;
 expect((await s.getDnb(db,f.batchId,dnbId)).supersedes_id).toBe(old);expect((await s.getDnb(db,f.batchId,dnbId)).attempt_number).toBe(2);
});
it('idempotency replays exact result, conflicts cannot change input or actor, stale writes rollback',async()=>{
 await startEnd();const input={batchId:f.batchId,dnbId,expectedVersion:await version(db,f.batchId),requestId:randomUUID(),field:'QC3',value:'20',unit:'ng/uL',source:'DIRECT_ENTRY'};
 const result=await tx(db,t=>s.recordObservation(t,u.staff,input));expect(await tx(db,t=>s.recordObservation(t,u.staff,input))).toEqual(result);
 await expect(tx(db,t=>s.recordObservation(t,u.staff,{...input,value:'30'}))).rejects.toThrow('IDEMPOTENCY_CONFLICT');
 await expect(tx(db,t=>s.recordObservation(t,u.certifier,input))).rejects.toThrow('IDEMPOTENCY_CONFLICT');
 await expect(tx(db,t=>s.recordObservation(t,u.staff,{...input,requestId:randomUUID(),field:'STD1'}))).rejects.toThrow('VERSION_CONFLICT');
 expect(await s.observations(db,dnbId)).toHaveLength(1);
});
it('paper QC3 requires an eligible numbered copy, real provenance and known anchored time before independent reconciliation',async()=>{
 const pre=await issueF5Simulation(db,u.staff,f.batchId,dnbId,docs.deps);
 const copy=await tx(db,t=>printF5(t,u.staff,{documentId:pre.id,kind:'WORKING_COPY',reason:'synthetic numbered reconciliation copy'},
  {store:docs.deps.store,render:async d=>Buffer.from('%PDF-1.4\n'+f5Html(d))}));
 await call(s.transition,{transition:'DNB_START',reason:'synthetic paper start'});await call(s.transition,{transition:'DNB_END',reason:'synthetic paper end'});
 const paper={field:'QC3',value:'20',unit:'ng/uL',source:'PAPER_TRANSCRIPTION',copyId:copy.id,eventPrecision:'NOT_RECORDED',paperOperator:'Synthetic paper operator',paperEvidenceHash:'a'.repeat(64)};
 await expect(call(s.recordObservation,{...paper,copyId:randomUUID()})).rejects.toThrow('WORKING_COPY_NOT_USABLE');
 await expect(call(s.recordObservation,{...paper,paperEvidenceHash:undefined})).rejects.toThrow('PAPER_PROVENANCE_REQUIRED');
 const unknown=await call(s.recordObservation,paper) as {id:string};
 await expect(call(s.reviewObservation,{observationId:unknown.id,result:'Confirmed',note:'synthetic unknown time review'},u.certifier)).rejects.toThrow('UNKNOWN_EVENT_TIME_DISCREPANCY');
 expect((await s.qc3Evidence(db,dnbId)).ready).toBe(false);
 await expect(call(s.recordObservation,{...paper,supersedesId:unknown.id,reason:'synthetic fix paper time',eventPrecision:'MINUTE',eventTime:'2000-01-01T00:00:00Z'})).rejects.toThrow('EVENT_TIME_OUTSIDE_EXECUTION');
 const corrected=await call(s.recordObservation,{...paper,supersedesId:unknown.id,reason:'synthetic source time correction',eventPrecision:'MINUTE',eventTime:new Date().toISOString()}) as {id:string};
 await call(s.reviewObservation,{observationId:corrected.id,result:'Confirmed',note:'synthetic paper evidence compared independently'},u.certifier);
 for(const field of ['STD1','STD2'])await call(s.recordObservation,{field,value:'20',unit:'ng/uL',source:'DIRECT_ENTRY'});
 for(const o of (await s.observations(db,dnbId)).filter(o=>!o.review))await call(s.reviewObservation,{observationId:o.id,result:'Confirmed',note:'synthetic standards independent review'},u.certifier);
 await call(s.decideQc3,{decision:'SyntheticReviewed',criteriaVersion:s.QC3_CRITERIA,reason:'synthetic paper reconciliation completed'},u.certifier);
 expect((await s.qc3Evidence(db,dnbId)).ready).toBe(true);
 expect((await s.observations(db,dnbId)).find(o=>o.id===corrected.id)).toMatchObject({source:'PAPER_TRANSCRIPTION',copy_id:copy.id,paper_operator:'Synthetic paper operator',paper_evidence_hash:'a'.repeat(64),review:{reviewer_id:u.certifier.id}});
});
it('upstream source mutation atomically stops DNB, sequencing/handoff and rolls back together',async()=>{
 await startEnd();await qc();await call(s.createHandoff,{reason:'จำลอง ก่อนระงับ'});
 await db.exec('BEGIN');await rec.decideStageQc1(db,u.certifier,{attemptId:f.attempts[0].id,decision:'Hold',reason:'จำลอง rollback ต้นทาง'});
 expect((await s.events(db,dnbId)).some(e=>e.event_type==='STOP_USE')).toBe(true);await db.exec('ROLLBACK');expect((await s.events(db,dnbId)).some(e=>e.event_type==='STOP_USE')).toBe(false);
 await tx(db,t=>rec.decideStageQc1(t,u.certifier,{attemptId:f.attempts[0].id,decision:'Hold',reason:'จำลอง เปลี่ยนต้นทาง'}));
 const event=(await s.events(db,dnbId)).find(e=>e.event_type==='STOP_USE')!;expect(event.actor_id).toBeNull();expect(event.payload.systemGenerated).toBe(true);
 expect((await tx(db,t=>s.workspace(t,u.staff,f.batchId))).current?.stopUse).toBe(true);
 await expect(call(s.recordObservation,{field:'QC3',value:'21',unit:'ng/uL',source:'DIRECT_ENTRY'})).rejects.toThrow('POOL_STOP_USE');
});
