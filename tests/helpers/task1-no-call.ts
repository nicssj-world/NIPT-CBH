import {vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {inboundFixture} from './inbound';
import {labUsers,tx} from './lab';
import {rowVersion,type ResultFixture} from './results';
import {registerP2} from '../../packages/p2/service';
import {configureOperational} from '../../tools/configure-operational';
import {parsePet} from '../../packages/integrations/pet';
import {buildSyntheticPet} from '../../packages/inbound/wire';
import {applyS1} from '../../packages/inbound/process';
import {noCall} from '../../packages/lab/intake';
import * as results from '../../packages/results/service';

export async function noCallFixture(select=true,provided?:{db:import('../../packages/db/connection').Queryable;root:string;store:import('../../packages/storage').FileStore;lookupKey:Buffer;close():Promise<void>}){
 const f=provided??await inboundFixture();
 vi.stubEnv('NIPT_MODE','operational');vi.stubEnv('APP_ORIGIN','https://nipt.test');await configureOperational(f.db);
 const u=await labUsers(f.db),run=<T>(fn:(db:import('../../packages/db/connection').Queryable)=>Promise<T>)=>tx(f.db,fn);
 const ln='9900099661',hn='9900099961';
 const registered=await run(t=>registerP2(t,u.staff,{ln,hn,unitId:u.unit,origin:'LAB_DIRECT',idempotencyKey:'synthetic_task1_external_nocall_'+randomUUID(),labOperational:{gaWeeks:17,gaDays:6,edd:'2027-03-24',pregnancy:'Singleton',paperRequest:true,paperConsent:true}},f.lookupKey,{store:f.store}));
 const wire=buildSyntheticPet({ln,hn,dob:'19900101',orderAt:'20261020070000',specimenAt:'20261020080000',receivedAt:'20261020090000'}),pet=parsePet(wire.bytes,wire.filename);await f.store.put(wire.bytes);
 await run(async t=>{const file=(await t.query<{id:string}>("INSERT INTO his_inbound_file(sha256,state,filename,ln,parsed) VALUES($1,'Ready',$2,$3,$4) RETURNING id",[pet.hash,pet.filename,ln,JSON.stringify(pet)])).rows[0],target=(await t.query<{case_ln_id:string;case_id:string;origin:'LAB_DIRECT'}>('SELECT l.id case_ln_id,l.case_id,c.registration_origin origin FROM case_ln l JOIN nipt_case c ON c.id=l.case_id WHERE l.case_id=$1',[registered.caseId])).rows[0];await applyS1(t,file,pet,target,'AUTOMATIC');});
 // Explicit disposable failed-attempt fixture; no successful QC/measurements/clinical history is invented.
 // Independent lineage and deliberate-failure API evidence are covered by task1-lineage/task1-failure-no-call tests.
 let a=(await f.db.query<{id:string;round_id:string}>('SELECT id,round_id FROM analytical_attempt WHERE case_id=$1',[registered.caseId])).rows[0];
 await f.db.query("UPDATE analytical_attempt SET state='Stopped' WHERE id=$1",[a.id]);
 for(let n=2;n<=4;n++){
  const order=(await f.db.query<{id:string}>("INSERT INTO repeat_work_order(case_id,round_id,reason_code,state,parent_attempt_id,level,note,requested_by) VALUES($1,$2,'OTHER','RepeatFailed',$3,'RE_LIBRARY','SYNTHETIC failed attempt fixture only',$4) RETURNING id",[registered.caseId,a.round_id,a.id,u.staff.id])).rows[0].id;
  a=(await f.db.query<{id:string;round_id:string}>("INSERT INTO analytical_attempt(case_id,round_id,attempt_number,repeat_order_id,state,qc_failed_stage) VALUES($1,$2,$3,$4,'QcFailed','SEQUENCING') RETURNING id,round_id",[registered.caseId,a.round_id,n,order])).rows[0];
 }
 if(select)await run(t=>noCall(t,u.staff,{attemptId:a.id}));
 const labNumber=(await f.db.query<{ln_halos:string}>('SELECT ln_halos FROM specimen_lab_number WHERE round_id=$1',[a.round_id])).rows[0].ln_halos;
 const rf={...f,u,run} as unknown as ResultFixture;
 const spec={kind:'SINGLETON' as const,labNumber,hn,dob:'01-Jan-1990',collection:'20-Oct-2026',received:'20-Oct-2026',reported:'24-Oct-2026',gaWeeks:17,gaDays:6,sex:null,result:'No Call' as const,qc:'FAIL'};
 const link=async(versionId:string)=>{
  await run(async t=>results.proposeLink(t,u.staff,{versionId,roundId:a.round_id,attemptId:a.id,reason:'SYNTHETIC current external No Call identity',expectedRowVersion:(await rowVersion(rf,versionId)).row_version}));
  return run(async t=>results.decideLink(t,u.certifier,{versionId,decision:'APPROVE',reason:'SYNTHETIC second person exact identity',expectedRowVersion:(await rowVersion(rf,versionId)).row_version}));
 };
 const accept=async(versionId:string,user=u.certifier)=>run(async t=>results.acceptAndRelease(t,user,{versionId,expectedRowVersion:(await rowVersion(rf,versionId)).row_version,idempotencyKey:randomUUID(),externalFinalCertified:true,identityAndValuesMatchPdf:true,disclosureReviewed:true,abnormalAcknowledged:false}));
 return {...f,rf,u,run,a,registered,pet,spec,link,accept};
}
