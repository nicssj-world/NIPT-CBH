import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {Queryable} from '../db/connection';
import {lockLn} from '../db/registration';
import type {FileStore} from '../storage';
import {readActiveSettings} from '../settings/service';
import {SETTINGS} from '../settings/catalog';
import {authorize} from '../security/policy';
import {LabError,need,assertSession,audit,uuid,reasonText,attemptFacts,commonFacts,caseVisible,REDRAW_REASONS,type Staff} from '../lab/core';
import {QuarantineError} from './extract';
import {registerIntake} from './intake';
import {missingRequired,type Parsed} from './parser';
import {resultPredicates,noticePredicates,decideGate,crossFailures,type Cmp,type CrossCheck,type Purpose,type GateDecision,type GatePredicate} from './gates';
import {attemptEvidence} from './evidence';
import {operationalWorkflow} from '../lab/operational';
import {digest} from '../pooling/calculation';

// P5 Result Management service (Plan §11, §5.7–§5.10). Restricted synthetic: every path ends before release. Certification is
// evaluated in the acting transaction and then answered with RELEASE_HOLD (AL-5/OD-05/OD-07); the database refuses any release.
export const P5_JOB_KINDS=['synthetic_result_test_path','synthetic_result_scan','synthetic_result_preview','synthetic_result_parse'] as const;
export type P5JobKind=typeof P5_JOB_KINDS[number];
export type ResultSettings=z.infer<typeof SETTINGS.result_management.schema>;
export async function resultSettings(db:Queryable):Promise<ResultSettings>{const s=await readActiveSettings(db);return SETTINGS.result_management.schema.parse(s.result_management??SETTINGS.result_management.default);}
export const limitsOf=(s:ResultSettings)=>({maxBytes:s.maxUploadMb*1024*1024,acceptZip:s.acceptZip});
const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const rowVersion=z.number().int().min(0);
export const REDRAW_LABELS:Record<typeof REDRAW_REASONS[number],string>={QC1_FAILED:'คุณภาพตัวอย่าง (QC) ไม่ผ่าน',QC_SAMPLE_FAILED:'คุณภาพตัวอย่างไม่ผ่าน',FETAL_FRACTION_LOW:'ปริมาณ DNA ของทารกต่ำ',SPECIMEN_PROBLEM:'ปัญหาสิ่งส่งตรวจ',OTHER:'เหตุผลอื่น (ข้อความรอ OD-11)'};

// ---------- Jobs: Test Path / Scan / Preview run in the worker; the web only queues them ----------
const selectionSchema=z.strictObject({paths:z.array(z.strictObject({path:z.string().min(1).max(500).refine(p=>!/(^|\/)\.\.?(\/|$)|^\/|\\|:/.test(p),'UNSAFE_PATH'),sha256:z.string().regex(/^[a-f0-9]{64}$/)})).min(1).max(50)});
export async function queueResultJob(db:Queryable,user:Staff,kind:P5JobKind,input:unknown={}){
 await assertSession(db,user);need(user,'result.import');
 if(kind==='synthetic_result_parse')throw new LabError('INVALID_REQUEST');
 const payload={...(kind==='synthetic_result_preview'?selectionSchema.parse(input):{}),actorId:user.id};
 const id=(await db.query<{id:string}>('INSERT INTO job_outbox(kind,payload,idempotency_key) VALUES($1,$2,$3) RETURNING id',[kind,JSON.stringify(payload),'p5:'+randomUUID()])).rows[0].id;
 await audit(db,user,'RESULT_JOB_QUEUED','JOB',id,{reasonCode:kind});return id;
}
export async function resultJob(db:Queryable,user:Staff,id:string){
 need(user,'result.import');uuid.parse(id);
 const j=(await db.query<{id:string;kind:string;state:string;payload:{actorId?:string};created_at:Date;result:Record<string,unknown>|null;completed_at:Date|null}>('SELECT o.id,o.kind,o.state,o.payload,o.created_at,r.result,r.completed_at FROM job_outbox o LEFT JOIN integration_job_receipt r ON r.outbox_id=o.id WHERE o.id=$1',[id])).rows[0];
 if(!j||!(P5_JOB_KINDS as readonly string[]).includes(j.kind)||j.payload.actorId!==user.id)throw new LabError('NOT_FOUND',404);
 const intakes=['synthetic_result_preview','synthetic_result_parse'].includes(j.kind)&&j.result?await intakeRows(db,user,id):[];
 return {id:j.id,kind:j.kind,state:j.result?'Completed':j.state,result:j.result,createdAt:j.created_at,completedAt:j.completed_at,intakes};
}

/** Browser file picker (alternative channel, as in NIPTY): bytes are stored immutably and parsed by the worker like folder files. */
export async function registerUploads(db:Queryable,user:Staff,store:FileStore,files:{name:string;bytes:Buffer}[]){
 await assertSession(db,user);need(user,'result.import');
 if(files.length<1||files.length>20)throw new LabError('FILE_COUNT_INVALID');
 const s=await resultSettings(db),limits=limitsOf(s);
 const jobId=(await db.query<{id:string}>("INSERT INTO job_outbox(kind,payload,idempotency_key) VALUES('synthetic_result_parse',$1,$2) RETURNING id",[JSON.stringify({actorId:user.id}),'p5:'+randomUUID()])).rows[0].id;
 const rejected:{name:string;code:string}[]=[];let accepted=0;
 for(const f of files){
  try{if(!f.bytes.length)throw new QuarantineError('EMPTY_FILE');if(f.bytes.length>limits.maxBytes)throw new QuarantineError('FILE_TOO_LARGE');
   await registerIntake(db,store,{source:'UPLOAD',relativePath:null,originalName:f.name,actorId:user.id,jobId},f.bytes);accepted++;}
  catch(e){if(!(e instanceof QuarantineError))throw e;rejected.push({name:f.name.slice(0,120),code:e.message});}
 }
 await audit(db,user,'RESULT_UPLOAD_QUEUED','JOB',jobId,{count:accepted});
 return {jobId,accepted,rejected};
}

// ---------- Preview rows and candidates ----------
type IntakeRow={id:string;source:string;relative_path:string|null;original_name:string;member_name:string|null;parent_id:string|null;sha256:string;byte_size:string;container:string|null;state:string;reject_code:string|null;duplicate_of:string|null;template_kind:string|null;parsed:Parsed|null;created_at:Date};
/** A14 (Owner 2026-10-13): duplicates are SHA-256 only. A same-name file with different bytes is a *name conflict*: it is warned,
 *  acknowledged on import and classified (new report / revision) by the people who link it — never skipped, never auto-revised. */
