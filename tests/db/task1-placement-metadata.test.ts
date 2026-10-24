import {it,expect} from 'vitest';
import {testDatabase} from '../helpers/database';
import {tx,labUsers,setPendingPolicy,syntheticCase,receiveS1,attemptOf,version} from '../helpers/lab';
import * as batch from '../../packages/lab/batch';
import {orderRepeat} from '../../packages/lab/intake';
import {setAttemptState} from '../../packages/lab/core';

it('Task1 exact placement, urgent displacement, controls and frozen placement with audited live metadata',async()=>{
 const db=await testDatabase();try{
  const u=await labUsers(db);await setPendingPolicy(db,u,'PROCEED_SYNTHETIC_LABELLED');
  const c1=await tx(db,t=>syntheticCase(t,u)),c2=await tx(db,t=>syntheticCase(t,u));
  await tx(db,t=>receiveS1(t,c1,new Date('2026-10-23T01:00:00Z')));await tx(db,t=>receiveS1(t,c2,new Date('2026-10-23T01:01:00Z')));
  const a1=await attemptOf(db,c1.roundId),a2=await attemptOf(db,c2.roundId);
  const b=await tx(db,t=>batch.createBatch(t,u.staff)),id=b.batchId,V=()=>version(db,id);
  const exact=async(attemptId:string,slot:number,mode:'MANUAL'|'URGENT'|'REPEAT'='MANUAL',queueOverrideReason?:string)=>tx(db,async t=>batch.assignExact(t,u.staff,{batchId:id,expectedVersion:await V(),attemptId,slot,mode,queueOverrideReason}));
  await expect(exact(a2.id,9)).rejects.toThrow('QUEUE_OVERRIDE_REASON_REQUIRED');
  await exact(a1.id,8);expect((await batch.batchDetail(db,u.staff,id)).slots[7].assignment?.attemptId).toBe(a1.id);
  await expect(exact(a2.id,1)).rejects.toThrow('CONTROL_SLOT_PROTECTED');
  await expect(exact(a2.id,25)).rejects.toThrow('CONTROL_SLOT_PROTECTED');
  await expect(exact(a2.id,40)).rejects.toThrow('CONTROL_SLOT_PROTECTED');
  await expect(exact(a2.id,8)).rejects.toThrow('EXACT_SLOT_UNAVAILABLE');
  await expect(exact(a2.id,9,'REPEAT')).rejects.toThrow('REPEAT_ATTEMPT_REQUIRED');
  const replaced=await exact(a2.id,8,'URGENT','SYNTHETIC urgent owner-authorized placement');expect(replaced.placed[0].slot).toBe(8);
  expect((await db.query<{state:string}>('SELECT state FROM analytical_attempt WHERE id=$1',[a1.id])).rows[0].state).toBe('Ready');
  expect((await batch.batchDetail(db,u.staff,id)).slots[7].assignment).toMatchObject({attemptId:a2.id,urgent:true});
  await tx(db,async t=>batch.setUrgentSlot40(t,u.staff,{batchId:id,expectedVersion:await V(),enabled:true}));
  await expect(exact(a1.id,40)).rejects.toThrow('URGENT_ATTEMPT_REQUIRED');
  await exact(a1.id,40,'URGENT','SYNTHETIC urgent slot40 approved replacement of Blank');
  const urgentSlots=(await batch.batchDetail(db,u.staff,id)).slots;expect(urgentSlots[39]).toMatchObject({control:null,assignment:{attemptId:a1.id,urgent:true}});expect(urgentSlots[0].control).toBe('positive');expect(urgentSlots[24].control).toBe('negative');expect(urgentSlots.some(s=>s.control==='blank')).toBe(false);
  const plan={plannedWorkDate:'2026-10-23',plannedOperator:'SYNTHETIC OPERATOR',plannedExtractionLot:'EX-A',plannedExtractionExpiry:'2026-12-01',plannedLibraryLot:'LIB-A',plannedLibraryExpiry:'2026-12-02'};
  await tx(db,async t=>batch.updateSheetPlan(t,u.staff,{batchId:id,expectedVersion:await V(),sheetNumber:1,...plan}));
  await tx(db,async t=>batch.planCheck(t,u.staff,{batchId:id,expectedVersion:await V(),sheetNumber:1,confirm:{controlsAtTemplate:true,identifiersMatch:true,noDuplicates:true}}));
  await tx(db,async t=>batch.finalizeSheet(t,u.staff,{batchId:id,expectedVersion:await V(),sheetNumber:1}));
  const before=await batch.batchDetail(db,u.staff,id),snapshot=(await db.query('SELECT * FROM lab_placement_snapshot WHERE batch_id=$1',[id])).rows;
  const lockedVersion=await V();
  const newPlan={plannedWorkDate:'2026-10-24',plannedOperator:'SYNTHETIC CHANGED',plannedExtractionLot:'EX-B',plannedExtractionExpiry:'2027-01-01',plannedLibraryLot:'LIB-B',plannedLibraryExpiry:'2027-02-01'};
  await tx(db,t=>batch.updateSheetPlan(t,u.staff,{batchId:id,expectedVersion:lockedVersion,sheetNumber:1,...newPlan}));
  await expect(tx(db,t=>batch.updateSheetPlan(t,u.staff,{batchId:id,expectedVersion:lockedVersion,sheetNumber:1,...plan}))).rejects.toThrow('VERSION_CONFLICT');
  const after=await batch.batchDetail(db,u.staff,id);expect(after.slots).toEqual(before.slots);expect(after.sheets[0].state).toBe('PlacementFinalized');
  expect(after.sheets[0].planned_operator).toBe('SYNTHETIC CHANGED');expect(after.sheets[0].planned_work_date).toBe('2026-10-24');
  expect((await db.query('SELECT * FROM lab_placement_snapshot WHERE batch_id=$1',[id])).rows).toEqual(snapshot);
  await expect(exact(a1.id,9)).rejects.toThrow('PLACEMENT_LOCKED');
  await expect(tx(db,async t=>batch.moveSlot(t,u.staff,{batchId:id,expectedVersion:await V(),fromSlot:8,toSlot:9}))).rejects.toThrow('PLACEMENT_LOCKED');
  await expect(tx(db,async t=>batch.removeFromBatch(t,u.staff,{batchId:id,expectedVersion:await V(),slot:8}))).rejects.toThrow('PLACEMENT_LOCKED');
  await expect(tx(db,async t=>batch.amendSheet(t,u.certifier,{batchId:id,expectedVersion:await V(),sheetNumber:1,reason:'SYNTHETIC cannot reopen'}))).rejects.toThrow('PLACEMENT_LOCKED');
  expect((await db.query<{details:unknown}>("SELECT details FROM lab_batch_event WHERE batch_id=$1 AND event_type='PLAN_DATA_UPDATED' ORDER BY sequence DESC LIMIT 1",[id])).rows[0].details).toMatchObject({before:{operator:'SYNTHETIC OPERATOR'},after:{operator:'SYNTHETIC CHANGED'},placementUnchanged:true});
 }finally{await db.close();}
},180000);

