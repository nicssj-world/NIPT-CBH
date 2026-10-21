import {MASTER_SHA256} from '../../packages/workbook/master';
import {it,expect} from 'vitest';
import {testDatabase} from '../helpers/database';
import {labUsers,tx} from '../helpers/lab';
import {createBatch,deleteEmptyDraft,listBatchPage,setUrgentSlot40,batchDetail} from '../../packages/lab/batch';
it('LAB-06 deletes only empty draft, preserves audit/run allocation and excludes it from the list',async()=>{
 const db=await testDatabase();try{
  const users=await labUsers(db),batch=await tx(db,d=>createBatch(d,users.staff));
  await expect(tx(db,d=>deleteEmptyDraft(d,users.auditor,{batchId:batch.batchId,expectedVersion:0}))).rejects.toThrow('FORBIDDEN');
  await tx(db,d=>deleteEmptyDraft(d,users.staff,{batchId:batch.batchId,expectedVersion:0}));
  expect((await listBatchPage(db,users.staff)).rows).toHaveLength(0);
  expect((await db.query('SELECT 1 FROM lab_batch WHERE id=$1',[batch.batchId])).rows).toHaveLength(1);
  expect((await db.query("SELECT 1 FROM audit_chain WHERE action='LAB_EMPTY_DRAFT_REMOVED'")).rows).toHaveLength(1);
  const next=await tx(db,d=>createBatch(d,users.staff));expect(next.batchId).not.toBe(batch.batchId);
  expect(next.runLabel).not.toBe(batch.runLabel);
  await db.query("INSERT INTO task_workbook_revision(batch_id,revision,master_sha256,source_sha256,source_snapshot,values,created_by) VALUES($1,1,$2,$2,'{}','{}',$3)",[next.batchId,MASTER_SHA256,users.staff.id]);
  await expect(tx(db,d=>deleteEmptyDraft(d,users.staff,{batchId:next.batchId,expectedVersion:0}))).rejects.toThrow('ONLY_EMPTY_DRAFT_BATCH_CAN_BE_REMOVED');
 }finally{await db.close();}
});
it('LAB-09 defaults to BLANK, permits explicit urgent40 mode only on editable placement and retains PC/NC',async()=>{
 const db=await testDatabase();try{
  const users=await labUsers(db),b=await tx(db,d=>createBatch(d,users.staff));
  let w=await batchDetail(db,users.staff,b.batchId);expect(w.slots[39].control).toBe('blank');
  await tx(db,d=>setUrgentSlot40(d,users.staff,{batchId:b.batchId,expectedVersion:0,enabled:true}));
  w=await batchDetail(db,users.staff,b.batchId);expect(w.slots[39].control).toBeNull();expect(w.slots[0].control).toBe('positive');expect(w.slots[24].control).toBe('negative');
  expect((await db.query("SELECT control_type FROM lab_batch_slot WHERE batch_id=$1 AND slot_number=40",[b.batchId])).rows[0]).toEqual({control_type:'blank'});
  await expect(db.query('DELETE FROM lab_slot40_mode')).rejects.toThrow();
 }finally{await db.close();}
});
