import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import argon2 from 'argon2';
import type {Queryable} from '../../packages/db/connection';
import {ARGON_OPTIONS} from '../../packages/security/password';
import {appendAudit} from '../../packages/db/audit';
import type {Principal} from '../../packages/security/policy';
import {registerP2,doctorAction} from '../../packages/p2/service';
import {parsePet} from '../../packages/integrations/pet';
import {applyS1} from '../../packages/inbound/process';
import * as batch from '../../packages/lab/batch';
import {benchWorkspace,benchExport} from '../../packages/lab/bench';
import {saveWorkbookDraft} from '../../packages/workbook/service';
import {recordActualPooling,exportSeqPair} from '../../packages/lab/seq-export';
import {FileStore} from '../../packages/storage';
import {SETTINGS} from '../../packages/settings/catalog';
import {proposeSetting,validateSetting,approveSetting,activateSetting} from '../../packages/settings/service';
import {submitSignerProfile,decideSignerProfile,grantDelegation} from '../../packages/readygen/signers';
import {syntheticProfile} from '../../packages/p6/res';
import {syntheticReportPdf} from '../his-simulator/result-pdf';
import {operationalTestPetBytes} from '../operational/test-pet-fixture';
import {halosWorkbook,type HalosSpec} from './halos-fixture';
import {signaturePng} from './signature';

// Integrated Owner UAT seed (synthetic data only, loopback runtime only). Run once on an empty operational UAT database by uat.ts.
// UAT accounts use username = password ("admin/admin") as the Owner asked; this function refuses anything but the dedicated UAT database.
export const UAT_DATABASE='nipt_task3_integrated_owner_uat';
export const UAT_ACCOUNTS=[['admin','APP_ADMIN','ผู้ดูแลระบบ (UAT)'],['lab','LAB_STAFF','เจ้าหน้าที่ห้องปฏิบัติการ (UAT)'],['lab2','LAB_STAFF','เจ้าหน้าที่ห้องปฏิบัติการ 2 (UAT)'],
 ['certifier','LAB_CERTIFIER','ผู้รับรองผล (UAT)'],['approver','CLINICAL_APPROVER','ผู้อนุมัติทางคลินิก (UAT)'],['anc','ANC_NURSE','พยาบาล ANC (UAT)'],['auditor','AUDITOR','ผู้ตรวจสอบ (UAT)']] as const;
type Dirs={base:string;files:string;share:string;fixtures:string;approved:string};
const tx=async<T>(db:Queryable,fn:(t:Queryable)=>Promise<T>)=>{await db.query('BEGIN');try{const r=await fn(db);await db.query('COMMIT');return r;}catch(e){await db.query('ROLLBACK');throw e;}};
const bangkokDay=(d=new Date())=>new Date(d.getTime()+7*3600000).toISOString().slice(0,10).replaceAll('-','');