it('Task1 Repeat Fill uses a real child without urgency, keeps FIFO override and atomically returns a displaced draft attempt',async()=>{
 const db=await testDatabase();try{
  const u=await labUsers(db);await setPendingPolicy(db,u,'PROCEED_SYNTHETIC_LABELLED');
  const cases:Awaited<ReturnType<typeof syntheticCase>>[]=[];for(let n=0;n<3;n++){const c=await tx(db,t=>syntheticCase(t,u));await tx(db,t=>receiveS1(t,c,new Date(`2026-10-23T01:0${n}:00Z`)));cases.push(c);}
  const occupied=await attemptOf(db,cases[0].roundId),earlier=await attemptOf(db,cases[1].roundId),parent=await attemptOf(db,cases[2].roundId);
  await tx(db,t=>setAttemptState(t,u.staff,{id:parent.id,case_id:cases[2].caseId,state:'Ready'},'Stopped',{reason:'SYNTHETIC stopped specimen fixture'}));
  const child=await tx(db,t=>orderRepeat(t,u.staff,{attemptId:parent.id,level:'RE_EXTRACTION',reasonCode:'STOPPED_BY_LAB',note:'SYNTHETIC repeat same specimen after recorded stop'}));
  expect(child.attemptId).not.toBe(parent.id);expect(child.attemptNumber).toBe(2);
  const b=await tx(db,t=>batch.createBatch(t,u.staff)),id=b.batchId,V=()=>version(db,id);
  await tx(db,t=>batch.assignExact(t,u.staff,{batchId:id,expectedVersion:0,attemptId:occupied.id,slot:8,mode:'MANUAL'}));
  const originalAssignment=(await db.query('SELECT * FROM lab_slot_assignment WHERE batch_id=$1 AND removed_at IS NULL',[id])).rows;
  await expect(tx(db,async t=>batch.assignExact(t,u.staff,{batchId:id,expectedVersion:await V(),attemptId:child.attemptId,slot:8,mode:'REPEAT'}))).rejects.toThrow('QUEUE_OVERRIDE_REASON_REQUIRED');
  expect((await db.query('SELECT * FROM lab_slot_assignment WHERE batch_id=$1 AND removed_at IS NULL',[id])).rows).toEqual(originalAssignment);
  await tx(db,async t=>batch.assignExact(t,u.staff,{batchId:id,expectedVersion:await V(),attemptId:child.attemptId,slot:8,mode:'REPEAT',queueOverrideReason:'SYNTHETIC deliberate repeat FIFO override'}));
  const after=await batch.batchDetail(db,u.staff,id);expect(after.slots[7].assignment).toMatchObject({attemptId:child.attemptId,repeat:true,urgent:false,printedSampleId:child.printedSampleId});
  expect((await db.query<{id:string;state:string}>('SELECT id,state FROM analytical_attempt WHERE id=ANY($1::uuid[]) ORDER BY id',[[occupied.id,earlier.id,parent.id]])).rows).toEqual(expect.arrayContaining([{id:occupied.id,state:'Ready'},{id:earlier.id,state:'Ready'},{id:parent.id,state:'Superseded'}]));
  expect((await db.query('SELECT parent_attempt_id,level,state FROM repeat_work_order WHERE id=$1',[child.repeatOrderId])).rows[0]).toEqual({parent_attempt_id:parent.id,level:'RE_EXTRACTION',state:'RepeatInProgress'});
  expect((await db.query("SELECT * FROM attempt_event WHERE attempt_id=$1 AND event_type='URGENT_SET'",[child.attemptId])).rows).toHaveLength(0);
 }finally{await db.close();}
},180000);

