import {currentPatient,currentPetPatientJoin} from '../anc/current-patient';
import {registryGa} from '../lab/registry-ga';
import {DCC_CONSENT,isCurrentConsent} from '../forms/consent-content';
import {z} from 'zod';
import {operationalDataEnabled} from '../security/runtime';
import {createHash} from 'node:crypto';
import type {Queryable} from '../db/connection';
import {registerCase,lockLn} from '../db/registration';
import {identityLookup} from '../security/envelope';
import {requirePermission,authorize,type Principal,type Operation} from '../security/policy';
import {appendAudit} from '../db/audit';
import {recordPhiAccess} from '../db/phi-access';
import {pageFields,clampPage,offsetOf,likeContains} from '../db/pagination';
import {digest,token,validateCsrf} from '../security/session';
import {deriveSignature,vectorSchema} from './signature';
import type {FileStore} from '../storage';
import {IDENTIFIER_SOURCES,intakePresence,linkIntakeAtRegistration} from '../inbound/registration-link';
import {receiveOrderSql} from '../lab/receive-sort';
import {requestSchema,emptyRequest,requestIssues,requestProgressIssues,evaluateClinical,paperSchema,paperStatus,syntheticText,date,CONSENT_TEMPLATE,REQUEST_TEMPLATE,consentClauses,type RequestDraft} from './schema';

