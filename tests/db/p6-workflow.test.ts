import {beforeAll,afterAll,it,expect,vi} from 'vitest';
import type {PGlite} from '@electric-sql/pglite';
import {testDatabase} from '../helpers/database';
import {registerFixture,reserveFixture,loadTransfer,applyEvent,cancelFixtureTransfer,readHistory} from '../../packages/p6/journal';
import {runTransfer} from '../../packages/p6/worker';
import {openSandbox} from '../../packages/p6/sandbox';
import {syntheticProfile} from '../../packages/p6/res';
import type {SyntheticDraft} from '../../packages/p6/transfer';
import {randomUUID} from 'node:crypto';
const sandboxId='SYNTHETIC-'+randomUUID();
const make=(n:number):SyntheticDraft=>({fixtureId:`SYNTHETIC-WORKFLOW-${n}`,reportVersionId:`SYNTHETIC-VERSION-${n}`,roundId:`SYNTHETIC-ROUND-${n}`,attemptId:`SYNTHETIC-ATTEMPT-${n}`,origin:'LAB_DIRECT',lnGeneration:1,roundNumber:1,epoch:0,input:{order:{ln:`99000${String(n).padStart(7,'0')}`,hn:`SYNTHETIC-HN-${n}`,dspname:'นาง SYNTHETIC  SYNTHETIC',dob:'20000101',sex:'F',specimen_date:'20261010070000'},result:null,generatedAt:'20261011123456',approvedAt:'20261011110000',certifierHisId:'SYNTHETIC^SYNTHETIC'},profile:{...syntheticProfile},pdf:Buffer.from('%PDF-1.4 SYNTHETIC'),settings:{version:'SYNTHETIC-CONFIG-1',resDirectory:'simulator/p6/res',pdfDirectory:'simulator/p6/cfs',backupDirectory:'simulator/p6/backup',retryDelaysMs:[1,2],confirmationTimeoutMs:1000}});
let db:PGlite;
beforeAll(async()=>{vi.stubEnv('NIPT_MODE','synthetic');vi.stubEnv('NIPT_P6_SANDBOX_ENABLED','yes');db=await testDatabase();});
afterAll(async()=>{await db.close();vi.unstubAllEnvs();});
const reserve=async(n:number)=>{const d=make(n);await registerFixture(db,d,sandboxId);return reserveFixture(db,d.fixtureId);};
it('integrates journal and filesystem through awaiting, pickup/timeout and synthetic confirmation',async()=>{
  const row=await reserve(100);await runTransfer(db,row.id);let current=await loadTransfer(db,row.id);expect(current.model.state).toBe('AWAITING_CONFIRMATION');
  const s=await openSandbox(sandboxId,make(100).settings);expect(await s.backupVerified(current.plan)).toBe(true);expect(await s.read('OK',current.plan)).toEqual(Buffer.from([255,254]));
  current=await applyEvent(db,row.id,{type:'TIMEOUT'},current.revision,current.model.awaitingAt!+1000);expect(current.model.state).toBe('UNKNOWN_TIMEOUT');
  current=await applyEvent(db,row.id,{type:'CONFIRM',evidence:{kind:'OPERATOR',transferId:current.plan.fixtureId,pdfHash:current.plan.pdfHash,resHash:current.plan.resHash,evidenceId:'SYNTHETIC-EVIDENCE',actorId:'SYNTHETIC-OBSERVER',observedAt:current.model.updatedAt,syntheticOnly:true}},current.revision,current.model.updatedAt);
  expect(current.model.state).toBe('SYNTHETIC_CONFIRMED');expect((await readHistory(db,row.id)).hisConfirmed).toBe(false);
});
it.each(['PDF','RES','BACKUP','OK'] as const)('injected %s failure never skips prerequisites, retry/reconcile stays durable',async(artifact)=>{
  const n={PDF:101,RES:102,BACKUP:103,OK:104}[artifact],row=await reserve(n);
  await runTransfer(db,row.id,{fileHook:async e=>{if(e.artifact===artifact&&e.point==='AFTER_TEMP_SYNC')throw Error('INJECTED');}});
  const failed=await loadTransfer(db,row.id),s=await openSandbox(sandboxId,make(n).settings);
  expect(failed.model.state).toBe(artifact==='OK'?'RECONCILIATION_REQUIRED':'RETRY_PENDING');expect(await s.exists('OK',failed.plan)).toBe(false);
  if(artifact!=='OK'){await new Promise(r=>setTimeout(r,5));await runTransfer(db,row.id);expect((await loadTransfer(db,row.id)).model.state).toBe('AWAITING_CONFIRMATION');}
});
it('recovers a complete PDF left before checkpoint without a new N; unexpected OK is never replayed',async()=>{
  const row=await reserve(105);
  await expect(runTransfer(db,row.id,{afterArtifact:async a=>{if(a==='PDF')throw Error('SYNTHETIC_PROCESS_STOP');}})).rejects.toThrow('SYNTHETIC_PROCESS_STOP');
  expect((await loadTransfer(db,row.id)).model.state).toBe('PREPARED');await runTransfer(db,row.id);expect((await loadTransfer(db,row.id)).plan.sequence).toBe(1);
  const ok=await reserve(106);await expect(runTransfer(db,ok.id,{afterArtifact:async a=>{if(a==='OK')throw Error('SYNTHETIC_PROCESS_STOP');}})).rejects.toThrow();
  await runTransfer(db,ok.id);expect((await loadTransfer(db,ok.id)).model.state).toBe('RECONCILIATION_REQUIRED');
});
it('withdrawal during the first write and after OK preserves artifacts and creates reconciliation',async()=>{
  const row=await reserve(107);await runTransfer(db,row.id,{afterArtifact:async a=>{if(a==='PDF')await cancelFixtureTransfer(db,row.id,'WITHDRAWAL');}});
  const first=await loadTransfer(db,row.id);expect(first.model.state).toBe('CANCELLED');expect(first.model.reconciliationRequired).toBe(true);
  const s=await openSandbox(sandboxId,make(107).settings);expect(await s.exists('OK',first.plan)).toBe(false);
  const second=await reserve(108);await runTransfer(db,second.id,{afterArtifact:async a=>{if(a==='OK')await cancelFixtureTransfer(db,second.id,'VOID');}});
  expect((await loadTransfer(db,second.id)).model.state).toBe('RECONCILIATION_REQUIRED');expect(await s.exists('OK',second.plan)).toBe(true);
});
it('withdrawal immediately before OK publication prevents the sentinel',async()=>{
  const row=await reserve(109);
  await runTransfer(db,row.id,{fileHook:async e=>{if(e.artifact==='OK'&&e.point==='BEFORE_PUBLISH')await cancelFixtureTransfer(db,row.id,'WITHDRAWAL');}});
  const current=await loadTransfer(db,row.id),s=await openSandbox(sandboxId,make(109).settings);
  expect(await s.exists('OK',current.plan)).toBe(false);expect(current.model.state).toBe('CANCELLED');
});
it('withdrawal after synthetic confirmation reopens reconciliation without replay',async()=>{
  const row=await reserve(110);await runTransfer(db,row.id);const current=await loadTransfer(db,row.id),now=Date.now();
  await applyEvent(db,row.id,{type:'CONFIRM',evidence:{kind:'OPERATOR',transferId:current.plan.fixtureId,pdfHash:current.plan.pdfHash,resHash:current.plan.resHash,evidenceId:'SYNTHETIC-POST-CONFIRM',actorId:'SYNTHETIC-OBSERVER',observedAt:now,syntheticOnly:true}},current.revision,now);
  await cancelFixtureTransfer(db,row.id,'WITHDRAWAL');await runTransfer(db,row.id);
  expect((await loadTransfer(db,row.id)).model.state).toBe('RECONCILIATION_REQUIRED');
});
