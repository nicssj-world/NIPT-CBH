import {readFileSync} from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {vi} from 'vitest';
import type {z} from 'zod';
import {inboundFixture,writePet,cycle} from './inbound';
import {addUser} from './database';
import {labUsers,tx} from './lab';
import {syntheticSignaturePng} from './signature-png';
import type {Queryable} from '../../packages/db/connection';
import {registerP2,doctorAction} from '../../packages/p2/service';
import {configureOperational} from '../../tools/configure-operational';
import {parsePet} from '../../packages/integrations/pet';
import {buildSyntheticPet} from '../../packages/inbound/wire';
import {applyS1} from '../../packages/inbound/process';
import {receiveEqaSpecimen} from '../../packages/eqa/service';
import * as batch from '../../packages/lab/batch';
import {benchWorkspace,benchExport} from '../../packages/lab/bench';
import {saveWorkbookDraft} from '../../packages/workbook/service';
import {recordActualPooling,exportSeqPair} from '../../packages/lab/seq-export';
import {orderRepeat,orderRedraw} from '../../packages/lab/intake';
import {submitSignerProfile,decideSignerProfile,grantDelegation} from '../../packages/readygen/signers';
import {proposeSetting,validateSetting,approveSetting,activateSetting} from '../../packages/settings/service';
import {SETTINGS} from '../../packages/settings/catalog';
import type {Principal} from '../../packages/security/policy';

export const T3_SOURCES=path.resolve('.local/task3-sources');
export const masters=()=>({SINGLETON:readFileSync(path.join(T3_SOURCES,'singleton.docx')),TWIN:readFileSync(path.join(T3_SOURCES,'twin.docx'))});
export {halosWorkbook,type HalosSpec} from '../../tools/task3-uat/halos-fixture';


