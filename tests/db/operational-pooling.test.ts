import {afterEach,it,expect,vi} from 'vitest';
import {testDatabase} from '../helpers/database';
import {labUsers,docDeps,tx,version} from '../helpers/lab';
import {poolingFixture,POOL_SCENARIO} from '../helpers/pooling';
import * as service from '../../packages/pooling/service';
import {storedPool,createDnb} from '../../packages/sequencing/service';
import {bangkokToday} from '../../packages/lab/core';
import {randomUUID} from 'node:crypto';
import type {Queryable} from '../../packages/db/connection';
import type {Principal} from '../../packages/security/policy';
afterEach(()=>vi.unstubAllEnvs());
it('operational acceptance freezes verified transfers, standards, QC2 and referenced human decision; synthetic cannot accept',async()=>{
 const db=await testDatabase(),u=await labUsers(db),docs=await docDeps();
 try{
  const f=await poolingFixture(db,u,docs.deps);
  vi.stubEnv('NIPT_MODE','operational');vi.stubEnv('APP_ORIGIN','https://nipt.test');
  await db.query("UPDATE nipt_runtime_config SET mode='operational'");
  const p=await tx(db,async t=>service.createPool(t,u.staff,{batchId:f.batchId,expectedVersion:await version(t,f.batchId),scenario:POOL_SCENARIO,reason:'Reviewed operational pooling preparation'}));
  const call=(fn:(db:Queryable,user:Principal,input:unknown)=>Promise<unknown>,extra:Record<string,unknown>={},actor=u.staff)=>tx(db,async t=>fn(t,actor,{batchId:f.batchId,poolId:p.id,expectedVersion:await version(t,f.batchId),...extra}));
  const decision={criteriaReference:'WI-T-BM19 reviewed current controlled copy',reason:'Reviewed QC2 and all current pool measurements'};
  await expect(call(service.operationalGate,decision,u.certifier)).rejects.toThrow('POOL_COMPLETION_EVIDENCE_INCOMPLETE');
  await call(service.crosscheck,{values:[{slot:2,value:'128'},{slot:3,value:'128'}]});
  await call(service.transition,{transition:'START',reason:'Operational verified pool start'});
  for(const slot of [2,3])await call(service.recordPoolObservation,{field:'TRANSFER',slot,value:{checked:true},source:'DIRECT_ENTRY'});
  await call(service.recordPoolObservation,{field:'BUFFER',value:{value:'512',unit:'uL'},source:'DIRECT_ENTRY'});
  await call(service.transition,{transition:'END',reason:'Operational pool execution complete'});
  for(const field of ['QC2','STD1','STD2'])await call(service.recordPoolObservation,{field,value:{value:'20',unit:'ng/uL'},source:'DIRECT_ENTRY'});
  for(const o of await service.observations(db,p.id))await call(service.reviewPoolObservation,{observationId:o.id,result:'Confirmed',note:'Reviewed observed value against evidence'},u.certifier);
  const accepted=await call(service.operationalGate,decision,u.certifier) as {snapshotId:string};
  const stored=await storedPool(db,f.batchId,accepted.snapshotId);
  expect(stored.snapshot.payload).toMatchObject({synthetic:false,acceptance:'Accepted',exportAllowed:true});
  expect(stored.snapshot.payload.members.map(m=>m.slot)).toEqual([2,3]);
  const dnb=await tx(db,async t=>createDnb(t,u.staff,{batchId:f.batchId,poolSnapshotId:accepted.snapshotId,expectedVersion:await version(t,f.batchId),requestId:randomUUID(),purpose:'OPERATIONAL',actualDate:bangkokToday(),reason:'Prepare DNB from accepted current pool',preparation:{method:'CONTROLLED_PROTOCOL',operatorId:u.staff.id,equipmentId:'DNB-PREP-01',lots:[{name:'DNB reagent',lot:'LOT-01',expiry:'2099-01-01'}],qubitSamples:2,preclean:true,loadingReagentPrepared:true,protocolEvidence:{reference:'Controlled DNB preparation WI copy',sha256:'a'.repeat(64)}}}));
  expect((await db.query<{payload:unknown}>('SELECT payload FROM p4c_dnb_attempt WHERE id=$1',[dnb.id])).rows[0].payload).toMatchObject({synthetic:false});
  await expect(db.query('UPDATE p4b_pool_snapshot SET sha256=$1 WHERE id=$2',['a'.repeat(64),accepted.snapshotId])).rejects.toThrow(/append-only/);
  vi.stubEnv('NIPT_MODE','synthetic');
  await expect(call(service.operationalGate,decision,u.certifier)).rejects.toThrow('OWNER_DECISIONS_HOLD');
 }finally{await db.close();await docs.close();}
},120000);
