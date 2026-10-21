import {it,expect,afterEach,vi} from 'vitest';
import {randomUUID,createHash} from 'node:crypto';
import {resultFixture,importReport,rowVersion,pdfDate} from '../helpers/results';
import {poolingFixture,POOL_SCENARIO} from '../helpers/pooling';
import {docDeps,version} from '../helpers/lab';
import type {Queryable} from '../../packages/db/connection';
import type {Principal} from '../../packages/security/policy';
import * as pool from '../../packages/pooling/service';
import * as seq from '../../packages/sequencing/service';
import * as results from '../../packages/results/service';
import {exportAcceptedPool,verifyOperationalHalos} from '../../packages/pooling/halos';
import {BARCODE_ORDER} from '../../packages/halos-export/contract';
import {bangkokToday} from '../../packages/lab/core';
import {setModes,approveClinicalP2,paperReview} from '../../packages/p2/service';
import {applyS1} from '../../packages/inbound/process';
import {buildSyntheticPet} from '../../packages/inbound/wire';
import {parsePet} from '../../packages/integrations/pet';
import {receiveS1} from '../helpers/lab';
import {reserveReleasedResult} from '../../packages/p6/released-result';
import {runTransfer} from '../../packages/p6/worker';
import {workerServiceAccount} from '../../packages/integrations/authorized-share';
import {SETTINGS} from '../../packages/settings/catalog';
import {syntheticProfile} from '../../packages/p6/res';
import {proposeSetting,validateSetting,approveSetting,activateSetting} from '../../packages/settings/service';
import * as fs from 'node:fs/promises';
import {existsSync,readFileSync} from 'node:fs';
import {workbookWorkspace,saveWorkbookDraft} from '../../packages/workbook/service';
import {issueNativeWorkbook} from '../../packages/workbook/controlled';
import {SHEETS} from '../../packages/workbook/master';
import {issueSyntheticDocument,readF4} from '../../packages/pooling/documents';
import {issueF5} from '../../packages/sequencing/documents';
import path from 'node:path';
import {addUser} from '../helpers/database';
import {syntheticReportPdf} from '../../tools/his-simulator/result-pdf';
afterEach(()=>vi.unstubAllEnvs());
// Owner P5-A/P5-B (2026-10-18): the same journey through the one-click auto-match proposal and the single "ตรวจรับ PDF และยืนยันส่งผล".
it.each(['MANUAL_STEPS','OWNER_P5_SINGLE_CONFIRMATION','CASE_PAGE_UPLOAD'] as const)('accepted operational Pool → real XLSX/readback → DNB/QC3 → verified observed import → sequence/QC4 → external PDF/QC5 → same reviewer certification creates one release and completion event (%s)',async mode=>{
 const f=await resultFixture(),docs=await docDeps();
 try{
  const hn='990000000999';
  const lab=await poolingFixture(f.db,f.u,docs.deps,45,async(db,c,index)=>{
   if(index!==0)return receiveS1(db,c,new Date(Date.now()-(45-index)*60000));
   const petSource=buildSyntheticPet({ln:c.ln,hn,receivedAt:'20261013100000',specimenAt:'20261010070000',dob:'19960331'}),pet=parsePet(petSource.bytes,petSource.filename);
   await f.store.put(petSource.bytes);
   const file=(await db.query<{id:string}>("INSERT INTO his_inbound_file(sha256,state,filename,ln) VALUES($1,'Ready',$2,$3) RETURNING id",[pet.hash,pet.filename,c.ln])).rows[0];
   await applyS1(db,file,pet,{case_ln_id:c.lnId,case_id:c.caseId,origin:'ANC'},'AUTOMATIC');
  }),c=lab.cases[0],a=lab.attempts[0];
  const payload={draft:{patient:{dob:'1996-03-31'},pregnancy:{type:'Singleton',edd:'2027-04-22',fetalSex:'Want'}}};
  await f.db.query('INSERT INTO p2_case_identity(case_id,hn) VALUES($1,$2)',[c.caseId,hn]);
  await f.db.query("INSERT INTO p2_document_revision(case_id,round_id,kind,version,template_version,payload,content_hash,reason,created_by) VALUES($1,$2,'REQUEST',1,'SYNTHETIC-FM01-v1',$3,$4,'SYNTHETIC_TEST_SETUP',$5)",[c.caseId,c.roundId,JSON.stringify(payload),createHash('sha256').update(JSON.stringify(payload)).digest('hex'),f.u.staff.id]);
  vi.stubEnv('NIPT_MODE','operational');vi.stubEnv('APP_ORIGIN','https://nipt.test');await f.db.query("UPDATE nipt_runtime_config SET mode='operational'");
  await f.run(t=>setModes(t,f.u.staff,c.caseId,{expectedVersion:0,requestMode:'Paper',consentMode:'Paper',reason:'Use verified paper originals'}));
  const paper=(await f.db.query<{panel:Record<string,unknown>}>("SELECT panel FROM p2_paper_review WHERE round_id=$1 AND kind='REQUEST' ORDER BY created_at DESC LIMIT 1",[c.roundId])).rows[0].panel;
  await f.run(t=>paperReview(t,f.u.certifier,c.caseId,{kind:'REQUEST',templateVersion:'CBH-FM01-v1',documentReference:'LOCAL TEST PAPER ORIGINAL',location:'LOCAL TEST DOCUMENT STORE',reason:'LOCAL TEST recorded birth and due dates',operation:'Review',previousId:null,panel:{...paper,dob:'1996-03-31',edd:'2027-04-22',collectionDate:'2026-10-10',fetalSex:'Want'}}));
  await f.run(t=>approveClinicalP2(t,f.u.approver,c.caseId,{expectedVersion:1,reason:'Clinical review of current verified request and granted consent',sourceReference:'Controlled request original reviewed',attestation:true}));
  const p=await f.run(async t=>pool.createPool(t,f.u.staff,{batchId:lab.batchId,expectedVersion:await version(t,lab.batchId),scenario:{...POOL_SCENARIO,controls:'PATIENT_PC_NC'},reason:'Operational pooling from current QC1'}));
  type Op=(db:Queryable,user:Principal,input:unknown)=>Promise<unknown>;
  const pc=(fn:Op,data:Record<string,unknown>={},user=f.u.staff)=>f.run(async t=>fn(t,user,{batchId:lab.batchId,poolId:p.id,expectedVersion:await version(t,lab.batchId),...data}));
  const source=(await f.db.query<pool.PoolRow>('SELECT * FROM p4b_pool_attempt WHERE id=$1',[p.id])).rows[0];
  await pc(pool.crosscheck,{values:source.selected_slots.map(slot=>({slot,value:source.payload.calculation.rows.find(r=>r.slot===slot)!.planned}))});
  await pc(pool.transition,{transition:'START',reason:'Verified manual crosscheck completed'});
  for(const m of source.payload.members)await pc(pool.recordPoolObservation,{field:'TRANSFER',slot:m.slot,value:{checked:true},source:'DIRECT_ENTRY'});
  await pc(pool.recordPoolObservation,{field:'BUFFER',value:{value:source.payload.calculation.plannedBuffer,unit:'uL'},source:'DIRECT_ENTRY'});
  await pc(pool.transition,{transition:'END',reason:'Actual transfer work completed'});
  for(const field of ['QC2','STD1','STD2'])await pc(pool.recordPoolObservation,{field,value:{value:'20',unit:'ng/uL'},source:'DIRECT_ENTRY'});
  for(const o of await pool.observations(f.db,p.id))await pc(pool.reviewPoolObservation,{observationId:o.id,result:'Confirmed',note:'Observed evidence reviewed against controlled record'},f.u.certifier);
  const accepted=await pc(pool.operationalGate,{criteriaReference:'WI-T-BM19 current controlled copy',reason:'QC2 and current execution evidence reviewed'},f.u.certifier) as {snapshotId:string};
  const members=source.payload.members.map((m,i)=>({memberKey:m.attemptId??`${m.kind}:${m.slot}`,physicalPosition:m.slot,role:m.kind,exportSampleId:m.printedSampleId??m.printedControlId!,printedSampleId:m.printedSampleId??m.printedControlId!,lnHalos:m.lnHalos??`CONTROL-${m.slot}`,barcodeIndex:BARCODE_ORDER[i],barcodeType:'OWNER_REVIEWED_MAPPING'}));
  const x=await f.run(async t=>exportAcceptedPool(t,f.u.staff,{batchId:lab.batchId,poolSnapshotId:accepted.snapshotId,expectedVersion:await version(t,lab.batchId),dnbDate:bangkokToday(),mappingReference:'Owner reviewed mapping version one',members},f.store));
  expect(x.bytes.subarray(0,2).toString()).toBe('PK');
  const created=await f.run(async t=>seq.createDnb(t,f.u.staff,{batchId:lab.batchId,poolSnapshotId:accepted.snapshotId,expectedVersion:await version(t,lab.batchId),requestId:randomUUID(),purpose:'OPERATIONAL',actualDate:bangkokToday(),reason:'Current accepted pool DNB preparation',preparation:{method:'CONTROLLED_PROTOCOL',operatorId:f.u.staff.id,equipmentId:'PREP-01',lots:[{name:'DNB reagent',lot:'LOT-01',expiry:'2099-01-01'}],qubitSamples:47,preclean:true,loadingReagentPrepared:true,protocolEvidence:{reference:'Controlled WI-T-BM19 protocol',sha256:'a'.repeat(64)}}}));
  const sc=(fn:Op,data:Record<string,unknown>={},user=f.u.staff)=>f.run(async t=>fn(t,user,{batchId:lab.batchId,dnbId:created.id,expectedVersion:await version(t,lab.batchId),requestId:randomUUID(),...data}));
  await sc(seq.transition,{transition:'DNB_START',reason:'Preparation evidence verified'});await sc(seq.transition,{transition:'DNB_END',reason:'DNB product preparation completed'});
  for(const field of ['STD1','STD2','QC3'])await sc(seq.recordObservation,{field,value:'20',unit:'ng/uL',source:'DIRECT_ENTRY'});
  for(const o of await seq.observations(f.db,created.id!))await sc(seq.reviewObservation,{observationId:o.id,result:'Confirmed',note:'Reviewed current standard and sample measurement'},f.u.certifier);
  await sc(seq.decideQc3,{decision:'Accepted',criteriaVersion:'WI-T-BM19 controlled QC3 review',reason:'Measured DNB and standards accepted'},f.u.certifier);
  const run=await sc(seq.createSequencing,{purpose:'OPERATIONAL',equipmentModel:'DNBSEQ-G50',equipmentId:'G50-01',sequencingId:'RUN-01',cartridgeId:'CARTRIDGE-01',flowCellId:'FLOW-01',idSource:'SCAN',barcodeType:'OWNER_REVIEWED_MAPPING',barcodeRange:{from:1,to:48},recipe:'FCL-SE35',configuration:{readMode:'SE',readCycles:35,barcodeCycles:10,assay:'NIPT'},pressureKpa:'-81',diskSpaceGb:'501',wash:{lot:'WASH-01',preparedOn:bangkokToday(),expiry:'2099-01-01',preWash:true},reason:'Observed sequencing setup'}) as {id:string};
  await expect(sc(seq.transitionSequencing,{sequencingId:run.id,transition:'SEQUENCE_START',reason:'Attempt before import review'})).rejects.toThrow('HANDOFF_VERIFICATION_REQUIRED');
  await f.run(async t=>verifyOperationalHalos(t,f.u.certifier,{batchId:lab.batchId,exportId:x.id,expectedVersion:await version(t,lab.batchId),fileHash:x.fileHash,observedDnbId:`DNB${bangkokToday().replaceAll('-','')}`,observedRows:members,evidenceReference:'TEST DATA observed import evidence',evidenceHash:'b'.repeat(64)}));
  await sc(seq.transitionSequencing,{sequencingId:run.id,transition:'SEQUENCE_START',reason:'Reviewed import exact members and DNB date'});
  await sc(seq.transitionSequencing,{sequencingId:run.id,transition:'SEQUENCE_END',reason:'Observed sequencing completed',firstCycle:{loadedDnb:'100',q30:'90',bic:'90',fit:'90'},postWash:true});
  const qc4={sequencingId:run.id,lane:'L01',metrics:{totalReads:'100000',uniqueReads:'90000',q30:'90',gcPercent:'40',fetalFraction:'10',dim:'1'},source:'DIRECT_ENTRY',evidenceHash:'c'.repeat(64)};
  await sc(seq.recordQc4,{...qc4,scope:'LANE'});for(const m of members)await sc(seq.recordQc4,{...qc4,scope:'SAMPLE',memberKey:m.memberKey});
  for(const o of (await seq.qc4Evidence(f.db,created.id!,run.id)).observations)await sc(seq.reviewQc4,{qc4Id:o.id,result:'Accepted',criteriaVersion:'WI-T-BM20-21 controlled QC4 review',note:'Reviewed observed sequencing quality metrics'},f.u.certifier);
  const masterPath=process.env.NIPT_TASK_MASTER_PATH??'.local/lab-owner-evidence/lab-combined-master.xlsx';
  if(existsSync(masterPath)){
   const workbook=await f.run(t=>workbookWorkspace(t,f.u.staff,lab.batchId,{master:readFileSync(masterPath),store:f.store,render:async()=>{throw Error('NATIVE_EXPORT_NOT_REQUESTED');}}));
   expect(workbook.automaticValues).toMatchObject({'seq.dnbId':(await seq.getDnb(f.db,lab.batchId,created.id!)).dnb_label,'seq.standard1':20,'seq.standard2':20,'seq.dnbConcentration':20,'seq.loadedDnb':100,'seq.q30':90,'pool.concentration':20});
  }
  await sc(seq.transitionSequencing,{sequencingId:run.id,transition:'ANALYSIS_COMPLETE',reason:'External analysis completion reviewed'});
  if(existsSync(masterPath)){
   // Native authority/ledger test with a stub PDF port. Actual Excel rendering is verified separately by the native browser journey.
   const deps={master:readFileSync(masterPath),store:f.store,render:async()=>SHEETS.map(sheet=>{const bytes=Buffer.from('%PDF-1.4\n% LOCAL LEDGER TEST '+sheet);return {sheet,bytes,sha256:createHash('sha256').update(bytes).digest('hex'),pageCount:1,pages:[],formulaCount:0,formulaErrors:[],poolingCalculation:null,renderer:'Microsoft Excel' as const,goldenFidelityVerified:false as const,nativeCoordinateScale:1};})};
   const workspace=await f.run(t=>workbookWorkspace(t,f.u.staff,lab.batchId,deps));
   await f.run(t=>saveWorkbookDraft(t,f.u.staff,{batchId:lab.batchId,expectedVersion:workspace.version,expectedRevision:workspace.draft?.revision??0,values:{...workspace.values,'pool.dilutionC1':20}},deps));
   const native={store:f.store,render:async()=>{throw Error('LEGACY_RENDERER_MUST_NOT_RUN');},native:(t:Queryable,user:Principal,input:Parameters<typeof issueNativeWorkbook>[2])=>issueNativeWorkbook(t,user,input,deps)};
   await f.run(async t=>issueSyntheticDocument(t,f.u.staff,{batchId:lab.batchId,poolId:p.id,expectedVersion:await version(t,lab.batchId),kind:'COMPLETED',purpose:'OPERATIONAL'},native,true));
   const edited=await f.run(t=>workbookWorkspace(t,f.u.staff,lab.batchId,deps));
   await f.run(t=>saveWorkbookDraft(t,f.u.staff,{batchId:lab.batchId,expectedVersion:edited.version,expectedRevision:edited.draft!.revision,values:{...edited.values,'pool.dilutionC1':10}},deps));
   await expect(f.run(async t=>issueSyntheticDocument(t,f.u.staff,{batchId:lab.batchId,poolId:p.id,expectedVersion:await version(t,lab.batchId),kind:'COMPLETED',purpose:'OPERATIONAL'},native))).rejects.toThrow('CURRENT_PREVIEW_REQUIRED');
   await f.run(async t=>issueSyntheticDocument(t,f.u.staff,{batchId:lab.batchId,poolId:p.id,expectedVersion:await version(t,lab.batchId),kind:'COMPLETED',purpose:'OPERATIONAL'},native,true));
   const issued=await f.run(async t=>issueSyntheticDocument(t,f.u.staff,{batchId:lab.batchId,poolId:p.id,expectedVersion:await version(t,lab.batchId),kind:'COMPLETED',purpose:'OPERATIONAL'},native));
   expect((await f.run(t=>readF4(t,f.u.staff,issued.id!,native))).status).toBe('ISSUED');
   await expect(pc(pool.recordPoolObservation,{field:'QC2',value:{value:'99',unit:'ng/uL'},source:'DIRECT_ENTRY'})).rejects.toThrow('POOL_ACCEPTED_IMMUTABLE');
   await f.run(async t=>issueF5(t,f.u.staff,{batchId:lab.batchId,dnbId:created.id,expectedVersion:await version(t,lab.batchId),kind:'COMPLETED',purpose:'OPERATIONAL'},native,true));
   await f.run(async t=>issueF5(t,f.u.staff,{batchId:lab.batchId,dnbId:created.id,expectedVersion:await version(t,lab.batchId),kind:'COMPLETED',purpose:'OPERATIONAL'},native));
  }
  const attempt=(await f.db.query<{printed_sample_id:string}>('SELECT printed_sample_id FROM analytical_attempt WHERE id=$1',[a.id])).rows[0];
  const spec={kind:'SINGLETON' as const,labNumber:attempt.printed_sample_id,hn,collection:pdfDate('2026-10-10')};
  let versionId:string;
  if(mode==='CASE_PAGE_UPLOAD'){
   // Owner 2026-10-18 fallback channel: upload from the patient's case page while no Worker is involved.
   const target={caseId:c.caseId,roundId:c.roundId,attemptId:a.id};
   const check=await f.run(t=>results.caseUploadCheck(t,f.u.staff,f.store,{target,name:'case-page-report.pdf',bytes:syntheticReportPdf(spec)}));
   expect(check.outcome).toBe('READY');
   const confirmed=await f.run(t=>results.caseUploadConfirm(t,f.u.staff,{target,intakeId:check.intakeId}));
   expect(confirmed).toMatchObject({outcome:'IMPORTED',state:'Unlinked'});versionId=confirmed.versionId;
  }else versionId=(await importReport(f,spec)).versionId;
  const rv=async()=>(await rowVersion(f,versionId)).row_version;
  let released:{outcome:string;releaseId?:string};
  if(mode==='MANUAL_STEPS'){
   await f.run(async t=>results.proposeLink(t,f.u.staff,{versionId,roundId:c.roundId,attemptId:a.id,reason:'Exact current attempt report linkage',expectedRowVersion:await rv()}));
   await f.run(async t=>results.decideLink(t,f.u.certifier,{versionId,decision:'APPROVE',reason:'Report identity and current attempt reviewed',expectedRowVersion:await rv()}));
   await f.run(async t=>results.recordReview(t,f.u.certifier,{versionId,valuesMatchPdf:true,abnormalAcknowledged:false,expectedRowVersion:await rv()}));
   await f.run(async t=>results.recordQc5(t,f.u.certifier,{versionId,expectedRowVersion:await rv(),criteriaReference:'Controlled QC5 final result review',templateReviewed:true,disclosureReviewed:true,abnormalAcknowledged:false,reason:'Current PDF and upstream QC evidence accepted'})).catch(error=>{throw Error(JSON.stringify(error.details??error.message));});
   const input={versionId,idempotencyKey:randomUUID().replaceAll('-',''),abnormalAcknowledged:false,expectedRowVersion:await rv(),confirmed:true};
   released=await f.run(t=>results.certifyAttempt(t,f.u.certifier,input));expect(released.outcome).toBe('CertifiedReleased');
   expect((await f.run(t=>results.certifyAttempt(t,f.u.certifier,input))).outcome).toBe('CertifiedReleased');
  }else if(mode==='CASE_PAGE_UPLOAD'){
   await f.run(async t=>results.decideLink(t,f.u.certifier,{versionId,decision:'APPROVE',reason:'Case-page upload identity confirmed',expectedRowVersion:await rv()}));
   const base={versionId,idempotencyKey:randomUUID().replaceAll('-',''),externalFinalCertified:true,identityAndValuesMatchPdf:true,disclosureReviewed:true,abnormalAcknowledged:false};
   released=await f.run(async t=>results.acceptAndRelease(t,f.u.certifier,{...base,expectedRowVersion:await rv()}));expect(released.outcome).toBe('CertifiedReleased');
  }else{
   // P5-A: the unambiguous match is offered and proposed in one click; the second person still approves; nothing is released.
   const detail=await f.run(t=>results.versionDetail(t,f.u.staff,versionId));
   expect(detail.autoMatch).toMatchObject({roundId:c.roundId,attemptId:a.id});
   await f.run(async t=>results.proposeAutoMatch(t,f.u.staff,{versionId,expectedRowVersion:await rv()}));
   expect((await f.db.query<{n:number}>('SELECT count(*)::int n FROM result_release')).rows[0].n).toBe(0);
   await expect(f.run(async t=>results.decideLink(t,f.u.staff,{versionId,decision:'APPROVE',reason:'Same person must not approve',expectedRowVersion:await rv()}))).rejects.toThrow();
   await f.run(async t=>results.decideLink(t,f.u.certifier,{versionId,decision:'APPROVE',reason:'Auto-matched identity confirmed',expectedRowVersion:await rv()}));
   // P5-B: one confirmation records review + QC5 + certification; the gates still run (missing confirmation is refused).
   const base={versionId,idempotencyKey:randomUUID().replaceAll('-',''),externalFinalCertified:true,identityAndValuesMatchPdf:true,disclosureReviewed:true,abnormalAcknowledged:false};
   await expect(f.run(async t=>results.acceptAndRelease(t,f.u.certifier,{...base,externalFinalCertified:false,expectedRowVersion:await rv()}))).rejects.toThrow();
   await expect(f.run(async t=>results.acceptAndRelease(t,f.u.staff,{...base,expectedRowVersion:await rv()}))).rejects.toMatchObject({code:'FORBIDDEN'});
   released=await f.run(async t=>results.acceptAndRelease(t,f.u.certifier,{...base,expectedRowVersion:await rv()})).catch(error=>{throw Error(JSON.stringify(error.details??error.message));});
   expect(released.outcome).toBe('CertifiedReleased');
   expect((await f.run(async t=>results.acceptAndRelease(t,f.u.certifier,{...base,expectedRowVersion:await rv()}))).outcome).toBe('CertifiedReleased'); // replay
   expect((await f.db.query<{n:number}>('SELECT count(*)::int n FROM result_qc5_review WHERE version_id=$1',[versionId])).rows[0].n).toBe(1);
   expect((await f.db.query<{n:number}>('SELECT count(*)::int n FROM result_review WHERE version_id=$1',[versionId])).rows[0].n).toBe(1);
  }
  expect((await f.db.query<{n:number}>('SELECT count(*)::int n FROM result_release')).rows[0].n).toBe(1);
  expect((await f.db.query<{n:number}>('SELECT count(*)::int n FROM result_release_completed')).rows[0].n).toBe(1);
  // Continue the actual released row through the reused P6 journal and real isolated file transport.
  const share=path.join(f.base,'outbound');await fs.mkdir(share);for(const name of ['res','pdf','backup'])await fs.mkdir(path.join(share,name));
  const policy=path.join(f.base,'policy.json');await fs.writeFile(policy,JSON.stringify({version:1,grants:[{root:share,purposes:['OUTBOUND'],serviceAccount:workerServiceAccount(),secretRef:null,mode:'operational'}]}));vi.stubEnv('NIPT_HIS_SHARE_POLICY_FILE',policy);
  const admin=await addUser(f.db,'APP_ADMIN','test.outbound.admin');
  // Settings acceptance: the operational consumer refuses a configuration without a certifier HIS mapping or production authority.
  const destinations={...SETTINGS.his_outbound.default,enabled:true,target:'AUTHORIZED_SHARE' as const,productionAuthorized:true,resDestinationPath:path.join(share,'res'),pdfDestinationPath:path.join(share,'pdf'),backupPath:path.join(share,'backup'),resProfile:{...syntheticProfile,syntheticOnly:false as const,version:'TEST-OP-1'}};
  for(const [value,code] of [[{...destinations,certifierHisMappings:{}},'CERTIFIER_HIS_MAPPING_REQUIRED'],[{...destinations,productionAuthorized:false,certifierHisMappings:{[f.u.certifier.id]:'TESTMT^ผู้ทดสอบ'}},'OPERATIONAL_OUTBOUND_CONFIGURATION_REQUIRED']] as const){
   const id=await proposeSetting(f.db,admin,'his_outbound',value,'Operational guard probe');await validateSetting(f.db,admin,id,async()=>true);await approveSetting(f.db,f.u.approver,id);await activateSetting(f.db,f.u.approver,id);
   await expect(reserveReleasedResult(f.db,released.releaseId!,f.store)).rejects.toThrow(code);
  }
  const setting=await proposeSetting(f.db,admin,'his_outbound',{...SETTINGS.his_outbound.default,enabled:true,target:'AUTHORIZED_SHARE',productionAuthorized:true,resDestinationPath:path.join(share,'res'),pdfDestinationPath:path.join(share,'pdf'),backupPath:path.join(share,'backup'),resProfile:{...syntheticProfile,syntheticOnly:false,version:'TEST-OP-1'},certifierHisMappings:{[f.u.certifier.id]:'TESTMT^ผู้ทดสอบ'}},'Operational test destinations');
  await validateSetting(f.db,admin,setting,async()=>true);await approveSetting(f.db,f.u.approver,setting);await activateSetting(f.db,f.u.approver,setting);
  // Exercise the deployed worker privilege boundary, rather than the database owner.
  await f.db.exec(await fs.readFile('packages/db/roles.sql','utf8'));await f.db.exec(await fs.readFile('packages/p6/grants.sql','utf8'));await f.db.query('SET ROLE worker_rw');
  expect((await f.db.query<{allowed:boolean}>("SELECT has_table_privilege(current_user,'result_release','UPDATE') allowed")).rows[0].allowed).toBe(false);
  expect((await f.db.query<{allowed:boolean}>("SELECT has_function_privilege(current_user,'p6_lock_current_release(uuid,integer)','EXECUTE') allowed")).rows[0].allowed).toBe(true);
  const transfer=await reserveReleasedResult(f.db,released.releaseId!,f.store);
  expect((await reserveReleasedResult(f.db,released.releaseId!,f.store)).id).toBe(transfer.id);
  const sent=await runTransfer(f.db,transfer.id);expect(sent,JSON.stringify((await f.db.query('SELECT model FROM p6_transfer WHERE id=$1',[transfer.id])).rows)).toBe('AWAITING_CONFIRMATION');
  expect(await fs.readFile(path.join(share,'res',transfer.plan.okName))).toEqual(Buffer.from([255,254]));
  expect(await fs.readFile(path.join(share,'pdf',transfer.plan.pdfName))).toEqual(await f.store.get(transfer.plan.pdfHash));
  expect((await f.db.query<{model:{hisConfirmed:boolean}}>('SELECT model FROM p6_transfer WHERE id=$1',[transfer.id])).rows[0].model.hisConfirmed).toBe(false);await f.db.query('RESET ROLE');
 }finally{await docs.close();await f.close();}
},300000);

