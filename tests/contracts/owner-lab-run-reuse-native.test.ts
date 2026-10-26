import {it,expect} from 'vitest';
import {Client} from 'pg';
import {randomBytes} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {migrate} from '../../tools/migrate';
import {assertSyntheticDatabase,type Queryable} from '../../packages/db/connection';
import {labUsers} from '../helpers/lab';
import * as batch from '../../packages/lab/batch';

// OWNER-LAB-030 on native PostgreSQL 17 with the real app_rw role: concurrent create/delete never duplicates an active Run number.
it.skipIf(!process.env.NIPT_TEST_DATABASE_URL)('native: concurrent create/delete of unused Batches never produces a duplicate or skipped Run number',async()=>{
 const shared=process.env.NIPT_TEST_DATABASE_URL!;assertSyntheticDatabase(shared);
 const name='nipt_synthetic_test_runreuse_'+randomBytes(4).toString('hex'),server=new URL(shared);server.pathname='/postgres';
 const admin=new Client({connectionString:server.toString()});await admin.connect();await admin.query('CREATE DATABASE '+name);
 const url=new URL(shared);url.pathname='/'+name;
 const owner=new Client({connectionString:url.toString()});await owner.connect();const clients:Client[]=[];
 const session=async()=>{const c=new Client({connectionString:url.toString()});await c.connect();await c.query('SET ROLE app_rw');clients.push(c);return c as unknown as Queryable;};
 const tx=async<T>(c:Queryable,fn:()=>Promise<T>)=>{await c.query('BEGIN');try{const r=await fn();await c.query('COMMIT');return r;}catch(e){await c.query('ROLLBACK');throw e;}};
 try{
  await migrate(owner);await owner.query(await readFile('packages/db/roles.sql','utf8'));
  const u=await labUsers(owner as unknown as Queryable);
  const [a,b,c3]=[await session(),await session(),await session()];
  // Two simultaneous "new Batch" clicks → one Draft (Run001), never two.
  const created=await Promise.all([a,b].map(c=>tx(c,()=>batch.createBatch(c,u.staff))));
  expect(new Set(created.map(r=>r.batchId)).size).toBe(1);expect(created[0].runLabel).toMatch(/^Run001\//);expect(created.filter(r=>r.created)).toHaveLength(1);
  const first=created[0];
  // Double-click delete from two sessions + a simultaneous create: exactly one release, and the number is reused exactly once.
  const v=(await owner.query<{version:number}>('SELECT version FROM lab_batch WHERE id=$1',[first.batchId])).rows[0].version;
  const trashed=await Promise.allSettled([a,b].map(c=>tx(c,()=>batch.trashBatch(c,u.staff,{batchId:first.batchId,expectedVersion:v}))));
  expect(trashed.filter(r=>r.status==='fulfilled')).toHaveLength(1);
  const again=await Promise.all([a,b,c3].map(c=>tx(c,()=>batch.createBatch(c,u.staff))));
  expect(new Set(again.map(r=>r.batchId)).size).toBe(1);expect(again[0].runLabel).toBe(first.runLabel);
  const rows=(await owner.query<{run_label:string;released:boolean}>('SELECT run_label,run_released_at IS NOT NULL released FROM lab_batch ORDER BY created_at')).rows;
  expect(rows.filter(r=>!r.released).map(r=>r.run_label)).toEqual([first.runLabel]);expect(rows).toHaveLength(2);
 }finally{for(const c of clients)await c.end().catch(()=>undefined);await owner.end().catch(()=>undefined);await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`).catch(()=>undefined);await admin.end();}
});
