import {z} from 'zod';
import {createHash} from 'node:crypto';
import type {Queryable} from '../db/connection';
import {registerCase,lockLn} from '../db/registration';
import {identityLookup} from '../security/envelope';
import {requirePermission,authorize,type Principal,type Operation} from '../security/policy';
import {appendAudit} from '../db/audit';
import {recordPhiAccess} from '../db/phi-access';
import {digest,token,validateCsrf} from '../security/session';
import {verifyPassword} from '../security/password';
import {deriveSignature,vectorSchema} from './signature';
import {requestSchema,emptyRequest,requestIssues,evaluateClinical,paperSchema,paperStatus,syntheticText,date,CONSENT_TEMPLATE,REQUEST_TEMPLATE,consentClauses,type RequestDraft} from './schema';

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
 const r=await db.query<CaseScope>('SELECT c.id,l.ln,i.hn,c.registration_origin,c.current_round_id,s.unit_id,r.state,r.analysis_started,r.round_number FROM nipt_case c JOIN case_ln l ON l.case_id=c.id LEFT JOIN p2_case_identity i ON i.case_id=c.id JOIN case_unit_scope s ON s.case_id=c.id JOIN specimen_round r ON r.id=c.current_round_id WHERE c.id=$1',[id]);
 const item=r.rows.find(x=>authorize(user,action,{unitId:x.unit_id,origin:x.registration_origin},operation));if(!item)throw new P2Error('FORBIDDEN',403);return item;
}
async function event(db:Queryable,user:Principal,caseId:string,action:string,details:Record<string,unknown>={}){
 await db.query('INSERT INTO case_event(case_id,event_type,details) VALUES($1,$2,$3)',[caseId,action,{...details,actorId:user.id,synthetic:true}]);
 await appendAudit(db,{actorId:user.id,action,resourceType:'nipt_case',resourceId:caseId,details:{synthetic:true}});
}
async function activeCase(db:Queryable,user:Staff,id:string,action:string){const c=await scopedCase(db,user,id,action,'write');if(!c.hn)throw new P2Error('IDENTITY_UNVERIFIED',409);await db.query('SELECT id FROM nipt_case WHERE id=$1 FOR UPDATE',[id]);if((await db.query('SELECT id FROM p2_revocation WHERE case_id=$1 LIMIT 1',[id])).rows[0])throw new P2Error('CONSENT_REVOKED_HOLD',409);return c;}
async function workspace(db:Queryable,c:CaseScope,user:Staff){
 await db.query("INSERT INTO p2_workspace(round_id,case_id,draft,request_mode,consent_mode,updated_by) VALUES($1,$2,$3,$4,$4,$5) ON CONFLICT DO NOTHING",[c.current_round_id,c.id,emptyRequest,c.registration_origin==='LAB_DIRECT'?'Paper':'Electronic',user.id]);
 return (await db.query<{round_id:string;case_id:string;version:number;draft:RequestDraft;request_mode:'Electronic'|'Paper';consent_mode:'Electronic'|'Paper'}>('SELECT * FROM p2_workspace WHERE round_id=$1 FOR UPDATE',[c.current_round_id])).rows[0];
}
async function invalidate(db:Queryable,caseId:string){await db.query("UPDATE p2_signing_session SET state='Invalidated',closed_at=now() WHERE case_id=$1 AND state='Active'",[caseId]);}
export async function registerP2(db:Queryable,user:Staff,input:unknown,key:Buffer){
 await assertStaff(db,user);
 const d=z.strictObject({ln:z.string().trim().regex(/^[0-9-]{6,24}$/).refine(v=>/^0*990[0-9]{3,17}$/.test(v.replaceAll('-',''))),hn:z.string().trim().regex(/^0*990[0-9]{3,17}$/),unitId:uuid,origin:z.enum(['ANC','LAB_DIRECT']),idempotencyKey:z.string()}).parse(input);
 const ln=d.ln.replaceAll('-','');requirePermission(user,d.origin==='ANC'?'case.register.anc':'case.register.lab',{unitId:d.unitId,origin:d.origin});
 if(!(await db.query('SELECT id FROM unit WHERE id=$1',[d.unitId])).rows[0])throw new P2Error('UNIT_REQUIRED');
 // Match BOTH identifiers under a keyed HMAC; generic P1 normalization remains unchanged.
 await lockLn(db,ln);
 const prior=(await db.query<{id:string;unit_id:string;registration_origin:'ANC'|'LAB_DIRECT'}>('SELECT c.id,s.unit_id,c.registration_origin FROM case_ln l JOIN nipt_case c ON c.id=l.case_id LEFT JOIN case_unit_scope s ON s.case_id=c.id WHERE l.ln=$1',[ln])).rows;
 if(prior.length&&!prior.some(x=>authorize(user,'case.read',{unitId:x.unit_id,origin:x.registration_origin},'read')))return {outcome:'IDENTITY_UNVERIFIED',caseId:null};
 const result=await registerCase(db,{ln,identityKey:identityLookup(JSON.stringify([ln,d.hn]),key),origin:d.origin,actorId:user.id,idempotencyKey:d.idempotencyKey});
 if(!result.caseId)return {outcome:'IDENTITY_UNVERIFIED',caseId:null};
 if(result.outcome==='CREATED'){await db.query('INSERT INTO case_unit_scope(case_id,unit_id) VALUES($1,$2)',[result.caseId,d.unitId]);await db.query('INSERT INTO p2_case_identity(case_id,hn) VALUES($1,$2)',[result.caseId,d.hn]);}
 const c=await scopedCase(db,user,result.caseId);await workspace(db,c,user);return result;
}
export async function getCase(db:Queryable,user:Staff,id:string){
 const c=await scopedCase(db,user,id),w=await workspace(db,c,user);
 const [revisions,paper,clinical,collection,revocations,signatures,finalConsents]=[
 await db.query('SELECT id,kind,version,template_version,content_hash,payload,reason,created_at FROM p2_document_revision WHERE case_id=$1 ORDER BY created_at DESC',[id]),
 await db.query('SELECT * FROM p2_paper_review WHERE case_id=$1 ORDER BY created_at DESC',[id]),
 await db.query('SELECT * FROM clinical_snapshot WHERE case_id=$1 ORDER BY created_at DESC',[id]),
 await db.query('SELECT *,collection_date::text AS collection_date FROM p2_collection_fact WHERE case_id=$1 ORDER BY created_at',[id]),
 await db.query('SELECT * FROM p2_revocation WHERE case_id=$1 ORDER BY created_at',[id]),
 await db.query('SELECT s.id,s.document_id,s.decision,s.signature_hash,s.signed_at FROM p2_consent_signature s JOIN p2_document_revision d ON d.id=s.document_id WHERE d.case_id=$1 ORDER BY signed_at DESC',[id]),await db.query('SELECT f.id,f.document_id,f.content_hash,f.hash_algorithm,f.payload,f.created_at FROM p2_final_consent f JOIN p2_document_revision d ON d.id=f.document_id WHERE d.case_id=$1 ORDER BY f.created_at DESC',[id])];
 const roundReceipt=(await db.query(`SELECT id AS "roundId",received_source AS "receivedSource",${preciseUtc('received_at')} AS "receivedAt",collection_date::text AS "collectionDate" FROM specimen_round WHERE id=$1`,[c.current_round_id])).rows[0];
 const currentCollectionFacts=(await db.query('SELECT DISTINCT ON(source) source,collection_date::text AS collection_date,collection_time,actor_id,reason,sequence FROM p2_collection_fact WHERE round_id=$1 ORDER BY source,sequence DESC',[c.current_round_id])).rows;
 const history={rounds:(await db.query('SELECT id,round_number,state,received_source FROM specimen_round WHERE case_id=$1 ORDER BY round_number,id',[id])).rows,events:(await db.query('SELECT event_type,created_at FROM case_event WHERE case_id=$1 ORDER BY created_at DESC,id DESC',[id])).rows};
 const actions=['request.edit','request.correct','consent.prepare','paper.verify','consent.withdraw.receive'].filter(a=>authorize(user,a,{unitId:c.unit_id,origin:c.registration_origin},'write'));
 await recordPhiAccess(db,user.id,[id],'CASE_DETAIL_VIEW');
 return {case:c,workspace:w,history,roundReceipt,currentCollectionFacts,revisions:revisions.rows,paper:paper.rows,clinical:clinical.rows,collection:collection.rows,revocations:revocations.rows,signatures:signatures.rows,finalConsents:finalConsents.rows,allowedActions:actions,gate:{passed:false,state:revocations.rows.length?'RevokedHold':'PendingClinicalReview',reason:'CLINICAL_DPO_DCC_APPROVAL_PENDING'}};
}
async function collectionConflict(db:Queryable,c:CaseScope,dateValue?:string|null){const r=await db.query<{collection_date:string|Date}>('SELECT DISTINCT ON(source) collection_date::text AS collection_date FROM p2_collection_fact WHERE round_id=$1 ORDER BY source,sequence DESC',[c.current_round_id]);const his=await db.query<{collection_date:string|Date}>('SELECT collection_date::text AS collection_date FROM specimen_round WHERE id=$1 AND received_source=\'HIS_PET_RECEIPT\' AND collection_date IS NOT NULL',[c.current_round_id]);const dates=new Set([...r.rows,...his.rows].map(x=>new Date(x.collection_date).toISOString().slice(0,10)));if(dateValue)dates.add(dateValue);return dates.size>1;}
async function collect(db:Queryable,c:CaseScope,user:Staff,d:RequestDraft,reason='SYNTHETIC_CAPTURE'){if(d.pregnancy.collectionDate&&d.pregnancy.collectionSource){
 const p=d.pregnancy,today=new Date(Date.now()+7*3600000).toISOString().slice(0,10);if(p.collectionDate!>today)throw new P2Error('COLLECTION_DATE_FUTURE',422);
 const prior=(await db.query<{round_id:string;collection_date:string}>(`SELECT round_id,collection_date::text FROM (SELECT DISTINCT ON(f.round_id,f.source) f.round_id,f.source,f.collection_date FROM p2_collection_fact f JOIN specimen_round r ON r.id=f.round_id WHERE r.case_id=$1 AND r.round_number<$2 ORDER BY f.round_id,f.source,f.sequence DESC) latest UNION ALL SELECT id,collection_date::text FROM specimen_round WHERE case_id=$1 AND round_number<$2 AND received_source IS NOT NULL AND collection_date IS NOT NULL`,[c.id,c.round_number])).rows;
 const previousDates=new Map<string,Set<string>>();for(const fact of prior){const dates=previousDates.get(fact.round_id)??new Set<string>();dates.add(fact.collection_date);previousDates.set(fact.round_id,dates);}if([...previousDates.values()].some(dates=>dates.size>1))throw new P2Error('PREVIOUS_ROUND_COLLECTION_CONFLICT',409);if(prior.some(f=>f.collection_date>p.collectionDate!))throw new P2Error('COLLECTION_DATE_BEFORE_PREVIOUS_ROUND',422);
 const latest=(await db.query<{collection_date:Date|string;collection_time:string|null}>('SELECT collection_date::text AS collection_date,collection_time FROM p2_collection_fact WHERE round_id=$1 AND source=$2 ORDER BY sequence DESC LIMIT 1',[c.current_round_id,p.collectionSource])).rows[0];if(latest&&new Date(latest.collection_date).toISOString().slice(0,10)===p.collectionDate&&latest.collection_time===p.collectionTime)return;
 await db.query('INSERT INTO p2_collection_fact(case_id,round_id,source,collection_date,collection_time,actor_id,reason) VALUES($1,$2,$3,$4,$5,$6,$7)',[c.id,c.current_round_id,p.collectionSource,p.collectionDate,p.collectionTime,user.id,reason]);}}