const documentTemplate=(kind:'REQUEST'|'CONSENT')=>operationalDataEnabled()?(kind==='REQUEST'?'CBH-FM01-v1':'CBH-FM02-v1'):(kind==='REQUEST'?REQUEST_TEMPLATE:CONSENT_TEMPLATE);
export type Staff=Principal&{sessionId?:string};
export class P2Error extends Error{constructor(public code:string,public status=400,public details?:unknown){super(code);}}
export const canonical=(value:unknown):string=>{const encode=(v:unknown):string=>{if(v===null||typeof v!=='object')return JSON.stringify(v);if(Array.isArray(v))return '['+v.map(encode).join(',')+']';return '{'+Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>JSON.stringify(k)+':'+encode(x)).join(',')+'}';};return encode(JSON.parse(JSON.stringify(value)));};
export const contentHash=(v:unknown)=>createHash('sha256').update(canonical(v)).digest('hex');
const uuid=z.uuid();
type CaseScope={id:string;ln:string;hn:string|null;registration_origin:'ANC'|'LAB_DIRECT';current_round_id:string;unit_id:string;state:string;analysis_started:boolean;round_number:number};
export async function assertStaff(db:Queryable,user:Staff,allowSuspended=false){
 if(user.sessionId){const r=await db.query<{signing_suspended:boolean}>('SELECT signing_suspended FROM app_session WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL AND idle_expires_at>now() AND absolute_expires_at>now() FOR UPDATE',[user.sessionId,user.id]);if(!r.rows[0])throw new P2Error('UNAUTHENTICATED',401);if(r.rows[0].signing_suspended&&!allowSuspended)throw new P2Error('STAFF_SESSION_SUSPENDED',423);}
}
export async function scopedCase(db:Queryable,user:Staff,id:string,action='case.read',operation:Operation='read'){
 uuid.parse(id);await assertStaff(db,user);
 const r=await db.query<CaseScope>('SELECT c.id,l.ln,i.hn,c.registration_origin,c.current_round_id,s.unit_id,r.state,r.analysis_started,r.round_number FROM nipt_case c JOIN case_ln l ON l.case_id=c.id LEFT JOIN p2_case_identity i ON i.case_id=c.id JOIN case_unit_scope s ON s.case_id=c.id JOIN specimen_round_current r ON r.id=c.current_round_id WHERE c.id=$1 AND NOT EXISTS(SELECT 1 FROM p2_registration_void v WHERE v.case_id=c.id)',[id]);
 const item=r.rows.find(x=>authorize(user,action,{unitId:x.unit_id,origin:x.registration_origin},operation));if(!item)throw new P2Error('FORBIDDEN',403);return item;
}
async function event(db:Queryable,user:Principal,caseId:string,action:string,details:Record<string,unknown>={}){
 await db.query('INSERT INTO case_event(case_id,event_type,details) VALUES($1,$2,$3)',[caseId,action,{...details,actorId:user.id,synthetic:!operationalDataEnabled()}]);
 await appendAudit(db,{actorId:user.id,action,resourceType:'nipt_case',resourceId:caseId,details:{synthetic:!operationalDataEnabled()}});
}
async function activeCase(db:Queryable,user:Staff,id:string,action:string){const c=await scopedCase(db,user,id,action,'write');if(!c.hn)throw new P2Error('IDENTITY_UNVERIFIED',409);await db.query('SELECT id FROM nipt_case WHERE id=$1 FOR UPDATE',[id]);if((await db.query('SELECT id FROM p2_revocation WHERE case_id=$1 LIMIT 1',[id])).rows[0])throw new P2Error('CONSENT_REVOKED_HOLD',409);return c;}
async function workspace(db:Queryable,c:CaseScope,user:Staff){
 await db.query("INSERT INTO p2_workspace(round_id,case_id,draft,request_mode,consent_mode,updated_by) VALUES($1,$2,$3,$4,'Electronic',$5) ON CONFLICT DO NOTHING",[c.current_round_id,c.id,emptyRequest,c.registration_origin==='LAB_DIRECT'?'Paper':'Electronic',user.id]);
 // Paper Consent is a marker (Owner 2026-10-18) and must be an explicit selection (setModes), never a default: a LAB_DIRECT case starts with Electronic consent.
 return (await db.query<{round_id:string;case_id:string;version:number;draft:RequestDraft;updated_at?:Date|string;request_mode:'Electronic'|'Paper';consent_mode:'Electronic'|'Paper'}>('SELECT * FROM p2_workspace WHERE round_id=$1 FOR UPDATE',[c.current_round_id])).rows[0];
}
async function invalidate(db:Queryable,caseId:string){await db.query("UPDATE p2_signing_session SET state='Invalidated',closed_at=now() WHERE case_id=$1 AND state='Active'",[caseId]);}
const p2Ln=z.string().trim().refine(v=>operationalDataEnabled()?/^(?:\d{10}|\d{2}-\d{3}-\d-\d{4})$/.test(v):/^0*990[0-9]{3,17}$/.test(v.replaceAll('-','')),'LN_FORMAT_INVALID');
/** Lab blind entry L2 (Plan §4.7, D-40): presence of a waiting HIS intake only, before any identifier is entered. */
export async function registrationIntakePresence(db:Queryable,user:Staff,input:unknown){
 await assertStaff(db,user);const d=z.strictObject({ln:p2Ln}).parse(input);requirePermission(user,'case.register.lab',{origin:'LAB_DIRECT'});
 const r=await intakePresence(db,d.ln.replaceAll('-',''));
 await appendAudit(db,{actorId:user.id,action:'INTAKE_PRESENCE_CHECKED',resourceType:'his_inbound_file',details:{outcome:r.unlinkedIntake?'PRESENT':'ABSENT',synthetic:!operationalDataEnabled()}});
 return r;
}
/** `intake.store` gives the D-49 hook read access to stored HIS intake bytes; without it a waiting intake fails registration closed. */
export const labOperationalSchema=z.strictObject({gaWeeks:z.number().int().min(0).max(45).optional(),gaDays:z.number().int().min(0).max(6).optional(),edd:date.optional(),pregnancy:z.enum(['Singleton','Twins']).optional(),paperRequest:z.literal(true),paperConsent:z.boolean(),doctorVersionId:uuid.nullable().optional()}).refine(v=>(v.gaWeeks===undefined)===(v.gaDays===undefined),'GA_PAIR_REQUIRED');
export async function registerP2(db:Queryable,user:Staff,input:unknown,key:Buffer,intake:{store?:FileStore}={}){
 // The 32-byte lookup key must be the one the worker matches with; a missing/short key never mints identity digests.
 if(key.length!==32)throw new P2Error('IDENTITY_LOOKUP_KEY_INVALID',500);
 await assertStaff(db,user);
 // LAB_DIRECT blind entry records where the identifiers were read (Plan §4.7 L3, D-40); ANC may record it too.
 const d=z.strictObject({ln:p2Ln,hn:z.string().trim().max(32).refine(v=>operationalDataEnabled()?/^[A-Za-z0-9][A-Za-z0-9./-]{0,31}$/.test(v):/^0*990[0-9]{3,17}$/.test(v)),unitId:uuid,origin:z.enum(['ANC','LAB_DIRECT']),idempotencyKey:z.string(),identifierSource:z.enum(IDENTIFIER_SOURCES).optional(),labOperational:labOperationalSchema.optional(),eqa:z.strictObject({organizer:z.string().trim().min(2).max(200),organizerSampleId:z.string().trim().min(1).max(120),patientName:z.string().trim().min(2).max(200),patientDob:z.iso.date().nullable().optional(),patientSex:z.enum(['M','F','U']).nullable().optional(),pregnancyType:z.enum(['Singleton','Twins']).nullable().optional(),edd:z.iso.date().nullable().optional(),collectionAt:z.iso.datetime({offset:true}).nullable().optional(),programYear:z.number().int().min(2000).max(2200),evidenceReference:z.string().trim().min(3).max(300)}).optional()}).refine(v=>(!v.eqa||v.origin==='LAB_DIRECT')&&(!v.labOperational||v.origin==='LAB_DIRECT')&&(v.origin!=='LAB_DIRECT'||v.identifierSource!==undefined||!!v.labOperational),{path:['identifierSource'],message:'IDENTIFIER_SOURCE_REQUIRED'}).parse(input);
 const ln=d.ln.replaceAll('-','');requirePermission(user,d.origin==='ANC'?'case.register.anc':'case.register.lab',{unitId:d.unitId,origin:d.origin});
 if(!(await db.query('SELECT id FROM unit WHERE id=$1',[d.unitId])).rows[0])throw new P2Error('UNIT_REQUIRED');
 // Match BOTH identifiers under a keyed HMAC; generic P1 normalization remains unchanged.
 await lockLn(db,ln);
 const prior=(await db.query<{id:string;unit_id:string;registration_origin:'ANC'|'LAB_DIRECT'}>('SELECT c.id,s.unit_id,c.registration_origin FROM case_ln l JOIN nipt_case c ON c.id=l.case_id LEFT JOIN case_unit_scope s ON s.case_id=c.id WHERE l.ln=$1 AND NOT EXISTS(SELECT 1 FROM p2_registration_void v WHERE v.case_id=c.id)',[ln])).rows;
 if(prior.length&&!prior.some(x=>authorize(user,'case.read',{unitId:x.unit_id,origin:x.registration_origin},'read'))){await appendAudit(db,{actorId:user.id,action:'CASE_REGISTRATION',resourceType:'nipt_case',details:{outcome:'REJECTED',reasonCode:'IDENTITY_UNVERIFIED',origin:d.origin,synthetic:!operationalDataEnabled()}});return {outcome:'IDENTITY_UNVERIFIED',caseId:null};}
 const result=await registerCase(db,{ln,identityKey:identityLookup(JSON.stringify([ln,d.hn]),key),origin:d.origin,actorId:user.id,idempotencyKey:d.idempotencyKey,identifierSource:d.identifierSource??null});
 if(!result.caseId)return {outcome:'IDENTITY_UNVERIFIED',caseId:null};
 // A same-key replay returns the stored CREATED outcome: scope/HN already exist and must not be re-inserted or re-pointed.
 if(result.outcome==='CREATED'){const scope=(await db.query<{unit_id:string}>('SELECT unit_id FROM case_unit_scope WHERE case_id=$1',[result.caseId])).rows;if(!scope.length){await db.query('INSERT INTO case_unit_scope(case_id,unit_id) VALUES($1,$2)',[result.caseId,d.unitId]);await db.query('INSERT INTO p2_case_identity(case_id,hn,synthetic) VALUES($1,$2,$3)',[result.caseId,d.hn,!operationalDataEnabled()]);}else if(!scope.some(x=>x.unit_id===d.unitId))throw new P2Error('IDEMPOTENCY_CONFLICT',409);}
 const c=await scopedCase(db,user,result.caseId);const initialWorkspace=await workspace(db,c,user);
 if(d.labOperational&&result.outcome==='CREATED'){
  const metadata=d.labOperational,hash=contentHash(metadata);
  const prior=(await db.query<{input_sha256:string}>('SELECT input_sha256 FROM lab_operational_registration WHERE round_id=$1',[c.current_round_id])).rows[0];
  if(prior&&prior.input_sha256!==hash)throw new P2Error('IDEMPOTENCY_CONFLICT',409);
  if(!prior){
   if(metadata.doctorVersionId&&!(await db.query("SELECT 1 FROM p2_doctor_version v WHERE v.id=$1 AND EXISTS(SELECT 1 FROM p2_doctor_event e WHERE e.doctor_version_id=v.id AND e.event_type='Approved')",[metadata.doctorVersionId])).rows.length)throw new P2Error('DOCTOR_VERSION_NOT_APPROVED',422);
   await db.query('INSERT INTO lab_operational_registration(round_id,case_id,ga_weeks,ga_days,edd,pregnancy,doctor_version_id,paper_request,paper_consent,input_sha256,actor_id) VALUES($1,$2,$3,$4,$5,$6,$7,true,$8,$9,$10)',[c.current_round_id,c.id,metadata.gaWeeks??null,metadata.gaDays??null,metadata.edd??null,metadata.pregnancy??null,metadata.doctorVersionId??null,metadata.paperConsent,hash,user.id]);
   const draft=structuredClone(initialWorkspace.draft);draft.pregnancy.edd=metadata.edd??null;draft.pregnancy.type=metadata.pregnancy??null;draft.ordering.doctorVersionId=metadata.doctorVersionId??null;
   await db.query("UPDATE p2_workspace SET draft=$2,request_mode='Paper',consent_mode=$4,version=version+1,updated_by=$3,updated_at=clock_timestamp() WHERE round_id=$1",[c.current_round_id,draft,user.id,metadata.paperConsent?'Paper':'Electronic']);
   await event(db,user,c.id,'LAB_OPERATIONAL_REGISTERED',{paperRequest:true,paperConsent:metadata.paperConsent,clinicalAcceptance:false});
  }
 }
 // v1.1.3: only a *new*, LN-locked Lab registration can become EQA.
 // The organizer-supplied patient identity remains the ordinary registered identity;
 // EQA classification is immutable and never invents a PET/HIS order.
 if(d.eqa){
  if(result.outcome!=='CREATED')throw new P2Error('EQA_REQUIRES_NEW_LAB_REGISTRATION',409);
  await db.query('INSERT INTO eqa_case(case_id,organizer,organizer_sample_id,patient_name,patient_dob,patient_sex,pregnancy_type,edd,collection_at,program_year,evidence_reference,verified_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',[result.caseId,d.eqa.organizer,d.eqa.organizerSampleId,d.eqa.patientName,d.eqa.patientDob??null,d.eqa.patientSex??null,d.eqa.pregnancyType??null,d.eqa.edd??null,d.eqa.collectionAt??null,d.eqa.programYear,d.eqa.evidenceReference,user.id]);
  await appendAudit(db,{actorId:user.id,action:'EQA_CASE_REGISTERED',resourceType:'nipt_case',resourceId:result.caseId,details:{version:d.eqa.programYear,origin:'EQA',synthetic:!operationalDataEnabled()}});
  return {...result,intake:{outcome:'EQA_NO_HIS_PET',fields:[]}};
 }
 // D-49: link any waiting HIS intake in this same transaction under the LN lock already held; rolls back with registration.
 const linked=await linkIntakeAtRegistration(db,user,{caseId:result.caseId,ln,hn:d.hn,identifierSource:d.identifierSource??null},{lookupKey:key,store:intake.store});
 return {...result,intake:linked};
}
export async function voidIncorrectRegistration(db:Queryable,user:Staff,id:string,input:unknown){
 const d=z.strictObject({expectedLn:z.string().regex(/^\d{10}$/),expectedHn:z.string().min(1).max(32)}).parse(input);
 const c=await scopedCase(db,user,id,'case.registration.void','write');
 if(c.registration_origin!=='ANC'||!c.hn||c.ln!==d.expectedLn||c.hn!==d.expectedHn)throw new P2Error('REGISTRATION_CONFIRMATION_MISMATCH',409);
 await lockLn(db,c.ln);await db.query('SELECT id FROM nipt_case WHERE id=$1 FOR UPDATE',[id]);
 if((await db.query('SELECT 1 FROM p2_registration_void WHERE case_id=$1',[id])).rows.length)throw new P2Error('REGISTRATION_ALREADY_VOID',409);
 const blocked=await db.query(`SELECT 1 WHERE
  EXISTS(SELECT 1 FROM specimen_round_current WHERE case_id=$1 AND (received_at IS NOT NULL OR analysis_started)) OR
  EXISTS(SELECT 1 FROM his_order h JOIN case_ln l ON l.id=h.case_ln_id WHERE l.case_id=$1) OR
  EXISTS(SELECT 1 FROM p2_document_revision WHERE case_id=$1) OR
  EXISTS(SELECT 1 FROM p2_final_consent f JOIN p2_document_revision d ON d.id=f.document_id WHERE d.case_id=$1) OR
  EXISTS(SELECT 1 FROM p2_consent_signature s JOIN p2_document_revision d ON d.id=s.document_id WHERE d.case_id=$1) OR
  EXISTS(SELECT 1 FROM p2_paper_review WHERE case_id=$1) OR
  EXISTS(SELECT 1 FROM redraw_request WHERE case_id=$1) OR
  EXISTS(SELECT 1 FROM repeat_work_order WHERE case_id=$1) OR
  EXISTS(SELECT 1 FROM specimen_lab_number WHERE case_id=$1) OR
  EXISTS(SELECT 1 FROM analytical_attempt a JOIN specimen_round_current r ON r.id=a.round_id WHERE r.case_id=$1) OR
  EXISTS(SELECT 1 FROM clinical_snapshot WHERE case_id=$1 AND (result->>'passed'='true' OR rule_version='CBH-AUTHORIZED-REVIEW-v1')) OR
  EXISTS(SELECT 1 FROM result_report_version WHERE case_id=$1) OR
  EXISTS(SELECT 1 FROM p2_revocation WHERE case_id=$1)`,[id]);
 if(blocked.rows.length)throw new P2Error('REGISTRATION_HAS_DOWNSTREAM_EVIDENCE',409);
 await db.query("INSERT INTO p2_registration_void(case_id,actor_id,reason) VALUES($1,$2,'ANC voided an incorrect registration')",[id,user.id]);
 await db.query("INSERT INTO case_event(case_id,event_type,details) VALUES($1,'P2_REGISTRATION_VOIDED',$2)",[id,{actorId:user.id,synthetic:!operationalDataEnabled()}]);
 await appendAudit(db,{actorId:user.id,action:'P2_REGISTRATION_VOIDED',resourceType:'nipt_case',resourceId:id,details:{origin:c.registration_origin,synthetic:!operationalDataEnabled()}});
 return {id,voided:true};
}
export async function getCase(db:Queryable,user:Staff,id:string){
 const c=await scopedCase(db,user,id),w=await workspace(db,c,user);
 const [revisions,paper,clinical,collection,revocations,signatures,finalConsents]=[
 await db.query('SELECT id,kind,version,template_version,content_hash,payload,reason,created_at FROM p2_document_revision WHERE case_id=$1 ORDER BY created_at DESC,version DESC,id DESC',[id]),
 await db.query('SELECT p.*,u.display_name AS verifier_name,u.job_position AS verifier_position FROM p2_paper_review p LEFT JOIN app_user u ON u.id=p.verifier_id WHERE p.case_id=$1 ORDER BY p.created_at DESC',[id]),
 await db.query('SELECT * FROM clinical_snapshot WHERE case_id=$1 ORDER BY created_at DESC',[id]),
 await db.query('SELECT *,collection_date::text AS collection_date FROM p2_collection_fact WHERE case_id=$1 ORDER BY created_at',[id]),
 await db.query('SELECT v.*,u.display_name AS actor_name FROM p2_revocation v LEFT JOIN app_user u ON u.id=v.actor_id WHERE v.case_id=$1 ORDER BY v.created_at',[id]),
 await db.query('SELECT s.id,s.document_id,s.decision,s.signature_hash,s.signed_at FROM p2_consent_signature s JOIN p2_document_revision d ON d.id=s.document_id WHERE d.case_id=$1 ORDER BY signed_at DESC',[id]),await db.query('SELECT f.id,f.document_id,f.content_hash,f.hash_algorithm,f.payload,f.created_at FROM p2_final_consent f JOIN p2_document_revision d ON d.id=f.document_id WHERE d.case_id=$1 ORDER BY f.created_at DESC',[id])];
 const roundReceipt=(await db.query(`SELECT id AS "roundId",received_source AS "receivedSource",${preciseUtc('received_at')} AS "receivedAt",collection_date::text AS "collectionDate" FROM specimen_round_current WHERE id=$1`,[c.current_round_id])).rows[0];
 const currentCollectionFacts=(await db.query('SELECT DISTINCT ON(f.source) f.source,f.collection_date::text AS collection_date,f.collection_time,f.actor_id,u.display_name AS actor_name,u.job_position AS actor_position,f.reason,f.sequence FROM p2_collection_fact f LEFT JOIN app_user u ON u.id=f.actor_id WHERE f.round_id=$1 ORDER BY f.source,f.sequence DESC',[c.current_round_id])).rows;
 const history={rounds:(await db.query('SELECT id,round_number,state,received_source FROM specimen_round_current WHERE case_id=$1 ORDER BY round_number,id',[id])).rows,events:(await db.query<{event_type:string;created_at:string;details:Record<string,unknown>;actor_id:string|null;display_name:string|null;job_position:string|null}>("SELECT e.event_type,e.created_at,e.details,e.details->>'actorId' AS actor_id,u.display_name,u.job_position FROM case_event e LEFT JOIN app_user u ON u.id=(e.details->>'actorId')::uuid WHERE e.case_id=$1 ORDER BY e.created_at DESC,e.id DESC LIMIT 200",[id])).rows};
 const currentPatientIdentity=await currentPatient(db,id);
 const patientName=currentPatientIdentity.name;
 const consentDecision=(await db.query<{d:string|null}>('SELECT p2_consent_latest_decision($1) AS d',[c.current_round_id])).rows[0].d;
 const clinicalReady=operationalDataEnabled()&&(await db.query<{ready:boolean}>('SELECT p2_clinical_ready($1) AS ready',[c.current_round_id])).rows[0]?.ready===true;
 const ancCaller=user.roles.some(role=>role==='ANC_NURSE'||role==='ANC_SUPERVISOR');
 const withdrawalUnavailable=ancCaller&&(await db.query('SELECT 1 WHERE EXISTS(SELECT 1 FROM specimen_round_current WHERE case_id=$1 AND analysis_started) OR EXISTS(SELECT 1 FROM result_report_version WHERE case_id=$1)',[id])).rows.length>0;
 const actions=['clinical.correct','request.edit','request.correct','consent.prepare','paper.verify','consent.withdraw.receive'].filter(a=>authorize(user,a,{unitId:c.unit_id,origin:c.registration_origin},'write')&&!(a==='consent.withdraw.receive'&&withdrawalUnavailable));
 const assessment=w.request_mode==='Electronic'?evaluateClinical(w.draft,await collectionConflict(db,c)):null;
 const missing=w.request_mode==='Electronic'?requestIssues(w.draft):[];
 const requestCurrent=revisions.rows.find(r=>r.kind==='REQUEST'&&(r.payload as {identity?:{roundId?:string}})?.identity?.roundId===c.current_round_id);
 if(w.request_mode==='Electronic'&&(!requestCurrent||canonical((requestCurrent.payload as {draft?:unknown})?.draft)!==canonical(w.draft)))missing.push('request.document');
 if(w.request_mode==='Paper'&&!paper.rows.some(p=>p.kind==='REQUEST'&&p.round_id===c.current_round_id&&p.status==='Verified'))missing.push('request.paperReview');
 const documentsReady=operationalDataEnabled()&&(await db.query<{ready:boolean}>('SELECT p2_clinical_documents_ready($1) AS ready',[c.current_round_id])).rows[0]?.ready===true;
 if(w.consent_mode==='Electronic'&&!finalConsents.rows.length)missing.push('consent.signature');
 const signedCurrentConsent=revisions.rows.find(r=>r.kind==='CONSENT'&&(r.payload as {identity?:{roundId?:string}})?.identity?.roundId===c.current_round_id&&finalConsents.rows.some(f=>f.document_id===r.id));
 if(w.consent_mode==='Electronic'&&signedCurrentConsent&&!(await db.query<{matches:boolean}>('SELECT p2_consent_workspace_matches($1::jsonb,$2::jsonb,$3) matches',[JSON.stringify(signedCurrentConsent.payload),JSON.stringify(w.draft),w.version])).rows[0].matches)missing.push('consent.currentBinding');
 if(consentDecision==='Declined')missing.push('consent.declined');
 if(!documentsReady&&!missing.length)missing.push('documents.currentEvidence');
 const readiness={state:revocations.rows.length?'RevokedHold':clinicalReady?'ClinicalPassed':assessment?.state==='ClinicalDataConflict'?'ClinicalDataConflict':assessment?.state==='BlockedWithReason'?'BlockedWithReason':consentDecision==='Declined'?'BlockedWithReason':missing.length?'PendingData':'PendingClinicalReview',missing:clinicalReady?[]:[...new Set(missing)],canReview:!revocations.rows.length&&!clinicalReady&&documentsReady&&(!assessment||assessment.state==='PendingClinicalReview')&&user.roles.includes('CLINICAL_APPROVER')&&actions.includes('clinical.correct')};
 const requestSave=(await db.query<{at:string;mode:'Auto'|'Manual'}>(`SELECT ${preciseUtc('created_at')} AS at,COALESCE(details->>'saveMode','Manual') AS mode FROM case_event WHERE case_id=$1 AND event_type IN ('P2_REQUEST_AUTOSAVED','P2_REQUEST_DRAFT_SAVED','P2_REQUEST_AMENDMENT_DRAFT_SAVED') AND (details->>'roundId'=$2::uuid::text OR (details->>'roundId' IS NULL AND created_at=(SELECT updated_at FROM p2_workspace WHERE round_id=$2::uuid))) ORDER BY created_at DESC,id DESC LIMIT 1`,[id,c.current_round_id])).rows[0]??null;
 await recordPhiAccess(db,user.id,[id],'CASE_DETAIL_VIEW');
 const his=(await db.query<{lnHalos:string|null;ward:string|null;ln:string;hn:string;name:string;dob:string;sex:string;specimenAt:string;receivedAt:string}>(`SELECT n.ln_halos "lnHalos",NULLIF(btrim(f.parsed->>'ward'),'') ward,f.parsed->>'ln' ln,f.parsed->>'hn' hn,f.parsed->>'name' name,f.parsed->>'dob' dob,f.parsed->>'sex' sex,f.parsed->>'specimenAt' "specimenAt",f.parsed->>'receivedAt' "receivedAt" FROM his_order_current o JOIN his_inbound_file_current f ON f.id=o.inbound_file_id LEFT JOIN specimen_lab_number n ON n.round_id=o.round_id WHERE o.round_id=$1`,[c.current_round_id])).rows[0]??null;
 const labClinicalDeferred=c.registration_origin==='LAB_DIRECT'&&w.request_mode==='Paper'&&w.consent_mode==='Paper'&&(await db.query('SELECT 1 FROM lab_operational_registration WHERE case_id=$1 AND paper_request AND paper_consent AND (edd IS NULL OR pregnancy IS NULL OR ga_weeks IS NULL)',[c.id])).rows.length>0;
 const hasEverReceived=(await db.query('SELECT 1 FROM specimen_round_current WHERE case_id=$1 AND received_at IS NOT NULL LIMIT 1',[id])).rows.length>0;
 return {operational:operationalDataEnabled(),case:c,hasEverReceived,patientName,currentPatient:currentPatientIdentity,his,labClinicalDeferred,workspace:{...w,requestSave},consentDecision,history,roundReceipt,currentCollectionFacts,revisions:revisions.rows,paper:paper.rows,clinical:clinical.rows,collection:collection.rows,revocations:revocations.rows,signatures:signatures.rows,finalConsents:finalConsents.rows,allowedActions:actions,readiness,gate:{passed:clinicalReady,state:revocations.rows.length?'RevokedHold':clinicalReady?'ClinicalPassed':'PendingClinicalReview',reason:clinicalReady?'AUTHORIZED_CLINICAL_REVIEW':'CLINICAL_REVIEW_REQUIRED'}};
}
async function collectionConflict(db:Queryable,c:CaseScope,dateValue?:string|null){const r=await db.query<{collection_date:string|Date}>('SELECT DISTINCT ON(source) collection_date::text AS collection_date FROM p2_collection_fact WHERE round_id=$1 ORDER BY source,sequence DESC',[c.current_round_id]);const his=await db.query<{collection_date:string|Date}>('SELECT collection_date::text AS collection_date FROM specimen_round_current WHERE id=$1 AND received_source=\'HIS_PET_RECEIPT\' AND collection_date IS NOT NULL',[c.current_round_id]);const dates=new Set([...r.rows,...his.rows].map(x=>new Date(x.collection_date).toISOString().slice(0,10)));if(dateValue)dates.add(dateValue);return dates.size>1;}
async function collect(db:Queryable,c:CaseScope,user:Staff,d:RequestDraft,reason='SYNTHETIC_CAPTURE'){if(d.pregnancy.collectionDate&&d.pregnancy.collectionSource){
 const p=d.pregnancy,today=new Date(Date.now()+7*3600000).toISOString().slice(0,10);if(p.collectionDate!>today)throw new P2Error('COLLECTION_DATE_FUTURE',422);
 const prior=(await db.query<{round_id:string;collection_date:string}>(`SELECT round_id,collection_date::text FROM (SELECT DISTINCT ON(f.round_id,f.source) f.round_id,f.source,f.collection_date FROM p2_collection_fact f JOIN specimen_round_current r ON r.id=f.round_id WHERE r.case_id=$1 AND r.round_number<$2 ORDER BY f.round_id,f.source,f.sequence DESC) latest UNION ALL SELECT id,collection_date::text FROM specimen_round_current WHERE case_id=$1 AND round_number<$2 AND received_source IS NOT NULL AND collection_date IS NOT NULL`,[c.id,c.round_number])).rows;
 const previousDates=new Map<string,Set<string>>();for(const fact of prior){const dates=previousDates.get(fact.round_id)??new Set<string>();dates.add(fact.collection_date);previousDates.set(fact.round_id,dates);}if([...previousDates.values()].some(dates=>dates.size>1))throw new P2Error('PREVIOUS_ROUND_COLLECTION_CONFLICT',409);if(prior.some(f=>f.collection_date>p.collectionDate!))throw new P2Error('COLLECTION_DATE_BEFORE_PREVIOUS_ROUND',422);
 const latest=(await db.query<{collection_date:Date|string;collection_time:string|null}>('SELECT collection_date::text AS collection_date,collection_time FROM p2_collection_fact WHERE round_id=$1 AND source=$2 ORDER BY sequence DESC LIMIT 1',[c.current_round_id,p.collectionSource])).rows[0];if(latest&&new Date(latest.collection_date).toISOString().slice(0,10)===p.collectionDate&&latest.collection_time===p.collectionTime)return;
 await db.query('INSERT INTO p2_collection_fact(case_id,round_id,source,collection_date,collection_time,actor_id,reason) VALUES($1,$2,$3,$4,$5,$6,$7)',[c.id,c.current_round_id,p.collectionSource,p.collectionDate,p.collectionTime,user.id,reason]);}}
