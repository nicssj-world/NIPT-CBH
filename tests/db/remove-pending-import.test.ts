import {expect,it} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {testDatabase,addUser} from '../helpers/database';
import {simpleXlsx} from '../../packages/workbook/simple-xlsx';
import {FileStore} from '../../packages/storage';
import {commitLnHalosImport} from '../../packages/migration/ln-halos-commit';
import {removePendingImport} from '../../packages/migration/remove-pending';
import {migrationWorklist} from '../../packages/migration/worklist';

// Owner 2026-11-10: an imported row still waiting for its PET can be taken off the list; nothing is deleted and its numbers are free again.
it('removes a pending imported row without deleting it, and the same LN can be imported again',async()=>{
 const db=await testDatabase(),root=await mkdtemp(path.join(os.tmpdir(),'ln-remove-'));
 try{
  const admin=await addUser(db),store=new FileStore(root);
  const source={name:'one.xlsx',bytes:simpleXlsx('Mapping',[['LN','LN Halos'],['990001','26B261105054']])};
  const deps={store,verifyBackup:async()=>({manifestSha256:'a'.repeat(64),verification:'CREATION_VERIFIED',at:new Date().toISOString()})};
  await commitLnHalosImport(db,admin,source,{sourceFrozen:true},deps);
  const before=await migrationWorklist(db,admin);expect(before.rows).toHaveLength(1);
  const id=before.rows[0].id;
  expect(await removePendingImport(db,admin,{recordId:id})).toEqual({outcome:'REMOVED'});
  expect((await migrationWorklist(db,admin)).rows).toHaveLength(0);
  expect((await db.query<{state:string}>('SELECT state FROM migration_record WHERE id=$1',[id])).rows[0].state).toBe('EXCEPTION');   // kept, not deleted
  expect((await db.query("SELECT 1 FROM migration_record_event WHERE record_id=$1 AND event='REMOVED_BY_USER'",[id])).rows).toHaveLength(1);
  expect((await db.query("SELECT 1 FROM audit_chain WHERE action='MIGRATION_PENDING_IMPORT_REMOVED'")).rows).toHaveLength(1);
  await expect(removePendingImport(db,admin,{recordId:id})).rejects.toMatchObject({code:'PENDING_IMPORT_NOT_REMOVABLE'});   // twice is refused
  const again=await commitLnHalosImport(db,admin,{name:'two.xlsx',bytes:simpleXlsx('Mapping',[['LN','LN Halos'],['990001','26B261105055']])},{sourceFrozen:true},deps);
  expect(again.imported).toBe(1);                                                                                              // the LN is free again
 }finally{await db.close();await rm(root,{recursive:true,force:true});}
},120000);
