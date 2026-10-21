import {it,expect} from 'vitest';
import {histFixture,goodRow,pdfFor,importBatch,view} from '../helpers/historical';
import {recordManualStages,manualStages} from '../../packages/historical/manual-stages';
it('LAB-05 marks only operator-confirmed paper stages, retains corrections and never creates native QC or release',async()=>{
 const f=await histFixture();try{
  const row=goodRow(701),batch=await importBatch(f,[row],[{name:row.pdf_file!,bytes:pdfFor(row)}]);const draft=(await view(f,batch)).rows[0];
  expect(await manualStages(f.db,f.maker,draft.id)).toEqual([]);
  const stages={TASK_LIST:true,QC:false,POOLING:true,SEQUENCING:false};await f.run(db=>recordManualStages(db,f.maker,{draftId:draft.id,stages}));
  expect((await manualStages(f.db,f.verifier,draft.id)).filter(s=>s.performed).map(s=>s.stage).sort()).toEqual(['POOLING','TASK_LIST']);
  await f.run(db=>recordManualStages(db,f.maker,{draftId:draft.id,stages:{...stages,POOLING:false}}));
  expect((await f.db.query('SELECT 1 FROM lab_manual_paper_stage WHERE draft_id=$1',[draft.id])).rows).toHaveLength(3);
  expect((await f.db.query('SELECT 1 FROM lab_observation')).rows).toHaveLength(0);expect((await f.db.query('SELECT 1 FROM result_release')).rows).toHaveLength(0);
  await expect(f.db.query('DELETE FROM lab_manual_paper_stage')).rejects.toThrow();
 }finally{await f.close();}
});