async function evaluate(db:Queryable,c:CaseScope,d:RequestDraft){const result=evaluateClinical(d,await collectionConflict(db,c,d.pregnancy.collectionDate));await db.query('INSERT INTO clinical_snapshot(case_id,round_id,rule_version,input_snapshot,result) VALUES($1,$2,$3,$4,$5)',[c.id,c.current_round_id,result.ruleVersion,d,result]);return result;}
export async function saveRequest(db:Queryable,user:Staff,id:string,input:unknown){
 const d=z.strictObject({expectedVersion:z.number().int().min(0),draft:requestSchema,reason:syntheticText.refine(v=>v.length>0).optional(),saveMode:z.enum(['Auto','Manual']).optional()}).parse(input),c=await activeCase(db,user,id,'request.edit'),w=await workspace(db,c,user);
 if(w.version!==d.expectedVersion)throw new P2Error('VERSION_CONFLICT',409,{version:w.version,draft:w.draft});
 if(canonical(w.draft)===canonical(d.draft))return {version:w.version,draft:w.draft,clinical:evaluateClinical(w.draft,await collectionConflict(db,c,w.draft.pregnancy.collectionDate)),savedAt:(await db.query<{savedAt:string}>(`SELECT ${preciseUtc('updated_at')} AS "savedAt" FROM p2_workspace WHERE round_id=$1`,[c.current_round_id])).rows[0]?.savedAt};
 const locked=(await db.query("SELECT id,version FROM p2_document_revision WHERE round_id=$1 AND kind='REQUEST' ORDER BY version DESC LIMIT 1",[c.current_round_id])).rows[0];if(locked){requirePermission(user,'request.correct',{unitId:c.unit_id,origin:c.registration_origin});if(!d.reason)throw new P2Error('AMENDMENT_REASON_REQUIRED',422);}
 await collect(db,c,user,d.draft,d.reason);await db.query('UPDATE p2_workspace SET draft=$2,version=version+1,updated_by=$3,updated_at=now() WHERE round_id=$1',[c.current_round_id,d.draft,user.id]);
 for(const item of ['conditionA','conditionB'] as const)if(d.draft.acknowledgments[item]!==null&&d.draft.acknowledgments[item]!==w.draft.acknowledgments[item])await db.query('INSERT INTO p2_request_ack(case_id,round_id,item,answer,workspace_version,actor_id) VALUES($1,$2,$3,$4,$5,$6)',[id,c.current_round_id,item,d.draft.acknowledgments[item],w.version+1,user.id]);
 const clinical=await evaluate(db,c,d.draft);await invalidate(db,id);await event(db,user,id,locked?'P2_REQUEST_AMENDMENT_DRAFT_SAVED':d.saveMode==='Auto'?'P2_REQUEST_AUTOSAVED':'P2_REQUEST_DRAFT_SAVED',{roundId:c.current_round_id,workspaceVersion:w.version+1,saveMode:d.saveMode??'Manual',...(d.reason?{reason:d.reason}:{}),...(locked?{previousRevisionId:locked.id,previousRevisionNumber:locked.version}:{})});const savedAt=(await db.query<{savedAt:string}>(`SELECT ${preciseUtc('updated_at')} AS "savedAt" FROM p2_workspace WHERE round_id=$1`,[c.current_round_id])).rows[0]?.savedAt;return {version:w.version+1,draft:d.draft,clinical,savedAt};
}
/** Complete the deferred fields of the existing LAB Paper intake. This is metadata, never a clinical decision or a Request revision. */
export async function saveLabClinicalMetadata(db:Queryable,user:Staff,id:string,input:unknown){
 const d=z.strictObject({expectedVersion:z.number().int().min(0),edd:date.nullable(),pregnancy:z.enum(['Singleton','Twins','Unknown']).nullable()}).parse(input),c=await activeCase(db,user,id,'request.edit'),w=await workspace(db,c,user);
 if(w.version!==d.expectedVersion)throw new P2Error('VERSION_CONFLICT',409,{version:w.version,draft:w.draft});
 const deferred=c.registration_origin==='LAB_DIRECT'&&w.request_mode==='Paper'&&w.consent_mode==='Paper'&&(await db.query('SELECT 1 FROM lab_operational_registration WHERE case_id=$1 AND paper_request AND paper_consent AND (edd IS NULL OR pregnancy IS NULL OR ga_weeks IS NULL)',[c.id])).rows.length>0;
 if(!deferred)throw new P2Error('LAB_DEFERRED_METADATA_UNAVAILABLE',409);
 if(!(await db.query<{ready:boolean}>('SELECT lab_owner_paper_ready($1) ready',[c.current_round_id])).rows[0]?.ready||(await db.query("SELECT 1 FROM p2_document_revision WHERE round_id=$1 AND kind='REQUEST'",[c.current_round_id])).rows.length)throw new P2Error('CLINICAL_REVIEW_REQUIRED',409);
 const draft=structuredClone(w.draft);draft.pregnancy.edd=d.edd;draft.pregnancy.type=d.pregnancy;
 await db.query('UPDATE p2_workspace SET draft=$2,version=version+1,updated_by=$3,updated_at=clock_timestamp() WHERE round_id=$1',[c.current_round_id,draft,user.id]);
 await invalidate(db,c.id);await event(db,user,c.id,'LAB_DEFERRED_CLINICAL_SAVED',{roundId:c.current_round_id,workspaceVersion:w.version+1,fields:['pregnancy.edd','pregnancy.type'],clinicalAcceptance:false});
 return {version:w.version+1,edd:d.edd,pregnancy:d.pregnancy,clinicalAcceptance:false};
}
export async function activeDoctor(db:Queryable,id:string,unitId:string){uuid.parse(id);uuid.parse(unitId);const row=(await db.query<{id:string;name:string;version:number;signature_png:string;signature_hash:string;doctor_key:string;authorization:string}>(`SELECT v.* FROM p2_doctor_version v WHERE v.id=$1 AND v.effective_from<=now() AND v.signature_png IS NOT NULL AND (SELECT e.event_type FROM p2_doctor_event e WHERE e.doctor_version_id=v.id ORDER BY e.created_at DESC,e.id DESC LIMIT 1) IS DISTINCT FROM 'Suspended' AND NOT EXISTS(SELECT 1 FROM p2_doctor_version n WHERE n.doctor_key=v.doctor_key AND n.version>v.version AND n.effective_from<=now())`,[id])).rows[0];if(!row)throw new P2Error('DOCTOR_NOT_AVAILABLE',422);return row;}
async function revision(db:Queryable,user:Staff,c:CaseScope,kind:'REQUEST'|'CONSENT',payload:unknown,reason:string){
 const version=Number((await db.query<{n:number}>('SELECT COALESCE(max(version),0)+1 n FROM p2_document_revision WHERE round_id=$1 AND kind=$2',[c.current_round_id,kind])).rows[0].n);
 const r=(await db.query<{id:string;version:number;content_hash:string}>('INSERT INTO p2_document_revision(case_id,round_id,kind,version,template_version,payload,content_hash,reason,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id,version,content_hash',[c.id,c.current_round_id,kind,version,documentTemplate(kind),payload,contentHash(payload),reason,user.id])).rows[0];await invalidate(db,c.id);return r;
}
export async function lockRequest(db:Queryable,user:Staff,id:string,input:unknown){
 const d=z.strictObject({expectedVersion:z.number().int().min(0),reason:syntheticText.refine(v=>v.length>0)}).parse(input),c=await activeCase(db,user,id,'request.edit'),w=await workspace(db,c,user);if(w.request_mode!=='Electronic')throw new P2Error('REQUEST_PAPER_MODE');
 if(w.version!==d.expectedVersion)throw new P2Error('VERSION_CONFLICT',409,{version:w.version,draft:w.draft});
 const previous=(await db.query<{id:string;version:number;content_hash:string;payload:{draft?:unknown}}>("SELECT id,version,content_hash,payload FROM p2_document_revision WHERE round_id=$1 AND kind='REQUEST' ORDER BY version DESC LIMIT 1",[c.current_round_id])).rows[0];
 if(previous){requirePermission(user,'request.correct',{unitId:c.unit_id,origin:c.registration_origin});if(canonical(previous.payload.draft)===canonical(w.draft))return {id:previous.id,version:previous.version,content_hash:previous.content_hash};}
 const draft=requestSchema.parse(w.draft),issues=requestIssues(draft);if(issues.length)throw new P2Error('REQUEST_INCOMPLETE',422,{fields:issues});
 if(await collectionConflict(db,c,draft.pregnancy.collectionDate))throw new P2Error('COLLECTION_DATE_MISMATCH',409);
 const doctor=await activeDoctor(db,draft.ordering.doctorVersionId!,c.unit_id);const clinical=await evaluate(db,c,draft);
 const acknowledgmentEvidence=(await db.query('SELECT item,answer,workspace_version,actor_id,created_at FROM p2_request_ack WHERE round_id=$1 ORDER BY created_at',[c.current_round_id])).rows;
 const frozen=operationalDataEnabled()?await (await import('./document-snapshot')).freezeDccForm(db,user,c.id,'REQUEST'):{};
 const r=await revision(db,user,c,'REQUEST',{...frozen,workspaceVersion:w.version,identity:{caseId:c.id,ln:c.ln,hn:c.hn,roundId:c.current_round_id,roundNumber:c.round_number},draft,clinical,doctor,acknowledgmentEvidence,caption:operationalDataEnabled()?'authorized stored signature, not freshly signed':'authorized synthetic stored signature, not freshly signed',unsigned:false,synthetic:!operationalDataEnabled()},d.reason);await event(db,user,id,'P2_REQUEST_LOCKED',{roundId:c.current_round_id,workspaceVersion:w.version,revisionId:r.id,revisionNumber:r.version,reason:d.reason,amendment:!!previous,...(previous?{previousRevisionId:previous.id,previousRevisionNumber:previous.version}:{})});return r;
}
async function assertBeforeFirstReceipt(db:Queryable,id:string){if((await db.query('SELECT 1 FROM specimen_round_current WHERE case_id=$1 AND received_at IS NOT NULL LIMIT 1',[id])).rows.length)throw new P2Error('ACTION_UNAVAILABLE_AFTER_FIRST_RECEIPT',409);}
export async function setModes(db:Queryable,user:Staff,id:string,input:unknown){const d=z.strictObject({expectedVersion:z.number().int().min(0),requestMode:z.enum(['Electronic','Paper']),consentMode:z.enum(['Electronic','Paper']),reason:syntheticText.optional()}).parse(input),c=await activeCase(db,user,id,'consent.prepare'),w=await workspace(db,c,user);if(w.version!==d.expectedVersion)throw new P2Error('VERSION_CONFLICT',409,{version:w.version,draft:w.draft});if(user.roles.some(role=>role==="ANC_NURSE"||role==="ANC_SUPERVISOR"))await assertBeforeFirstReceipt(db,id);if(d.consentMode!==w.consent_mode)await assertConsentNotCompleted(db,c.id);await db.query('UPDATE p2_workspace SET request_mode=$2,consent_mode=$3,version=version+1,updated_by=$4,updated_at=now() WHERE round_id=$1',[c.current_round_id,d.requestMode,d.consentMode,user.id]);await invalidate(db,id);await event(db,user,id,'P2_MODES_CHANGED',{requestMode:d.requestMode,consentMode:d.consentMode,...(d.reason?{reason:d.reason}:{})});return {version:w.version+1,requestMode:d.requestMode,consentMode:d.consentMode};}
/** Owner 2026-10-18: ANC records that the patient refused on the paper consent. No print/upload/scan/verification; it reuses the paper review
 * consent model (status Declined), the case audit trail and the DB readiness rule, and blocks every gate until a later decisive Granted decision. */
