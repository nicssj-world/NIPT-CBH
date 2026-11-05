import {expect,it} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {testDatabase,addUser} from '../helpers/database';
import {simpleXlsx} from '../../packages/workbook/simple-xlsx';
import {FileStore} from '../../packages/storage';
import {buildMigrationPlan} from '../../packages/migration/planner';
import {executeMigration} from '../../packages/migration/service';
import {previewLnHalosImport} from '../../packages/migration/ln-halos-import';

it('previews existing pairs, identifier conflicts and new mappings without writing',async()=>{
 const db=await testDatabase(),root=await mkdtemp(path.join(os.tmpdir(),'ln-preview-'));
 try{
  const user=await addUser(db),store=new FileStore(root);
  const original={mapping:{name:'old.xlsx',bytes:simpleXlsx('Mapping',[['LN','LN Halos'],['990001','26B261105001']])},halos:[]};
  const plan=buildMigrationPlan(original);
  await executeMigration(db,user,original,{planDigest:plan.digest,uncheckedAcknowledged:true},{store,verifyBackup:async()=>({manifestSha256:'a'.repeat(64),verification:'CREATION_VERIFIED'})});
  const input={name:'new.xlsx',bytes:simpleXlsx('Mapping',[['LN','LN Halos'],['990001','26B261105001'],['990002','26B261105002'],['990003','26B261105001']])};
  const before=(await db.query<{n:number}>('SELECT count(*)::int n FROM migration_record')).rows[0].n;
  const preview=await previewLnHalosImport(db,input);
  expect(preview.rows[0].status).toBe('CONFLICT'); // the same number belongs to different LNs
  expect(preview.rows[1].status).toBe('NEW');
  expect(preview.rows[2].status).toBe('CONFLICT');
  const second=await previewLnHalosImport(db,{name:'new.xlsx',bytes:simpleXlsx('Mapping',[['LN','LN Halos'],['990001','26B261105001'],['990003','26B261105003']])});
  expect(second.rows.map(r=>r.status)).toEqual(['EXISTING','NEW']);
  const conflict=await previewLnHalosImport(db,{name:'new.xlsx',bytes:simpleXlsx('Mapping',[['LN','LN Halos'],['990001','26B261105004'],['990004','26B261105001']])});
  expect(conflict.rows.map(r=>r.status)).toEqual(['CONFLICT','CONFLICT']);
  const reusedSequence=await previewLnHalosImport(db,{name:'new.xlsx',bytes:simpleXlsx('Mapping',[['LN','LN Halos'],['990005','26B261104001']])});
  expect(reusedSequence.rows[0].status).toBe('CONFLICT');
  expect((await db.query<{n:number}>('SELECT count(*)::int n FROM migration_record')).rows[0].n).toBe(before);
 }finally{await db.close();await rm(root,{recursive:true,force:true});}
},120000);
