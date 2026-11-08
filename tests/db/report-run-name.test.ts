import {afterAll,beforeAll,expect,it} from 'vitest';
import type {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import {testDatabase} from '../helpers/database';
import {labUsers,syntheticCase,receiveS1,attemptOf,tx,setPendingPolicy} from '../helpers/lab';
import {createBatch,assignToBatch} from '../../packages/lab/batch';
import {attemptRunToken} from '../../packages/readygen/report-name';
import {configuredReportName,reportDownloadName} from '../../packages/readygen/report-name';
import {resultFixture,receivedCase,importUnlinked,pdfDate,rowVersion} from '../helpers/results';
import {proposeLink,decideLink} from '../../packages/results/service';
let db:PGlite;
beforeAll(async()=>{db=await testDatabase();});
afterAll(async()=>{await db.close();});
it('resolves only the matched attempt assignment and refuses to infer an unassigned patient run',async()=>{
 const u=await labUsers(db),c=await tx(db,t=>syntheticCase(t,u)),unassigned=await tx(db,t=>syntheticCase(t,u));
 await tx(db,t=>receiveS1(t,c));await tx(db,t=>receiveS1(t,unassigned));
 const a=await attemptOf(db,c.roundId),other=await attemptOf(db,unassigned.roundId);
 await setPendingPolicy(db,u,'PROCEED_SYNTHETIC_LABELLED');
 const b=await tx(db,t=>createBatch(t,u.staff));
 const placed=await tx(db,t=>assignToBatch(t,u.staff,{batchId:b.batchId,expectedVersion:0,attemptIds:[a.id]}));
 expect(placed.placed).toHaveLength(1);
 const run=(await db.query<{run_year:number;run_number:number}>('SELECT run_year,run_number FROM lab_batch WHERE id=$1',[b.batchId])).rows[0];
 expect(await attemptRunToken(db,a.id)).toBe(`run${String(run.run_number).padStart(2,'0')}${run.run_year+543}`);
 await expect(attemptRunToken(db,other.id)).rejects.toThrow('REPORT_RUN_REQUIRED');
});
it('uses one configured name for an external matched version without fabricating missing run evidence',async()=>{
 const f=await resultFixture();try{
  const c=await receivedCase(f,{ln:'009900010001',hn:'009900010002'}),u=f.u;
  const v=await importUnlinked(f,{kind:'SINGLETON',labNumber:c.labNumber,hn:c.hn,collection:pdfDate(c.collection)});
  const rv=async()=>(await rowVersion(f,v.versionId)).row_version;
  await f.run(async t=>proposeLink(t,u.staff,{versionId:v.versionId,roundId:c.roundId,attemptId:c.attemptId,reason:'SYNTHETIC exact attempt linkage',expectedRowVersion:await rv()}));
  await f.run(async t=>decideLink(t,u.certifier,{versionId:v.versionId,decision:'APPROVE',reason:'SYNTHETIC matching report',expectedRowVersion:await rv()}));
  await expect(reportDownloadName(f.db,v.versionId)).rejects.toThrow('REPORT_RUN_REQUIRED');
  expect(await reportDownloadName(f.db,v.versionId,{historical:true})).toBe('009900010002_009900010001.pdf');
  await setPendingPolicy(f.db,u,'PROCEED_SYNTHETIC_LABELLED');
  const b=await f.run(t=>createBatch(t,u.staff));
  await f.run(t=>assignToBatch(t,u.staff,{batchId:b.batchId,expectedVersion:0,attemptIds:[c.attemptId]}));
  const run=(await f.db.query<{run_year:number;run_number:number}>('SELECT run_year,run_number FROM lab_batch WHERE id=$1',[b.batchId])).rows[0];
  expect(await reportDownloadName(f.db,v.versionId)).toBe(`run${String(run.run_number).padStart(2,'0')}${run.run_year+543}_009900010002_009900010001.pdf`);
  expect(await configuredReportName(f.db,c.attemptId,{hisLn:c.ln,hn:c.hn,lnHalos:c.labNumber,sampleId:c.labNumber,patientName:'SYNTHETIC',reportDate:'2026-10-10',template:'SINGLETON',version:'1'})).toBe(await reportDownloadName(f.db,v.versionId));
  await f.db.exec(await readFile('packages/db/roles.sql','utf8'));await f.db.exec(await readFile('packages/p6/grants.sql','utf8'));
  await f.db.query('SET ROLE worker_rw');
  try{
   expect(await reportDownloadName(f.db,v.versionId)).toContain('_009900010002_009900010001.pdf');
   await expect(f.db.query("UPDATE internal_report SET download_name='changed.pdf'")).rejects.toThrow(/permission/);
  }finally{await f.db.query('RESET ROLE');}
 }finally{await f.close();}
});
