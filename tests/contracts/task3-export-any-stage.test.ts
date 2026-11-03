import {it,expect,vi} from 'vitest';
import {readFileSync,copyFileSync,existsSync,rmSync} from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {task3Fixture} from '../helpers/task3';
import {benchWorkspace,benchExport} from '../../packages/lab/bench';
import {saveWorkbookDraft} from '../../packages/workbook/service';
import {exportSeqPair} from '../../packages/lab/seq-export';

// Owner decision 2026-11-03: the two-file export (NIFTY + HALOS) is available at every stage. When the recorded actual pooling is not current for the saved task
// (here: a QC value edited after it was recorded) the server records one from the saved task, marked as automatic, and still produces both files.
it('exports NIFTY and HALOS when the recorded actual pooling is stale, with an automatic marked record that never counts as the operator transfer',async()=>{
 const f=await task3Fixture();
 try{
  const deps={master:readFileSync(process.env.NIPT_TASK_MASTER_PATH!),store:f.store,render:async()=>{throw Error('NO_NATIVE_PRINT');}};
  const w=await f.run(t=>benchWorkspace(t,f.u.staff,f.batchId,deps));
  const version=async()=>(await f.db.query<{version:number}>('SELECT version FROM lab_batch WHERE id=$1',[f.batchId])).rows[0].version;
  const values={...w.values,'qc.1.standard1':11};
  await f.run(async t=>saveWorkbookDraft(t,f.u.staff,{batchId:f.batchId,expectedVersion:await version(),expectedRevision:1,values},deps));
  const revision=(await f.run(t=>benchWorkspace(t,f.u.staff,f.batchId,deps))).revision;
  const pair=await f.run(t=>exportSeqPair(t,f.u.staff,{batchId:f.batchId,revision,idempotencyKey:randomUUID()},deps));
  expect(pair.files.map(x=>x.kind).sort()).toEqual(['HALOS_TASK_XLSX','NIFTY_XLSX']);
  const rows=(await f.db.query<{note:string;recorded_by:string}>('SELECT note,recorded_by FROM lab_actual_pooling WHERE batch_id=$1 ORDER BY recorded_at DESC,id DESC',[f.batchId])).rows;
  expect(rows[0]).toMatchObject({note:'AUTO_RECORDED_FROM_SAVED_TASK_AT_EXPORT',recorded_by:f.u.staff.id});
  expect(rows.length).toBe(2);                                    // the operator's earlier record is kept untouched
  const after=await f.run(t=>benchWorkspace(t,f.u.staff,f.batchId,deps));
  expect(after.actualPooling?.note??'').not.toBe('AUTO_RECORDED_FROM_SAVED_TASK_AT_EXPORT');
 }finally{await f.close();}
},300000);

// The installed servers set only NIPT_TASK_MASTER_PATH: the three owner templates are found beside the master workbook (data\master), never via NIPT_*_TEMPLATE.
it('exports work with no template variable set when the pinned templates sit beside the master workbook',async()=>{
 const f=await task3Fixture();
 const dir=path.dirname(path.resolve(process.env.NIPT_TASK_MASTER_PATH!)),placed:string[]=[];
 try{
  for(const [from,to] of [['nifty.xlsx','nifty.xlsx'],['halos-task.xlsx','halos-task.xlsx'],['pooling.csv','pooling.csv']]){const target=path.join(dir,to);if(!existsSync(target)){copyFileSync(path.resolve('.local/approved',from),target);placed.push(target);}}
  for(const name of ['NIPT_NIFTY_XLSX_TEMPLATE','NIPT_HALOS_TASK_TEMPLATE','NIPT_POOL_CSV_TEMPLATE'])vi.stubEnv(name,'');
  const deps={master:readFileSync(process.env.NIPT_TASK_MASTER_PATH!),store:f.store,render:async()=>{throw Error('NO_NATIVE_PRINT');}};
  const revision=(await f.run(t=>benchWorkspace(t,f.u.staff,f.batchId,deps))).revision;
  const nifty=await f.run(t=>benchExport(t,f.u.staff,{batchId:f.batchId,revision,kind:'NIFTY_XLSX'},deps));
  expect(nifty.bytes.length).toBeGreaterThan(1000);
  const csv=await f.run(t=>benchExport(t,f.u.staff,{batchId:f.batchId,revision,kind:'POOL_CSV'},deps));
  expect(csv.bytes.length).toBeGreaterThan(100);
  const pair=await f.run(t=>exportSeqPair(t,f.u.staff,{batchId:f.batchId,revision,idempotencyKey:randomUUID()},deps));
  expect(pair.files.map(x=>x.kind).sort()).toEqual(['HALOS_TASK_XLSX','NIFTY_XLSX']);
 }finally{for(const p of placed)rmSync(p,{force:true});vi.unstubAllEnvs();await f.close();}
},300000);
