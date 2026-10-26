import {it,expect} from 'vitest';
import {histFixture} from '../helpers/historical';
import {syntheticCase,receiveS1} from '../helpers/lab';
import {storageSearch,storageCommand,storageLabel,storageSampleLabel,storageBoxLog,storagePendingDestruction} from '../../packages/lab/sample-storage';

// OWNER-LAB-051/052 (+ LEGACY LAB-UAT-003). Synthetic PGlite fixtures only.
const lnHalosOf=async(db:{query:(q:string,v:unknown[])=>Promise<{rows:{ln_halos:string}[]}>},roundId:string)=>(await db.query('SELECT ln_halos FROM specimen_lab_number WHERE round_id=$1',[roundId])).rows[0]?.ln_halos;

it('OWNER-LAB-051: an issued LN Halos is storable for Backup and Buffy without a PET receipt; its due date stays unknown',async()=>{
 const f=await histFixture();try{
  const c=await f.run(db=>syntheticCase(db,f.u,{ln:'9905100001'}));
  // Simulates a round whose LN Halos was issued while the PET receipt fields are empty (Owner lock: receipt is not a precondition).
  await f.db.query("INSERT INTO specimen_lab_number(round_id,case_id,ln_halos,sequence_date,sequence_value,issued_on,issue_path) VALUES($1,$2,'26B261025901','2026-10-25',901,'HIS_PET_RECEIPT','RECEIPT_TRIGGER')",[c.roundId,c.caseId]);
  expect((await f.db.query<{received_at:Date|null}>('SELECT received_at FROM specimen_round WHERE id=$1',[c.roundId])).rows[0].received_at).toBeNull();
  const waiting=await f.run(db=>storageSearch(db,f.maker,{q:c.ln}));
  expect(waiting.rows.map(r=>[r.storageType,r.waiting,r.storageLabel,r.retentionDueAt]).sort()).toEqual([['BACKUP',true,'26B261025901-3',null],['BUFFY_COAT',true,'26B261025901',null]]);
  const backup=await f.run(db=>storageCommand(db,f.maker,{action:'createBox',boxType:'BACKUP'})),buffy=await f.run(db=>storageCommand(db,f.maker,{action:'createBox',boxType:'BUFFY_COAT'}));
  await f.run(db=>storageCommand(db,f.maker,{action:'place',roundId:c.roundId,storageType:'BACKUP',boxId:backup.id,slot:1}));
  await f.run(db=>storageCommand(db,f.maker,{action:'place',roundId:c.roundId,storageType:'BUFFY_COAT',boxId:buffy.id,slot:1}));
  const stored=await f.run(db=>storageSearch(db,f.maker,{q:c.ln}));
  expect(stored.rows.every(r=>!r.waiting&&r.retentionDueAt===null&&r.retentionVerified===false)).toBe(true);
  const unknown=await f.run(db=>storagePendingDestruction(db,f.maker,{view:'UNKNOWN'}));
  expect(unknown.counts.unknown).toBe(2);expect(unknown.rows.map(r=>r.storageLabel).sort()).toEqual(['26B261025901','26B261025901-3']);
 }finally{await f.close();}
});

it('OWNER-LAB-051: box numbers are allocated atomically as Box001, Box002 … across both types, never reused',async()=>{
 const f=await histFixture();try{
  const created=[];for(const type of ['BACKUP','BUFFY_COAT','BACKUP','BUFFY_COAT'] as const)created.push(await f.run(db=>storageCommand(db,f.maker,{action:'createBox',boxType:type})));
  expect(created.map(b=>b.boxId)).toEqual(['Box001','Box002','Box003','Box004']);
  await expect(f.run(async db=>{await storageCommand(db,f.maker,{action:'createBox',boxType:'BACKUP'});throw new Error('ROLLBACK_PROBE');})).rejects.toThrow('ROLLBACK_PROBE');
  expect((await f.run(db=>storageCommand(db,f.maker,{action:'createBox',boxType:'BACKUP'}))).boxId).toBe('Box006');
 }finally{await f.close();}
});

it('OWNER-LAB-052: due date is 3 calendar years in Asia/Bangkok from each round\'s own PET P[23] receipt',async()=>{
 const f=await histFixture();try{
  // 2024-02-28T18:00Z is 29 Feb 2024 01:00 in Bangkok: Bangkok calendar gives 28 Feb 2027 01:00 (2027-02-27T18:00Z); UTC arithmetic would give 2027-02-28T18:00Z.
  const c=await f.run(db=>syntheticCase(db,f.u,{ln:'9905200001'}));await f.run(db=>receiveS1(db,c,new Date('2024-02-28T18:00:00Z')));
  const row=(await f.run(db=>storageSearch(db,f.maker,{q:c.ln,boxType:'BACKUP'}))).rows[0];
  expect(row).toMatchObject({retentionVerified:true,receivedAt:'2024-02-28T18:00:00.000Z',retentionDueAt:'2027-02-27T18:00:00.000Z'});
 }finally{await f.close();}
});