export async function nameConflicts(db:Queryable,name:string,sha:string,jobId:string|null,intakeId:string){
 const versions=(await db.query<{id:string;state:string;imported_at:Date}>("SELECT v.id,v.state,v.imported_at FROM result_report_version v JOIN result_intake_file i ON i.id=v.intake_file_id WHERE lower(coalesce(i.member_name,i.original_name))=lower($1) AND v.sha256<>$2 ORDER BY v.imported_at",[name,sha])).rows;
 const batch=jobId?Number((await db.query<{n:number}>("SELECT count(*)::int n FROM result_intake_file WHERE job_id=$1 AND id<>$2 AND lower(coalesce(member_name,original_name))=lower($3) AND sha256<>$4 AND container IS DISTINCT FROM 'ZIP_BATCH'",[jobId,intakeId,name,sha])).rows[0].n):0;
 return {versions:versions.map(x=>({id:x.id,state:x.state,importedAt:x.imported_at})),sameBatch:batch};
}
const hasConflict=(c:{versions:unknown[];sameBatch:number})=>c.versions.length>0||c.sameBatch>0;
export async function intakeRows(db:Queryable,user:Staff,jobId:string){
 const rows=(await db.query<IntakeRow>('SELECT id,source,relative_path,original_name,member_name,parent_id,sha256,byte_size,container,state,reject_code,duplicate_of,template_kind,parsed,created_at FROM result_intake_file WHERE job_id=$1 AND actor_id=$2 ORDER BY created_at,original_name,member_name NULLS FIRST',[jobId,user.id])).rows;
 const s=await resultSettings(db);
 return Promise.all(rows.map(async r=>({id:r.id,source:r.source,file:r.relative_path??r.original_name,member:r.member_name,parentId:r.parent_id,sha256:r.sha256,size:Number(r.byte_size),container:r.container,state:r.state,rejectCode:r.reject_code,duplicateOf:r.duplicate_of,
  templateKind:r.template_kind,nameConflicts:r.container==='ZIP_BATCH'?{versions:[],sameBatch:0}:await nameConflicts(db,r.member_name??r.original_name,r.sha256,jobId,r.id),summary:r.parsed?summary(r.parsed):null,candidates:r.parsed&&r.parsed.templateKind!=='UNKNOWN'?(await linkCandidates(db,user,r.parsed,s)).length:0})));
}
export function summary(p:Parsed){
 const v=(f:{value:unknown}|undefined)=>f?.value??null;
 return {labNumber:v(p.identifiers.labNumber),hn:v(p.identifiers.hn),patientName:v(p.identifiers.patientName),collectionDate:v(p.identifiers.collectionDate),reportedDate:v(p.identifiers.reportedDate),
  t21:v(p.results.t21),t18:v(p.results.t18),t13:v(p.results.t13),sca:p.templateKind==='SINGLETON'?[p.results.xo,p.results.xxx,p.results.xxy,p.results.xyy].map(f=>f.value??'อ่านไม่ได้'):null,yChromosome:v(p.results.yChromosome),
  fetalFraction:v(p.results.fetalFraction),qc:v(p.results.qc),needsManualReview:p.needsManualReview,abnormal:p.abnormal,unreadable:missingRequired(p),noticeCategory:p.noticeCategory};
}

type RoundRequest={dob:string|null;edd:string|null;pregnancy:'Singleton'|'Twins'|null;fetalSex:string|null;dates:string[]};
async function roundRequest(db:Queryable,roundId:string):Promise<RoundRequest>{
 const r=(await db.query<{draft:{patient?:{dob?:string|null};pregnancy?:{edd?:string|null;type?:string|null;fetalSex?:string|null}}|null;panel:{pregnancyType?:string;fetalSex?:string}|null;round_date:string|null;dates:string[]}>(
  `SELECT (SELECT d.payload->'draft' FROM p2_document_revision d WHERE d.round_id=$1 AND d.kind='REQUEST' ORDER BY d.version DESC LIMIT 1) draft,
   (SELECT p.panel FROM p2_paper_review p WHERE p.round_id=$1 AND p.kind='REQUEST' AND p.status='Verified' ORDER BY p.created_at DESC LIMIT 1) panel,
   (SELECT collection_date::text FROM specimen_round WHERE id=$1) round_date,
   ARRAY(SELECT y.d FROM (SELECT DISTINCT ON(f.source) f.collection_date::text d FROM p2_collection_fact f WHERE f.round_id=$1 ORDER BY f.source,f.sequence DESC) y) dates`,[roundId])).rows[0];
 const pt=r.draft?.pregnancy?.type??r.panel?.pregnancyType??null;
 return {dob:r.draft?.patient?.dob??null,edd:r.draft?.pregnancy?.edd??null,pregnancy:pt==='Singleton'||pt==='Twins'?pt:null,fetalSex:r.draft?.pregnancy?.fetalSex??r.panel?.fetalSex??null,dates:[...new Set([...r.dates,...(r.round_date?[r.round_date]:[])])]};
}
const cmp=(a:string|null|undefined,b:string|null|undefined):Cmp=>!a||!b?'NOT_AVAILABLE':a===b?'MATCH':'MISMATCH';
const digits=(x:string|null|undefined)=>x?x.replace(/^0+/,''):null;
/** Independent properties for RG-04 / RN-04. The PDF collection date must equal the date of the round the attempt belongs to. */
export function crossCheck(p:Parsed,sys:{hn:string|null;printed_sample_id:string|null;ln_halos:string|null;ln:string},req:RoundRequest,gaTolerance:number):CrossCheck{
 const pdfDate=p.identifiers.collectionDate.value;
 const collectionDate:Cmp=!pdfDate||req.dates.length===0?'NOT_AVAILABLE':req.dates.length>1?'MISMATCH':pdfDate===req.dates[0]?'MATCH':'MISMATCH';
 const pregnancy:Cmp=p.templateKind==='SINGLETON'||p.templateKind==='TWIN'?cmp(p.templateKind==='TWIN'?'Twins':'Singleton',req.pregnancy):'NOT_AVAILABLE';
 let gestationalAge:Cmp='NOT_AVAILABLE';const ga=p.identifiers.gestationalAgeDays.value;
 if(ga!==null&&req.edd&&req.dates.length===1){const expected=280-Math.round((Date.parse(req.edd)-Date.parse(req.dates[0]))/86400000);gestationalAge=Math.abs(expected-ga)<=gaTolerance?'MATCH':'MISMATCH';}
 const lab=p.identifiers.labNumber.value;
 return {hn:cmp(digits(p.identifiers.hn.value),digits(sys.hn)),dob:cmp(p.identifiers.dob.value,req.dob),pregnancy,collectionDate,gestationalAge,
  labNumber:!lab?'NOT_AVAILABLE':[sys.printed_sample_id,sys.ln_halos,sys.ln].includes(lab)?'MATCH':'MISMATCH'};
}

export type Candidate={caseId:string;ln:string;hn:string|null;origin:string;lnHalos:string|null;matchedOn:string[];cross:CrossCheck;
 round:{id:string;number:number;state:string;current:boolean;collectionDate:string|null};attempt:{id:string;number:number;state:string;printedSampleId:string|null;latest:boolean}};
/** Candidates shown one round/attempt at a time. HN, the lab number or the HIS LN only *finds* rows; none of them links. */
export async function linkCandidates(db:Queryable,user:Staff,p:Parsed,s:ResultSettings):Promise<Candidate[]>{
 const hn=digits(p.identifiers.hn.value),lab=p.identifiers.labNumber.value;
 if(!hn&&!lab)return [];
 const rows=(await db.query<{attempt_id:string;attempt_number:number;attempt_state:string;printed_sample_id:string|null;latest:boolean;round_id:string;round_number:number;round_state:string;collection_date:string|null;case_id:string;current_round_id:string;registration_origin:string;ln:string;ln_halos:string|null;hn:string|null;unit_id:string|null}>(
  `SELECT a.id attempt_id,a.attempt_number,a.state attempt_state,a.printed_sample_id,a.attempt_number=(SELECT max(b.attempt_number) FROM analytical_attempt b WHERE b.round_id=a.round_id) latest,
    r.id round_id,r.round_number,r.state round_state,r.collection_date::text,c.id case_id,c.current_round_id,c.registration_origin,l.ln,n.ln_halos,i.hn,
    (SELECT s.unit_id FROM case_unit_scope s WHERE s.case_id=c.id ORDER BY s.unit_id LIMIT 1) unit_id
   FROM analytical_attempt a JOIN specimen_round r ON r.id=a.round_id JOIN nipt_case c ON c.id=a.case_id JOIN case_ln l ON l.id=r.case_ln_id
   LEFT JOIN p2_case_identity i ON i.case_id=c.id LEFT JOIN specimen_lab_number n ON n.round_id=r.id
   WHERE c.registration_origin<>'HISTORICAL' AND (ltrim(i.hn,'0')=$1 OR a.printed_sample_id=$2 OR n.ln_halos=$2 OR l.ln=$2 OR n.ln_halos=substring($2 from 1 for 12))
   ORDER BY c.id,r.round_number DESC,a.attempt_number DESC LIMIT 60`,[hn,lab])).rows.filter(r=>caseVisible(user,r));
 const reqs=new Map<string,RoundRequest>();
 const out:Candidate[]=[];
 for(const r of rows){
  if(!reqs.has(r.round_id))reqs.set(r.round_id,await roundRequest(db,r.round_id));
  const matchedOn=[digits(r.hn)===hn&&hn?'HN':null,lab&&(r.printed_sample_id===lab||r.ln_halos===lab||(r.ln_halos&&lab.startsWith(r.ln_halos)))?'LAB_NUMBER':null,lab&&r.ln===lab?'HIS_LN':null].filter((x):x is string=>!!x);
  out.push({caseId:r.case_id,ln:r.ln,hn:r.hn,origin:r.registration_origin,lnHalos:r.ln_halos,matchedOn,cross:crossCheck(p,r,reqs.get(r.round_id)!,s.gaToleranceDays),
   round:{id:r.round_id,number:r.round_number,state:r.round_state,current:r.current_round_id===r.round_id,collectionDate:r.collection_date},attempt:{id:r.attempt_id,number:r.attempt_number,state:r.attempt_state,printedSampleId:r.printed_sample_id,latest:r.latest}});
 }
 return out;
}

