import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {testDatabase} from '../helpers/database';
import {labUsers,docDeps,tx,version} from '../helpers/lab';
import {completedPool,dnbInput} from '../helpers/sequencing';
import {f5Html,type F5Document} from '../../packages/pdf/f5';
import * as s from '../../packages/sequencing/service';
import * as d from '../../packages/sequencing/documents';
import * as rec from '../../packages/lab/records';
it('F5 actor-bound current preview, immutable originals/derivatives, source Stop-use, recall and replacement lineage',async()=>{
 const db=await testDatabase(),u=await labUsers(db),lab=await docDeps(),rendered:F5Document[]=[];
 const deps={store:lab.deps.store,render:async(doc:F5Document)=>{rendered.push(doc);return Buffer.from('%PDF-1.4\n'+f5Html(doc));}};
 try{
  const f=await completedPool(db,u,lab.deps),created=await tx(db,async t=>s.createDnb(t,u.staff,dnbInput(f.batchId,f.poolSnapshotId,await version(t,f.batchId),u.staff.id))),dnbId=created.id!;
  const input=async()=>({batchId:f.batchId,dnbId,expectedVersion:await version(db,f.batchId),kind:'PRE_WORK',purpose:'SYNTHETIC_SIMULATION'});
  await expect(tx(db,async t=>d.issueF5(t,u.staff,await input(),deps))).rejects.toThrow('CURRENT_PREVIEW_REQUIRED');
  await expect(tx(db,async t=>d.issueF5(t,u.staff,{...await input(),purpose:'OPERATIONAL'},deps,true))).rejects.toThrow();
  await tx(db,async t=>d.issueF5(t,u.staff,await input(),deps,true));
  await expect(tx(db,async t=>d.issueF5(t,u.staff2,await input(),deps))).rejects.toThrow('CURRENT_PREVIEW_REQUIRED');
  const doc=await tx(db,async t=>d.issueF5(t,u.staff,await input(),deps));expect(doc.id).toBeTruthy();
  expect(rendered.at(-1)?.fields.every(f=>f.actual===null)).toBe(true);expect(rendered.at(-1)?.evidence).toEqual([]);
  const original=await tx(db,t=>d.readF5(t,u.staff,doc.id!,deps)),reprint=await tx(db,t=>d.printF5(t,u.staff,{documentId:doc.id,kind:'ORIGINAL_REPRINT',reason:'จำลอง พิมพ์ซ้ำต้นฉบับ F5'},deps));expect(reprint.bytes).toEqual(original.bytes);expect(reprint.sha256).toBe(original.sha256);
  const copy=await tx(db,t=>d.printF5(t,u.staff,{documentId:doc.id,kind:'WORKING_COPY',reason:'จำลอง สำเนาใช้งาน F5'},deps));expect(copy.sha256).not.toBe(original.sha256);
  await expect(tx(db,async t=>d.issueF5(t,u.staff,{...await input(),kind:'COMPLETED'},deps,true))).rejects.toThrow('F5_COMPLETION_EVIDENCE_INCOMPLETE');
  await tx(db,t=>rec.decideStageQc1(t,u.certifier,{attemptId:f.attempts[0].id,decision:'Hold',reason:'จำลอง ต้นทางเปลี่ยนหลัง F5'}));
  expect((await db.query("SELECT actor_id FROM p4c_dnb_event WHERE dnb_id=$1 AND event_type='STOP_USE'",[dnbId])).rows[0]).toEqual({actor_id:null});
  const inactive=await tx(db,t=>d.readF5(t,u.staff,doc.id!,deps));expect(inactive.status).toBe('STOP_USE');expect(inactive.bytes).toEqual(original.bytes);
  await expect(tx(db,t=>d.printF5(t,u.staff,{documentId:doc.id,kind:'WORKING_COPY',reason:'จำลอง ห้ามสำเนาเก่า'},deps))).rejects.toThrow('WORKING_COPY_NOT_USABLE');
  await expect(tx(db,t=>d.printF5(t,u.staff,{documentId:doc.id,kind:'ORIGINAL_REPRINT',reason:'จำลอง ไม่มีสิทธิ์ฉบับเก่า'},deps))).rejects.toThrow('FORBIDDEN');
  const status=await tx(db,t=>d.printF5(t,u.certifier,{documentId:doc.id,kind:'STATUS_MARKED',reason:'จำลอง อ่านหลักฐานระงับใช้'},deps));expect(status.sha256).not.toBe(original.sha256);expect(rendered.at(-1)?.copy?.status).toBe('STOP_USE');
  await tx(db,async t=>s.recallCopy(t,u.certifier,{batchId:f.batchId,dnbId,expectedVersion:await version(t,f.batchId),requestId:randomUUID(),copyId:copy.id,reason:'จำลอง เรียกคืนสำเนา F5'}));
  expect((await db.query("SELECT 1 FROM p4c_dnb_event WHERE dnb_id=$1 AND event_type='RECALL'",[dnbId])).rows).toHaveLength(1);
  await expect(db.query("UPDATE p4c_document SET file_sha256=$2 WHERE id=$1",[doc.id,'f'.repeat(64)])).rejects.toThrow(/append-only/);
  await expect(tx(db,t=>d.readF5(t,u.anc,doc.id!,deps))).rejects.toThrow('FORBIDDEN');
 }finally{await db.close();await lab.close();}
},120000);
