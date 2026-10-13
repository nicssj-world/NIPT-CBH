import {it,expect} from 'vitest';
import {Client} from 'pg';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {migrate} from '../../tools/migrate';
import {assertSyntheticDatabase} from '../../packages/db/connection';
import {labUsers,syntheticCase,receiveS1,tx} from '../helpers/lab';
import {attemptEvidence} from '../../packages/results/evidence';

// Dedicated opt-in only. Each run creates a fresh synthetic DB; no inherited .env or default DATABASE_URL.
it.skipIf(!process.env.NIPT_P7_NATIVE_URL)('native P7 owner/app_rw reject clinical state INSERT/UPDATE; ordinary lifecycle and independent AL5 HOLD survive',async()=>{
 const base=process.env.NIPT_P7_NATIVE_URL!;assertSyntheticDatabase(base);
 const admin=new Client({connectionString:base});await admin.connect();
 const name='nipt_p7_synthetic_'+randomUUID().replaceAll('-',''),url=new URL(base);url.pathname='/'+name;
 const clients:Client[]=[];
 try{
  await admin.query(`CREATE DATABASE ${name}`);
  const owner=new Client({connectionString:url.toString()});await owner.connect();clients.push(owner);
  await migrate(owner);await owner.query(await readFile('packages/db/roles.sql','utf8'));
  const app=new Client({connectionString:url.toString()});await app.connect();clients.push(app);await app.query('SET ROLE app_rw');
  expect((await app.query('SELECT current_user role')).rows[0]).toEqual({role:'app_rw'});
  const users=await labUsers(owner),c=await tx(owner,t=>syntheticCase(t,users));
  await tx(owner,t=>receiveS1(t,c));
  const attempt=(await owner.query<{id:string}>('SELECT id FROM analytical_attempt WHERE round_id=$1',[c.roundId])).rows[0];
  for(const db of [app,owner])for(const state of ['AnalysisComplete','FinalQcAccepted','Final']){
   await expect(db.query('UPDATE analytical_attempt SET state=$2 WHERE id=$1',[attempt.id,state])).rejects.toThrow('CLINICAL_QC_ADAPTER_PENDING');
   await expect(db.query('INSERT INTO analytical_attempt(case_id,round_id,attempt_number,state) VALUES($1,$2,1,$3)',[c.caseId,c.roundId,state])).rejects.toThrow('CLINICAL_QC_ADAPTER_PENDING');
  }
  expect((await owner.query('SELECT state FROM analytical_attempt WHERE id=$1',[attempt.id])).rows[0]).toEqual({state:'Ready'});
  expect(await attemptEvidence(app,attempt.id)).toMatchObject({current:false,reason:null,analysisAccepted:false,finalQcAccepted:false});
  for(const state of ['Assigned','InProgress','Stopped'])await app.query('UPDATE analytical_attempt SET state=$2 WHERE id=$1',[attempt.id,state]);
  expect((await owner.query('SELECT state FROM analytical_attempt WHERE id=$1',[attempt.id])).rows[0]).toEqual({state:'Stopped'});
  expect((await owner.query('SELECT p5_release_authorized() allowed')).rows[0]).toEqual({allowed:false});
  expect((await owner.query("SELECT (SELECT count(*) FROM result_release)::int releases,(SELECT count(*) FROM analytical_attempt WHERE state IN ('AnalysisComplete','FinalQcAccepted','Final'))::int clinical")).rows[0]).toEqual({releases:0,clinical:0});
 }finally{
  for(const client of clients)await client.end();
  await admin.query(`DROP DATABASE IF EXISTS ${name}`);await admin.end();
 }
},120000);
