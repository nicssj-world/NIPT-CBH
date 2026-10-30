import {afterAll,beforeAll,expect,it} from 'vitest';
import type {PGlite} from '@electric-sql/pglite';
import {testDatabase,addUser} from '../helpers/database';
import {readPgBossQueueOverview} from '../../packages/jobs/admin-center';
let db:PGlite;
beforeAll(async()=>{db=await testDatabase();});
afterAll(async()=>{await db?.close();});
it('P1 pg-boss overview handles not-yet-initialized worker schema',async()=>{
 const admin=await addUser(db,'APP_ADMIN','synthetic.pg.boss.admin113');
 expect(await readPgBossQueueOverview(db,admin)).toEqual({counts:[],items:[]});
 const staff=await addUser(db,'LAB_STAFF','synthetic.pg.boss.lab113');
 await expect(readPgBossQueueOverview(db,staff)).rejects.toThrow('FORBIDDEN');
});
it('P1 pg-boss shows actual scheduled, active, completed and retry records without payload/PHI',async()=>{
 await db.exec(`CREATE SCHEMA pgboss;
 CREATE TABLE pgboss.job(
   id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
   name text NOT NULL,state text NOT NULL,
   data jsonb NOT NULL DEFAULT '{}'::jsonb,
   createdon timestamptz NOT NULL DEFAULT clock_timestamp(),
   startafter timestamptz NOT NULL DEFAULT clock_timestamp(),
   retrycount integer NOT NULL DEFAULT 0
 );`);
 for(const [state,retry] of [['created',0],['active',1],['completed',1],['retry',2]] as const)
  await db.query('INSERT INTO pgboss.job(name,state,data,retrycount) VALUES($1,$2,$3,$4)',
    ['synthetic_scan',state,{name:'HIDDEN_SYNTHETIC_PATIENT'},retry]);
 const admin=(await db.query<{id:string}>("SELECT id FROM app_user WHERE username='synthetic.pg.boss.admin113'")).rows[0].id;
 const data=await readPgBossQueueOverview(db,{id:admin,roles:['APP_ADMIN'],unitIds:[],permissions:[]});
 expect(data.counts).toHaveLength(4);
 expect(data.items).toHaveLength(4);
 expect(data.items.map(r=>r.job_state)).toEqual(expect.arrayContaining(['created','active','completed','retry']));
 expect(JSON.stringify(data)).not.toContain('HIDDEN_SYNTHETIC_PATIENT');
});