export async function refusePaperConsent(db:Queryable,user:Staff,id:string,input:unknown){
 const d=z.strictObject({expectedVersion:z.number().int().min(0),reason:syntheticText.refine(v=>v.length>0)}).parse(input),c=await activeCase(db,user,id,'consent.prepare'),w=await workspace(db,c,user);
 if(w.version!==d.expectedVersion)throw new P2Error('VERSION_CONFLICT',409,{version:w.version,draft:w.draft});
 if(user.roles.some(role=>role==="ANC_NURSE"||role==="ANC_SUPERVISOR"))await assertBeforeFirstReceipt(db,id);await assertConsentNotCompleted(db,c.id);
 let version=w.version;
 if(w.consent_mode!=='Paper'){await db.query("UPDATE p2_workspace SET consent_mode='Paper',version=version+1,updated_by=$2,updated_at=now() WHERE round_id=$1",[c.current_round_id,user.id]);version+=1;await invalidate(db,id);await event(db,user,id,'P2_MODES_CHANGED',{reason:'ANC เลือกใช้ Paper Consent พร้อมบันทึกการไม่ยินยอม'});}
 const panel:Record<string,string|null>=Object.fromEntries(Object.keys(paperSchema.shape).map(k=>[k,null]));panel.decision='Declined';
 const r=(await db.query<{id:string;created_at:Date}>("INSERT INTO p2_paper_review(case_id,round_id,kind,template_version,document_reference,panel,status,location,reason,verifier_id) VALUES($1,$2,'CONSENT',$3,'PAPER_CONSENT_REFUSED',$4,'Declined','ANC',$5,$6) RETURNING id,created_at",[id,c.current_round_id,documentTemplate('CONSENT'),panel,d.reason,user.id])).rows[0];
 await invalidate(db,id);await event(db,user,id,'P2_PAPER_CONSENT_REFUSED',{reviewId:r.id,reason:d.reason});return {id:r.id,state:'Refused',version};
}
export async function paperReview(db:Queryable,user:Staff,id:string,input:unknown){
 const ack=z.strictObject({syntheticName:syntheticText.refine(v=>v.length>0),date,source:z.literal('PAPER_ORIGINAL')});
 const d=z.strictObject({kind:z.enum(['REQUEST','CONSENT']),templateVersion:z.enum([REQUEST_TEMPLATE,CONSENT_TEMPLATE,'CBH-FM01-v1','CBH-FM02-v1']),documentReference:syntheticText.refine(v=>v.length>0),panel:paperSchema,location:syntheticText.refine(v=>v.length>0),reason:syntheticText.refine(v=>v.length>0),operation:z.enum(['Review','Replace','Amend']),previousId:uuid.nullable(),acknowledgmentEvidence:z.strictObject({conditionA:ack.optional(),conditionB:ack.optional()}).optional()}).parse(input),c=await activeCase(db,user,id,'paper.verify'),w=await workspace(db,c,user);
 if(d.kind==='CONSENT')await assertConsentNotCompleted(db,c.id);
 const relevant=d.kind==='CONSENT'?['decision','signatures','representative']:Object.keys(paperSchema.shape).filter(k=>!['decision','signatures','representative'].includes(k));if(Object.entries(d.panel).some(([k,v])=>!relevant.includes(k)&&v!==null))throw new P2Error('PAPER_IRRELEVANT_FIELDS_MUST_BE_NULL',422);
 if((d.kind==='REQUEST'?w.request_mode:w.consent_mode)!=='Paper'||d.templateVersion!==(documentTemplate(d.kind)))throw new P2Error('PAPER_DOCUMENT_MODE_TEMPLATE_MISMATCH');
 if(d.previousId){const prev=(await db.query('SELECT id FROM p2_paper_review WHERE id=$1 AND case_id=$2 AND round_id=$3 AND kind=$4',[d.previousId,id,c.current_round_id,d.kind])).rows[0];if(!prev)throw new P2Error('PAPER_PREVIOUS_MISMATCH');}
 if(d.operation!=='Review'&&!d.previousId)throw new P2Error('PAPER_PREVIOUS_REQUIRED');
 if(d.panel.collectionDate&&d.kind==='REQUEST'){const copy=structuredClone(emptyRequest);copy.pregnancy.collectionDate=d.panel.collectionDate;copy.pregnancy.collectionSource='LAB_PAPER';await collect(db,c,user,copy);}
 const conflict=d.kind==='REQUEST'&&(await collectionConflict(db,c,d.panel.collectionDate)||d.panel.ga==='Under8'&&d.panel.history1to5==='AllNo');let status=paperStatus(d.panel,d.kind,conflict);
 if(d.kind==='REQUEST'&&((d.panel.conditionA==='Present'&&!d.acknowledgmentEvidence?.conditionA)||(d.panel.conditionB==='Present'&&!d.acknowledgmentEvidence?.conditionB)))status='Pending';
 if(d.previousId&&d.operation!=='Review')await db.query('INSERT INTO p2_paper_review(case_id,round_id,kind,template_version,document_reference,panel,status,location,reason,verifier_id,previous_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',[id,c.current_round_id,d.kind,d.templateVersion,d.documentReference,d.panel,d.operation==='Replace'?'Replaced':'Amended',d.location,d.reason,user.id,d.previousId]);
 const r=(await db.query<{id:string;status:string;created_at:Date}>('INSERT INTO p2_paper_review(case_id,round_id,kind,template_version,document_reference,panel,status,location,reason,verifier_id,previous_id,acknowledgment_evidence) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id,status,created_at',[id,c.current_round_id,d.kind,d.templateVersion,d.documentReference,d.panel,status,d.location,d.reason,user.id,d.previousId,d.acknowledgmentEvidence??{}])).rows[0];
 const clinical={state:conflict?'ClinicalDataConflict':d.panel.history1to5==='AnyYes'?'BlockedWithReason':status==='Pending'?'NotEvaluable':'PendingClinicalReview',passed:false,ruleVersion:'SYNTHETIC-NEGATIVE-ONLY-v1',authority:'PendingClinicalReview'};
 await db.query('INSERT INTO clinical_snapshot(case_id,round_id,rule_version,input_snapshot,result) VALUES($1,$2,$3,$4,$5)',[id,c.current_round_id,clinical.ruleVersion,{paperReviewId:r.id,panel:d.panel},clinical]);await event(db,user,id,'P2_PAPER_REVIEWED');return {...r,clinical};
}
export async function preparePaper(db:Queryable,user:Staff,id:string,input:unknown){const d=z.strictObject({kind:z.enum(['REQUEST','CONSENT']),documentReference:syntheticText.refine(v=>v.length>0),location:syntheticText.refine(v=>v.length>0),reason:syntheticText.refine(v=>v.length>0)}).parse(input),c=await activeCase(db,user,id,d.kind==='REQUEST'?'request.edit':'consent.prepare'),w=await workspace(db,c,user);if((d.kind==='REQUEST'?w.request_mode:w.consent_mode)!=='Paper')throw new P2Error('PAPER_DOCUMENT_MODE_TEMPLATE_MISMATCH');if(d.kind==='CONSENT')await assertConsentNotCompleted(db,c.id);const panel=Object.fromEntries(Object.keys(paperSchema.shape).map(k=>[k,null]));const r=(await db.query("INSERT INTO p2_paper_review(case_id,round_id,kind,template_version,document_reference,panel,status,location,reason,verifier_id) VALUES($1,$2,$3,$4,$5,$6,'Pending',$7,$8,$9) RETURNING id,status,created_at",[id,c.current_round_id,d.kind,documentTemplate(d.kind),d.documentReference,panel,d.location,d.reason,user.id])).rows[0];await event(db,user,id,'P2_PAPER_PREPARED');return r;}
/**
 * One signed consent per case: never generate another document/version after a
 * patient has completed the evidence-backed consent. This is a database
 * transaction guard, not merely a disabled button.
 */
