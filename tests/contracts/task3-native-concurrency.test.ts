import {it,expect} from 'vitest';
import {Client} from 'pg';
import {randomBytes,randomUUID} from 'node:crypto';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {migrate} from '../../tools/migrate';
import {assertSyntheticDatabase,type Queryable} from '../../packages/db/connection';
import {FileStore} from '../../packages/storage';
import {tx} from '../helpers/lab';
import {task3Fixture,halosWorkbook,signerSetup,approveInterpretation,recordPaperRequest,masters} from '../helpers/task3';
import {previewHalosImport,decideHalosImport} from '../../packages/readygen/halos-import';
import {finalizeReports} from '../../packages/readygen/reports';

// Native PostgreSQL + Microsoft Word, two real app_rw sessions in parallel (T3-09-06, T3-12-07):
// the same HALOS file imported twice at once yields one import; two different Final batches for the same row yield one Final.
it.skipIf(!process.env.NIPT_TEST_DATABASE_URL)('native Task 3 concurrency: parallel duplicate import and parallel Final of one attempt',async()=>{
 const shared=process.env.NIPT_TEST_DATABASE_URL!;assertSyntheticDatabase(shared);
 const name='nipt_synthetic_test_task3c_'+randomBytes(4).toString('hex'),server=new URL(shared);server.pathname='/postgres';
 const admin=new Client({connectionString:server.toString()});await admin.connect();await admin.query('CREATE DATABASE '+name);
 const url=new URL(shared);url.pathname='/'+name;
 const owner=new Client({connectionString:url.toString()});await owner.connect();const clients:Client[]=[];
 const base=await mkdtemp(path.join(os.tmpdir(),'nipt-task3-conc-')),store=new FileStore(path.join(base,'files'));
 const session=async()=>{const c=new Client({connectionString:url.toString()});await c.connect();await c.query('SET ROLE app_rw');clients.push(c);return c as unknown as Queryable;};
 try{
  await migrate(owner);await owner.query(await readFile('packages/db/roles.sql','utf8'));await owner.query(await readFile('packages/p6/grants.sql','utf8'));
  const f=await task3Fixture(undefined,{db:owner as unknown as Queryable,root:base,store,lookupKey:randomBytes(32),close:async()=>{}});
  const [a]=f.cases,[s1,s2]=[await session(),await session()],deps={store,templates:masters()};
  const bytes=halosWorkbook({result:[{sample:a.printed,gender:'Female'}],sampleinfo:f.cases.map(x=>({id:x.vendorId,fetus:x.pregnancy,ga:'17,6'}))});
  const [p1,p2]=await Promise.all([s1,s2].map(s=>tx(s,t=>previewHalosImport(t,f.u.staff,store,{name:'Sample analysis data_S990000004_CONC.xlsx',bytes}))));
  expect(p1.id).toBe(p2.id);expect([p1.duplicate,p2.duplicate].sort()).toEqual([false,true]);
  expect((await owner.query('SELECT count(*)::int n FROM halos_import')).rows[0].n).toBe(1);
  await tx(s1,t=>decideHalosImport(t,f.u.staff,{importId:p1.id,decision:'CONFIRM',expectedRowVersion:p1.rowVersion}));
  await signerSetup(f);await approveInterpretation(f,{interpretationApproved:true,singletonApprovedProduct:'HNZ0011',twinApprovedProduct:'HNZ0011',approvalReference:'SYNTHETIC-CLINICAL-APPROVAL-CONC'});
  await recordPaperRequest(f,a,'Want');
  const rowId=p1.rows.find(r=>r.sheet==='result'&&r.sampleKey===a.printed)!.id;
  const run=(s:Queryable)=>tx(s,t=>finalizeReports(t,f.u.certifier,deps,{idempotencyKey:randomUUID(),defaults:{reportedBy:f.u.staff.id,approvedBy:f.u.certifier.id},items:[{rowId}]})).then(r=>r.items[0],(e:Error)=>({outcome:'REJECTED',code:e.message}));
  const outcomes=await Promise.all([run(s1),run(s2)]);
  expect(outcomes.filter(o=>o.outcome==='FINAL')).toHaveLength(1);
  expect((await owner.query("SELECT count(*)::int n FROM internal_report WHERE attempt_id=$1 AND state='Final'",[a.attemptId])).rows[0].n).toBe(1);
  expect((await owner.query("SELECT count(*)::int n FROM result_report_version v JOIN internal_report r ON r.version_id=v.id WHERE r.attempt_id=$1",[a.attemptId])).rows[0].n).toBe(1);
 }finally{for(const c of clients)await c.end().catch(()=>undefined);await owner.end();await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);await admin.end();await rm(base,{recursive:true,force:true});}
},600_000);