async function evaluate(db:Queryable,c:CaseScope,d:RequestDraft){const result=evaluateClinical(d,await collectionConflict(db,c,d.pregnancy.collectionDate));await db.query('INSERT INTO clinical_snapshot(case_id,round_id,rule_version,input_snapshot,result) VALUES($1,$2,$3,$4,$5)',[c.id,c.current_round_id,result.ruleVersion,d,result]);return result;}
export async function saveRequest(db:Queryable,user:Staff,id:string,input:unknown){
 const d=z.strictObject({expectedVersion:z.number().int().min(0),draft:requestSchema,reason:syntheticText.refine(v=>v.length>0).optional()}).parse(input),c=await activeCase(db,user,id,'request.edit'),w=await workspace(db,c,user);
 if(w.version!==d.expectedVersion)throw new P2Error('VERSION_CONFLICT',409,{version:w.version,draft:w.draft});
 const locked=(await db.query("SELECT id FROM p2_document_revision WHERE round_id=$1 AND kind='REQUEST' LIMIT 1",[c.current_round_id])).rows[0];if(locked){requirePermission(user,'request.correct',{unitId:c.unit_id,origin:c.registration_origin});if(!d.reason)throw new P2Error('AMENDMENT_REASON_REQUIRED',422);}
 await collect(db,c,user,d.draft,d.reason);await db.query('UPDATE p2_workspace SET draft=$2,version=version+1,updated_by=$3,updated_at=now() WHERE round_id=$1',[c.current_round_id,d.draft,user.id]);
 for(const item of ['conditionA','conditionB'] as const)if(d.draft.acknowledgments[item]!==null&&d.draft.acknowledgments[item]!==w.draft.acknowledgments[item])await db.query('INSERT INTO p2_request_ack(case_id,round_id,item,answer,workspace_version,actor_id) VALUES($1,$2,$3,$4,$5,$6)',[id,c.current_round_id,item,d.draft.acknowledgments[item],w.version+1,user.id]);
 const clinical=await evaluate(db,c,d.draft);await invalidate(db,id);await event(db,user,id,'P2_REQUEST_AUTOSAVED');return {version:w.version+1,draft:d.draft,clinical};
}
export async function activeDoctor(db:Queryable,id:string,unitId:string){uuid.parse(id);const row=(await db.query<{id:string;name:string;version:number;signature_png:string;signature_hash:string;doctor_key:string;authorization:string}>('SELECT v.* FROM p2_doctor_version v WHERE v.id=$1 AND v.unit_id=$2 AND v.effective_from<=now() AND (SELECT e.event_type FROM p2_doctor_event e WHERE e.doctor_version_id=v.id ORDER BY e.created_at DESC,e.id DESC LIMIT 1)=\'Approved\' AND NOT EXISTS(SELECT 1 FROM p2_doctor_version n JOIN p2_doctor_event e ON e.doctor_version_id=n.id AND e.event_type=\'Approved\' WHERE n.doctor_key=v.doctor_key AND n.version>v.version AND n.effective_from<=now())',[id,unitId])).rows[0];if(!row)throw new P2Error('AUTHORIZED_SYNTHETIC_DOCTOR_REQUIRED',422);return row;}
async function revision(db:Queryable,user:Staff,c:CaseScope,kind:'REQUEST'|'CONSENT',payload:unknown,reason:string){
 const version=Number((await db.query<{n:number}>('SELECT COALESCE(max(version),0)+1 n FROM p2_document_revision WHERE round_id=$1 AND kind=$2',[c.current_round_id,kind])).rows[0].n);
 const r=(await db.query<{id:string;version:number;content_hash:string}>('INSERT INTO p2_document_revision(case_id,round_id,kind,version,template_version,payload,content_hash,reason,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id,version,content_hash',[c.id,c.current_round_id,kind,version,kind==='REQUEST'?REQUEST_TEMPLATE:CONSENT_TEMPLATE,payload,contentHash(payload),reason,user.id])).rows[0];await invalidate(db,c.id);return r;
}
export async function lockRequest(db:Queryable,user:Staff,id:string,input:unknown){
 const d=z.strictObject({expectedVersion:z.number().int().min(0),reason:syntheticText.refine(v=>v.length>0)}).parse(input),c=await activeCase(db,user,id,'request.edit'),w=await workspace(db,c,user);if(w.request_mode!=='Electronic')throw new P2Error('REQUEST_PAPER_MODE');
 if(w.version!==d.expectedVersion)throw new P2Error('VERSION_CONFLICT',409,{version:w.version,draft:w.draft});
 const draft=requestSchema.parse(w.draft),issues=requestIssues(draft);if(issues.length)throw new P2Error('REQUEST_INCOMPLETE',422,{fields:issues});
 if(await collectionConflict(db,c,draft.pregnancy.collectionDate))throw new P2Error('COLLECTION_DATE_MISMATCH',409);
 const doctor=await activeDoctor(db,draft.ordering.doctorVersionId!,c.unit_id);const clinical=await evaluate(db,c,draft);
 const acknowledgmentEvidence=(await db.query('SELECT item,answer,workspace_version,actor_id,created_at FROM p2_request_ack WHERE round_id=$1 ORDER BY created_at',[c.current_round_id])).rows;
 const r=await revision(db,user,c,'REQUEST',{identity:{caseId:c.id,ln:c.ln,hn:c.hn,roundId:c.current_round_id,roundNumber:c.round_number},draft,clinical,doctor,acknowledgmentEvidence,caption:'authorized synthetic stored signature, not freshly signed',unsigned:false,synthetic:true},d.reason);await event(db,user,id,'P2_REQUEST_LOCKED');return r;
}
export async function setModes(db:Queryable,user:Staff,id:string,input:unknown){const d=z.strictObject({expectedVersion:z.number().int().min(0),requestMode:z.enum(['Electronic','Paper']),consentMode:z.enum(['Electronic','Paper']),reason:syntheticText.refine(v=>v.length>0)}).parse(input),c=await activeCase(db,user,id,'consent.prepare'),w=await workspace(db,c,user);if(w.version!==d.expectedVersion)throw new P2Error('VERSION_CONFLICT',409,{version:w.version,draft:w.draft});await db.query('UPDATE p2_workspace SET request_mode=$2,consent_mode=$3,version=version+1,updated_by=$4,updated_at=now() WHERE round_id=$1',[c.current_round_id,d.requestMode,d.consentMode,user.id]);await invalidate(db,id);await event(db,user,id,'P2_MODES_CHANGED',{reason:d.reason});return {version:w.version+1,requestMode:d.requestMode,consentMode:d.consentMode};}
export async function paperReview(db:Queryable,user:Staff,id:string,input:unknown){
 const ack=z.strictObject({syntheticName:syntheticText.refine(v=>v.length>0),date,source:z.literal('PAPER_ORIGINAL')});
 const d=z.strictObject({kind:z.enum(['REQUEST','CONSENT']),templateVersion:z.enum([REQUEST_TEMPLATE,CONSENT_TEMPLATE]),documentReference:syntheticText.refine(v=>v.length>0),panel:paperSchema,location:syntheticText.refine(v=>v.length>0),reason:syntheticText.refine(v=>v.length>0),operation:z.enum(['Review','Replace','Amend']),previousId:uuid.nullable(),acknowledgmentEvidence:z.strictObject({conditionA:ack.optional(),conditionB:ack.optional()}).optional()}).parse(input),c=await activeCase(db,user,id,'paper.verify'),w=await workspace(db,c,user);
 const relevant=d.kind==='CONSENT'?['decision','signatures','representative']:Object.keys(paperSchema.shape).filter(k=>!['decision','signatures','representative'].includes(k));if(Object.entries(d.panel).some(([k,v])=>!relevant.includes(k)&&v!==null))throw new P2Error('PAPER_IRRELEVANT_FIELDS_MUST_BE_NULL',422);
 if((d.kind==='REQUEST'?w.request_mode:w.consent_mode)!=='Paper'||d.templateVersion!==(d.kind==='REQUEST'?REQUEST_TEMPLATE:CONSENT_TEMPLATE))throw new P2Error('PAPER_DOCUMENT_MODE_TEMPLATE_MISMATCH');
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
export async function preparePaper(db:Queryable,user:Staff,id:string,input:unknown){const d=z.strictObject({kind:z.enum(['REQUEST','CONSENT']),documentReference:syntheticText.refine(v=>v.length>0),location:syntheticText.refine(v=>v.length>0),reason:syntheticText.refine(v=>v.length>0)}).parse(input),c=await activeCase(db,user,id,d.kind==='REQUEST'?'request.edit':'consent.prepare'),w=await workspace(db,c,user);if((d.kind==='REQUEST'?w.request_mode:w.consent_mode)!=='Paper')throw new P2Error('PAPER_DOCUMENT_MODE_TEMPLATE_MISMATCH');const panel=Object.fromEntries(Object.keys(paperSchema.shape).map(k=>[k,null]));const r=(await db.query("INSERT INTO p2_paper_review(case_id,round_id,kind,template_version,document_reference,panel,status,location,reason,verifier_id) VALUES($1,$2,$3,$4,$5,$6,'Pending',$7,$8,$9) RETURNING id,status,created_at",[id,c.current_round_id,d.kind,d.kind==='REQUEST'?REQUEST_TEMPLATE:CONSENT_TEMPLATE,d.documentReference,panel,d.location,d.reason,user.id])).rows[0];await event(db,user,id,'P2_PAPER_PREPARED');return r;}
export async function prepareConsent(db:Queryable,user:Staff,id:string,input:unknown){
 const d=z.strictObject({doctorVersionId:uuid,representativeRequired:z.boolean(),reason:syntheticText.refine(v=>v.length>0)}).parse(input),c=await activeCase(db,user,id,'consent.prepare'),w=await workspace(db,c,user);
 if(d.representativeRequired)throw new P2Error('REPRESENTATIVE_REQUIRES_PAPER',422);if(w.consent_mode!=='Electronic')throw new P2Error('CONSENT_PAPER_MODE');
 const doctor=await activeDoctor(db,d.doctorVersionId,c.unit_id);
 const r=await revision(db,user,c,'CONSENT',{identity:{caseId:c.id,ln:c.ln,hn:c.hn,roundId:c.current_round_id,roundNumber:c.round_number},workspaceVersion:w.version,clauses:consentClauses,doctor,requestDraft:w.draft,preparerId:user.id,representativeRequired:false,caption:'authorized synthetic stored signature, not freshly signed',synthetic:true,unapproved:true,unsigned:true},d.reason);await event(db,user,id,'P2_CONSENT_PREPARED');return r;
}
export async function startSigning(db:Queryable,user:Staff,id:string,input:unknown){
 const d=z.strictObject({documentId:uuid,devicePresent:z.literal(true),syntheticPatient:z.literal(true)}).parse(input),c=await activeCase(db,user,id,'consent.prepare'),w=await workspace(db,c,user);if(!user.sessionId)throw new P2Error('STAFF_SESSION_REQUIRED',401);if(w.consent_mode!=='Electronic')throw new P2Error('CONSENT_PAPER_MODE');
 // Lock the immutable document using an advisory lock (app_rw deliberately cannot UPDATE snapshots).
 await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,75432804))',[d.documentId]);
 const doc=(await db.query<{id:string;payload:{doctor:{id:string};workspaceVersion:number}}>("SELECT id,payload FROM p2_document_revision WHERE id=$1 AND case_id=$2 AND round_id=$3 AND kind='CONSENT' AND version=(SELECT max(version) FROM p2_document_revision WHERE case_id=$2 AND round_id=$3 AND kind='CONSENT')",[d.documentId,id,c.current_round_id])).rows[0];if(!doc)throw new P2Error('CONSENT_VERSION_INVALID',409);if(doc.payload.workspaceVersion!==w.version)throw new P2Error('CONSENT_DRAFT_CHANGED_PREPARE_AGAIN',409);
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
export async function readSigning(db:Queryable,raw:string,staffSessionId?:string){const s=await patientSession(db,raw,staffSessionId);const d=(await db.query<{payload:unknown;template_version:string}>('SELECT payload,template_version FROM p2_document_revision WHERE id=$1',[s.document_id])).rows[0];const a=await db.query<{item:number;acknowledged_at:string}>(`SELECT item,${preciseUtc('acknowledged_at')} AS acknowledged_at FROM p2_consent_ack WHERE session_id=$1 ORDER BY item`,[s.id]);return {documentId:s.document_id,expiresAt:s.expires_at,templateVersion:d.template_version,document:d.payload,acknowledgments:a.rows};}
export async function patientAction(db:Queryable,raw:string,input:unknown,csrf:{origin:string|null;expectedOrigin:string;token:string},staffSessionId?:string){
 const s=await patientSession(db,raw,staffSessionId);validateCsrf(csrf.origin,csrf.expectedOrigin,csrf.token,s.csrf_hash);
 const d=z.discriminatedUnion('action',[z.strictObject({action:z.literal('acknowledge'),item:z.number().int().min(1).max(12)}),z.strictObject({action:z.literal('complete'),decision:z.enum(['Granted','Declined']),vector:vectorSchema}),z.strictObject({action:z.literal('cancel')})]).parse(input);
 if(d.action==='acknowledge'){await db.query('INSERT INTO p2_consent_ack(session_id,item) VALUES($1,$2) ON CONFLICT DO NOTHING',[s.id,d.item]);return {acknowledged:d.item};}
 if(d.action==='cancel'){await db.query("UPDATE p2_signing_session SET state='Cancelled',closed_at=now() WHERE id=$1",[s.id]);await event(db,{id:s.preparer_id,roles:[],unitIds:[],permissions:[]},s.case_id,'P2_SIGNING_CANCELLED');return {state:'Cancelled',reauthenticationRequired:true};}
 if(Number((await db.query<{n:number}>('SELECT count(*) n FROM p2_consent_ack WHERE session_id=$1',[s.id])).rows[0].n)!==12)throw new P2Error('TWELVE_ACKNOWLEDGMENTS_REQUIRED',422);
 const signature=deriveSignature(d.vector);await db.query('INSERT INTO p2_consent_signature(session_id,document_id,decision,vector,png,signature_hash) VALUES($1,$2,$3,$4,$5,$6)',[s.id,s.document_id,d.decision,signature.vector,signature.png,signature.hash]);
 await db.query("UPDATE p2_signing_session SET state='Completed',closed_at=now() WHERE id=$1",[s.id]);await event(db,{id:s.preparer_id,roles:[],unitIds:[],permissions:[]},s.case_id,'P2_CONSENT_'+d.decision.toUpperCase());return {state:d.decision,reauthenticationRequired:true};
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
/** Narrow original-preparer recovery: no capability, document, signature or password data. */
export async function signingReturnStatus(db:Queryable,user:Staff){const {session,outcome}=await returnBinding(db,user);return {sessionId:session.id,outcome};}
/** Called only by the narrow same-origin, CSRF-protected staff-return route. */
export async function reauthenticate(db:Queryable,user:Staff,input:unknown){
 const d=z.strictObject({password:z.string().min(1).max(1024),attestation:z.literal(true),sessionId:uuid,outcome:z.enum(['Active','Granted','Declined','Cancelled','Expired','Invalidated'])}).parse(input);
 const {session,outcome}=await returnBinding(db,user);
 if(d.sessionId!==session.id||d.outcome!==outcome)throw new P2Error('SIGNING_RETURN_STATE_CHANGED',409);
 if(session.reauthenticated_at){const final=(await db.query('SELECT id FROM p2_final_consent WHERE session_id=$1',[session.id])).rows[0];return {ok:true,consentFinalized:!!final,...(session.state==='Completed'&&!final?{reasonCode:'CONSENT_INVALIDATED_BEFORE_ATTESTATION'}:{})};}
 if(outcome==='Active')throw new P2Error('CANCEL_OR_COMPLETE_SIGNING_FIRST',409);
 const u=(await db.query<{password_hash:string;failed_count:number;locked_until:Date|null}>('SELECT * FROM app_user WHERE id=$1 AND enabled FOR UPDATE',[user.id])).rows[0];
 if(!u||u.locked_until&&new Date(u.locked_until)>new Date()||!await verifyPassword(u.password_hash,d.password)){
 if(u)await db.query("UPDATE app_user SET failed_count=failed_count+1,locked_until=CASE WHEN failed_count>=4 THEN now()+interval '15 minutes' ELSE locked_until END WHERE id=$1",[user.id]);return {ok:false};}
 if(session.state==='Active')await db.query("UPDATE p2_signing_session SET state='Expired',closed_at=now() WHERE id=$1",[session.id]);
 await db.query('UPDATE p2_signing_session SET reauthenticated_at=now() WHERE id=$1',[session.id]);
 let invalidatedBeforeAttestation=false;
 if(session.state==='Completed'){
 const valid=(await db.query("SELECT d.id FROM p2_signing_session s JOIN p2_document_revision d ON d.id=s.document_id JOIN nipt_case c ON c.id=d.case_id JOIN p2_workspace w ON w.round_id=d.round_id WHERE s.id=$1 AND c.current_round_id=d.round_id AND w.consent_mode='Electronic' AND w.version::text=d.payload->>'workspaceVersion' AND NOT EXISTS(SELECT 1 FROM p2_revocation WHERE case_id=c.id) AND d.version=(SELECT max(version) FROM p2_document_revision WHERE round_id=d.round_id AND kind='CONSENT')",[session.id])).rows[0];
 invalidatedBeforeAttestation=!valid;
 if(valid){
 const full=(await db.query<{document_id:string;created_at:string;closed_at:string;reauthenticated_at:string}>(`SELECT document_id,${preciseUtc('created_at')} AS created_at,${preciseUtc('closed_at')} AS closed_at,${preciseUtc('reauthenticated_at')} AS reauthenticated_at FROM p2_signing_session WHERE id=$1`,[session.id])).rows[0];
 const doc=(await db.query<{payload:unknown;template_version:string;content_hash:string}>('SELECT * FROM p2_document_revision WHERE id=$1',[full.document_id])).rows[0];
 const sig=(await db.query(`SELECT decision,vector,png,signature_hash,${preciseUtc('signed_at')} AS signed_at FROM p2_consent_signature WHERE session_id=$1`,[session.id])).rows[0];
 const acks=(await db.query(`SELECT item,${preciseUtc('acknowledged_at')} AS acknowledged_at FROM p2_consent_ack WHERE session_id=$1 ORDER BY item`,[session.id])).rows;
 const payload={document:doc.payload,templateVersion:doc.template_version,preparedHash:doc.content_hash,signature:sig,acknowledgments:acks,session:{id:session.id,startedAt:full.created_at,closedAt:full.closed_at,preparerId:user.id,attestedAt:full.reauthenticated_at,attestation:true},synthetic:true};
 await db.query(`INSERT INTO p2_final_consent(session_id,document_id,payload,content_hash,hash_algorithm) VALUES($1,$2,$3,encode(sha256(convert_to(p2_canonical_jsonb($3::jsonb),'UTF8')),'hex'),'PG_JSONB_CANONICAL_V1') ON CONFLICT(session_id) DO NOTHING`,[session.id,full.document_id,payload]);
 }
 }
 await db.query('UPDATE app_session SET signing_suspended=false,idle_expires_at=LEAST(now()+interval \'30 minutes\',absolute_expires_at),last_seen_at=now() WHERE id=$1',[user.sessionId]);await db.query('UPDATE app_user SET failed_count=0,locked_until=NULL WHERE id=$1',[user.id]);await event(db,user,session.case_id,'P2_PREPARER_REAUTHENTICATED',{attestation:true,returnOutcome:outcome,consentInvalidated:invalidatedBeforeAttestation});return {ok:true,consentFinalized:session.state==='Completed'&&!invalidatedBeforeAttestation,...(invalidatedBeforeAttestation?{reasonCode:'CONSENT_INVALIDATED_BEFORE_ATTESTATION'}:{})};
}
export async function withdraw(db:Queryable,user:Staff,id:string,input:unknown){const d=z.strictObject({reason:syntheticText.refine(v=>v.length>0)}).parse(input),c=await activeCase(db,user,id,'consent.withdraw.receive');if(c.analysis_started)throw new P2Error('LATER_WITHDRAWAL_REQUIRES_GOVERNANCE',409);const stage=c.state==='Expected'?'W0':'W1';const r=(await db.query<{id:string}>('INSERT INTO p2_revocation(case_id,round_id,stage,reason,actor_id) VALUES($1,$2,$3,$4,$5) RETURNING id',[id,c.current_round_id,stage,d.reason,user.id])).rows[0];await db.query("INSERT INTO p2_disposition(revocation_id,state,reason,actor_id) VALUES($1,'PendingGovernance',$2,$3)",[r.id,d.reason,user.id]);await invalidate(db,id);await event(db,user,id,'P2_CONSENT_REVOKED',{stage,reason:d.reason});return {id:r.id,stage,state:'RevokedHold',disposition:'PendingGovernance'};}
export async function listDoctors(db:Queryable,user:Staff){await assertStaff(db,user);if(!user.roles.some(r=>['ANC_NURSE','ANC_SUPERVISOR','LAB_STAFF','LAB_CERTIFIER','APP_ADMIN','CLINICAL_APPROVER'].includes(r)))throw new P2Error('FORBIDDEN',403);const r=await db.query<{unit_id:string;doctor_key:string;version:number;status:string|null;effective_from:Date;ever_approved:boolean}>('SELECT v.id,v.doctor_key,v.version,v.name,v.unit_id,v.effective_from,v.created_by,v.authorization_evidence AS authorization,EXISTS(SELECT 1 FROM p2_doctor_event a WHERE a.doctor_version_id=v.id AND a.event_type=\'Approved\') ever_approved,(SELECT e.event_type FROM p2_doctor_event e WHERE e.doctor_version_id=v.id ORDER BY e.created_at DESC,e.id DESC LIMIT 1) status FROM p2_doctor_version v ORDER BY doctor_key,version DESC');return r.rows.filter(x=>!user.roles.every(r=>r==='ANC_NURSE'||r==='ANC_SUPERVISOR')||user.unitIds.includes(x.unit_id)).map(x=>({...x,active:x.status==='Approved'&&new Date(x.effective_from)<=new Date()&&!r.rows.some(n=>n.doctor_key===x.doctor_key&&n.version>x.version&&n.ever_approved&&new Date(n.effective_from)<=new Date())}));}
export async function doctorAction(db:Queryable,user:Staff,input:unknown){
 await assertStaff(db,user);
 const d=z.discriminatedUnion('action',[z.strictObject({action:z.literal('propose'),doctorKey:z.string().regex(/^SYNTHETIC-[A-Z0-9-]+$/),name:syntheticText.refine(v=>v.length>0),unitId:uuid,effectiveFrom:z.iso.datetime(),authorization:z.string().startsWith('SYNTHETIC').max(500),vector:vectorSchema}),z.strictObject({action:z.enum(['approve','suspend']),id:uuid,reason:syntheticText.refine(v=>v.length>0)})]).parse(input);
 requirePermission(user,'doctor.manage',{},d.action==='propose'?'propose':'approve');
 if(d.action==='propose'){if(!user.roles.includes('APP_ADMIN')&&!user.unitIds.includes(d.unitId))throw new P2Error('FORBIDDEN',403);await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,75432803))',[d.doctorKey]);const sig=deriveSignature(d.vector);const v=Number((await db.query<{n:number}>('SELECT COALESCE(max(version),0)+1 n FROM p2_doctor_version WHERE doctor_key=$1',[d.doctorKey])).rows[0].n);const r=(await db.query('INSERT INTO p2_doctor_version(doctor_key,version,name,unit_id,effective_from,authorization_evidence,signature,signature_png,signature_hash,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id,version',[d.doctorKey,v,d.name,d.unitId,d.effectiveFrom,d.authorization,sig.vector,sig.png,sig.hash,user.id])).rows[0];await appendAudit(db,{actorId:user.id,action:'P2_DOCTOR_PROPOSED',resourceType:'p2_doctor_version',resourceId:String(r.id),details:{synthetic:true}});return r;}
 const v=(await db.query<{created_by:string}>('SELECT created_by FROM p2_doctor_version WHERE id=$1',[d.id])).rows[0];if(!v||d.action==='approve'&&v.created_by===user.id)throw new P2Error('MAKER_CHECKER_REQUIRED',403);
 await db.query('INSERT INTO p2_doctor_event(doctor_version_id,event_type,actor_id,reason) VALUES($1,$2,$3,$4)',[d.id,d.action==='approve'?'Approved':'Suspended',user.id,d.reason]);await appendAudit(db,{actorId:user.id,action:d.action==='approve'?'P2_DOCTOR_APPROVED':'P2_DOCTOR_SUSPENDED',resourceType:'p2_doctor_version',resourceId:d.id,details:{synthetic:true}});return {id:d.id,status:d.action==='approve'?'Approved':'Suspended'};
}
export async function doctorUnits(db:Queryable,user:Staff){await assertStaff(db,user);if(!user.roles.some(r=>['ANC_NURSE','ANC_SUPERVISOR','LAB_STAFF','LAB_CERTIFIER','APP_ADMIN','CLINICAL_APPROVER'].includes(r)))throw new P2Error('FORBIDDEN',403);const units=(await db.query<{id:string;code:string;name:string}>('SELECT id,code,name FROM unit ORDER BY code')).rows;return units.filter(u=>user.roles.some(r=>['APP_ADMIN','CLINICAL_APPROVER','LAB_STAFF','LAB_CERTIFIER'].includes(r))||user.unitIds.includes(u.id));}
export async function listP2Cases(db:Queryable,user:Staff,search='',offset=0){
 await assertStaff(db,user);if(!Number.isSafeInteger(offset)||offset<0)throw new P2Error('PAGE_INVALID');if(search.length>60)throw new P2Error('SEARCH_INVALID');
 const allUnits=(await db.query<{id:string;code:string;name:string}>('SELECT id,code,name FROM unit ORDER BY code')).rows;
 const readableUnitIds=allUnits.filter(u=>authorize(user,'case.read',{unitId:u.id,origin:'ANC'},'read')).map(u=>u.id);
 // Scope and deduplicate in SQL BEFORE applying the page limit. Multiple scope rows cannot consume the page.
 const rows=(await db.query<CaseScope&{draft:RequestDraft|null;version:number|null;request_mode:string|null;consent_mode:string|null}>("SELECT c.id,l.ln,i.hn,c.registration_origin,c.current_round_id,s.unit_id,r.state,r.analysis_started,r.round_number,w.draft,w.version,w.request_mode,w.consent_mode FROM nipt_case c JOIN case_ln l ON l.id=(SELECT cl.id FROM case_ln cl WHERE cl.case_id=c.id ORDER BY cl.id LIMIT 1) LEFT JOIN p2_case_identity i ON i.case_id=c.id JOIN LATERAL(SELECT us.unit_id FROM case_unit_scope us WHERE us.case_id=c.id AND us.unit_id=ANY($2::uuid[]) ORDER BY us.unit_id LIMIT 1) s ON true JOIN specimen_round r ON r.id=c.current_round_id LEFT JOIN p2_workspace w ON w.round_id=r.id WHERE c.registration_origin IN ('ANC','LAB_DIRECT') AND (l.ln LIKE $1 OR i.hn LIKE $1 OR w.draft->'patient'->>'syntheticName' ILIKE $1) ORDER BY c.created_at DESC,c.id LIMIT 201 OFFSET $3",['%'+search+'%',readableUnitIds,offset])).rows;
 const seen=new Set<string>();const cases=rows.slice(0,200).filter(c=>{if(seen.has(c.id)||!authorize(user,'case.read',{unitId:c.unit_id,origin:c.registration_origin},'read'))return false;seen.add(c.id);return true;}).map(({draft,...c})=>({...c,identityVerified:c.hn!==null,progress:draft?{missing:requestIssues(draft),savedVersion:c.version}:null}));
 const units=allUnits.filter(u=>authorize(user,'case.register.anc',{unitId:u.id,origin:'ANC'})||authorize(user,'case.register.lab',{unitId:u.id,origin:'LAB_DIRECT'}));
 if(cases.length)await recordPhiAccess(db,user.id,cases.map(c=>c.id),'REGISTRY_VIEW');return {cases,units,hasMore:rows.length>200,nextOffset:rows.length>200?offset+200:null};
}
