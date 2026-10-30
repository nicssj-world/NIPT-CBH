import {beforeAll,afterAll,it,expect} from 'vitest';
import type {PGlite} from '@electric-sql/pglite';
import {testDatabase,addUser} from '../helpers/database';
import {readWorkerQueueOverview} from '../../packages/jobs/admin-center';
let db:PGlite;
beforeAll(async()=>{db=await testDatabase();});
afterAll(async()=>{await db?.close();});
it('P1 admin queue overview reads real migrated schema and never leaks job payload',async()=>{
 const admin=await addUser(db,'APP_ADMIN','synthetic.queue113.admin');
 const staff=await addUser(db,'LAB_STAFF','synthetic.queue113.lab');
 await db.query("INSERT INTO job_outbox(kind,payload,idempotency_key) VALUES('synthetic_scan',$1,$2)",[JSON.stringify({patientName:'SECRET_TEST_VALUE'}),'synthetic-queue113']);
 const data=await readWorkerQueueOverview(db,admin);
 expect(data.items.some(x=>x.kind==='synthetic_scan'&&x.state==='Pending')).toBe(true);
 expect(data.outbox.some(x=>x.kind==='synthetic_scan'&&x.count===1)).toBe(true);
 expect(JSON.stringify(data)).not.toContain('SECRET_TEST_VALUE');
 await expect(readWorkerQueueOverview(db,staff)).rejects.toThrow();
});
