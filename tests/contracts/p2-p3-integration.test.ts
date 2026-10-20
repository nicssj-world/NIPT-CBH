import {describe,it,expect,beforeEach,afterEach} from 'vitest';
import {randomUUID} from 'node:crypto';
import {inboundFixture,writePet,cycle,caseState,openIssues,fileStates,rows,register,registerP2Case,registerP1Legacy,registrar,type InboundFixture} from '../helpers/inbound';
import {addUser,TEST_PASSWORD} from '../helpers/database';
import {registerP2,registrationIntakePresence,getCase,saveRequest,lockRequest,doctorAction,prepareConsent,startSigning,type Staff} from '../../packages/p2/service';
import {emptyRequest} from '../../packages/p2/schema';
import {identityLookup} from '../../packages/security/envelope';
import {authenticate,readSession} from '../../packages/security/session';
import {lnHnKey,compareRegistrant,p2IdentitySource,defaultIdentitySource} from '../../packages/inbound/identity';
import {linkIntakeAtRegistration} from '../../packages/inbound/registration-link';
import type {Pet} from '../../packages/integrations/pet';

const NOW=new Date('2026-10-12T05:00:00Z'),DAY='20261012',HN='9900001001';
const later=(minutes:number)=>new Date(NOW.getTime()+minutes*60_000);
let f:InboundFixture;
beforeEach(async()=>{f=await inboundFixture();});
afterEach(async()=>{await f.close();});
const pet=(ln:string,hn:string):Pet=>({ln,hn,name:'SYNTHETIC^^นาง ทดสอบ',dob:'1990-01-01T00:00:00+07:00',sex:'F',receivedAt:'2026-10-12T09:00:00+07:00',specimenAt:'2026-10-12T07:00:00+07:00',orderAt:'2026-10-11T16:00:00+07:00',ward:'SYNTHETIC-W',identity:'SYNTHETIC-ID-0001',hash:'0'.repeat(64),filename:`${ln}-7.pet`});
async function tx<T>(fn:()=>Promise<T>){await f.db.query('BEGIN');try{const r=await fn();await f.db.query('COMMIT');return r;}catch(e){await f.db.query('ROLLBACK');throw e;}}
const auditCount=async()=>(await rows<{n:number}>(f.db,'SELECT count(*)::int AS n FROM audit_chain'))[0].n;
/** Terminal state of one LN, free of ids and wall-clock times, for order-independence comparison. */
async function terminal(ln:string){
 const c=(await rows<{case_id:string}>(f.db,'SELECT case_id FROM case_ln WHERE ln=$1',[ln]))[0];
 const s=await caseState(f.db,c.case_id),dates=await rows<{collection:string|null}>(f.db,'SELECT collection_date::text AS collection FROM specimen_round WHERE case_id=$1 ORDER BY round_number',[c.case_id]);
 return {round:s.rounds.map((r,i)=>({state:r.state,source:r.received_source,at:r.received_at?new Date(r.received_at).toISOString():null,collection:dates[i].collection})),orders:s.orders.length,verification:s.ln.verification,
  files:(await fileStates(f.db,ln)).map(x=>x.state),issues:(await openIssues(f.db,ln)).map(i=>[i.kind,i.details.fields])};
}

