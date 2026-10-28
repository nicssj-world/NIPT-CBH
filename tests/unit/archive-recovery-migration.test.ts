import {afterAll,expect,it} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {runArchiveProbeCycle} from '../../packages/results/archive-worker';

const db=new PGlite();
afterAll(async()=>db.close());

it('migration 160 adds a targeted untrusted hint but no direct job write permission',async()=>{
 await db.exec(`CREATE TABLE pdf_archive_job(id uuid PRIMARY KEY);
  CREATE TABLE pdf_archive_probe(id uuid PRIMARY KEY, state text NOT NULL, root_path text,
    requested_by uuid);`);
 const sql=await readFile(new URL('../../db/migrations/160_pdf_archive_worker_recovery.sql',import.meta.url),'utf8');
 expect(sql).not.toContain('SECURITY DEFINER');
 expect(sql).not.toContain('GRANT UPDATE ON pdf_archive_job TO app_rw');
 await db.exec(sql);
 const cols=await db.query<{column_name:string}>(`SELECT column_name FROM information_schema.columns
  WHERE table_name='pdf_archive_probe' AND column_name='retry_job_id'`);
 expect(cols.rows).toHaveLength(1);
 await db.query("INSERT INTO pdf_archive_job(id) VALUES($1)",['00000000-0000-4000-8000-000000000001']);
 await db.query("INSERT INTO pdf_archive_probe(id,state,retry_job_id) VALUES($1,'PENDING',$2)",
  ['00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001']);
 await expect(db.query("INSERT INTO pdf_archive_probe(id,state,retry_job_id) VALUES($1,'PENDING',$2)",
  ['00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000001'])).rejects.toThrow();
 await db.exec("UPDATE pdf_archive_probe SET state='PASSED'");
 await expect(db.query("INSERT INTO pdf_archive_probe(id,state,retry_job_id) VALUES($1,'PENDING',$2)",
  ['00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000001'])).resolves.toBeDefined();
});

it('a real worker probe requeues only a FAILED job whose original window matches the enabled root',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'nipt-archive-recovery-pglite-'));
 try{
  await db.exec(`CREATE TABLE pdf_archive_config(singleton boolean PRIMARY KEY,enabled boolean NOT NULL,root_path text);
    CREATE TABLE pdf_archive_window(id uuid PRIMARY KEY,root_path text NOT NULL);
    ALTER TABLE pdf_archive_job ADD COLUMN window_id uuid;
    ALTER TABLE pdf_archive_job ADD COLUMN state text NOT NULL DEFAULT 'FAILED';
    ALTER TABLE pdf_archive_job ADD COLUMN attempts integer NOT NULL DEFAULT 5;
    ALTER TABLE pdf_archive_job ADD COLUMN next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp();
    ALTER TABLE pdf_archive_job ADD COLUMN last_error text;
    ALTER TABLE pdf_archive_job ADD COLUMN claim_token uuid;
    ALTER TABLE pdf_archive_job ADD COLUMN claimed_until timestamptz;
    ALTER TABLE pdf_archive_job ADD COLUMN updated_at timestamptz NOT NULL DEFAULT clock_timestamp();
    ALTER TABLE pdf_archive_probe ADD COLUMN requested_at timestamptz NOT NULL DEFAULT clock_timestamp();
    ALTER TABLE pdf_archive_probe ADD COLUMN claim_token uuid;
    ALTER TABLE pdf_archive_probe ADD COLUMN claimed_until timestamptz;
    ALTER TABLE pdf_archive_probe ADD COLUMN completed_at timestamptz;
    ALTER TABLE pdf_archive_probe ADD COLUMN worker_account text;
    ALTER TABLE pdf_archive_probe ADD COLUMN error_code text;`);
  await db.exec('DELETE FROM pdf_archive_probe');
  const job='00000000-0000-4000-8000-000000000001',w='00000000-0000-4000-8000-000000000004';
  await db.query('INSERT INTO pdf_archive_config(singleton,enabled,root_path) VALUES(true,true,$1)',[root]);
  await db.query('INSERT INTO pdf_archive_window(id,root_path) VALUES($1,$2)',[w,root]);
  await db.query("UPDATE pdf_archive_job SET window_id=$1,state='FAILED',attempts=5 WHERE id=$2",[w,job]);
  const hint='00000000-0000-4000-8000-000000000005';
  await db.query("INSERT INTO pdf_archive_probe(id,state,root_path,retry_job_id) VALUES($1,'PENDING',$2,$3)",[hint,root,job]);
  await runArchiveProbeCycle(db);
  expect((await db.query<{state:string}>('SELECT state FROM pdf_archive_probe WHERE id=$1',[hint])).rows[0].state).toBe('PASSED');
  expect((await db.query<{state:string;attempts:number}>('SELECT state,attempts FROM pdf_archive_job WHERE id=$1',[job])).rows[0]).toEqual({state:'PENDING',attempts:0});
  // A passing probe for root A does NOT reset a failed job pinned to root B.
  await db.query("UPDATE pdf_archive_job SET state='FAILED',attempts=5 WHERE id=$1",[job]);
  await db.query('UPDATE pdf_archive_window SET root_path=$1 WHERE id=$2',[path.join(root,'other-share'),w]);
  const spoof='00000000-0000-4000-8000-000000000006';
  await db.query("INSERT INTO pdf_archive_probe(id,state,root_path,retry_job_id) VALUES($1,'PENDING',$2,$3)",[spoof,root,job]);
  await runArchiveProbeCycle(db);
  expect((await db.query<{state:string}>('SELECT state FROM pdf_archive_probe WHERE id=$1',[spoof])).rows[0].state).toBe('PASSED');
  expect((await db.query<{state:string}>('SELECT state FROM pdf_archive_job WHERE id=$1',[job])).rows[0].state).toBe('FAILED');
 }finally{await rm(root,{recursive:true,force:true});}
});
