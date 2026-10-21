import {readFileSync} from 'node:fs';
import {it,expect,vi} from 'vitest';
import {inboundFixture,registrar,writePet,cycle} from '../helpers/inbound';
import {tx,labUsers} from '../helpers/lab';
import {registerP2} from '../../packages/p2/service';
import {createBatch,assignToBatch,updateSheetPlan,planCheck,finalizeSheet,amendSheet,cancelBatch} from '../../packages/lab/batch';
import {workbookWorkspace,saveWorkbookDraft} from '../../packages/workbook/service';
import {benchPooling,benchExport,benchWorkspace} from '../../packages/lab/bench';
import {benchAttemptEvidence} from '../../packages/lab/bench-evidence';
it('LAB-13 bench persists per-slot QC and 9 standards, uses the saved revision for CSV, rejects stale and missing source',async()=>{
 const f=await inboundFixture();try{
  vi.stubEnv('NIPT_POOL_CSV_TEMPLATE','C:/Users/User/Downloads/Pooling Sheet Template_R001.csv');
  const checker=(await labUsers(f.db)).certifier,u=await registrar(f.db),deps={master:readFileSync('.local/lab-owner-evidence/lab-combined-master.xlsx'),store:f.store,render:async()=>{throw Error('NATIVE_RENDER_NOT_REQUESTED_BY_THIS_DB_TEST');}};
  const b=await tx(f.db,db=>createBatch(db,u.lab)),id=b.batchId;
  const version=async()=>(await f.db.query<{version:number}>('SELECT version FROM lab_batch WHERE id=$1',[id])).rows[0].version;
  for(let n=1;n<=3;n++){
   const ln='99000123456'+n,hn='990001234'+n;
   const r=await tx(f.db,db=>registerP2(db,u.lab,{ln,hn,unitId:u.unit,origin:'LAB_DIRECT',idempotencyKey:'lab_owner_bench_case_'+n,labOperational:{gaWeeks:17,gaDays:6,edd:'2027-03-24',pregnancy:'Singleton',paperRequest:true,paperConsent:true}},f.lookupKey,{store:f.store}));
   await writePet(f.root,'20261020',{ln,hn,orderAt:'20261020070000',specimenAt:'20261020080000',receivedAt:'20261020100000'});await cycle(f,{now:new Date('2026-10-20T05:00:00Z')});
   const attempt=(await f.db.query<{id:string}>('SELECT id FROM analytical_attempt WHERE case_id=$1',[r.caseId])).rows[0].id;
   await tx(f.db,async db=>assignToBatch(db,u.lab,{batchId:id,expectedVersion:await version(),attemptIds:[attempt],sheetNumber:n}));
   await tx(f.db,async db=>updateSheetPlan(db,u.lab,{batchId:id,expectedVersion:await version(),sheetNumber:n,plannedWorkDate:'2026-10-20',plannedOperator:'SYNTHETIC LAB',plannedExtractionLot:null,plannedExtractionExpiry:null,plannedLibraryLot:null,plannedLibraryExpiry:null}));
   await tx(f.db,async db=>planCheck(db,u.lab,{batchId:id,expectedVersion:await version(),sheetNumber:n,confirm:{controlsAtTemplate:true,identifiersMatch:true,noDuplicates:true}}));
   await tx(f.db,async db=>finalizeSheet(db,u.lab,{batchId:id,expectedVersion:await version(),sheetNumber:n}));
  }
  const initial=await tx(f.db,db=>benchWorkspace(db,u.lab,id,deps));expect(initial.finalized).toBe(true);
  const values={...initial.values};for(const row of initial.slots)if(['PC','NC','PATIENT'].includes(row.kind))values[`slot.${row.slot}.libraryQc`]=20;
  const save=async(revision:number)=>tx(f.db,async db=>saveWorkbookDraft(db,u.lab,{batchId:id,expectedVersion:await version(),expectedRevision:revision,values},deps));
  await save(0);await expect(tx(f.db,db=>benchPooling(db,u.lab,id,deps))).rejects.toThrow('QC_NINE_STANDARDS_REQUIRED');
  for(let strip=1;strip<=3;strip++)for(const key of ['standard1','standard2','standard2Concentration'])values[`qc.${strip}.${key}`]=strip;
  await save(1);const pool=await tx(f.db,db=>benchPooling(db,u.lab,id,deps));expect(pool.calculation.measuredCount).toBe(5);expect(pool.calculation.rows.filter(r=>r.kind==='PATIENT')).toHaveLength(3);
  const csv=await tx(f.db,db=>benchExport(db,u.lab,{batchId:id,revision:2,kind:'POOL_CSV'},deps));expect(csv.bytes.toString().split('\r\n')).toHaveLength(50);
  const patient=(await f.db.query<{id:string;round_id:string}>('SELECT a.id,a.round_id FROM analytical_attempt a JOIN lab_slot_assignment x ON x.attempt_id=a.id WHERE x.batch_id=$1 AND x.removed_at IS NULL ORDER BY x.slot_number LIMIT 1',[id])).rows[0];
  const evidence=await benchAttemptEvidence(f.db,patient.id);
  expect(evidence).toMatchObject({attemptId:patient.id,roundId:patient.round_id,batchId:id,revision:2,current:true,concentration:20,qcStandardCount:9,qcAcceptance:false});
  expect(evidence?.exports).toHaveLength(1);
  expect(await benchAttemptEvidence(f.db,crypto.randomUUID())).toBeNull();
  values['seq.operator']='SYNTHETIC LAB SEQ';await save(2);
  expect((await tx(f.db,db=>benchPooling(db,u.lab,id,deps))).sourceSha256).toBe(pool.sourceSha256);
  expect((await tx(f.db,db=>benchWorkspace(db,u.lab,id,deps))).exports[0].current).toBe(true);
  values['slot.2.libraryQc']=40;await save(3);
  await expect(tx(f.db,db=>benchExport(db,u.lab,{batchId:id,revision:2,kind:'POOL_CSV'},deps))).rejects.toThrow('TASK_DRAFT_VERSION_CONFLICT');
  const changed=await tx(f.db,db=>benchPooling(db,u.lab,id,deps));expect(changed.calculation.rows[1].volume).not.toBe(pool.calculation.rows[1].volume);
  expect((await tx(f.db,db=>benchWorkspace(db,u.lab,id,deps))).exports[0].current).toBe(false);
  expect((await workbookWorkspace(f.db,u.lab,id,deps)).draft?.revision).toBe(4);
  await expect(tx(f.db,async db=>amendSheet(db,checker,{batchId:id,expectedVersion:await version(),sheetNumber:1,reason:'LOCAL TEST cannot rearrange after real QC entry'}))).rejects.toThrow('AMEND_ONLY_BEFORE_EXECUTION');
  await expect(tx(f.db,async db=>cancelBatch(db,checker,{batchId:id,expectedVersion:await version(),reason:'LOCAL TEST cannot cancel after real QC entry'}))).rejects.toThrow('CANCEL_ONLY_BEFORE_EXECUTION');
  await expect(f.db.query('DELETE FROM lab_bench_export')).rejects.toThrow();
 }finally{vi.unstubAllEnvs();await f.close();}
},120000);
