import {it,expect,vi} from 'vitest';
import {Client} from 'pg';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {migrate} from '../../tools/migrate';
import {assertSyntheticDatabase,type Queryable} from '../../packages/db/connection';
import type {Principal} from '../../packages/security/policy';
import {labUsers,docDeps,tx,version} from '../helpers/lab';
import {completedPool,dnbInput} from '../helpers/sequencing';
import {bangkokToday} from '../../packages/lab/core';
import {BARCODE_ORDER} from '../../packages/halos-export/contract';
import {f5Html} from '../../packages/pdf/f5';
import * as s from '../../packages/sequencing/service';
import * as docs5 from '../../packages/sequencing/documents';
import * as pool from '../../packages/pooling/service';

// DIRECT_ENTRY event time must come from the database clock, the same authority as recorded_at and the execution anchors.
// The application clock is deliberately skewed ±3 s: before the fix, +3 s violates CHECK(event_time <= recorded_at) and -3 s violates
// the execution-anchor trigger; with the database as the single time source both directions pass. Constraints and triggers are untouched.
const SKEW_MS=3000;
const record=()=>({purpose:'SYNTHETIC_SIMULATION',equipmentModel:'DNBSEQ-G50',equipmentId:'SYN-G50-01',sequencingId:'SYN-SEQUENCE-001',cartridgeId:'SYN-CARTRIDGE-001',flowCellId:'SYN-FLOW-001',idSource:'SCAN',barcodeType:'SYN-EXPLICIT-UNVERIFIED',barcodeRange:{from:1,to:128},recipe:'FCL-SE35',configuration:{readMode:'SE',readCycles:35,barcodeCycles:10,assay:'NIPT'},pressureKpa:'-81',diskSpaceGb:'501',wash:{lot:'SYN-WASH',preparedOn:bangkokToday(),expiry:'2099-12-31',preWash:true},reason:'จำลอง Sequencing record'});