async function assertConsentNotCompleted(db:Queryable,caseId:string){
 const completed=(await db.query<{id:string}>(`SELECT f.id FROM p2_final_consent f
  JOIN p2_document_revision d ON d.id=f.document_id
  WHERE d.case_id=$1 LIMIT 1`,[caseId])).rows[0];
 if(completed)throw new P2Error('CONSENT_ALREADY_COMPLETED',409);
}
export async function prepareConsent(db:Queryable,user:Staff,id:string,input:unknown){
 const representative=z.strictObject({name:syntheticText.refine(v=>v.length>0),relationship:syntheticText.refine(v=>v.length>0),authorityBasis:syntheticText.refine(v=>v.length>0),authorityConfirmed:z.literal(true)});
 const d=z.strictObject({doctorVersionId:uuid,representativeRequired:z.boolean(),representative:representative.optional(),reason:syntheticText.refine(v=>v.length>0).optional()}).refine(v=>v.representativeRequired===!!v.representative).parse(input),c=await activeCase(db,user,id,'consent.prepare'),w=await workspace(db,c,user);
 await assertConsentNotCompleted(db,c.id);
 if(w.consent_mode!=='Electronic')throw new P2Error('CONSENT_PAPER_MODE');
 // Owner Lock 2026-10-18: the consent names the same ordering doctor the ANC nurse chose on this round's request.
 if(!w.draft.ordering.doctorVersionId)throw new P2Error('ORDERING_DOCTOR_REQUIRED',422);
 if(d.doctorVersionId!==w.draft.ordering.doctorVersionId)throw new P2Error('CONSENT_DOCTOR_MUST_MATCH_REQUEST',409);
 const doctor=await activeDoctor(db,d.doctorVersionId,c.unit_id);
 const frozen=operationalDataEnabled()?await (await import('./document-snapshot')).freezeDccForm(db,user,c.id,'CONSENT'):{};
 const r=await revision(db,user,c,'CONSENT',{...frozen,consentSignatureLayout:'balanced-20261025',...(operationalDataEnabled()?{consentContent:DCC_CONSENT}:{}),identity:{caseId:c.id,ln:c.ln,hn:c.hn,roundId:c.current_round_id,roundNumber:c.round_number},workspaceVersion:w.version,clauses:operationalDataEnabled()?DCC_CONSENT.clauses.map(c=>c.text):consentClauses,doctor,requestDraft:w.draft,preparerId:user.id,representativeRequired:d.representativeRequired,representative:d.representative??null,caption:operationalDataEnabled()?'authorized stored signature, not freshly signed':'authorized synthetic stored signature, not freshly signed',synthetic:!operationalDataEnabled(),unapproved:true,unsigned:true},d.reason??'ANC เตรียมใบยินยอม');await event(db,user,id,'P2_CONSENT_PREPARED',{representative:d.representativeRequired});return r;
}
export async function startSigning(db:Queryable,user:Staff,id:string,input:unknown){
 const d=z.strictObject({documentId:uuid,devicePresent:z.literal(true),syntheticPatient:z.literal(true).optional(),patientPresent:z.literal(true).optional()}).refine(v=>operationalDataEnabled()?v.patientPresent===true:v.syntheticPatient===true,{message:'PATIENT_PRESENT_REQUIRED'}).parse(input),c=await activeCase(db,user,id,'consent.prepare'),w=await workspace(db,c,user);if(!user.sessionId)throw new P2Error('STAFF_SESSION_REQUIRED',401);await assertConsentNotCompleted(db,c.id);if(w.consent_mode!=='Electronic')throw new P2Error('CONSENT_PAPER_MODE');
 // Lock the immutable document using an advisory lock (app_rw deliberately cannot UPDATE snapshots).
 await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,75432804))',[d.documentId]);
 const doc=(await db.query<{id:string;payload:{doctor:{id:string};workspaceVersion:number;consentContent?:unknown}}>("SELECT id,payload FROM p2_document_revision WHERE id=$1 AND case_id=$2 AND round_id=$3 AND kind='CONSENT' AND version=(SELECT max(version) FROM p2_document_revision WHERE case_id=$2 AND round_id=$3 AND kind='CONSENT')",[d.documentId,id,c.current_round_id])).rows[0];if(!doc)throw new P2Error('CONSENT_VERSION_INVALID',409);if(doc.payload.workspaceVersion!==w.version)throw new P2Error('CONSENT_DRAFT_CHANGED_PREPARE_AGAIN',409);
 if(operationalDataEnabled()&&!isCurrentConsent(doc.payload.consentContent))throw new P2Error('CONSENT_CONTENT_REPREPARE_REQUIRED',409);
 await activeDoctor(db,doc.payload.doctor.id,c.unit_id);
 if((await db.query('SELECT id FROM p2_consent_signature WHERE document_id=$1',[doc.id])).rows[0])throw new P2Error('CONSENT_ALREADY_SIGNED',409);
 await db.query("UPDATE p2_signing_session SET state='Expired',closed_at=now() WHERE document_id=$1 AND state='Active' AND expires_at<=now()",[doc.id]);
 if((await db.query("SELECT id FROM p2_signing_session WHERE document_id=$1 AND state='Active'",[doc.id])).rows[0])throw new P2Error('CONSENT_SIGNING_ALREADY_ACTIVE',409);
 const raw=token(),csrf=token();const r=(await db.query<{id:string;expires_at:Date}>('INSERT INTO p2_signing_session(case_id,round_id,document_id,staff_session_id,preparer_id,token_hash,csrf_hash,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,now()+interval \'10 minutes\') RETURNING id,expires_at',[id,c.current_round_id,doc.id,user.sessionId,user.id,digest(raw),digest(csrf)])).rows[0];
 await db.query('UPDATE app_session SET signing_suspended=true WHERE id=$1',[user.sessionId]);await event(db,user,id,'P2_SIGNING_STARTED');return {sessionId:r.id,expiresAt:r.expires_at,raw,csrf};
}
async function patientSession(db:Queryable,raw:string,staffSessionId?:string){
 if(!/^[\w-]{43}$/.test(raw))throw new P2Error('SIGNING_SESSION_INVALID',401);
 // Capability binding is immutable; discover it before taking locks, then use the same
 // case-before-signing order as staff return, expiry retry and case mutations.
 const binding=(await db.query<{id:string;case_id:string}>('SELECT id,case_id FROM p2_signing_session WHERE token_hash=$1',[digest(raw)])).rows[0];if(!binding)throw new P2Error('SIGNING_SESSION_EXPIRED_OR_INVALID',401);
 await db.query('SELECT id FROM nipt_case WHERE id=$1 FOR UPDATE',[binding.case_id]);
 const s=(await db.query<{id:string;case_id:string;round_id:string;document_id:string;csrf_hash:string;staff_session_id:string;preparer_id:string;expires_at:Date;state:string}>("SELECT * FROM p2_signing_session WHERE token_hash=$1 AND id=$2 AND case_id=$3 FOR UPDATE",[digest(raw),binding.id,binding.case_id])).rows[0];
 if(!s||s.state!=='Active'||new Date(s.expires_at)<=new Date()||staffSessionId&&s.staff_session_id!==staffSessionId)throw new P2Error('SIGNING_SESSION_EXPIRED_OR_INVALID',401);
 const valid=(await db.query("SELECT d.id FROM p2_document_revision d JOIN nipt_case c ON c.id=d.case_id JOIN p2_workspace w ON w.round_id=d.round_id JOIN app_session a ON a.id=$4 JOIN app_user u ON u.id=a.user_id WHERE d.id=$1 AND c.current_round_id=$2 AND w.consent_mode='Electronic' AND a.signing_suspended AND a.revoked_at IS NULL AND a.absolute_expires_at>now() AND u.enabled AND NOT EXISTS(SELECT 1 FROM p2_revocation WHERE case_id=$3) AND d.version=(SELECT max(version) FROM p2_document_revision WHERE round_id=$2 AND kind='CONSENT')",[s.document_id,s.round_id,s.case_id,s.staff_session_id])).rows[0];if(!valid)throw new P2Error('SIGNING_BINDING_INVALID',409);return s;
}
const preciseUtc=(column:string)=>`to_char(${column} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
async function finalizeCompletedConsent(db:Queryable,sessionId:string,preparerId:string){
 const valid=(await db.query("SELECT d.id FROM p2_signing_session s JOIN p2_document_revision d ON d.id=s.document_id JOIN nipt_case c ON c.id=d.case_id JOIN p2_workspace w ON w.round_id=d.round_id WHERE s.id=$1 AND s.state='Completed' AND s.closed_at IS NOT NULL AND c.current_round_id=d.round_id AND w.consent_mode='Electronic' AND w.version::text=d.payload->>'workspaceVersion' AND NOT EXISTS(SELECT 1 FROM p2_revocation WHERE case_id=c.id) AND d.version=(SELECT max(version) FROM p2_document_revision WHERE round_id=d.round_id AND kind='CONSENT')",[sessionId])).rows[0];
 if(!valid)throw new P2Error('CONSENT_FINALIZATION_INVALIDATED',409);
 const session=(await db.query<{document_id:string;started_at:string;completed_at:string}>(`SELECT document_id,${preciseUtc('created_at')} AS started_at,${preciseUtc('closed_at')} AS completed_at FROM p2_signing_session WHERE id=$1`,[sessionId])).rows[0];
 const doc=(await db.query<{payload:unknown;template_version:string;content_hash:string}>('SELECT payload,template_version,content_hash FROM p2_document_revision WHERE id=$1',[session.document_id])).rows[0];
 const signature=(await db.query(`SELECT decision,vector,png,signature_hash,${preciseUtc('signed_at')} AS signed_at FROM p2_consent_signature WHERE session_id=$1`,[sessionId])).rows[0];
 const acknowledgments=(await db.query(`SELECT item,${preciseUtc('acknowledged_at')} AS acknowledged_at FROM p2_consent_ack WHERE session_id=$1 ORDER BY item`,[sessionId])).rows;
 const content=(doc.payload as {consentContent?:typeof DCC_CONSENT}).consentContent;
 const evidence=content?acknowledgments.map(a=>({...a,clauseId:content.clauses[Number(a.item)-1]?.id,contentVersion:content.id,contentSha256:content.sha256})):acknowledgments;
 const payload={document:doc.payload,...(content?{consentContent:content}:{}),templateVersion:doc.template_version,preparedHash:doc.content_hash,signature,acknowledgments:evidence,session:{id:sessionId,startedAt:session.started_at,completedAt:session.completed_at,preparerId,finalization:'PATIENT_COMPLETED'},synthetic:!operationalDataEnabled()};
 await db.query(`INSERT INTO p2_final_consent(session_id,document_id,payload,content_hash,hash_algorithm) VALUES($1,$2,$3,encode(sha256(convert_to(p2_canonical_jsonb($3::jsonb),'UTF8')),'hex'),'PG_JSONB_CANONICAL_V1') ON CONFLICT(session_id) DO NOTHING`,[sessionId,session.document_id,payload]);
 return true;
}
export async function readSigning(db:Queryable,raw:string,staffSessionId?:string){const s=await patientSession(db,raw,staffSessionId);const d=(await db.query<{payload:unknown;template_version:string}>('SELECT payload,template_version FROM p2_document_revision WHERE id=$1',[s.document_id])).rows[0];const a=await db.query<{item:number;acknowledged_at:string}>(`SELECT item,${preciseUtc('acknowledged_at')} AS acknowledged_at FROM p2_consent_ack WHERE session_id=$1 ORDER BY item`,[s.id]);return {documentId:s.document_id,expiresAt:s.expires_at,templateVersion:d.template_version,document:d.payload,acknowledgments:a.rows};}
export async function patientAction(db:Queryable,raw:string,input:unknown,csrf:{origin:string|null;expectedOrigin:string;token:string},staffSessionId?:string){
 const s=await patientSession(db,raw,staffSessionId);validateCsrf(csrf.origin,csrf.expectedOrigin,csrf.token,s.csrf_hash);
 const d=z.discriminatedUnion('action',[z.strictObject({action:z.literal('acknowledge'),item:z.number().int().min(1).max(12)}),z.strictObject({action:z.literal('complete'),decision:z.enum(['Granted','Declined']),vector:vectorSchema}),z.strictObject({action:z.literal('cancel')})]).parse(input);
 if(d.action==='acknowledge'){await db.query('INSERT INTO p2_consent_ack(session_id,item) VALUES($1,$2) ON CONFLICT DO NOTHING',[s.id,d.item]);return {acknowledged:d.item};}
 if(d.action==='cancel'){await db.query("UPDATE p2_signing_session SET state='Cancelled',closed_at=now() WHERE id=$1",[s.id]);await event(db,{id:s.preparer_id,roles:[],unitIds:[],permissions:[]},s.case_id,'P2_SIGNING_CANCELLED');return {state:'Cancelled',consentFinalized:false};}
 if(Number((await db.query<{n:number}>('SELECT count(*) n FROM p2_consent_ack WHERE session_id=$1',[s.id])).rows[0].n)!==12)throw new P2Error('TWELVE_ACKNOWLEDGMENTS_REQUIRED',422);
 const signature=deriveSignature(d.vector);await db.query('INSERT INTO p2_consent_signature(session_id,document_id,decision,vector,png,signature_hash) VALUES($1,$2,$3,$4,$5,$6)',[s.id,s.document_id,d.decision,signature.vector,signature.png,signature.hash]);
 await db.query("UPDATE p2_signing_session SET state='Completed',closed_at=now() WHERE id=$1",[s.id]);const consentFinalized=await finalizeCompletedConsent(db,s.id,s.preparer_id);await event(db,{id:s.preparer_id,roles:[],unitIds:[],permissions:[]},s.case_id,'P2_CONSENT_'+d.decision.toUpperCase());return {state:d.decision,consentFinalized};
}
export type SigningOutcome='Active'|'Granted'|'Declined'|'Cancelled'|'Expired'|'Invalidated';
async function returnBinding(db:Queryable,user:Staff){
 await assertStaff(db,user,true);if(!user.sessionId)throw new P2Error('UNAUTHENTICATED',401);
 // Discover first, then lock case before signing in every return/read state.
 const binding=(await db.query<{id:string;case_id:string}>('SELECT id,case_id FROM p2_signing_session WHERE staff_session_id=$1 AND preparer_id=$2 ORDER BY (reauthenticated_at IS NULL) DESC,created_at DESC,id DESC LIMIT 1',[user.sessionId,user.id])).rows[0];if(!binding)throw new P2Error('SIGNING_SESSION_INVALID');
 await db.query('SELECT id FROM nipt_case WHERE id=$1 FOR UPDATE',[binding.case_id]);
 const session=(await db.query<{id:string;state:string;expires_at:Date;case_id:string;reauthenticated_at:Date|null}>('SELECT * FROM p2_signing_session WHERE id=$1 AND staff_session_id=$2 AND preparer_id=$3 AND case_id=$4 FOR UPDATE',[binding.id,user.sessionId,user.id,binding.case_id])).rows[0];if(!session)throw new P2Error('SIGNING_SESSION_INVALID');
 let outcome:SigningOutcome=session.state as SigningOutcome;
 if(session.state==='Active'&&new Date(session.expires_at)<=new Date())outcome='Expired';
 if(session.state==='Completed'){
 const signatures=(await db.query<{decision:'Granted'|'Declined'}>('SELECT decision FROM p2_consent_signature WHERE session_id=$1',[session.id])).rows;
 if(signatures.length!==1)throw new P2Error('AMBIGUOUS_CONSENT_EVIDENCE_REQUIRES_GOVERNANCE',409);
 outcome=signatures[0].decision;
 }
 return {session,outcome};
}
/** The existing authenticated staff session is suspended during patient signing. */
export async function signingReturnStatus(db:Queryable,user:Staff){const {session,outcome}=await returnBinding(db,user);return {sessionId:session.id,outcome};}
/** Explicit same-origin handoff to the original authenticated preparer; no second password. */
export async function reauthenticate(db:Queryable,user:Staff,input:unknown){
 const d=z.strictObject({sessionId:uuid,outcome:z.enum(['Active','Granted','Declined','Cancelled','Expired','Invalidated'])}).parse(input);
 const {session,outcome}=await returnBinding(db,user);
 if(d.sessionId!==session.id||d.outcome!==outcome)throw new P2Error('SIGNING_RETURN_STATE_CHANGED',409);
 if(outcome==='Active')throw new P2Error('CANCEL_OR_COMPLETE_SIGNING_FIRST',409);
 if(session.state==='Completed'&&!(await db.query('SELECT id FROM p2_final_consent WHERE session_id=$1',[session.id])).rows[0])throw new P2Error('CONSENT_FINALIZATION_MISSING',409);
 if(session.state==='Active')await db.query("UPDATE p2_signing_session SET state='Expired',closed_at=now() WHERE id=$1",[session.id]);
 await db.query('UPDATE p2_signing_session SET reauthenticated_at=COALESCE(reauthenticated_at,now()) WHERE id=$1',[session.id]);
 await db.query('UPDATE app_session SET signing_suspended=false,idle_expires_at=LEAST(now()+interval \'30 minutes\',absolute_expires_at),last_seen_at=now() WHERE id=$1',[user.sessionId]);
 await event(db,user,session.case_id,'P2_STAFF_RETURNED_FROM_SIGNING',{returnOutcome:outcome});
 return {ok:true,caseId:session.case_id,consentFinalized:session.state==='Completed'};
}
export async function withdraw(db:Queryable,user:Staff,id:string,input:unknown){
 const d=z.strictObject({reason:syntheticText.refine(v=>v.length>0)}).parse(input),c=await activeCase(db,user,id,'consent.withdraw.receive');
 const later=(await db.query('SELECT 1 WHERE EXISTS(SELECT 1 FROM specimen_round_current WHERE case_id=$1 AND analysis_started) OR EXISTS(SELECT 1 FROM result_report_version WHERE case_id=$1)',[id])).rows.length>0;
 // Owner final ANC lock: after analysis there is no ANC withdrawal action or notice intake.
 // Preserve the separate LAB workflow, which is outside this ANC remediation.
 if(later&&user.roles.some(role=>role==='ANC_NURSE'||role==='ANC_SUPERVISOR'))throw new P2Error('WITHDRAWAL_UNAVAILABLE_AFTER_ANALYSIS',409);
 if(later){await event(db,user,id,'P2_WITHDRAWAL_NOTICE_RECEIVED',{reason:d.reason,roundId:c.current_round_id,receivedAt:new Date().toISOString(),governance:'PendingGovernance'});return {notice:true,disposition:'PendingGovernance',automaticMutation:false};}
 const stage=c.state==='Expected'?'W0':'W1';const r=(await db.query<{id:string}>('INSERT INTO p2_revocation(case_id,round_id,stage,reason,actor_id) VALUES($1,$2,$3,$4,$5) RETURNING id',[id,c.current_round_id,stage,d.reason,user.id])).rows[0];
 await db.query("INSERT INTO p2_disposition(revocation_id,state,reason,actor_id) VALUES($1,'PendingGovernance',$2,$3)",[r.id,d.reason,user.id]);await invalidate(db,id);await event(db,user,id,'P2_CONSENT_REVOKED',{stage,reason:d.reason});return {id:r.id,stage,state:'RevokedHold',disposition:'PendingGovernance'};
}
export async function listDoctors(db:Queryable,user:Staff){await assertStaff(db,user);if(!user.roles.some(r=>['ANC_NURSE','ANC_SUPERVISOR','LAB_STAFF','LAB_CERTIFIER','APP_ADMIN','CLINICAL_APPROVER'].includes(r)))throw new P2Error('FORBIDDEN',403);const r=await db.query<{unit_id:string;doctor_key:string;version:number;status:string|null;effective_from:Date;has_signature:boolean}>('SELECT v.id,v.doctor_key,v.version,v.name,v.unit_id,v.effective_from,v.created_by,v.authorization_evidence AS authorization,(v.signature_png IS NOT NULL) has_signature,(SELECT e.event_type FROM p2_doctor_event e WHERE e.doctor_version_id=v.id ORDER BY e.created_at DESC,e.id DESC LIMIT 1) status FROM p2_doctor_version v ORDER BY doctor_key,version DESC');return r.rows.map(x=>({...x,active:x.has_signature&&x.status!=='Suspended'&&new Date(x.effective_from)<=new Date()&&!r.rows.some(n=>n.doctor_key===x.doctor_key&&n.version>x.version&&new Date(n.effective_from)<=new Date())}));}
export async function doctorAction(db:Queryable,user:Staff,input:unknown){
 if(input&&typeof input==='object'&&'action' in input&&input.action==='save')return (await import('./doctor-registry')).saveDoctor(db,user,input);
 await assertStaff(db,user);
 const d=z.discriminatedUnion('action',[z.strictObject({action:z.literal('propose'),doctorKey:z.string().max(64).refine(v=>operationalDataEnabled()?/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(v):/^SYNTHETIC-[A-Z0-9-]+$/.test(v)),name:syntheticText.refine(v=>v.length>0),unitId:uuid,effectiveFrom:z.iso.datetime(),authorization:syntheticText.refine(v=>v.length>0),vector:vectorSchema}),z.strictObject({action:z.enum(['approve','suspend']),id:uuid,reason:syntheticText.refine(v=>v.length>0)})]).parse(input);
 // Direct ANC saves manage the shared registry. Legacy approval endpoints must
 // not inherit cross-unit approval rights from the new direct-management role.
 if(d.action!=='propose'&&!user.roles.some(r=>r==='CLINICAL_APPROVER'||r==='APP_ADMIN'))throw new P2Error('FORBIDDEN',403);
 requirePermission(user,'doctor.manage',{},d.action==='propose'?'propose':'approve');
 if(d.action==='propose'){if(!user.roles.includes('APP_ADMIN')&&!user.unitIds.includes(d.unitId))throw new P2Error('FORBIDDEN',403);await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,75432803))',[d.doctorKey]);const sig=deriveSignature(d.vector);const v=Number((await db.query<{n:number}>('SELECT COALESCE(max(version),0)+1 n FROM p2_doctor_version WHERE doctor_key=$1',[d.doctorKey])).rows[0].n);const r=(await db.query('INSERT INTO p2_doctor_version(doctor_key,version,name,unit_id,effective_from,authorization_evidence,signature,signature_png,signature_hash,created_by,synthetic) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id,version',[d.doctorKey,v,d.name,d.unitId,d.effectiveFrom,d.authorization,sig.vector,sig.png,sig.hash,user.id,!operationalDataEnabled()])).rows[0];await appendAudit(db,{actorId:user.id,action:'P2_DOCTOR_PROPOSED',resourceType:'p2_doctor_version',resourceId:String(r.id),details:{synthetic:!operationalDataEnabled()}});return r;}
 const v=(await db.query<{created_by:string}>('SELECT created_by FROM p2_doctor_version WHERE id=$1',[d.id])).rows[0];if(!v||d.action==='approve'&&v.created_by===user.id)throw new P2Error('MAKER_CHECKER_REQUIRED',403);
 await db.query('INSERT INTO p2_doctor_event(doctor_version_id,event_type,actor_id,reason) VALUES($1,$2,$3,$4)',[d.id,d.action==='approve'?'Approved':'Suspended',user.id,d.reason]);await appendAudit(db,{actorId:user.id,action:d.action==='approve'?'P2_DOCTOR_APPROVED':'P2_DOCTOR_SUSPENDED',resourceType:'p2_doctor_version',resourceId:d.id,details:{synthetic:!operationalDataEnabled()}});return {id:d.id,status:d.action==='approve'?'Approved':'Suspended'};
}
export async function doctorUnits(db:Queryable,user:Staff){await assertStaff(db,user);if(!user.roles.some(r=>['ANC_NURSE','ANC_SUPERVISOR','LAB_STAFF','LAB_CERTIFIER','APP_ADMIN','CLINICAL_APPROVER'].includes(r)))throw new P2Error('FORBIDDEN',403);return (await db.query<{id:string;code:string;name:string}>('SELECT id,code,name FROM unit WHERE active ORDER BY code')).rows;}
const registryInput=z.strictObject({q:z.string().max(60).default(''),sort:z.enum(['registered','asc','desc']).default('registered'),...pageFields(25)});
/** Registry page. Everything that decides what is on the page - scope, search, sort, total - is evaluated by one SQL predicate, so the
 * total always matches the rows reachable by paging, and a page costs one bounded query plus one count (never the whole registry). */
export async function listP2Cases(db:Queryable,user:Staff,input:unknown={}){
 const parsed=registryInput.safeParse(input);
 if(!parsed.success){const bad=new Set(parsed.error.issues.map(i=>String(i.path[0])));throw new P2Error(bad.has('sort')?'SORT_INVALID':bad.has('q')?'SEARCH_INVALID':'PAGE_INVALID');}
 const {q:search,sort,page:requested,pageSize}=parsed.data;
 await assertStaff(db,user);
 const allUnits=(await db.query<{id:string;code:string;name:string}>('SELECT id,code,name FROM unit ORDER BY code')).rows;
 // Scope is decided per (unit, origin) exactly as authorize() decides it for the row; the SQL predicate and the post-filter below agree.
 const origins=['ANC','LAB_DIRECT'] as const;
 const readable=allUnits.flatMap(u=>origins.filter(o=>authorize(user,'case.read',{unitId:u.id,origin:o},'read')).map(o=>u.id+':'+o));
 const halosTerm=search.replace(/[DR]{1,2}$/i,'');
 const canHalos=authorize(user,'worksheet.read',{},'read')&&halosTerm.length>=4;
 const scanLn=/^\d{2}-\d{3}-\d-\d{4}$/.test(search)?search.replaceAll('-',''):search;
 const values:unknown[]=[likeContains(search),readable,canHalos,likeContains(halosTerm),likeContains(scanLn)];
 // LN Halos is Lab numbering: searchable only by roles that can already read the Lab worksheet. The printed code may carry a D/R suffix.
 const base=`FROM nipt_case c JOIN case_ln l ON l.id=(SELECT cl.id FROM case_ln cl WHERE cl.case_id=c.id ORDER BY cl.id LIMIT 1) LEFT JOIN p2_case_identity i ON i.case_id=c.id
  JOIN LATERAL(SELECT us.unit_id FROM case_unit_scope us WHERE us.case_id=c.id AND (us.unit_id::text||':'||c.registration_origin)=ANY($2::text[]) ORDER BY us.unit_id LIMIT 1) s ON true
  ${currentPetPatientJoin}
  JOIN specimen_round_current r ON r.id=c.current_round_id LEFT JOIN p2_workspace w ON w.round_id=r.id
  LEFT JOIN LATERAL (
   SELECT NULLIF(btrim(older.draft#>>'{patient,syntheticName}'),'') AS name
   FROM p2_workspace older JOIN specimen_round_current older_round ON older_round.id=older.round_id
   WHERE older.case_id=c.id AND NULLIF(btrim(older.draft#>>'{patient,syntheticName}'),'') IS NOT NULL
   ORDER BY older_round.round_number DESC LIMIT 1
  ) patient_history ON true
  WHERE c.registration_origin IN ('ANC','LAB_DIRECT') AND NOT EXISTS(SELECT 1 FROM p2_registration_void v WHERE v.case_id=c.id) AND (l.ln LIKE $1 OR l.ln LIKE $5 OR i.hn LIKE $1 OR COALESCE(CASE WHEN pet_patient.inbound_file_id IS NOT NULL THEN pet_patient.name ELSE COALESCE(NULLIF(btrim(w.draft#>>'{patient,syntheticName}'),''),patient_history.name) END,'') ILIKE $1
   OR ($3::boolean AND EXISTS(SELECT 1 FROM specimen_lab_number n WHERE n.case_id=c.id AND n.ln_halos ILIKE $4)))`;
 const total=Number((await db.query<{n:string}>(`SELECT count(*)::text n ${base}`,values)).rows[0].n);
 const meta=clampPage(requested,total,pageSize);
 const rows=(await db.query<CaseScope&{received_at:Date|null;received_source:string|null;draft:RequestDraft|null;patient_name:string|null;collection_date:string|null;version:number|null;request_mode:string|null;consent_mode:string|null;consent_decision:string|null;clinical_ready:boolean;released:boolean}>(
  `SELECT c.id,l.ln,i.hn,c.registration_origin,c.current_round_id,s.unit_id,r.state,r.analysis_started,r.round_number,r.received_at,r.received_source,r.collection_date::text,w.draft,CASE WHEN pet_patient.inbound_file_id IS NOT NULL THEN pet_patient.name ELSE COALESCE(NULLIF(btrim(w.draft#>>'{patient,syntheticName}'),''),patient_history.name) END patient_name,w.version,w.request_mode,w.consent_mode,p2_clinical_ready(r.id) clinical_ready,EXISTS(SELECT 1 FROM result_release rr JOIN result_report_version rv ON rv.id=rr.version_id WHERE rr.case_id=c.id AND rr.round_id=r.id AND rr.kind='RESULT' AND rr.state='Active' AND rv.case_id=c.id AND rv.round_id=r.id AND rv.kind='RESULT' AND rv.state='CertifiedReleased') released,(CASE WHEN w.round_id IS NULL THEN NULL ELSE p2_consent_latest_decision(w.round_id) END) consent_decision ${base}
   ORDER BY ${sort==='registered'?'c.created_at DESC,c.id':receiveOrderSql('r.received_at',sort,['l.ln','c.id'])} LIMIT ${pageSize} OFFSET ${offsetOf(meta)}`,values)).rows;
 const seen=new Set<string>();const cases=rows.filter(c=>{if(seen.has(c.id)||!authorize(user,'case.read',{unitId:c.unit_id,origin:c.registration_origin},'read'))return false;seen.add(c.id);return true;}).map(({draft,...c})=>({...c,patient_name:c.patient_name?.trim()||null,ga:registryGa(draft?.pregnancy.edd,c.collection_date??draft?.pregnancy.collectionDate),identityVerified:c.hn!==null,progress:draft?{missing:requestProgressIssues(draft),savedVersion:c.version}:null}));
 const units=allUnits.filter(u=>authorize(user,'case.register.anc',{unitId:u.id,origin:'ANC'})||authorize(user,'case.register.lab',{unitId:u.id,origin:'LAB_DIRECT'}));
 if(cases.length)await recordPhiAccess(db,user.id,cases.map(c=>c.id),'REGISTRY_VIEW');
 return {cases,units,page:meta};
}

/** Human clinical assessment bound to the exact current round and all document/receipt evidence. */
export async function approveClinicalP2(db:Queryable,user:Staff,id:string,input:unknown){
 if(!operationalDataEnabled())throw new P2Error('OPERATIONAL_MODE_REQUIRED',423);
 const d=z.strictObject({expectedVersion:z.number().int().min(0),reason:syntheticText.refine(v=>v.length>0),sourceReference:syntheticText.refine(v=>v.length>0),attestation:z.literal(true)}).parse(input);
 const c=await activeCase(db,user,id,'clinical.correct'),w=await workspace(db,c,user);
 if(!user.roles.includes('CLINICAL_APPROVER'))throw new P2Error('FORBIDDEN',403);
 if(w.version!==d.expectedVersion)throw new P2Error('VERSION_CONFLICT',409);
 if(await collectionConflict(db,c))throw new P2Error('COLLECTION_DATE_MISMATCH',409);
 const source=(await db.query<{source:Record<string,unknown>;hash:string}>('SELECT p2_clinical_source($1) AS source,p2_clinical_source_hash($1) AS hash',[c.current_round_id])).rows[0];
 const evidence=source.source;
 if(w.request_mode==='Electronic'){
  const draft=requestSchema.parse(w.draft),assessment=evaluateClinical(draft);
  if(requestIssues(draft).length||assessment.state!=='PendingClinicalReview')throw new P2Error('CLINICAL_DATA_NOT_REVIEWABLE',422);
  const request=evidence.requestDocument as {payload?:{draft?:unknown}}|null;
  if(!request||canonical(request.payload?.draft)!==canonical(draft))throw new P2Error('CURRENT_REQUEST_REQUIRED',409);
  await activeDoctor(db,draft.ordering.doctorVersionId!,c.unit_id);
 }else if((evidence.paperRequest as {status?:string}|null)?.status!=='Verified')throw new P2Error('VERIFIED_REQUEST_REQUIRED',409);
 if((await db.query<{d:string|null}>('SELECT p2_consent_latest_decision($1) AS d',[c.current_round_id])).rows[0].d==='Declined')throw new P2Error('CONSENT_DECLINED',409);
 if(w.consent_mode==='Electronic'){
  const caseFinal=evidence.caseFinalConsent as {document_id?:string;round_id?:string;payload?:{signature?:{decision?:string}}}|null;
  const reusablePriorRoundConsent=caseFinal?.payload?.signature?.decision==='Granted'&&typeof caseFinal.round_id==='string'&&caseFinal.round_id!==c.current_round_id;
  if(!reusablePriorRoundConsent){
   const final=evidence.finalConsent as {document_id?:string;payload?:{signature?:{decision?:string}}}|null;
   const document=evidence.consentDocument as {id?:string;payload?:{workspaceVersion?:number}}|null;
   const binding=document&&(await db.query<{matches:boolean}>('SELECT p2_consent_workspace_matches($1::jsonb,$2::jsonb,$3) matches',[JSON.stringify(document.payload),JSON.stringify(w.draft),w.version])).rows[0].matches;
   if(!final||final.document_id!==document?.id||!binding||final.payload?.signature?.decision!=='Granted')throw new P2Error('CURRENT_GRANTED_CONSENT_REQUIRED',409);
  }
 }else{
  // Paper Consent marker (Owner 2026-10-18): the selection is enough to proceed; it is not signing evidence. Only a recorded refusal stops it (checked below for both channels).
 }
 const result={state:'ClinicalPassed',passed:true,authority:'AUTHORIZED_CLINICAL_REVIEW',sourceHash:source.hash,workspaceVersion:w.version,reviewerId:user.id,reason:d.reason,sourceReference:d.sourceReference,attestation:true};
 const row=(await db.query('INSERT INTO clinical_snapshot(case_id,round_id,rule_version,input_snapshot,result) VALUES($1,$2,$3,$4,$5) RETURNING id',[id,c.current_round_id,'CBH-AUTHORIZED-REVIEW-v1',source.source,result])).rows[0];
 await event(db,user,id,'P2_CLINICAL_REVIEW_APPROVED',{snapshotId:row.id,sourceHash:source.hash});return {id:row.id,...result};
}