export async function seedUat(db:Queryable,dirs:Dirs){
 const database=(await db.query<{d:string}>('SELECT current_database() d')).rows[0].d;
 if(database!==UAT_DATABASE||!/^https:\/\/127\.0\.0\.1:\d+$/.test(process.env.APP_ORIGIN??''))throw Error('UAT_SEED_TARGET_REFUSED');
 if((await db.query("SELECT 1 FROM audit_chain WHERE action='TASK3_UAT_SEEDED'")).rows.length)return {seeded:false};
 // An interrupted seed is never patched up in place: the synthetic UAT volume is reset (compose down -v for this project) and seeded again.
 if((await db.query("SELECT 1 FROM app_user WHERE username='admin'")).rows.length)throw Error('UAT_PARTIAL_SEED_RESET_REQUIRED');
 // 1. Accounts (username = password, loopback synthetic UAT only) and the LOCAL UAT unit.
 const ids:Record<string,string>={};
 for(const [name,,display] of UAT_ACCOUNTS){ids[name]=(await db.query<{id:string}>('INSERT INTO app_user(username,display_name,password_hash) VALUES($1,$2,$3) RETURNING id',[name,display,await argon2.hash(name,ARGON_OPTIONS)])).rows[0].id;}
 for(const [name,role] of UAT_ACCOUNTS)await db.query('INSERT INTO role_assignment(user_id,role,approved_by) VALUES($1,$2,$3)',[ids[name],role,role==='LAB_CERTIFIER'?ids.approver:null]);
 const unit=(await db.query<{id:string}>("INSERT INTO unit(code,name) VALUES('LOCAL_UAT_ANC','ANC ทดสอบ (UAT)') RETURNING id")).rows[0].id;
 await db.query('INSERT INTO user_unit_scope(user_id,unit_id) VALUES($1,$2)',[ids.anc,unit]);
 const P=(n:string,role:string,units:string[]=[])=>({id:ids[n],roles:[role],unitIds:units,permissions:[]}) as unknown as Principal;
 const admin=P('admin','APP_ADMIN'),lab=P('lab','LAB_STAFF'),certifier=P('certifier','LAB_CERTIFIER'),approver=P('approver','CLINICAL_APPROVER');
 const store=new FileStore(dirs.files),lookupKey=readFileSync(process.env.IDENTITY_LOOKUP_KEY_FILE!);
 // 2. HIS share (inbound PET, outbound RES/PDF/OK) on a local folder only, and settings through the normal maker-checker.
 for(const sub of ['inbound','res','pdf','backup','results'])await mkdir(path.join(dirs.share,sub),{recursive:true});
 const activate=async(user:Principal,key:string,value:unknown)=>tx(db,async t=>{const id=await proposeSetting(t,user,key,value,'TASK3 integrated UAT setup');await validateSetting(t,user,id,async()=>true);
  if(SETTINGS[key as keyof typeof SETTINGS].risk!=='GENERAL')await approveSetting(t,approver,id);await activateSetting(t,SETTINGS[key as keyof typeof SETTINGS].risk==='GENERAL'?user:approver,id);});
 await activate(admin,'his_inbound',{...SETTINGS.his_inbound.default,enabled:true,basePath:path.join(dirs.share,'inbound'),intervalSeconds:15,lookbackDays:30});
 await activate(admin,'his_outbound',{...SETTINGS.his_outbound.default,enabled:true,target:'AUTHORIZED_SHARE',productionAuthorized:true,resultStyle:'short',resDestinationPath:path.join(dirs.share,'res'),pdfDestinationPath:path.join(dirs.share,'pdf'),
  backupPath:path.join(dirs.share,'backup'),resProfile:{...syntheticProfile,syntheticOnly:false,version:'SYNTHETIC-TASK3-UAT'},certifierHisMappings:{[ids.certifier]:'UAT^CERTIFIER'}});
 await activate(certifier,'result_management',{...SETTINGS.result_management.default,linkageMode:'UNIQUE_AUTO_LINK'});
 // Synthetic UAT approval so the native pathway can be exercised end to end. It is NOT a clinical clearance (see approvalReference).
 await activate(certifier,'report_interpretation',{...SETTINGS.report_interpretation.default,interpretationApproved:true,singletonApprovedProduct:'HNZ0011',twinApprovedProduct:'HNZ0011',approvalReference:'SYNTHETIC-UAT-ONLY-NOT-A-CLINICAL-APPROVAL'});
 // 3. Report signers (synthetic signatures) verified by the administrator; the staff signer delegates "Reported by" to the certifier.
 for(const [user,name,license,seed] of [[lab,'UAT Reporter Synthetic','99001',1],[certifier,'UAT Approver Synthetic','99002',2]] as const){
  const p=await tx(db,t=>submitSignerProfile(t,user,store,{legalName:name,mtLicenseNo:license,signature:signaturePng(seed)}));
  await tx(db,t=>decideSignerProfile(t,admin,{profileId:p.id,decision:'VERIFY',reason:'UAT synthetic identity and licence checked'}));}
 await tx(db,t=>grantDelegation(t,lab,{granteeId:ids.certifier,roles:['REPORTED'],authorityReference:'UAT-SYNTHETIC-SIGNATURE-DELEGATION'}));
 // 4. Six received LAB cases in one Owner batch through actual pooling and the dual NIFTY/HALOS export.
 const doctor=await tx(db,t=>doctorAction(t,lab,{action:'save',doctorKey:'UAT-TASK3-DOCTOR',name:'แพทย์ทดสอบ UAT',unitId:unit,vector:{width:600,height:200,strokes:[[[10,10],[40,30],[90,12]]]}})) as {id:string};
 const specs=[{key:'A1',ln:'2629870101',hn:'6999010100',pregnancy:'Singleton',want:'Want',sheet:1,scenario:'Normal Singleton — READY'},{key:'A2',ln:'2629870102',hn:'6999010200',pregnancy:'Singleton',want:'Want',sheet:1,scenario:'T21 High Risk — READY (abnormal)'},
  {key:'A3',ln:'2629870103',hn:'6999010300',pregnancy:'Twins',want:'Want',sheet:2,scenario:'Twin — READY (Y chromosome)'},{key:'A4',ln:'2629870104',hn:'6999010400',pregnancy:'Singleton',want:null,sheet:2,scenario:'No fetal-sex wish recorded — HOLD'},
  {key:'A5',ln:'2629870105',hn:'6999010500',pregnancy:'Singleton',want:'Want',sheet:3,scenario:'ML21 + Rerun advice — HOLD'},{key:'A6',ln:'2629870106',hn:'6999010600',pregnancy:'Singleton',want:'Want',sheet:3,scenario:'External ReadyGen PDF (outage fallback) + มีผลใน HIS แล้ว'}] as const;
 const b=await tx(db,t=>batch.createBatch(t,lab)),batchId=b.batchId,version=async()=>(await db.query<{version:number}>('SELECT version FROM lab_batch WHERE id=$1',[batchId])).rows[0].version;
 const day=bangkokDay(new Date(Date.now()-86400000)),cases:{key:string;ln:string;hn:string;caseId:string;roundId:string;attemptId:string;printed:string;vendor:string;pregnancy:string;scenario:string}[]=[];
 const edd=new Date(Date.parse(`${day.slice(0,4)}-${day.slice(4,6)}-${day.slice(6,8)}T00:00:00Z`)+(280-125)*86400000).toISOString().slice(0,10);
 for(const s of specs){
  const r=await tx(db,t=>registerP2(t,lab,{ln:s.ln,hn:s.hn,unitId:unit,origin:'LAB_DIRECT',idempotencyKey:'task3_uat_'+s.key.toLowerCase()+'_'+randomUUID().slice(0,8),labOperational:{gaWeeks:17,gaDays:6,edd,pregnancy:s.pregnancy,paperRequest:true,paperConsent:true,doctorVersionId:doctor.id}},lookupKey,{store}));
  const bytes=operationalTestPetBytes({ln:s.ln,hn:s.hn,day,time:'090000'}),pet=parsePet(bytes,s.ln+'-7.pet');await store.put(bytes);
  await tx(db,async t=>{const file=(await t.query<{id:string}>("INSERT INTO his_inbound_file(sha256,state,filename,ln,parsed) VALUES($1,'Ready',$2,$3,$4) RETURNING id",[pet.hash,pet.filename,s.ln,JSON.stringify(pet)])).rows[0];
   const target=(await t.query<{case_ln_id:string;case_id:string;origin:'LAB_DIRECT'}>('SELECT l.id case_ln_id,l.case_id,c.registration_origin origin FROM case_ln l JOIN nipt_case c ON c.id=l.case_id WHERE l.case_id=$1',[r.caseId])).rows[0];await applyS1(t,file,pet,target,'AUTOMATIC');});
  const a=(await db.query<{id:string;round_id:string}>('SELECT id,round_id FROM analytical_attempt WHERE case_id=$1',[r.caseId])).rows[0];
  // The paper Request (verified) carries EDD and the documented fetal-sex wish, as the LAB staff would record it.
  if(s.want)await db.query("INSERT INTO p2_paper_review(case_id,round_id,kind,template_version,document_reference,panel,status,location,reason,verifier_id) VALUES($1,$2,'REQUEST','SYNTHETIC-FM01-v1','UAT-PAPER-REQUEST',$3,'Verified','LAB UAT','UAT paper request verified',$4)",
   [r.caseId,a.round_id,JSON.stringify({requestComplete:'Complete',decision:null,signatures:null,representative:null,history1to5:'AllNo',ga:'Over10to18',bmi:'AtMost40',conditionA:'NotApplicable',conditionB:'NotApplicable',vanishingTwin:'None',pregnancyType:s.pregnancy,fetalSex:s.want,collectionDate:null,dob:'1996-03-31',edd}),ids.certifier]);
  await tx(db,async t=>batch.assignToBatch(t,lab,{batchId,expectedVersion:await version(),attemptIds:[a.id],sheetNumber:s.sheet}));
  cases.push({key:s.key,ln:s.ln,hn:s.hn,caseId:r.caseId!,roundId:a.round_id,attemptId:a.id,printed:'',vendor:'',pregnancy:s.pregnancy,scenario:s.scenario});
 }
 for(let sheet=1;sheet<=3;sheet++){await tx(db,async t=>batch.updateSheetPlan(t,lab,{batchId,expectedVersion:await version(),sheetNumber:sheet,plannedWorkDate:`${day.slice(0,4)}-${day.slice(4,6)}-${day.slice(6,8)}`,plannedOperator:'UAT LAB',plannedExtractionLot:null,plannedExtractionExpiry:null,plannedLibraryLot:null,plannedLibraryExpiry:null}));
  await tx(db,async t=>batch.planCheck(t,lab,{batchId,expectedVersion:await version(),sheetNumber:sheet,confirm:{controlsAtTemplate:true,identifiersMatch:true,noDuplicates:true}}));await tx(db,async t=>batch.finalizeSheet(t,lab,{batchId,expectedVersion:await version(),sheetNumber:sheet}));}
 const deps={master:readFileSync(process.env.NIPT_TASK_MASTER_PATH!),store,render:async()=>{throw Error('NATIVE_RENDER_NOT_USED_BY_SEED');}},w=await tx(db,t=>benchWorkspace(t,lab,batchId,deps)),values={...w.values};
 for(const s of w.slots)if(s.kind!=='EMPTY')values[`slot.${s.slot}.libraryQc`]=s.kind==='BLANK'?0.5:20;
 for(let n=1;n<=3;n++)for(const k of ['standard1','standard2','standard2Concentration'])values[`qc.${n}.${k}`]=10;
 Object.assign(values,{'pool.standard1':0,'pool.standard2':100,'pool.standard2Concentration':10,'pool.concentration':3.33});
 for(const field of w.seqFields)values[field.key]=field.type==='number'?10:field.type==='checkbox'?true:'UAT observation';
 Object.assign(values,{'seq.date':`${day.slice(6,8)}/${day.slice(4,6)}/${Number(day.slice(0,4))+543}`,'seq.operator':'UAT LAB','seq.dnbId':'DNB'+day,'seq.negativePressureKpa':-80});
 await tx(db,async t=>saveWorkbookDraft(t,lab,{batchId,expectedVersion:await version(),expectedRevision:0,values},deps));
 await tx(db,t=>benchExport(t,lab,{batchId,revision:1,kind:'POOL_CSV'},deps));
 await tx(db,t=>recordActualPooling(t,lab,{batchId,revision:1,members:w.slots.map(s=>({slot:s.slot,pooled:['PATIENT','PC','NC'].includes(s.kind)})),note:'UAT actual pooling transfer recorded by operator'},deps));
 const pair=await tx(db,t=>exportSeqPair(t,lab,{batchId,revision:1,idempotencyKey:randomUUID()},deps));
 for(const c of cases){c.printed=(await db.query<{p:string}>('SELECT printed_sample_id p FROM analytical_attempt WHERE id=$1',[c.attemptId])).rows[0].p;
  c.vendor=(await db.query<{v:string}>("SELECT m->>'vendorSampleId' v FROM lab_bench_export n CROSS JOIN LATERAL jsonb_array_elements(n.mapping) m WHERE n.kind='NIFTY_XLSX' AND m->>'attemptId'=$1",[c.attemptId])).rows[0].v;}
 const controls=(await db.query<{s:string}>("SELECT m->>'sampleId' s FROM lab_bench_export h CROSS JOIN LATERAL jsonb_array_elements(h.mapping) m WHERE h.kind='HALOS_TASK_XLSX' AND m->>'attemptId' IS NULL")).rows.map(r=>r.s);
 // 5. Files for the Owner to use through the UI: the HALOS result workbook and the external ReadyGen-style PDF of A6.
 await mkdir(dirs.fixtures,{recursive:true});
 const by=(k:string)=>cases.find(c=>c.key===k)!,result:HalosSpec[]=[{sample:controls[0],t13:'TH13',t18:'TH18',t21:'TH21',sex:''},{sample:by('A1').printed,gender:'Female'},{sample:by('A2').printed,t21:'TH21',gender:'Male',ff:'11.2'},
  {sample:by('A3').printed,gender:'Male',ff:'12.35'},{sample:by('A4').printed,gender:'Female'},{sample:by('A5').printed,t21:'ML21',advice:'Rerun',gender:'Male'},{sample:by('A6').printed,gender:'Female'},{sample:controls[1],sex:''},{sample:'99B999999999-1',gender:'Male'}];
 const halos=halosWorkbook({result,repeat:[{sample:by('A5').printed.replace(/-1$/,'-0'),t21:'ML21',advice:'Rerun',chip:'S990000000',gender:'Male'}],sampleinfo:cases.map(c=>({id:c.vendor,fetus:c.pregnancy,ga:'17,6'}))});
 await writeFile(path.join(dirs.fixtures,'Sample analysis data_S990000001_UAT.xlsx'),halos);
 const collection=`${day.slice(6,8)}-${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][Number(day.slice(4,6))-1]}-${day.slice(0,4)}`;
 const external=syntheticReportPdf({kind:'SINGLETON',labNumber:by('A6').printed,hn:by('A6').hn,dob:'31-Mar-1996',collection,received:collection,reported:collection,gaWeeks:17,gaDays:6,sex:'Female',qc:'PASS'});
 await writeFile(path.join(dirs.fixtures,`${by('A6').ln}_UAT-READYGEN-OFFLINE_Chonburi hospital.pdf`),external);
 // 6. Task 1.5: three more patients only as HIS PET/OK in the inbound share, to register by LN or HN in the LAB registration screen.
 const today=bangkokDay();await mkdir(path.join(dirs.share,'inbound',today),{recursive:true});
 const registration=[['2629870201','6999020100'],['2629870202','6999020200'],['2629870203','6999020300']];
 for(const [ln,hn] of registration){await writeFile(path.join(dirs.share,'inbound',today,`${ln}-7.pet`),operationalTestPetBytes({ln,hn,day:today}));await writeFile(path.join(dirs.share,'inbound',today,`${ln}-7.ok`),Buffer.alloc(0));}
 await tx(db,t=>appendAudit(t,{actorId:ids.admin,action:'TASK3_UAT_SEEDED',resourceType:'SYSTEM',details:{outcome:'SEEDED',count:cases.length}}));
 const manifest={database,generatedAt:new Date().toISOString(),batchId,exportPairId:pair.id,cases:cases.map(c=>({key:c.key,ln:c.ln,hn:c.hn,halosSampleId:c.printed,pregnancy:c.pregnancy,scenario:c.scenario})),
  controls,unmatched:'99B999999999-1',registrationPet:registration.map(([ln,hn])=>({ln,hn,day:today})),fixtures:['Sample analysis data_S990000001_UAT.xlsx',`${by('A6').ln}_UAT-READYGEN-OFFLINE_Chonburi hospital.pdf`]};
 await writeFile(path.join(dirs.base,'uat-fixture.json'),JSON.stringify(manifest,null,2));
 return {seeded:true,manifest};
}
