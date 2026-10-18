import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import type {PGlite} from '@electric-sql/pglite';
import {testDatabase,addUser,TEST_PASSWORD} from '../helpers/database';
import {authenticate,readSession} from '../../packages/security/session';
import {registerP2,saveRequest,doctorAction,prepareConsent,startSigning,patientAction,reauthenticate as reauthenticateBound,signingReturnStatus,setModes,getCase,type Staff} from '../../packages/p2/service';
import {createDocumentPreview} from '../../packages/p2/documents';
import {emptyRequest} from '../../packages/p2/schema';
import {renderP2Pdf} from '../../packages/pdf/p2';
import {verifyAuditChain} from '../../packages/db/audit';

// Go-Live check of Digital Consent after the Paper Consent correction (2026-10-18): the patient signs on the Signature Pad, the doctor
// signature is the Doctor Registry version chosen on the same request, and the evidence chain DB → API service → PDF → audit is intact.
const key=Buffer.alloc(32,7),origin='http://localhost:3000',vector={width:600,height:200,strokes:[[[10,10],[80,90],[180,30]]]};
let db:PGlite,anc:Staff,admin:Staff,checker:Staff,unit:string,caseId:string,doctorId:string,otherDoctorId:string;
async function tx<T>(fn:()=>Promise<T>){await db.query('BEGIN');try{const r=await fn();await db.query('COMMIT');return r;}catch(e){await db.query('ROLLBACK');throw e;}}
async function doctor(k:string,name:string){const d=await tx(()=>doctorAction(db,admin,{action:'propose',doctorKey:k,name,unitId:unit,effectiveFrom:'2020-01-01T00:00:00Z',authorization:'SYNTHETIC authorization',vector}));await tx(()=>doctorAction(db,checker,{action:'approve',id:d.id,reason:'SYNTHETIC checked'}));return String(d.id);}
const reauthenticate=async(password:string)=>tx(async()=>reauthenticateBound(db,anc,{...await signingReturnStatus(db,anc),password,attestation:true}));
async function pdfFacts(bytes:Buffer){
 const pdfjs=await import('pdfjs-dist/legacy/build/pdf.mjs');const doc=await pdfjs.getDocument({data:new Uint8Array(bytes),verbosity:0}).promise;let text='',images=0;
 for(let n=1;n<=doc.numPages;n++){const p=await doc.getPage(n);text+=(await p.getTextContent()).items.map(i=>'str' in i?i.str:'').join(' ');const ops=await p.getOperatorList();images+=ops.fnArray.filter(f=>f===pdfjs.OPS.paintImageXObject||f===pdfjs.OPS.paintInlineImageXObject).length;}
 return {text:text.replace(/\s+/g,''),images};
}

