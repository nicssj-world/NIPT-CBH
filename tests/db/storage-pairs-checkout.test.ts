import {it,expect} from 'vitest';
import {histFixture} from '../helpers/historical';
import {syntheticCase,receiveS1} from '../helpers/lab';
import {storageSearch,storageCommand,storageBoxLog} from '../../packages/lab/sample-storage';

// Owner 2026-11-10 (sample storage): Backup Box N and Buffy Coat Box N open together and fill in parallel; an empty box can be deleted
// (marked, the row and its history stay); a stored sample can be checked out with a reason, keeps its slot and can be returned.
const stored=(f:Awaited<ReturnType<typeof histFixture>>,ln:string,at='2026-10-01T03:00:00Z')=>f.run(async db=>{const c=await syntheticCase(db,f.u,{ln});await receiveS1(db,c,new Date(at));return c;});

it('opens a pair with the same number and Auto-fill puts a sample into both boxes at the same slot',async()=>{
 const f=await histFixture();try{
  const pair=await f.run(db=>storageCommand(db,f.maker,{action:'createBoxPair'}));
  expect(pair.boxes.map(b=>`${b.boxType}:${b.boxId}`)).toEqual(['BACKUP:Box001','BUFFY_COAT:Box001']);
  const second=await f.run(db=>storageCommand(db,f.maker,{action:'createBoxPair'}));expect(second.boxes.map(b=>b.boxId)).toEqual(['Box002','Box002']);
  const a=await stored(f,'9905300001'),b=await stored(f,'9905300002','2026-10-02T03:00:00Z');
  const plan=await f.run(db=>storageCommand(db,f.maker,{action:'autoFillPreview',storageTypes:['BACKUP','BUFFY_COAT']}));
  expect(plan.planned).toBe(4);
  await f.run(db=>storageCommand(db,f.maker,{action:'autoFillConfirm',storageTypes:['BACKUP','BUFFY_COAT'],planHash:plan.planHash}));
  const rows=await f.db.query<{round_id:string;storage_type:string;slot:number;box_id:string}>('SELECT p.round_id,p.storage_type,p.slot,b.box_id FROM lab_storage_typed_position p JOIN lab_storage_box b ON b.id=p.box_id ORDER BY p.round_id,p.storage_type');
  for(const c of [a,b]){const mine=rows.rows.filter(r=>r.round_id===c.roundId);expect(mine).toHaveLength(2);expect(new Set(mine.map(r=>r.slot)).size).toBe(1);expect(new Set(mine.map(r=>r.box_id))).toEqual(new Set(['Box001']));}
  const open=await f.run(db=>storageSearch(db,f.maker,{activeBoxId:pair.boxes[0].id}));
  expect(open.activeBox).toMatchObject({boxId:'Box001',boxType:'BACKUP',typeNumber:1,used:2,deletable:false,partner:expect.objectContaining({boxId:'Box001',boxType:'BUFFY_COAT',used:2})});
 }finally{await f.close();}
},60000);

it('deletes only an empty box (with its partner when asked): the rows and history stay and the box leaves the lists, Auto-fill and the label',async()=>{
 const f=await histFixture();try{
  const pair=await f.run(db=>storageCommand(db,f.maker,{action:'createBoxPair'}));
  const c=await stored(f,'9905300011');
  await f.run(db=>storageCommand(db,f.maker,{action:'place',roundId:c.roundId,storageType:'BACKUP',boxId:pair.boxes[0].id,slot:1}));
  await expect(f.run(db=>storageCommand(db,f.maker,{action:'deleteBox',boxId:pair.boxes[0].id,withPartner:true}))).rejects.toThrow('STORAGE_BOX_NOT_EMPTY');
  // the failed attempt changed nothing (one transaction): the empty partner is still there
  expect((await f.db.query('SELECT 1 FROM lab_storage_box WHERE deleted_at IS NOT NULL')).rows).toEqual([]);
  const done=await f.run(db=>storageCommand(db,f.maker,{action:'deleteBox',boxId:pair.boxes[1].id,withPartner:false,reason:'เปิดผิดกล่อง'}));
  expect(done.deleted).toEqual([expect.objectContaining({boxId:'Box001',boxType:'BUFFY_COAT'})]);
  const list=await f.run(db=>storageSearch(db,f.maker,{boxType:'ALL'}));expect(list.boxes.map(b=>b.boxType)).toEqual(['BACKUP']);
  const row=(await f.db.query<{deleted_by:string;delete_reason:string}>('SELECT deleted_by,delete_reason FROM lab_storage_box WHERE id=$1',[pair.boxes[1].id])).rows[0];
  expect(row).toEqual({deleted_by:f.maker.id,delete_reason:'เปิดผิดกล่อง'});
  const log=await f.run(db=>storageBoxLog(db,f.maker,{boxId:pair.boxes[1].id}));expect(log.events.map(e=>e.eventType)).toEqual(['BOX_DELETED','BOX_CREATED']);
  // a deleted box takes no sample and cannot be deleted again; rows cannot be removed or rewritten outside the command
  await expect(f.run(db=>storageCommand(db,f.maker,{action:'place',roundId:c.roundId,storageType:'BUFFY_COAT',boxId:pair.boxes[1].id,slot:1}))).rejects.toThrow('STORAGE_BOX_DELETED');
  await expect(f.run(db=>storageCommand(db,f.maker,{action:'deleteBox',boxId:pair.boxes[1].id,withPartner:false}))).rejects.toThrow('STORAGE_BOX_ALREADY_DELETED');
  await expect(f.db.query('DELETE FROM lab_storage_box WHERE id=$1',[pair.boxes[1].id])).rejects.toThrow(/LAB_STORAGE_BOX_DELETE_PROHIBITED/);
  await expect(f.db.query("UPDATE lab_storage_box SET box_id='X' WHERE id=$1",[pair.boxes[0].id])).rejects.toThrow(/LAB_STORAGE_BOX_IMMUTABLE|LAB_STORAGE_BOX_WRITE_REQUIRES_COMMAND/);
  const plan=await f.run(db=>storageCommand(db,f.maker,{action:'autoFillPreview',storageTypes:['BUFFY_COAT']}));expect(plan.placements.every(p=>p.boxUuid!==pair.boxes[1].id)).toBe(true);
 }finally{await f.close();}
},60000);

