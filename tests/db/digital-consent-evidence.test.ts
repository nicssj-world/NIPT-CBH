import {beforeAll,afterAll,describe,it,expect,vi} from 'vitest';
import type {PGlite} from '@electric-sql/pglite';
import {testDatabase,addUser,TEST_PASSWORD} from '../helpers/database';
import {authenticate,readSession} from '../../packages/security/session';
import {registerP2,saveRequest,doctorAction,prepareConsent,startSigning,patientAction,setModes,getCase,approveClinicalP2,contentHash,type Staff} from '../../packages/p2/service';
import {createDocumentPreview} from '../../packages/p2/documents';
import {emptyRequest} from '../../packages/p2/schema';
import {renderP2Pdf} from '../../packages/pdf/p2';
import {verifyAuditChain} from '../../packages/db/audit';

// Go-Live check of Digital Consent after the Paper Consent correction (2026-10-18): the patient signs on the Signature Pad, the doctor
// signature is the Doctor Registry version chosen on the same request, and the evidence chain DB → API service → PDF → audit is intact.
const key=Buffer.alloc(32,7),origin='http://localhost:3000',vector={width:600,height:200,strokes:[[[10,10],[80,90],[180,30]]]};
let db:PGlite,anc:Staff,admin:Staff,checker:Staff,reviewer:Staff,unit:string,caseId:string,doctorId:string,otherDoctorId:string;
async function tx<T>(fn:()=>Promise<T>){await db.query('BEGIN');try{const r=await fn();await db.query('COMMIT');return r;}catch(e){await db.query('ROLLBACK');throw e;}}
async function doctor(k:string,name:string){const d=await tx(()=>doctorAction(db,admin,{action:'propose',doctorKey:k,name,unitId:unit,effectiveFrom:'2020-01-01T00:00:00Z',authorization:'SYNTHETIC authorization',vector}));await tx(()=>doctorAction(db,checker,{action:'approve',id:d.id,reason:'SYNTHETIC checked'}));return String(d.id);}
const loginAnc=async()=>{const auth=await tx(()=>authenticate(db,'synthetic.anc',TEST_PASSWORD));anc={...anc,sessionId:(await readSession(db,auth!.token))!.sessionId};};
async function pdfFacts(bytes:Buffer){
 const pdfjs=await import('pdfjs-dist/legacy/build/pdf.mjs');const doc=await pdfjs.getDocument({data:new Uint8Array(bytes),verbosity:0}).promise;let text='',images=0;
 for(let n=1;n<=doc.numPages;n++){const p=await doc.getPage(n);text+=(await p.getTextContent()).items.map(i=>'str' in i?i.str:'').join(' ');const ops=await p.getOperatorList();images+=ops.fnArray.filter(f=>f===pdfjs.OPS.paintImageXObject||f===pdfjs.OPS.paintInlineImageXObject).length;}
 return {text:text.replace(/\s+/g,''),images};
}
function completeDraft(doctorVersionId:string){
 const d=structuredClone(emptyRequest);d.patient.syntheticName='SYNTHETIC PATIENT';d.patient.dob='2000-01-01';d.patient.entitlement='SELF_PAY';d.patient.identifierType='ThaiNationalId';d.patient.identifier='0000000000001';
 Object.assign(d.pregnancy,{type:'Singleton',edd:'2027-01-01',collectionDate:'2026-08-01',collectionSource:'ANC',weightKg:60,heightCm:160,vanishingTwin:'No',fetalSex:'DoNotWant',sca:'DoNotWant'});
 for(const k of ['transfusion4months','heparin24h','immune1month','albumin4weeks','exogenousDna4weeks'] as const)d.history[k].answer='No';
 Object.assign(d.history,{cancerTreatment:'No',gaUnder8:'No',tumor:'No',priorChromosomeTest:'No',otherHistory:'No'});Object.assign(d.ordering,{doctorVersionId,facility:'SYNTHETIC TEST UNIT',reason:'SYNTHETIC clinical review'});return d;
}

