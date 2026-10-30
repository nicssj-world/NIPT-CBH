import {it,expect} from 'vitest';
import {inboundFixture,register,registrar,writePet,cycle} from '../helpers/inbound';
import {tx} from '../helpers/lab';
import {orderRedraw} from '../../packages/lab/intake';
import {attemptFacts,assignmentDecision} from '../../packages/lab/core';
import {createBatch,assignToBatch} from '../../packages/lab/batch';
it('P3 patient S2 received locally without current-round PET cannot enter Task List by API or direct SQL',async()=>{
 const f=await inboundFixture();
 try{
  const ln='990001009251',hn='9900001251',caseId=await register(f,{ln,hn}),{lab}=await registrar(f.db);
  await writePet(f.root,'20261021',{ln,hn,receivedAt:'20261021090000',specimenAt:'20261021080000'});
  expect((await cycle(f,{now:new Date('2026-10-21T05:00:00Z')})).counts.outcome_APPLIED_S1).toBe(1);
  const redraw=await tx(f.db,db=>orderRedraw(db,lab,{caseId,reasonCode:'SPECIMEN_PROBLEM',note:'SYNTHETIC new specimen without current PET'}));
  // Legacy allowed this local receipt on S2 even without an S2 PET.
  await f.db.query(`UPDATE specimen_round SET state='ReceivedInNIPT',
   received_source='NIPT_LOCAL_RECEIPT',received_at=clock_timestamp(),received_by=$2,
   receipt_check='{"identity":true,"label":true}'::jsonb,collection_date='2026-10-22'
   WHERE id=$1`,[redraw.newRoundId,lab.id]);
  const rows=await attemptFacts(f.db,'a.round_id=$1',[redraw.newRoundId]);
  expect(rows).toHaveLength(1);
  const fail=assignmentDecision(rows[0],'HOLD');
  expect(fail.eligible).toBe(false);
  expect(fail.failed).toContain('CURRENT_ROUND_PET_OR_EQA_VERIFICATION_REQUIRED');
  const b=await tx(f.db,db=>createBatch(db,lab));
  const v=(await f.db.query<{version:number}>('SELECT version FROM lab_batch WHERE id=$1',[b.batchId])).rows[0].version;
  const result=await tx(f.db,db=>assignToBatch(db,lab,{batchId:b.batchId,expectedVersion:v,attemptIds:[rows[0].attempt_id],sheetNumber:1}));
  expect(result.placed).toEqual([]);
  expect(result.rejected[0].failed).toContain('CURRENT_ROUND_PET_OR_EQA_VERIFICATION_REQUIRED');
  await expect(f.db.query("INSERT INTO lab_slot_assignment(batch_id,slot_number,attempt_id,assigned_by) VALUES($1,3,$2,$3)",[b.batchId,rows[0].attempt_id,lab.id])).rejects.toThrow('CURRENT_ROUND_PET_OR_EQA_VERIFICATION_REQUIRED');
  expect((await f.db.query('SELECT * FROM lab_slot_assignment WHERE attempt_id=$1',[rows[0].attempt_id])).rows).toHaveLength(0);
 }finally{await f.close();}
},120000);
