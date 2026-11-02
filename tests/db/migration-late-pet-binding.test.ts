import {it,expect,vi} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {testDatabase,addUser} from '../helpers/database';import {configureOperational} from '../../tools/configure-operational';
import {simpleXlsx} from '../../packages/workbook/simple-xlsx';import {FileStore} from '../../packages/storage';
import {buildMigrationPlan} from '../../packages/migration/planner';import {prepareMigrationExecution,resumeMigration} from '../../packages/migration/service';
import {enrichMigrationPets} from '../../packages/migration/pet-enrichment';import {buildSyntheticPet} from '../../packages/inbound/wire';
import {mkdir,writeFile} from 'node:fs/promises';
// A record created by an earlier execution that is still without a case (its PET was resolved later) is bound by a LATER execution of the same run.
it('binds a record created by an earlier execution when a later execution is enriched',async()=>{
 const db=await testDatabase(),root=await mkdtemp(path.join(os.tmpdir(),'migration-late-pet-'));vi.stubEnv('NIPT_MODE','operational');vi.stubEnv('APP_ORIGIN','https://127.0.0.1:20368');
 try{await configureOperational(db);const admin=await addUser(db);const store=new FileStore(root);
  await db.query("INSERT INTO unit(code,name) VALUES('MIGRATION-WARD','Synthetic migration sending unit')");
  const petRoot=path.join(root,'pet');await mkdir(petRoot);
  const input={mapping:{name:'mapping.xlsx',bytes:simpleXlsx('Mapping',[['LN','LN Halos'],['9900099001','26B261026152']])},halos:[]},plan=buildMigrationPlan(input);
  const deps={store,verifyBackup:async()=>({manifestSha256:'a'.repeat(64),verification:'CREATION_VERIFIED'})};
  // first execution: the PET folder is empty, so the record exists without a case
  const first=await prepareMigrationExecution(db,admin,input,{planDigest:plan.digest,uncheckedAcknowledged:true,petSource:{kind:'FOLDER',path:petRoot}},deps);
  await resumeMigration(db,admin,first.id,deps);
  expect((await enrichMigrationPets(db,admin,first.id,store,Buffer.alloc(32,3))).pending).toBe(1);
  expect((await db.query('SELECT case_id FROM migration_record')).rows).toEqual([{case_id:null}]);
  // the PET arrives; a second execution of the same mapping links the same record and binds it
  const pet=buildSyntheticPet({ln:'9900099001',hn:'9900012345',name:'SYNTHETIC^^นาง SYNTHETIC',receivedAt:'20261026090000',specimenAt:'20261026080000',ward:'MIGRATION-WARD'});
  await mkdir(path.join(petRoot,'20261026'));await writeFile(path.join(petRoot,'20261026',pet.filename),pet.bytes);await writeFile(path.join(petRoot,'20261026',pet.filename.replace(/\.pet$/,'.ok')),'');
  const input2={mapping:{name:'mapping2.xlsx',bytes:simpleXlsx('Mapping',[['LN','LN Halos'],['9900099001','26B261026152'],['9900099002','26B261026153']])},halos:[]},plan2=buildMigrationPlan(input2);
  const second=await prepareMigrationExecution(db,admin,input2,{planDigest:plan2.digest,uncheckedAcknowledged:true,petSource:{kind:'FOLDER',path:petRoot}},deps);
  expect(second.id).not.toBe(first.id);await resumeMigration(db,admin,second.id,deps);
  const bound=await enrichMigrationPets(db,admin,second.id,store,Buffer.alloc(32,3));
  expect(bound).toMatchObject({matched:1,pending:1});
  expect((await db.query('SELECT 1 FROM migration_record')).rows).toHaveLength(2);
  expect((await db.query("SELECT ln,case_id IS NOT NULL bound FROM migration_record ORDER BY ln")).rows).toEqual([{ln:'9900099001',bound:true},{ln:'9900099002',bound:false}]);
  expect((await db.query('SELECT 1 FROM nipt_case')).rows).toHaveLength(1);
 }finally{vi.unstubAllEnvs();await db.close();await rm(root,{recursive:true,force:true});}
},120000);
