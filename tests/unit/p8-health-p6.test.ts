import {createHash} from 'node:crypto';
import {afterAll,beforeAll,expect,it} from 'vitest';
import type {PGlite} from '@electric-sql/pglite';
import {testDatabase} from '../helpers/database';
import {fixture} from '../helpers/p6-fixture';
import {registerFixture,reserveFixture,applyEvent,cancelFixtureTransfer,applyWorkerEvent} from '../../packages/p6/journal';
import {readP6Signals,summarizeHealth} from '../../tools/p8/health';
let db:PGlite;
beforeAll(async()=>{db=await testDatabase();});afterAll(async()=>{await db.close();});
const now=new Date(),normal={now,workerLockHeld:true,heartbeatAt:now,lastSuccessAt:now,workerError:false,inboundEnabled:false,backlog:0,unresolvedReconciliation:0,orphanReceipts:0,releaseRows:0,clinicalAuthority:false,auditValid:true,migrationsMatch:true,rolesRestricted:true};
it('unused disabled P6 does not fail a successful ordinary PDF smoke',async()=>{const p6=await readP6Signals(db);expect(p6).toMatchObject({p6Pending:0,p6Unresolved:0,p6WorkerError:false});expect(summarizeHealth({...normal,...p6}).technicalReady).toBe(true);});
it('actual P6 pending, reconciliation, failure and timeout rows independently block readiness despite fresh ordinary PDF success',async()=>{
 const reserve=async(n:number)=>{await registerFixture(db,fixture(n),'SYNTHETIC-P8-HEALTH');return reserveFixture(db,fixture(n).fixtureId,0);};
 const first=await reserve(801);let p6=await readP6Signals(db);expect(p6.p6Pending).toBe(1);expect(summarizeHealth({...normal,...p6}).technicalReady).toBe(false);
 await applyEvent(db,first.id,{type:'UNEXPECTED_OK'},first.revision,1);p6=await readP6Signals(db);expect(p6).toMatchObject({p6Pending:0,p6Unresolved:1});expect(summarizeHealth({...normal,...p6}).technicalReady).toBe(false);
 const failed=await reserve(802);await applyEvent(db,failed.id,{type:'FAILURE',stage:'PDF',code:'COLLISION'},failed.revision,1);expect((await readP6Signals(db)).p6Unresolved).toBe(2);
 let timed=await reserve(803);for(const event of [{type:'PDF_VERIFIED',sha256:timed.plan.pdfHash},{type:'RES_VERIFIED',sha256:timed.plan.resHash},{type:'BACKUP_VERIFIED',pdfHash:timed.plan.pdfHash,resHash:timed.plan.resHash},{type:'OK_OBSERVED',sha256:createHash('sha256').update(Buffer.from([255,254])).digest('hex')},{type:'POST_OK_CHECK'}] as const){timed=await applyEvent(db,timed.id,event,timed.revision,2);}
 timed=await applyEvent(db,timed.id,{type:'TIMEOUT'},timed.revision,70000);expect(timed.model.state).toBe('UNKNOWN_TIMEOUT');expect((await readP6Signals(db)).p6Unresolved).toBe(3);
 let cancelled=await reserve(804);cancelled=await applyEvent(db,cancelled.id,{type:'PDF_VERIFIED',sha256:cancelled.plan.pdfHash},cancelled.revision,1);await cancelFixtureTransfer(db,cancelled.id,'VOID');cancelled=await applyWorkerEvent(db,cancelled.id,{type:'WRITE_STARTED',stage:'RES'});expect(cancelled.model).toMatchObject({state:'CANCELLED',reconciliationRequired:true});expect(await readP6Signals(db)).toMatchObject({p6Pending:0,p6Unresolved:4});
});
it('P6 heartbeat errors survive later ordinary job success and never expose raw error content',async()=>{const onlyHeartbeat=await testDatabase();try{await onlyHeartbeat.query("INSERT INTO p6_worker_heartbeat(worker_id,details) VALUES('SYNTHETIC-P6-WORKER',$1)",[{lastError:'PHI_URL_SECRET_TEST_ONLY',processed:1,busy:0,syntheticOnly:true}]);const report=summarizeHealth({...normal,...await readP6Signals(onlyHeartbeat)});expect(report.p6WorkerError).toBe(true);expect(report.technicalReady).toBe(false);expect(JSON.stringify(report)).not.toContain('PHI_URL_SECRET_TEST_ONLY');}finally{await onlyHeartbeat.close();}});
