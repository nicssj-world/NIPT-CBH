import {halosWorkbook} from '../helpers/task3';
import {describe,it,expect} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {testDatabase,addUser} from '../helpers/database';
import {simpleXlsx} from '../../packages/workbook/simple-xlsx';
import {FileStore} from '../../packages/storage';
import {buildMigrationPlan} from '../../packages/migration/planner';
import {requestMigrationResume,prepareMigrationExecution,executeMigration,readMigrationExecution,updateMigrationRecord,cancelMigration,resumeMigration} from '../../packages/migration/service';

describe('isolated migration execution',()=>{
 it('requires admin, acknowledges unchecked meaning once, stages LN-only idempotently and never queues HIS',async()=>{
  const db=await testDatabase(),root=await mkdtemp(path.join(os.tmpdir(),'nipt-migration-'));
  try{const admin=await addUser(db),lab=await addUser(db,'LAB_STAFF','synthetic.lab');
   const input={mapping:{name:'mapping.xlsx',bytes:simpleXlsx('Mapping',[['LN','LN Halos'],['0012345678','26B261026152']])},halos:[]};
   const plan=buildMigrationPlan(input),deps={store:new FileStore(root),verifyBackup:async()=>({manifestSha256:'a'.repeat(64),verification:'CREATION_VERIFIED'})};
   await expect(executeMigration(db,lab,input,{planDigest:plan.digest,uncheckedAcknowledged:true},deps)).rejects.toThrow('FORBIDDEN');
   await expect(executeMigration(db,admin,input,{planDigest:plan.digest,uncheckedAcknowledged:false},deps)).rejects.toThrow('UNCHECKED_MEANING_ACK_REQUIRED');
   const first=await executeMigration(db,admin,input,{planDigest:plan.digest,uncheckedAcknowledged:true,wardMappings:{SOURCE_WARD:'00000000-0000-0000-0000-000000000001'}},deps);
   expect(first.wardMappings).toEqual({SOURCE_WARD:'00000000-0000-0000-0000-000000000001'});
   const twice=await executeMigration(db,admin,input,{planDigest:plan.digest,uncheckedAcknowledged:true},deps);
   expect(twice.id).toBe(first.id);
   const detail=await readMigrationExecution(db,admin,first.id);expect(detail.records).toHaveLength(1);
   expect((await db.query('SELECT * FROM nipt_case')).rows).toHaveLength(0);
   expect((await db.query('SELECT * FROM job_outbox')).rows).toHaveLength(0);
   await expect(updateMigrationRecord(db,admin,detail.records[0].id,{expectedRowVersion:0,hisPdfExists:true})).rejects.toThrow('HIS_FLAG_RESULT_READY_REQUIRED');
   expect((await db.query('SELECT * FROM job_outbox')).rows).toHaveLength(0);
   const delta={mapping:{name:'mapping-delta.xlsx',bytes:simpleXlsx('Mapping',[['LN','LN Halos'],['0012345678','26B261026152'],['0012345679','26B261026153']])},halos:[]};
   const deltaPlan=buildMigrationPlan(delta),next=await executeMigration(db,admin,delta,{planDigest:deltaPlan.digest,uncheckedAcknowledged:true},deps);
   expect(next.records).toHaveLength(2);expect(next.records[0].id).toBe(first.records[0].id);
   expect((await db.query('SELECT 1 FROM migration_record')).rows).toHaveLength(2);
   expect((await db.query('SELECT 1 FROM migration_execution_record')).rows).toHaveLength(3);
  }finally{await db.close();await rm(root,{recursive:true,force:true});}
 });
});

it('isolates conflicting runs, preserves reused declarations, and cancelled retries write no later controls',async()=>{
 const db=await testDatabase(),root=await mkdtemp(path.join(os.tmpdir(),'migration-delta-'));
 try{const admin=await addUser(db),deps={store:new FileStore(root),verifyBackup:async()=>({manifestSha256:'a'.repeat(64),verification:'CREATION_VERIFIED'})};
 const mapping={name:'first.xlsx',bytes:simpleXlsx('Mapping',[['LN','LN Halos'],['990001','26B261014027']])};
 const firstInput={mapping,halos:[{name:'run1.xlsx',runLabel:'Run001/2026',bytes:halosWorkbook({result:[{sample:'26B261014027-1'}],sampleinfo:[{id:'26B261014027',fetus:'Singleton',ga:'17,6'}]})}],choices:[{hisLn:'990001',hisPdfExists:true}]};
 const firstPlan=buildMigrationPlan(firstInput),first=await executeMigration(db,admin,firstInput,{planDigest:firstPlan.digest,uncheckedAcknowledged:true},deps);
 expect(first.records[0]).toMatchObject({classification:'QUALIFIED_PDF_PENDING',his_pdf_exists:true});
 const delta={mapping:{name:'delta.xlsx',bytes:simpleXlsx('Mapping',[['LN','LN Halos'],['990001','26B261014027'],['990002','26B261014028']])},halos:[{name:'conflicting-run1.xlsx',runLabel:'Run001/2026',bytes:halosWorkbook({result:[{sample:'26B261014028-1'}],sampleinfo:[{id:'26B261014028',fetus:'Singleton',ga:'17,6'}]})}]};
 const plan=buildMigrationPlan(delta),next=await executeMigration(db,admin,delta,{planDigest:plan.digest,uncheckedAcknowledged:true},deps);
 expect(next.state).toBe('PARTIAL');expect(next.records).toHaveLength(2);
 expect(next.records[0]).toMatchObject({id:first.records[0].id,classification:'QUALIFIED_PDF_PENDING',his_pdf_exists:true});
 expect(next.records[1]).toMatchObject({state:'IMPORTED',exceptions:expect.arrayContaining([expect.objectContaining({code:'MIGRATION_RUN_CONFLICT'})])});
 expect((await db.query('SELECT 1 FROM migration_historical_run')).rows).toHaveLength(1);
 const before=(await db.query('SELECT 1 FROM migration_analysis')).rows.length;
 await cancelMigration(db,admin,next.id);const cancelled=await resumeMigration(db,admin,next.id,deps);
 expect(cancelled.state).toBe('CANCELLED');expect((await db.query('SELECT 1 FROM migration_analysis')).rows).toHaveLength(before);
 expect((await db.query('SELECT 1 FROM job_outbox')).rows).toHaveLength(0);
 }finally{await db.close();await rm(root,{recursive:true,force:true});}
});

