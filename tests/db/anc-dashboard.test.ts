import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import type {PGlite} from '@electric-sql/pglite';
import {testDatabase,addUser,TEST_PASSWORD} from '../helpers/database';
import {syntheticCase,receiveS1,tx} from '../helpers/lab';
import {dashboard} from '../../packages/anc/service';
import {authorize,type Principal} from '../../packages/security/policy';
import {authenticate,readSession} from '../../packages/security/session';
import {registerP2,saveRequest,lockRequest,doctorAction,prepareConsent,startSigning,patientAction} from '../../packages/p2/service';
import {emptyRequest} from '../../packages/p2/schema';
import {randomUUID} from 'node:crypto';
let db:PGlite,anc:Principal,unit:string,other:string,caseId:string;
function completeDraft(doctorVersionId:string){
 const d=structuredClone(emptyRequest);d.patient.syntheticName='SYNTHETIC ANC DASHBOARD';d.patient.dob='2000-01-01';d.patient.entitlement='SYNTHETIC SELF_PAY';d.patient.identifierType='Synthetic';d.patient.identifier='SYNTHETIC-ANC-DASH-0001';
 Object.assign(d.pregnancy,{type:'Singleton',edd:'2027-01-01',collectionDate:'2026-10-20',collectionSource:'ANC',weightKg:60,heightCm:160,vanishingTwin:'No',fetalSex:'DoNotWant',sca:'DoNotWant'});
 for(const k of ['transfusion4months','heparin24h','immune1month','albumin4weeks','exogenousDna4weeks'] as const)d.history[k].answer='No';
 Object.assign(d.history,{cancerTreatment:'No',gaUnder8:'No',tumor:'No',priorChromosomeTest:'No',otherHistory:'No'});Object.assign(d.ordering,{doctorVersionId,facility:'SYNTHETIC TEST UNIT',reason:'SYNTHETIC clinical review'});return d;
}
beforeAll(async()=>{
 db=await testDatabase();anc=await addUser(db,'ANC_NURSE','synthetic.anc.dashboard');
 unit=(await db.query<{id:string}>("INSERT INTO unit(code,name) VALUES('ANC-DASH-1','ANC 1') RETURNING id")).rows[0].id;
 other=(await db.query<{id:string}>("INSERT INTO unit(code,name) VALUES('ANC-DASH-2','ANC 2') RETURNING id")).rows[0].id;
 anc={...anc,unitIds:[unit]};
 await tx(db,async()=>{const c=await syntheticCase(db,{staff:anc,unit});caseId=c.caseId;
 await db.query("INSERT INTO p2_workspace(case_id,round_id,version,draft,request_mode,consent_mode,updated_by) VALUES($1,$2,0,'{}','Paper','Paper',$3)",[caseId,c.roundId,anc.id]);
 await receiveS1(db,c,new Date('2025-10-01T00:00:00Z'));await db.query('INSERT INTO case_unit_scope(case_id,unit_id) VALUES($1,$2)',[caseId,other]);});
 await tx(db,()=>syntheticCase(db,{staff:anc,unit:other},{evidence:false}));
});
afterAll(async()=>{await db?.close();});
describe('ANC read-only migrated database aggregation',()=>{
 it('deduplicates multi-unit cases and keeps cross-year pending with exact drilldown parity',async()=>{
  const before=(await db.query<{n:number}>('SELECT count(*)::int n FROM audit_chain')).rows[0].n;
  const d=await dashboard(db,anc,{fy:2570,kpi:'pending'});
  expect(d.metrics).toMatchObject({sent:0,pending:1,released:0});expect(d.queue.total).toBe(d.metrics.pending);
  expect(d.queue.items[0]).toMatchObject({id:caseId,stage:'received',documentsReady:true,unitIds:[unit]});
  expect(d.units).toEqual([{id:unit,name:'ANC 1'}]);expect(d.stages.reduce((n,s)=>n+s.count,0)).toBe(1);
  expect((await db.query<{n:number}>('SELECT count(*)::int n FROM audit_chain')).rows[0].n).toBe(before);
 });
 it('cross-unit grant expands read scope without multiplying cases',async()=>{
  const d=await dashboard(db,{...anc,permissions:['ANC_VIEW_ALL_UNITS']},{fy:2569});
  expect(d.queue.total).toBe(2);expect(d.metrics.sent).toBe(1);expect(d.metrics.pending).toBe(1);
  expect(d.queue.items.filter(c=>c.id===caseId)).toHaveLength(1);
 });
 it('system-wide Admin reads every ANC unit without granting sign-off rights',async()=>{
  const admin=await addUser(db,'APP_ADMIN','synthetic.anc.dashboard.system-admin');
  const d=await dashboard(db,admin,{fy:2569});
  expect(d.scope).toMatchObject({allUnits:true});expect(d.units.map(x=>x.id).sort()).toEqual([unit,other].sort());expect(d.queue.total).toBe(2);
  expect(authorize(admin,'consent.sign.patient',{},'write')).toBe(false);
 });
 it('rejects unauthorized unit, non-reader, invalid filters and suspended session',async()=>{
  await expect(dashboard(db,anc,{unitId:other})).rejects.toThrow('FORBIDDEN');
  await expect(dashboard(db,{...anc,roles:['IT_OPERATOR']},{})).rejects.toThrow('FORBIDDEN');
  await expect(dashboard(db,{...anc,roles:['AUDITOR']},{})).rejects.toThrow('FORBIDDEN');
  await expect(dashboard(db,{...anc,roles:['LAB_STAFF']},{})).rejects.toThrow('FORBIDDEN');
  await expect(dashboard(db,anc,{flag:'invented'})).rejects.toThrow();
  await expect(dashboard(db,{...anc,sessionId:'00000000-0000-4000-8000-000000000001'},{})).rejects.toThrow('UNAUTHENTICATED');
 });
 it('uses recorded withdrawal as attention and document unready without inferring clinical acceptance',async()=>{
  const round=(await db.query<{id:string}>('SELECT current_round_id id FROM nipt_case WHERE id=$1',[caseId])).rows[0].id;
  await db.query("INSERT INTO p2_revocation(case_id,round_id,stage,reason,actor_id) VALUES($1,$2,'W0','SYNTHETIC_WITHDRAWAL',$3)",[caseId,round,anc.id]);
  const d=await dashboard(db,anc,{flag:'consent_revoked'});
  expect(d.queue.total).toBe(1);expect(d.queue.items[0].documentsReady).toBe(false);
  expect(d.queue.items[0].flags).toContain('consent_revoked');
 });
 it('finds a scoped ANC case by stored patient name without changing dashboard counts',async()=>{
  await db.query('BEGIN');
  try{
   await db.query("UPDATE p2_workspace SET version=version+1,draft=jsonb_set(draft,'{patient}',jsonb_build_object('syntheticName','SYNTHETIC-NAME-LOOKUP'),true) WHERE case_id=$1",[caseId]);
   const result=await dashboard(db,anc,{q:'NAME-LOOKUP'});
   expect(result.queue.items.map(c=>c.id)).toContain(caseId);
   expect(result.queue.items.find(c=>c.id===caseId)?.patientName).toBe('SYNTHETIC-NAME-LOOKUP');
  }finally{await db.query('ROLLBACK');}
 });
 it('does not reappear in ANC overview after an erroneous registration is voided',async()=>{
  await db.query('BEGIN');
  try{
   const created=await syntheticCase(db,{staff:anc,unit},{evidence:false});
   await db.query('INSERT INTO p2_registration_void(case_id,actor_id,reason) VALUES($1,$2,$3)',[created.caseId,anc.id,'SYNTHETIC incorrect registration']);
   const result=await dashboard(db,anc,{pageSize:100});
   expect(result.queue.items.some(c=>c.id===created.caseId)).toBe(false);
  }finally{await db.query('ROLLBACK');}
 });
 it('reads more than 200 cases and returns exact last-page totals in a read-only transaction',async()=>{
  await db.query('BEGIN');
  try{
   for(let n=0;n<205;n++)await syntheticCase(db,{staff:anc,unit},{evidence:false});
   await db.query('COMMIT');
   await db.query('BEGIN');await db.query('SELECT 1');await db.query('SET TRANSACTION READ ONLY');
   const d=await dashboard(db,anc,{page:11,pageSize:20});
   expect(d.queue.total).toBe(206);expect(d.queue.items).toHaveLength(6);
   expect(d.stages.reduce((n,s)=>n+s.count,0)).toBe(206);
  }finally{await db.query('ROLLBACK');}
 });
 it('SQL excludes notices, old rounds, superseded/voided versions and release records',async()=>{
  const round=(await db.query<{id:string}>('SELECT current_round_id id FROM nipt_case WHERE id=$1',[caseId])).rows[0].id;
  // Deliberately adversarial rows only in this disposable in-memory transaction.
  // Skip release-authority triggers for fixture insertion, never in application code.
  for(const fixture of [
   {kind:'RESULT',versionState:'CertifiedReleased',releaseState:'Active',current:true,expected:1},
   {kind:'REDRAW_NOTICE',versionState:'CertifiedReleased',releaseState:'Active',current:true,expected:0},
   {kind:'RESULT',versionState:'Superseded',releaseState:'Active',current:true,expected:0},
   {kind:'RESULT',versionState:'Voided',releaseState:'Active',current:true,expected:0},
   {kind:'RESULT',versionState:'CertifiedReleased',releaseState:'Superseded',current:true,expected:0},
   {kind:'RESULT',versionState:'CertifiedReleased',releaseState:'Voided',current:true,expected:0},
   {kind:'RESULT',versionState:'CertifiedReleased',releaseState:'Active',current:false,expected:0},
  ]){
   await db.query('BEGIN');
   try{
    await db.query('SET LOCAL session_replication_role=replica');
    const id=randomUUID(),r=fixture.current?round:randomUUID();
    await db.query(`INSERT INTO result_report_version(id,intake_file_id,sha256,kind,template_kind,template_version,parser_version,parsed,state,case_id,round_id,attempt_id,link_mode,imported_by) VALUES($1,$2,$3,$4,$5,'SYNTHETIC-v1','SYNTHETIC-v1','{}',$6,$7,$8,$9,'MANUAL_REVIEWED',$10)`,[id,randomUUID(),id.replaceAll('-','').repeat(2),fixture.kind,fixture.kind==='RESULT'?'SINGLETON':'REDRAW_NOTICE',fixture.versionState,caseId,r,randomUUID(),anc.id]);
    await db.query(`INSERT INTO result_release(version_id,case_id,round_id,kind,channel,state,certified_by) VALUES($1,$2,$3,$4,'NIPT_ANC_VIEW',$5,$6)`,[id,caseId,r,fixture.kind,fixture.releaseState,anc.id]);
    const d=await dashboard(db,anc,{kpi:'released'});
    expect(d.metrics.released).toBe(fixture.expected);expect(d.queue.total).toBe(fixture.expected);
   }finally{await db.query('ROLLBACK');}
  }
 });
 it('binds readiness to active modes, current request/version and one immutable granted consent',async()=>{
  vi.stubEnv('NIPT_MODE','synthetic');
  await db.query('BEGIN');
  try{
   const paperCase=await syntheticCase(db,{staff:anc,unit});
   const paperReady=async()=> (await dashboard(db,anc,{q:paperCase.ln})).queue.items[0]?.documentsReady??false;
   // A historical paper review without a current workspace never establishes readiness.
   expect(await paperReady()).toBe(false);
   await db.query("INSERT INTO p2_workspace(case_id,round_id,version,draft,request_mode,consent_mode,updated_by) VALUES($1,$2,0,'{}','Paper','Paper',$3)",[paperCase.caseId,paperCase.roundId,anc.id]);
   expect(await paperReady()).toBe(true);
   await db.query("INSERT INTO p2_paper_review(case_id,round_id,kind,template_version,document_reference,panel,status,location,reason,verifier_id,created_at) VALUES($1,$2,'CONSENT','SYNTHETIC-FM02-v1','SYNTHETIC-DECLINED','{\"decision\":\"Declined\"}','Declined','SYNTHETIC','SYNTHETIC_TEST',$3,now()+interval '1 second')",[paperCase.caseId,paperCase.roundId,anc.id]);
   expect(await paperReady()).toBe(false); // A recorded paper refusal remains a gate.

   const admin=await addUser(db,'APP_ADMIN','synthetic.anc.dashboard.admin'),checker=await addUser(db,'CLINICAL_APPROVER','synthetic.anc.dashboard.checker');
   const login=await authenticate(db,'synthetic.anc.dashboard',TEST_PASSWORD);if(!login)throw new Error('SYNTHETIC_LOGIN_FAILED');
   const session=await readSession(db,login.token);if(!session)throw new Error('SYNTHETIC_SESSION_MISSING');
   const staff={...anc,unitIds:[unit],sessionId:session.sessionId};
   const doctor=await doctorAction(db,admin,{action:'propose',doctorKey:'SYNTHETIC-ANC-DASH-'+randomUUID().slice(0,8).toUpperCase(),name:'SYNTHETIC ANC Dashboard Doctor',unitId:unit,effectiveFrom:'2020-01-01T00:00:00Z',authorization:'SYNTHETIC authorization',vector:{width:600,height:200,strokes:[[[10,10],[80,90],[180,30]]]}});
   const doctorId=String(doctor.id);await doctorAction(db,checker,{action:'approve',id:doctorId,reason:'SYNTHETIC independent approval'});
   const suffix=Date.now().toString().slice(-6),ln='009900'+suffix,hn='009900'+suffix.slice(-4);
   const registered=await registerP2(db,staff,{ln,hn,unitId:unit,origin:'ANC',idempotencyKey:'SYNTHETIC_ANC_DASHBOARD_'+randomUUID()},Buffer.alloc(32,7));
   if(!registered.caseId)throw new Error('SYNTHETIC_CASE_REGISTRATION_FAILED');
   const request=completeDraft(doctorId),saved=await saveRequest(db,staff,registered.caseId,{expectedVersion:0,draft:request});
   await lockRequest(db,staff,registered.caseId,{expectedVersion:saved.version,reason:'SYNTHETIC request lock'});
   const consent=await prepareConsent(db,staff,registered.caseId,{doctorVersionId:doctorId,representativeRequired:false,reason:'SYNTHETIC consent preparation'});
   const signing=await startSigning(db,staff,registered.caseId,{documentId:consent.id,devicePresent:true,syntheticPatient:true});
   const csrf={origin:'http://localhost:3000',expectedOrigin:'http://localhost:3000',token:signing.csrf};
   for(let item=1;item<=12;item++)await patientAction(db,signing.raw,{action:'acknowledge',item},csrf);
   await patientAction(db,signing.raw,{action:'complete',decision:'Granted',vector:{width:600,height:200,strokes:[[[10,10],[80,90],[180,30]]]}},csrf);
   const returnedLogin=await authenticate(db,'synthetic.anc.dashboard',TEST_PASSWORD);if(!returnedLogin)throw new Error('SYNTHETIC_RETURN_LOGIN_FAILED');
   const returnedSession=await readSession(db,returnedLogin.token);if(!returnedSession)throw new Error('SYNTHETIC_RETURN_SESSION_MISSING');
   const returnedStaff={...staff,sessionId:returnedSession.sessionId};
   const electronicReady=async()=> (await dashboard(db,returnedStaff,{q:ln})).queue.items.find(item=>item.ln===ln)?.documentsReady??false;
   expect(await electronicReady()).toBe(true);
   const finalRows=await db.query<{session_id:string;document_id:string;payload:unknown;content_hash:string;hash_algorithm:string}>("SELECT f.session_id,f.document_id,f.payload,f.content_hash,f.hash_algorithm FROM p2_final_consent f JOIN p2_document_revision d ON d.id=f.document_id WHERE d.case_id=$1",[registered.caseId]);
   expect(finalRows.rows).toHaveLength(1);
   await db.query('SAVEPOINT duplicate_consent_attempt');
   await expect(db.query('INSERT INTO p2_final_consent(id,session_id,document_id,payload,content_hash,hash_algorithm) VALUES($1,$2,$3,$4,$5,$6)',[randomUUID(),finalRows.rows[0].session_id,finalRows.rows[0].document_id,finalRows.rows[0].payload,finalRows.rows[0].content_hash,finalRows.rows[0].hash_algorithm])).rejects.toThrow('CONSENT_ALREADY_COMPLETED');
   await db.query('ROLLBACK TO SAVEPOINT duplicate_consent_attempt');
   expect((await db.query("SELECT f.id FROM p2_final_consent f JOIN p2_document_revision d ON d.id=f.document_id WHERE d.case_id=$1",[registered.caseId])).rows).toHaveLength(1);
   await expect(prepareConsent(db,returnedStaff,registered.caseId,{doctorVersionId:doctorId,representativeRequired:false,reason:'SYNTHETIC duplicate attempt'})).rejects.toThrow('CONSENT_ALREADY_COMPLETED');

   // A same-round Request amendment invalidates its old Request and consent bindings; the signed Consent stays singular and immutable.
   const amendedDraft=structuredClone(request);amendedDraft.patient.syntheticName='SYNTHETIC AMENDED REQUEST';
   const amended=await saveRequest(db,returnedStaff,registered.caseId,{expectedVersion:saved.version,draft:amendedDraft,reason:'SYNTHETIC request amendment after consent'});
   expect(await electronicReady()).toBe(false);
   await lockRequest(db,returnedStaff,registered.caseId,{expectedVersion:amended.version,reason:'SYNTHETIC amended request lock'});
   expect(await electronicReady()).toBe(false); // Request is current, but the single Consent remains bound to the earlier workspace version.
   expect((await db.query("SELECT f.id FROM p2_final_consent f JOIN p2_document_revision d ON d.id=f.document_id WHERE d.case_id=$1",[registered.caseId])).rows).toHaveLength(1);
  }finally{await db.query('ROLLBACK');vi.unstubAllEnvs();}
 });
});