// ---------- Import confirmation ----------
type VersionRow={id:string;intake_file_id:string;sha256:string;kind:'RESULT'|'REDRAW_NOTICE'|'UNKNOWN';template_kind:string;template_version:string;parser_version:string;parsed:Parsed;state:string;case_id:string|null;round_id:string|null;attempt_id:string|null;link_mode:string|null;supersedes_id:string|null;revision:unknown;imported_by:string;imported_at:Date;state_changed_at:Date;row_version:number};
async function event(db:Queryable,versionId:string,from:string|null,to:string,actor:string|null,reason:string|null,details:Record<string,unknown>={}){
 await db.query('INSERT INTO result_version_event(version_id,from_state,to_state,actor_id,reason,details) VALUES($1,$2,$3,$4,$5,$6)',[versionId,from,to,actor,reason,JSON.stringify({...details,synthetic:!await operationalWorkflow(db)})]);
}
/** Single place that changes a version: optimistic row_version, append-only event, DB transition guard. */
async function move(db:Queryable,v:VersionRow,to:string,actor:string|null,reason:string|null,patch:Partial<Pick<VersionRow,'case_id'|'round_id'|'attempt_id'|'link_mode'|'supersedes_id'|'revision'>>={},details:Record<string,unknown>={}):Promise<VersionRow>{
 const keys=Object.keys(patch) as (keyof typeof patch)[];
 const sets=keys.map((k,n)=>`${k}=$${n+4}`).join(',');
 const r=(await db.query<VersionRow>(`UPDATE result_report_version SET state=$2,row_version=row_version+1${sets?','+sets:''} WHERE id=$1 AND row_version=$3 RETURNING *`,[v.id,to,v.row_version,...keys.map(k=>k==='revision'&&patch[k]!==null?JSON.stringify(patch[k]):patch[k])])).rows[0];
 if(!r)throw new LabError('VERSION_CONFLICT',409);
 if(to!==v.state)await event(db,v.id,v.state,to,actor,reason,details);
 return r;
}
export async function confirmImport(db:Queryable,user:Staff,input:unknown){
 await assertSession(db,user);need(user,'result.import');
 const d=z.strictObject({intakeIds:z.array(uuid).min(1).max(100),acknowledgeNameConflicts:z.array(uuid).max(100).optional()}).parse(input);const out:{intakeId:string;outcome:string;versionId?:string}[]=[];
 const ack=new Set(d.acknowledgeNameConflicts??[]),unacknowledged:string[]=[];
 for(const id of [...new Set(d.intakeIds)]){const r=(await db.query<{sha256:string;name:string;job_id:string|null;state:string;container:string|null}>('SELECT sha256,coalesce(member_name,original_name) name,job_id,state,container FROM result_intake_file WHERE id=$1',[id])).rows[0];
  if(r&&r.state==='Parsed'&&r.container!=='ZIP_BATCH'&&!ack.has(id)&&hasConflict(await nameConflicts(db,r.name,r.sha256,r.job_id,id)))unacknowledged.push(id);}
 if(unacknowledged.length)throw new LabError('NAME_CONFLICT_ACK_REQUIRED',409,{intakeIds:unacknowledged});
 for(const id of [...new Set(d.intakeIds)]){
  const r=(await db.query<IntakeRow&{actor_id:string;parser_version:string;fresh:boolean}>("SELECT *,created_at>now()-interval '24 hours' fresh FROM result_intake_file WHERE id=$1 FOR UPDATE",[id])).rows[0];
  if(!r||r.actor_id!==user.id)throw new LabError('NOT_FOUND',404);
  if(r.container==='ZIP_BATCH'||r.state!=='Parsed'){out.push({intakeId:id,outcome:r.state,...(r.duplicate_of?{versionId:r.duplicate_of}:{})});continue;}
  if(!r.fresh){await db.query("UPDATE result_intake_file SET state='Expired',decided_at=now() WHERE id=$1",[id]);out.push({intakeId:id,outcome:'Expired'});continue;}
  const dup=(await db.query<{id:string}>('SELECT id FROM result_report_version WHERE sha256=$1',[r.sha256])).rows[0];
  if(dup){await db.query("UPDATE result_intake_file SET state='Duplicate',duplicate_of=$2,decided_at=now() WHERE id=$1",[id,dup.id]);out.push({intakeId:id,outcome:'Duplicate',versionId:dup.id});continue;}
  const p=r.parsed!,kind=p.templateKind==='REDRAW_NOTICE'?'REDRAW_NOTICE':p.templateKind==='UNKNOWN'?'UNKNOWN':'RESULT';
  await db.query("INSERT INTO file_asset(sha256,byte_size,media_type,storage_key) VALUES($1,$2,$3,$4) ON CONFLICT(sha256) DO NOTHING",[r.sha256,r.byte_size,r.container==='PDF'?'application/pdf':'application/zip',`sha256/${r.sha256.slice(0,2)}/${r.sha256.slice(2,4)}/${r.sha256}`]);
  let v=(await db.query<VersionRow>('INSERT INTO result_report_version(intake_file_id,sha256,kind,template_kind,template_version,parser_version,parsed,imported_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',[id,r.sha256,kind,p.templateKind,p.templateVersion,r.parser_version,JSON.stringify(r.parsed),user.id])).rows[0];
  await event(db,v.id,null,'Imported',user.id,ack.has(id)?'NAME_CONFLICT_ACKNOWLEDGED':null,{source:r.source,nameConflictAcknowledged:ack.has(id)});
  // §5.7: an unsupported template goes Imported → RejectedImport and is kept only as evidence; it can never be linked.
  v=kind==='UNKNOWN'?await move(db,v,'RejectedImport',user.id,'TEMPLATE_UNKNOWN'):await move(db,await move(db,v,'Parsed',user.id,null,{},{parserVersion:p.parserVersion}),'Unlinked',user.id,null);
  await db.query("UPDATE result_intake_file SET state='Imported',decided_at=now() WHERE id=$1",[id]);
  if(r.parent_id)await db.query("UPDATE result_intake_file SET state='Imported',decided_at=now() WHERE id=$1 AND state='Parsed'",[r.parent_id]);
  await audit(db,user,'RESULT_IMPORTED','RESULT_VERSION',v.id,{outcome:v.state});
  out.push({intakeId:id,outcome:v.state,versionId:v.id});
 }
 return out;
}

// ---------- Linkage (manual reviewed, two people) ----------
async function versionOf(db:Queryable,id:string,lock=false){const v=(await db.query<VersionRow>(`SELECT * FROM result_report_version WHERE id=$1${lock?' FOR UPDATE':''}`,[uuid.parse(id)])).rows[0];if(!v)throw new LabError('NOT_FOUND',404);return v;}
/** Lock order of Plan §3.6 / §11.5, shared with P4: LN → Case → Specimen round → Attempt → Report version(s). */
async function lockChain(db:Queryable,roundId:string,attemptId:string|null,versionIds:string[]){
 const r=(await db.query<{ln:string;case_id:string}>('SELECT l.ln,r.case_id FROM specimen_round r JOIN case_ln l ON l.id=r.case_ln_id WHERE r.id=$1',[roundId])).rows[0];if(!r)throw new LabError('NOT_FOUND',404);
 await lockLn(db,r.ln);await db.query('SELECT id FROM nipt_case WHERE id=$1 FOR UPDATE',[r.case_id]);await db.query('SELECT id FROM specimen_round WHERE id=$1 FOR UPDATE',[roundId]);
 if(attemptId)await db.query('SELECT id FROM analytical_attempt WHERE id=$1 FOR UPDATE',[attemptId]);
 for(const id of [...versionIds].sort())await db.query('SELECT id FROM result_report_version WHERE id=$1 FOR UPDATE',[id]);
}
const openProposal=async(db:Queryable,versionId:string)=>(await db.query<{id:string;actor_id:string;case_id:string;round_id:string;attempt_id:string|null;revision:unknown;name_review:string|null;reason:string;cross_check:CrossCheck;created_at:Date}>(
 "SELECT * FROM result_link_event e WHERE e.version_id=$1 AND e.event='PROPOSED' AND NOT EXISTS(SELECT 1 FROM result_link_event x WHERE x.version_id=e.version_id AND x.event IN ('APPROVED','REJECTED','UNLINKED') AND x.sequence>e.sequence) ORDER BY e.sequence DESC LIMIT 1",[versionId])).rows[0]??null;
