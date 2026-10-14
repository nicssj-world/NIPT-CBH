import {it,expect} from 'vitest';
import {readFileSync,existsSync} from 'node:fs';
import {mkdir,writeFile,mkdtemp,readdir,copyFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {PGlite} from '@electric-sql/pglite';
import {migrate} from '../../tools/migrate';
import path from 'node:path';
import {testDatabase} from '../helpers/database';
import {labUsers,tx} from '../helpers/lab';
import {createBatch} from '../../packages/lab/batch';
import {FileStore} from '../../packages/storage';
import {workbookWorkspace,saveWorkbookDraft,exportWorkbook} from '../../packages/workbook/service';
import {exportTaskPdfs} from '../../packages/workbook/native-pdf';
const source=process.env.NIPT_TASK_MASTER_PATH??'C:/Users/User/Downloads/Final_New_Task_List_Edit_2_F52_Corrected.xlsx';
it.skipIf(!existsSync(source))('091 upgrades existing immutable old-master drafts without rewriting history and requires explicit rebind before new export',async()=>{
 const db=new PGlite(),dir=await mkdtemp(path.join(tmpdir(),'nipt-f52-upgrade-'));
 try{
  for(const name of await readdir('db/migrations'))if(/^\d+.*\.sql$/.test(name)&&Number(name.slice(0,3))<=90)await copyFile(path.join('db/migrations',name),path.join(dir,name));
  await migrate(db,dir);const users=await labUsers(db),batch=await tx(db,t=>createBatch(t,users.staff));
  const old='2747a9f6c6da9231996bd9d0a23b1da3100d910209d440643c70158f7fe20722';
  await db.query("INSERT INTO task_workbook_revision(batch_id,revision,master_sha256,source_sha256,source_snapshot,values,created_by) VALUES($1,1,$2,$3,'{}',$4,$5)",[batch.batchId,old,'a'.repeat(64),JSON.stringify({'pool.dilutionC1':10}),users.staff.id]);
  await migrate(db);await migrate(db);
  const deps={master:readFileSync(source),store:new FileStore(path.join(dir,'files')),render:exportTaskPdfs};
  const workspace=await tx(db,t=>workbookWorkspace(t,users.staff,batch.batchId,deps));expect(workspace.sourceStale).toBe(true);expect(workspace.draft?.master_sha256).toBe(old);
  await expect(tx(db,t=>exportWorkbook(t,users.staff,{batchId:batch.batchId,revision:1,format:'XLSX'},deps))).rejects.toThrow('TASK_SOURCE_CHANGED_REBIND_REQUIRED');
  await tx(db,t=>saveWorkbookDraft(t,users.staff,{batchId:batch.batchId,expectedVersion:workspace.version,expectedRevision:1,values:workspace.values},deps));
  expect((await tx(db,t=>workbookWorkspace(t,users.staff,batch.batchId,deps))).sourceStale).toBe(false);
  expect((await db.query<{master_sha256:string}>('SELECT master_sha256 FROM task_workbook_revision WHERE batch_id=$1 ORDER BY revision',[batch.batchId])).rows.map(r=>r.master_sha256)).toEqual([old,'2f8aef50243c89eae6a4e9115d65fbf9239754a1bd9ce330205378f3a9b3aacf']);
 }finally{await db.close();await rm(dir,{recursive:true,force:true});}
},120000);
it.skipIf(process.env.NIPT_TEST_NATIVE_EXCEL!=='yes'||!existsSync(source))('F52 native Excel: D52 draft/save/resume matches XLSX and PDF recalculation, then rebinds changed concentration',async()=>{
 const db=await testDatabase(),u=await labUsers(db),dir=path.resolve('.local/workbook-f52-approved');await mkdir(dir,{recursive:true});
 const deps={master:readFileSync(source),store:new FileStore(path.join(dir,'files')),render:exportTaskPdfs},evidence:unknown[]=[];
 try{
  const batch=await tx(db,t=>createBatch(t,u.staff));const first=await tx(db,t=>workbookWorkspace(t,u.staff,batch.batchId,deps));
  for(const [revision,value,f52,d55]of [[1,10,33.3,66.7],[2,20,16.65,83.35]]){
   await tx(db,t=>saveWorkbookDraft(t,u.staff,{batchId:batch.batchId,expectedVersion:first.version,expectedRevision:revision-1,values:{'pool.dilutionC1':value}},deps));
   const resumed=await tx(db,t=>workbookWorkspace(t,u.staff,batch.batchId,deps));expect(resumed.values['pool.dilutionC1']).toBe(value);expect(resumed.sourceStale).toBe(false);
   const xlsx=await tx(db,t=>exportWorkbook(t,u.staff,{batchId:batch.batchId,revision,format:'XLSX'},deps));await writeFile(path.join(dir,`d52-${value}.xlsx`),xlsx.bytes);
   const pdf=await tx(db,t=>exportWorkbook(t,u.staff,{batchId:batch.batchId,revision,format:'PDF',sheet:'Pooling Table'},deps));await writeFile(path.join(dir,`d52-${value}.pdf`),pdf.bytes);
   expect(pdf.manifest.xlsxSha256).toBe(xlsx.sha256);expect(pdf.manifest.formulaErrors).toEqual([]);
   const calculated=pdf.manifest.poolingCalculation as {D52:number;F52:number;D55:number;F52Formula:string;D55Formula:string};
   expect(calculated.D52).toBe(value);expect(calculated.F52).toBeCloseTo(f52,10);expect(calculated.D55).toBeCloseTo(d55,10);expect(calculated.F52Formula).toBe('=(D54*F54)/D52');expect(calculated.D55Formula).toBe('=F54-F52');evidence.push({revision,...calculated,xlsxSha256:xlsx.sha256,pdfSha256:pdf.sha256});
  }
  await expect(db.query("INSERT INTO task_workbook_revision(batch_id,revision,master_sha256,source_sha256,source_snapshot,values,created_by) VALUES($1,3,$2,$3,'{}','{}',$4)",[batch.batchId,'2747a9f6c6da9231996bd9d0a23b1da3100d910209d440643c70158f7fe20722','a'.repeat(64),u.staff.id])).rejects.toThrow('TASK_CURRENT_MASTER_REQUIRED');
  await writeFile(path.join(dir,'evidence.json'),JSON.stringify({passed:true,evidence},null,2));
 }finally{await db.close();}
},240000);
