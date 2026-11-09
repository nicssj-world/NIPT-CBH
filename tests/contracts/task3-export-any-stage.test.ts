import {workbookError} from '../../src/server/workbook';
import type {Queryable} from '../../packages/db/connection';
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

it('reports every incomplete specimen with its slot, sample and missing fields, preserves atomic export, and succeeds after correction',async()=>{
 const f=await task3Fixture();
 try{
  const deps={master:readFileSync(process.env.NIPT_TASK_MASTER_PATH!),store:f.store,render:async()=>{throw Error('NO_NATIVE_PRINT');}};
  // Model two incomplete source records without changing immutable clinical evidence.
  const incomplete=(db:Queryable):Queryable=>({query:async<T>(sql:string,values?:unknown[])=>{
   const result=await db.query<T>(sql,values);
   if(sql.startsWith('SELECT l.ln,')&&f.cases.slice(0,2).some(c=>c.roundId===values?.[0])){
    return {rows:result.rows.map(row=>({...row,edd:null,pregnancy:null})) as T[]};
   }
   return result;
  }});
  const counts=async()=>(await f.db.query('SELECT (SELECT count(*) FROM lab_bench_export) exports,(SELECT count(*) FROM lab_seq_export_pair) pairs,(SELECT count(*) FROM lab_actual_pooling) pooling')).rows[0];
  const before=await counts();
  for(const kind of ['single','pair']){
   const error=await f.run(async db=>{if(kind==='single')await benchExport(incomplete(db),f.u.staff,{batchId:f.batchId,revision:1,kind:'NIFTY_XLSX'},deps);
    else await exportSeqPair(incomplete(db),f.u.staff,{batchId:f.batchId,revision:1,idempotencyKey:randomUUID()},deps);
   }).then(()=>null,e=>e);
   expect(error).toMatchObject({code:'VENDOR_EXPORT_VALIDATION_FAILED',details:{issues:f.cases.slice(0,2).map(c=>({sampleId:c.printed,caseId:c.caseId,problems:['ยังไม่ได้ระบุกำหนดคลอด (EDD)','ยังไม่ได้ระบุประเภทครรภ์ (ครรภ์เดี่ยว/แฝด)']}))}});
   expect(error.details.issues.map((i:{slot:number})=>i.slot)).toEqual([2,17]);
   const response=workbookError(error),body=await response.json();
   expect(response.status).toBe(409);
   expect(body.error).toContain('ส่งออก XLSX ไม่สำเร็จ');
   expect(body.details.issues).toHaveLength(2);
   expect(JSON.stringify(body)).not.toContain(f.cases[0].hn);
   expect(await counts()).toEqual(before);
  }
  const invalid=(db:Queryable):Queryable=>({query:async<T>(sql:string,values?:unknown[])=>{
   const result=await db.query<T>(sql,values);
   if(!sql.startsWith('SELECT l.ln,'))return result;
   const index=f.cases.findIndex(c=>c.roundId===values?.[0]);
   return {rows:result.rows.map(row=>({...row,...(index===0?{sha256:null}:index===1?{draft:{patient:{dob:'1980-01-01'}}}:{edd:'2020-01-01'})})) as T[]};
  }});
  const invalidError=await f.run(db=>benchExport(invalid(db),f.u.staff,{batchId:f.batchId,revision:1,kind:'NIFTY_XLSX'},deps)).then(()=>null,e=>e);
  expect(invalidError.details.issues).toHaveLength(3);
  expect(invalidError.details.issues.map((i:{problems:string[]})=>i.problems.join(' '))).toEqual([
   expect.stringContaining('ไม่พบหลักฐาน PET'),expect.stringContaining('ข้อมูลตัวตน'),expect.stringContaining('ไม่สอดคล้องกัน'),
  ]);
  expect(await counts()).toEqual(before);
  await expect(f.run(db=>exportSeqPair(db,f.u.staff,{batchId:f.batchId,revision:1,idempotencyKey:randomUUID()},deps))).resolves.toMatchObject({files:expect.arrayContaining([expect.objectContaining({kind:'NIFTY_XLSX'}),expect.objectContaining({kind:'HALOS_TASK_XLSX'})])});
 }finally{await f.close();}
},300000);