async function targetOf(db:Queryable,user:Staff,v:VersionRow,roundId:string,attemptId:string|null){
 const t=(await db.query<{round_id:string;case_id:string;attempt_round:string|null;unit_id:string|null;registration_origin:string;hn:string|null;printed_sample_id:string|null;ln_halos:string|null;ln:string}>(
  `SELECT r.id round_id,r.case_id,(SELECT a.round_id FROM analytical_attempt a WHERE a.id=$2) attempt_round,(SELECT s.unit_id FROM case_unit_scope s WHERE s.case_id=r.case_id ORDER BY s.unit_id LIMIT 1) unit_id,c.registration_origin,i.hn,
   (SELECT a.printed_sample_id FROM analytical_attempt a WHERE a.id=$2) printed_sample_id,n.ln_halos,l.ln
   FROM specimen_round r JOIN nipt_case c ON c.id=r.case_id JOIN case_ln l ON l.id=r.case_ln_id LEFT JOIN p2_case_identity i ON i.case_id=c.id LEFT JOIN specimen_lab_number n ON n.round_id=r.id WHERE r.id=$1`,[roundId,attemptId])).rows[0];
 if(!t||!caseVisible(user,t))throw new LabError('NOT_FOUND',404);
 if(t.registration_origin==='HISTORICAL')throw new LabError('HISTORICAL_LINK_PROHIBITED',409);
 if(v.kind==='RESULT'&&!attemptId)throw new LabError('ATTEMPT_REQUIRED_FOR_RESULT',422);
 if(attemptId&&t.attempt_round!==roundId)throw new LabError('ATTEMPT_NOT_IN_ROUND',422);
 return t;
}
const openInSeries=async(db:Queryable,v:VersionRow,roundId:string)=>(await db.query<{id:string}>("SELECT id FROM result_report_version WHERE round_id=$1 AND kind=$2 AND id<>$3 AND state IN ('LinkConflict','Linked','ValidationBlocked','PendingCertification')",[roundId,v.kind,v.id])).rows[0]??null;
async function versionNameConflicts(db:Queryable,v:VersionRow){const i=(await db.query<{name:string}>('SELECT coalesce(member_name,original_name) name FROM result_intake_file WHERE id=$1',[v.intake_file_id])).rows[0];return (await nameConflicts(db,i.name,v.sha256,null,v.intake_file_id)).versions;}
const revisionSchema=z.strictObject({receivedDate:date,requestedBy:z.string().trim().min(2).max(120).refine(x=>!/\d{13}/.test(x),'REASON_TEXT_INVALID'),reason:reasonText});
export async function proposeLink(db:Queryable,user:Staff,input:unknown){
 await assertSession(db,user);
 const d=z.strictObject({versionId:uuid,roundId:uuid,attemptId:uuid.nullable(),reason:reasonText,expectedRowVersion:rowVersion,revision:revisionSchema.nullable().optional(),nameReview:z.enum(['NEW_REPORT','REVISION']).optional()}).parse(input);
 need(user,'result.link.manual','propose');
 const v=await versionOf(db,d.versionId,true);if(v.row_version!==d.expectedRowVersion)throw new LabError('VERSION_CONFLICT',409);
 if(v.state!=='Unlinked')throw new LabError('LINK_REQUIRES_UNLINKED',409);
 const t=await targetOf(db,user,v,d.roundId,d.attemptId);
 const open=await openInSeries(db,v,d.roundId);
 const conflict=await versionNameConflicts(db,v);
 if(conflict.length&&!d.nameReview)throw new LabError('NAME_REVIEW_REQUIRED',409,{versionIds:conflict.map(c=>c.id)});
 if(d.nameReview==='REVISION'&&!d.revision)throw new LabError('REVISION_DETAILS_REQUIRED',409,{openVersionId:open?.id??null});
 if(d.nameReview==='NEW_REPORT'&&d.revision)throw new LabError('NAME_REVIEW_MISMATCH',422);
 if(open&&!d.revision)throw new LabError('REVISION_DETAILS_REQUIRED',409,{openVersionId:open.id});
 if(!open&&d.revision)throw new LabError('NO_VERSION_TO_REVISE',409);
 const cross=crossCheck(v.parsed,t,await roundRequest(db,d.roundId),(await resultSettings(db)).gaToleranceDays);
 await db.query("INSERT INTO result_link_event(version_id,event,case_id,round_id,attempt_id,reason,cross_check,revision,name_review,actor_id) VALUES($1,'PROPOSED',$2,$3,$4,$5,$6,$7,$8,$9)",[v.id,t.case_id,d.roundId,d.attemptId,d.reason,JSON.stringify(cross),d.revision?JSON.stringify(d.revision):null,conflict.length?d.nameReview:null,user.id]);
 await audit(db,user,'RESULT_LINK_PROPOSED','RESULT_VERSION',v.id,{outcome:'PROPOSED'});
 return {cross};
}
export async function decideLink(db:Queryable,user:Staff,input:unknown){
 await assertSession(db,user);
 const d=z.strictObject({versionId:uuid,decision:z.enum(['APPROVE','REJECT']),reason:reasonText,expectedRowVersion:rowVersion}).parse(input);
 const pre=await versionOf(db,d.versionId);const p=await openProposal(db,pre.id);if(!p)throw new LabError('LINK_PROPOSAL_REQUIRED',409);
 // OD-04 point 4 / D-18: manual identity linkage keeps two people even though review and certification may be one person.
 if(!authorize(user,'result.link.manual',{actorId:p.actor_id},'approve'))throw new LabError(p.actor_id===user.id?'SECOND_PERSON_REQUIRED':'FORBIDDEN',403);
 if(d.decision==='REJECT'){await versionOf(db,pre.id,true);await db.query("INSERT INTO result_link_event(version_id,event,reason,actor_id) VALUES($1,'REJECTED',$2,$3)",[pre.id,d.reason,user.id]);await audit(db,user,'RESULT_LINK_REJECTED','RESULT_VERSION',pre.id,{outcome:'REJECTED'});return {outcome:'REJECTED'};}
 const open=await openInSeries(db,pre,p.round_id);
 await lockChain(db,p.round_id,p.attempt_id,[pre.id,...(open?[open.id]:[])]);
 let v=await versionOf(db,pre.id,true);if(v.row_version!==d.expectedRowVersion)throw new LabError('VERSION_CONFLICT',409);if(v.state!=='Unlinked')throw new LabError('LINK_REQUIRES_UNLINKED',409);
 if(!!open!==!!p.revision)throw new LabError('SERIES_CHANGED_SINCE_PROPOSAL',409);
 const t=await targetOf(db,user,v,p.round_id,p.attempt_id);
 const cross=crossCheck(v.parsed,t,await roundRequest(db,p.round_id),(await resultSettings(db)).gaToleranceDays);
 const bad=crossFailures(cross,v.kind==='REDRAW_NOTICE'?'REDRAW_NOTICE':'RESULT');const outcome=bad.length?'LinkConflict':'Linked';
 await db.query("INSERT INTO result_link_event(version_id,event,case_id,round_id,attempt_id,outcome,reason,cross_check,revision,name_review,actor_id) VALUES($1,'APPROVED',$2,$3,$4,$5,$6,$7,$8,$9,$10)",[v.id,p.case_id,p.round_id,p.attempt_id,outcome,d.reason,JSON.stringify(cross),p.revision?JSON.stringify(p.revision):null,p.name_review,user.id]);
 if(open){const o=await versionOf(db,open.id,true);await move(db,o,'Superseded',user.id,'REVISION_LINKED',{},{supersededBy:v.id});}
 v=await move(db,v,outcome,user.id,bad.length?`CROSS_CHECK_${bad.join('_').toUpperCase()}`:null,{case_id:p.case_id,round_id:p.round_id,attempt_id:p.attempt_id,link_mode:'MANUAL_REVIEWED',...(open?{supersedes_id:open.id,revision:p.revision}:{})});
 await audit(db,user,'RESULT_LINK_APPROVED','RESULT_VERSION',v.id,{outcome});
 if(outcome==='Linked')v=await validate(db,user,v);
 return {outcome:v.state,cross};
}
export async function unlinkVersion(db:Queryable,user:Staff,input:unknown){
 await assertSession(db,user);const d=z.strictObject({versionId:uuid,reason:reasonText,expectedRowVersion:rowVersion}).parse(input);
 need(user,'result.link.manual','approve');
 const pre=await versionOf(db,d.versionId);if(!pre.round_id||!['LinkConflict','Linked','ValidationBlocked','PendingCertification'].includes(pre.state))throw new LabError('UNLINK_NOT_ALLOWED',409);
 if(pre.supersedes_id)throw new LabError('UNLINK_REVISION_PROHIBITED',409);
 await lockChain(db,pre.round_id,pre.attempt_id,[pre.id]);const v=await versionOf(db,pre.id,true);if(v.row_version!==d.expectedRowVersion)throw new LabError('VERSION_CONFLICT',409);
 await db.query("INSERT INTO result_link_event(version_id,event,case_id,round_id,attempt_id,reason,actor_id) VALUES($1,'UNLINKED',$2,$3,$4,$5,$6)",[v.id,v.case_id,v.round_id,v.attempt_id,d.reason,user.id]);
 await move(db,v,'Unlinked',user.id,'UNLINKED',{case_id:null,round_id:null,attempt_id:null,link_mode:null});
 await audit(db,user,'RESULT_UNLINKED','RESULT_VERSION',v.id,{outcome:'Unlinked'});return {outcome:'Unlinked'};
}