type CaseSpec={ln:string;hn:string;pregnancy:'Singleton'|'Twins';sheet:1|2|3;priorFailures?:boolean;eqa?:boolean;pet?:{specimenAt?:string;receivedAt?:string;ward?:string;identity?:string}};
/** Operational LAB_DIRECT cases through PET receipt, one Owner batch, real Master worksheet, actual pooling and the dual HALOS/NIFTY export. */
type Provided={db:Queryable;root:string;store:import('../../packages/storage').FileStore;lookupKey:Buffer;close():Promise<void>};
export async function task3Fixture(cases:CaseSpec[]=[{ln:'9900099511',hn:'9900099951',pregnancy:'Singleton',sheet:1},{ln:'9900099512',hn:'9900099952',pregnancy:'Singleton',sheet:2},{ln:'9900099513',hn:'9900099953',pregnancy:'Twins',sheet:3}],provided?:Provided){
 const f=(provided??await inboundFixture()) as Awaited<ReturnType<typeof inboundFixture>>;
 vi.stubEnv('NIPT_MODE','operational');vi.stubEnv('APP_ORIGIN','https://nipt.test');vi.stubEnv('NIPT_TASK_MASTER_PATH',path.resolve('.local/lab-owner-evidence/lab-combined-master.xlsx'));
 vi.stubEnv('NIPT_POOL_CSV_TEMPLATE',path.resolve('.local/approved/pooling.csv'));vi.stubEnv('NIPT_NIFTY_XLSX_TEMPLATE',path.resolve('.local/approved/nifty.xlsx'));vi.stubEnv('NIPT_HALOS_TASK_TEMPLATE',path.resolve('.local/approved/halos-task.xlsx'));
 await configureOperational(f.db);const u=await labUsers(f.db),admin=await addUser(f.db,'APP_ADMIN','synthetic.task3.admin');
 const run=<T>(fn:(db:Queryable)=>Promise<T>)=>tx(f.db,fn);
 const doctor=await run(t=>doctorAction(t,u.staff,{action:'save',doctorKey:'SYNTHETIC-TASK3-DOCTOR',name:'SYNTHETIC TASK3 DOCTOR',unitId:u.unit,vector:{width:600,height:200,strokes:[[[10,10],[20,20]]]}})) as {id:string};
 const b=await run(t=>batch.createBatch(t,u.staff)),batchId=b.batchId,version=async()=>(await f.db.query<{version:number}>('SELECT version FROM lab_batch WHERE id=$1',[batchId])).rows[0].version;
 const made:{ln:string;hn:string;caseId:string;roundId:string;attemptId:string;printed:string;pregnancy:'Singleton'|'Twins'}[]=[];
 for(const c of cases){
  const r=await run(t=>registerP2(t,u.staff,{ln:c.ln,hn:c.hn,unitId:u.unit,origin:'LAB_DIRECT',identifierSource:c.eqa?'TUBE_LABEL':undefined,idempotencyKey:'task3_fixture_'+randomUUID().replaceAll('-',''),
   ...(c.eqa?{eqa:{organizer:'SYNTHETIC EQA SCHEME',organizerSampleId:c.ln,patientName:'SYNTHETIC ORGANIZER PATIENT',patientDob:'1990-01-01',collectionAt:'2026-10-20T08:00:00+07:00',pregnancyType:c.pregnancy,edd:'2027-03-24',programYear:2026,evidenceReference:'SYNTHETIC ORGANIZER FROZEN DOCUMENT'}}
   :{labOperational:{gaWeeks:17,gaDays:6,edd:'2027-03-24',pregnancy:c.pregnancy,paperRequest:true,paperConsent:true,doctorVersionId:doctor.id}})},f.lookupKey,{store:f.store}));
  if(c.eqa)await run(t=>receiveEqaSpecimen(t,u.staff,r.caseId!,'2026-10-20'));
  else{
  const wire=buildSyntheticPet({ln:c.ln,hn:c.hn,dob:'19900101',orderAt:'20261020070000',specimenAt:'20261020080000',receivedAt:'20261020090000',...c.pet}),pet=parsePet(wire.bytes,wire.filename);await f.store.put(wire.bytes);
  await run(async t=>{const file=(await t.query<{id:string}>("INSERT INTO his_inbound_file(sha256,state,filename,ln,parsed) VALUES($1,'Ready',$2,$3,$4) RETURNING id",[pet.hash,pet.filename,c.ln,JSON.stringify(pet)])).rows[0],target=(await t.query<{case_ln_id:string;case_id:string;origin:'LAB_DIRECT'}>('SELECT l.id case_ln_id,l.case_id,c.registration_origin origin FROM case_ln l JOIN nipt_case c ON c.id=l.case_id WHERE l.case_id=$1',[r.caseId])).rows[0];await applyS1(t,file,pet,target,'AUTOMATIC');});
  }
  let a=(await f.db.query<{id:string;round_id:string}>('SELECT id,round_id FROM analytical_attempt WHERE case_id=$1',[r.caseId])).rows[0];
  // Owner-locked lineage before the batched attempt: -1 and -2 fail (S1), Re-Sampling S2 receipt via a newer HIS PET, R-1 fails; R-2 is
  // the 4th attempt and goes through the real batch below. Failures of the earlier attempts are disposable state fixtures (as task1-lineage).
  if(c.priorFailures){
   const fail=async()=>{const x=(await f.db.query<{id:string;repeat_order_id:string|null}>('SELECT id,repeat_order_id FROM analytical_attempt WHERE case_id=$1 ORDER BY overall_ordinal DESC LIMIT 1',[r.caseId])).rows[0];
    await f.db.query("UPDATE analytical_attempt SET state='Assigned' WHERE id=$1",[x.id]);if(x.repeat_order_id)await f.db.query("UPDATE repeat_work_order SET state='RepeatInProgress' WHERE id=$1",[x.repeat_order_id]);
    await f.db.query("UPDATE analytical_attempt SET state='InProgress' WHERE id=$1",[x.id]);await f.db.query("UPDATE analytical_attempt SET state='QcFailed',qc_failed_stage='QC1' WHERE id=$1",[x.id]);return x.id;};
   const first=await fail();await run(t=>orderRepeat(t,u.staff,{attemptId:first,level:'RE_LIBRARY',reasonCode:'LIBRARY_FAILURE',note:'SYNTHETIC repeat fixture'}));const second=await fail();
   const redraw=await run(t=>orderRedraw(t,u.staff,{caseId:r.caseId,reasonCode:'QC_SAMPLE_FAILED',note:'SYNTHETIC re-sampling fixture'}));void second;
   await writePet(f.root,'20261021',{ln:c.ln,hn:c.hn,dob:'19900101',orderAt:'20261021070000',specimenAt:'20261021080000',receivedAt:'20261021090000'});await cycle(f,{now:new Date('2026-10-21T05:00:00Z')});
   const third=await fail();
   const fourth=await run(t=>orderRepeat(t,u.staff,{attemptId:third,level:'RE_EXTRACTION',reasonCode:'LIBRARY_FAILURE',note:'SYNTHETIC fourth attempt'}));
   a={id:fourth.attemptId,round_id:redraw.newRoundId};
  }
  const placed=await run(async t=>batch.assignToBatch(t,u.staff,{batchId,expectedVersion:await version(),attemptIds:[a.id],sheetNumber:c.sheet}));if(placed.rejected.length)throw Error('FIXTURE_ASSIGNMENT_REJECTED '+JSON.stringify(placed.rejected));
  made.push({ln:c.ln,hn:c.hn,caseId:r.caseId!,roundId:a.round_id,attemptId:a.id,printed:'',pregnancy:c.pregnancy});
 }
 for(let sheet=1;sheet<=3;sheet++){await run(async t=>batch.updateSheetPlan(t,u.staff,{batchId,expectedVersion:await version(),sheetNumber:sheet,plannedWorkDate:'2026-10-20',plannedOperator:'SYNTHETIC LOCAL TEST',plannedExtractionLot:null,plannedExtractionExpiry:null,plannedLibraryLot:null,plannedLibraryExpiry:null}));
  await run(async t=>batch.planCheck(t,u.staff,{batchId,expectedVersion:await version(),sheetNumber:sheet,confirm:{controlsAtTemplate:true,identifiersMatch:true,noDuplicates:true}}));await run(async t=>batch.finalizeSheet(t,u.staff,{batchId,expectedVersion:await version(),sheetNumber:sheet}));}
 for(const m of made)m.printed=(await f.db.query<{printed_sample_id:string}>('SELECT printed_sample_id FROM analytical_attempt WHERE id=$1',[m.attemptId])).rows[0].printed_sample_id;
 const deps={master:readFileSync(process.env.NIPT_TASK_MASTER_PATH!),store:f.store,render:async()=>{throw Error('NO_STUB_NATIVE_PRINT_CLAIM');}},w=await run(t=>benchWorkspace(t,u.staff,batchId,deps)),values={...w.values};
 for(const s of w.slots)if(s.kind!=='EMPTY')values[`slot.${s.slot}.libraryQc`]=s.kind==='BLANK'?0.5:20;
 for(let n=1;n<=3;n++)for(const k of ['standard1','standard2','standard2Concentration'])values[`qc.${n}.${k}`]=10;
 Object.assign(values,{'pool.standard1':0,'pool.standard2':100,'pool.standard2Concentration':10,'pool.concentration':3.33});
 for(const field of w.seqFields)values[field.key]=field.type==='number'?10:field.type==='checkbox'?true:'LOCAL TEST observation';
 Object.assign(values,{'seq.date':'20/10/2569','seq.operator':'SYNTHETIC LOCAL TEST','seq.dnbId':'DNB20261020','seq.negativePressureKpa':-80});
 await run(async t=>saveWorkbookDraft(t,u.staff,{batchId,expectedVersion:await version(),expectedRevision:0,values},deps));
 await run(t=>benchExport(t,u.staff,{batchId,revision:1,kind:'POOL_CSV'},deps));
 await run(t=>recordActualPooling(t,u.staff,{batchId,revision:1,members:w.slots.map(s=>({slot:s.slot,pooled:['PATIENT','PC','NC'].includes(s.kind)})),note:'LOCAL TEST actual paper pooling transfer recorded by operator'},deps));
 const pair=await run(t=>exportSeqPair(t,u.staff,{batchId,revision:1,idempotencyKey:randomUUID()},deps));
 const controls=(await f.db.query<{sample:string}>("SELECT m->>'sampleId' sample FROM lab_bench_export h CROSS JOIN LATERAL jsonb_array_elements(h.mapping) m WHERE h.kind='HALOS_TASK_XLSX' AND m->>'attemptId' IS NULL")).rows.map(r=>r.sample);
 const vendor=new Map((await f.db.query<{attempt:string;vendor:string}>("SELECT m->>'attemptId' attempt,m->>'vendorSampleId' vendor FROM lab_bench_export n CROSS JOIN LATERAL jsonb_array_elements(n.mapping) m WHERE n.kind='NIFTY_XLSX' AND m->>'kind'='PATIENT'")).rows.map(r=>[r.attempt,r.vendor]));
 return {...f,u,admin,run,batchId,pair,cases:made.map(m=>({...m,vendorId:vendor.get(m.attemptId)!})),controls};
}
/** Verified signer profiles: staff (Reported by) delegates to the certifier operator; certifier signs Approved by as self. */
export async function signerSetup(f:Awaited<ReturnType<typeof task3Fixture>>){
 const profile=async(user:Principal,name:string,license:string,seed:number)=>{const p=await f.run(t=>submitSignerProfile(t,user,f.store,{legalName:name,mtLicenseNo:license,signature:syntheticSignaturePng(seed)}));
  await f.run(t=>decideSignerProfile(t,f.admin,{profileId:p.id,decision:'VERIFY',reason:'SYNTHETIC identity and licence checked'}));return p.id;};
 const reporterProfile=await profile(f.u.staff,'Synthetic Reporter','99001',1),approverProfile=await profile(f.u.certifier,'Synthetic Approver','99002',2);
 const delegation=await f.run(t=>grantDelegation(t,f.u.staff,{granteeId:f.u.certifier.id,roles:['REPORTED'],authorityReference:'SYNTHETIC-SOP-NIPT-SIGNATURE-01'}));
 return {reporterProfile,approverProfile,delegation:delegation.id};
}
/** CLINICAL maker-checker activation of report_interpretation (certifier proposes, clinical approver approves and activates). */
export async function approveInterpretation(f:Awaited<ReturnType<typeof task3Fixture>>,value:Partial<z.infer<typeof SETTINGS.report_interpretation.schema>>){
 return f.run(async t=>{const id=await proposeSetting(t,f.u.certifier,'report_interpretation',{...SETTINGS.report_interpretation.default,...value},'SYNTHETIC_TASK3_APPROVAL');await validateSetting(t,f.u.certifier,id,async()=>true);await approveSetting(t,f.u.approver,id);await activateSetting(t,f.u.approver,id);return id;});
}
/** The paper Request form verified with the patient's documented fetal-sex wish (existing P2 paper review). */
export async function recordPaperRequest(f:Awaited<ReturnType<typeof task3Fixture>>,c:{caseId:string;roundId:string;pregnancy:'Singleton'|'Twins'},fetalSex:'Want'|'DoNotWant'){
 const panel={requestComplete:'Complete',decision:null,signatures:null,representative:null,history1to5:'AllNo',ga:'Over10to18',bmi:'AtMost40',conditionA:'NotApplicable',conditionB:'NotApplicable',vanishingTwin:'None',pregnancyType:c.pregnancy,fetalSex,collectionDate:null,dob:'1990-01-01',edd:'2027-03-24'};
 await f.run(t=>t.query("INSERT INTO p2_paper_review(case_id,round_id,kind,template_version,document_reference,panel,status,location,reason,verifier_id) VALUES($1,$2,'REQUEST','SYNTHETIC-FM01-v1','SYNTHETIC-DOC',$3,'Verified','SYNTHETIC-LOCATION','SYNTHETIC_REVIEW',$4)",[c.caseId,c.roundId,JSON.stringify(panel),f.u.certifier.id]));
}