it('OWNER-LAB-052: pending-destruction lists only due samples per box, flags mixed boxes, and never removes anything',async()=>{
 const f=await histFixture();try{
  const old=await f.run(db=>syntheticCase(db,f.u,{ln:'9905200011'}));await f.run(db=>receiveS1(db,old,new Date('2020-01-10T03:00:00Z')));
  const recent=await f.run(db=>syntheticCase(db,f.u,{ln:'9905200012'}));await f.run(db=>receiveS1(db,recent,new Date('2026-10-01T03:00:00Z')));
  const box=await f.run(db=>storageCommand(db,f.maker,{action:'createBox',boxType:'BUFFY_COAT'}));
  await f.run(db=>storageCommand(db,f.maker,{action:'place',roundId:old.roundId,storageType:'BUFFY_COAT',boxId:box.id,slot:1}));
  await f.run(db=>storageCommand(db,f.maker,{action:'place',roundId:recent.roundId,storageType:'BUFFY_COAT',boxId:box.id,slot:2}));
  const due=await f.run(db=>storagePendingDestruction(db,f.maker,{view:'DUE'}));
  expect(due.counts.due).toBe(1);expect(due.rows.map(r=>r.ln)).toEqual([old.ln]);
  expect(due.boxes).toEqual([expect.objectContaining({id:box.id,total:2,due:1,mixed:true,earliestDueAt:'2023-01-10T03:00:00.000Z'})]);
  const positions=(await f.db.query<{n:number}>('SELECT count(*)::int n FROM lab_storage_typed_position WHERE box_id=$1',[box.id])).rows[0].n;
  expect(positions).toBe(2);
 }finally{await f.close();}
});

it('OWNER-LAB-052 / OWNER-LAB-003: every box action is in an immutable box log with actor, time, source and target',async()=>{
 const f=await histFixture();try{
  const a=await f.run(db=>syntheticCase(db,f.u,{ln:'9905200021'})),b=await f.run(db=>syntheticCase(db,f.u,{ln:'9905200022'}));
  await f.run(db=>receiveS1(db,a,new Date('2026-10-20T01:00:00Z')));await f.run(db=>receiveS1(db,b,new Date('2026-10-20T02:00:00Z')));
  const one=await f.run(db=>storageCommand(db,f.maker,{action:'createBox',boxType:'BACKUP'})),two=await f.run(db=>storageCommand(db,f.maker,{action:'createBox',boxType:'BACKUP'}));
  await f.run(db=>storageLabel(db,f.maker,one.id));await f.run(db=>storageLabel(db,f.maker,one.id));
  await f.run(db=>storageCommand(db,f.maker,{action:'place',roundId:a.roundId,storageType:'BACKUP',boxId:one.id,slot:1}));
  await f.run(db=>storageCommand(db,f.maker,{action:'place',roundId:b.roundId,storageType:'BACKUP',boxId:two.id,slot:5}));
  await f.run(db=>storageSampleLabel(db,f.maker,{roundId:a.roundId,storageType:'BACKUP'}));await f.run(db=>storageSampleLabel(db,f.maker,{roundId:a.roundId,storageType:'BACKUP'}));
  await f.run(db=>storageCommand(db,f.maker,{action:'move',roundId:a.roundId,storageType:'BACKUP',fromBoxId:one.id,fromSlot:1,toBoxId:one.id,toSlot:9}));
  await f.run(db=>storageCommand(db,f.maker,{action:'swap',roundId:a.roundId,otherRoundId:b.roundId,storageType:'BACKUP',boxId:one.id,slot:9,otherBoxId:two.id,otherSlot:5}));
  const [ha,hb]=[await lnHalosOf(f.db,a.roundId),await lnHalosOf(f.db,b.roundId)];
  const after=(await f.run(db=>storageSearch(db,f.maker,{boxType:'BACKUP',q:'990520002'}))).rows.map(r=>[r.storageLabel,r.boxId,r.position]).sort();
  expect(after).toEqual([[`${ha}-3`,two.boxId,'E1'],[`${hb}-3`,one.boxId,'I1']].sort());
  const log=await f.run(db=>storageBoxLog(db,f.maker,{boxId:one.id,pageSize:100}));
  expect(log.events.map(e=>e.eventType).reverse()).toEqual(['BOX_CREATED','BOX_LABEL_PRINTED','BOX_LABEL_REPRINTED','SAMPLE_PLACED','SAMPLE_LABEL_PRINTED','SAMPLE_LABEL_REPRINTED','SAMPLE_MOVED_WITHIN','SAMPLE_REPLACED']);
  expect(log.events.every(e=>e.actor&&e.createdAt&&e.source==='SYSTEM')).toBe(true);
  expect(log.events.find(e=>e.eventType==='SAMPLE_REPLACED')).toMatchObject({relatedBox:two.boxId,relatedPosition:'E1',position:'I1',storageLabel:`${hb}-3`});
  const other=await f.run(db=>storageBoxLog(db,f.maker,{boxId:two.id,eventType:'SAMPLE_REPLACED'}));
  expect(other.events).toEqual([expect.objectContaining({storageLabel:`${ha}-3`,position:'E1',relatedBox:one.boxId,relatedPosition:'I1'})]);
  expect((await f.run(db=>storageBoxLog(db,f.maker,{boxId:one.id,q:'9905200021'}))).events.length).toBeGreaterThan(0);
  await expect(f.db.query("UPDATE lab_storage_box_event SET event_type='BOX_CREATED' WHERE box_id=$1",[one.id])).rejects.toThrow();
  await expect(f.db.query('DELETE FROM lab_storage_box_event WHERE box_id=$1',[one.id])).rejects.toThrow();
  await expect(f.run(db=>storageBoxLog(db,f.u.anc,{boxId:one.id}))).rejects.toThrow('FORBIDDEN');
  await expect(f.run(db=>storageCommand(db,f.maker,{action:'swap',roundId:a.roundId,otherRoundId:b.roundId,storageType:'BACKUP',boxId:one.id,slot:9,otherBoxId:two.id,otherSlot:5}))).rejects.toThrow('STORAGE_MOVE_STALE');
 }finally{await f.close();}
});