it.skipIf(!process.env.NIPT_TEST_DATABASE_URL)('native DIRECT_ENTRY Pool/DNB/QC4 timestamps come from the database clock under ±3 s application clock skew',async()=>{
 const url=process.env.NIPT_TEST_DATABASE_URL!;assertSyntheticDatabase(url);
 const owner=new Client({connectionString:url});await owner.connect();const clients:Client[]=[],docs=await docDeps();
 const session=async()=>{const c=new Client({connectionString:url});await c.connect();await c.query('SET ROLE app_rw');clients.push(c);return c as unknown as Queryable;};
 try{
  await migrate(owner);await owner.query(await readFile('packages/db/roles.sql','utf8'));
  const u=await labUsers(owner),app=await session();
  await owner.query("UPDATE lab_batch SET state='Cancelled',cancelled_by=$1,cancelled_at=now(),cancel_reason='SYNTHETIC clock isolation' WHERE state='Draft'",[u.staff.id]);
  for(const skew of [SKEW_MS,-SKEW_MS]){
   vi.useFakeTimers({toFake:['Date'],now:Date.now()+skew,shouldAdvanceTime:true});
   try{
    const p=await completedPool(owner,u,docs.deps,45,'PATIENT_PC_NC');   // Pool observations are recorded by the helper (DIRECT_ENTRY)
    const created=await tx(owner,async t=>s.createDnb(t,u.staff,dnbInput(p.batchId,p.poolSnapshotId,await version(t,p.batchId),u.staff.id))),dnbId=created.id!;
    const call=(db:Queryable,fn:(t:Queryable,u:Principal,d:unknown)=>Promise<unknown>,extra:Record<string,unknown>={},actor=u.staff)=>tx(db,async t=>fn(t,actor,{batchId:p.batchId,dnbId,expectedVersion:await version(t,p.batchId),requestId:randomUUID(),...extra}));
    const deps5={store:docs.deps.store,render:async(d:Parameters<typeof f5Html>[0])=>Buffer.from('%PDF-1.4\n'+f5Html(d))};
    const input=async(t:Queryable)=>({batchId:p.batchId,dnbId,expectedVersion:await version(t,p.batchId),kind:'PRE_WORK',purpose:'SYNTHETIC_SIMULATION'});
    await tx(owner,async t=>docs5.issueF5(t,u.staff,await input(t),deps5,true));await tx(owner,async t=>docs5.issueF5(t,u.staff,await input(t),deps5));
    await call(owner,s.transition,{transition:'DNB_START',reason:'จำลอง เริ่ม DNB'});await call(owner,s.transition,{transition:'DNB_END',reason:'จำลอง จบ DNB'});
    for(const field of ['STD1','STD2','QC3'])await call(app,s.recordObservation,{field,value:'20',unit:'ng/uL',source:'DIRECT_ENTRY'});
    for(const o of await s.observations(owner,dnbId))await call(owner,s.reviewObservation,{observationId:o.id,result:'Confirmed',note:'จำลอง ทวนสอบค่า DNB'},u.certifier);
    await call(owner,s.decideQc3,{decision:'SyntheticReviewed',criteriaVersion:s.QC3_CRITERIA,reason:'จำลอง QC3 ไม่มี Clinical Pass'},u.certifier);
    const source=s.orderedSourceMembers((await s.storedPool(owner,p.batchId,p.poolSnapshotId)).snapshot);
    const members=source.map((m,i)=>({memberKey:m.memberKey,physicalPosition:m.physicalPosition,role:m.role,exportSampleId:`SYN-EXPLICIT-A-${i+1}`,printedSampleId:m.printedSampleId!,lnHalos:m.lnHalos??`SYN-EXPLICIT-CONTROL-${m.physicalPosition}`,barcodeIndex:BARCODE_ORDER[i],barcodeType:'SYN-EXPLICIT-UNVERIFIED'}));
    const handoff=await call(owner,s.createHandoff,{mapping:{status:'synthetic-fixture-unverified',evidenceReference:'Explicit simulation fixture only; unapproved mapping and column A',members},reason:'จำลอง Mapping ที่ไม่รับรอง'}) as {id:string;fileHash:string};
    const sequence=await call(owner,s.createSequencing,record()) as {id:string};
    const transfer=await call(owner,s.transferHandoff,{handoffId:handoff.id,fileHash:handoff.fileHash,status:'Complete',evidenceHash:'a'.repeat(64),evidenceReference:'Synthetic transfer evidence; no real vendor import',purpose:'SYNTHETIC_SIMULATION'}) as {id:string};
    await call(owner,s.verifyHandoff,{handoffId:handoff.id,transferId:transfer.id,observedRows:members,observedDnbId:`DNB${bangkokToday().replaceAll('-','')}`,lane:'L01',fileHash:handoff.fileHash,status:'Complete',evidenceHash:'b'.repeat(64),note:'จำลอง ทวนสอบ 1 ต่อ 1'},u.certifier);
    await call(owner,s.transitionSequencing,{sequencingId:sequence.id,transition:'SEQUENCE_START',reason:'จำลอง เริ่ม Sequencing'});
    await call(owner,s.transitionSequencing,{sequencingId:sequence.id,transition:'SEQUENCE_END',reason:'จำลอง จบ Sequencing',firstCycle:{loadedDnb:'100',q30:'90',bic:'90',fit:'90'},postWash:true});
    const qc4={sequencingId:sequence.id,lane:'L01',metrics:{totalReads:'100000',uniqueReads:'90000',q30:'90',gcPercent:'40',fetalFraction:'10',dim:'1'},source:'DIRECT_ENTRY',evidenceHash:'d'.repeat(64)};
    await call(app,s.recordQc4,{...qc4,scope:'LANE'});for(const m of members)await call(app,s.recordQc4,{...qc4,scope:'SAMPLE',memberKey:m.memberKey});
    // Same transaction-level proof for every DIRECT_ENTRY row of the three tables.
    for(const table of ['p4b_pool_observation','p4c_dnb_observation','p4c_qc4_observation']){
     const r=await owner.query<{n:string;bad:string;maxgap:string}>(`SELECT count(*) n,count(*) FILTER(WHERE event_time IS NULL OR event_time>recorded_at) bad,
      coalesce(max(extract(epoch FROM recorded_at-event_time)),0) maxgap FROM ${table} WHERE source='DIRECT_ENTRY' AND recorded_at>now()-interval '10 minutes'`);
     expect(Number(r.rows[0].n),table).toBeGreaterThan(0);expect(Number(r.rows[0].bad),table).toBe(0);
     // The recorded gap is database-internal (milliseconds), never the injected application skew.
     expect(Number(r.rows[0].maxgap),`${table} event_time must be the database clock, gap ${r.rows[0].maxgap}s under skew ${skew}ms`).toBeLessThan(1);
    }
   }finally{vi.useRealTimers();}
  }
 }finally{vi.useRealTimers();for(const c of clients)await c.end();await owner.end();await docs.close();void pool;}
},600000);
