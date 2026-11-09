import {expect,it} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {testDatabase,addUser} from '../helpers/database';
import {simpleXlsx} from '../../packages/workbook/simple-xlsx';
import {FileStore} from '../../packages/storage';
import {commitLnHalosImport} from '../../packages/migration/ln-halos-commit';
import {executeMigration} from '../../packages/migration/service';
import {buildMigrationPlan} from '../../packages/migration/planner';

it('stages verified mappings and advances the monthly allocator together, including a replay',async()=>{
 const db=await testDatabase(),root=await mkdtemp(path.join(os.tmpdir(),'ln-commit-'));
 try{
  const admin=await addUser(db),store=new FileStore(root);
  const source={name:'mapping.xlsx',bytes:simpleXlsx('Mapping',[['LN','LN Halos'],['990001','26B261105054'],['990002','26B261105055']])};
  const deps={store,verifyBackup:async()=>({manifestSha256:'a'.repeat(64),verification:'CREATION_VERIFIED',at:new Date().toISOString()})};
  const first=await commitLnHalosImport(db,admin,source,{sourceFrozen:true},deps);
  expect(first.imported).toBe(2);
  expect((await db.query<{n:number}>('SELECT count(*)::int n FROM migration_record WHERE state=\'IMPORTED\'')).rows[0].n).toBe(2);
  expect((await db.query<{last_value:number}>("SELECT last_value FROM ln_halos_monthly_sequence WHERE sequence_month='2026-11-01'")).rows[0].last_value).toBe(55);
  const second=await commitLnHalosImport(db,admin,source,{sourceFrozen:true},deps);
  expect(second.imported).toBe(0);
  expect((await db.query<{n:number}>('SELECT count(*)::int n FROM migration_record')).rows[0].n).toBe(2);
  const conflicting={name:'conflict.xlsx',bytes:simpleXlsx('Mapping',[['LN','LN Halos'],['990001','26B261105056'],['990003','26B261105057']])};
  const partial=await commitLnHalosImport(db,admin,conflicting,{sourceFrozen:true},deps);
  expect(partial.imported).toBe(1);
  const held=(await db.query<{held:{row:number;issues:string[]}[]}>("SELECT plan->'lnHalosHeld' held FROM migration_execution WHERE id=$1",[partial.executionId])).rows[0].held;
  expect(held).toHaveLength(1);expect(held[0].issues).toContain('LN_ALREADY_LINKED');
  expect((await db.query<{n:number}>('SELECT count(*)::int n FROM migration_record')).rows[0].n).toBe(3);
  expect((await db.query<{last_value:number}>("SELECT last_value FROM ln_halos_monthly_sequence WHERE sequence_month='2026-11-01'")).rows[0].last_value).toBe(57);
  const repeated={name:'repeat.xlsx',bytes:simpleXlsx('Mapping',[['LN','LN Halos'],['990004','26B261105058'],['990004','26B261105058']])};
  expect((await commitLnHalosImport(db,admin,repeated,{sourceFrozen:true},deps)).imported).toBe(1);
  expect((await db.query<{n:number}>('SELECT count(*)::int n FROM migration_record')).rows[0].n).toBe(4);
  const heldOnly={name:'held-only.xlsx',bytes:simpleXlsx('Mapping',[['LN','LN Halos'],['990001','26B261105059']])};
  expect(await commitLnHalosImport(db,admin,heldOnly,{sourceFrozen:true},deps)).toMatchObject({imported:0,held:1});
  expect((await db.query<{last_value:number}>("SELECT last_value FROM ln_halos_monthly_sequence WHERE sequence_month='2026-11-01'")).rows[0].last_value).toBe(59);
  await expect(commitLnHalosImport(db,admin,source,{sourceFrozen:false},deps)).rejects.toMatchObject({code:'SOURCE_ALLOCATION_NOT_FROZEN'});
 }finally{await db.close();await rm(root,{recursive:true,force:true});}
},120000);

it('reuses a pair from the previous historical migration without changing its classification',async()=>{
 const db=await testDatabase(),root=await mkdtemp(path.join(os.tmpdir(),'ln-existing-'));
 try{
  const admin=await addUser(db),store=new FileStore(root),source={name:'old.xlsx',bytes:simpleXlsx('Mapping',[['LN','LN Halos'],['990001','26B261105054']])};
  const deps={store,verifyBackup:async()=>({manifestSha256:'a'.repeat(64),verification:'CREATION_VERIFIED',at:new Date().toISOString()})};
  const oldInput={mapping:source,halos:[]},oldPlan=buildMigrationPlan(oldInput);
  await executeMigration(db,admin,oldInput,{planDigest:oldPlan.digest,uncheckedAcknowledged:true},deps);
  const before=(await db.query<{id:string;classification:string}>('SELECT id,classification FROM migration_record')).rows[0];
  const result=await commitLnHalosImport(db,admin,source,{sourceFrozen:true},deps);
  expect(result.imported).toBe(0);
  expect((await db.query('SELECT id,classification FROM migration_record')).rows).toEqual([before]);
  expect((await db.query<{id:string}>('SELECT record_id id FROM migration_execution_record WHERE execution_id=$1',[result.executionId])).rows[0].id).toBe(before.id);
 }finally{await db.close();await rm(root,{recursive:true,force:true});}
},120000);

// Owner 2026-11-09: one malformed row must not stop the good rows from being imported; it is left out and listed in the preview.
it('imports the good rows even when another row of the file is invalid',async()=>{
 const db=await testDatabase(),root=await mkdtemp(path.join(os.tmpdir(),'ln-commit-'));
 try{
  const admin=await addUser(db),store=new FileStore(root);
  const source={name:'mixed.xlsx',bytes:simpleXlsx('Mapping',[['LN','LN Halos'],['990001','26B261105054'],['990002','NOT-A-HALOS-ID']])};
  const deps={store,verifyBackup:async()=>({manifestSha256:'a'.repeat(64),verification:'CREATION_VERIFIED',at:new Date().toISOString()})};
  expect((await commitLnHalosImport(db,admin,source,{sourceFrozen:true},deps)).imported).toBe(1);
 }finally{await db.close();await rm(root,{recursive:true,force:true});}
},120000);