it('Task1 exact-slot replacement scopes recorded execution evidence to the occupied target slot',async()=>{
 const db=await testDatabase();try{
  const u=await labUsers(db);await setPendingPolicy(db,u,'PROCEED_SYNTHETIC_LABELLED');
  const cases:Awaited<ReturnType<typeof syntheticCase>>[]=[];
  for(let n=0;n<4;n++){const c=await tx(db,t=>syntheticCase(t,u));await tx(db,t=>receiveS1(t,c,new Date(`2026-10-23T02:0${n}:00Z`)));cases.push(c);}
  const attempts=await Promise.all(cases.map(c=>attemptOf(db,c.roundId)));
  const {batchId:id}=await tx(db,t=>batch.createBatch(t,u.staff)),V=()=>version(db,id);
  await tx(db,t=>batch.assignExact(t,u.staff,{batchId:id,expectedVersion:0,attemptId:attempts[0].id,slot:8,mode:'MANUAL'}));
  await tx(db,async t=>batch.assignExact(t,u.staff,{batchId:id,expectedVersion:await V(),attemptId:attempts[1].id,slot:17,mode:'MANUAL'}));
  const insertRevision=async(revision:number,values:Record<string,unknown>)=>db.query(`INSERT INTO task_workbook_revision(batch_id,revision,master_sha256,source_sha256,source_snapshot,values,created_by) VALUES($1,$2,$3,$4,'{}'::jsonb,$5::jsonb,$6)`,[id,revision,'4c5300f9039af57c0d0649160f5da8e4c2ee1ed7ae44dd7aa525823104f9c7f1','a'.repeat(64),JSON.stringify(values),u.staff.id]);
  await insertRevision(1,{'slot.8.libraryQc':3.25});
  await tx(db,async t=>batch.assignExact(t,u.staff,{batchId:id,expectedVersion:await V(),attemptId:attempts[2].id,slot:17,mode:'URGENT',queueOverrideReason:'SYNTHETIC replace Task 2 draft slot'}));
  expect((await batch.batchDetail(db,u.staff,id)).slots.find(s=>s.slot===17)?.assignment?.attemptId).toBe(attempts[2].id);
  expect((await db.query<{state:string}>('SELECT state FROM analytical_attempt WHERE id=$1',[attempts[1].id])).rows[0].state).toBe('Ready');
  await insertRevision(2,{'slot.8.libraryQc':3.25,'slot.17.libraryQc':3.1});
  await expect(tx(db,async t=>batch.assignExact(t,u.staff,{batchId:id,expectedVersion:await V(),attemptId:attempts[1].id,slot:17,mode:'URGENT',queueOverrideReason:'SYNTHETIC must preserve measured target'}))).rejects.toThrow('DISPLACEMENT_ONLY_BEFORE_EXECUTION');
  expect((await batch.batchDetail(db,u.staff,id)).slots.find(s=>s.slot===17)?.assignment?.attemptId).toBe(attempts[2].id);
 }finally{await db.close();}
},180000);
