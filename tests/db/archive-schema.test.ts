import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import type {PGlite} from '@electric-sql/pglite';
import {testDatabase} from '../helpers/database';
import {runArchiveCycle} from '../../packages/results/archive-worker';
import {queueArchiveProbe,enableArchive,disableArchive} from '../../packages/results/archive-settings';
import {addUser} from '../helpers/database';

let db:PGlite;
describe('archive persistence migration',()=>{
 beforeAll(async()=>{db=await testDatabase();});
 afterAll(async()=>{await db?.close();});
 it('starts disabled without creating archive jobs or an activation window',async()=>{
  const config=(await db.query<{enabled:boolean}>('SELECT enabled FROM pdf_archive_config WHERE singleton=true')).rows;
  expect(config).toEqual([{enabled:false}]);
  expect((await db.query('SELECT * FROM pdf_archive_window')).rows).toHaveLength(0);
  expect((await db.query('SELECT * FROM pdf_archive_job')).rows).toHaveLength(0);
  await expect(runArchiveCycle(db,{get:async()=>{throw Error('unexpected read');}})).resolves.toBeUndefined();
 });
 it('only enables after a successful worker probe by the same administrator',async()=>{
  const admin=await addUser(db,'APP_ADMIN','archive.admin');
  const lab=await addUser(db,'LAB_STAFF','archive.lab');
  const root=String.raw`\\server\share\archive`;
  await expect(queueArchiveProbe(db,lab,root)).rejects.toThrow('FORBIDDEN');
  const id=await queueArchiveProbe(db,admin,root);
  await expect(enableArchive(db,admin,id)).rejects.toThrow('ARCHIVE_TEST_REQUIRED');
  await db.query("UPDATE pdf_archive_probe SET state='PASSED',completed_at=clock_timestamp() WHERE id=$1",[id]);
  await enableArchive(db,admin,id);
  expect((await db.query('SELECT enabled FROM pdf_archive_config WHERE singleton')).rows).toEqual([{enabled:true}]);
  await expect(enableArchive(db,admin,id)).rejects.toThrow('ARCHIVE_TEST_REQUIRED');
  await disableArchive(db,admin);
  const next=await queueArchiveProbe(db,admin,root);
  await db.query("UPDATE pdf_archive_probe SET state='PASSED',completed_at=clock_timestamp() WHERE id=$1",[next]);
  await enableArchive(db,admin,next);
  const windows=(await db.query<{deactivated_at:Date|null}>('SELECT deactivated_at FROM pdf_archive_window ORDER BY activated_at')).rows;
  expect(windows).toHaveLength(2);expect(windows[0].deactivated_at).not.toBeNull();expect(windows[1].deactivated_at).toBeNull();
 });
});
