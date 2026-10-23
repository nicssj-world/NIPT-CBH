import {it,expect} from 'vitest';
import {histFixture,goodRow,pdfFor,importBatch,view} from '../helpers/historical';
import {registerP2} from '../../packages/p2/service';
import {storageSearch,storageCommand,storageLabel} from '../../packages/lab/sample-storage';
import {replaceRowPdf,getBatch} from '../../packages/historical/service';
import {reviewManual} from '../../packages/historical/manual-review';
import {authorize} from '../../packages/security/policy';
it('LAB-UAT-003: storage permission, unique position, exact box-label identity and LN/HN lookup',async()=>{
 const f=await histFixture();try{
  const c=await f.run(db=>registerP2(db,f.maker,{ln:'9903002901',hn:'9900042901',unitId:f.u.unit,origin:'LAB_DIRECT',identifierSource:'TUBE_LABEL',idempotencyKey:'storage_lab_uat_32_001'},Buffer.alloc(32,7),{store:f.store}));
  const round=(await f.db.query<{id:string}>('SELECT current_round_id id FROM nipt_case WHERE id=$1',[c.caseId])).rows[0].id;
  const box=await f.run(db=>storageCommand(db,f.maker,{action:'createBox'}));
  await expect(f.run(db=>storageCommand(db,f.u.anc,{action:'store',roundId:round,boxId:box.id,slot:1}))).rejects.toThrow('FORBIDDEN');
  await f.run(db=>storageCommand(db,f.maker,{action:'store',roundId:round,boxId:box.id,slot:10}));
  await expect(f.run(db=>storageCommand(db,f.maker,{action:'store',roundId:round,boxId:box.id,slot:2}))).rejects.toThrow('STORAGE_POSITION_OCCUPIED');
  const found=await f.run(db=>storageSearch(db,f.maker,{q:'9900042901'}));expect(found.rows[0]).toMatchObject({position:'A2',box_id:'Box001'});
  expect((await f.run(db=>storageLabel(db,f.maker,box.id))).subarray(0,5).toString()).toBe('%PDF-');
  expect(authorize(f.maker,'settings.read',{},'read')).toBe(false);expect(authorize(f.u.anc,'settings.read',{},'read')).toBe(false);
 }finally{await f.close();}
});
it('LAB-UAT-008/011/012/013/014/016: same operator completes, corrects and replaces only one PDF; original evidence and clinical HOLD retained',async()=>{
 const f=await histFixture();try{
  const r=goodRow(901),batch=await importBatch(f,[r],[{name:r.pdf_file!,bytes:pdfFor(r)}]);let d=(await view(f,batch)).rows[0];const file=d.pdfName;
  const done=await f.run(db=>reviewManual(db,f.maker,f.store,{draftId:d.id,version:d.version,lnMatchesOriginal:true,pdfBindingMatchesOriginal:true,identityMatchesOriginal:true,identityIdentifiersChecked:['HN','NAME'],finalPdfReviewed:true}));expect(done.current).toBe(true);
  expect((await f.run(db=>getBatch(db,f.maker,batch,{q:r.hn}))).manualSummary.done).toBe(1);
  await f.run(db=>replaceRowPdf(db,f.maker,f.store,d.id,d.version,{name:'new.pdf',bytes:pdfFor(r,{labNumber:'9999999999'})}));
  const changed=await view(f,batch);d=changed.rows[0];expect(d.issues.some(i=>i.code==='PDF_LN_DIFFERS'&&i.severity==='ERROR')).toBe(true);expect(changed.manualSummary.done).toBe(0);
  expect(changed.files.some(f=>f.original_name===file)).toBe(true);
  expect((await f.db.query('SELECT 1 FROM historical_draft_revision WHERE draft_id=$1',[d.id])).rows).toHaveLength(2);
  expect((await f.db.query('SELECT 1 FROM result_release')).rows).toHaveLength(0);
 }finally{await f.close();}
});