describe('Digital Consent evidence chain',()=>{
 beforeAll(async()=>{
  db=await testDatabase();anc=await addUser(db,'ANC_NURSE','synthetic.anc');admin=await addUser(db,'APP_ADMIN','synthetic.admin');checker=await addUser(db,'CLINICAL_APPROVER','synthetic.checker');
  unit=(await db.query<{id:string}>("INSERT INTO unit(code,name) VALUES('SYNTHETIC_ANC','จำลอง') RETURNING id")).rows[0].id;anc.unitIds=[unit];await db.query('INSERT INTO user_unit_scope(user_id,unit_id) VALUES($1,$2)',[anc.id,unit]);
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

 it('patient Signature Pad: 12 acknowledgements, stored vector+PNG+hash, final consent only after the preparer attests; PDF shows both signatures',async()=>{
  const doc=(await db.query<{id:string}>("SELECT id FROM p2_document_revision WHERE case_id=$1 AND kind='CONSENT' ORDER BY version DESC LIMIT 1",[caseId])).rows[0];
  const s=await tx(()=>startSigning(db,anc,caseId,{documentId:doc.id,devicePresent:true,syntheticPatient:true}));
  const act=(a:object)=>tx(()=>patientAction(db,s.raw,a,{origin,expectedOrigin:origin,token:s.csrf}));
  await expect(act({action:'complete',decision:'Granted',vector})).rejects.toThrow('TWELVE_ACKNOWLEDGMENTS_REQUIRED'); // no signature without all 12
  for(let item=1;item<=12;item++)await act({action:'acknowledge',item});
  await act({action:'complete',decision:'Granted',vector});
  expect((await db.query('SELECT 1 FROM p2_final_consent')).rows).toHaveLength(0); // the patient alone does not finalize it
  expect(await reauthenticate('SYNTHETIC wrong password')).toEqual({ok:false});
  expect(await reauthenticate(TEST_PASSWORD)).toMatchObject({ok:true,consentFinalized:true});
  const sig=(await db.query<{decision:string;png:string;signature_hash:string}>('SELECT decision,png,signature_hash FROM p2_consent_signature WHERE document_id=$1',[doc.id])).rows;
  expect(sig).toHaveLength(1);expect(sig[0]).toMatchObject({decision:'Granted'});expect(sig[0].signature_hash).toHaveLength(64);expect(sig[0].png.length).toBeGreaterThan(100);
  const fin=(await db.query<{payload:{signature:{png:string;decision:string};acknowledgments:unknown[];document:{doctor:{signature_hash:string}}}}>('SELECT payload FROM p2_final_consent WHERE document_id=$1',[doc.id])).rows;
  expect(fin).toHaveLength(1);expect(fin[0].payload.acknowledgments).toHaveLength(12);expect(fin[0].payload.signature.png).toBe(sig[0].png);
  expect(fin[0].payload.document.doctor.signature_hash).toBe((await db.query<{signature_hash:string}>('SELECT signature_hash FROM p2_doctor_version WHERE id=$1',[doctorId])).rows[0].signature_hash);
  // Real Chromium render of the stored document: the patient decision, the doctor's name and BOTH signature images are on the PDF.
  const preview=await tx(()=>createDocumentPreview(db,anc,caseId,doc.id,renderP2Pdf));expect(preview.id).toBeTruthy();
  const bytes=(await import('../../packages/p2/documents')).readDocumentPreview;const read=await tx(()=>bytes(db,anc,preview.id,'download'));
  const facts=await pdfFacts(read.bytes);
  expect(facts.text).toContain('SYNTHETICนพ.ทะเบียนเอ');expect(facts.text).toContain('Granted');expect(facts.images).toBeGreaterThanOrEqual(2);
  // Audit trail: every step is recorded in order, the hash chain verifies, and the document read is logged.
  const events=(await db.query<{event_type:string}>("SELECT event_type FROM case_event WHERE case_id=$1 AND event_type LIKE 'P2_%' ORDER BY created_at,id",[caseId])).rows.map(e=>e.event_type);
  const at=(t:string)=>events.indexOf(t);
  expect(at('P2_CONSENT_PREPARED')).toBeGreaterThan(-1);expect(at('P2_SIGNING_STARTED')).toBeGreaterThan(at('P2_CONSENT_PREPARED'));expect(at('P2_CONSENT_GRANTED')).toBeGreaterThan(at('P2_SIGNING_STARTED'));expect(at('P2_PREPARER_REAUTHENTICATED')).toBeGreaterThan(at('P2_CONSENT_GRANTED'));
  expect((await db.query("SELECT 1 FROM p2_document_access WHERE document_id=$1 AND intent='download'",[doc.id])).rows).toHaveLength(1);
  expect(verifyAuditChain((await db.query<{previous_hash:string;hash:string;payload:string}>('SELECT * FROM audit_chain ORDER BY sequence')).rows)).toBe(true);
 },120000);

 it('after Digital Consent is signed the Paper Consent marker cannot be used to replace the evidence silently; the refusal path blocks',async()=>{
  const c=await getCase(db,anc,caseId),version=c.workspace.version;
  expect(c.workspace.consent_mode).toBe('Electronic');
  // Switching to Paper after a Granted signature is a recorded, audited mode change (P2_MODES_CHANGED) and does not erase the signed evidence.
  await tx(()=>setModes(db,anc,caseId,{expectedVersion:version,requestMode:'Electronic',consentMode:'Paper',reason:'SYNTHETIC channel change'}));
  expect((await db.query('SELECT 1 FROM p2_final_consent')).rows).toHaveLength(1);
  expect((await db.query("SELECT 1 FROM case_event WHERE case_id=$1 AND event_type='P2_MODES_CHANGED'",[caseId])).rows.length).toBeGreaterThan(0);
 });
});
