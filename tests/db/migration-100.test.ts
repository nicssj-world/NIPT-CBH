import {it,expect} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {mkdtemp,readdir,copyFile,rm,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {migrate} from '../../tools/migrate';
import {tx,labUsers} from '../helpers/lab';
import {receivedCase,importReport,rowVersion,pdfDate,type ResultFixture} from '../helpers/results';
import {FileStore} from '../../packages/storage';
import * as results from '../../packages/results/service';
import type {Queryable} from '../../packages/db/connection';

// Migration 100 (Owner P5-A, forward only, isolated synthetic databases only): proven on a database that already holds a
// two-person link, rejected proposal and unlink written under the 050/051 constraints. Existing rows stay byte-for-byte valid.
it('100 upgrades a populated 099 database without touching existing link history',async()=>{
 const all=(await readdir('db/migrations')).filter(f=>/^\d+.*\.sql$/.test(f)).sort();
 expect(all).toContain('100_p5a_unique_auto_link.sql');
 const before=await mkdtemp(path.join(tmpdir(),'nipt-mig-099-'));const db=new PGlite();
 try{
  for(const f of all.filter(f=>f<'100'))await copyFile(path.join('db/migrations',f),path.join(before,f));
  await migrate(db,before);
  const root=path.join(before,'sim');await mkdir(path.join(root,'results'),{recursive:true});await writeFile(path.join(root,'.nipt-synthetic-root'),'NIPT_SYNTHETIC_ONLY_V1');
  const q=db as unknown as Queryable,f={db,u:await labUsers(q),store:new FileStore(path.join(before,'files')),root,base:before,run:<T>(fn:(t:Queryable)=>Promise<T>)=>tx(q,fn),close:async()=>{}} as unknown as ResultFixture;
  const c=await receivedCase(f),lab=(await db.query<{ln_halos:string}>('SELECT ln_halos FROM specimen_lab_number WHERE round_id=$1',[c.roundId])).rows[0].ln_halos;
  const {versionId}=await importReport(f,{kind:'SINGLETON',labNumber:lab,hn:c.hn,collection:pdfDate(c.collection)});
  const rv=async()=>(await rowVersion(f,versionId)).row_version;
  await f.run(async t=>results.proposeLink(t,f.u.staff,{versionId,roundId:c.roundId,attemptId:c.attemptId,reason:'Pre-100 manual proposal',expectedRowVersion:await rv()}));
  await f.run(async t=>results.decideLink(t,f.u.certifier,{versionId,decision:'REJECT',reason:'Pre-100 rejected once',expectedRowVersion:await rv()}));
  await f.run(async t=>results.proposeLink(t,f.u.staff,{versionId,roundId:c.roundId,attemptId:c.attemptId,reason:'Pre-100 manual proposal again',expectedRowVersion:await rv()}));
  await f.run(async t=>results.decideLink(t,f.u.certifier,{versionId,decision:'APPROVE',reason:'Pre-100 approved by a second person',expectedRowVersion:await rv()}));
  const snapshot=async()=>({links:(await db.query("SELECT sequence,event,mode,outcome,reason,actor_id FROM result_link_event ORDER BY sequence")).rows,version:(await db.query('SELECT state,link_mode,row_version,round_id FROM result_report_version WHERE id=$1',[versionId])).rows});
  const pre=await snapshot();expect(pre.links.map(l=>l.event)).toEqual(['PROPOSED','REJECTED','PROPOSED','APPROVED']);
  await migrate(db); // full bundle: applies only 100
  const ledger=(await db.query<{checksum:string}>("SELECT checksum FROM schema_migration WHERE name='100_p5a_unique_auto_link.sql'")).rows[0].checksum;
  expect(ledger).toBe(createHash('sha256').update(readFileSync('db/migrations/100_p5a_unique_auto_link.sql','utf8')).digest('hex'));
  const post=await snapshot();expect(post).toEqual(pre);
  expect((await db.query<{n:number}>('SELECT count(*)::int n FROM result_link_event WHERE match_evidence IS NOT NULL')).rows[0].n).toBe(0);
  for(const name of ['result_link_event_mode_check','result_link_event_outcome_required','result_link_event_auto_linked','result_link_event_evidence_auto_only'])
   await db.query(`ALTER TABLE result_link_event VALIDATE CONSTRAINT ${name}`);
  await db.query('ALTER TABLE result_report_version VALIDATE CONSTRAINT result_report_version_link_mode_check');
  await migrate(db);expect((await snapshot())).toEqual(pre); // re-apply is a no-op
  // A wrong pre-state stops the migration instead of silently replacing a different constraint.
  const odd=new PGlite();try{await migrate(odd,before);await odd.query("ALTER TABLE result_link_event DROP CONSTRAINT result_link_event_mode_check");await odd.query("ALTER TABLE result_link_event ADD CONSTRAINT result_link_event_mode_check CHECK(mode<>'')");
   await expect(migrate(odd)).rejects.toThrow('MIGRATION_100_UNEXPECTED_CONSTRAINT');}finally{await odd.close();}
 }finally{await db.close();await rm(before,{recursive:true,force:true});}
},180000);
