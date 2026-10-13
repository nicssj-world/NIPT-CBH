import {it,expect} from 'vitest';
import {Client} from 'pg';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {migrate} from '../../tools/migrate';
import {assertSyntheticDatabase,type Queryable} from '../../packages/db/connection';
import {bangkokToday} from '../../packages/lab/core';
import {digest} from '../../packages/pooling/calculation';
import {BARCODE_ORDER} from '../../packages/halos-export/contract';
import {labUsers,docDeps,tx,version} from '../helpers/lab';
import {completedPool,dnbInput,issueF5Simulation} from '../helpers/sequencing';
import * as s from '../../packages/sequencing/service';
import {printF5,issueF5} from '../../packages/sequencing/documents';
import {f5Html,type F5Document} from '../../packages/pdf/f5';

it.skipIf(!process.env.NIPT_TEST_DATABASE_URL)('native app_rw P4c rejects malformed F5, cell plans, exact verification and first-cycle evidence; serializes raw reviews',async()=>{
 const url=process.env.NIPT_TEST_DATABASE_URL!;assertSyntheticDatabase(url);
 const owner=new Client({connectionString:url}),a=new Client({connectionString:url}),b=new Client({connectionString:url});
 const docs=await docDeps();await owner.connect();await a.connect();await b.connect();
 const db=a as unknown as Queryable;
 try{
  await migrate(owner);await owner.query(await readFile('packages/db/roles.sql','utf8'));
  await a.query('SET ROLE app_rw');await b.query('SET ROLE app_rw');
  const u=await labUsers(owner);
  await owner.query("UPDATE lab_batch SET state='Cancelled',cancelled_by=$1,cancelled_at=now(),cancel_reason='SYNTHETIC P4c evidence isolation' WHERE state='Draft'",[u.staff.id]);
  const f=await completedPool(owner,u,docs.deps,45,'PATIENT_PC_NC');
  const created=await tx(db,async t=>s.createDnb(t,u.staff,dnbInput(f.batchId,f.poolSnapshotId,await version(t,f.batchId),u.staff.id))),dnbId=created.id!;
  const call=(fn:(t:Queryable,user:typeof u.staff,input:unknown)=>Promise<unknown>,extra:Record<string,unknown>,user=u.staff)=>tx(db,async t=>fn(t,user,{batchId:f.batchId,dnbId,expectedVersion:await version(t,f.batchId),requestId:randomUUID(),...extra}));
  const rawEvent=(type:string,payload:unknown)=>a.query('INSERT INTO p4c_dnb_event(dnb_id,event_type,payload,actor_id) VALUES($1,$2,$3,$4)',[dnbId,type,JSON.stringify(payload),u.staff.id]);
  await expect(a.query("INSERT INTO p4c_document(dnb_id,kind,revision,snapshot,file_sha256,issued_by) VALUES($1,'COMPLETED',1,'{}',$2,$3)",[dnbId,'a'.repeat(64),u.staff.id])).rejects.toThrow();
  await expect(rawEvent('COMPLETED',{})).rejects.toThrow('F5_ISSUED_ORIGINAL_REQUIRED');
  await expect(rawEvent('PRE_WORK',{})).rejects.toThrow('F5_ISSUED_ORIGINAL_REQUIRED');
  const pre=await issueF5Simulation(db,u.staff,f.batchId,dnbId,docs.deps);
  const f5Deps={store:docs.deps.store,render:async(d:Parameters<typeof f5Html>[0])=>Buffer.from('%PDF-1.4\n'+f5Html(d))};
  const copy=await tx(db,t=>printF5(t,u.staff,{documentId:pre.id,kind:'WORKING_COPY',reason:'synthetic paper boundary copy'},f5Deps));
  expect((await a.query('SELECT p4c_paper_usable($1,$2) usable',[dnbId,copy.id])).rows[0].usable).toBe(true);
  await call(s.transition,{transition:'DNB_START',reason:'synthetic evidence start'});await call(s.transition,{transition:'DNB_END',reason:'synthetic evidence end'});
  for(const field of ['STD1','STD2','QC3'])await call(s.recordObservation,{field,value:'20',unit:'ng/uL',source:'DIRECT_ENTRY'});
  for(const o of await s.observations(db,dnbId))await call(s.reviewObservation,{observationId:o.id,result:'Confirmed',note:'synthetic evidence independent review'},u.certifier);
  await call(s.decideQc3,{decision:'SyntheticReviewed',criteriaVersion:s.QC3_CRITERIA,reason:'synthetic QC3 review'},u.certifier);
  const source=s.orderedSourceMembers((await s.storedPool(db,f.batchId,f.poolSnapshotId)).snapshot);
  const members=source.map((m,i)=>({memberKey:m.memberKey,physicalPosition:m.physicalPosition,role:m.role,exportSampleId:`SYN-EXPLICIT-${i+1}`,printedSampleId:m.printedSampleId!,lnHalos:m.lnHalos??`SYN-CONTROL-${i+1}`,barcodeIndex:BARCODE_ORDER[i],barcodeType:'SYN-UNVERIFIED'}));
  const handoff=await call(s.createHandoff,{mapping:{status:'synthetic-fixture-unverified',evidenceReference:'Explicit synthetic fixture; no approved mapping',members},reason:'synthetic evidence handoff'}) as {id:string;fileHash:string};
  const good=(await a.query<s.HandoffRow>('SELECT * FROM p4c_handoff WHERE id=$1',[handoff.id])).rows[0];
  type Plan=NonNullable<typeof good.payload.cellPlan>;
  const mutatePlan:(p:Plan)=>void=(p)=>{Object.assign(p.rows[0].cells[0],{value:'SYN-WRONG-A'});};
  const mutations:Array<[string,(p:Plan)=>void]>=[
   ['sample',mutatePlan],['lane',p=>{Object.assign(p.rows[0].cells[1],{value:'L02'});}],
   ['DNB',p=>{Object.assign(p.rows[0].cells[2],{value:'DNB19000101'});}],
   ['barcode',p=>{Object.assign(p.rows[0].cells[3],{value:13});}],
   ['column E',p=>{Object.assign(p.rows[0].cells[4],{value:''});}],
   ['row49',p=>{Object.assign(p.rows[0],{excelRow:49});}],
   ['extra cell',p=>{(p.rows[0].cells as unknown as unknown[]).push({type:'blank'});}],
   ['source',p=>{Object.assign(p.rows[0].source,{exportSampleId:'SYN-WRONG-SOURCE'});}],
   ['reorder',p=>{const rows=p.rows as unknown as unknown[];[rows[0],rows[1]]=[rows[1],rows[0]];}],
   ['header',p=>{(p.headers as unknown as string[])[0]='Sample';}],
   ['template',p=>{Object.assign(p.lineage,{templateSha256:'f'.repeat(64)});}],
  ];
  // Recompute outer hashes: semantic guards, rather than incidental old hashes, must reject these rows.
  for(const [label,mutate] of mutations){
   const payload=structuredClone(good.payload);Object.assign(payload.cellPlan!.lineage,{handoffRevision:2});payload.manifest.revision=2;mutate(payload.cellPlan!);
   const fileHash=digest(payload.cellPlan);payload.manifest.fileHash=fileHash;
   const rejected=await a.query('INSERT INTO p4c_handoff(dnb_id,revision,source_sha256,payload,sha256,file_sha256,mapping_status,created_by) VALUES($1,2,$2,$3,$4,$5,$6,$7)',[dnbId,good.source_sha256,JSON.stringify(payload),digest(payload),fileHash,good.mapping_status,u.staff.id]).then(()=>false,e=>{expect(String(e)).toMatch(/HALOS/);return true;});expect(rejected,'CORRUPT_PLAN_ACCEPTED: '+label).toBe(true);
  }
  expect((await a.query('SELECT count(*)::int n FROM p4c_handoff WHERE dnb_id=$1',[dnbId])).rows[0].n).toBe(1);
  const transfer=await call(s.transferHandoff,{handoffId:handoff.id,fileHash:handoff.fileHash,status:'Complete',evidenceHash:'a'.repeat(64),evidenceReference:'Synthetic evidence transfer',purpose:'SYNTHETIC_SIMULATION'}) as {id:string};
  const observed:Record<string,unknown>={status:'Complete',lane:'L01',fileHash:handoff.fileHash,observedDnbId:good.payload.dnbLabel,observedRows:members};
  for(const field of ['status','lane','fileHash','observedDnbId','observedRows'])for(const malformed of ['omitted','null','wrong-type']){
   const candidate=structuredClone(observed);if(malformed==='omitted')delete candidate[field];else candidate[field]=malformed==='null'?null:42;
   await expect(a.query("INSERT INTO p4c_handoff_verification(transfer_id,result,observed,errors,evidence_hash,reviewer_id,note) VALUES($1,'MATCH',$2,'[]',$3,$4,'synthetic malformed exact review')",[transfer.id,JSON.stringify(candidate),'b'.repeat(64),u.certifier.id]),`${field}/${malformed}`).rejects.toThrow('HANDOFF_EXACT_MATCH_REQUIRED');
   expect(await s.handoffVerified(db,dnbId)).toBe(false);
  }
  const record={purpose:'SYNTHETIC_SIMULATION',equipmentModel:'DNBSEQ-G50',equipmentId:'SYN-G50',sequencingId:'SYN-SEQ',cartridgeId:'SYN-CART',flowCellId:'SYN-FLOW',idSource:'MANUAL_SYNTHETIC',barcodeType:'SYN-UNVERIFIED',barcodeRange:{from:1,to:48},recipe:'SYN-RECIPE',configuration:{readMode:'SE',readCycles:35,barcodeCycles:10,assay:'SYN-NIPT'},pressureKpa:'-81',diskSpaceGb:'501',wash:{lot:'SYN-WASH',preparedOn:bangkokToday(),expiry:'2099-12-31',preWash:true},reason:'synthetic evidence sequence'};
  const sequence=await call(s.createSequencing,record) as {id:string};
  await expect(call(s.transitionSequencing,{sequencingId:sequence.id,transition:'SEQUENCE_START',reason:'synthetic missing verification'})).rejects.toThrow('HANDOFF_VERIFICATION_REQUIRED');
  await call(s.verifyHandoff,{handoffId:handoff.id,transferId:transfer.id,...observed,evidenceHash:'b'.repeat(64),note:'synthetic exact independent review'},u.certifier);
  expect(await s.handoffVerified(db,dnbId)).toBe(true);
  await call(s.transitionSequencing,{sequencingId:sequence.id,transition:'SEQUENCE_START',reason:'synthetic evidence sequencing start'});
  for(const firstCycle of [null,{},'invalid',{loadedDnb:'1',q30:'90',bic:'90'},{loadedDnb:'1',q30:'invalid',bic:'90',fit:'90'}]){
   await expect(rawEvent('SEQUENCE_END',{sequencingId:sequence.id,firstCycle,postWash:true})).rejects.toThrow(/FIRST_CYCLE/);
  }
  await call(s.transitionSequencing,{sequencingId:sequence.id,transition:'SEQUENCE_END',firstCycle:{loadedDnb:'1',q30:'90',bic:'90',fit:'90'},postWash:true,reason:'synthetic evidence sequencing end'});
  await call(s.recordQc4,{sequencingId:sequence.id,scope:'LANE',lane:'L01',metrics:{totalReads:'100',uniqueReads:'90',q30:'90',gcPercent:'40'},source:'DIRECT_ENTRY',evidenceHash:'c'.repeat(64)});
  const qc4=(await s.qc4Evidence(db,dnbId,sequence.id)).observations[0];
  const qc3=(await s.observations(db,dnbId)).find(o=>o.field==='QC3')!;
  // A's source invalidation locks the batch; a rolled-back invalidation permits B's review.
  await a.query('BEGIN');await rawEvent('STOP_USE',{reason:'synthetic deterministic review race'});
  const blocked=b.query("INSERT INTO p4c_qc4_review(qc4_id,result,criteria_version,note,reviewer_id) VALUES($1,'SyntheticReviewed',$2,'synthetic review versus source race',$3)",[qc4.id,s.QC4_CRITERIA,u.certifier.id]).then(()=>({ok:true,error:''}),e=>({ok:false,error:String(e)}));
  // Identify the blocked client from its dedicated PostgreSQL connection.
  const bPid=(b as unknown as {processID:number}).processID;
  let lockObserved=false;
  for(let n=0;n<100&&!lockObserved;n++){
   lockObserved=(await owner.query("SELECT wait_event_type='Lock' waiting FROM pg_stat_activity WHERE pid=$1",[bPid])).rows[0]?.waiting===true;
   if(!lockObserved)await new Promise(resolve=>setTimeout(resolve,10));
  }
  expect(lockObserved).toBe(true);await a.query('ROLLBACK');const reviewed=await blocked;
  expect(reviewed.ok).toBe(true);
  expect((await owner.query('SELECT 1 FROM p4c_qc4_review WHERE qc4_id=$1',[qc4.id])).rowCount).toBe(1);
  const metrics={totalReads:'100',uniqueReads:'90',q30:'90',gcPercent:'40'};
  for(const m of members)await call(s.recordQc4,{sequencingId:sequence.id,scope:'SAMPLE',memberKey:m.memberKey,lane:'L01',metrics,source:'DIRECT_ENTRY',evidenceHash:'d'.repeat(64)});
  for(const o of (await s.qc4Evidence(db,dnbId,sequence.id)).observations.filter(o=>!o.review))await call(s.reviewQc4,{qc4Id:o.id,result:'SyntheticReviewed',criteriaVersion:s.QC4_CRITERIA,note:'synthetic full QC4 independent review'},u.certifier);
  let previewSnapshot:F5Document|undefined;
  await tx(db,async t=>issueF5(t,u.staff,{batchId:f.batchId,dnbId,expectedVersion:await version(t,f.batchId),kind:'COMPLETED',purpose:'SYNTHETIC_SIMULATION'},
   {...f5Deps,render:async document=>{previewSnapshot=document;return f5Deps.render(document);}},true));
  await call(s.transitionSequencing,{sequencingId:sequence.id,transition:'ANALYSIS_COMPLETE',reason:'synthetic evidence analysis complete'});
  // A genuine same-person preview becomes stale after subsequent immutable evidence.
  const stale={...previewSnapshot!,preview:false};
  await expect(a.query("INSERT INTO p4c_document(id,dnb_id,kind,revision,snapshot,file_sha256,issued_by) VALUES($1,$2,'COMPLETED',$3,$4,$5,$6)",[stale.docId,dnbId,stale.revision,JSON.stringify(stale),'f'.repeat(64),u.staff.id])).rejects.toThrow('CURRENT_PREVIEW_REQUIRED');
  const complete=await issueF5Simulation(db,u.staff,f.batchId,dnbId,docs.deps,'COMPLETED');
  const original=await docs.deps.store.get(complete.sha256!);
  const reprint=await tx(db,t=>printF5(t,u.staff,{documentId:complete.id,kind:'ORIGINAL_REPRINT',reason:'synthetic completed original exact reprint'},f5Deps));
  expect(reprint.bytes).toEqual(original);expect(reprint.sha256).toBe(complete.sha256);
  expect((await a.query('SELECT p4c_paper_usable($1,$2) usable',[dnbId,copy.id])).rows[0].usable).toBe(false);
  await expect(a.query("INSERT INTO p4c_document_copy(document_id,copy_number,kind,file_sha256,derived_from,reason,actor_id) VALUES($1,2,'WORKING_COPY',$2,$3,'synthetic after completion paper copy',$4)",[pre.id,'e'.repeat(64),pre.sha256,u.staff.id])).rejects.toThrow('WORKING_COPY_NOT_USABLE');
  // Committing invalidation instead makes a concurrent raw QC3 decision reject after its lock wait.
  await a.query('BEGIN');await rawEvent('STOP_USE',{reason:'synthetic committed review race'});
  const decision=b.query('INSERT INTO p4c_qc3_decision(dnb_id,observation_id,decision,criteria_version,reason,actor_id) VALUES($1,$2,$3,$4,$5,$6)',[dnbId,qc3.id,'SyntheticReviewed',s.QC3_CRITERIA,'synthetic raced direct decision',u.certifier.id]).then(()=>({ok:true,error:''}),e=>({ok:false,error:String(e)}));
  lockObserved=false;
  for(let n=0;n<100&&!lockObserved;n++){
   lockObserved=(await owner.query("SELECT wait_event_type='Lock' waiting FROM pg_stat_activity WHERE pid=$1",[bPid])).rows[0]?.waiting===true;
   if(!lockObserved)await new Promise(resolve=>setTimeout(resolve,10));
  }
  expect(lockObserved).toBe(true);await a.query('COMMIT');const decided=await decision;
  expect(decided.ok).toBe(false);expect(decided.error).toContain('DNB_STOP_USE');
  await expect(a.query('INSERT INTO p4c_qc3_decision(dnb_id,observation_id,decision,criteria_version,reason,actor_id) VALUES($1,$2,$3,$4,$5,$6)',[dnbId,qc3.id,'SyntheticReviewed',s.QC3_CRITERIA,'synthetic stale direct decision',u.certifier.id])).rejects.toThrow('DNB_STOP_USE');
  expect((await a.query('SELECT p4c_paper_usable($1,$2) usable',[dnbId,copy.id])).rows[0].usable).toBe(false);
  await expect(a.query("INSERT INTO p4c_document_copy(document_id,copy_number,kind,file_sha256,derived_from,reason,actor_id) VALUES($1,2,'WORKING_COPY',$2,$3,'synthetic inactive paper copy',$4)",[pre.id,'d'.repeat(64),pre.sha256,u.staff.id])).rejects.toThrow('WORKING_COPY_NOT_USABLE');
 }finally{
  await a.query('ROLLBACK').catch(()=>undefined);await b.query('ROLLBACK').catch(()=>undefined);
  await a.end();await b.end();await owner.end();await docs.close();
 }
},120000);
