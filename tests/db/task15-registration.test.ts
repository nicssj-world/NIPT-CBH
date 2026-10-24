import {beforeEach,afterEach,it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {inboundFixture,registrar,writePet,cycle,type InboundFixture} from '../helpers/inbound';
import {tx} from '../helpers/lab';
import {lookupRegistrationPet,registerFromPet} from '../../packages/p2/pet-registration';
import {getCase,registerP2,saveRequest,saveLabClinicalMetadata,refusePaperConsent,withdraw} from '../../packages/p2/service';
import {attemptFacts,candidatePrintedId,assignmentDecision} from '../../packages/lab/core';
import {discoverInbound} from '../../packages/inbound/discovery';
import {previewLabels,orderRedraw} from '../../packages/lab/intake';
let f:InboundFixture,u:Awaited<ReturnType<typeof registrar>>;
const ln='990001234567',hn='9900012345',at='20261020101112';
beforeEach(async()=>{f=await inboundFixture();u=await registrar(f.db);});afterEach(async()=>{await f.close();});
async function pet(other:{ln?:string;hn?:string;ward?:string;receivedAt?:string}={},ok=true){await writePet(f.root,'20261020',{ln,hn,receivedAt:at,...other},{ok});await cycle(f,{now:new Date('2026-10-20T05:00:00Z')});}
const lookup=(input:unknown,user=u.lab)=>tx(f.db,db=>lookupRegistrationPet(db,user,input,{store:f.store,lookupKey:f.lookupKey}));
const submit=(input:unknown,user=u.lab)=>tx(f.db,db=>registerFromPet(db,user,input,{store:f.store,lookupKey:f.lookupKey}));
it('R15-01/05/06/08/09/14: LN-only autofill uses verified PET clock/Ward, receives and allocates with no clinical fields or signatures',async()=>{
 await pet({ward:'SYNTHETIC-ORDERING'});const found=await lookup({ln});expect(found.candidates).toHaveLength(1);const p=found.candidates[0];
 expect(p).toMatchObject({ln,hn,ward:'SYNTHETIC-ORDERING',receivedAt:'2026-10-20T10:11:12+07:00'});expect(p).not.toHaveProperty('identity');
 const r=await submit({ln,fileId:p.fileId,unitId:u.unit,consentMode:'Paper',idempotencyKey:randomUUID()});expect(r.caseId).toBeTruthy();
 const n=(await f.db.query('SELECT ln_halos FROM specimen_lab_number WHERE case_id=$1',[r.caseId])).rows;expect(n).toHaveLength(1);
 const row=(await f.db.query('SELECT ga_weeks,ga_days,edd,pregnancy FROM lab_operational_registration WHERE case_id=$1',[r.caseId])).rows[0];expect(row).toEqual({ga_weeks:null,ga_days:null,edd:null,pregnancy:null});
 for(const table of ['p2_consent_signature','p2_final_consent','p2_paper_review','clinical_snapshot'])expect((await f.db.query<{n:number}>(`SELECT count(*)::int n FROM ${table}`)).rows[0].n).toBe(0);
 const detail=await tx(f.db,db=>getCase(db,u.lab,r.caseId!));expect(detail.his?.ward).toBe('SYNTHETIC-ORDERING');expect(detail.workspace.consent_mode).toBe('Paper');
 await tx(f.db,db=>saveLabClinicalMetadata(db,u.lab,r.caseId!,{expectedVersion:detail.workspace.version,edd:'2027-03-24',pregnancy:'Twins'}));
 expect((await tx(f.db,db=>getCase(db,u.lab,r.caseId!))).workspace.draft.pregnancy.type).toBe('Twins');
 const facts=(await attemptFacts(f.db,'a.case_id=$1',[r.caseId]))[0];expect(facts.pregnancy).toBe('Twins');expect(candidatePrintedId(facts).status).toBe('YES');
 expect((await f.db.query<{ready:boolean}>('SELECT lab_owner_paper_ready($1) ready',[detail.case.current_round_id])).rows[0].ready).toBe(true);
 expect(assignmentDecision(facts,'HOLD').eligible).toBe(true);
});
it('R15-02/03: HN-only lists multiple LN and requires explicit selection; unique HN works',async()=>{
 await pet();await pet({ln:'990001234568'});const found=await lookup({hn});expect(found.candidates.map(x=>x.ln).sort()).toEqual([ln,'990001234568']);
 await expect(submit({hn,unitId:u.unit,consentMode:'Paper',idempotencyKey:randomUUID()})).rejects.toMatchObject({code:'PET_SELECTION_REQUIRED'});
 const r=await submit({hn,fileId:found.candidates[1].fileId,unitId:u.unit,consentMode:'Electronic',idempotencyKey:randomUUID()});expect(r.caseId).toBeTruthy();
 expect((await f.db.query<{consent_mode:string}>('SELECT consent_mode FROM p2_workspace WHERE case_id=$1',[r.caseId])).rows[0].consent_mode).toBe('Electronic');
});
it('R15-04: no OK and nonexistent identifiers never create a case or a number',async()=>{
 await pet({},false);expect((await lookup({ln})).candidates).toEqual([]);
 await expect(submit({ln,unitId:u.unit,consentMode:'Paper',idempotencyKey:randomUUID()})).rejects.toMatchObject({code:'PET_NOT_READY'});
 expect((await f.db.query<{n:number}>('SELECT count(*)::int n FROM nipt_case')).rows[0].n).toBe(0);
});
it('R15-04: conflicting PET versions for the same LN fail closed',async()=>{
 await pet();await pet({hn:'9900099999'});await expect(lookup({ln})).rejects.toMatchObject({code:'PET_AMBIGUOUS'});
});
it('R15-04/15: existing identity mismatch and unauthorized HN lookup reveal no PET fields',async()=>{
 await tx(f.db,db=>registerP2(db,u.lab,{ln,hn:'9900099999',unitId:u.unit,origin:'LAB_DIRECT',identifierSource:'TUBE_LABEL',idempotencyKey:randomUUID()},f.lookupKey,{store:f.store}));await pet();
 await expect(lookup({ln})).rejects.toMatchObject({code:'PET_IDENTITY_CONFLICT'});
 await expect(lookup({hn},u.anc)).rejects.toThrow('FORBIDDEN');
});
it('R15-07: retry and reopening preserve one central case, round, LN Halos and registration marker',async()=>{
 await pet();const p=(await lookup({ln})).candidates[0],input={ln,fileId:p.fileId,unitId:u.unit,consentMode:'Paper',idempotencyKey:randomUUID()};
 const first=await submit(input),retry=await submit(input),open=await submit({...input,idempotencyKey:randomUUID()});expect(retry.caseId).toBe(first.caseId);expect(open.caseId).toBe(first.caseId);
 for(const table of ['nipt_case','specimen_round','specimen_lab_number','lab_operational_registration'])expect((await f.db.query<{n:number}>(`SELECT count(*)::int n FROM ${table}`)).rows[0].n).toBe(1);
 await expect(submit({...input,consentMode:'Electronic'})).rejects.toMatchObject({code:'IDEMPOTENCY_CONFLICT'});
});
it('R15-12/13: ANC pre-PET retains its workspace and one identity after PET arrival with automatic Ward',async()=>{
 const r=await tx(f.db,db=>registerP2(db,u.anc,{ln,hn,unitId:u.unit,origin:'ANC',idempotencyKey:randomUUID()},f.lookupKey,{store:f.store}));
 expect((await tx(f.db,db=>getCase(db,u.anc,r.caseId!))).his).toBeNull();await pet({ward:'SYNTHETIC-OTHER-WARD'});
 const detail=await tx(f.db,db=>getCase(db,u.anc,r.caseId!));expect(detail.his?.ward).toBe('SYNTHETIC-OTHER-WARD');expect(detail.case.id).toBe(r.caseId);
 const p=(await lookup({hn})).candidates[0];const opened=await submit({hn,fileId:p.fileId,unitId:u.unit,consentMode:'Paper',idempotencyKey:randomUUID()});expect(opened.caseId).toBe(r.caseId);expect((await f.db.query<{registration_origin:string}>('SELECT registration_origin FROM nipt_case')).rows[0].registration_origin).toBe('ANC');
});
it('R15-02: one eligible HN registers without a file selector and preserves Electronic consent guards',async()=>{
 await pet();expect((await lookup({hn})).candidates).toHaveLength(1);
 const r=await submit({hn,unitId:u.unit,consentMode:'Electronic',idempotencyKey:randomUUID()});
 const detail=await tx(f.db,db=>getCase(db,u.lab,r.caseId!));expect(detail.workspace.consent_mode).toBe('Electronic');expect(detail.signatures).toEqual([]);expect(detail.readiness.state).not.toBe('ClinicalPassed');
});
it('R15-04: stored bytes/hash tamper and stale or unrelated selection are denied',async()=>{
 await pet();await expect(submit({ln,fileId:randomUUID(),unitId:u.unit,consentMode:'Paper',idempotencyKey:randomUUID()})).rejects.toMatchObject({code:'PET_SELECTION_STALE'});
 const badStore={get:async()=>Buffer.from('invalid stored bytes')} as unknown as typeof f.store;
 await expect(tx(f.db,db=>lookupRegistrationPet(db,u.lab,{ln},{store:badStore,lookupKey:f.lookupKey}))).rejects.toMatchObject({code:'PET_PROVENANCE_INVALID'});
});
it('R15-07: registration can win the race after OK discovery but before the worker processes Ready PET',async()=>{
 await writePet(f.root,'20261020',{ln,hn,receivedAt:at});await discoverInbound(f.db,f.store,{root:f.root,lookupKey:f.lookupKey,lookbackDays:3,now:new Date('2026-10-20T05:00:00Z')});
 const r=await submit({ln,unitId:u.unit,consentMode:'Paper',idempotencyKey:randomUUID()});expect(r.caseId).toBeTruthy();expect((await f.db.query<{n:number}>('SELECT count(*)::int n FROM specimen_lab_number')).rows[0].n).toBe(1);
});
it('R15-08/15: Unknown pregnancy remains unconfirmed and cannot print a singleton label',async()=>{
 await pet();const r=await submit({ln,unitId:u.unit,consentMode:'Paper',idempotencyKey:randomUUID()}),detail=await tx(f.db,db=>getCase(db,u.lab,r.caseId!));
 const draft=structuredClone(detail.workspace.draft);draft.pregnancy.type='Unknown';await tx(f.db,db=>saveRequest(db,u.lab,r.caseId!,{expectedVersion:detail.workspace.version,draft}));
 const facts=(await attemptFacts(f.db,'a.case_id=$1',[r.caseId]))[0];expect(facts.pregnancy).toBeNull();expect(candidatePrintedId(facts).status).toBe('PREGNANCY_UNCONFIRMED');await expect(tx(f.db,db=>previewLabels(db,u.lab,{roundIds:[detail.case.current_round_id],includeName:false}))).rejects.toMatchObject({code:'PREGNANCY_TYPE_UNCONFIRMED'});
});
it('R15-04/15: old S1 PET never satisfies pending S2; a newly discovered Ready S2 PET uses existing redraw receipt/lineage',async()=>{
 await pet();const first=await submit({ln,unitId:u.unit,consentMode:'Paper',idempotencyKey:randomUUID()}),original=(await f.db.query<{ln_halos:string}>('SELECT ln_halos FROM specimen_lab_number')).rows[0].ln_halos;
 await tx(f.db,db=>orderRedraw(db,u.lab,{caseId:first.caseId,reasonCode:'SPECIMEN_PROBLEM',note:'SYNTHETIC early redraw approved workflow'}));expect((await lookup({ln})).candidates).toEqual([]);
 await expect(submit({ln,unitId:u.unit,consentMode:'Paper',idempotencyKey:randomUUID()})).rejects.toMatchObject({code:'PET_NOT_READY'});
 await writePet(f.root,'20261021',{ln,hn,receivedAt:'20261021101112'});await discoverInbound(f.db,f.store,{root:f.root,lookupKey:f.lookupKey,lookbackDays:3,now:new Date('2026-10-21T05:00:00Z')});
 const found=await lookup({ln});expect(found.candidates).toHaveLength(1);expect(found.candidates[0].roundNumber).toBe(2);await submit({ln,unitId:u.unit,consentMode:'Paper',idempotencyKey:randomUUID()});
 const detail=await tx(f.db,db=>getCase(db,u.lab,first.caseId!));expect(detail.roundReceipt.receivedSource).toBe('HIS_PET_RECEIPT');expect(detail.his?.lnHalos).toBe(original);expect((await f.db.query<{n:number}>('SELECT count(*)::int n FROM specimen_lab_number')).rows[0].n).toBe(2);
});
it('R15-10/15: deferred metadata never bypasses an existing clinical assessment',async()=>{
 await pet();const r=await submit({ln,unitId:u.unit,consentMode:'Paper',idempotencyKey:randomUUID()}),d=await tx(f.db,db=>getCase(db,u.lab,r.caseId!));
 await tx(f.db,db=>saveRequest(db,u.lab,r.caseId!,{expectedVersion:d.workspace.version,draft:d.workspace.draft}));const current=await tx(f.db,db=>getCase(db,u.lab,r.caseId!));
 await expect(tx(f.db,db=>saveLabClinicalMetadata(db,u.lab,r.caseId!,{expectedVersion:current.workspace.version,edd:'2027-03-24',pregnancy:'Singleton'}))).rejects.toMatchObject({code:'CLINICAL_REVIEW_REQUIRED'});
 expect((await f.db.query<{n:number}>('SELECT count(*)::int n FROM clinical_snapshot')).rows[0].n).toBe(1);
});
it.each(['refusal','revocation'] as const)('R15-10/15: deferred metadata preserves %s HOLD',async kind=>{
 await pet();const r=await submit({ln,unitId:u.unit,consentMode:'Paper',idempotencyKey:randomUUID()}),d=await tx(f.db,db=>getCase(db,u.lab,r.caseId!));
 if(kind==='refusal')await tx(f.db,db=>refusePaperConsent(db,u.lab,r.caseId!,{expectedVersion:d.workspace.version,reason:'SYNTHETIC refusal safety regression'}));
 else await tx(f.db,db=>withdraw(db,u.lab,r.caseId!,{reason:'SYNTHETIC revocation safety regression'}));
 const current=await tx(f.db,db=>getCase(db,u.lab,r.caseId!));await expect(tx(f.db,db=>saveLabClinicalMetadata(db,u.lab,r.caseId!,{expectedVersion:current.workspace.version,edd:'2027-03-24',pregnancy:'Singleton'}))).rejects.toMatchObject({code:kind==='refusal'?'CLINICAL_REVIEW_REQUIRED':'CONSENT_REVOKED_HOLD'});
 expect((await f.db.query<{ready:boolean}>('SELECT lab_owner_paper_ready($1) ready',[d.case.current_round_id])).rows[0].ready).toBe(false);
});
