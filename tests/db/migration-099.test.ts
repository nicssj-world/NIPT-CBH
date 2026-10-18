import {it,expect} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {mkdtemp,readdir,copyFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {migrate} from '../../tools/migrate';
import {installPre102Stub,removePre102Stub} from '../helpers/pre-102';
import {tx,labUsers,syntheticCase,receiveS1} from '../helpers/lab';
import * as intake from '../../packages/lab/intake';
import type {Queryable} from '../../packages/db/connection';

// Migration 099 (approved, synthetic environment only): label_print_item.printed_code CHECK gains an optional R.
// Proven on a database that already holds print rows written under the previous constraint.
it('099 keeps existing print rows valid and accepts exactly BASE, BASED, BASER, BASEDR',async()=>{
 const all=(await readdir('db/migrations')).filter(f=>/^\d+.*\.sql$/.test(f)).sort();
 expect(all).toContain('099_label_printed_code_resampling.sql');
 const before=await mkdtemp(path.join(tmpdir(),'nipt-mig-098-'));const db=new PGlite();
 try{
  for(const f of all.filter(f=>f<'099'))await copyFile(path.join('db/migrations',f),path.join(before,f));
  await migrate(db,before);
  await installPre102Stub(db);
  const q=db as unknown as Queryable,u=await labUsers(q);
  const c=await tx(q,t=>syntheticCase(t,u));await tx(q,t=>receiveS1(t,c));
  const printed=await tx(q,t=>intake.printLabels(t,u.staff,{roundIds:[c.roundId],includeName:false})); // under the 098 constraint
  const code=(await db.query<{printed_code:string}>('SELECT printed_code FROM label_print_item WHERE job_id=$1',[printed.jobId])).rows[0].printed_code;
  const oldDef=(await db.query<{d:string}>("SELECT pg_get_constraintdef(oid) d FROM pg_constraint WHERE conname='label_print_item_printed_code_check'")).rows[0].d;
  expect(oldDef).toContain('D?$');
  await removePre102Stub(db);
  await migrate(db); // full bundle: applies only 099
  const newDef=(await db.query<{d:string}>("SELECT pg_get_constraintdef(oid) d FROM pg_constraint WHERE conname='label_print_item_printed_code_check'")).rows[0].d;
  expect(newDef).toContain('D?R?$');
  const ledger=(await db.query<{checksum:string}>("SELECT checksum FROM schema_migration WHERE name='099_label_printed_code_resampling.sql'")).rows[0].checksum;
  expect(ledger).toBe(createHash('sha256').update(readFileSync('db/migrations/099_label_printed_code_resampling.sql','utf8')).digest('hex'));
  expect((await db.query('SELECT printed_code FROM label_print_item WHERE job_id=$1',[printed.jobId])).rows).toEqual([{printed_code:code}]); // untouched, still valid
  await db.query('ALTER TABLE label_print_item VALIDATE CONSTRAINT label_print_item_printed_code_check');
  const insert=async(value:string)=>{const job=(await db.query<{id:string}>("INSERT INTO label_print_job(actor_id,kind,reason,sample_count,include_name,html_sha256) VALUES($1,'PRINT',NULL,1,false,$2) RETURNING id",[u.staff.id,'0'.repeat(64)])).rows[0].id;
   return db.query('INSERT INTO label_print_item(job_id,position,round_id,printed_code) VALUES($1,1,$2,$3)',[job,c.roundId,value]);};
  const base=code.replace(/D$/,'');
  for(const ok of [base,base+'D',base+'R',base+'DR'])await insert(ok);
  for(const bad of [base+'RR',base+'RD',base+'DD',base+'r',base+'d',base+'R-1',base.slice(1)+'R'])await expect(insert(bad),bad).rejects.toThrow(/label_print_item_printed_code_check/);
 }finally{await db.close();await rm(before,{recursive:true,force:true});}
},120000);