it('prepares durably without importing rows and resumes cancelled execution only with explicit authorization',async()=>{
 const db=await testDatabase(),root=await mkdtemp(path.join(os.tmpdir(),'migration-prepare-'));
 try{const admin=await addUser(db),deps={store:new FileStore(root),verifyBackup:async()=>({manifestSha256:'a'.repeat(64),verification:'CREATION_VERIFIED'})};
 const input={mapping:{name:'prepare.xlsx',bytes:simpleXlsx('Mapping',[['LN','LN Halos'],['99000000991','26B261027401'],['99000000992','26B261027402']])},halos:[]},plan=buildMigrationPlan(input),options={planDigest:plan.digest,uncheckedAcknowledged:true};
 const prepared=await prepareMigrationExecution(db,admin,input,options,deps);
 expect(prepared.state).toBe('RUNNING');expect(prepared.records).toHaveLength(0);expect(prepared.summary.mappingRows).toBe(2);
 expect(prepared.progress).toMatchObject({total:2,processed:0,pending:2});
 expect((await db.query('SELECT 1 FROM migration_source')).rows).toHaveLength(1);
 for(const table of ['migration_record','migration_analysis','migration_historical_run','nipt_case','job_outbox'])expect((await db.query('SELECT 1 FROM '+table)).rows).toHaveLength(0);
 await cancelMigration(db,admin,prepared.id);
 expect((await executeMigration(db,admin,input,options,deps)).state).toBe('CANCELLED');
 expect((await resumeMigration(db,admin,prepared.id,deps)).state).toBe('CANCELLED');
 expect((await db.query('SELECT 1 FROM migration_record')).rows).toHaveLength(0);
 const done=await resumeMigration(db,admin,prepared.id,deps,{resumeCancelled:true});
 expect(done.state).toBe('COMPLETED');expect(done.records).toHaveLength(2);expect(done.progress).toMatchObject({total:2,processed:2,pending:0,imported:2});
 expect((await db.query('SELECT 1 FROM job_outbox')).rows).toHaveLength(0);
 }finally{await db.close();await rm(root,{recursive:true,force:true});}
});

it('commits explicit resume intent immediately while a subsequent cancel wins over deferred work',async()=>{
 const db=await testDatabase(),root=await mkdtemp(path.join(os.tmpdir(),'migration-resume-intent-'));
 try{const admin=await addUser(db),deps={store:new FileStore(root),verifyBackup:async()=>({manifestSha256:'a'.repeat(64),verification:'CREATION_VERIFIED'})};
 const input={mapping:{name:'request.xlsx',bytes:simpleXlsx('Mapping',[['LN','LN Halos'],['99000000881','26B261027411']])},halos:[]},plan=buildMigrationPlan(input);
 const prepared=await prepareMigrationExecution(db,admin,input,{planDigest:plan.digest,uncheckedAcknowledged:true},deps);
 await cancelMigration(db,admin,prepared.id);
 const requested=await requestMigrationResume(db,admin,prepared.id);
 expect(requested.state).toBe('RUNNING');expect(requested.records).toHaveLength(0);expect(requested.progress).toMatchObject({total:1,processed:0,pending:1});
 await cancelMigration(db,admin,prepared.id);
 const deferred=await resumeMigration(db,admin,prepared.id,deps);
 expect(deferred.state).toBe('CANCELLED');expect(deferred.records).toHaveLength(0);
 await requestMigrationResume(db,admin,prepared.id);
 const done=await resumeMigration(db,admin,prepared.id,deps);
 expect(done.state).toBe('COMPLETED');expect(done.progress).toMatchObject({total:1,processed:1,pending:0});
 expect((await requestMigrationResume(db,admin,prepared.id)).state).toBe('COMPLETED');
 expect((await db.query('SELECT 1 FROM migration_record')).rows).toHaveLength(1);
 }finally{await db.close();await rm(root,{recursive:true,force:true});}
});
