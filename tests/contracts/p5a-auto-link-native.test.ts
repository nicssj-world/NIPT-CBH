import {it,expect} from 'vitest';
import {Client} from 'pg';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {migrate} from '../../tools/migrate';
import {assertSyntheticDatabase,type Queryable} from '../../packages/db/connection';
import {FileStore} from '../../packages/storage';
import * as svc from '../../packages/results/service';
import {registerIntake,parseIntake} from '../../packages/results/intake';
import {SETTINGS} from '../../packages/settings/catalog';
import {proposeSetting,validateSetting,approveSetting,activateSetting} from '../../packages/settings/service';
import {tx,labUsers,syntheticCase,receiveS1} from '../helpers/lab';
import {syntheticReportPdf} from '../../tools/his-simulator/result-pdf';

// Owner P5-A on real PostgreSQL: two app_rw sessions confirm two different PDFs for the same round at the same moment.
// Exactly one AUTO_LINKED; the other import still succeeds and stays Unlinked. Runs in its own fresh synthetic database.
it.skipIf(!process.env.NIPT_TEST_DATABASE_URL)('native P5-A: concurrent system links of one round produce one link and no failed import',async()=>{
 const shared=process.env.NIPT_TEST_DATABASE_URL!;assertSyntheticDatabase(shared);
 const name='nipt_synthetic_test_p5a_'+randomBytes(4).toString('hex'),server=new URL(shared);server.pathname='/postgres';
 const admin=new Client({connectionString:server.toString()});await admin.connect();await admin.query('CREATE DATABASE '+name);
 const url=new URL(shared);url.pathname='/'+name;assertSyntheticDatabase(url.toString());
 const owner=new Client({connectionString:url.toString()});await owner.connect();const base=await mkdtemp(path.join(os.tmpdir(),'nipt-p5a-native-'));const store=new FileStore(path.join(base,'files'));
 const clients:Client[]=[];const session=async(role:'app_rw'|'worker_rw')=>{const c=new Client({connectionString:url.toString()});await c.connect();await c.query(`SET ROLE ${role}`);clients.push(c);return c as unknown as Queryable;};
 try{
  await migrate(owner);await owner.query(await readFile('packages/db/roles.sql','utf8'));
  const o=owner as unknown as Queryable,u=await labUsers(o);
  const sid=await tx(o,t=>proposeSetting(t,u.certifier,'result_management',{...SETTINGS.result_management.default,linkageMode:'UNIQUE_AUTO_LINK'},'Owner P5-A native race'));
  await tx(o,t=>validateSetting(t,u.certifier,sid,async()=>true));await tx(o,t=>approveSetting(t,u.approver,sid));await tx(o,t=>activateSetting(t,u.approver,sid));
  const hn='99000'+String(Date.now()).slice(-7),c=await tx(o,t=>syntheticCase(t,u));
  const payload={draft:{patient:{dob:'1996-03-31'},pregnancy:{type:'Singleton',edd:'2027-04-22',fetalSex:'DoNotWant'}}};
  await tx(o,async t=>{await t.query('INSERT INTO p2_case_identity(case_id,hn) VALUES($1,$2)',[c.caseId,hn]);
   await t.query("INSERT INTO p2_document_revision(case_id,round_id,kind,version,template_version,payload,content_hash,reason,created_by) VALUES($1,$2,'REQUEST',1,'SYNTHETIC-FM01-v1',$3,$4,'SYNTHETIC_P5',$5)",[c.caseId,c.roundId,JSON.stringify(payload),createHash('sha256').update(JSON.stringify(payload)+randomUUID()).digest('hex'),u.staff.id]);
   await receiveS1(t,c,new Date(Date.now()-3600000),'2026-10-10');});
  const lnHalos=(await owner.query<{ln_halos:string}>('SELECT ln_halos FROM specimen_lab_number WHERE round_id=$1',[c.roundId])).rows[0].ln_halos;
  const [w,a1,a2]=[await session('worker_rw'),await session('app_rw'),await session('app_rw')];
  const ids:string[]=[];
  for(const reported of ['20-Oct-2026','21-Oct-2026']){const bytes=syntheticReportPdf({kind:'SINGLETON',labNumber:lnHalos,hn,collection:'10-Oct-2026',reported});
   ids.push(await tx(w,async t=>{const id=await registerIntake(t,store,{source:'UPLOAD',relativePath:null,originalName:`native-${randomUUID().slice(0,6)}.pdf`,actorId:u.staff.id,jobId:null},bytes);await parseIntake(t,store,id,{maxBytes:1e7,acceptZip:true});return id;}));}
  const out=await Promise.all(ids.map((id,i)=>tx([a1,a2][i],t=>svc.confirmImport(t,u.staff,{intakeIds:[id]}))));
  expect(out.map(r=>r[0].autoLink).sort()).toEqual(['LINKED','SERIES_NOT_EMPTY']);
  expect((await owner.query("SELECT count(*)::int n FROM result_link_event WHERE event='AUTO_LINKED'")).rows[0]).toEqual({n:1});
  expect((await owner.query("SELECT count(*)::int n FROM result_report_version WHERE round_id=$1",[c.roundId])).rows[0]).toEqual({n:1});
  expect((await owner.query("SELECT count(*)::int n FROM result_report_version WHERE state='Unlinked'")).rows[0]).toEqual({n:1});
  expect((await owner.query('SELECT count(*)::int n FROM result_release')).rows[0]).toEqual({n:0});
 }finally{for(const c of clients)await c.end();await owner.end();await admin.query('DROP DATABASE IF EXISTS '+name);await admin.end();await rm(base,{recursive:true,force:true});}
},120000);