it('checks a sample out with a reason: the slot stays reserved and shows the reason, the sample cannot be moved until it is returned',async()=>{
 const f=await histFixture();try{
  const pair=await f.run(db=>storageCommand(db,f.maker,{action:'createBoxPair'}));
  const c=await stored(f,'9905300021'),other=await stored(f,'9905300022','2026-10-02T03:00:00Z');
  const box=pair.boxes[0].id;
  await f.run(db=>storageCommand(db,f.maker,{action:'place',roundId:c.roundId,storageType:'BACKUP',boxId:box,slot:1}));
  await f.run(db=>storageCommand(db,f.maker,{action:'place',roundId:other.roundId,storageType:'BACKUP',boxId:box,slot:2}));
  await expect(f.run(db=>storageCommand(db,f.maker,{action:'checkOut',roundId:c.roundId,storageType:'BACKUP',boxId:box,slot:1,reason:'ก'}))).rejects.toThrow();   // reason too short
  await expect(f.run(db=>storageCommand(db,f.maker,{action:'checkOut',roundId:c.roundId,storageType:'BACKUP',boxId:box,slot:5,reason:'ส่งตรวจซ้ำที่ห้องปฏิบัติการ'}))).rejects.toThrow('STORAGE_MOVE_STALE');
  await f.run(db=>storageCommand(db,f.maker,{action:'checkOut',roundId:c.roundId,storageType:'BACKUP',boxId:box,slot:1,reason:'ส่งตรวจซ้ำที่ห้องปฏิบัติการ'}));
  const open=await f.run(db=>storageSearch(db,f.maker,{activeBoxId:box}));
  expect(open.activeBox!.grid[0]).toMatchObject({occupied:true,roundId:c.roundId,checkout:expect.objectContaining({reason:'ส่งตรวจซ้ำที่ห้องปฏิบัติการ'})});
  expect(open.activeBox!.grid[1].checkout).toBeNull();expect(open.activeBox!.used).toBe(2);   // still holds its slot
  const found=await f.run(db=>storageSearch(db,f.maker,{q:c.ln,boxType:'BACKUP'}));expect(found.rows[0]).toMatchObject({checkedOut:true,position:'A1'});
  await expect(f.run(db=>storageCommand(db,f.maker,{action:'checkOut',roundId:c.roundId,storageType:'BACKUP',boxId:box,slot:1,reason:'ซ้ำอีกครั้ง'}))).rejects.toThrow('STORAGE_ALREADY_CHECKED_OUT');
  await expect(f.run(db=>storageCommand(db,f.maker,{action:'move',roundId:c.roundId,storageType:'BACKUP',fromBoxId:box,fromSlot:1,toBoxId:box,toSlot:3}))).rejects.toThrow('STORAGE_SAMPLE_CHECKED_OUT');
  await expect(f.run(db=>storageCommand(db,f.maker,{action:'swap',roundId:c.roundId,otherRoundId:other.roundId,storageType:'BACKUP',boxId:box,slot:1,otherBoxId:box,otherSlot:2}))).rejects.toThrow('STORAGE_SAMPLE_CHECKED_OUT');
  await expect(f.run(db=>storageCommand(db,f.maker,{action:'returnToBox',roundId:other.roundId,storageType:'BACKUP',boxId:box,slot:2}))).rejects.toThrow('STORAGE_NOT_CHECKED_OUT');
  await f.run(db=>storageCommand(db,f.maker,{action:'returnToBox',roundId:c.roundId,storageType:'BACKUP',boxId:box,slot:1}));
  const back=await f.run(db=>storageSearch(db,f.maker,{activeBoxId:box}));expect(back.activeBox!.grid[0].checkout).toBeNull();
  await f.run(db=>storageCommand(db,f.maker,{action:'move',roundId:c.roundId,storageType:'BACKUP',fromBoxId:box,fromSlot:1,toBoxId:box,toSlot:3}));   // free to move again
  const log=await f.run(db=>storageBoxLog(db,f.maker,{boxId:box,eventType:'ALL'}));
  expect(log.events.map(e=>e.eventType)).toEqual(expect.arrayContaining(['SAMPLE_CHECKED_OUT','SAMPLE_RETURNED']));
  expect(log.events.find(e=>e.eventType==='SAMPLE_CHECKED_OUT')).toMatchObject({reason:'ส่งตรวจซ้ำที่ห้องปฏิบัติการ',position:'A1'});   // the box log carries the reason
  expect(log.events.find(e=>e.eventType==='SAMPLE_RETURNED')).toMatchObject({reason:'นำกลับเข้ากล่อง'});
  const history=await f.db.query<{event:string;reason:string}>('SELECT event,reason FROM lab_storage_checkout ORDER BY sequence');
  expect(history.rows).toEqual([{event:'CHECK_OUT',reason:'ส่งตรวจซ้ำที่ห้องปฏิบัติการ'},{event:'RETURN',reason:'นำกลับเข้ากล่อง'}]);
  await expect(f.db.query("UPDATE lab_storage_checkout SET reason='x ก' WHERE event='CHECK_OUT'")).rejects.toThrow();
 }finally{await f.close();}
},60000);
