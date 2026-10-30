import {Client} from 'pg';
import type {Queryable} from '../packages/db/connection';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {browserFixtureDatabaseUrl} from '../tests/helpers/browser-database';
import {registerP2} from '../packages/p2/service';
import {FileStore} from '../packages/storage';
import {writePet} from '../tests/helpers/inbound';
import {runInboundCycle} from '../packages/inbound/cycle';
import {attemptFacts,candidatePrintedId,setAttemptState,type Staff} from '../packages/lab/core';
import {orderRepeat,orderRedraw,previewLabels} from '../packages/lab/intake';
import {tx} from '../tests/helpers/lab';

// Only the explicit disposable browser DB; never infer an operational/UAT target.
const url=browserFixtureDatabaseUrl(),dir=process.env.NIPT_TASK1_EVIDENCE_DIR;
if(!dir||!process.env.SIMULATOR_ROOT||!process.env.FILE_STORE_ROOT||!process.env.IDENTITY_LOOKUP_KEY_FILE)throw Error('TASK1_DISPOSABLE_FIXTURE_REQUIRED');
const db=new Client({connectionString:url});await db.connect();
const q:Queryable={query:async<T>(sql:string,values?:unknown[])=>({rows:(await db.query(sql,values)).rows as T[]})};
const store=new FileStore(process.env.FILE_STORE_ROOT),lookupKey=await readFile(process.env.IDENTITY_LOOKUP_KEY_FILE),root=process.env.SIMULATOR_ROOT;
const snapshot=async(caseId:string)=>({
 attempts:(await db.query('SELECT id,case_id,round_id,attempt_number,overall_ordinal,state,printed_sample_id,repeat_order_id FROM analytical_attempt WHERE case_id=$1 ORDER BY overall_ordinal',[caseId])).rows,
 rounds:(await db.query('SELECT id,case_ln_id,round_number,received_at,received_source,collection_date FROM specimen_round WHERE case_id=$1 ORDER BY round_number',[caseId])).rows,
 numbers:(await db.query('SELECT n.* FROM specimen_lab_number n JOIN specimen_round r ON r.id=n.round_id WHERE n.case_id=$1 ORDER BY r.round_number',[caseId])).rows,
 orders:(await db.query('SELECT o.* FROM his_order o JOIN case_ln l ON l.id=o.case_ln_id WHERE l.case_id=$1 ORDER BY o.his_received_at',[caseId])).rows,
 events:(await db.query('SELECT * FROM attempt_event WHERE case_id=$1 ORDER BY sequence',[caseId])).rows,
});
try{
 await mkdir(dir,{recursive:true});
 if(process.argv[2]==='prepare'){
  const staffId=(await db.query<{id:string}>("SELECT id FROM app_user WHERE username='synthetic.lab'")).rows[0].id;
  const staff:Staff={id:staffId,roles:['LAB_STAFF'],unitIds:[],permissions:[]},unit=(await db.query<{id:string}>("SELECT id FROM unit WHERE code='SYNTHETIC_ANC'")).rows[0].id;
  const ln='990001009239',hn='9900001239';
  const r=await tx(db,t=>registerP2(t,staff,{ln,hn,unitId:unit,origin:'LAB_DIRECT',idempotencyKey:'task1_native_restart_synthetic',labOperational:{gaWeeks:17,gaDays:6,edd:'2027-03-24',pregnancy:'Twins',paperRequest:true,paperConsent:true}},lookupKey,{store}));
  const caseId=r.caseId!;
  const receive=async(day:string)=>{await writePet(root,day,{ln,hn,receivedAt:day+'090000',specimenAt:day+'080000'});const outcome=await runInboundCycle(q,{root,store,lookupKey},{trigger:'MANUAL',lookbackDays:3,intervalSeconds:30,now:()=>new Date(day.slice(0,4)+'-'+day.slice(4,6)+'-'+day.slice(6,8)+'T05:00:00Z')});await writeFile(path.join(dir!,`native-receive-${day}.json`),JSON.stringify({outcome,files:(await db.query('SELECT state,error_code FROM his_inbound_file WHERE ln=$1',[ln])).rows},null,2));if(!(await db.query('SELECT id FROM analytical_attempt WHERE case_id=$1',[caseId])).rows.length)throw Error('NATIVE_PET_NOT_APPLIED:'+JSON.stringify(outcome));};
  const latest=async()=>(await attemptFacts(db,'a.case_id=$1 ORDER BY a.overall_ordinal DESC LIMIT 1',[caseId]))[0];
  // Explicit synthetic fixture decisions, not instrument/clinical acceptance.
  const failed=async()=>{const a=await latest();await tx(db,async t=>{
   await t.query('UPDATE analytical_attempt SET printed_sample_id=$2 WHERE id=$1',[a.attempt_id,candidatePrintedId(a).id]);
   await setAttemptState(t,staff,{id:a.attempt_id,case_id:caseId,state:'Ready'},'Assigned',{syntheticFixture:true});
   await setAttemptState(t,staff,{id:a.attempt_id,case_id:caseId,state:'Assigned'},'InProgress',{syntheticFixture:true});
   await setAttemptState(t,staff,{id:a.attempt_id,case_id:caseId,state:'InProgress'},'QcFailed',{syntheticFixture:true},{qcFailedStage:'SEQUENCING'});
  });return a;};
  const repeat=async(level:'RE_LIBRARY'|'RE_EXTRACTION')=>{const a=await latest();return tx(db,t=>orderRepeat(t,staff,{attemptId:a.attempt_id,level,reasonCode:'LIBRARY_FAILURE',note:'SYNTHETIC native persistence confirmed fixture failure'}));};
  await receive('20261021');await failed();await repeat('RE_EXTRACTION');await failed();
  await tx(db,t=>orderRedraw(t,staff,{caseId,reasonCode:'QC_SAMPLE_FAILED',note:'SYNTHETIC native restart S2 requested from HIS'}));
  await receive('20261022');await failed();await repeat('RE_LIBRARY');await failed();
  await tx(db,t=>orderRedraw(t,staff,{caseId,reasonCode:'QC_SAMPLE_FAILED',note:'SYNTHETIC native restart exceptional S3 HIS request'}));
  await receive('20261023');await failed();await repeat('RE_EXTRACTION');
  const a=await latest();await db.query('UPDATE analytical_attempt SET printed_sample_id=$2 WHERE id=$1',[a.attempt_id,candidatePrintedId(a).id]);
  const before=await snapshot(caseId),base=before.numbers[0].ln_halos;
  assert.deepEqual(before.attempts.map(a=>a.printed_sample_id),[base+'D-1',base+'D-2',base+'DR-1',base+'DR-2',base+'DR-1',base+'DR-1']);
  assert.equal(new Set(before.attempts.map(a=>a.id)).size,6);assert.equal(before.orders.length,3);
  const labels=await previewLabels(db,staff,{roundIds:[a.round_id],includeName:false});await writeFile(path.join(dir,'native-S3-labels.html'),labels.html);
  await writeFile(path.join(dir,'native-before-restart.json'),JSON.stringify({caseId,before},null,2));
 }else if(process.argv[2]==='verify'){
  const expected=JSON.parse(await readFile(path.join(dir,'native-before-restart.json'),'utf8')) as {caseId:string;before:unknown};
  const after=await snapshot(expected.caseId);assert.deepEqual(JSON.parse(JSON.stringify(after)),expected.before);
  await writeFile(path.join(dir,'native-after-restart.json'),JSON.stringify({passed:true,evidence:'Same PostgreSQL data directory after runner restarts DB, app and worker; six distinct attempts, S3 PET and immutable bytes retained',caseId:expected.caseId,after},null,2));
 }else throw Error('PREPARE_OR_VERIFY_REQUIRED');
 process.stdout.write('TASK1_NATIVE_'+process.argv[2].toUpperCase()+'_PASS\n');
}finally{await db.end();}