describe('P2-P3 synthetic integration contract',()=>{
 it('identity contract: P2 digest = identityLookup(JSON.stringify([normalizedLn,hn])) = P3 lnHnKey; leading zeros kept; LN alone never matches',async()=>{
  const r=await registerP2Case(f,{ln:'0099-0001-23456',hn:'00990001234'});
  expect(r).toMatchObject({outcome:'CREATED',intake:{outcome:'NO_INTAKE',fields:[]}});
  const row=(await rows<{ln:string;hn:string;identity_key:string}>(f.db,'SELECT l.ln,i.hn,c.identity_key FROM nipt_case c JOIN case_ln l ON l.case_id=c.id JOIN p2_case_identity i ON i.case_id=c.id WHERE c.id=$1',[r.caseId]))[0];
  expect(row).toMatchObject({ln:'0099000123456',hn:'00990001234'});
  expect(row.identity_key).toBe(identityLookup(JSON.stringify(['0099000123456','00990001234']),f.lookupKey));
  expect(row.identity_key).toBe(lnHnKey('0099000123456','00990001234',f.lookupKey));
  expect(defaultIdentitySource).toBe(p2IdentitySource);
  const registrant=await p2IdentitySource.forCase(f.db,r.caseId!);
  expect(registrant).toEqual({scheme:'P2_LN_HN',ln:'0099000123456',hn:'00990001234',key:row.identity_key});
  expect(compareRegistrant(registrant,pet('0099000123456','00990001234'),f.lookupKey)).toEqual({outcome:'MATCH'});
  expect(compareRegistrant(registrant,pet('0099000123456','990001234'),f.lookupKey)).toEqual({outcome:'MISMATCH',fields:['hn']});
  expect(compareRegistrant(registrant,pet('0099000123456','00990009999'),f.lookupKey)).toEqual({outcome:'MISMATCH',fields:['hn']});
  // A digest that is not the P2 pair for this LN/HN (P1 SYNTHETIC-ID or tampered) is unverified, never converted.
  expect(compareRegistrant({...registrant as {scheme:'P2_LN_HN';ln:string;hn:string;key:string},key:identityLookup('SYNTHETIC-ID-1',f.lookupKey)},pet('0099000123456','00990001234'),f.lookupKey)).toEqual({outcome:'UNVERIFIED'});
  expect(compareRegistrant({scheme:'P2_LN_HN',ln:'0099000123456',hn:'00990001234',key:lnHnKey('99000123456','00990001234',f.lookupKey)},pet('0099000123456','00990001234'),f.lookupKey)).toEqual({outcome:'UNVERIFIED'});
 });

 it('PET before vs after registration reaches the same terminal state for ANC and LAB_DIRECT, matching and mismatching',async()=>{
  let n=0;
  for(const origin of ['ANC','LAB_DIRECT'] as const)for(const matching of [true,false]){
   const petFirst=`99000150${++n}01`,regFirst=`99000150${n}02`,registrantHn=matching?HN:'9900006666';
   await writePet(f.root,DAY,{ln:petFirst,hn:HN,receivedAt:'20261012081500'});await cycle(f,{now:later(n*10)});
   expect(await fileStates(f.db,petFirst)).toEqual([{state:'Unlinked',error_code:null}]);
   const viaHook=await registerP2Case(f,{ln:petFirst,hn:registrantHn,origin});
   expect(viaHook).toMatchObject({outcome:'CREATED',intake:{outcome:matching?'APPLIED_S1':'IDENTITY_MISMATCH',fields:matching?[]:['hn']}});
   await register(f,{ln:regFirst,hn:registrantHn,origin});
   await writePet(f.root,DAY,{ln:regFirst,hn:HN,receivedAt:'20261012081500'});
   expect((await cycle(f,{now:later(n*10+1)})).counts[matching?'outcome_APPLIED_S1':'outcome_IDENTITY_MISMATCH']).toBe(1);
   const a=await terminal(petFirst),b=await terminal(regFirst);
   expect(a).toEqual(b);
   expect(a).toEqual(matching
    ?{round:[{state:'ReceivedInHIS',source:'HIS_PET_RECEIPT',at:'2026-10-12T01:15:00.000Z',collection:'2026-10-12'}],orders:1,verification:'VERIFIED_BY_PET',files:['Applied(S1)'],issues:[]}
    :{round:[{state:'Expected',source:null,at:null,collection:null}],orders:0,verification:'AWAITING_PET',files:['Unlinked'],issues:[['IDENTITY_MISMATCH',['hn']]]});
  }
  // Registration events identify the path; worker applies identify theirs.
  expect((await rows<{details:{via:string}}>(f.db,"SELECT details FROM case_event WHERE event_type='HIS_S1_RECEIVED' ORDER BY created_at")).map(e=>e.details.via).sort()).toEqual(['AUTOMATIC','AUTOMATIC','REGISTRATION','REGISTRATION']);
 });

 it('P1 synthetic legacy identity fails closed with audit and is never upgraded by LN equality or re-registration',async()=>{
  const ln='990001600001',legacy=await registerP1Legacy(f,{ln,legacyId:'SYNTHETIC-ID-7'});
  const digest=(await rows<{identity_key:string}>(f.db,'SELECT identity_key FROM nipt_case WHERE id=$1',[legacy]))[0].identity_key;
  await writePet(f.root,DAY,{ln,hn:HN,receivedAt:'20261012090000',identity:'SYNTHETIC-ID-7'});
  expect((await cycle(f,{now:NOW})).counts.outcome_IDENTITY_UNVERIFIED).toBe(1);
  expect((await caseState(f.db,legacy)).orders).toHaveLength(0);
  expect(await openIssues(f.db,ln)).toEqual([{kind:'IDENTITY_UNVERIFIED',state:'Open',case_id:legacy,details:{fields:[]}}]);
  expect(await rows(f.db,"SELECT action,details FROM audit_chain WHERE action='INBOUND_ISSUE_OPENED'")).toEqual([{action:'INBOUND_ISSUE_OPENED',details:{reasonCode:'IDENTITY_UNVERIFIED',synthetic:true}}]);
  // A Lab registration of the same LN with a P2 HN does not adopt or convert the legacy case.
  const attempt=await registerP2Case(f,{ln,hn:HN,origin:'LAB_DIRECT'});
  expect(attempt).toEqual({outcome:'IDENTITY_UNVERIFIED',caseId:null});
  expect((await rows<{identity_key:string}>(f.db,'SELECT identity_key FROM nipt_case WHERE id=$1',[legacy]))[0].identity_key).toBe(digest);
  expect(await rows(f.db,'SELECT 1 FROM p2_case_identity WHERE case_id=$1',[legacy])).toEqual([]);
  expect(await rows(f.db,"SELECT outcome,identifier_source FROM registration_attempt WHERE outcome='CONFLICT'")).toEqual([{outcome:'CONFLICT',identifier_source:'TUBE_LABEL'}]);
  const {lab}=await registrar(f.db);
  await expect(tx(()=>linkIntakeAtRegistration(f.db,lab,{caseId:legacy,ln,hn:HN,identifierSource:'TUBE_LABEL'},f.deps))).rejects.toThrow('IDENTITY_UNVERIFIED');
  expect((await caseState(f.db,legacy)).rounds[0].state).toBe('Expected');
 });

 it('the registration hook cannot be steered by a caller-supplied HN, another case or another unit',async()=>{
  const {anc,lab}=await registrar(f.db);
  const a=await register(f,{ln:'990001700001',hn:'00990001700'}),b=await register(f,{ln:'990001700002',hn:HN});
  const outsider:Staff={...await addUser(f.db,'ANC_NURSE','synthetic.p3.outsider'),unitIds:[(await rows<{id:string}>(f.db,"INSERT INTO unit(code,name) VALUES('SYNTHETIC_P3_OTHER','หน่วยอื่นจำลอง') RETURNING id"))[0].id]};
  const hook=(user:Staff,input:Record<string,unknown>)=>tx(()=>linkIntakeAtRegistration(f.db,user,{caseId:a,ln:'990001700001',hn:'00990001700',identifierSource:null,...input},f.deps));
  await expect(hook(anc,{hn:'990001700'})).rejects.toThrow('IDENTITY_UNVERIFIED'); // leading zeros are identity
  await expect(hook(anc,{hn:HN})).rejects.toThrow('IDENTITY_UNVERIFIED');
  await expect(hook(anc,{caseId:b})).rejects.toThrow('CASE_LN_MISMATCH');
  await expect(hook(outsider,{})).rejects.toThrow('FORBIDDEN');
  await expect(hook(anc,{identifierSource:'BARCODE'})).rejects.toThrow();
  expect(await hook(lab,{identifierSource:'PATIENT_DOCUMENT'})).toEqual({outcome:'NO_INTAKE',fields:[]});
 });

 it('registration and intake link commit or roll back together; a waiting intake without readable bytes fails closed',async()=>{
  const ln='990001800001';await writePet(f.root,DAY,{ln,hn:HN,receivedAt:'20261012090000'});await cycle(f,{now:NOW});
  const before=await auditCount(),{unit,lab}=await registrar(f.db);
  const input={ln,hn:HN,unitId:unit,origin:'LAB_DIRECT',identifierSource:'TUBE_LABEL',idempotencyKey:'p3_rollback_'+randomUUID().replaceAll('-','')};
  await expect(tx(async()=>{const r=await registerP2(f.db,lab,input,f.lookupKey,{store:f.store});expect(r).toMatchObject({intake:{outcome:'APPLIED_S1'}});throw Error('SIMULATED_ABORT_AFTER_LINK');})).rejects.toThrow('SIMULATED_ABORT_AFTER_LINK');
  const untouched=async()=>{
   expect(await rows(f.db,'SELECT 1 FROM case_ln WHERE ln=$1',[ln])).toEqual([]);expect(await rows(f.db,'SELECT 1 FROM his_order')).toEqual([]);
   expect(await rows(f.db,'SELECT 1 FROM registration_attempt WHERE idempotency_key=$1',[input.idempotencyKey])).toEqual([]);
   expect(await fileStates(f.db,ln)).toEqual([{state:'Unlinked',error_code:null}]);expect((await openIssues(f.db,ln)).map(i=>i.kind)).toEqual(['UNLINKED']);
   expect(await auditCount()).toBe(before);
  };
  await untouched();
  await expect(tx(()=>registerP2(f.db,lab,input,f.lookupKey))).rejects.toThrow('INTAKE_STORE_UNAVAILABLE');
  await untouched();
  expect(await tx(()=>registerP2(f.db,lab,input,f.lookupKey,{store:f.store}))).toMatchObject({outcome:'CREATED',intake:{outcome:'APPLIED_S1',fields:[]}});
 });

 it('an existing case outside the registrant unit is not disclosed, linked or opened; presence is Lab-only and value-free',async()=>{
  const ln='990001900001',caseId=await register(f,{ln,hn:HN});
  const outsider:Staff={...await addUser(f.db,'ANC_NURSE','synthetic.p3.other'),unitIds:[(await rows<{id:string}>(f.db,"INSERT INTO unit(code,name) VALUES('SYNTHETIC_P3_B','หน่วย B จำลอง') RETURNING id"))[0].id]};
  const events=(await rows(f.db,'SELECT 1 FROM case_event WHERE case_id=$1',[caseId])).length;
  const r=await tx(()=>registerP2(f.db,outsider,{ln,hn:HN,unitId:outsider.unitIds[0],origin:'ANC',idempotencyKey:'p3_outsider_'+randomUUID().replaceAll('-','')},f.lookupKey,{store:f.store}));
  expect(r).toEqual({outcome:'IDENTITY_UNVERIFIED',caseId:null});
  expect((await rows(f.db,'SELECT 1 FROM case_event WHERE case_id=$1',[caseId])).length).toBe(events);
  expect(await rows(f.db,"SELECT actor_id,resource_id,details FROM audit_chain WHERE action='CASE_REGISTRATION' AND details->>'outcome'='REJECTED'")).toEqual([{actor_id:outsider.id,resource_id:null,details:{origin:'ANC',outcome:'REJECTED',reasonCode:'IDENTITY_UNVERIFIED',synthetic:true}}]);
  const {anc,lab}=await registrar(f.db),waiting='990001900002';
  await writePet(f.root,DAY,{ln:waiting,hn:HN,name:'SYNTHETIC^^นาง ห้ามแสดง',receivedAt:'20261012090000'});await cycle(f,{now:NOW});
  await expect(tx(()=>registrationIntakePresence(f.db,anc,{ln:waiting}))).rejects.toThrow('FORBIDDEN');
  const present=await tx(()=>registrationIntakePresence(f.db,lab,{ln:'99-000-1-900002'}));
  expect(present).toEqual({unlinkedIntake:true});expect(JSON.stringify(present)).not.toMatch(/9900001001|ห้ามแสดง|SYNTHETIC/);
  expect(await tx(()=>registrationIntakePresence(f.db,lab,{ln}))).toEqual({unlinkedIntake:false});
  await expect(tx(()=>registrationIntakePresence(f.db,lab,{ln:'12345678'}))).rejects.toThrow();
  expect(await rows(f.db,"SELECT details FROM audit_chain WHERE action='INTAKE_PRESENCE_CHECKED' ORDER BY sequence")).toEqual([{details:{outcome:'PRESENT',synthetic:true}},{details:{outcome:'ABSENT',synthetic:true}}]);
 });

 it('same-key replay is idempotent; a replay with another identifier source or unit is an idempotency conflict',async()=>{
  const ln='990002000001';await writePet(f.root,DAY,{ln,hn:HN,receivedAt:'20261012090000'});await cycle(f,{now:NOW});
  const key='p3_replay_'+randomUUID().replaceAll('-','');
  const first=await registerP2Case(f,{ln,hn:HN,origin:'LAB_DIRECT',identifierSource:'REQUEST_FORM',idempotencyKey:key});
  expect(first).toMatchObject({outcome:'CREATED',intake:{outcome:'APPLIED_S1'}});
  expect(await registerP2Case(f,{ln,hn:HN,origin:'LAB_DIRECT',identifierSource:'REQUEST_FORM',idempotencyKey:key})).toEqual({caseId:first.caseId,outcome:'CREATED',intake:{outcome:'NO_INTAKE',fields:[]}});
  await expect(registerP2Case(f,{ln,hn:HN,origin:'LAB_DIRECT',identifierSource:'TUBE_LABEL',idempotencyKey:key})).rejects.toThrow('Idempotency conflict');
  const {lab}=await registrar(f.db),other=(await rows<{id:string}>(f.db,"INSERT INTO unit(code,name) VALUES('SYNTHETIC_P3_C','หน่วย C จำลอง') RETURNING id"))[0].id;
  await expect(tx(()=>registerP2(f.db,lab,{ln,hn:HN,unitId:other,origin:'LAB_DIRECT',identifierSource:'REQUEST_FORM',idempotencyKey:key},f.lookupKey,{store:f.store}))).rejects.toMatchObject({code:'IDEMPOTENCY_CONFLICT'});
  expect(await rows(f.db,'SELECT count(*)::int AS n FROM registration_attempt WHERE idempotency_key=$1',[key])).toEqual([{n:1}]);
  expect(await rows(f.db,'SELECT unit_id FROM case_unit_scope WHERE case_id=$1',[first.caseId])).toHaveLength(1);
  expect((await caseState(f.db,first.caseId!)).orders).toHaveLength(1);
 });

 it('collection provenance: HIS P[23] and receipt P[21] sit beside ANC evidence; a disagreement is recorded and never passes',async()=>{
  const {anc}=await registrar(f.db),ln='990002100001',caseId=await register(f,{ln,hn:HN});
  const draft=structuredClone(emptyRequest);draft.pregnancy.collectionDate='2026-10-10';draft.pregnancy.collectionSource='ANC';
  await tx(()=>saveRequest(f.db,anc,caseId,{expectedVersion:0,draft}));
  await writePet(f.root,DAY,{ln,hn:HN,receivedAt:'20261012101500',specimenAt:'20261011073000'});
  expect((await cycle(f,{now:NOW})).counts.outcome_APPLIED_S1).toBe(1);
  expect(await rows(f.db,'SELECT source,collection_date::text AS collection_date,reason FROM p2_collection_fact WHERE case_id=$1',[caseId])).toEqual([{source:'ANC',collection_date:'2026-10-10',reason:'SYNTHETIC_CAPTURE'}]);
  expect(await rows(f.db,"SELECT details FROM case_event WHERE case_id=$1 AND event_type='COLLECTION_PROVENANCE_CONFLICT'",[caseId])).toEqual([{details:{roundNumber:1,hisField:'specimenAt',sources:['ANC'],synthetic:true}}]);
  expect(await rows(f.db,"SELECT details FROM audit_chain WHERE action='COLLECTION_PROVENANCE_CONFLICT'")).toEqual([{details:{count:1,reasonCode:'HIS_COLLECTION_DIFFERS',synthetic:true}}]);
  const detail=await getCase(f.db,anc,caseId);
  expect(detail.roundReceipt).toMatchObject({receivedSource:'HIS_PET_RECEIPT',receivedAt:'2026-10-12T03:15:00.000000Z',collectionDate:'2026-10-11'});
  expect(detail.currentCollectionFacts).toEqual([expect.objectContaining({source:'ANC',collection_date:'2026-10-10'})]);
  expect(detail.gate).toMatchObject({passed:false});
  const next=await tx(()=>saveRequest(f.db,anc,caseId,{expectedVersion:detail.workspace.version,draft:detail.workspace.draft}));
  expect(next.clinical).toMatchObject({state:'ClinicalDataConflict',passed:false});
  // Agreeing sources record no conflict.
  const same='990002100002',other=await register(f,{ln:same,hn:HN});const agree=structuredClone(draft);agree.pregnancy.collectionDate='2026-10-12';
  await tx(()=>saveRequest(f.db,anc,other,{expectedVersion:0,draft:agree}));
  await writePet(f.root,DAY,{ln:same,hn:HN,receivedAt:'20261012101500',specimenAt:'20261012073000'});await cycle(f,{now:later(1)});
  expect(await rows(f.db,"SELECT 1 FROM case_event WHERE case_id=$1 AND event_type='COLLECTION_PROVENANCE_CONFLICT'",[other])).toEqual([]);
 });

 it('an S1 HIS receipt during active signing leaves signing, documents and workspace evidence untouched',async()=>{
  const {anc:base,unit}=await registrar(f.db),ln='990002200001',caseId=await register(f,{ln,hn:HN});
  const admin=await addUser(f.db,'APP_ADMIN','synthetic.p3.admin'),checker=await addUser(f.db,'CLINICAL_APPROVER','synthetic.p3.checker');
  await f.db.query('INSERT INTO user_unit_scope(user_id,unit_id) VALUES($1,$2)',[base.id,unit]);
  const auth=await tx(()=>authenticate(f.db,'synthetic.p3.registrar.anc',TEST_PASSWORD)),session=await readSession(f.db,auth!.token);const anc:Staff={...base,sessionId:session!.sessionId};
  const vector={width:600,height:200,strokes:[[[10,10],[80,90],[180,30]]]};
  const d=await tx(()=>doctorAction(f.db,admin,{action:'propose',doctorKey:'SYNTHETIC-DR-P3',name:'SYNTHETIC doctor P3',unitId:unit,effectiveFrom:'2020-01-01T00:00:00Z',authorization:'SYNTHETIC authorization',vector}));
  await tx(()=>doctorAction(f.db,checker,{action:'approve',id:d.id,reason:'SYNTHETIC checked'}));
  const draft=structuredClone(emptyRequest);draft.patient.syntheticName='SYNTHETIC PATIENT';draft.patient.dob='2000-01-01';
  Object.assign(draft.pregnancy,{type:'Singleton',edd:'2027-01-01',collectionDate:'2026-10-12',collectionSource:'ANC',weightKg:60,heightCm:160,vanishingTwin:'No',fetalSex:'DoNotWant',sca:'DoNotWant'});
  for(const k of ['transfusion4months','heparin24h','immune1month','albumin4weeks','exogenousDna4weeks'] as const)draft.history[k].answer='No';
  Object.assign(draft.history,{cancerTreatment:'No',gaUnder8:'No',tumor:'No',priorChromosomeTest:'No',otherHistory:'No'});draft.ordering.doctorVersionId=String(d.id);
  await tx(()=>saveRequest(f.db,anc,caseId,{expectedVersion:0,draft}));await tx(()=>lockRequest(f.db,anc,caseId,{expectedVersion:1,reason:'SYNTHETIC lock'}));
  const consent=await tx(()=>prepareConsent(f.db,anc,caseId,{doctorVersionId:String(d.id),representativeRequired:false,reason:'SYNTHETIC preparation'}));
  await tx(()=>startSigning(f.db,anc,caseId,{documentId:consent.id,devicePresent:true,syntheticPatient:true}));
  const evidence=async()=>({sessions:await rows(f.db,'SELECT id,state,document_id,closed_at FROM p2_signing_session WHERE case_id=$1',[caseId]),documents:await rows(f.db,'SELECT id,kind,version,content_hash FROM p2_document_revision WHERE case_id=$1 ORDER BY kind,version',[caseId]),workspace:await rows(f.db,'SELECT version,draft,request_mode,consent_mode FROM p2_workspace WHERE case_id=$1',[caseId]),acks:await rows(f.db,'SELECT item,answer FROM p2_request_ack WHERE case_id=$1',[caseId])});
  const before=await evidence();expect(before.sessions).toEqual([expect.objectContaining({state:'Active'})]);
  await writePet(f.root,DAY,{ln,hn:HN,receivedAt:'20261012101500',specimenAt:'20261012070000'});
  expect((await cycle(f,{now:NOW})).counts.outcome_APPLIED_S1).toBe(1);
  expect(await evidence()).toEqual(before);
  expect((await caseState(f.db,caseId)).rounds[0].state).toBe('ReceivedInHIS');
 });
});
