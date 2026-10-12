import {describe,it,expect,beforeEach,afterEach} from 'vitest';
import {inboundFixture,writePet,register,registrar,cycle,type InboundFixture} from '../helpers/inbound';
import {tx,labUsers,setPendingPolicy,syntheticCase,receiveS1,attemptOf,version} from '../helpers/lab';
import {listP2Cases} from '../../packages/p2/service';
import * as intake from '../../packages/lab/intake';
import * as batch from '../../packages/lab/batch';
import type {Queryable} from '../../packages/db/connection';

let f:InboundFixture,u:Awaited<ReturnType<typeof labUsers>>;
beforeEach(async()=>{f=await inboundFixture();u=await labUsers(f.db as unknown as Queryable);});
afterEach(async()=>{await f.close();});
const q=()=>f.db as unknown as Queryable;
const run=<T>(fn:(t:Queryable)=>Promise<T>)=>tx(q(),fn);
const DAY='20261012',NOW=new Date('2026-10-12T08:00:00Z');

describe('Receive Date/Time sorting — Owner Lock 2026-10-12 (AT-SORT-01..07)',()=>{
 it('AT-SORT-03: S1 order follows .pet P[21] only — not registration, ingestion, P[23] collection or O[14] order time',async()=>{
  // Registered A→B→C and ingested A→B→C, but HIS received C first, then A, then B. Collection/order times run the opposite way.
  const cases=[{ln:'990004000001',hn:'9900040001',rec:'20261012091500',spec:'20261010070000'},{ln:'990004000002',hn:'9900040002',rec:'20261012101500',spec:'20261009070000'},{ln:'990004000003',hn:'9900040003',rec:'20261012081500',spec:'20261011070000'}];
  const ids:string[]=[];for(const c of cases)ids.push(await register(f,{ln:c.ln,hn:c.hn}));
  for(const c of cases)await writePet(f.root,DAY,{ln:c.ln,hn:c.hn,receivedAt:c.rec,specimenAt:c.spec,orderAt:c.spec});
  expect((await cycle(f,{now:NOW})).counts).toMatchObject({outcome_APPLIED_S1:3});
  const his=(await f.db.query<{ln:string;his_received_at:Date}>('SELECT l.ln,o.his_received_at FROM his_order o JOIN case_ln l ON l.id=o.case_ln_id ORDER BY o.his_received_at')).rows.map(r=>r.ln);
  expect(his).toEqual(['990004000003','990004000001','990004000002']);
  const w=await run(t=>intake.labWorklist(t,u.staff));
  expect(w.attempts.map(a=>a.hisLn)).toEqual(his); // Ready Queue default ASC (FIFO)
  for(const a of w.attempts)expect(a.receivedAt).toBe((await f.db.query<{t:Date}>("SELECT o.his_received_at t FROM his_order o JOIN case_ln l ON l.id=o.case_ln_id WHERE l.ln=$1",[a.hisLn])).rows[0].t.toISOString());
  // AT-SORT-01: the registry shows the same receipt time, newest first by default; ASC on request.
  const {lab}=await registrar(f.db);
  const desc=await run(t=>listP2Cases(t,lab));expect(desc.cases.map(c=>c.ln)).toEqual([...his].reverse());
  const asc=await run(t=>listP2Cases(t,lab,'',0,'asc'));expect(asc.cases.map(c=>c.ln)).toEqual(his);
  expect(desc.cases[0]).toMatchObject({received_source:'HIS_PET_RECEIPT'});
  expect(ids).toHaveLength(3);
 });
 it('AT-SORT-05: cases not yet received show no time, stay in the registry and sort last both ways; equal times are stable',async()=>{
  const {lab}=await registrar(f.db);
  await register(f,{ln:'990004000010',hn:'9900040010'});await register(f,{ln:'990004000011',hn:'9900040011'});
  for(const [ln,hn] of [['990004000012','9900040012'],['990004000013','9900040013']])await register(f,{ln,hn});
  for(const [ln,hn] of [['990004000013','9900040013'],['990004000012','9900040012']])await writePet(f.root,DAY,{ln,hn,receivedAt:'20261012091500'}); // identical P[21]
  await cycle(f,{now:NOW});
  for(const dir of ['asc','desc'] as const){const r=await run(t=>listP2Cases(t,lab,'',0,dir));
   expect(r.cases.slice(0,2).map(c=>c.ln)).toEqual(['990004000012','990004000013']); // equal time → HIS LN, never ingest order
   expect(r.cases.slice(2).every(c=>c.received_at===null)).toBe(true);expect(r.cases.slice(2).map(c=>c.ln).sort()).toEqual(['990004000010','990004000011']);}
  const search=await run(t=>listP2Cases(t,lab,'99000400001',0,'asc'));expect(search.cases).toHaveLength(4);
  expect((await run(t=>listP2Cases(t,lab,'',0,'desc'))).cases.map(c=>c.ln)).toEqual((await run(t=>listP2Cases(t,lab,'',0,'desc'))).cases.map(c=>c.ln)); // refresh-stable
  await expect(run(t=>listP2Cases(t,lab,'',0,'created' as 'asc'))).rejects.toThrow();
 });
 it('AT-SORT-04: S2+ uses the NIPT receipt time, Repeat keeps the original round time; no HIS receipt is created',async()=>{
  await setPendingPolicy(q(),u,'PROCEED_SYNTHETIC_LABELLED');
  const early=await run(t=>syntheticCase(t,u));await run(t=>receiveS1(t,early,new Date('2026-10-12T00:00:00Z')));
  const late=await run(t=>syntheticCase(t,u));await run(t=>receiveS1(t,late,new Date('2026-10-12T05:00:00Z')));
  const redraw=await run(t=>intake.orderRedraw(t,u.certifier,{caseId:early.caseId,reasonCode:'SPECIMEN_PROBLEM',note:'จำลอง เจาะซ้ำเพื่อทดสอบการเรียง'}));
  await run(t=>intake.receiveRedraw(t,u.staff,{roundId:redraw.newRoundId,identityChecked:true,labelChecked:true,condition:'ACCEPTABLE',collectionDate:'2026-10-11'}));
  const s2At=(await f.db.query<{t:Date}>('SELECT received_at t FROM specimen_round WHERE id=$1',[redraw.newRoundId])).rows[0].t;
  const w=await run(t=>intake.labWorklist(t,u.staff));
  expect(w.attempts.map(a=>a.roundId)).toEqual([late.roundId,redraw.newRoundId]);expect(w.attempts[1].receivedAt).toBe(s2At.toISOString());
  expect((await f.db.query('SELECT count(*)::int n FROM his_order')).rows[0]).toEqual({n:2});
  // Repeat: the child attempt keeps the receipt time of its specimen round.
  const b=await run(t=>batch.createBatch(t,u.staff));const first=await attemptOf(q(),late.roundId);
  await run(t=>batch.assignToBatch(t,u.staff,{batchId:b.batchId,expectedVersion:0,attemptIds:[first.id]}));
  await run(async t=>batch.cancelBatch(t,u.staff,{batchId:b.batchId,expectedVersion:await version(t,b.batchId),reason:'จำลอง ยกเลิกร่าง'}));
  await f.db.query("UPDATE analytical_attempt SET state='Stopped' WHERE id=$1",[first.id]); // Ready→Stopped is a permitted transition (e.g. Lab decision)
  await run(t=>intake.orderRepeat(t,u.staff,{attemptId:first.id,level:'RE_LIBRARY',reasonCode:'STOPPED_BY_LAB',note:'จำลอง ตรวจซ้ำเพื่อทดสอบ'}));
  const w2=await run(t=>intake.labWorklist(t,u.staff));const child=w2.attempts.find(a=>a.roundId===late.roundId)!;
  expect(child.attemptNumber).toBe(2);expect(child.receivedAt).toBe(new Date('2026-10-12T05:00:00Z').toISOString());
 });
 it('AT-SORT-06/07: slots follow the displayed order of the selection, skip controls, and re-sorting never moves placed samples',async()=>{
  await setPendingPolicy(q(),u,'PROCEED_SYNTHETIC_LABELLED');
  const cs=[];for(let i=0;i<26;i++){const c=await run(t=>syntheticCase(t,u));await run(t=>receiveS1(t,c,new Date(Date.UTC(2026,9,12,0,i))));cs.push(c);}
  const ids=await Promise.all(cs.map(c=>attemptOf(q(),c.roundId).then(a=>a.id)));
  const b=await run(t=>batch.createBatch(t,u.staff));
  // The user sorted DESC and selected all 26: proposals go to slots 2..24, 26..28 in that displayed order (1 and 25 are controls).
  const shown=[...ids].reverse();
  const r=await run(t=>batch.assignToBatch(t,u.staff,{batchId:b.batchId,expectedVersion:0,attemptIds:shown,queueOverrideReason:'จำลอง เลือกตามลำดับที่แสดง'}));
  expect(r.placed.map(p=>p.attemptId)).toEqual(shown);
  expect(r.placed.map(p=>p.slot)).toEqual([...Array.from({length:23},(_,i)=>i+2),26,27,28]);
  const before=(await f.db.query('SELECT slot_number,attempt_id FROM lab_slot_assignment WHERE removed_at IS NULL ORDER BY slot_number')).rows;
  await run(t=>intake.labWorklist(t,u.staff)); // reading/sorting the queue is display-only
  expect((await f.db.query('SELECT slot_number,attempt_id FROM lab_slot_assignment WHERE removed_at IS NULL ORDER BY slot_number')).rows).toEqual(before);
  // Overtaking eligible earlier work without Urgent still requires a reason; Urgent itself needs a reason and is audited.
  const more=await run(t=>syntheticCase(t,u));await run(t=>receiveS1(t,more,new Date(Date.UTC(2026,9,12,1,0))));
  const newer=await run(t=>syntheticCase(t,u));await run(t=>receiveS1(t,newer,new Date(Date.UTC(2026,9,12,2,0))));
  const newerAttempt=await attemptOf(q(),newer.roundId);
  await expect(run(async t=>batch.assignToBatch(t,u.staff,{batchId:b.batchId,expectedVersion:await version(t,b.batchId),attemptIds:[newerAttempt.id]}))).rejects.toMatchObject({code:'QUEUE_OVERRIDE_REASON_REQUIRED'});
  await run(t=>intake.setUrgent(t,u.staff,{attemptId:newerAttempt.id,urgent:true,reason:'จำลอง แพทย์ขอผลด่วน'}));
  const ok=await run(async t=>batch.assignToBatch(t,u.staff,{batchId:b.batchId,expectedVersion:await version(t,b.batchId),attemptIds:[newerAttempt.id]}));
  expect(ok.placed).toHaveLength(1);
  expect((await f.db.query("SELECT action FROM audit_chain WHERE action='LAB_URGENT_SET'")).rows).toHaveLength(1);
 });
});
