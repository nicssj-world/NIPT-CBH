import {createHash} from 'node:crypto';
import {describe, expect, it} from 'vitest';
import {freezeSyntheticTransfer, reserveSyntheticTransfer, initialTransfer, advanceTransfer, validateSyntheticPaths, productionReleasedResultAdapter, type SyntheticDraft, type TransferEvent} from '../../packages/p6/transfer';
import {syntheticProfile} from '../../packages/p6/res';
const hash=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
export const draft = ():SyntheticDraft => ({
  fixtureId:'SYNTHETIC-TRANSFER-1',reportVersionId:'SYNTHETIC-VERSION-1',roundId:'SYNTHETIC-ROUND-1',attemptId:'SYNTHETIC-ATTEMPT-1',
  origin:'ANC',lnGeneration:1,roundNumber:1,epoch:0,
  input:{order:{ln:'990000000001',hn:'SYNTHETIC-HN-1',dspname:'นาง SYNTHETIC  SYNTHETIC',dob:'20000101',sex:'F',specimen_date:'20261010070000'},result:null,generatedAt:'20261011123456',approvedAt:'20261011110000',certifierHisId:'SYNTHETIC^SYNTHETIC'},
  profile:{...syntheticProfile},pdf:Buffer.from('%PDF-1.4\nSYNTHETIC CONTRACT FIXTURE\n%%EOF'),
  settings:{version:'SYNTHETIC-CONFIG-1',resDirectory:'simulator/p6/res',pdfDirectory:'simulator/p6/cfs',backupDirectory:'simulator/p6/backup',retryDelaysMs:[1000,2000],confirmationTimeoutMs:60000},
});
const plan=()=>freezeSyntheticTransfer(draft(),1);
const gate=(p=plan())=>({epoch:p.epoch,fixtureEligible:true,consentValid:true,settingsVersion:p.settingsVersion});
const proofEvents=(p=plan()):TransferEvent[]=>[
  {type:'PDF_VERIFIED',sha256:p.pdfHash}, {type:'RES_VERIFIED',sha256:p.resHash},
  {type:'BACKUP_VERIFIED',pdfHash:p.pdfHash,resHash:p.resHash},
  {type:'OK_OBSERVED',sha256:hash(Buffer.from([255,254]))}, {type:'POST_OK_CHECK'},
];
function through(count:number) {const p=plan();let s=initialTransfer(p,0);for(const e of proofEvents(p).slice(0,count))s=advanceTransfer(s,e,gate(p),0);return s;}
describe('P6 pure transfer model: no I/O, database, release or publisher',()=>{
  it('freezes original PDF bytes, identity, profile/config and hashes deterministically',()=>{
    const d=draft(),p=freezeSyntheticTransfer(d,1);
    expect(p.mode).toBe('CONTRACT_ONLY');expect(p.resName).toBe('990000000001124.res');expect(p.pdfName).toBe('1_SYNTHETIC-HN-1__990000000001.pdf');
    expect(p.pdfHash).toBe(hash(d.pdf));expect(p.pdfHex).toBe(d.pdf.toString('hex'));
    expect(freezeSyntheticTransfer(d,1)).toEqual(p);
    d.pdf.fill(0); d.profile.wardName='CHANGED';d.settings.retryDelaysMs.push(999);
    expect(p.pdfHex).toContain('25504446');expect(p.retryDelaysMs).toEqual([1000,2000]);expect(Object.isFrozen(p)).toBe(true);
  });
  it('reserves/reuses one frozen export, allocates N across rounds/revisions and keeps LN generations separate',()=>{
    const d=draft(),p=freezeSyntheticTransfer(d,1),r=reserveSyntheticTransfer(p,[]);
    expect(r.decision).toBe('NEW');expect(r.ledger).toHaveLength(1);
    expect(reserveSyntheticTransfer(p,r.ledger)).toEqual({...r,decision:'REUSE'});
    const next=freezeSyntheticTransfer({...draft(),fixtureId:'SYNTHETIC-TRANSFER-2',reportVersionId:'SYNTHETIC-VERSION-2',roundNumber:2,roundId:'SYNTHETIC-ROUND-2',round2Policy:'CURRENT_ROUND',roundSpecimenAt:'20261010070000',input:{...d.input,generatedAt:'20261011123556'}},2);
    expect(next.pdfName).toMatch(/^2_/);expect(next.ln).toBe(p.ln);
    const second=reserveSyntheticTransfer(next,r.ledger);expect(second.ledger).toHaveLength(2);expect(r.ledger).toHaveLength(1);
    const generation2={...draft(),lnGeneration:2,fixtureId:'SYNTHETIC-TRANSFER-3',input:{...d.input,generatedAt:'20261011123656',order:{...d.input.order,hn:'SYNTHETIC-HN-2'}}};
    expect(reserveSyntheticTransfer(freezeSyntheticTransfer(generation2,1),second.ledger).decision).toBe('NEW');
  });
  it('fails closed on filename collisions, changed frozen payload, incorrect N and invalid ledger',()=>{
    const p=plan(),history=reserveSyntheticTransfer(p,[]).ledger;
    expect(()=>reserveSyntheticTransfer(freezeSyntheticTransfer({...draft(),pdf:Buffer.from('%PDF-SYNTHETIC-OTHER')},1),history)).toThrow('FROZEN_PAYLOAD_CHANGED');
    expect(()=>reserveSyntheticTransfer(freezeSyntheticTransfer({...draft(),fixtureId:'SYNTHETIC-TRANSFER-2',reportVersionId:'SYNTHETIC-VERSION-2'},2),history)).toThrow('DESTINATION_COLLISION');
    expect(()=>reserveSyntheticTransfer(freezeSyntheticTransfer(draft(),2),[])).toThrow('INVALID_SEQUENCE');
    expect(()=>reserveSyntheticTransfer(p,[p,p])).toThrow('INVALID_LEDGER');
    expect(()=>reserveSyntheticTransfer({...p,resHash:'a'.repeat(64)},[])).toThrow('FROZEN_CONTRACT_CHANGED');
    const newSettings={...draft().settings,version:'SYNTHETIC-CONFIG-2',retryDelaysMs:[]};
    expect(()=>reserveSyntheticTransfer(freezeSyntheticTransfer({...draft(),settings:newSettings,fixtureId:'SYNTHETIC-TRANSFER-2',reportVersionId:'SYNTHETIC-VERSION-2'},2),history)).toThrow('DESTINATION_COLLISION');
  });
  it('fingerprints do not depend on profile/settings object insertion order',()=>{
    const d=draft(),reverse=<T extends object>(x:T)=>Object.fromEntries(Object.entries(x).reverse()) as T;
    expect(freezeSyntheticTransfer({...d,profile:reverse(d.profile),settings:reverse(d.settings)},1)).toEqual(freezeSyntheticTransfer(d,1));
  });
  it.each(['HISTORICAL','OTHER'])('blocks origin %s before any transfer',origin=>{expect(()=>freezeSyntheticTransfer({...draft(),origin} as SyntheticDraft,1)).toThrow();});
  it('requires an explicit synthetic policy/date for round >=2 and never substitutes the first round silently',()=>{
    expect(()=>freezeSyntheticTransfer({...draft(),roundNumber:2},2)).toThrow('ROUND2_SPECIMEN_POLICY_UNRESOLVED');
    expect(()=>freezeSyntheticTransfer({...draft(),roundNumber:2,round2Policy:'CURRENT_ROUND',roundSpecimenAt:'20261012070000'},2)).toThrow('ROUND2_SPECIMEN_MISMATCH');
    expect(()=>freezeSyntheticTransfer({...draft(),roundNumber:2,round2Policy:'ORIGINAL_ORDER',originalSpecimenAt:'20261010070000'},2)).not.toThrow();
    for(const date of ['2026-10-10T07:00:00junk','2026-10-10T07:00:00Z','2026-10-10T07:00:00+00:00'])expect(()=>freezeSyntheticTransfer({...draft(),roundNumber:2,round2Policy:'CURRENT_ROUND',roundSpecimenAt:date},2)).toThrow('INVALID_SPECIMEN_EVIDENCE_DATE');
    expect(()=>freezeSyntheticTransfer({...draft(),input:{...draft().input,result:{result_type:'redraw_notice'}}},1)).toThrow('NOTICE_CHANNEL_HOLD_OD07');
    expect(()=>freezeSyntheticTransfer({...draft(),input:{...draft().input,result:{result_type:' redraw_notice '}}},1)).toThrow('NOTICE_CHANNEL_HOLD_OD07');
    expect(()=>freezeSyntheticTransfer({...draft(),input:{...draft().input,order:{...draft().input.order,specimen_date:''}}},1)).toThrow('SPECIMEN_EVIDENCE_REQUIRED');
  });
  it('does not freeze blank CFS text even though pure legacy serialization preserves it',()=>{
    for(const cfsText of ['','   '])expect(()=>freezeSyntheticTransfer({...draft(),profile:{...draft().profile,cfsText}},1)).toThrow('CFS_TEXT_REQUIRED');
  });
  it('validates simulator path configuration without accessing a path',()=>{
    expect(()=>validateSyntheticPaths(draft().settings)).not.toThrow();
    for(const value of ['\\\\HIS\\CFS','C:\\CFS','/mnt/his','simulator/p6/../cfs','simulator/p6/cfs/','simulator/p6/cfs\0','simulator/p6/cfs:share'])expect(()=>validateSyntheticPaths({...draft().settings,pdfDirectory:value})).toThrow();
    expect(()=>validateSyntheticPaths({...draft().settings,pdfDirectory:draft().settings.resDirectory})).toThrow();
    expect(()=>validateSyntheticPaths({...draft().settings,backupDirectory:'simulator/p6/cfs/nested'})).toThrow();
    for(const patch of [{retryDelaysMs:[-1]}, {retryDelaysMs:[0]}, {confirmationTimeoutMs:0}, {productionAuthorized:true}])expect(()=>validateSyntheticPaths({...draft().settings,...patch})).toThrow();
  });
  it('orders verified PDF, RES, backup and OK then awaits confirmation; never says HIS confirmed',()=>{
    const states=Array.from({length:6},(_,i)=>through(i).state);
    expect(states).toEqual(['PREPARED','PDF_VERIFIED','RES_VERIFIED','BACKUP_VERIFIED','OK_OBSERVED','AWAITING_CONFIRMATION']);
    expect(through(5).hisConfirmed).toBe(false);expect(through(5).log).toHaveLength(5);
    const s=through(0);expect(()=>advanceTransfer(s,proofEvents()[3],gate(),0)).toThrow('INVALID_TRANSITION');
    expect(()=>advanceTransfer(s,{type:'PDF_VERIFIED',sha256:'a'.repeat(64)},gate(),0)).toThrow('HASH_MISMATCH');
    expect(()=>advanceTransfer(through(2),{type:'BACKUP_VERIFIED',pdfHash:plan().pdfHash,resHash:'b'.repeat(64)},gate(),0)).toThrow('BACKUP_HASH_MISMATCH');
  });
  it('repeated exact observations are idempotent; changed proofs cannot be replayed',()=>{
    for(let count=1;count<=5;count++){
      const s=through(count),e=proofEvents()[count-1];
      expect(advanceTransfer(s,e,gate(),1)).toBe(s);
      if('sha256' in e)expect(()=>advanceTransfer(s,{...e,sha256:'a'.repeat(64)},gate(),1)).toThrow();
    }
  });
  it.each([0,1,2,3,4,5])('cancellation/consent/profile checks at step %i stop progression',count=>{
    for(const patch of [{epoch:1},{fixtureEligible:false},{consentValid:false},{settingsVersion:'SYNTHETIC-CONFIG-2'}]) {
      const s=through(count),e=proofEvents()[count]??{type:'PICKUP'};
      const next=advanceTransfer(s,e as TransferEvent,{...gate(),...patch},1);
      expect(next.state).toBe(count>=4?'RECONCILIATION_REQUIRED':'CANCELLED');
      expect(next.reconciliationRequired).toBe(count>0);expect(next.hisConfirmed).toBe(false);
      expect(s.log).toHaveLength(count); // Reducer never mutates prior evidence.
    }
  });
  it.each([0,1,2])('failure before OK at step %i keeps frozen payload, backs off, retries without recertifying',count=>{
    let s=advanceTransfer(through(count),{type:'FAILURE',stage:['PDF','RES','BACKUP'][count] as 'PDF'|'RES'|'BACKUP',code:'IO_ERROR'},gate(),100);
    expect(s.state).toBe('RETRY_PENDING');expect(s.nextRetryAt).toBe(1100);expect(s.plan).toEqual(plan());
    expect(()=>advanceTransfer(s,{type:'RETRY'},gate(),1099)).toThrow('BACKOFF_PENDING');
    s=advanceTransfer(s,{type:'RETRY'},gate(),1100);expect(s.state).toBe(through(count).state);expect(s.attempts).toBe(2);
    s=advanceTransfer(s,{type:'FAILURE',stage:['PDF','RES','BACKUP'][count] as 'PDF'|'RES'|'BACKUP',code:'IO_ERROR'},gate(),1101);
    expect(s.nextRetryAt).toBe(3101);s=advanceTransfer(s,{type:'RETRY'},gate(),3101);
    s=advanceTransfer(s,{type:'FAILURE',stage:['PDF','RES','BACKUP'][count] as 'PDF'|'RES'|'BACKUP',code:'IO_ERROR'},gate(),3102);
    expect(s.state).toBe('FAILED_NEEDS_ADMIN');expect(s.plan.sequence).toBe(1);
  });
  it('ambiguous OK failure and collision require reconciliation/admin, never blind replay or deletion',()=>{
    const s=advanceTransfer(through(3),{type:'FAILURE',stage:'OK',code:'IO_ERROR'},gate(),1);
    expect(s.state).toBe('RECONCILIATION_REQUIRED');expect(s.reconciliationRequired).toBe(true);
    expect(()=>advanceTransfer(s,{type:'RETRY'},gate(),9999)).toThrow('INVALID_TRANSITION');
    const c=advanceTransfer(through(0),{type:'FAILURE',stage:'PDF',code:'COLLISION'},gate(),1);expect(c.state).toBe('FAILED_NEEDS_ADMIN');
    expect(()=>advanceTransfer(through(0),{type:'FAILURE',stage:'OK',code:'IO_ERROR'},gate(),1)).toThrow('INVALID_TRANSITION');
  });
  it('cancellation after an unverified first write treats partial artifacts as requiring reconciliation',()=>{
    const failed=advanceTransfer(through(0),{type:'FAILURE',stage:'PDF',code:'IO_ERROR'},gate(),1);
    const cancelled=advanceTransfer(failed,{type:'RETRY'},{...gate(),epoch:1},1001);
    expect(cancelled.state).toBe('CANCELLED');expect(cancelled.reconciliationRequired).toBe(true);
  });
  it('pickup is unconfirmed, timeout opens reconciliation, correlated synthetic evidence can close the model',()=>{
    let s=advanceTransfer(through(5),{type:'PICKUP'},gate(),1);expect(s.state).toBe('PICKED_UP_UNCONFIRMED');expect(s.hisConfirmed).toBe(false);
    expect(()=>advanceTransfer(s,{type:'TIMEOUT'},gate(),59999)).toThrow('TIMEOUT_PENDING');
    s=advanceTransfer(s,{type:'TIMEOUT'},gate(),60000);expect(s.state).toBe('UNKNOWN_TIMEOUT');expect(s.reconciliationRequired).toBe(true);
    for(const kind of ['ACK','OPERATOR','QUERY'] as const) {
      const evidence={kind,transferId:plan().fixtureId,pdfHash:plan().pdfHash,resHash:plan().resHash,evidenceId:'SYNTHETIC-EVIDENCE-1',actorId:'SYNTHETIC-OBSERVER-1',observedAt:60001,syntheticOnly:true as const};
      const done=advanceTransfer(s,{type:'CONFIRM',evidence},gate(),60001);expect(done.state).toBe('SYNTHETIC_CONFIRMED');expect(done.hisConfirmed).toBe(false);expect(done.evidence).toEqual(evidence);
      for(const patch of [{transferId:'SYNTHETIC-OTHER'}, {resHash:'a'.repeat(64)}, {pdfHash:'a'.repeat(64)}, {actorId:''}, {observedAt:60002}, {kind:'PICKUP'}])expect(()=>advanceTransfer(s,{type:'CONFIRM',evidence:{...evidence,...patch}} as TransferEvent,gate(),60001)).toThrow();
    }
    expect(()=>advanceTransfer(through(0),{type:'CONFIRM',evidence:{} } as TransferEvent,gate(),0)).toThrow();
  });
  it('retains coded logs without arbitrary messages, paths or PHI',()=>{
    const s=through(5);const log=JSON.stringify(s.log);
    expect(log).not.toContain(draft().input.order.ln);expect(log).not.toContain(draft().input.order.hn);expect(log).not.toContain('simulator/');
    expect(()=>advanceTransfer(s,{type:'FAILURE',stage:'OK',code:'secret patient text'} as unknown as TransferEvent,gate(),1)).toThrow();
  });
  it('P5 adapter stays closed for any candidate and exposes no publishing operation',()=>{
    for(const candidate of [undefined,null,{}, {state:'CertifiedReleased',channel:'HIS',epoch:0},plan()])expect(()=>productionReleasedResultAdapter(candidate)).toThrow('P6_INTEGRATION_HOLD_P5_AL5_AL6');
  });
});