// ---------- Gates ----------
async function gateFor(db:Queryable,v:VersionRow,purpose:Purpose,certifierId?:string):Promise<GateDecision|null>{
 if(!v.round_id||v.kind==='UNKNOWN')return null;
 const s=await resultSettings(db),operational=await operationalWorkflow(db),qc5=operational?(await db.query<{id:string}>('SELECT id FROM result_qc5_review WHERE version_id=$1 AND report_sha256=$2',[v.id,v.sha256])).rows[0]:null,operationalReviewed=!!qc5;
 const templateApproved=operational?operationalReviewed:s.picVersion!=='unvalidated'&&!v.template_version.includes('UNAPPROVED');
 const x=(await db.query<{open_proposal:boolean;latest:boolean;active_release:boolean;reviewed:boolean;redraw_at:Date|null;certifier:boolean;unit_id:string|null}>(
  `SELECT EXISTS(SELECT 1 FROM result_link_event e WHERE e.version_id=$1 AND e.event='PROPOSED' AND NOT EXISTS(SELECT 1 FROM result_link_event y WHERE y.version_id=e.version_id AND y.event IN ('APPROVED','REJECTED','UNLINKED') AND y.sequence>e.sequence)) open_proposal,
   NOT EXISTS(SELECT 1 FROM result_report_version o WHERE o.round_id=$2 AND o.kind=$3 AND o.id<>$1 AND o.state IN ('LinkConflict','Linked','ValidationBlocked','PendingCertification','CertifiedReleased') AND o.imported_at>$4) latest,
   EXISTS(SELECT 1 FROM result_release r WHERE r.round_id=$2 AND r.kind=$3 AND r.state='Active' AND r.version_id<>$1) active_release,
   EXISTS(SELECT 1 FROM result_review w WHERE w.version_id=$1 AND w.created_at>=(SELECT max(e.created_at) FROM result_link_event e WHERE e.version_id=$1 AND e.event='APPROVED')) reviewed,
   (SELECT min(d.requested_at) FROM redraw_request d WHERE d.source_round_id=$2 AND d.state IN ('Requested','Completed')) redraw_at,
   EXISTS(SELECT 1 FROM role_assignment a WHERE a.user_id=$5 AND a.role='LAB_CERTIFIER' AND a.approved_by IS NOT NULL AND a.effective_from<=now() AND (a.expires_at IS NULL OR a.expires_at>now())) certifier,
   (SELECT s.unit_id FROM case_unit_scope s WHERE s.case_id=$6 ORDER BY s.unit_id LIMIT 1) unit_id`,
  [v.id,v.round_id,v.kind,v.imported_at,certifierId??null,v.case_id])).rows[0];
 const t=(await db.query<{hn:string|null;printed_sample_id:string|null;ln_halos:string|null;ln:string}>('SELECT i.hn,(SELECT a.printed_sample_id FROM analytical_attempt a WHERE a.id=$2) printed_sample_id,n.ln_halos,l.ln FROM specimen_round r JOIN case_ln l ON l.id=r.case_ln_id LEFT JOIN p2_case_identity i ON i.case_id=r.case_id LEFT JOIN specimen_lab_number n ON n.round_id=r.id WHERE r.id=$1',[v.round_id,v.attempt_id])).rows[0];
 const req=await roundRequest(db,v.round_id),cross=crossCheck(v.parsed,t,req,s.gaToleranceDays);
 const issues=(await db.query<{n:number;revoked:boolean}>("SELECT (SELECT count(*) FROM his_intake_issue i WHERE i.case_id=$1 AND i.state IN ('Open','Proposed'))::int n,EXISTS(SELECT 1 FROM p2_revocation r WHERE r.case_id=$1) revoked",[v.case_id])).rows[0];
 const reviewed=x.reviewed&&!x.open_proposal;
 if(v.kind==='REDRAW_NOTICE')return decideGate(noticePredicates({templateApproved,linked:!!v.link_mode&&['Linked','ValidationBlocked','PendingCertification','CertifiedReleased'].includes(v.state),openProposal:x.open_proposal,cross,redrawForRound:x.redraw_at!==null,redrawRequestedAt:x.redraw_at,importedAt:v.imported_at,
  openIdentityIssues:issues.n,consentRevoked:issues.revoked,versionState:v.state,latestInSeries:x.latest,reviewedCurrent:reviewed}),'RN');
 const a=(await attemptFacts(db,'a.id=$1',[v.attempt_id]))[0];if(!a)throw new LabError('NOT_FOUND',404);
 const cf=commonFacts(a);
 const y=(await db.query<{open_repeat:boolean;qc1_accepted:boolean;non_measured:boolean;batch_cancelled:boolean}>(
  `SELECT EXISTS(SELECT 1 FROM repeat_work_order o WHERE o.round_id=$2 AND o.state IN ('RepeatRequested','RepeatPendingBatch','RepeatInProgress')) open_repeat,
   COALESCE((SELECT q.decision='Accepted' FROM attempt_stage_qc q WHERE q.attempt_id=$1 AND q.stage='QC1' ORDER BY q.decided_at DESC LIMIT 1),false) qc1_accepted,
   EXISTS(SELECT 1 FROM lab_slot_assignment s JOIN lab_slot_disposition d ON d.batch_id=s.batch_id AND d.slot_number=s.slot_number AND d.stage='QC1' WHERE s.attempt_id=$1 AND s.removed_at IS NULL) non_measured,
   EXISTS(SELECT 1 FROM lab_slot_assignment s WHERE s.attempt_id=$1 AND s.removed_reason='BATCH_CANCELLED') batch_cancelled`,[v.attempt_id,v.round_id])).rows[0];
 const latestAttempt=(await db.query<{n:number}>('SELECT max(attempt_number)::int n FROM analytical_attempt WHERE round_id=$1',[v.round_id])).rows[0].n===a.attempt_number;
 const evidence=await attemptEvidence(db,a.attempt_id);
 return decideGate(resultPredicates({templateKind:v.template_kind as 'SINGLETON'|'TWIN',templateApproved,missing:missingRequired(v.parsed),pdfQc:v.parsed.results.qc.value,
  linked:!!v.link_mode&&['Linked','ValidationBlocked','PendingCertification','CertifiedReleased'].includes(v.state),linkMode:v.link_mode as 'MANUAL_REVIEWED'|null,openProposal:x.open_proposal,cross,
  attemptState:a.attempt_state,attemptIsLatest:latestAttempt,hold:a.hold,qc1Accepted:y.qc1_accepted,nonMeasuredQc1:y.non_measured,batchCancelled:y.batch_cancelled||a.attempt_state==='BatchCancelled',activeSlot:a.slot_batch_id!==null,
  upstreamCurrent:evidence.current,upstreamReason:evidence.reason,analysisAccepted:evidence.analysisAccepted,finalQcAccepted:evidence.finalQcAccepted,
  isCurrentRound:cf.isCurrentRound,roundState:cf.roundState,roundNumber:cf.roundNumber,openRepeat:y.open_repeat,openIdentityIssues:cf.openIdentityIssues,clinicalState:operational?((await db.query<{ready:boolean}>('SELECT p2_clinical_ready($1) ready',[v.round_id])).rows[0]?.ready?'Pass':'PendingClinicalReview'):cf.clinicalState,consentRevoked:cf.consentRevoked,consent:cf.consentRoundEvidence,
  pregnancy:req.pregnancy,sexPreference:req.fetalSex,sexShown:v.parsed.results.fetalSex.value!==null,versionState:v.state,latestInSeries:x.latest,activeReleaseInSeries:x.active_release,reviewedCurrent:reviewed,certifierRoleActive:x.certifier,operationalReviewed},purpose),'RG');
}
async function recordGate(db:Queryable,v:VersionRow,g:GateDecision,purpose:Purpose,outcome:'BLOCKED'|'PENDING_CERTIFICATION'|'RELEASE_HOLD'|'CERTIFIED_RELEASED',actor:string|null,key:string|null){
 await db.query('INSERT INTO result_gate_evaluation(version_id,gate,purpose,rule_version,predicates,eligible,outcome,actor_id,idempotency_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[v.id,g.gate,purpose,g.ruleVersion,JSON.stringify(g.predicates),g.eligible,outcome,actor,key]);
}
/** Validation (§5.7): Linked → PendingCertification only when every RG/RN predicate except the certifier's own passes. */
async function validate(db:Queryable,user:Staff|null,v:VersionRow){
 const g=(await gateFor(db,v,'VALIDATION'))!;const target=g.eligible?'PendingCertification':'ValidationBlocked';
 await recordGate(db,v,g,'VALIDATION',g.eligible?'PENDING_CERTIFICATION':'BLOCKED',user?.id??null,null);
 return v.state===target?v:move(db,v,target,user?.id??null,g.eligible?null:g.failed[0]??g.pending[0]??null,{},{failed:g.failed.length,pending:g.pending.length});
}
export async function revalidate(db:Queryable,user:Staff,input:unknown){
 await assertSession(db,user);need(user,'result.review');const d=z.strictObject({versionId:uuid,expectedRowVersion:rowVersion}).parse(input);
 const pre=await versionOf(db,d.versionId);if(!pre.round_id||!['Linked','ValidationBlocked','PendingCertification'].includes(pre.state))throw new LabError('VALIDATION_REQUIRES_LINKED',409);
 await lockChain(db,pre.round_id,pre.attempt_id,[pre.id]);const v=await versionOf(db,pre.id,true);if(v.row_version!==d.expectedRowVersion)throw new LabError('VERSION_CONFLICT',409);
 const after=await validate(db,user,v);await audit(db,user,'RESULT_REVALIDATED','RESULT_VERSION',v.id,{outcome:after.state});return {outcome:after.state};
}
export async function recordReview(db:Queryable,user:Staff,input:unknown){
 await assertSession(db,user);
 const d=z.strictObject({versionId:uuid,valuesMatchPdf:z.literal(true),abnormalAcknowledged:z.boolean(),note:z.string().trim().max(500).refine(x=>!/\d{13}/.test(x),'REASON_TEXT_INVALID').optional(),expectedRowVersion:rowVersion}).parse(input);
 need(user,'result.review');
 const pre=await versionOf(db,d.versionId);if(!pre.round_id||!['Linked','ValidationBlocked','PendingCertification'].includes(pre.state))throw new LabError('REVIEW_REQUIRES_LINKED',409);
 if(pre.parsed.abnormal&&!d.abnormalAcknowledged)throw new LabError('ABNORMAL_ACK_REQUIRED',422);
 await lockChain(db,pre.round_id,pre.attempt_id,[pre.id]);const v=await versionOf(db,pre.id,true);if(v.row_version!==d.expectedRowVersion)throw new LabError('VERSION_CONFLICT',409);
 await db.query('INSERT INTO result_review(version_id,reviewer_id,values_match_pdf,abnormal_acknowledged,note,row_version) VALUES($1,$2,true,$3,$4,$5)',[v.id,user.id,d.abnormalAcknowledged,d.note||null,v.row_version]);
 const after=await validate(db,user,v);await audit(db,user,'RESULT_REVIEWED','RESULT_VERSION',v.id,{outcome:after.state});return {outcome:after.state};
}

/** Authorized QC5 review binds the exact immutable PDF to current accepted laboratory evidence. */
export async function recordQc5(db:Queryable,user:Staff,input:unknown){
 await assertSession(db,user);need(user,'qc.accept');need(user,'result.review');
 if(!await operationalWorkflow(db))throw new LabError('OWNER_DECISIONS_HOLD',423);
 const d=z.strictObject({versionId:uuid,expectedRowVersion:rowVersion,criteriaReference:reasonText,templateReviewed:z.literal(true),disclosureReviewed:z.literal(true),abnormalAcknowledged:z.boolean(),reason:reasonText}).parse(input);
 const pre=await versionOf(db,d.versionId);if(!pre.round_id||!pre.attempt_id||pre.kind!=='RESULT')throw new LabError('QC5_LINKED_RESULT_REQUIRED',409);
 await lockChain(db,pre.round_id,pre.attempt_id,[pre.id]);let v=await versionOf(db,pre.id,true);
 if(v.row_version!==d.expectedRowVersion)throw new LabError('VERSION_CONFLICT',409);
 if(!['Linked','ValidationBlocked','PendingCertification'].includes(v.state))throw new LabError('QC5_LINKED_RESULT_REQUIRED',409);
 if(v.parsed.abnormal&&!d.abnormalAcknowledged)throw new LabError('ABNORMAL_ACK_REQUIRED',422);
 const upstream=await attemptEvidence(db,v.attempt_id!);
 if(!upstream.current||!upstream.analysisAccepted||!upstream.poolId||!upstream.dnbId||!upstream.sequencingId)throw new LabError('QC5_ACCEPTED_UPSTREAM_REQUIRED',409);
 const reviewed=(await db.query('SELECT id FROM result_review WHERE version_id=$1 ORDER BY created_at DESC LIMIT 1',[v.id])).rows[0];if(!reviewed)throw new LabError('REVIEW_NOT_RECORDED',409);
 const sourceHash=digest({report:v.sha256,attemptId:v.attempt_id,poolId:upstream.poolId,dnbId:upstream.dnbId,sequencingId:upstream.sequencingId,reviewId:reviewed.id});
 const qc5=(await db.query<{id:string}>(`INSERT INTO result_qc5_review(version_id,attempt_id,pool_id,dnb_id,sequencing_id,report_sha256,source_sha256,review_id,criteria_reference,reason,reviewer_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,[v.id,v.attempt_id,upstream.poolId,upstream.dnbId,upstream.sequencingId,v.sha256,sourceHash,reviewed.id,d.criteriaReference,d.reason,user.id])).rows[0];
 const a=(await db.query<{state:string}>('SELECT state FROM analytical_attempt WHERE id=$1',[v.attempt_id])).rows[0];
 if(a.state==='InProgress')await db.query("UPDATE analytical_attempt SET state='AnalysisComplete' WHERE id=$1",[v.attempt_id]);
 if(['InProgress','AnalysisComplete'].includes(a.state))await db.query("UPDATE analytical_attempt SET state='FinalQcAccepted' WHERE id=$1",[v.attempt_id]);
 const gate=(await gateFor(db,v,'VALIDATION'))!;
 if(!gate.eligible)throw new LabError('QC5_GATE_FAILED',409,{failed:gate.failed,pending:gate.pending});
 v=await validate(db,user,v);
 await audit(db,user,'RESULT_QC5_ACCEPTED','result_qc5_review',qc5.id,{outcome:'Accepted',ruleVersion:'AUTHORIZED_QC5_REVIEW_v1'});
 return {id:qc5.id,outcome:v.state};
}

/** "รับรองและส่งผล" (§11.5): one transaction, lock order, RG/RN re-evaluated now. Eligible or not, nothing is released:
 *  AL-5, OD-05 and OD-07 are open, `result.certify`/`notice.release` are denied and p5_release_authorized() is false. */
export async function certifyAttempt(db:Queryable,user:Staff,input:unknown){
 await assertSession(db,user);
 const d=z.strictObject({versionId:uuid,idempotencyKey:z.string().regex(/^[A-Za-z0-9_-]{16,80}$/),abnormalAcknowledged:z.boolean(),expectedRowVersion:rowVersion,confirmed:z.boolean().optional()}).parse(input);
 need(user,'result.release.check');
 const operational=await operationalWorkflow(db);if(operational){need(user,'result.certify');if(d.confirmed!==true)throw new LabError('CERTIFICATION_CONFIRMATION_REQUIRED',422);}
 await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,75432850))',[d.idempotencyKey]);
 const prior=(await db.query<{version_id:string;gate:'RG'|'RN';predicates:GatePredicate[]}>('SELECT version_id,gate,predicates FROM result_gate_evaluation WHERE idempotency_key=$1',[d.idempotencyKey])).rows[0];
 if(prior){if(prior.version_id!==d.versionId)throw new LabError('IDEMPOTENCY_KEY_REUSED',409);const g=decideGate(prior.predicates,prior.gate);const release=operational?(await db.query<{id:string}>('SELECT id FROM result_release WHERE version_id=$1',[prior.version_id])).rows[0]:null;return {outcome:release?'CertifiedReleased':g.eligible?'RELEASE_HOLD':'BLOCKED',releaseId:release?.id,replayed:true,predicates:g.predicates,failed:g.failed,pending:g.pending,waitsForP4b:g.waitsForP4b};}
 const pre=await versionOf(db,d.versionId);if(!pre.round_id)throw new LabError('VALIDATION_REQUIRES_LINKED',409);
 await lockChain(db,pre.round_id,pre.attempt_id,[pre.id]);let v=await versionOf(db,pre.id,true);
 if(v.row_version!==d.expectedRowVersion)throw new LabError('VERSION_CONFLICT',409);
 if(v.parsed.abnormal&&!d.abnormalAcknowledged)throw new LabError('ABNORMAL_ACK_REQUIRED',422);
 const g=(await gateFor(db,v,'CERTIFY_ATTEMPT',user.id))!;
 const outcome=g.eligible?(operational?'CERTIFIED_RELEASED':'RELEASE_HOLD'):'BLOCKED';
 await recordGate(db,v,g,'CERTIFY_ATTEMPT',outcome,user.id,d.idempotencyKey);
 if(!g.eligible&&v.state==='PendingCertification')v=await move(db,v,'ValidationBlocked',user.id,g.failed[0]??g.pending[0]??null);
 let releaseId:string|undefined;
 if(outcome==='CERTIFIED_RELEASED'){
  if(v.kind!=='RESULT'||!v.attempt_id)throw new LabError('RESULT_RELEASE_REQUIRED',409);
  v=await move(db,v,'CertifiedReleased',user.id,'AUTHORIZED_SESSION_CERTIFICATION');
  const release=(await db.query<{id:string}>("INSERT INTO result_release(version_id,case_id,round_id,kind,channel,certified_by,synthetic) VALUES($1,$2,$3,$4,'NIPT_ANC_VIEW',$5,false) RETURNING id",[v.id,v.case_id,v.round_id,v.kind,user.id])).rows[0];releaseId=release.id;
  await db.query("INSERT INTO result_release_completed(release_id,version_id,actor_id) VALUES($1,$2,$3)",[release.id,v.id,user.id]);
  await db.query("INSERT INTO job_outbox(kind,payload,idempotency_key) VALUES('result_release_completed',$1,$2)",[JSON.stringify({releaseId:release.id}),'release:'+release.id]);
 }
 await audit(db,user,'RESULT_CERTIFY_ATTEMPT','RESULT_VERSION',v.id,{outcome});
 return {outcome:outcome==='CERTIFIED_RELEASED'?'CertifiedReleased':outcome,releaseId,replayed:false,predicates:g.predicates,failed:g.failed,pending:g.pending,waitsForP4b:g.waitsForP4b};
}
/** Void. Before release it withdraws an import that will never be linked; after release it needs a release, which AL-5 holds. */
export async function voidVersion(db:Queryable,user:Staff,input:unknown){
 await assertSession(db,user);const d=z.strictObject({versionId:uuid,reason:reasonText,expectedRowVersion:rowVersion}).parse(input);
 need(user,'result.revise');const v=await versionOf(db,d.versionId,true);if(v.row_version!==d.expectedRowVersion)throw new LabError('VERSION_CONFLICT',409);
 if(v.state==='CertifiedReleased')throw new LabError('RELEASE_HOLD_AL5',423);
 if(v.state!=='Unlinked')throw new LabError('VOID_REQUIRES_UNLINKED',409);
 const after=await move(db,v,'Voided',user.id,d.reason);await audit(db,user,'RESULT_IMPORT_VOIDED','RESULT_VERSION',v.id,{outcome:after.state});return {outcome:after.state};
}

// ---------- Reads ----------
export const OPEN_BUCKETS={unlinked:['Unlinked'],conflict:['LinkConflict'],blocked:['ValidationBlocked'],pending:['PendingCertification'],closed:['RejectedImport','Superseded','Voided','CertifiedReleased']} as const;
export async function resultQueue(db:Queryable,user:Staff,input:unknown={}){
 const {queryResults}=await import('./query');
 const result=await queryResults(db,user,input);
 const latest=(await db.query<{folder:string;at:Date}>("SELECT regexp_replace(relative_path,'/?[^/]+$','') folder,max(i.decided_at) at FROM result_intake_file i WHERE i.source='FOLDER' AND i.state='Imported' AND i.relative_path IS NOT NULL GROUP BY 1 ORDER BY 1 DESC LIMIT 1")).rows[0]??null;
 return {...result,latestFolder:latest,releaseHold:true};
}
export async function versionDetail(db:Queryable,user:Staff,id:string){
 need(user,'result.review','read');const v=await versionOf(db,id);
 const intake=(await db.query<{source:string;relative_path:string|null;original_name:string;member_name:string|null;byte_size:string;container:string;actor_id:string;created_at:Date}>('SELECT source,relative_path,original_name,member_name,byte_size,container,actor_id,created_at FROM result_intake_file WHERE id=$1',[v.intake_file_id])).rows[0];
 const [events,links,gates,reviews]=await Promise.all([
  db.query("SELECT e.from_state,e.to_state,e.reason,e.created_at,u.display_name actor FROM result_version_event e LEFT JOIN app_user u ON u.id=e.actor_id WHERE e.version_id=$1 ORDER BY e.sequence",[v.id]),
  db.query("SELECT e.event,e.round_id,e.attempt_id,e.outcome,e.reason,e.cross_check,e.revision,e.created_at,e.actor_id,u.display_name actor FROM result_link_event e JOIN app_user u ON u.id=e.actor_id WHERE e.version_id=$1 ORDER BY e.sequence",[v.id]),
  db.query("SELECT g.gate,g.purpose,g.outcome,g.eligible,g.predicates,g.created_at,u.display_name actor FROM result_gate_evaluation g LEFT JOIN app_user u ON u.id=g.actor_id WHERE g.version_id=$1 ORDER BY g.created_at DESC LIMIT 10",[v.id]),
  db.query("SELECT w.abnormal_acknowledged,w.note,w.created_at,u.display_name reviewer,w.reviewer_id FROM result_review w JOIN app_user u ON u.id=w.reviewer_id WHERE w.version_id=$1 ORDER BY w.created_at",[v.id])]);
 const s=await resultSettings(db);
 const proposal=await openProposal(db,v.id);
 const target=v.round_id?(await db.query<{round_number:number;ln:string;ln_halos:string|null;printed_sample_id:string|null;attempt_number:number|null;attempt_state:string|null;current:boolean}>('SELECT r.round_number,l.ln,n.ln_halos,a.printed_sample_id,a.attempt_number,a.state attempt_state,c.current_round_id=r.id current FROM specimen_round r JOIN nipt_case c ON c.id=r.case_id JOIN case_ln l ON l.id=r.case_ln_id LEFT JOIN specimen_lab_number n ON n.round_id=r.id LEFT JOIN analytical_attempt a ON a.id=$2 WHERE r.id=$1',[v.round_id,v.attempt_id])).rows[0]:null;
 const conflicts=await versionNameConflicts(db,v);
 return {operational:await operationalWorkflow(db),nameConflicts:conflicts,version:{id:v.id,kind:v.kind,templateKind:v.template_kind,templateVersion:v.template_version,parserVersion:v.parser_version,state:v.state,rowVersion:v.row_version,sha256:v.sha256,importedAt:v.imported_at,caseId:v.case_id,roundId:v.round_id,attemptId:v.attempt_id,linkMode:v.link_mode,supersedesId:v.supersedes_id,revision:v.revision},
  parsed:v.parsed,summary:summary(v.parsed),intake:{...intake,size:Number(intake.byte_size)},target,proposal,
  candidates:v.state==='Unlinked'&&v.kind!=='UNKNOWN'?await linkCandidates(db,user,v.parsed,s):[],
  gate:v.round_id?await gateFor(db,v,'VALIDATION'):null,events:events.rows,links:links.rows,gates:gates.rows,reviews:reviews.rows,
  can:{propose:authorize(user,'result.link.manual',{},'propose')&&v.state==='Unlinked'&&!proposal,decide:!!proposal&&authorize(user,'result.link.manual',{actorId:proposal.actor_id},'approve'),
   unlink:authorize(user,'result.link.manual',{},'approve')&&['LinkConflict','Linked','ValidationBlocked','PendingCertification'].includes(v.state)&&!v.supersedes_id,
   review:authorize(user,'result.review')&&['Linked','ValidationBlocked','PendingCertification'].includes(v.state),certify:authorize(user,'result.release.check')&&!!v.round_id,
   void:authorize(user,'result.revise')&&v.state==='Unlinked',releaseAuthorized:false}};
}
export async function readVersionFile(db:Queryable,user:Staff,store:FileStore,id:string){
 need(user,'result.review','read');const v=await versionOf(db,id);
 await db.query("INSERT INTO result_access_log(actor_id,case_id,version_id,purpose) VALUES($1,$2,$3,'LAB_REVIEW_FILE')",[user.id,v.case_id,v.id]);
 return {bytes:await store.get(v.sha256),sha256:v.sha256,pdf:(await db.query<{container:string}>('SELECT container FROM result_intake_file WHERE id=$1',[v.intake_file_id])).rows[0].container==='PDF'};
}
export async function readIntakeFile(db:Queryable,user:Staff,store:FileStore,id:string){
 need(user,'result.import');const r=(await db.query<{sha256:string;container:string|null;actor_id:string}>('SELECT sha256,container,actor_id FROM result_intake_file WHERE id=$1',[uuid.parse(id)])).rows[0];
 if(!r||r.actor_id!==user.id||r.container!=='PDF')throw new LabError('NOT_FOUND',404);
 return {bytes:await store.get(r.sha256),sha256:r.sha256};
}

/** ANC Result Viewer (§11.8, §11.10, LD-08): per round, only the current Released version; unreleased PDFs and notices never leave
 *  this function. Redraw badges come from the operational order (LD-03), not from any PDF. Every read is access-logged. */
export async function ancCaseResults(db:Queryable,user:Staff,caseId:string){
 await assertSession(db,user);
 const c=(await db.query<{id:string;current_round_id:string;registration_origin:string;unit_id:string|null}>('SELECT c.id,c.current_round_id,c.registration_origin,(SELECT s.unit_id FROM case_unit_scope s WHERE s.case_id=c.id ORDER BY s.unit_id LIMIT 1) unit_id FROM nipt_case c WHERE c.id=$1',[uuid.parse(caseId)])).rows[0];
 if(!c||!authorize(user,'result.read.released',{unitId:c.unit_id??undefined,origin:c.registration_origin as 'ANC'},'read'))throw new LabError('NOT_FOUND',404);
 const [rounds,redraws,releases]=await Promise.all([
  db.query<{id:string;round_number:number;state:string;collection_date:string|null}>('SELECT id,round_number,state,collection_date::text FROM specimen_round WHERE case_id=$1 ORDER BY round_number DESC',[c.id]),
  db.query<{source_round_id:string;reason_code:string;state:string;requested_at:Date}>("SELECT source_round_id,reason_code,state,requested_at FROM redraw_request WHERE case_id=$1 AND state IN ('Requested','Completed')",[c.id]),
  db.query<{id:string;round_id:string;kind:string;state:string;certified_at:Date;revised:boolean}>("SELECT r.id,r.round_id,r.kind,r.state,r.certified_at,v.supersedes_id IS NOT NULL revised FROM result_release r JOIN result_report_version v ON v.id=r.version_id WHERE r.case_id=$1 AND r.state IN ('Active','Superseded','Voided') ORDER BY r.certified_at DESC",[c.id])]);
 await db.query("INSERT INTO result_access_log(actor_id,case_id,purpose) VALUES($1,$2,'ANC_RESULT_LIST')",[user.id,c.id]);
 return {currentRoundId:c.current_round_id,releaseHold:true,rounds:rounds.rows.map(r=>{
  const d=redraws.rows.find(x=>x.source_round_id===r.id);const mine=releases.rows.filter(x=>x.round_id===r.id);
  return {id:r.id,number:r.round_number,state:r.state,current:r.id===c.current_round_id,collectionDate:r.collection_date,
   redraw:d?{reasonCode:d.reason_code,label:REDRAW_LABELS[d.reason_code as keyof typeof REDRAW_LABELS]??REDRAW_LABELS.OTHER,requestedAt:d.requested_at}:null,
   result:mine.find(x=>x.kind==='RESULT'&&x.state==='Active')??null,notices:mine.filter(x=>x.kind==='REDRAW_NOTICE'&&x.state==='Active'),history:mine.filter(x=>x.state!=='Active').map(x=>({id:x.id,kind:x.kind,state:x.state}))};
 })};
}
export async function readReleasedFile(db:Queryable,user:Staff,store:FileStore,releaseId:string){
 await assertSession(db,user);
 const r=(await db.query<{case_id:string;sha256:string;unit_id:string|null;registration_origin:string}>("SELECT r.case_id,v.sha256,(SELECT s.unit_id FROM case_unit_scope s WHERE s.case_id=r.case_id ORDER BY s.unit_id LIMIT 1) unit_id,c.registration_origin FROM result_release r JOIN result_report_version v ON v.id=r.version_id JOIN nipt_case c ON c.id=r.case_id WHERE r.id=$1 AND r.state='Active'",[uuid.parse(releaseId)])).rows[0];
 if(!r||!authorize(user,'result.read.released',{unitId:r.unit_id??undefined,origin:r.registration_origin as 'ANC'},'read'))throw new LabError('NOT_FOUND',404);
 await db.query("INSERT INTO result_access_log(actor_id,case_id,purpose) VALUES($1,$2,'ANC_RESULT_FILE')",[user.id,r.case_id]);
 return {bytes:await store.get(r.sha256),sha256:r.sha256};
}
