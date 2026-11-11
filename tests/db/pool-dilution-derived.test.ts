import {it,expect} from 'vitest';
import {readFileSync,existsSync} from 'node:fs';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {testDatabase} from '../helpers/database';
import {labUsers,tx} from '../helpers/lab';
import {createBatch} from '../../packages/lab/batch';
import {FileStore} from '../../packages/storage';
import {workbookWorkspace,saveWorkbookDraft,exportWorkbook} from '../../packages/workbook/service';
import {exportTaskPdfs} from '../../packages/workbook/native-pdf';
import {readArchive} from '../../packages/workbook/archive';

// Owner 2026-11-11: above 3.6 ng/µL the dilution C1 (E52 of the Pooling Table, so G52 = V1, E55 = EB and the printed PDF) is the Pool Library
// concentration already entered in QC2; nothing is typed twice. At or below the limit E52 stays empty.
const source=process.env.NIPT_TASK_MASTER_PATH??'.local/lab-owner-evidence/lab-combined-master.xlsx';
it.skipIf(!existsSync(source))('the saved draft and the exported Pooling Table carry C1 = the entered concentration only above 3.6',async()=>{
 const db=await testDatabase(),u=await labUsers(db),dir=await mkdtemp(path.join(tmpdir(),'nipt-dilution-derived-'));
 const deps={master:readFileSync(source),store:new FileStore(path.join(dir,'files')),render:exportTaskPdfs};
 const e52=async(revision:number)=>{
  const xlsx=await tx(db,t=>exportWorkbook(t,u.staff,{batchId:batch.batchId,revision,format:'XLSX'},deps));
  const sheet=readArchive(xlsx.bytes).get('xl/worksheets/sheet5.xml')!.toString();
  return /<c\b[^>]*\br="E52"[^>]*?(?:\/>|>([\s\S]*?)<\/c>)/.exec(sheet)?.[1]??''; // an empty cell is self-closing
 };
 let batch!:{batchId:string};
 try{
  batch=await tx(db,t=>createBatch(t,u.staff));
  const first=await tx(db,t=>workbookWorkspace(t,u.staff,batch.batchId,deps));
  // 3.7 ng/µL: C1 is filled by the server (the client never sends it).
  await tx(db,t=>saveWorkbookDraft(t,u.staff,{batchId:batch.batchId,expectedVersion:first.version,expectedRevision:0,values:{'pool.concentration':3.7}},deps));
  const high=await tx(db,t=>workbookWorkspace(t,u.staff,batch.batchId,deps));
  expect(high.values['pool.dilutionC1']).toBe(3.7);
  expect(await e52(1)).toContain('<v>3.7</v>');
  // Back in range: C1 is cleared, even when the request still carries the old one.
  await tx(db,t=>saveWorkbookDraft(t,u.staff,{batchId:batch.batchId,expectedVersion:first.version,expectedRevision:1,values:{'pool.concentration':3.3,'pool.dilutionC1':3.7}},deps));
  const inRange=await tx(db,t=>workbookWorkspace(t,u.staff,batch.batchId,deps));
  expect(inRange.values['pool.concentration']).toBe(3.3);expect('pool.dilutionC1' in inRange.values).toBe(false);
  expect(await e52(2)).not.toContain('<v>');
 }finally{await db.close();await rm(dir,{recursive:true,force:true});}
},180000);
