import {it,expect} from 'vitest';
import {existsSync,readFileSync} from 'node:fs';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {testDatabase} from '../helpers/database';
import {labUsers,tx} from '../helpers/lab';
import {createBatch} from '../../packages/lab/batch';
import {FileStore} from '../../packages/storage';
import {workbookWorkspace,saveWorkbookDraft,exportWorkbook,downloadWorkbookExport} from '../../packages/workbook/service';
import {sha256,readArchive} from '../../packages/workbook/archive';
import {listActualIqc} from '../../packages/eqa/service';
const masterPath=process.env.NIPT_TASK_MASTER_PATH??'.local/lab-owner-evidence/lab-combined-master.xlsx';
it.skipIf(!existsSync(masterPath))('native workbook drafts resume, reject stale revisions, export/readback and immutable audit history',async()=>{
  const db=await testDatabase(),u=await labUsers(db),temp=await mkdtemp(path.join(tmpdir(),'nipt-workbook-db-'));
  const deps={master:readFileSync(masterPath),store:new FileStore(temp),render:async()=>{throw new Error('NATIVE_RENDERER_NOT_AVAILABLE_IN_DB_TEST');}};
  try {
    const created=await tx(db,t=>createBatch(t,u.staff)),batch={id:created.batchId};
    const initial=await tx(db,t=>workbookWorkspace(t,u.staff,batch.id,deps));expect(initial.draft).toBeNull();
    // Task metadata is source-owned (Plan §5.1): typing it into a workbook draft is refused server-side.
    await expect(tx(db,t=>saveWorkbookDraft(t,u.staff,{batchId:batch.id,expectedVersion:initial.version,expectedRevision:0,values:{'task.1.operator':'SYNTHETIC OPERATOR','slot.1.libraryQc':2.5}},deps))).rejects.toThrow('TASK_SOURCE_FIELD_READ_ONLY');
    const draft=await tx(db,t=>saveWorkbookDraft(t,u.staff,{batchId:batch.id,expectedVersion:initial.version,expectedRevision:0,values:{'slot.1.libraryQc':2.5}},deps));
    const resumed=await tx(db,t=>workbookWorkspace(t,u.staff,batch.id,deps));expect(resumed.draft?.id).toBe(draft.id);expect(resumed.values['slot.1.libraryQc']).toBe(2.5);
    await expect(tx(db,t=>saveWorkbookDraft(t,u.staff,{batchId:batch.id,expectedVersion:initial.version,expectedRevision:0,values:{}},deps))).rejects.toThrow('TASK_DRAFT_VERSION_CONFLICT');
    await expect(tx(db,t=>saveWorkbookDraft(t,u.anc,{batchId:batch.id,expectedVersion:initial.version,expectedRevision:1,values:{}},deps))).rejects.toThrow('FORBIDDEN');
    await expect(tx(db,t=>saveWorkbookDraft(t,u.staff,{batchId:batch.id,expectedVersion:initial.version,expectedRevision:1,values:{'slot.2.printedSampleId':'FORGED'}},deps))).rejects.toThrow('TASK_SOURCE_FIELD_READ_ONLY');
    const out=await tx(db,t=>exportWorkbook(t,u.staff,{batchId:batch.id,revision:1,format:'XLSX'},deps));
    expect(sha256(out.bytes)).toBe(out.sha256);expect(readArchive(out.bytes).get('xl/worksheets/sheet4.xml')!.toString()).toContain('<v>2.5</v>');
    const downloaded=await tx(db,t=>downloadWorkbookExport(t,u.staff,out.id,deps));expect(downloaded.bytes.equals(out.bytes)).toBe(true);
    const history=await tx(db,t=>workbookWorkspace(t,u.auditor,batch.id,deps));expect(history.exports).toHaveLength(1);
    await expect(db.query('UPDATE task_workbook_revision SET values=$1 WHERE id=$2',['{}',draft.id])).rejects.toThrow(/immutable|append.only/);
    await expect(tx(db,t=>exportWorkbook(t,u.staff,{batchId:batch.id,revision:1,format:'PDF',sheet:'Ext. & Prep. Task List 1'},deps))).rejects.toThrow('NATIVE_RENDERER_NOT_AVAILABLE_IN_DB_TEST');
    expect((await db.query('SELECT * FROM task_workbook_export')).rows).toHaveLength(1);
    const second=await tx(db,t=>saveWorkbookDraft(t,u.staff,{batchId:batch.id,expectedVersion:initial.version,expectedRevision:1,values:{}},deps));expect(second.values).toEqual({});
    await expect(tx(db,t=>exportWorkbook(t,u.staff,{batchId:batch.id,revision:1,format:'XLSX'},deps))).rejects.toThrow('TASK_CURRENT_DRAFT_REQUIRED');
  } finally {await db.close();await rm(temp,{recursive:true,force:true});}
},120000);
it.skipIf(!existsSync(masterPath))('IQC reads actual control measurements from the latest workbook revision and enforces role permissions',async()=>{
 const db=await testDatabase(),u=await labUsers(db),temp=await mkdtemp(path.join(tmpdir(),'nipt-iqc-db-'));
 const deps={master:readFileSync(masterPath),store:new FileStore(temp),render:async()=>{throw Error('NO_RENDER');}};
 try{
  const b=await tx(db,t=>createBatch(t,u.staff));
  const initial=await tx(db,t=>workbookWorkspace(t,u.staff,b.batchId,deps));
  const year=(await db.query<{run_year:number}>('SELECT run_year FROM lab_batch WHERE id=$1',[b.batchId])).rows[0].run_year;
  await tx(db,t=>saveWorkbookDraft(t,u.staff,{batchId:b.batchId,expectedVersion:initial.version,expectedRevision:0,values:{'slot.1.libraryQc':2.5,'slot.25.libraryQc':0.8}},deps));
  const rows=(await listActualIqc(db,u.staff,year)).filter(x=>x.batch_id===b.batchId);
  expect(rows.map(x=>[x.control_type,x.slot_number,x.measurement,x.revision])).toEqual([['positive',1,'2.5',1],['negative',25,'0.8',1]]);
  await expect(listActualIqc(db,u.anc,year)).rejects.toThrow('FORBIDDEN');
 }finally{await db.close();await rm(temp,{recursive:true,force:true});}
},120000);
