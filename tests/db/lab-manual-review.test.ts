import {it,expect} from 'vitest';
import {histFixture,goodRow,pdfFor,importBatch,view,LOOKUP_KEY} from '../helpers/historical';
import {reviewManual,manualReview} from '../../packages/historical/manual-review';
import {confirmBatch,fixRow} from '../../packages/historical/service';
import {recordManualStages} from '../../packages/historical/manual-stages';
it('Manual final-PDF identity review is independent of real go-live/P5H promotion, bound to the exact draft, and never creates native work or release',async()=>{
 const f=await histFixture();try{
  const row=goodRow(711),batch=await importBatch(f,[row],[{name:row.pdf_file!,bytes:pdfFor(row)}]);const draft=(await view(f,batch)).rows[0];
  const input={draftId:draft.id,version:draft.version,lnMatchesOriginal:true,pdfBindingMatchesOriginal:true,identityMatchesOriginal:true,identityIdentifiersChecked:['HN','NAME'],finalPdfReviewed:true};
  await expect(f.run(db=>reviewManual(db,f.maker,f.store,input))).rejects.toThrow('FORBIDDEN');
  await expect(f.run(db=>reviewManual(db,f.u.certifier,f.store,{...input,identityMatchesOriginal:false}))).rejects.toThrow();
  const reviewed=await f.run(db=>reviewManual(db,f.u.certifier,f.store,input));expect(reviewed.current).toBe(true);
  expect((await manualReview(f.db,f.maker,draft.id)).review?.id).toBe(reviewed.review?.id);
  await f.run(db=>recordManualStages(db,f.maker,{draftId:draft.id,stages:{TASK_LIST:true,QC:true,POOLING:false,SEQUENCING:false}}));
  expect((await manualReview(f.db,f.maker,draft.id)).current).toBe(false);
  expect((await f.run(db=>reviewManual(db,f.u.certifier,f.store,input))).current).toBe(true);
  expect((await f.db.query("SELECT 1 FROM setting_active WHERE setting_key='go_live_cutoff'")).rows).toHaveLength(0);
  expect((await f.db.query('SELECT 1 FROM nipt_case')).rows).toHaveLength(0);expect((await f.db.query('SELECT 1 FROM lab_observation')).rows).toHaveLength(0);expect((await f.db.query('SELECT 1 FROM result_release')).rows).toHaveLength(0);
  await expect(f.run(db=>confirmBatch(db,f.verifier,batch,LOOKUP_KEY,{idempotencyKey:'manual_blocked_p5h_001',rows:[{draftId:draft.id,version:draft.version,attestation:{lnMatchesOriginal:true,anchorDateMatchesOriginal:true,pdfBindingMatchesOriginal:true,identityMatchesOriginal:true,identityIdentifiersChecked:['HN','NAME']}}]}))).rejects.toThrow('HISTORICAL_POLICY_NOT_CONFIGURED');
  await f.run(db=>fixRow(db,f.maker,f.store,draft.id,{original_location:'SYNTHETIC-CABINET-UPDATED'},'Updated original evidence location'));
  expect((await manualReview(f.db,f.maker,draft.id)).current).toBe(false);
  await expect(f.db.query('DELETE FROM lab_manual_result_review')).rejects.toThrow();
 }finally{await f.close();}
});
it('Manual review rejects a PDF identity discrepancy and prevents contributor self-review',async()=>{
 const f=await histFixture();try{
  const row=goodRow(712),batch=await importBatch(f,[row],[{name:row.pdf_file!,bytes:pdfFor(row,{labNumber:'9999999999'})}]);const d=(await view(f,batch)).rows[0];
  const v={draftId:d.id,version:d.version,lnMatchesOriginal:true,pdfBindingMatchesOriginal:true,identityMatchesOriginal:true,identityIdentifiersChecked:['HN','NAME'],finalPdfReviewed:true};
  await expect(f.run(db=>reviewManual(db,f.u.certifier,f.store,v))).rejects.toThrow('MANUAL_PDF_IDENTITY_REQUIRED');
  const good=goodRow(713),b2=await importBatch(f,[good],[{name:good.pdf_file!,bytes:pdfFor(good)}],f.u.certifier);const d2=(await view(f,b2)).rows[0];
  await expect(f.run(db=>reviewManual(db,f.u.certifier,f.store,{...v,draftId:d2.id,version:d2.version}))).rejects.toThrow('FORBIDDEN');
  expect((await f.db.query('SELECT 1 FROM lab_manual_result_review')).rows).toHaveLength(0);
 }finally{await f.close();}
});
