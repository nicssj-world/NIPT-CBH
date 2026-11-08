import {it,expect,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {task3Fixture} from '../helpers/task3';
import {pdfDate} from '../helpers/results';
import {pendingState} from '../helpers/certify-pending';
import {syntheticReportPdf} from '../../tools/his-simulator/result-pdf';
import {registerIntake,parseIntake} from '../../packages/results/intake';
import {reviewBenchForResult} from '../../packages/lab/bench-review';
import {confirmCompletion} from '../../packages/results/completion';
import {ancCaseResults,unlinkVersion,proposeLink,decideLink,voidVersion,attestHisPresence,withdrawHisAttestation} from '../../packages/results/service';
import {releaseQueue} from '../../packages/results/release-queue';
import {sendToHis} from '../../packages/results/send-his';

type F=Awaited<ReturnType<typeof task3Fixture>>;
/** One external PDF per case taken to PendingCertification (review + QC5, no release). */
async function pending(f:F,index:number,abnormal=false){
 const c=f.cases[index],bytes=syntheticReportPdf({kind:'SINGLETON',labNumber:c.printed,hn:c.hn,dob:'01-Jan-1990',collection:pdfDate('2026-10-20'),gaWeeks:17,gaDays:6,sex:null,...(abnormal?{risks:['High Risk','Low Risk','Low Risk'] as [string,string,string]}:{})});
 const intakeId=await f.run(t=>registerIntake(t,f.store,{source:'UPLOAD',relativePath:null,originalName:`SYNTHETIC-send-${index}.pdf`,actorId:f.admin.id,jobId:null},bytes));
 await f.run(t=>parseIntake(t,f.store,intakeId,{maxBytes:10000000,acceptZip:true}));
 await f.run(t=>reviewBenchForResult(t,f.admin,c.attemptId,{revision:1,measurementsReviewed:true,reason:'SYNTHETIC legacy paper-only result evidence review'}));
 const done=await f.run(t=>confirmCompletion(t,f.admin,{idempotencyKey:randomUUID(),abnormalAcknowledged:abnormal,items:[{intakeId,caseId:c.caseId,roundId:c.roundId,attemptId:c.attemptId}]}));
 expect(done.items[0].outcome).toBe('PendingCertification');
 return {c,id:done.items[0].versionId!};
}
const rowVersion=async(f:F,id:string)=>(await f.db.query<{row_version:number}>('SELECT row_version FROM result_report_version WHERE id=$1',[id])).rows[0].row_version;
const count=async(f:F,sql:string,p:unknown[]=[])=>(await f.db.query(sql,p)).rows.length;
const OUTBOX="SELECT 1 FROM job_outbox WHERE kind='result_release_completed'";
const send=async(f:F,items:{id:string}[],extra:Partial<{idempotencyKey:string;reviewConfirmed:boolean;abnormalAcknowledged:boolean}>={})=>{
 const list:{versionId:string;expectedRowVersion:number}[]=[];for(const i of items)list.push({versionId:i.id,expectedRowVersion:await rowVersion(f,i.id)});
 return f.run(t=>sendToHis(t,f.admin,{idempotencyKey:randomUUID(),reviewConfirmed:true,abnormalAcknowledged:false,items:list,...extra}));
};

it('sends one result: release exists, ANC sees it, one outbox job',async()=>{
 const f=await task3Fixture();try{
  const p=await pending(f,0);
  expect(await pendingState(f.db,p.id)).toMatchObject({state:'PendingCertification',releases:0,outbox:0});
  const r=await send(f,[p]);
  expect(r.items).toEqual([{versionId:p.id,outcome:'CertifiedReleased'}]);
  expect(await count(f,'SELECT 1 FROM result_release WHERE version_id=$1',[p.id])).toBe(1);
  expect(await count(f,OUTBOX)).toBe(1);
  const anc=await f.run(t=>ancCaseResults(t,f.u.anc,p.c.caseId));
  expect(anc.rounds.some(x=>x.result!==null)).toBe(true);
  expect(await count(f,'SELECT 1 FROM result_review WHERE version_id=$1',[p.id])).toBe(1);
  expect(await count(f,'SELECT 1 FROM result_qc5_review WHERE version_id=$1',[p.id])).toBe(1);
 }finally{vi.unstubAllEnvs();await f.close();}
},180000);

it('sends a batch where one item lost consent while waiting: others CertifiedReleased, that one BLOCKED and back in ValidationBlocked',async()=>{
 const f=await task3Fixture();try{
  const a=await pending(f,0),b=await pending(f,1);
  await f.db.query("INSERT INTO p2_revocation(case_id,round_id,stage,reason,actor_id) VALUES($1,$2,'W1','SYNTHETIC consent withdrawal while waiting',$3)",[b.c.caseId,b.c.roundId,f.u.staff.id]);
  const r=await send(f,[a,b]);
  expect(r.items[0]).toEqual({versionId:a.id,outcome:'CertifiedReleased'});
  expect(r.items[1]).toMatchObject({versionId:b.id,outcome:'BLOCKED'});
  expect(r.items[1].failed?.join(' ')).toContain('CONSENT_REVOKED');
  expect((await f.db.query<{state:string}>('SELECT state FROM result_report_version WHERE id=$1',[b.id])).rows[0].state).toBe('ValidationBlocked');
  expect(await count(f,'SELECT 1 FROM result_release WHERE version_id=$1',[b.id])).toBe(0);
  expect(await count(f,'SELECT 1 FROM result_release WHERE version_id=$1',[a.id])).toBe(1);
  expect(await count(f,OUTBOX)).toBe(1);
  const anc=(await f.run(t=>ancCaseResults(t,f.u.anc,b.c.caseId)));
  expect(anc.rounds.every(x=>x.result===null)).toBe(true);
 }finally{vi.unstubAllEnvs();await f.close();}
},180000);

it('replaying a mixed batch key (released + blocked) repeats the recorded outcomes in request order, writes nothing new, and pins the certify key format',async()=>{
 const f=await task3Fixture();try{
  const a=await pending(f,0),b=await pending(f,1),key=randomUUID();
  await f.db.query("INSERT INTO p2_revocation(case_id,round_id,stage,reason,actor_id) VALUES($1,$2,'W1','SYNTHETIC consent withdrawal while waiting',$3)",[b.c.caseId,b.c.roundId,f.u.staff.id]);
  const first=await send(f,[a,b],{idempotencyKey:key});
  expect(first.items.map(i=>i.outcome)).toEqual(['CertifiedReleased','BLOCKED']);
  const gates=await count(f,'SELECT 1 FROM result_gate_evaluation');
  const replay=await f.run(t=>sendToHis(t,f.admin,{idempotencyKey:key,reviewConfirmed:true,abnormalAcknowledged:false,items:[{versionId:b.id,expectedRowVersion:1},{versionId:a.id,expectedRowVersion:1}]}));
  expect(replay.items).toEqual([first.items[1],first.items[0]]);
  expect(await count(f,'SELECT 1 FROM result_gate_evaluation')).toBe(gates);
  expect(await count(f,'SELECT 1 FROM result_release')).toBe(1);
  expect(await count(f,OUTBOX)).toBe(1);
  const keys=(await f.db.query<{idempotency_key:string}>("SELECT idempotency_key FROM result_gate_evaluation WHERE purpose='CERTIFY_ATTEMPT' AND version_id=ANY($1)",[[a.id,b.id]])).rows.map(r=>r.idempotency_key);
  expect(keys).toHaveLength(2);for(const k of keys)expect(k).toMatch(/^send-[0-9a-f]{48}$/);
 }finally{vi.unstubAllEnvs();await f.close();}
},180000);

/** Deletes the review and QC5 of a PendingCertification version (synthetic DB, triggers off) so it looks like a Linked/unreviewed one. */
async function unreview(f:F,id:string){
 await f.db.query('ALTER TABLE result_qc5_review DISABLE TRIGGER USER');await f.db.query('ALTER TABLE result_review DISABLE TRIGGER USER');
 await f.db.query('DELETE FROM result_qc5_review WHERE version_id=$1',[id]);await f.db.query('DELETE FROM result_review WHERE version_id=$1',[id]);
 await f.db.query('ALTER TABLE result_qc5_review ENABLE TRIGGER USER');await f.db.query('ALTER TABLE result_review ENABLE TRIGGER USER');
}

it('item with no review and no QC5: reviewConfirmed false → ERROR with nothing written; true → review*ForRelease writes exactly 1 review and 1 QC5, then CertifiedReleased',async()=>{
 const f=await task3Fixture();try{
  const p=await pending(f,0);await unreview(f,p.id);
  const refused=await send(f,[p],{reviewConfirmed:false});
  expect(refused.items[0]).toMatchObject({outcome:'ERROR',code:'REVIEW_CONFIRMATION_REQUIRED'});
  expect(await count(f,'SELECT 1 FROM result_review WHERE version_id=$1',[p.id])).toBe(0);
  expect(await count(f,'SELECT 1 FROM result_qc5_review WHERE version_id=$1',[p.id])).toBe(0);
  expect(await count(f,'SELECT 1 FROM result_release WHERE version_id=$1',[p.id])).toBe(0);
  const ok=await send(f,[p]);
  expect(ok.items[0]).toEqual({versionId:p.id,outcome:'CertifiedReleased'});
  expect(await count(f,'SELECT 1 FROM result_review WHERE version_id=$1',[p.id])).toBe(1);
  expect(await count(f,'SELECT 1 FROM result_qc5_review WHERE version_id=$1',[p.id])).toBe(1);
  expect(await count(f,OUTBOX)).toBe(1);
 }finally{vi.unstubAllEnvs();await f.close();}
},180000);

it('an item that fails AFTER writing (review + QC5 inserted, then QC5 gate refuses) is rolled back to its savepoint while the sibling in the same batch is released',async()=>{
 const f=await task3Fixture();try{
  const a=await pending(f,0),b=await pending(f,1);await unreview(f,a.id);await unreview(f,b.id);
  await f.db.query("INSERT INTO p2_revocation(case_id,round_id,stage,reason,actor_id) VALUES($1,$2,'W1','SYNTHETIC consent withdrawal while waiting',$3)",[b.c.caseId,b.c.roundId,f.u.staff.id]);
  const r=await send(f,[b,a]);
  expect(r.items[0]).toMatchObject({versionId:b.id,outcome:'ERROR',code:'QC5_GATE_FAILED'});
  expect(r.items[1]).toEqual({versionId:a.id,outcome:'CertifiedReleased'});
  expect(await count(f,'SELECT 1 FROM result_review WHERE version_id=$1',[b.id])).toBe(0);
  expect(await count(f,'SELECT 1 FROM result_qc5_review WHERE version_id=$1',[b.id])).toBe(0);
  expect((await f.db.query<{state:string}>('SELECT state FROM result_report_version WHERE id=$1',[b.id])).rows[0].state).toBe('PendingCertification');
  expect(await count(f,'SELECT 1 FROM result_release WHERE version_id=$1',[b.id])).toBe(0);
  expect(await count(f,'SELECT 1 FROM result_review WHERE version_id=$1',[a.id])).toBe(1);
  expect(await count(f,'SELECT 1 FROM result_qc5_review WHERE version_id=$1',[a.id])).toBe(1);
  expect(await count(f,OUTBOX)).toBe(1);
 }finally{vi.unstubAllEnvs();await f.close();}
},180000);

it('replaying a BLOCKED batch key returns BLOCKED again and writes no second gate evaluation',async()=>{
 const f=await task3Fixture();try{
  const p=await pending(f,0),key=randomUUID();
  await f.db.query("INSERT INTO p2_revocation(case_id,round_id,stage,reason,actor_id) VALUES($1,$2,'W1','SYNTHETIC consent withdrawal while waiting',$3)",[p.c.caseId,p.c.roundId,f.u.staff.id]);
  const first=await send(f,[p],{idempotencyKey:key});expect(first.items[0].outcome).toBe('BLOCKED');
  const evaluations=await count(f,"SELECT 1 FROM result_gate_evaluation WHERE version_id=$1 AND purpose='CERTIFY_ATTEMPT'",[p.id]);
  const replay=await f.run(t=>sendToHis(t,f.admin,{idempotencyKey:key,reviewConfirmed:true,abnormalAcknowledged:false,items:[{versionId:p.id,expectedRowVersion:1}]}));
  expect(replay.items[0].outcome).toBe('BLOCKED');
  expect(await count(f,"SELECT 1 FROM result_gate_evaluation WHERE version_id=$1 AND purpose='CERTIFY_ATTEMPT'",[p.id])).toBe(evaluations);
  expect(await count(f,OUTBOX)).toBe(0);
 }finally{vi.unstubAllEnvs();await f.close();}
},180000);

it('two keys for the same version: the second reports CertifiedReleased without writing, outbox count stays 1',async()=>{
 const f=await task3Fixture();try{
  const p=await pending(f,0);
  expect((await send(f,[p])).items[0].outcome).toBe('CertifiedReleased');
  const gates=await count(f,'SELECT 1 FROM result_gate_evaluation WHERE version_id=$1',[p.id]);
  const second=await f.run(t=>sendToHis(t,f.admin,{idempotencyKey:randomUUID(),reviewConfirmed:true,abnormalAcknowledged:false,items:[{versionId:p.id,expectedRowVersion:1}]}));
  expect(second.items).toEqual([{versionId:p.id,outcome:'CertifiedReleased'}]);
  expect(await count(f,'SELECT 1 FROM result_gate_evaluation WHERE version_id=$1',[p.id])).toBe(gates);
  expect(await count(f,'SELECT 1 FROM result_release WHERE version_id=$1',[p.id])).toBe(1);
  expect(await count(f,OUTBOX)).toBe(1);
 }finally{vi.unstubAllEnvs();await f.close();}
},180000);

it('unreviewed item without reviewConfirmed → REVIEW_CONFIRMATION_REQUIRED, nothing released; with confirmation it reviews then releases',async()=>{
 const f=await task3Fixture();try{
  const p=await pending(f,0);
  // Relink makes the earlier review stale (QC5 for the same sha stays: the unique QC5 must not be inserted again).
  const rv=()=>rowVersion(f,p.id);
  await f.run(async t=>unlinkVersion(t,f.admin,{versionId:p.id,reason:'SYNTHETIC unlink to relink',expectedRowVersion:await rv()}));
  await f.run(async t=>proposeLink(t,f.admin,{versionId:p.id,roundId:p.c.roundId,attemptId:p.c.attemptId,reason:'SYNTHETIC relink after review',expectedRowVersion:await rv()}));
  await f.run(async t=>decideLink(t,f.admin,{versionId:p.id,decision:'APPROVE',reason:'SYNTHETIC relink approval',expectedRowVersion:await rv()}));
  const reviews=await count(f,'SELECT 1 FROM result_review WHERE version_id=$1',[p.id]);
  const refused=await send(f,[p],{reviewConfirmed:false});
  expect(refused.items[0]).toMatchObject({outcome:'ERROR',code:'REVIEW_CONFIRMATION_REQUIRED'});
  expect(await count(f,'SELECT 1 FROM result_review WHERE version_id=$1',[p.id])).toBe(reviews);
  expect(await count(f,'SELECT 1 FROM result_release WHERE version_id=$1',[p.id])).toBe(0);
  expect(await count(f,OUTBOX)).toBe(0);
  const ok=await send(f,[p]);
  expect(ok.items[0].outcome).toBe('CertifiedReleased');
  expect(await count(f,'SELECT 1 FROM result_review WHERE version_id=$1',[p.id])).toBe(reviews+1);
  expect(await count(f,'SELECT 1 FROM result_qc5_review WHERE version_id=$1',[p.id])).toBe(1);
  expect(await count(f,OUTBOX)).toBe(1);
 }finally{vi.unstubAllEnvs();await f.close();}
},180000);

it('abnormal item without acknowledgement gets ABNORMAL_ACK_REQUIRED while the others are sent; acknowledged it is released',async()=>{
 const f=await task3Fixture();try{
  const a=await pending(f,0),b=await pending(f,1,true);
  const r=await send(f,[a,b]);
  expect(r.items[0].outcome).toBe('CertifiedReleased');
  expect(r.items[1]).toMatchObject({versionId:b.id,outcome:'ERROR',code:'ABNORMAL_ACK_REQUIRED'});
  expect(await count(f,'SELECT 1 FROM result_release WHERE version_id=$1',[b.id])).toBe(0);
  expect((await send(f,[b],{abnormalAcknowledged:true})).items[0].outcome).toBe('CertifiedReleased');
  expect(await count(f,OUTBOX)).toBe(2);
 }finally{vi.unstubAllEnvs();await f.close();}
},180000);

it('rejects invalid input, duplicate versionIds and users without certify permission',async()=>{
 const f=await task3Fixture();try{
  const p=await pending(f,0),item={versionId:p.id,expectedRowVersion:1};
  const base={idempotencyKey:randomUUID(),reviewConfirmed:true,abnormalAcknowledged:false};
  await expect(f.run(t=>sendToHis(t,f.admin,{...base,idempotencyKey:'not-a-uuid',items:[item]}))).rejects.toThrow();
  await expect(f.run(t=>sendToHis(t,f.admin,{...base,items:[]}))).rejects.toThrow();
  await expect(f.run(t=>sendToHis(t,f.admin,{...base,items:Array.from({length:101},()=>item)}))).rejects.toThrow();
  await expect(f.run(t=>sendToHis(t,f.admin,{...base,items:[item,item]}))).rejects.toThrow('DUPLICATE_ITEMS');
  await expect(f.run(t=>sendToHis(t,f.u.anc,{...base,items:[item]}))).rejects.toThrow();
  // LAB_STAFF holds result.review but not result.certify.
  await expect(f.run(t=>sendToHis(t,f.u.staff,{...base,items:[item]}))).rejects.toThrow();
  // Outside operational mode result.certify is denied by policy (the OPERATIONAL_MODE_REQUIRED guard behind it is defence in depth).
  vi.stubEnv('NIPT_MODE','synthetic');
  await expect(f.run(t=>sendToHis(t,f.admin,{...base,items:[item]}))).rejects.toThrow('FORBIDDEN');
  vi.stubEnv('NIPT_MODE','operational');
  expect(await count(f,'SELECT 1 FROM result_release WHERE version_id=$1',[p.id])).toBe(0);
 }finally{vi.unstubAllEnvs();await f.close();}
},180000);

it('EQA item: CertifiedReleased with no outbox job',async()=>{
 const f=await task3Fixture([{ln:'9900099511',hn:'9900099951',pregnancy:'Singleton',sheet:1,eqa:{surname:'SYNTHETICEQA',firstName:'SAMPLE',dob:'1990-01-01'}},{ln:'9900099512',hn:'9900099952',pregnancy:'Singleton',sheet:2},{ln:'9900099513',hn:'9900099953',pregnancy:'Twins',sheet:3}]);try{
  const p=await pending(f,0);
  const r=await send(f,[p]);
  expect(r.items[0]).toEqual({versionId:p.id,outcome:'CertifiedReleased'});
  expect(await count(f,'SELECT 1 FROM result_release WHERE version_id=$1',[p.id])).toBe(1);
  expect(await count(f,OUTBOX)).toBe(0);
 }finally{vi.unstubAllEnvs();await f.close();}
},180000);

it('EQA report: board scope EQA lists it in READY (PATIENT scope does not), Send HIS certifies it, and no HIS outbox job is created (F1)',async()=>{
 const f=await task3Fixture([{ln:'9900099511',hn:'9900099951',pregnancy:'Singleton',sheet:1,eqa:{surname:'SYNTHETICEQA',firstName:'SAMPLE',dob:'1990-01-01'}},{ln:'9900099512',hn:'9900099952',pregnancy:'Singleton',sheet:2},{ln:'9900099513',hn:'9900099953',pregnancy:'Twins',sheet:3}]);try{
  const p=await pending(f,0);
  const board=(scope?:'EQA'|'PATIENT')=>f.run(t=>releaseQueue(t,f.admin,{store:f.store},{tab:'READY',...(scope?{scope}:{})}));
  expect((await board('EQA')).rows.map(r=>r.versionId)).toContain(p.id);
  expect((await board()).rows.map(r=>r.versionId)).not.toContain(p.id);
  const r=await send(f,[p]);
  expect(r.items[0]).toEqual({versionId:p.id,outcome:'CertifiedReleased'});
  expect((await f.db.query<{state:string}>('SELECT state FROM result_report_version WHERE id=$1',[p.id])).rows[0].state).toBe('CertifiedReleased');
  expect(await count(f,OUTBOX)).toBe(0);
  const sent=await f.run(t=>releaseQueue(t,f.admin,{store:f.store},{tab:'SENT',scope:'EQA'}));
  expect(sent.rows.map(x=>x.versionId)).toContain(p.id);
 }finally{vi.unstubAllEnvs();await f.close();}
},180000);

it('void is refused while an active HIS-presence attestation exists; after withdrawing it the void succeeds (F2)',async()=>{
 const f=await task3Fixture();try{
  const p=await pending(f,0);
  const att=await f.run(t=>attestHisPresence(t,f.u.staff,{versionId:p.id,confirmed:true}));
  const voidIt=async()=>f.run(async t=>voidVersion(t,f.admin,{versionId:p.id,reason:'SYNTHETIC discard this waiting item',expectedRowVersion:await rowVersion(f,p.id)}));
  await expect(voidIt()).rejects.toMatchObject({code:'HIS_ATTESTATION_ACTIVE',status:409});
  expect((await f.db.query<{state:string}>('SELECT state FROM result_report_version WHERE id=$1',[p.id])).rows[0].state).toBe('PendingCertification');
  await f.run(t=>withdrawHisAttestation(t,f.u.staff,{attestationId:att.id,reason:'SYNTHETIC HIS does not hold it'}));
  expect(await voidIt()).toEqual({outcome:'Voided'});
 }finally{vi.unstubAllEnvs();await f.close();}
},180000);

/** Makes the version's QC5 look like it was recorded for another attempt (synthetic DB, triggers off). */
async function bindQc5ToOtherAttempt(f:F,id:string){
 const other=(await f.db.query<{id:string}>('SELECT a.id FROM analytical_attempt a WHERE a.id<>(SELECT attempt_id FROM result_report_version WHERE id=$1) LIMIT 1',[id])).rows[0].id;
 await f.db.query('ALTER TABLE result_qc5_review DISABLE TRIGGER USER');
 await f.db.query('UPDATE result_qc5_review SET attempt_id=$2 WHERE version_id=$1',[id,other]);
 await f.db.query('ALTER TABLE result_qc5_review ENABLE TRIGGER USER');
}

it('QC5 bound to another attempt: item ERROR QC5_BOUND_TO_OTHER_ATTEMPT, nothing written, sibling released (F4a)',async()=>{
 const f=await task3Fixture();try{
  const a=await pending(f,0),b=await pending(f,1);
  await bindQc5ToOtherAttempt(f,a.id);
  const r=await send(f,[a,b]);
  expect(r.items[0]).toMatchObject({versionId:a.id,outcome:'ERROR',code:'QC5_BOUND_TO_OTHER_ATTEMPT'});
  expect(r.items[1]).toEqual({versionId:b.id,outcome:'CertifiedReleased'});
  expect(await count(f,'SELECT 1 FROM result_review WHERE version_id=$1',[a.id])).toBe(1);
  expect(await count(f,'SELECT 1 FROM result_release WHERE version_id=$1',[a.id])).toBe(0);
  expect(await count(f,OUTBOX)).toBe(1);
 }finally{vi.unstubAllEnvs();await f.close();}
},180000);

it('a reviewed, gate-eligible version still in Linked/ValidationBlocked is validated first and then released instead of failing the DB transition guard (F4b)',async()=>{
 const f=await task3Fixture();try{
  const a=await pending(f,0),b=await pending(f,1);
  // Put a and b back to Linked / ValidationBlocked with review + QC5 intact (what a relink-then-revalidate leaves behind).
  await f.db.query('ALTER TABLE result_report_version DISABLE TRIGGER USER');
  await f.db.query("UPDATE result_report_version SET state='Linked' WHERE id=$1",[a.id]);await f.db.query("UPDATE result_report_version SET state='ValidationBlocked' WHERE id=$1",[b.id]);
  await f.db.query('ALTER TABLE result_report_version ENABLE TRIGGER USER');
  const r=await send(f,[a,b]);
  expect(r.items).toEqual([{versionId:a.id,outcome:'CertifiedReleased'},{versionId:b.id,outcome:'CertifiedReleased'}]);
  expect(await count(f,'SELECT 1 FROM result_release WHERE version_id=ANY($1::uuid[])',[[a.id,b.id]])).toBe(2);
 }finally{vi.unstubAllEnvs();await f.close();}
},180000);

it('a database guard exception (plain P0001 with an UPPER_SNAKE code) fails only its own item; siblings are released and the failed item leaves no rows (F4c)',async()=>{
 const f=await task3Fixture();try{
  const a=await pending(f,0),b=await pending(f,1);
  // A guard that raises for version a only, exactly like the release guards do.
  await f.db.query("CREATE FUNCTION synthetic_release_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.version_id='"+a.id+"' THEN RAISE EXCEPTION 'SYNTHETIC_RELEASE_GUARD_REFUSED'; END IF; RETURN NEW; END $$");
  await f.db.query('CREATE TRIGGER synthetic_release_guard BEFORE INSERT ON result_release FOR EACH ROW EXECUTE FUNCTION synthetic_release_guard()');
  try{
   const r=await send(f,[a,b]);
   expect(r.items[0]).toEqual({versionId:a.id,outcome:'ERROR',code:'SYNTHETIC_RELEASE_GUARD_REFUSED'});
   expect(r.items[1]).toEqual({versionId:b.id,outcome:'CertifiedReleased'});
   expect(await count(f,'SELECT 1 FROM result_release WHERE version_id=$1',[a.id])).toBe(0);
   expect((await f.db.query<{state:string}>('SELECT state FROM result_report_version WHERE id=$1',[a.id])).rows[0].state).toBe('PendingCertification');
   expect(await count(f,OUTBOX)).toBe(1);
  }finally{await f.db.query('DROP TRIGGER synthetic_release_guard ON result_release');await f.db.query('DROP FUNCTION synthetic_release_guard()');}
 }finally{vi.unstubAllEnvs();await f.close();}
},180000);
