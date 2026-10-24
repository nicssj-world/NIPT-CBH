import {readFileSync} from 'node:fs';
import {it,expect,vi} from 'vitest';
import {inboundFixture,registrar,writePet,cycle} from '../helpers/inbound';
import {tx} from '../helpers/lab';
import {registerP2} from '../../packages/p2/service';
import {createBatch,assignToBatch,updateSheetPlan,planCheck,finalizeSheet} from '../../packages/lab/batch';
import {saveWorkbookDraft} from '../../packages/workbook/service';
import {benchPooling,benchExport,benchWorkspace} from '../../packages/lab/bench';
import {benchAttemptEvidence} from '../../packages/lab/bench-evidence';
import {recordActualPooling,exportSeqPair} from '../../packages/lab/seq-export';
import {orderRepeat} from '../../packages/lab/intake';
import {readArchive} from '../../packages/workbook/archive';
it('Task1 authorized RE_LIBRARY remains in both NIFTY and HALOS with internal lineage',async()=>{
 const f=await inboundFixture();try{
  vi.stubEnv('NIPT_POOL_CSV_TEMPLATE','C:/Users/User/Downloads/Pooling Sheet Template_R001.csv');
  const u=await registrar(f.db),deps={master:readFileSync('.local/lab-owner-evidence/lab-combined-master.xlsx'),store:f.store,render:async()=>{throw Error('NATIVE_RENDER_NOT_REQUESTED_BY_THIS_DB_TEST');}};
  const b=await tx(f.db,db=>createBatch(db,u.lab)),id=b.batchId;
  const version=async()=>(await f.db.query<{version:number}>('SELECT version FROM lab_batch WHERE id=$1',[id])).rows[0].version;
  for(let n=1;n<=3;n++){
   const ln='99000123456'+n,hn='990001234'+n;
   const r=await tx(f.db,db=>registerP2(db,u.lab,{ln,hn,unitId:u.unit,origin:'LAB_DIRECT',idempotencyKey:'lab_owner_bench_case_'+n,labOperational:{gaWeeks:17,gaDays:6,edd:'2027-03-24',pregnancy:'Singleton',paperRequest:true,paperConsent:true}},f.lookupKey,{store:f.store}));
   await writePet(f.root,'20261020',{ln,hn,orderAt:'20261020070000',specimenAt:'20261020080000',receivedAt:'20261020100000'});await cycle(f,{now:new Date('2026-10-20T05:00:00Z')});
   let attempt=(await f.db.query<{id:string}>('SELECT a.id FROM analytical_attempt a JOIN nipt_case c ON c.current_round_id=a.round_id WHERE a.case_id=$1',[r.caseId])).rows[0].id; if(n===1){await f.db.query("UPDATE analytical_attempt SET state='Stopped' WHERE id=$1",[attempt]);const rep=await tx(f.db,db=>orderRepeat(db,u.lab,{attemptId:attempt,level:'RE_LIBRARY',reasonCode:'STOPPED_BY_LAB',note:'DISPOSABLE SYNTHETIC FIXTURE persisted repeat exclusion test'}));expect(rep.attemptNumber).toBe(2);attempt=rep.attemptId;}
   const assigned=await tx(f.db,async db=>assignToBatch(db,u.lab,{batchId:id,expectedVersion:await version(),attemptIds:[attempt],sheetNumber:n}));expect(assigned.placed).toHaveLength(1);
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
  vi.stubEnv('NIPT_NIFTY_XLSX_TEMPLATE','C:/Users/User/Downloads/NIFTY_Test_Request_FormHNZ_filled.xlsx');
  vi.stubEnv('NIPT_HALOS_TASK_TEMPLATE','C:/Users/User/Downloads/Task Import template(3).xlsx');
  await expect(tx(f.db,db=>exportSeqPair(db,u.lab,{batchId:id,revision:2,idempotencyKey:crypto.randomUUID()},deps))).rejects.toThrow('ACTUAL_POOLING_REQUIRED');
  const members=initial.slots.map(s=>({slot:s.slot,pooled:['PC','NC','PATIENT'].includes(s.kind)}));
  const actual=await tx(f.db,db=>recordActualPooling(db,u.lab,{batchId:id,revision:2,members,note:'LOCAL TEST actual physical transfer transcription'},deps));
  expect(actual.current).toBe(true);
  const key=crypto.randomUUID(),pair=await tx(f.db,db=>exportSeqPair(db,u.lab,{batchId:id,revision:2,idempotencyKey:key},deps));
  expect(pair.files).toHaveLength(2);expect(pair.halosPositions).toEqual([1,2,17,25,33]);
  const xml=readArchive(await f.store.get(pair.files[0].sha256)).get('xl/worksheets/sheet1.xml')!.toString();
  expect(xml).toContain('9900012341');expect(xml).toContain('9900012342');expect(xml).toContain('9900012343');
  const populatedA=[...xml.matchAll(/<c\b[^>]*\br="A(\d+)"[^>]*>([\s\S]*?)<\/c>/g)].filter(c=>Number(c[1])>1&&/<t[^>]*>[^<]+<\/t>/.test(c[2]));
  expect(populatedA).toHaveLength(5);expect(pair.halosPositions).toEqual([1,2,17,25,33]);
  const mapping=(await f.db.query<{mapping:{attemptId:string|null;roundId:string|null;physicalSlot:number}[]}>('SELECT mapping FROM lab_bench_export WHERE id=$1',[pair.files[0].id])).rows[0].mapping;
  expect(mapping.filter(m=>m.attemptId)).toHaveLength(3);expect(mapping.find(m=>m.physicalSlot===2)).toMatchObject({attemptId:patient.id,roundId:patient.round_id});
  const halosMapping=(await f.db.query<{mapping:{attemptId:string|null;roundId:string|null;physicalSlot:number}[]}>('SELECT mapping FROM lab_bench_export WHERE id=$1',[pair.files[1].id])).rows[0].mapping;
  expect(halosMapping.find(m=>m.physicalSlot===2)).toMatchObject({attemptId:patient.id,roundId:patient.round_id});
  // Metadata-only changes preserve the recorded actual transfer and revision; a fresh pair uses the same true internal members.
  await tx(f.db,async db=>updateSheetPlan(db,u.lab,{batchId:id,expectedVersion:await version(),sheetNumber:1,plannedWorkDate:'2026-10-24',plannedOperator:'SYNTHETIC CHANGED',plannedExtractionLot:'EX-B',plannedExtractionExpiry:'2027-01-01',plannedLibraryLot:'LIB-B',plannedLibraryExpiry:'2027-02-01'}));
  const afterMetadata=await tx(f.db,db=>benchWorkspace(db,u.lab,id,deps));expect(afterMetadata.sourceStale).toBe(false);expect(afterMetadata.actualPooling?.current).toBe(true);expect(afterMetadata.revision).toBe(2);
  const nextPair=await tx(f.db,db=>exportSeqPair(db,u.lab,{batchId:id,revision:2,idempotencyKey:crypto.randomUUID()},deps));expect(nextPair.halosPositions).toEqual(pair.halosPositions);

  const repeat=(await f.db.query<{id:string;repeat_order_id:string}>('SELECT id,repeat_order_id FROM analytical_attempt WHERE attempt_number=2')).rows[0];
  // The assignment legitimately advances this order, but neither table may change lineage.
  expect((await f.db.query<{state:string}>('SELECT state FROM repeat_work_order WHERE id=$1',[repeat.repeat_order_id])).rows[0].state).toBe('RepeatInProgress');
  await expect(tx(f.db,db=>db.query('UPDATE analytical_attempt SET attempt_number=3 WHERE id=$1',[repeat.id]))).rejects.toThrow('immutable attempt lineage');
  await expect(tx(f.db,db=>db.query('UPDATE analytical_attempt SET repeat_order_id=NULL WHERE id=$1',[repeat.id]))).rejects.toThrow('immutable attempt lineage');
  await expect(tx(f.db,db=>db.query('UPDATE repeat_work_order SET round_id=gen_random_uuid() WHERE id=$1',[repeat.repeat_order_id]))).rejects.toThrow('immutable work lineage');
 }finally{vi.unstubAllEnvs();await f.close();}
},120000);


