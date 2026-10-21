import {it,expect,vi} from 'vitest';
import {testDatabase} from '../helpers/database';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {inboundFixture} from '../helpers/inbound';
import {labUsers,tx} from '../helpers/lab';
import {registerP2,doctorAction} from '../../packages/p2/service';
import {configureOperational} from '../../tools/configure-operational';
import {parsePet} from '../../packages/integrations/pet';
import {buildSyntheticPet} from '../../packages/inbound/wire';
import {applyS1} from '../../packages/inbound/process';
import * as batch from '../../packages/lab/batch';
import {benchWorkspace,benchExport} from '../../packages/lab/bench';
import {saveWorkbookDraft} from '../../packages/workbook/service';
import {reviewBenchForResult} from '../../packages/lab/bench-review';
import {importReport,pdfDate,type ResultFixture} from '../helpers/results';
import * as results from '../../packages/results/service';
it('Owner paper worksheet path fails closed when no complete current measurements and review exist',async()=>{
 const db=await testDatabase();try{
  const id=crypto.randomUUID();
  expect((await db.query<{ready:boolean}>('SELECT lab_bench_measurements_ready($1) ready',[id])).rows[0].ready).toBe(false);
  expect((await db.query<{current:boolean}>('SELECT lab_bench_review_current($1) current',[id])).rows[0].current).toBe(false);
  expect((await db.query<{ready:boolean}>('SELECT lab_owner_paper_ready($1) ready',[id])).rows[0].ready).toBe(false);
 }finally{await db.close();}
});
it('actual current Master worksheet, peer review and exact PDF reach authorised release without fabricated legacy QC',async()=>{
 const f=await inboundFixture();try{
  vi.stubEnv('NIPT_MODE','operational');vi.stubEnv('APP_ORIGIN','https://nipt.test');vi.stubEnv('NIPT_TASK_MASTER_PATH',path.resolve('.local/lab-owner-evidence/lab-combined-master.xlsx'));
  vi.stubEnv('NIPT_POOL_CSV_TEMPLATE','C:/Users/User/Downloads/Pooling Sheet Template_R001.csv');vi.stubEnv('NIPT_NIFTY_XLSX_TEMPLATE','C:/Users/User/Downloads/NIFTY_Test_Request_FormHNZ_filled.xlsx');
  await configureOperational(f.db);const u=await labUsers(f.db),run=<T>(fn:(db:import('../../packages/db/connection').Queryable)=>Promise<T>)=>tx(f.db,fn);
  const doctor=await run(t=>doctorAction(t,u.staff,{action:'save',doctorKey:'LOCAL-OWNER-QC-TEST',name:'SYNTHETIC TEST DOCTOR',unitId:u.unit,vector:{width:600,height:200,strokes:[[[10,10],[20,20]]]}})) as {id:string};
  const ln='9900099111',hn='9900099911',r=await run(t=>registerP2(t,u.staff,{ln,hn,unitId:u.unit,origin:'LAB_DIRECT',idempotencyKey:'owner_qc_release_local_test_001',labOperational:{gaWeeks:17,gaDays:6,edd:'2027-03-24',pregnancy:'Singleton',paperRequest:true,paperConsent:true,doctorVersionId:doctor.id}},f.lookupKey,{store:f.store}));
  const wire=buildSyntheticPet({ln,hn,dob:'19900101',orderAt:'20261020070000',specimenAt:'20261020080000',receivedAt:'20261020090000'}),pet=parsePet(wire.bytes,wire.filename);await f.store.put(wire.bytes);
  await run(async t=>{const file=(await t.query<{id:string}>("INSERT INTO his_inbound_file(sha256,state,filename,ln,parsed) VALUES($1,'Ready',$2,$3,$4) RETURNING id",[pet.hash,pet.filename,ln,JSON.stringify(pet)])).rows[0],target=(await t.query<{case_ln_id:string;case_id:string;origin:'LAB_DIRECT'}>('SELECT l.id case_ln_id,l.case_id,c.registration_origin origin FROM case_ln l JOIN nipt_case c ON c.id=l.case_id WHERE l.case_id=$1',[r.caseId])).rows[0];await applyS1(t,file,pet,target,'AUTOMATIC');});
  const a=(await f.db.query<{id:string;round_id:string;printed_sample_id:string}>('SELECT id,round_id,printed_sample_id FROM analytical_attempt WHERE case_id=$1',[r.caseId])).rows[0],b=await run(t=>batch.createBatch(t,u.staff)),id=b.batchId;
  const version=async()=>(await f.db.query<{version:number}>('SELECT version FROM lab_batch WHERE id=$1',[id])).rows[0].version;
  await run(async t=>batch.assignToBatch(t,u.staff,{batchId:id,expectedVersion:await version(),attemptIds:[a.id],sheetNumber:1}));
  for(const sheet of [2,3]){
   const extraLn='990009911'+sheet,extraHn='990009991'+sheet,registered=await run(t=>registerP2(t,u.staff,{ln:extraLn,hn:extraHn,unitId:u.unit,origin:'LAB_DIRECT',idempotencyKey:'owner_qc_release_extra_'+sheet,labOperational:{gaWeeks:17,gaDays:6,edd:'2027-03-24',pregnancy:'Singleton',paperRequest:true,paperConsent:true,doctorVersionId:doctor.id}},f.lookupKey,{store:f.store}));
   const wire=buildSyntheticPet({ln:extraLn,hn:extraHn,dob:'19900101',orderAt:'20261020070000',specimenAt:'20261020080000',receivedAt:'20261020090000'}),pet=parsePet(wire.bytes,wire.filename);await f.store.put(wire.bytes);
   await run(async t=>{const file=(await t.query<{id:string}>("INSERT INTO his_inbound_file(sha256,state,filename,ln,parsed) VALUES($1,'Ready',$2,$3,$4) RETURNING id",[pet.hash,pet.filename,extraLn,JSON.stringify(pet)])).rows[0],target=(await t.query<{case_ln_id:string;case_id:string;origin:'LAB_DIRECT'}>('SELECT l.id case_ln_id,l.case_id,c.registration_origin origin FROM case_ln l JOIN nipt_case c ON c.id=l.case_id WHERE l.case_id=$1',[registered.caseId])).rows[0];await applyS1(t,file,pet,target,'AUTOMATIC');});
   const attempt=(await f.db.query<{id:string}>('SELECT id FROM analytical_attempt WHERE case_id=$1',[registered.caseId])).rows[0];await run(async t=>batch.assignToBatch(t,u.staff,{batchId:id,expectedVersion:await version(),attemptIds:[attempt.id],sheetNumber:sheet}));
  }
  for(let sheet=1;sheet<=3;sheet++){await run(async t=>batch.updateSheetPlan(t,u.staff,{batchId:id,expectedVersion:await version(),sheetNumber:sheet,plannedWorkDate:'2026-10-20',plannedOperator:'SYNTHETIC LOCAL TEST',plannedExtractionLot:null,plannedExtractionExpiry:null,plannedLibraryLot:null,plannedLibraryExpiry:null}));await run(async t=>batch.planCheck(t,u.staff,{batchId:id,expectedVersion:await version(),sheetNumber:sheet,confirm:{controlsAtTemplate:true,identifiersMatch:true,noDuplicates:true}}));await run(async t=>batch.finalizeSheet(t,u.staff,{batchId:id,expectedVersion:await version(),sheetNumber:sheet}));}
  const deps={master:readFileSync(process.env.NIPT_TASK_MASTER_PATH!),store:f.store,render:async()=>{throw Error('NO_STUB_NATIVE_PRINT_CLAIM');}},w=await run(t=>benchWorkspace(t,u.staff,id,deps)),values={...w.values};
  for(const s of w.slots)if(s.kind!=='EMPTY')values[`slot.${s.slot}.libraryQc`]=s.kind==='BLANK'?0.5:20;
  for(let n=1;n<=3;n++)for(const k of ['standard1','standard2','standard2Concentration'])values[`qc.${n}.${k}`]=10;
  Object.assign(values,{'pool.standard1':0,'pool.standard2':100,'pool.standard2Concentration':10,'pool.concentration':3.33});
  for(const field of w.seqFields)values[field.key]=field.type==='number'?10:field.type==='checkbox'?true:'LOCAL TEST observation';
  Object.assign(values,{'seq.date':'20/10/2569','seq.operator':'SYNTHETIC LOCAL TEST','seq.dnbId':'DNB20261020','seq.negativePressureKpa':-80});
  await run(async t=>saveWorkbookDraft(t,u.staff,{batchId:id,expectedVersion:await version(),expectedRevision:0,values},deps));
  expect((await f.db.query<{ready:boolean}>('SELECT lab_bench_measurements_ready($1) ready',[id])).rows[0].ready).toBe(false);
  await run(t=>benchExport(t,u.staff,{batchId:id,revision:1,kind:'POOL_CSV'},deps));await run(t=>benchExport(t,u.staff,{batchId:id,revision:1,kind:'NIFTY_XLSX'},deps));
  expect((await f.db.query<{ready:boolean}>('SELECT lab_bench_measurements_ready($1) ready',[id])).rows[0].ready).toBe(true);
  await expect(run(t=>reviewBenchForResult(t,u.staff,a.id,{revision:1,measurementsReviewed:true,reason:'LOCAL TEST must not approve own work'}))).rejects.toThrow('FORBIDDEN');
  const rf={db:f.db,u,store:f.store,root:f.root,run} as unknown as ResultFixture,report=await importReport(rf,{kind:'SINGLETON',labNumber:(await f.db.query<{printed_sample_id:string}>('SELECT printed_sample_id FROM analytical_attempt WHERE id=$1',[a.id])).rows[0].printed_sample_id,hn,dob:'01-Jan-1990',collection:pdfDate('2026-10-20'),gaWeeks:17,gaDays:6,sex:null});
  const rv=async()=>(await f.db.query<{row_version:number}>('SELECT row_version FROM result_report_version WHERE id=$1',[report.versionId])).rows[0].row_version;
  await run(async t=>results.proposeLink(t,u.staff,{versionId:report.versionId,roundId:a.round_id,attemptId:a.id,reason:'LOCAL TEST exact PET patient and round',expectedRowVersion:await rv()}));
  const linked=await run(async t=>results.decideLink(t,u.certifier,{versionId:report.versionId,decision:'APPROVE',reason:'LOCAL TEST second person identity match',expectedRowVersion:await rv()}));expect(linked.outcome).toBe('ValidationBlocked');
  await expect(run(async t=>results.acceptAndRelease(t,u.certifier,{versionId:report.versionId,expectedRowVersion:await rv(),idempotencyKey:crypto.randomUUID(),externalFinalCertified:true,identityAndValuesMatchPdf:true,disclosureReviewed:true,abnormalAcknowledged:false}))).rejects.toThrow('OWNER_WORKSHEET_REVIEW_CONFIRMATION_REQUIRED');
  const released=await run(async t=>results.acceptAndRelease(t,u.certifier,{versionId:report.versionId,expectedRowVersion:await rv(),idempotencyKey:crypto.randomUUID(),externalFinalCertified:true,identityAndValuesMatchPdf:true,disclosureReviewed:true,abnormalAcknowledged:false,benchRevision:1,benchMeasurementsReviewed:true}));expect(released.outcome).toBe('CertifiedReleased');
  expect((await f.db.query('SELECT * FROM result_release')).rows).toHaveLength(1);
  expect((await f.db.query<{eligible:boolean}>('SELECT p6_release_eligible(id,epoch) eligible FROM result_release')).rows[0].eligible).toBe(true);
  expect((await f.db.query('SELECT * FROM lab_bench_review')).rows).toHaveLength(1);
  expect((await f.db.query('SELECT * FROM p4b_pool_attempt')).rows).toHaveLength(0);expect((await f.db.query('SELECT * FROM p4c_dnb_attempt')).rows).toHaveLength(0);
  await expect(f.db.query('DELETE FROM lab_bench_review')).rejects.toThrow();
  const latest=await run(t=>benchWorkspace(t,u.staff,id,deps));await run(async t=>saveWorkbookDraft(t,u.staff,{batchId:id,expectedVersion:await version(),expectedRevision:1,values:{...latest.values,'seq.q30':11}},deps));
  const q=(await f.db.query<{id:string}>('SELECT id FROM lab_bench_review')).rows[0];expect((await f.db.query<{current:boolean}>('SELECT lab_bench_review_current($1) current',[q.id])).rows[0].current).toBe(false);
  expect((await f.db.query<{eligible:boolean}>('SELECT p6_release_eligible(id,epoch) eligible FROM result_release')).rows[0].eligible).toBe(false);
 }finally{vi.unstubAllEnvs();await f.close();}
},120000);
