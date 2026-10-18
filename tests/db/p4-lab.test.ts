import {describe,it,expect,beforeEach,afterEach} from 'vitest';
import type {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import {testDatabase} from '../helpers/database';
import {tx,labUsers,setPendingPolicy,syntheticCase,receiveS1,docDeps,attemptOf,version} from '../helpers/lab';
import {formatLnHalos,LN_HALOS_PATTERN} from '../../packages/lab/rules';
import * as intake from '../../packages/lab/intake';
import * as batch from '../../packages/lab/batch';
import * as rec from '../../packages/lab/records';
import {FIELDS} from '../../packages/lab/fields';
import type {Queryable} from '../../packages/db/connection';

let db:PGlite,u:Awaited<ReturnType<typeof labUsers>>,docs:Awaited<ReturnType<typeof docDeps>>;
beforeEach(async()=>{db=await testDatabase();u=await labUsers(db);docs=await docDeps();});
afterEach(async()=>{await db.close();await docs.close();});
const q=(db0:PGlite)=>db0 as unknown as Queryable;
const run=<T>(fn:(t:Queryable)=>Promise<T>)=>tx(q(db),fn);
const lnHalos=async(roundId:string)=>(await db.query<{ln_halos:string}>('SELECT ln_halos FROM specimen_lab_number WHERE round_id=$1',[roundId])).rows[0]?.ln_halos;
async function received(o:Parameters<typeof syntheticCase>[2]={},at=new Date()){const c=await run(t=>syntheticCase(t,u,o));await run(t=>receiveS1(t,c,at));return c;}
async function readyBatch(caseCount:number){
 await setPendingPolicy(q(db),u,'PROCEED_SYNTHETIC_LABELLED');
 const cases=[];for(let i=0;i<caseCount;i++)cases.push(await received({},new Date(Date.now()-(caseCount-i)*60000)));
 const b=await run(t=>batch.createBatch(t,u.staff));
 const attempts=await Promise.all(cases.map(c=>attemptOf(q(db),c.roundId)));
 const r=await run(t=>batch.assignToBatch(t,u.staff,{batchId:b.batchId,expectedVersion:0,attemptIds:attempts.map(a=>a.id)}));
 return {cases,b,attempts,r};
}
async function finalize(batchId:string,sheet=1){
 await run(async t=>batch.updateSheetPlan(t,u.staff,{batchId,expectedVersion:await version(t,batchId),sheetNumber:sheet,plannedWorkDate:'2026-10-12',plannedOperator:'จำลอง ผู้ปฏิบัติ',plannedExtractionLot:null,plannedExtractionExpiry:null,plannedLibraryLot:null,plannedLibraryExpiry:null}));
 await run(async t=>batch.planCheck(t,u.staff,{batchId,expectedVersion:await version(t,batchId),sheetNumber:sheet,confirm:{controlsAtTemplate:true,identifiersMatch:true,noDuplicates:true}}));
 return run(async t=>batch.finalizeSheet(t,u.staff,{batchId,expectedVersion:await version(t,batchId),sheetNumber:sheet}));
}

describe('LN Halos issuance at actual receipt (AT-LNH-01..03, AT-LABEL-05, AT-IDPAR-01/02/10)',()=>{
 it('registration issues nothing; S1 HIS receipt issues exactly one YYBYYMMDDNNN in Bangkok time plus attempt #1',async()=>{
  const c=await run(t=>syntheticCase(t,u));
  expect(await lnHalos(c.roundId)).toBeUndefined();expect(await attemptOf(q(db),c.roundId)).toBeUndefined();
  await run(t=>receiveS1(t,c));
  const code=await lnHalos(c.roundId);expect(code).toMatch(LN_HALOS_PATTERN);expect(code).toBe(formatLnHalos(1,new Date()));
  expect(await attemptOf(q(db),c.roundId)).toMatchObject({state:'Ready',printed_sample_id:null});
  const second=await received();expect(await lnHalos(second.roundId)).toBe(formatLnHalos(2,new Date()));
  // HIS LN is untouched and never replaced by LN Halos.
  expect((await db.query<{ln:string}>('SELECT ln FROM case_ln WHERE case_id=$1',[c.caseId])).rows[0].ln).toBe(c.ln);
 });
 it('the issuer is the SQL format and Bangkok calendar day, including the midnight rollover and 001/999',async()=>{
  const r=await db.query<{a:string;b:string;c:string;d:string}>(`SELECT p4_format_ln_halos(p4_bangkok_date('2026-05-31T16:59:59Z'),5) a,p4_format_ln_halos(p4_bangkok_date('2026-05-31T17:00:00Z'),1) b,p4_format_ln_halos('2026-12-31',999) c,p4_format_ln_halos(p4_bangkok_date('2026-12-31T17:00:00Z'),1) d`);
  expect(r.rows[0]).toEqual({a:formatLnHalos(5,new Date('2026-05-31T16:59:59Z')),b:'26B260601001',c:'26B261231999',d:'27B270101001'});
 });
 it('Bangkok month stays constant at midnight between days and changes on first day of month',async()=>{
  const m=await db.query<{oct:string;still_oct:string;nov:string}>(`SELECT p4_ln_halos_month('2026-10-12'::date)::text oct,p4_ln_halos_month(p4_bangkok_date('2026-10-31T16:59:59Z'))::text still_oct,p4_ln_halos_month(p4_bangkok_date('2026-10-31T17:00:00Z'))::text nov`);
  expect(m.rows[0]).toEqual({oct:'2026-10-01',still_oct:'2026-10-01',nov:'2026-11-01'});
 });
 it('stops at 999 per Bangkok month without wrapping, and the failed receipt rolls back entirely',async()=>{
  const c=await run(t=>syntheticCase(t,u));
  await db.query("INSERT INTO ln_halos_monthly_sequence(sequence_month,last_value) VALUES(p4_ln_halos_month(p4_bangkok_date(now())),999)");
  await expect(run(t=>receiveS1(t,c))).rejects.toThrow(/LN_HALOS_MONTHLY_SEQUENCE_EXHAUSTED/);
  expect((await db.query("SELECT state FROM specimen_round WHERE id=$1",[c.roundId])).rows[0]).toEqual({state:'Expected'});
 });
 it('numbers are immutable, unique, and cannot be forged by direct insert or re-issued by recovery',async()=>{
  const c=await received();const code=await lnHalos(c.roundId);
  await expect(db.query("UPDATE specimen_lab_number SET ln_halos='26B261012999' WHERE round_id=$1",[c.roundId])).rejects.toThrow(/append-only/);
  await expect(db.query("INSERT INTO specimen_lab_number(round_id,case_id,ln_halos,sequence_date,sequence_value,issued_on,issue_path) VALUES($1,$2,'26B261012777','2026-10-12',778,'HIS_PET_RECEIPT','RECEIPT_TRIGGER')",[c.roundId,c.caseId])).rejects.toThrow();
  expect(await run(t=>intake.recoverLnHalos(t,u.staff,{roundId:c.roundId,reason:'จำลอง ตรวจซ้ำเลข'}))).toEqual({lnHalos:code,duplicate:true});
  expect((await db.query('SELECT count(*)::int n FROM specimen_lab_number')).rows[0]).toEqual({n:1});
 });
 it('a round received before P4 (no number) is recovered once through the same receipt-bound issuer',async()=>{
  const c=await run(t=>syntheticCase(t,u));
  await db.query('ALTER TABLE specimen_round DISABLE TRIGGER p4_receipt_issue');await run(t=>receiveS1(t,c));await db.query('ALTER TABLE specimen_round ENABLE TRIGGER p4_receipt_issue');
  expect((await run(t=>intake.labWorklist(t,u.staff))).missing.map(m=>m.roundId)).toEqual([c.roundId]);
  const r=await run(t=>intake.recoverLnHalos(t,u.staff,{roundId:c.roundId,reason:'จำลอง รับก่อนเปิด P4'}));
  expect(r.duplicate).toBe(false);expect(await lnHalos(c.roundId)).toBe(r.lnHalos);
  expect((await db.query("SELECT issue_path FROM specimen_lab_number WHERE round_id=$1",[c.roundId])).rows[0]).toEqual({issue_path:'RECEIPT_RECOVERY'});
  const expected=await run(t=>syntheticCase(t,u));
  await expect(run(t=>intake.recoverLnHalos(t,u.staff,{roundId:expected.roundId,reason:'จำลอง ยังไม่รับ'}))).rejects.toThrow('LN_HALOS_REQUIRES_RECEIPT');
 });
 it('worker_rw receipts still issue through the definer trigger, but the worker can never write lab numbers itself',async()=>{
  await db.exec(await readFile('packages/db/roles.sql','utf8'));
  const c=await run(t=>syntheticCase(t,u));
  const file=(await db.query<{id:string}>("INSERT INTO his_inbound_file(sha256,state) VALUES(repeat('a',64),'Applied(S1)') RETURNING id")).rows[0].id;
  await db.query('INSERT INTO his_order(case_ln_id,inbound_file_id,his_received_at) VALUES($1,$2,now())',[c.lnId,file]);
  const at=(await db.query<{t:Date}>('SELECT his_received_at t FROM his_order WHERE inbound_file_id=$1',[file])).rows[0].t;
  await db.query('SET ROLE worker_rw');
  try{
   await db.query("UPDATE specimen_round SET received_source='HIS_PET_RECEIPT',received_at=$2,state='ReceivedInHIS' WHERE id=$1",[c.roundId,at]);
   await expect(db.query("INSERT INTO ln_halos_monthly_sequence VALUES('2030-01-01',1)")).rejects.toThrow(/permission/);
   await expect(db.query('SELECT p4_ensure_ln_halos($1,$2)',[c.roundId,'RECEIPT_RECOVERY'])).rejects.toThrow(/permission/);
  }finally{await db.query('RESET ROLE');}
  expect(await lnHalos(c.roundId)).toMatch(LN_HALOS_PATTERN);
 });
});

describe('Ready queue, gates and FIFO (§12.9, §5.9.1)',()=>{
 it('HOLD policy: pending governance (OD-01/08) blocks; real failures stay failures; nothing is batched on receipt',async()=>{
  const ok=await received(),bad=await received({clinical:'BlockedWithReason'}),none=await received({evidence:false});
  const w=await run(t=>intake.labWorklist(t,u.staff));
  const row=(id:string)=>w.attempts.find(a=>a.roundId===id)!;
  expect(w.policy).toBe('HOLD');
  expect(row(ok.roundId)).toMatchObject({category:'GATE_BLOCKED',gate:{eligible:false,failed:[]}});
  expect(row(ok.roundId).gate!.pending).toEqual(['OD-01:SPECIMEN_ACCEPTANCE_POLICY','OD-08:CLINICAL_RULES_NOT_APPROVED']);
  expect(row(bad.roundId).gate!.failed).toContain('CLINICAL_BLOCKEDWITHREASON');
  expect(row(none.roundId).gate!.failed).toEqual(expect.arrayContaining(['CONSENT_NOT_GRANTED','REQUEST_NOT_VERIFIED','CLINICAL_NOT_ASSESSED']));
  expect((await db.query('SELECT count(*)::int n FROM lab_slot_assignment')).rows[0]).toEqual({n:0});
 });
 it('BG-04: a Paper Consent marker passes without a paper consent review (not signing evidence); a recorded refusal still fails',async()=>{
  const marker=await received({evidence:false}),declined=await received({evidence:false});
  for(const c of [marker,declined])await db.query("INSERT INTO p2_workspace(round_id,case_id,draft,request_mode,consent_mode,updated_by) VALUES($1,$2,'{}','Paper','Paper',$3)",[c.roundId,c.caseId,u.staff.id]);
  await db.query("INSERT INTO p2_paper_review(case_id,round_id,kind,template_version,document_reference,panel,status,location,reason,verifier_id) VALUES($1,$2,'CONSENT','SYNTHETIC-FM02-v1','SYNTHETIC-REF','{}','Declined','SYNTHETIC','SYNTHETIC refusal recorded',$3)",[declined.caseId,declined.roundId,u.staff.id]);
  const w=await run(t=>intake.labWorklist(t,u.staff)),row=(id:string)=>w.attempts.find(a=>a.roundId===id)!;
  expect(row(marker.roundId).gate!.failed).not.toContain('CONSENT_NOT_GRANTED');expect(row(marker.roundId).gate!.failed).toContain('REQUEST_NOT_VERIFIED'); // paper Request unchanged
  expect(row(declined.roundId).gate!.failed).toContain('CONSENT_DECLINED');
  // A later Pending paper row or choosing Paper again never hides the recorded refusal; a later verified paper decision lifts it.
  await db.query("INSERT INTO p2_paper_review(case_id,round_id,kind,template_version,document_reference,panel,status,location,reason,verifier_id,created_at) VALUES($1,$2,'CONSENT','SYNTHETIC-FM02-v1','SYNTHETIC-LATER','{}','Pending','SYNTHETIC','SYNTHETIC later pending row',$3,now()+interval '1 minute')",[declined.caseId,declined.roundId,u.staff.id]);
  const w2=await run(t=>intake.labWorklist(t,u.staff));expect(w2.attempts.find(a=>a.roundId===declined.roundId)!.gate!.failed).toContain('CONSENT_DECLINED');
  await db.query("INSERT INTO p2_paper_review(case_id,round_id,kind,template_version,document_reference,panel,status,location,reason,verifier_id,created_at) VALUES($1,$2,'CONSENT','SYNTHETIC-FM02-v1','SYNTHETIC-GRANTED','{\"decision\":\"Granted\"}','Verified','SYNTHETIC','SYNTHETIC later verified decision',$3,now()+interval '2 minutes')",[declined.caseId,declined.roundId,u.staff.id]);
  const w3=await run(t=>intake.labWorklist(t,u.staff));expect(w3.attempts.find(a=>a.roundId===declined.roundId)!.gate!.failed).not.toContain('CONSENT_DECLINED');
 });
 it('PROCEED_SYNTHETIC_LABELLED (maker-checker) passes only PENDING, labelled; FAIL never passes',async()=>{
  const ok=await received(),bad=await received({clinical:'ClinicalDataConflict'});
  await setPendingPolicy(q(db),u,'PROCEED_SYNTHETIC_LABELLED');
  const w=await run(t=>intake.labWorklist(t,u.staff));
  expect(w.attempts.find(a=>a.roundId===ok.roundId)).toMatchObject({category:'READY',gate:{eligible:true,syntheticPendingAccepted:true}});
  expect(w.attempts.find(a=>a.roundId===bad.roundId)).toMatchObject({category:'GATE_BLOCKED'});
  const b=await run(t=>batch.createBatch(t,u.staff));
  const r=await run(async t=>batch.assignToBatch(t,u.staff,{batchId:b.batchId,expectedVersion:0,attemptIds:[(await attemptOf(t,bad.roundId)).id]}));
  expect(r.placed).toEqual([]);expect(r.rejected[0].failed).toContain('CLINICAL_CLINICALDATACONFLICT');
 });
 it('FIFO by receipt time; Urgent needs a reason and is an audited bypass; overtaking eligible work needs a recorded reason',async()=>{
  await setPendingPolicy(q(db),u,'PROCEED_SYNTHETIC_LABELLED');
  const old=await received({},new Date(Date.now()-3*3600000)),mid=await received({},new Date(Date.now()-2*3600000)),late=await received({},new Date(Date.now()-3600000));
  let w=await run(t=>intake.labWorklist(t,u.staff));expect(w.attempts.map(a=>a.roundId)).toEqual([old.roundId,mid.roundId,late.roundId]);
  const lateAttempt=await attemptOf(q(db),late.roundId);
  await expect(run(t=>intake.setUrgent(t,u.staff,{attemptId:lateAttempt.id,urgent:true,reason:'สั้น'}))).rejects.toThrow();
  await run(t=>intake.setUrgent(t,u.staff,{attemptId:lateAttempt.id,urgent:true,reason:'จำลอง แพทย์ขอเร่งด่วน'}));
  // Receive Date Sorting Owner Lock: display stays receive-time ASC; Urgent is a visible, audited flag (not a silent re-sort).
  w=await run(t=>intake.labWorklist(t,u.staff));expect(w.attempts.map(a=>a.roundId)).toEqual([old.roundId,mid.roundId,late.roundId]);expect(w.attempts[2]).toMatchObject({urgent:true,urgentReason:'จำลอง แพทย์ขอเร่งด่วน'});
  const b=await run(t=>batch.createBatch(t,u.staff));const midAttempt=await attemptOf(q(db),mid.roundId);
  await expect(run(t=>batch.assignToBatch(t,u.staff,{batchId:b.batchId,expectedVersion:0,attemptIds:[midAttempt.id]}))).rejects.toMatchObject({code:'QUEUE_OVERRIDE_REASON_REQUIRED'});
  const r=await run(t=>batch.assignToBatch(t,u.staff,{batchId:b.batchId,expectedVersion:0,attemptIds:[midAttempt.id],queueOverrideReason:'จำลอง ตัวอย่างนี้พร้อมก่อน'}));
  expect(r.placed).toEqual([{attemptId:midAttempt.id,slot:2,printedSampleId:(await lnHalos(mid.roundId))+'-1'}]);
  expect((await db.query("SELECT reason FROM attempt_event WHERE attempt_id=$1 AND event_type='QUEUE_OVERRIDE'",[midAttempt.id])).rows).toEqual([{reason:'จำลอง ตัวอย่างนี้พร้อมก่อน'}]);
 });
});

describe('Batch / Task List 1–3 (§12.4, §12.9; AT-TASK, AT-IDPAR-05/06/11)',()=>{
 it('Run label, 48 template slots, PC1/NC25/Blank40 skipped and protected, single Draft batch',async()=>{
  const {b,r,attempts}=await readyBatch(3);
  expect(b.runLabel).toMatch(/^Run001\/20\d\d$/);
  expect(await run(t=>batch.createBatch(t,u.staff))).toEqual({batchId:b.batchId,runLabel:b.runLabel,created:false});
  expect(r.placed.map(p=>p.slot)).toEqual([2,3,4]);
  const slots=(await db.query<{slot_number:number;control_type:string|null;plate_position:string;barcode_index:number}>('SELECT slot_number,control_type,plate_position,barcode_index FROM lab_batch_slot WHERE batch_id=$1 AND control_type IS NOT NULL ORDER BY slot_number',[b.batchId])).rows;
  expect(slots).toEqual([{slot_number:1,control_type:'positive',plate_position:'A1',barcode_index:1},{slot_number:25,control_type:'negative',plate_position:'A4',barcode_index:25},{slot_number:40,control_type:'blank',plate_position:'H5',barcode_index:40}]);
  const v=await version(q(db),b.batchId);
  await expect(run(t=>batch.moveSlot(t,u.staff,{batchId:b.batchId,expectedVersion:v,fromSlot:2,toSlot:1}))).rejects.toMatchObject({code:'CONTROL_SLOT_PROTECTED'});
  await expect(db.query('INSERT INTO lab_slot_assignment(batch_id,slot_number,attempt_id,assigned_by) VALUES($1,25,$2,$3)',[b.batchId,attempts[0].id,u.staff.id])).rejects.toThrow(/CONTROL_SLOT_PROTECTED|duplicate/);
  // A partial batch creates no phantom samples or IDs.
  expect((await db.query('SELECT count(*)::int n FROM lab_slot_assignment WHERE batch_id=$1 AND removed_at IS NULL',[b.batchId])).rows[0]).toEqual({n:3});
 });
 it('slot collision: one live slot per attempt; optimistic version; move, swap and remove with Draft-only rules',async()=>{
  const {b,attempts}=await readyBatch(2);let v=await version(q(db),b.batchId);
  await expect(db.query('INSERT INTO lab_slot_assignment(batch_id,slot_number,attempt_id,assigned_by) VALUES($1,10,$2,$3)',[b.batchId,attempts[0].id,u.staff.id])).rejects.toThrow(/duplicate|unique/);
  await expect(run(t=>batch.moveSlot(t,u.staff,{batchId:b.batchId,expectedVersion:v-1,fromSlot:2,toSlot:10}))).rejects.toMatchObject({code:'VERSION_CONFLICT'});
  v=(await run(t=>batch.moveSlot(t,u.staff,{batchId:b.batchId,expectedVersion:v,fromSlot:2,toSlot:18}))).version;
  const swap=await run(t=>batch.moveSlot(t,u.staff,{batchId:b.batchId,expectedVersion:v,fromSlot:3,toSlot:18}));expect(swap.swapped).toBe(true);
  const live=(await db.query<{slot_number:number;attempt_id:string}>('SELECT slot_number,attempt_id FROM lab_slot_assignment WHERE batch_id=$1 AND removed_at IS NULL ORDER BY slot_number',[b.batchId])).rows;
  expect(live).toEqual([{slot_number:3,attempt_id:attempts[0].id},{slot_number:18,attempt_id:attempts[1].id}]);
  await run(t=>batch.removeFromBatch(t,u.staff,{batchId:b.batchId,expectedVersion:swap.version,slot:18}));
  expect((await attemptOf(q(db),(await db.query<{round_id:string}>('SELECT round_id FROM analytical_attempt WHERE id=$1',[attempts[1].id])).rows[0].round_id)).state).toBe('Ready');
  expect((await db.query('SELECT count(*)::int n FROM lab_slot_assignment WHERE batch_id=$1',[b.batchId])).rows[0]).toEqual({n:5}); // history kept
 });
 it('plan check is not pipetting evidence; finalize creates an immutable snapshot; no ✓ is recordable before execution',async()=>{
  const {b,cases,attempts}=await readyBatch(2);
  await expect(run(async t=>batch.planCheck(t,u.staff,{batchId:b.batchId,expectedVersion:await version(t,b.batchId),sheetNumber:1,confirm:{controlsAtTemplate:true,identifiersMatch:true,noDuplicates:true}}))).rejects.toMatchObject({code:'PLANNED_WORK_DATE_REQUIRED_FOR_CONTROL_CODES'});
  const f=await finalize(b.batchId);
  expect(f.pendingAccepted).toEqual(['OD-01:SPECIMEN_ACCEPTANCE_POLICY','OD-08:CLINICAL_RULES_NOT_APPROVED']);
  const snap=(await db.query<{payload:{slots:{slot:number;printedControlId:string|null;printedSampleId:string|null;lnHalos:string|null}[]}}>('SELECT payload FROM lab_placement_snapshot WHERE batch_id=$1',[b.batchId])).rows[0].payload;
  expect(snap.slots[0]).toMatchObject({slot:1,printedControlId:'26N120261012-1'});
  expect(snap.slots[1]).toMatchObject({slot:2,printedSampleId:(await lnHalos(cases[0].roundId))+'-1'});
  expect(snap.slots.filter(s=>s.printedSampleId)).toHaveLength(2);
  expect(JSON.stringify(snap)).not.toMatch(/F2-11|before|after|executionStarted/);
  await expect(db.query("UPDATE lab_placement_snapshot SET payload='{}' WHERE batch_id=$1",[b.batchId])).rejects.toThrow(/append-only/);
  expect((await attemptOf(q(db),cases[0].roundId)).state).toBe('Assigned');
  expect((await db.query<{analysis_started:boolean}>('SELECT analysis_started FROM specimen_round WHERE id=$1',[cases[0].roundId])).rows[0].analysis_started).toBe(true);
  await expect(run(async t=>batch.removeFromBatch(t,u.staff,{batchId:b.batchId,expectedVersion:await version(t,b.batchId),slot:2,reason:'จำลอง ถอดหลัง finalize'}))).rejects.toMatchObject({code:'PLACEMENT_LOCKED'});
  await expect(run(async t=>rec.recordObservation(t,u.staff,{batchId:b.batchId,expectedVersion:await version(t,b.batchId),sheetNumber:1,slot:2,fieldId:'F2-11',value:{before:true,after:true},source:'DIRECT_ENTRY'}))).rejects.toThrow(/EXECUTION_NOT_STARTED/);
  await expect(run(async t=>batch.startExecution(t,u.staff,{batchId:b.batchId,expectedVersion:await version(t,b.batchId),sheetNumber:1}))).rejects.toMatchObject({code:'PRE_WORK_REQUIRED_BEFORE_EXECUTION'});
  expect(attempts).toHaveLength(2);
 });
 it('Finalize Gate rejects the whole sheet when anything changed after plan check (AT-BG-STAGE-03)',async()=>{
  const {b,cases}=await readyBatch(2);
  await run(async t=>batch.updateSheetPlan(t,u.staff,{batchId:b.batchId,expectedVersion:await version(t,b.batchId),sheetNumber:1,plannedWorkDate:'2026-10-12',plannedOperator:null,plannedExtractionLot:null,plannedExtractionExpiry:null,plannedLibraryLot:null,plannedLibraryExpiry:null}));
  await run(async t=>batch.planCheck(t,u.staff,{batchId:b.batchId,expectedVersion:await version(t,b.batchId),sheetNumber:1,confirm:{controlsAtTemplate:true,identifiersMatch:true,noDuplicates:true}}));
  await db.query("INSERT INTO p2_revocation(case_id,round_id,stage,reason,actor_id) VALUES($1,$2,'W0','SYNTHETIC_WITHDRAWAL',$3)",[cases[1].caseId,cases[1].roundId,u.staff.id]);
  const e=await run(async t=>batch.finalizeSheet(t,u.staff,{batchId:b.batchId,expectedVersion:await version(t,b.batchId),sheetNumber:1})).catch(x=>x);
  expect(e.code).toBe('FINALIZE_GATE_FAILED');expect(e.details).toEqual([expect.objectContaining({failed:['CONSENT_REVOKED']})]);
  expect((await db.query("SELECT state FROM lab_task_sheet WHERE batch_id=$1 AND sheet_number=1",[b.batchId])).rows[0]).toEqual({state:'PlanChecked'});
  expect((await db.query('SELECT count(*)::int n FROM lab_placement_snapshot')).rows[0]).toEqual({n:0});
 });
});

describe('Pre-work → execution → reconciliation → Completed → QC1 (§12.9 ขั้น 9–13, §12.20, §12.21, §12.26)',()=>{
 it('runs the full synthetic sheet lifecycle with second-person verification and pending QC1 criteria',async()=>{
  const {b,cases,attempts}=await readyBatch(2);await finalize(b.batchId);
  const V=()=>version(q(db),b.batchId);
  const pre=await run(async t=>rec.issuePreWork(t,u.staff,{batchId:b.batchId,expectedVersion:await V(),sheetNumber:1},docs.deps));
  const preDoc=docs.rendered.at(-1)!;expect(preDoc).toMatchObject({form:'F2',kind:'PRE_WORK',runLabel:b.runLabel});
  if(preDoc.form!=='F2')throw Error();expect(preDoc.execution).toEqual([]);expect(preDoc.rows.every(r=>r.transfer===null)).toBe(true);
  const qcPre=await run(async t=>rec.issueQcPreWork(t,u.staff,{batchId:b.batchId,expectedVersion:await V()},docs.deps));
  expect((await run(async t=>rec.issueQcPreWork(t,u.staff,{batchId:b.batchId,expectedVersion:await V()},docs.deps))).unchanged).toBe(true);
  expect(qcPre.revision).toBe(1);
  // Original reprint is byte-identical; a working copy is a derivative with its own hash.
  const orig=await run(t=>rec.printDocument(t,u.staff,{documentId:pre.id,kind:'ORIGINAL_REPRINT'},docs.deps));
  expect(orig.sha256).toBe(pre.fileSha256);
  const copy=await run(t=>rec.printDocument(t,u.staff,{documentId:pre.id,kind:'WORKING_COPY'},docs.deps));
  expect(copy.copyNumber).toBe(1);expect(copy.sha256).not.toBe(pre.fileSha256);expect(docs.rendered.at(-1)!.copy).toMatchObject({kind:'WORKING_COPY',copyNumber:1,originalHash:pre.fileSha256});
  await run(async t=>batch.startExecution(t,u.staff,{batchId:b.batchId,expectedVersion:await V(),sheetNumber:1}));
  expect((await attemptOf(q(db),cases[0].roundId)).state).toBe('InProgress');
  await expect(db.query("UPDATE lab_task_sheet SET execution_started_at=now()-interval '1 day' WHERE batch_id=$1 AND sheet_number=1",[b.batchId])).rejects.toThrow(/EXECUTION_ANCHOR_IMMUTABLE/);
  // Paper value before the execution anchor is refused; NOT_RECORDED time stays NULL.
  await expect(run(async t=>rec.recordObservation(t,u.staff,{batchId:b.batchId,expectedVersion:await V(),sheetNumber:1,fieldId:'F2-05',value:{text:'จำลอง ผู้ปฏิบัติ'},source:'PAPER_TRANSCRIPTION',documentCopyId:copy.copyId,eventTime:new Date(Date.now()-86400000).toISOString()}))).rejects.toThrow(/EVENT_BEFORE_EXECUTION_ANCHOR/);
  const ids:string[]=[];const add=async(x:Record<string,unknown>)=>ids.push((await run(async t=>rec.recordObservation(t,u.staff,{batchId:b.batchId,expectedVersion:await V(),...x}))).id);
  await add({sheetNumber:1,fieldId:'F2-05',value:{text:'จำลอง ผู้ปฏิบัติ'},source:'PAPER_TRANSCRIPTION',documentCopyId:copy.copyId,eventPrecision:'NOT_RECORDED'});
  await add({sheetNumber:1,fieldId:'F2-02',value:{date:'2026-10-12'},source:'DIRECT_ENTRY'});
  for(const f of ['F2-13','F2-14'])await add({sheetNumber:1,fieldId:f,value:{lot:'SYN-LOT-1',expiry:'2027-01-31'},source:'DIRECT_ENTRY'});
  await add({sheetNumber:1,fieldId:'F2-24',value:{start:'09:00',end:'11:30'},source:'DIRECT_ENTRY'});
  for(const f of FIELDS.filter(x=>x.form==='F2'&&x.kind==='CHECK'&&x.required(1)))await add({sheetNumber:1,fieldId:f.id,item:f.item,value:{checked:true},source:'DIRECT_ENTRY'});
  for(const slot of [1,2,3])await add({sheetNumber:1,slot,fieldId:'F2-11',value:{before:true,after:true},source:'DIRECT_ENTRY'});
  await expect(run(async t=>rec.recordObservation(t,u.staff,{batchId:b.batchId,expectedVersion:await V(),sheetNumber:1,slot:5,fieldId:'F2-11',value:{before:true,after:true},source:'DIRECT_ENTRY'}))).rejects.toMatchObject({code:'SLOT_NOT_IN_USE'});
  expect((await db.query<{event_time:Date|null}>("SELECT event_time FROM lab_observation WHERE field_id='F2-05'")).rows[0].event_time).toBeNull();
  await run(async t=>batch.endExecution(t,u.staff,{batchId:b.batchId,expectedVersion:await V(),sheetNumber:1}));
  await expect(run(async t=>rec.verifyExecution(t,u.certifier,{batchId:b.batchId,expectedVersion:await V(),sheetNumber:1}))).rejects.toMatchObject({code:'EXECUTION_EVIDENCE_INCOMPLETE'});
  await expect(run(t=>rec.reviewObservations(t,{...u.certifier,id:u.staff.id},{observationIds:ids,result:'Confirmed'}))).rejects.toMatchObject({code:'SECOND_PERSON_REQUIRED'});
  await expect(run(t=>rec.reviewObservations(t,u.staff2,{observationIds:ids,result:'Confirmed'}))).rejects.toMatchObject({code:'FORBIDDEN'});
  await run(t=>rec.reviewObservations(t,u.certifier,{observationIds:ids,result:'Confirmed'}));
  await run(async t=>rec.verifyExecution(t,u.certifier,{batchId:b.batchId,expectedVersion:await V(),sheetNumber:1}));
  await run(async t=>rec.issueCompleted(t,u.staff,{batchId:b.batchId,expectedVersion:await V(),sheetNumber:1},docs.deps));
  const done=docs.rendered.at(-1)!;if(done.form!=='F2')throw Error();
  expect(done.kind).toBe('COMPLETED');expect(done.rows.filter(r=>r.transfer?.status==='MEASURED')).toHaveLength(3);
  expect(done.execution.find(x=>x.label==='ผู้ปฏิบัติงานจริง')).toMatchObject({source:'PAPER_TRANSCRIPTION',eventTime:'ไม่ได้บันทึกบนเอกสาร'});
  expect((await db.query('SELECT state FROM lab_batch WHERE id=$1',[b.batchId])).rows[0]).toEqual({state:'ExtractionLibrary'});
  // QC1: values after the library product; no automatic decision; certifier decides under UNAPPROVED_OD31.
  const qc:string[]=[];const addQc=async(x:Record<string,unknown>)=>{const r=await run(async t=>rec.recordObservation(t,u.staff,{batchId:b.batchId,expectedVersion:await V(),source:'DIRECT_ENTRY',...x}));qc.push(r.id);return r;};
  const low=await addQc({slot:2,fieldId:'F3-03',value:{value:'2.5',unit:'ng/uL'}});
  expect(low.candidates).toEqual([{code:'QC1-WI-BM17-BM18-PROPOSED',approved:false,outcome:'BELOW_MIN'},{code:'QC1-WORKBOOK-QC-D32-D35-PROPOSED',approved:false,outcome:'WITHIN'}]);
  await addQc({slot:3,fieldId:'F3-03',value:{value:'12.0',unit:'ng/uL'}});await addQc({slot:1,fieldId:'F3-03',value:{value:'8.1',unit:'ng/uL'}});
  await addQc({fieldId:'F3-05',item:'STD1',value:{value:'0.1',unit:'ng/uL'}});await addQc({fieldId:'F3-05',item:'STD2',value:{value:'9.8',unit:'ng/uL'}});await addQc({fieldId:'F3-01',item:'OPERATOR',value:{text:'จำลอง ผู้วัด'}});
  expect((await db.query('SELECT count(*)::int n FROM attempt_stage_qc')).rows[0]).toEqual({n:0});
  await expect(run(t=>rec.decideStageQc1(t,u.staff,{attemptId:attempts[0].id,decision:'Failed',reason:'จำลอง ต่ำกว่าเกณฑ์ที่เสนอ'}))).rejects.toMatchObject({code:'FORBIDDEN'});
  await expect(run(t=>rec.decideStageQc1(t,u.certifier,{attemptId:attempts[0].id,decision:'Failed',reason:'จำลอง ต่ำกว่าเกณฑ์ที่เสนอ'}))).rejects.toMatchObject({code:'STAGE_QC_REQUIRES_VERIFIED_VALUE'});
  await run(t=>rec.reviewObservations(t,u.certifier,{observationIds:qc,result:'Confirmed'}));
  await expect(run(async t=>rec.issueQcCompleted(t,u.staff,{batchId:b.batchId,expectedVersion:await V()},docs.deps))).rejects.toMatchObject({code:'QC1_RECORD_INCOMPLETE'});
  const dec=await run(t=>rec.decideStageQc1(t,u.certifier,{attemptId:attempts[0].id,decision:'Failed',reason:'จำลอง ต่ำกว่าเกณฑ์ที่เสนอ'}));
  expect(dec.criteriaStatus).toBe('UNAPPROVED_OD31');
  expect(await attemptOf(q(db),cases[0].roundId)).toMatchObject({state:'QcFailed'});
  await run(t=>rec.decideStageQc1(t,u.certifier,{attemptId:attempts[1].id,decision:'Accepted',reason:'จำลอง อยู่ในช่วงที่เสนอ'}));
  await run(async t=>rec.issueQcCompleted(t,u.staff,{batchId:b.batchId,expectedVersion:await V()},docs.deps));
  const f3=docs.rendered.at(-1)!;if(f3.form!=='F3')throw Error();
  expect(f3.summary).toMatch(/^ผ่าน 1 \/ ไม่ผ่าน 1 \/ ไม่ได้วัด 0/);expect(f3.rows.filter(r=>r.rowStatus==='NOT_IN_BATCH')).toHaveLength(32);
  expect((await db.query('SELECT state FROM lab_batch WHERE id=$1',[b.batchId])).rows[0]).toEqual({state:'QC1Complete'});
  // Repeat after QC1 failure: same specimen, first Re-Library keeps legacy -2; a second Re-Library has no approved format.
  const rep=await run(t=>intake.orderRepeat(t,u.staff,{attemptId:attempts[0].id,level:'RE_LIBRARY',reasonCode:'QC1_LOW',note:'จำลอง QC1 ต่ำกว่าเกณฑ์'}));
  expect(rep).toMatchObject({attemptNumber:2,printedSampleId:(await lnHalos(cases[0].roundId))+'-2'});
  expect(await attemptOf(q(db),cases[0].roundId)).toMatchObject({state:'Superseded'});
  expect((await db.query('SELECT count(*)::int n FROM specimen_round WHERE case_id=$1',[cases[0].caseId])).rows[0]).toEqual({n:1});
  const w=await run(t=>intake.labWorklist(t,u.staff));
  expect(w.attempts.find(a=>a.roundId===cases[0].roundId)).toMatchObject({category:'READY',attemptNumber:2,repeat:{level:'RE_LIBRARY',state:'RepeatPendingBatch'}});
 });
 it('controlled amendment stops use of the Pre-work, requires recall of working copies, and keeps every revision',async()=>{
  const {b}=await readyBatch(1);await finalize(b.batchId);const V=()=>version(q(db),b.batchId);
  const pre=await run(async t=>rec.issuePreWork(t,u.staff,{batchId:b.batchId,expectedVersion:await V(),sheetNumber:1},docs.deps));
  const copy=await run(t=>rec.printDocument(t,u.staff,{documentId:pre.id,kind:'WORKING_COPY'},docs.deps));
  await expect(run(async t=>batch.amendSheet(t,u.staff,{batchId:b.batchId,expectedVersion:await V(),sheetNumber:1,reason:'จำลอง แก้แผนก่อนเริ่ม'}))).rejects.toMatchObject({code:'FORBIDDEN'});
  await run(async t=>batch.amendSheet(t,u.certifier,{batchId:b.batchId,expectedVersion:await V(),sheetNumber:1,reason:'จำลอง แก้แผนก่อนเริ่ม'}));
  expect((await db.query('SELECT status FROM lab_document WHERE id=$1',[pre.id])).rows[0]).toEqual({status:'StopUse'});
  await expect(run(t=>rec.printDocument(t,u.staff,{documentId:pre.id,kind:'WORKING_COPY'},docs.deps))).rejects.toMatchObject({code:'WORKING_COPY_ONLY_FROM_ISSUED_PRE_WORK'});
  await run(t=>rec.printDocument(t,u.staff,{documentId:pre.id,kind:'STATUS_MARKED'},docs.deps));expect(docs.rendered.at(-1)!.copy).toMatchObject({kind:'STATUS_MARKED',status:'ระงับใช้'});
  await finalize(b.batchId);
  const rev2=await run(async t=>rec.issuePreWork(t,u.staff,{batchId:b.batchId,expectedVersion:await V(),sheetNumber:1},docs.deps));expect(rev2.revision).toBe(2);
  expect((await db.query('SELECT status FROM lab_document WHERE id=$1',[pre.id])).rows[0]).toEqual({status:'Superseded'});
  expect((await db.query('SELECT revision FROM lab_placement_snapshot WHERE batch_id=$1 ORDER BY revision',[b.batchId])).rows).toEqual([{revision:1},{revision:2}]);
  await expect(run(async t=>batch.startExecution(t,u.staff,{batchId:b.batchId,expectedVersion:await V(),sheetNumber:1}))).rejects.toMatchObject({code:'RECALL_PENDING'});
  await run(t=>rec.recallCopy(t,u.certifier,{copyId:copy.copyId,note:'จำลอง เก็บสำเนาคืนแล้ว'}));
  await run(async t=>batch.startExecution(t,u.staff,{batchId:b.batchId,expectedVersion:await V(),sheetNumber:1}));
  await expect(db.query("UPDATE lab_document SET file_sha256=repeat('0',64) WHERE id=$1",[pre.id])).rejects.toThrow(/ISSUED_ORIGINAL_IMMUTABLE/);
 });
 it('cancelling a never-finalized draft returns attempts to Ready; a finalized cancel needs a certifier and yields BatchCancelled',async()=>{
  const {b,cases}=await readyBatch(1);
  await run(async t=>batch.cancelBatch(t,u.staff,{batchId:b.batchId,expectedVersion:await version(t,b.batchId),reason:'จำลอง ยกเลิกร่าง'}));
  expect(await attemptOf(q(db),cases[0].roundId)).toMatchObject({state:'Ready'});
  const b2=await run(t=>batch.createBatch(t,u.staff));expect(b2.runLabel).toMatch(/^Run002\//);
  await run(async t=>batch.assignToBatch(t,u.staff,{batchId:b2.batchId,expectedVersion:0,attemptIds:[(await attemptOf(t,cases[0].roundId)).id]}));
  await finalize(b2.batchId);
  await expect(run(async t=>batch.cancelBatch(t,u.staff,{batchId:b2.batchId,expectedVersion:await version(t,b2.batchId),reason:'จำลอง ยกเลิกหลังล็อก'}))).rejects.toMatchObject({code:'FORBIDDEN'});
  await run(async t=>batch.cancelBatch(t,u.certifier,{batchId:b2.batchId,expectedVersion:await version(t,b2.batchId),reason:'จำลอง ยกเลิกหลังล็อก'}));
  expect(await attemptOf(q(db),cases[0].roundId)).toMatchObject({state:'BatchCancelled'});
  // The milestone never reverts: a new attempt needs Repeat lineage.
  const w=await run(t=>intake.labWorklist(t,u.staff));expect(w.attempts[0].category).toBe('NEEDS_DECISION');
 });
});

describe('Redraw / S2+ receipt in NIPT (LD-01..05, §4.2, §12.6.2)',()=>{
 it('redraw keeps HIS LN, opens S2 Expected, stops work; S2 receipt in NIPT issues its own LN Halos once',async()=>{
  const c=await received();const s1=await lnHalos(c.roundId);
  await expect(run(t=>intake.orderRedraw(t,u.staff,{caseId:c.caseId,reasonCode:'SPECIMEN_PROBLEM',note:'จำลอง หลอดมีปัญหา'}))).rejects.toMatchObject({code:'FORBIDDEN'});
  const r=await run(t=>intake.orderRedraw(t,u.certifier,{caseId:c.caseId,reasonCode:'SPECIMEN_PROBLEM',note:'จำลอง หลอดมีปัญหา'}));
  expect(r).toMatchObject({newRoundNumber:2,stoppedAttempts:1});
  expect(await attemptOf(q(db),c.roundId)).toMatchObject({state:'Stopped'});
  const w=await run(t=>intake.labWorklist(t,u.staff));expect(w.expected).toEqual([expect.objectContaining({roundId:r.newRoundId,roundNumber:2,hisLn:c.ln,previousLnHalos:s1})]);
  await expect(run(t=>intake.receiveRedraw(t,u.staff,{roundId:c.roundId,identityChecked:true,labelChecked:true,condition:'ACCEPTABLE',collectionDate:'2026-10-11'}))).rejects.toMatchObject({code:'S1_RECEIVED_IN_HIS_ONLY'});
  await expect(run(t=>intake.receiveRedraw(t,u.staff,{roundId:r.newRoundId,identityChecked:false,labelChecked:true,condition:'ACCEPTABLE',collectionDate:'2026-10-11'}))).rejects.toThrow();
  await expect(run(t=>intake.receiveRedraw(t,u.staff,{roundId:r.newRoundId,identityChecked:true,labelChecked:true,condition:'ACCEPTABLE',collectionDate:'2026-10-01'}))).rejects.toMatchObject({code:'COLLECTION_DATE_BEFORE_PREVIOUS_ROUND'});
  const got=await run(t=>intake.receiveRedraw(t,u.staff,{roundId:r.newRoundId,identityChecked:true,labelChecked:true,condition:'ACCEPTABLE',collectionDate:'2026-10-11'}));
  expect(got.duplicate).toBe(false);expect(got.lnHalos).not.toBe(s1);expect(got.lnHalos).toMatch(LN_HALOS_PATTERN);
  expect(await run(t=>intake.receiveRedraw(t,u.staff,{roundId:r.newRoundId,identityChecked:true,labelChecked:true,condition:'ACCEPTABLE',collectionDate:'2026-10-11'}))).toEqual({duplicate:true,lnHalos:got.lnHalos,roundNumber:2});
  expect((await db.query('SELECT count(*)::int n FROM specimen_lab_number WHERE case_id=$1',[c.caseId])).rows[0]).toEqual({n:2});
  const rounds=(await db.query<{round_number:number;state:string;received_source:string;ln:string}>('SELECT r.round_number,r.state,r.received_source,l.ln FROM specimen_round r JOIN case_ln l ON l.id=r.case_ln_id WHERE r.case_id=$1 ORDER BY r.round_number',[c.caseId])).rows;
  expect(rounds).toEqual([{round_number:1,state:'RedrawRequested',received_source:'HIS_PET_RECEIPT',ln:c.ln},{round_number:2,state:'ReceivedInNIPT',received_source:'NIPT_LOCAL_RECEIPT',ln:c.ln}]);
  expect((await db.query("SELECT count(*)::int n FROM his_order")).rows[0]).toEqual({n:1}); // no second HIS receipt
  // S2 consent/request applicability is OD-16: shown as pending, not assumed.
  const w2=await run(t=>intake.labWorklist(t,u.staff));
  expect(w2.attempts.find(a=>a.roundId===r.newRoundId)!.gate!.pending).toEqual(expect.arrayContaining(['OD-16:REDRAW_CONSENT_APPLICABILITY','OD-16:REDRAW_REQUEST_APPLICABILITY']));
 });
 it('cancel of a wrong redraw before receipt restores the round and flags stopped work for a decision',async()=>{
  const c=await received();const r=await run(t=>intake.orderRedraw(t,u.certifier,{caseId:c.caseId,reasonCode:'OTHER',note:'จำลอง สั่งผิดเคส'}));
  const back=await run(t=>intake.cancelRedraw(t,u.certifier,{caseId:c.caseId,reason:'จำลอง สั่งผิดเคส'}));
  expect(back).toEqual({restoredRoundId:c.roundId,resumeDecisionRequired:1});
  expect((await db.query('SELECT state FROM specimen_round WHERE id=$1',[r.newRoundId])).rows[0]).toEqual({state:'Cancelled'});
  expect((await db.query('SELECT state FROM specimen_round WHERE id=$1',[c.roundId])).rows[0]).toEqual({state:'ReceivedInHIS'});
  expect((await db.query<{resume_decision_required:boolean}>('SELECT resume_decision_required FROM analytical_attempt WHERE round_id=$1',[c.roundId])).rows[0].resume_decision_required).toBe(true);
 });
});

describe('Tube labels from issued LN Halos (AT-LABEL-03..06)',()=>{
 it('prints 4 stickers per sample, reprint needs a reason and never issues a number; twins add D; mixing is impossible',async()=>{
  const a=await received(),t2=await received({pregnancy:'Twins'});
  const before=(await db.query('SELECT count(*)::int n FROM specimen_lab_number')).rows[0];
  const p=await run(t=>intake.printLabels(t,u.staff,{roundIds:[a.roundId,t2.roundId],includeName:false}));
  expect(p.kind).toBe('PRINT');expect(p.html.match(/class="sticker"/g)).toHaveLength(8);
  const twin=(await lnHalos(t2.roundId))+'D';expect(p.html).toContain(`${twin}-3`);expect(p.html.match(new RegExp(`LN: ${t2.ln}<`,'g'))).toHaveLength(8);expect(p.html.match(new RegExp(`LN: ${a.ln}<`,'g'))).toHaveLength(8);
  await expect(run(t=>intake.printLabels(t,u.staff,{roundIds:[a.roundId],includeName:false}))).rejects.toMatchObject({code:'REPRINT_REASON_REQUIRED'});
  const re=await run(t=>intake.printLabels(t,u.staff,{roundIds:[a.roundId],includeName:false,reason:'จำลอง สติ๊กเกอร์เสียหาย'}));expect(re.kind).toBe('REPRINT');
  expect((await db.query('SELECT count(*)::int n FROM specimen_lab_number')).rows[0]).toEqual(before);
  expect((await db.query('SELECT count(*)::int n FROM analytical_attempt')).rows[0]).toEqual({n:2}); // label -1/-2/-3 create no attempts
  const unknown=await run(t=>syntheticCase(t,u,{evidence:false}));await run(t=>receiveS1(t,unknown));
  await expect(run(t=>intake.printLabels(t,u.staff,{roundIds:[unknown.roundId],includeName:false}))).rejects.toMatchObject({code:'PREGNANCY_TYPE_UNCONFIRMED'});
  const expected=await run(t=>syntheticCase(t,u));
  await expect(run(t=>intake.printLabels(t,u.staff,{roundIds:[expected.roundId],includeName:false}))).rejects.toMatchObject({code:'LN_HALOS_NOT_ISSUED_OR_NOT_VISIBLE'});
  await expect(run(t=>intake.printLabels(t,u.anc,{roundIds:[a.roundId],includeName:false}))).rejects.toMatchObject({code:'FORBIDDEN'});
  expect((await db.query("SELECT kind,sample_count,reason FROM label_print_job ORDER BY created_at")).rows).toEqual([{kind:'PRINT',sample_count:2,reason:null},{kind:'REPRINT',sample_count:1,reason:'จำลอง สติ๊กเกอร์เสียหาย'}]);
 });
});

describe('RBAC and cross-unit access',()=>{
 it('ANC cannot open Lab queues or batches; Auditor reads but cannot change; Lab staff cannot verify their own work',async()=>{
  const {b}=await readyBatch(1);
  await expect(run(t=>intake.labWorklist(t,u.anc))).rejects.toMatchObject({code:'FORBIDDEN'});
  await expect(run(t=>batch.batchDetail(t,u.anc,b.batchId))).rejects.toMatchObject({code:'FORBIDDEN'});
  expect((await run(t=>batch.batchDetail(t,u.auditor,b.batchId))).batch.runLabel).toBe(b.runLabel);
  await expect(run(t=>batch.createBatch(t,u.auditor))).rejects.toMatchObject({code:'FORBIDDEN'});
  const roundId=(await db.query<{round_id:string}>('SELECT round_id FROM specimen_lab_number LIMIT 1')).rows[0].round_id;
  await expect(run(t=>intake.printLabels(t,u.auditor,{roundIds:[roundId],includeName:false}))).rejects.toMatchObject({code:'FORBIDDEN'});
 });
});