describe('Digital Consent evidence chain',()=>{
 beforeAll(async()=>{
  db=await testDatabase();anc=await addUser(db,'ANC_NURSE','synthetic.anc');admin=await addUser(db,'APP_ADMIN','synthetic.admin');checker=await addUser(db,'CLINICAL_APPROVER','synthetic.checker');reviewer=await addUser(db,'CLINICAL_APPROVER','synthetic.reviewer');reviewer.roles=['CLINICAL_APPROVER','LAB_STAFF'];
  unit=(await db.query<{id:string}>("INSERT INTO unit(code,name) VALUES('SYNTHETIC_ANC','จำลอง') RETURNING id")).rows[0].id;anc.unitIds=[unit];reviewer.unitIds=[unit];await db.query('INSERT INTO user_unit_scope(user_id,unit_id) VALUES($1,$2)',[anc.id,unit]);
  const auth=await tx(()=>authenticate(db,'synthetic.anc',TEST_PASSWORD));anc={...anc,sessionId:(await readSession(db,auth!.token))!.sessionId};
  caseId=(await tx(()=>registerP2(db,anc,{ln:'009900020001',hn:'0099000200',unitId:unit,origin:'ANC',idempotencyKey:'SYNTHETIC_REGISTER_DIGITAL'},key))).caseId!;
  doctorId=await doctor('SYNTHETIC-DR-A','SYNTHETIC นพ.ทะเบียน เอ');otherDoctorId=await doctor('SYNTHETIC-DR-B','SYNTHETIC นพ.ทะเบียน บี');
 },120000);
 afterAll(async()=>{await db?.close();});

 it('a consent can only name the request doctor; the Doctor Registry signature travels into the immutable document',async()=>{
  const d=structuredClone(emptyRequest);d.ordering.doctorVersionId=doctorId;await tx(()=>saveRequest(db,anc,caseId,{expectedVersion:0,draft:d}));
  await expect(tx(()=>prepareConsent(db,anc,caseId,{doctorVersionId:otherDoctorId,representativeRequired:false,reason:'SYNTHETIC wrong doctor'}))).rejects.toThrow('CONSENT_DOCTOR_MUST_MATCH_REQUEST');
  const r=await tx(()=>prepareConsent(db,anc,caseId,{doctorVersionId:doctorId,representativeRequired:false,reason:'SYNTHETIC prepare'}));
  const doc=(await db.query<{payload:{doctor:{id:string;name:string;signature_png:string;signature_hash:string};unsigned:boolean}}>('SELECT payload FROM p2_document_revision WHERE id=$1',[r.id])).rows[0].payload;
  const registry=(await db.query<{name:string;signature_png:string;signature_hash:string}>('SELECT name,signature_png,signature_hash FROM p2_doctor_version WHERE id=$1',[doctorId])).rows[0];
  expect(doc.doctor).toMatchObject({id:doctorId,name:registry.name,signature_png:registry.signature_png,signature_hash:registry.signature_hash});expect(registry.signature_png.length).toBeGreaterThan(100);
  expect(doc.unsigned).toBe(true); // the prepared document carries the doctor's stored signature but no patient decision
 });

 it('patient Signature Pad: 12 acknowledgements, stored vector+PNG+hash, final consent on completion; PDF shows both signatures',async()=>{
  const doc=(await db.query<{id:string}>("SELECT id FROM p2_document_revision WHERE case_id=$1 AND kind='CONSENT' ORDER BY version DESC LIMIT 1",[caseId])).rows[0];
  const s=await tx(()=>startSigning(db,anc,caseId,{documentId:doc.id,devicePresent:true,syntheticPatient:true}));
  const act=(a:object)=>tx(()=>patientAction(db,s.raw,a,{origin,expectedOrigin:origin,token:s.csrf}));
  await expect(act({action:'complete',decision:'Granted',vector})).rejects.toThrow('TWELVE_ACKNOWLEDGMENTS_REQUIRED'); // no signature without all 12
  for(let item=1;item<=12;item++)await act({action:'acknowledge',item});
  await act({action:'complete',decision:'Granted',vector});
  expect((await db.query('SELECT 1 FROM p2_final_consent')).rows).toHaveLength(1); // completion freezes the patient's decision and evidence
  await loginAnc(); // staff returns through the ordinary login flow on a new session
  const sig=(await db.query<{decision:string;png:string;signature_hash:string}>('SELECT decision,png,signature_hash FROM p2_consent_signature WHERE document_id=$1',[doc.id])).rows;
  expect(sig).toHaveLength(1);expect(sig[0]).toMatchObject({decision:'Granted'});expect(sig[0].signature_hash).toHaveLength(64);expect(sig[0].png.length).toBeGreaterThan(100);
  const fin=(await db.query<{payload:{signature:{png:string;decision:string};acknowledgments:unknown[];document:{doctor:{signature_hash:string}}}}>('SELECT payload FROM p2_final_consent WHERE document_id=$1',[doc.id])).rows;
  expect(fin).toHaveLength(1);expect(fin[0].payload.acknowledgments).toHaveLength(12);expect(fin[0].payload.signature.png).toBe(sig[0].png);
  expect(fin[0].payload.document.doctor.signature_hash).toBe((await db.query<{signature_hash:string}>('SELECT signature_hash FROM p2_doctor_version WHERE id=$1',[doctorId])).rows[0].signature_hash);
  // Real Chromium render of the stored document: the patient decision, the doctor's name and BOTH signature images are on the PDF.
  const preview=await tx(()=>createDocumentPreview(db,anc,caseId,doc.id,renderP2Pdf));expect(preview.id).toBeTruthy();
  const bytes=(await import('../../packages/p2/documents')).readDocumentPreview;const read=await tx(()=>bytes(db,anc,preview.id,'download'));
  const facts=await pdfFacts(read.bytes);
  expect(facts.text).toContain('SYNTHETICนพ.ทะเบียนเอ');expect(facts.text).not.toContain('นพ.ทะเบียนบี');expect(facts.text).toContain('0099000200');expect(facts.text).toContain('009900020001'); // the registry doctor of THIS request and THIS patient's LN/HN, not another doctor
  expect(facts.text).toContain('Granted');expect(facts.images).toBeGreaterThanOrEqual(2);
  // Audit trail: every step is recorded in order, the hash chain verifies, and the document read is logged.
  const events=(await db.query<{event_type:string}>("SELECT event_type FROM case_event WHERE case_id=$1 AND event_type LIKE 'P2_%' ORDER BY created_at,id",[caseId])).rows.map(e=>e.event_type);
  const at=(t:string)=>events.indexOf(t);
  expect(at('P2_CONSENT_PREPARED')).toBeGreaterThan(-1);expect(at('P2_SIGNING_STARTED')).toBeGreaterThan(at('P2_CONSENT_PREPARED'));expect(at('P2_CONSENT_GRANTED')).toBeGreaterThan(at('P2_SIGNING_STARTED'));
  expect((await db.query("SELECT 1 FROM p2_document_access WHERE document_id=$1 AND intent='download'",[doc.id])).rows).toHaveLength(1);
  expect(verifyAuditChain((await db.query<{previous_hash:string;hash:string;payload:string}>('SELECT * FROM audit_chain ORDER BY sequence')).rows)).toBe(true);
 },120000);

 it('one immutable signed consent is reused across redraw rounds without allowing a second signature',async()=>{
  const initial=await getCase(db,anc,caseId);
  const firstFinal=initial.finalConsents[0];
  expect(firstFinal).toBeTruthy();
  await expect(tx(()=>setModes(db,anc,caseId,{expectedVersion:initial.workspace.version,requestMode:'Electronic',consentMode:'Paper',reason:'SYNTHETIC prohibited channel change'}))).rejects.toThrow('CONSENT_ALREADY_COMPLETED');
  await expect(tx(()=>prepareConsent(db,anc,caseId,{doctorVersionId:doctorId,representativeRequired:false,reason:'SYNTHETIC attempted replacement'}))).rejects.toThrow('CONSENT_ALREADY_COMPLETED');
  const previous=initial.case.current_round_id;
  await db.query("UPDATE specimen_round SET state='RedrawRequested' WHERE id=$1",[previous]);
  const roundState=await db.query<{case_ln_id:string}>('SELECT case_ln_id FROM specimen_round WHERE id=$1',[previous]);
  const redraw=(await db.query<{id:string}>("INSERT INTO redraw_request(case_id,source_round_id,reason_code) VALUES($1,$2,'SYNTHETIC_REDRAW') RETURNING id",[caseId,previous])).rows[0].id;
  const newRound=(await db.query<{id:string}>('INSERT INTO specimen_round(case_id,case_ln_id,round_number,redraw_request_id) VALUES($1,$2,2,$3) RETURNING id',[caseId,roundState.rows[0].case_ln_id,redraw])).rows[0].id;
  await db.query('UPDATE nipt_case SET current_round_id=$1 WHERE id=$2',[newRound,caseId]);
  const current=await getCase(db,anc,caseId);
  expect(current.finalConsents).toHaveLength(1);
  expect(current.finalConsents[0].document_id).toBe(firstFinal.document_id);
  expect(current.consentDecision).toBe('Granted');
  const source=(await db.query<{src:{caseFinalConsent:{document_id:string;round_id:string};finalConsent:null}}> ('SELECT p2_clinical_source($1) AS src',[newRound])).rows[0].src;
  expect(source.caseFinalConsent.document_id).toBe(firstFinal.document_id);
  expect(source.caseFinalConsent.round_id).toBe(previous);
  expect(source.finalConsent).toBeNull();
  // A redraw can use a new Request document without forcing the patient to
  // sign Consent again. The current round's independent evidence is still required.
  const nextVersion=(await getCase(db,anc,caseId)).workspace.version;
  await tx(()=>setModes(db,anc,caseId,{expectedVersion:nextVersion,requestMode:'Paper',consentMode:'Electronic',reason:'SYNTHETIC S2 paper request'}));
  await db.query("INSERT INTO p2_paper_review(case_id,round_id,kind,template_version,document_reference,panel,status,location,reason,verifier_id) VALUES($1,$2,'REQUEST','SYNTHETIC-FM01-v1','S2-REQUEST-TEST','{}','Verified','SYNTHETIC-ROOM','SYNTHETIC review',$3)",[caseId,newRound,anc.id]);
  await db.query("INSERT INTO p2_collection_fact(case_id,round_id,source,collection_date,actor_id,reason) VALUES($1,$2,'ANC','2026-10-20',$3,'SYNTHETIC S2 collection date')",[caseId,newRound,anc.id]);
  expect((await db.query<{ready:boolean}>('SELECT p2_clinical_documents_ready($1) AS ready',[newRound])).rows[0].ready).toBe(true);
  await expect(tx(()=>prepareConsent(db,anc,caseId,{doctorVersionId:doctorId,representativeRequired:false}))).rejects.toThrow('CONSENT_ALREADY_COMPLETED');
  expect((await db.query<{n:number}>('SELECT count(*)::int n FROM p2_final_consent')).rows[0].n).toBe(1);
 });

 it('does not approve a same-round Request amendment under an older signed Consent',async()=>{
  vi.stubEnv('NIPT_MODE','synthetic');await loginAnc();
  const id=(await tx(()=>registerP2(db,anc,{ln:'009900020002',hn:'0099000201',unitId:unit,origin:'ANC',idempotencyKey:'SYNTHETIC_STALE_CONSENT_APPROVAL'},key))).caseId!;
  const initial=structuredClone(emptyRequest);initial.ordering.doctorVersionId=doctorId;
  const saved=await tx(()=>saveRequest(db,anc,id,{expectedVersion:0,draft:initial}));
  const consent=await tx(()=>prepareConsent(db,anc,id,{doctorVersionId:doctorId,representativeRequired:false,reason:'SYNTHETIC initial consent'}));
  const signing=await tx(()=>startSigning(db,anc,id,{documentId:consent.id,devicePresent:true,syntheticPatient:true}));
  const act=(input:object)=>tx(()=>patientAction(db,signing.raw,input,{origin,expectedOrigin:origin,token:signing.csrf}));
  for(let item=1;item<=12;item++)await act({action:'acknowledge',item});
  await act({action:'complete',decision:'Granted',vector});
  await loginAnc(); // Signing suspends the staff session until the ordinary return-to-staff login.

  const draft=completeDraft(doctorId);vi.stubEnv('NIPT_MODE','operational');vi.stubEnv('APP_ORIGIN','https://nipt.hospital.invalid');
  const revised=await tx(()=>saveRequest(db,anc,id,{expectedVersion:saved.version,draft,reason:'SYNTHETIC request amended after consent'}));
  const payload={workspaceVersion:revised.version,draft:revised.draft};
  await db.query("INSERT INTO p2_document_revision(case_id,round_id,kind,version,template_version,payload,content_hash,reason,created_by) VALUES($1,$2,'REQUEST',1,'CBH-FM01-v1',$3,$4,'SYNTHETIC revised Request',$5)",[id,(await getCase(db,anc,id)).case.current_round_id,payload,contentHash(payload),anc.id]);
  await db.query('BEGIN');
  try{
   await expect(approveClinicalP2(db,reviewer,id,{expectedVersion:revised.version,reason:'SYNTHETIC review',sourceReference:'SYNTHETIC current request',attestation:true})).rejects.toMatchObject({code:'CURRENT_GRANTED_CONSENT_REQUIRED'});
  }finally{await db.query('ROLLBACK');vi.unstubAllEnvs();}
 });
});
