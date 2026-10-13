import {test,expect} from '@playwright/test';
import {Pool,escapeIdentifier,escapeLiteral} from 'pg';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {migrate} from '../../tools/migrate';

// Playwright E2E of the NEW CLI workflow. No UI/browser flow was added; this test deliberately
// launches real command processes, isolated PostgreSQL roles and the real sandbox worker cycle.
test('P6 local CLI enroll → queue → files/backups/OK → evidence → history/status, with clinical HOLD',async()=>{
  test.skip(!process.env.NIPT_P6_NATIVE_URL,'Dedicated local P6 PostgreSQL test container required');
  const url=new URL(process.env.NIPT_P6_NATIVE_URL!);
  if(url.hostname!=='127.0.0.1'||!url.pathname.startsWith('/nipt_p6_synthetic_'))throw Error('ISOLATED_P6_NATIVE_DATABASE_REQUIRED');
  const suffix=randomUUID().replaceAll('-',''),admin=new Pool({connectionString:url.toString()});
  const database='nipt_p6_synthetic_e2e_'+suffix;await admin.query('CREATE DATABASE '+escapeIdentifier(database));await admin.end();url.pathname='/'+database;
  const owner=new Pool({connectionString:url.toString()});
  try{
    const db=await owner.connect();try{await migrate(db);}finally{db.release();}
    await owner.query(await readFile('packages/db/roles.sql','utf8'));await owner.query(await readFile('packages/p6/grants.sql','utf8'));
    const login=async(role:string,label:string)=>{
      const name='p6_e2e_'+label+'_'+suffix.slice(0,12),password='SYNTHETIC-P6-E2E-ONLY-20261013';
      await owner.query(`CREATE ROLE ${escapeIdentifier(name)} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD ${escapeLiteral(password)}`);
      await owner.query(`GRANT ${escapeIdentifier(role)} TO ${escapeIdentifier(name)}`);
      const copy=new URL(url);copy.username=name;copy.password=password;return copy.toString();
    };
    const fixtureUrl=await login('p6_fixture_writer','fixture'),workerUrl=await login('worker_rw','worker');
    const command=async(connection:string,...args:string[])=>{
      const {stdout}=await promisify(execFile)(process.execPath,['--import','tsx','tools/p6/sandbox-workflow.ts',...args],{env:{...process.env,NIPT_MODE:'synthetic',NIPT_P6_SANDBOX_ENABLED:'yes',DATABASE_URL:connection},timeout:15000});return JSON.parse(stdout);
    };
    const queued=await command(fixtureUrl,'enroll','701','SYNTHETIC-E2E-'+suffix);expect(queued.state).toBe('PREPARED');
    await command(workerUrl,'run');const history=await command(workerUrl,'history',queued.id);
    expect(history.state).toBe('AWAITING_CONFIRMATION');expect(history.events.map((e:{code:string})=>e.code)).toContain('BACKUP_VERIFIED');expect(history.hisConfirmed).toBe(false);
    const confirmed=await command(workerUrl,'confirm',queued.id,'OPERATOR','SYNTHETIC-E2E-OBSERVER','SYNTHETIC-E2E-EVIDENCE');expect(confirmed.state).toBe('SYNTHETIC_CONFIRMED');expect(confirmed.hisConfirmed).toBe(false);
    await command(workerUrl,'cancel',queued.id,'WITHDRAWAL');const held=await command(workerUrl,'history',queued.id);expect(held.state).toBe('RECONCILIATION_REQUIRED');
    const reconciled=await command(workerUrl,'reconcile',queued.id,'OBSERVED_SANDBOX_DELIVERY','SYNTHETIC-E2E-OBSERVER','SYNTHETIC-E2E-RECONCILE');expect(reconciled.reconciliations).toHaveLength(1);
    const status=await command(workerUrl,'status');expect(status.clinicalPublisherEnabled).toBe(false);
    expect((await owner.query('SELECT p5_release_authorized() allowed')).rows[0].allowed).toBe(false);expect((await owner.query('SELECT count(*)::int n FROM result_release')).rows[0].n).toBe(0);
  }finally{await owner.end();}
});
