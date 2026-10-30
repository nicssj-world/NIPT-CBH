import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {PDFDocument,StandardFonts,rgb,degrees} from 'pdf-lib';
import type {Queryable} from '../db/connection';
import type {FileStore} from '../storage';
import {authorize} from '../security/policy';
import {need,assertSession,audit,uuid,LabError,caseVisible,type Staff} from '../lab/core';
import {readPet} from '../inbound/process';
import {petDisplayName} from '../sequencing/owner-export';
import {SETTINGS} from '../settings/catalog';
import {readActiveSettings} from '../settings/service';
import {pdfText} from '../results/extract';
import {parseReport,isNoCallReport} from '../results/parser';
import {roundRequest,registerInternalVersion,acceptInternalAndRelease} from '../results/service';
import {writeArchive,sha256} from '../workbook/archive';
import {interpretRow,productCodeOf,halosGaDays,TEMPLATES,RULESET,RULESET_SHA256,type Interpretation,type Hold} from './interpretation';
import {resolveSample} from './halos-import';
import {fillReport,DocxError,type ReportValues,type SignerSlot} from './docx';
import {renderDocxBatch,type RenderedPdf} from './native-word';
import {activeTemplate} from './template-active';
import {signerAuthority,type SignerAuthority} from './signers';
import {renderDownloadName,uniqueNames,DEFAULT_DOWNLOAD_TEMPLATE} from './filename';
import type {HalosRow} from './halos-adapter';
import {ANALYSIS_HEADERS,SAMPLEINFO_HEADERS} from './halos-adapter';

// Task 3 pathway A: prepare, preview and finalise Singleton/Twin reports from the Owner's DOCX masters.
// Preparation gathers every printed value from its authoritative source and every reason to HOLD. A HOLD is never overridden here;
// it is cleared only at its source (approval setting, Sample Detail, a new HALOS import, a verified signer, ...).
export type ReportDeps={store:FileStore;render?:(items:{id:string;docx:Buffer}[])=>Promise<RenderedPdf[]>;templates?:Partial<Record<'SINGLETON'|'TWIN',Buffer>>};
const MONTHS=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
/** dd-MMM-yyyy (ReadyGen enrich_datetime) of a Bangkok calendar date. */
export const reportDate=(isoDay:string)=>{const [y,m,d]=isoDay.slice(0,10).split('-');return `${d}-${MONTHS[Number(m)-1]}-${y}`;};
const bangkokDay=(iso:string|Date)=>new Date(new Date(iso).getTime()+7*3600000).toISOString().slice(0,10);
export type Master={bytes:Buffer;sha256:string;code:string;revisionId:string|null};
/** OWNER-LAB-056: an Admin-approved ACTIVE registry revision wins; otherwise the Owner's installed master pinned by SHA-256 (unchanged). */
async function masterBytes(db:Queryable|null,deps:ReportDeps,kind:'SINGLETON'|'TWIN'):Promise<Master|null>{
 if(deps.templates?.[kind])return {bytes:deps.templates[kind]!,sha256:TEMPLATES[kind].sha256,code:TEMPLATES[kind].code,revisionId:null};
 const act=db?await activeTemplate(db,kind):null;
 if(act){try{const b=await deps.store.get(act.sha256);return sha256(b)===act.sha256?{bytes:b,sha256:act.sha256,code:TEMPLATES[kind].code,revisionId:act.revisionId}:null;}catch{return null;}}
 const path=process.env[kind==='SINGLETON'?'NIPT_REPORT_TEMPLATE_SINGLETON':'NIPT_REPORT_TEMPLATE_TWIN'];if(!path)return null;
 try{const b=await readFile(path);return sha256(b)===TEMPLATES[kind].sha256?{bytes:b,sha256:TEMPLATES[kind].sha256,code:TEMPLATES[kind].code,revisionId:null}:null;}catch{return null;}
}
/** Active CLINICAL approval of the interpretation. A default (never activated) value approves nothing. */
export async function interpretationApproval(db:Queryable){
 const r=(await db.query<{id:string;version:number;value:unknown;created_by:string;approved_by:string|null}>("SELECT r.id,r.version,r.value,r.created_by,r.approved_by FROM setting_active a JOIN settings_revision r ON r.id=a.revision_id WHERE a.setting_key='report_interpretation'")).rows[0];
 const value=SETTINGS.report_interpretation.schema.parse(r?.value??SETTINGS.report_interpretation.default);
 const approvedRevision=!!r&&!!r.approved_by&&r.approved_by!==r.created_by;
 return {revisionId:r?.id??null,revisionVersion:r?.version??null,value,approvedRevision,rulesetMatches:value.rulesetSha256===RULESET_SHA256&&value.rulesetVersion===RULESET.version};
}
async function downloadTemplate(db:Queryable){const s=await readActiveSettings(db);return SETTINGS.report_output.schema.parse(s.report_output??SETTINGS.report_output.default).downloadNameTemplate||DEFAULT_DOWNLOAD_TEMPLATE;}

type SourceRow={row_id:string;import_id:string;import_state:string;classification:string;reason:string;sample_key:string;raw:Record<string,string>;attempt_id:string;round_id:string;case_id:string;export_id:string;export_kind:string;
 info_raw:Record<string,string>|null;attempt_state:string;attempt_number:number;printed_sample_id:string|null;no_call:boolean;on_hold:boolean;ln:string;ln_halos:string|null;hn:string|null;registration_origin:string;current_round_id:string;unit_id:string|null;
 pet_sha:string|null;pet_filename:string|null;pet_parsed:{specimenAt?:string;receivedAt?:string}|null;
 eqa_verified:boolean;eqa_name:string|null;eqa_dob:string|null;eqa_pregnancy:'Singleton'|'Twins'|null;eqa_edd:string|null;eqa_received_at:Date|null;eqa_collection_date:string|null;doctor:string|null;edd:string|null;pregnancy:string|null;revoked:boolean;clinical_ready:boolean;newer_row:boolean;
 internal_final:string|null;internal_version_state:string|null;open_series:boolean;active_release:boolean};
const SOURCE_SQL=`SELECT h.id row_id,h.import_id,i.state import_state,h.classification,h.reason,h.sample_key,h.raw,h.attempt_id,h.round_id,h.case_id,h.export_id,h.export_kind,si.raw info_raw,
 a.state attempt_state,a.attempt_number,a.printed_sample_id,EXISTS(SELECT 1 FROM attempt_event e WHERE e.attempt_id=a.id AND e.event_type='NO_CALL_SELECTED') no_call,
 COALESCE((SELECT x.event_type='HOLD_SET' FROM attempt_event x WHERE x.attempt_id=a.id AND x.event_type IN ('HOLD_SET','HOLD_RELEASED') ORDER BY x.sequence DESC LIMIT 1),false) on_hold,
 l.ln,n.ln_halos,ci.hn,c.registration_origin,c.current_round_id,(SELECT s.unit_id FROM case_unit_scope s WHERE s.case_id=c.id ORDER BY s.unit_id LIMIT 1) unit_id,
 f.sha256 pet_sha,f.filename pet_filename,f.parsed pet_parsed,eq.case_id IS NOT NULL eqa_verified,eq.patient_name eqa_name,eq.patient_dob::text eqa_dob,eq.pregnancy_type eqa_pregnancy,eq.edd::text eqa_edd,r.received_at eqa_received_at,r.collection_date::text eqa_collection_date,COALESCE(d.name,ld.name) doctor,COALESCE(w.draft#>>'{pregnancy,edd}',lr.edd::text) edd,COALESCE(w.draft#>>'{pregnancy,type}',lr.pregnancy) pregnancy,
 EXISTS(SELECT 1 FROM p2_revocation v WHERE v.case_id=c.id) revoked,(p2_clinical_ready(r.id) OR lab_owner_paper_ready(r.id) OR (eq.case_id IS NOT NULL AND nipt_round_pet_or_eqa_ok(r.id))) clinical_ready,
 EXISTS(SELECT 1 FROM halos_import_row h2 JOIN halos_import i2 ON i2.id=h2.import_id WHERE h2.attempt_id=h.attempt_id AND h2.sheet='result' AND h2.classification='PATIENT' AND i2.state='Confirmed' AND i2.uploaded_at>i.uploaded_at) newer_row,
 (SELECT ir.id FROM internal_report ir WHERE ir.attempt_id=h.attempt_id AND ir.state='Final') internal_final,
 (SELECT v.state FROM internal_report ir JOIN result_report_version v ON v.id=ir.version_id WHERE ir.attempt_id=h.attempt_id AND ir.state='Final') internal_version_state,
 EXISTS(SELECT 1 FROM result_report_version o WHERE o.round_id=r.id AND o.kind='RESULT' AND o.state IN ('LinkConflict','Linked','ValidationBlocked','PendingCertification')) open_series,
 EXISTS(SELECT 1 FROM result_release x WHERE x.round_id=r.id AND x.kind='RESULT' AND x.state='Active') active_release
 FROM halos_import_row h JOIN halos_import i ON i.id=h.import_id LEFT JOIN halos_import_row si ON si.id=h.sampleinfo_row_id
 JOIN analytical_attempt a ON a.id=h.attempt_id JOIN specimen_round_current r ON r.id=h.round_id JOIN case_ln l ON l.id=r.case_ln_id LEFT JOIN specimen_lab_number n ON n.round_id=r.id
 LEFT JOIN p2_case_identity ci ON ci.case_id=r.case_id JOIN nipt_case c ON c.id=r.case_id LEFT JOIN eqa_case eq ON eq.case_id=c.id
 LEFT JOIN his_order_current o ON o.round_id=r.id LEFT JOIN his_inbound_file_current f ON f.id=o.inbound_file_id
 LEFT JOIN p2_workspace w ON w.round_id=r.id LEFT JOIN p2_doctor_version d ON d.id=(w.draft#>>'{ordering,doctorVersionId}')::uuid
 LEFT JOIN LATERAL (SELECT * FROM lab_operational_registration x WHERE x.case_id=r.case_id ORDER BY (x.round_id=r.id) DESC,x.created_at DESC LIMIT 1) lr ON true LEFT JOIN p2_doctor_version ld ON ld.id=lr.doctor_version_id`;

export const NO_CALL_RESULT='No Call';
export type Prepared={rowId:string;caseId:string;roundId:string;attemptId:string;template:'SINGLETON'|'TWIN';noCall:boolean;pregnancySource:'ANC_REQUEST'|'AUTHORIZED_OVERRIDE';overrideReason:string|null;
 holds:Hold[];interpretation:Interpretation;values:ReportValues|null;productCode:string|null;sources:Record<string,unknown>;hisLn:string;lnHalos:string|null;hn:string|null;sampleId:string;
 approval:Awaited<ReturnType<typeof interpretationApproval>>;reissue:{internalId:string;versionState:string|null}|null};
const rowValues=(raw:Record<string,string>,headers:Record<string,string>)=>{const norm=Object.fromEntries(Object.entries(raw).map(([k,v])=>[k.replace(/\s+/g,' ').trim().toLowerCase(),v]));
 return Object.fromEntries(Object.entries(headers).map(([k,h])=>[k,norm[h.toLowerCase()]??''])) as HalosRow['values'];};
/** Everything the report would print, from its authoritative source, and every reason it cannot be final yet. Reads only. */
export async function prepareReport(db:Queryable,user:Staff,deps:ReportDeps,input:{rowId:string;pregnancyOverride?:'Singleton'|'Twins';overrideReason?:string;reissue?:boolean}):Promise<Prepared>{
 const s=(await db.query<SourceRow>(SOURCE_SQL+' WHERE h.id=$1',[uuid.parse(input.rowId)])).rows[0];
 // Controls, unmatched and other non-patient rows have no attempt: they are never report candidates.
 if(!s){const r=(await db.query<{classification:string;reason:string}>('SELECT classification,reason FROM halos_import_row WHERE id=$1',[input.rowId])).rows[0];if(r)throw new LabError('ROW_NOT_REPORTABLE',409,{raw:`${r.classification}/${r.reason}`});}
 if(!s||!caseVisible(user,{unit_id:s.unit_id,registration_origin:s.registration_origin}))throw new LabError('NOT_FOUND',404);
 const holds:Hold[]=[],h=(code:string,extra:Partial<Hold>={})=>holds.push({code,...extra});
 if(s.import_state!=='Confirmed')h('HALOS_IMPORT_NOT_CONFIRMED');
 if(s.classification!=='PATIENT')h('ROW_NOT_REPORTABLE',{raw:`${s.classification}/${s.reason}`});
 // The frozen export is re-resolved now: a later re-pooling, new attempt or batch change makes an earlier import stale.
 const now=await resolveSample(db,s.sample_key);
 if(now.classification!=='PATIENT'||now.attemptId!==s.attempt_id)h('MATCH_CHANGED_SINCE_IMPORT',{raw:`${now.classification}/${now.reason}`});
 if(s.newer_row)h('NEWER_HALOS_RESULT_EXISTS');
 if(s.printed_sample_id!==s.sample_key)h('SAMPLE_ID_DIFFERS_FROM_ATTEMPT_PRINTED_ID',{raw:s.printed_sample_id??'(none)'});
 // Owner Task 1 decision 2: a No Call is reported in the SAME normal master with an explicit "Result = No Call"; it is never interpreted.
 const noCall=s.no_call;
 if(noCall&&s.attempt_state!=='QcFailed')h('NO_CALL_ATTEMPT_NOT_CONFIRMED_FAILED',{raw:s.attempt_state});
 if(s.on_hold)h('ATTEMPT_ON_QC_HOLD');if(s.revoked)h('CONSENT_REVOKED');if(!s.clinical_ready)h('CLINICAL_DATA_NOT_READY');
 if(s.current_round_id!==s.round_id)h('ROUND_NOT_CURRENT');
 const reissue=s.internal_final?{internalId:s.internal_final,versionState:s.internal_version_state}:null;
 if(reissue&&!input.reissue)h('INTERNAL_REPORT_ALREADY_FINAL');
 if(reissue&&input.reissue&&reissue.versionState==='CertifiedReleased')h('POST_RELEASE_REVISION_PENDING_OD17');
 if(!reissue&&s.open_series)h('OPEN_REPORT_EXISTS_FOR_ROUND');
 if(!reissue&&s.active_release)h('ACTIVE_RELEASE_EXISTS_FOR_ROUND');
 // Identity: printed values come from the verified HIS PET of the round and the case identity; a disagreement is never resolved here.
 let pet:Awaited<ReturnType<typeof readPet>>|null=null;
 if(!s.eqa_verified&&(!s.pet_sha||!s.pet_filename))h('PET_EVIDENCE_REQUIRED');
 else if(!s.eqa_verified){try{pet=await readPet(deps.store,{sha256:s.pet_sha!,filename:s.pet_filename!,ln:s.ln});}catch{h('PET_EVIDENCE_UNVERIFIED');}}
 if(pet&&(!s.hn||pet.hn.replace(/^0+/,'')!==s.hn.replace(/^0+/,'')))h('HN_SOURCES_DISAGREE');
 const specimenAt=s.eqa_verified?s.eqa_collection_date:s.pet_parsed?.specimenAt??pet?.specimenAt,receivedAt=s.eqa_verified?s.eqa_received_at?.toISOString():s.pet_parsed?.receivedAt??pet?.receivedAt;
 if(!specimenAt||!receivedAt)h('PET_CLOCKS_REQUIRED');
 const req=await roundRequest(db,s.round_id);
 if(s.eqa_verified){
  if(req.dob&&s.eqa_dob&&req.dob!==s.eqa_dob)h('EQA_DOB_SOURCES_DISAGREE');
  if(req.edd&&s.eqa_edd&&req.edd!==s.eqa_edd)h('EQA_EDD_SOURCES_DISAGREE');
  if(req.pregnancy&&s.eqa_pregnancy&&req.pregnancy!==s.eqa_pregnancy)h('EQA_PREGNANCY_SOURCES_DISAGREE');
  req.dob=req.dob??s.eqa_dob;req.edd=req.edd??s.eqa_edd;req.pregnancy=req.pregnancy??s.eqa_pregnancy;
 }
 const collectionDay=specimenAt?(s.eqa_verified?s.eqa_collection_date:bangkokDay(specimenAt)):null;
 if(collectionDay&&(req.dates.length!==1||req.dates[0]!==collectionDay))h('COLLECTION_DATE_SOURCES_DISAGREE',{raw:req.dates.join(',')});
 if(pet&&req.dob&&req.dob!==pet.dob.slice(0,10))h('DOB_SOURCES_DISAGREE');
 // The existing identity cross-check of the registered PDF needs the round's Request DOB and EDD; hold here instead of failing after rendering.
 if(!req.dob)h('REQUEST_DOB_NOT_RECORDED');if(!req.edd)h('REQUEST_EDD_NOT_RECORDED');
 const info=s.info_raw?rowValues(s.info_raw,SAMPLEINFO_HEADERS):null;
 if(!info)h('SAMPLEINFO_ROW_MISSING');
 // Template: from the request (ANC / Sample Detail). An override needs an authorised person and a reason, and is recorded.
 const recorded=req.pregnancy??(s.pregnancy==='Singleton'||s.pregnancy==='Twins'?s.pregnancy:null);
 let pregnancy:('Singleton'|'Twins'|null)=recorded,pregnancySource:Prepared['pregnancySource']='ANC_REQUEST',overrideReason:string|null=null;
 if(input.pregnancyOverride&&input.pregnancyOverride!==recorded){
  if(!authorize(user,'result.certify'))throw new LabError('FORBIDDEN',403);
  const reason=(input.overrideReason??'').trim();if(reason.length<8||/\d{13}/.test(reason))throw new LabError('PREGNANCY_OVERRIDE_REASON_REQUIRED',422);
  pregnancy=input.pregnancyOverride;pregnancySource='AUTHORIZED_OVERRIDE';overrideReason=reason;
 }
 if(!pregnancy)h('PREGNANCY_TYPE_NOT_RECORDED');
 const halosFetus=info?.fetusType?.trim();
 if(pregnancy&&halosFetus&&halosFetus!==(pregnancy==='Twins'?'Twins':'Singleton')&&pregnancySource!=='AUTHORIZED_OVERRIDE')h('PREGNANCY_TYPE_SOURCES_DISAGREE',{raw:halosFetus});
 const template:'SINGLETON'|'TWIN'=pregnancy==='Twins'?'TWIN':'SINGLETON';
 const analysis=rowValues(s.raw,ANALYSIS_HEADERS),interpretation=interpretRow({values:analysis},template);
 // A No Call prints no finding, so the interpretation's holds and the disclosure wish do not apply.
 // The Task 1 No Call contract accepts QC PASS or FAIL only: PASS exactly as the ruleset prints it, FAIL for HALOS "Fail"; anything else holds.
 const noCallQc=interpretation.values.qc==='PASS'?'PASS':(analysis.sampleQc??'').trim()==='Fail'?'FAIL':null;
 if(noCall&&!noCallQc)h('NO_CALL_QC_STATUS_UNREADABLE',{raw:`${analysis.sampleQc??''}/${analysis.operationAdvice??''}/${analysis.physicianAdvice??''}`});
 if(!noCall)holds.push(...interpretation.holds);
 // Disclosure follows the recorded wish (RG-11 / OD-09 proposal): the Singleton master always prints Fetal Gender.
 if(!s.eqa_verified&&!noCall&&template==='SINGLETON'&&req.fetalSex!=='Want')h('FETAL_SEX_DISCLOSURE_NOT_PERMITTED',{raw:req.fetalSex??'NOT_RECORDED'});
 if(!s.eqa_verified&&!noCall&&template==='TWIN'&&req.fetalSex==='DoNotWant')h('Y_CHROMOSOME_DISCLOSURE_NOT_PERMITTED');
 let ga:number|null=null;
 if(!req.edd&&!s.edd)h('EDD_REQUIRED_FOR_GA');
 else if(collectionDay){const edd=(req.edd??s.edd)!;ga=280-Math.round((Date.parse(edd+'T00:00:00Z')-Date.parse(collectionDay+'T00:00:00Z'))/86400000);
  if(ga<0||ga>315)h('GA_OUT_OF_RANGE');const halosGa=halosGaDays(info?.gestationalWeeks);if(halosGa!==null&&halosGa!==ga)h('GA_SOURCES_DISAGREE',{raw:info?.gestationalWeeks});}
 const productCode=productCodeOf(info?.productName);if(info&&!productCode)h('PRODUCT_UNRECOGNIZED',{raw:info.productName});
 const approval=await interpretationApproval(db),approvedProduct=template==='SINGLETON'?approval.value.singletonApprovedProduct:approval.value.twinApprovedProduct;
 if(!approval.approvedRevision||!approval.value.interpretationApproved)h('INTERPRETATION_RULESET_NOT_APPROVED');
 else if(!approval.rulesetMatches)h('RULESET_VERSION_MISMATCH');
 if(noCall&&(!approval.approvedRevision||!approval.value.noCallRenderingApproved))h('NO_CALL_RENDERING_NOT_APPROVED');
 if(productCode&&(!approval.approvedRevision||approvedProduct!==productCode))h('PRODUCT_TEMPLATE_COMBINATION_NOT_APPROVED',{raw:`${productCode}/${TEMPLATES[template].code}`});
 if(!await masterBytes(db,deps,template))h('REPORT_MASTER_NOT_INSTALLED');
 const v=interpretation.values,identityBound=(pet||s.eqa_verified&&!!s.eqa_name&&!!s.eqa_dob&&!!s.hn)&&specimenAt&&receivedAt&&ga!==null;
 const canBind=identityBound&&(noCall?!!noCallQc:v.qc&&v.t21&&v.t18&&v.t13&&v.probability.t21&&v.probability.t18&&v.probability.t13);
 // No Call (proposal shown in Settings for approval): every result cell reads "No Call", probabilities "-" (the master's own not-applicable mark).
 const NC=NO_CALL_RESULT;
 const results=noCall?{qc:noCallQc!,trisomy21_ra:NC,trisomy18_ra:NC,trisomy13_ra:NC,risk21:'-',risk18:'-',risk13:'-',gender:NC,gender_cbh:NC,XO_NEW:NC,XXX_NEW:NC,XXY_NEW:NC,XYY_NEW:NC,fetalFaction_2:NC,remarks:`Result = ${NC}`}
  :{qc:v.qc!,trisomy21_ra:v.t21!,trisomy18_ra:v.t18!,trisomy13_ra:v.t13!,risk21:v.probability.t21!,risk18:v.probability.t18!,risk13:v.probability.t13!,
   gender:v.fetalGender??'',gender_cbh:v.yChromosome??'',XO_NEW:v.xo??'',XXX_NEW:v.xxx??'',XXY_NEW:v.xxy??'',XYY_NEW:v.xyy??'',fetalFaction_2:v.fetalFraction??'',remarks:''};
 const values:ReportValues|null=canBind?{patientName:s.eqa_verified?s.eqa_name!:petDisplayName(pet!.name),ga:`${Math.floor(ga!/7)}W ${ga!%7}D`,sampleID:s.sample_key,hn:s.eqa_verified?s.hn!:pet!.hn,collectDate_cbh:reportDate(collectionDay!),
  patientIDCard:s.eqa_verified?'-':pet!.identity||'-',dob_cbh:reportDate(s.eqa_verified?s.eqa_dob!:pet!.dob),receivedDate_cbh:reportDate(bangkokDay(receivedAt!)),referringPhysician:s.doctor?.trim()||'-',hospitalName:'Chonburi hospital',sampleType:'Peripheral Blood',...results}:null;
 return {rowId:s.row_id,caseId:s.case_id,roundId:s.round_id,attemptId:s.attempt_id,template,noCall,pregnancySource,overrideReason,holds,interpretation,values,productCode,hisLn:s.ln,lnHalos:s.ln_halos,hn:s.hn,sampleId:s.sample_key,approval,reissue,
  sources:{halosRowId:s.row_id,halosImportId:s.import_id,exportId:s.export_id,exportKind:s.export_kind,petSha256:s.pet_sha,eqaVerified:s.eqa_verified,pregnancy:{recorded,used:pregnancy,source:pregnancySource,halos:halosFetus??null},
   fetalSexPreference:req.fetalSex,edd:req.edd??s.edd,collectionDay,gaDays:ga,halosGa:info?.gestationalWeeks??null,productCode,productName:info?.productName??null,doctor:s.doctor??null}};
}

const PREVIEW_MARK='PREVIEW - NOT A FINAL REPORT';
export async function watermark(pdf:Buffer){
 const doc=await PDFDocument.load(pdf),font=await doc.embedFont(StandardFonts.HelveticaBold);
 for(const page of doc.getPages()){const {width,height}=page.getSize();page.drawText(PREVIEW_MARK,{x:width*0.12,y:height*0.3,size:38,font,color:rgb(0.85,0.1,0.1),opacity:0.28,rotate:degrees(38)});
  page.drawText(PREVIEW_MARK+' - DRAFT FOR REVIEW ONLY',{x:24,y:height-18,size:8,font,color:rgb(0.85,0.1,0.1)});}
 return Buffer.from(await doc.save());
}
type SignerPick={reportedBy?:string|null;approvedBy?:string|null};
async function signerSlots(db:Queryable,user:Staff,store:FileStore,pick:SignerPick,final:boolean){
 const slot=async(role:'REPORTED'|'APPROVED',id:string|null|undefined):Promise<{slot:SignerSlot;authority:SignerAuthority|null}>=>{
  if(!id){if(final)throw new LabError(role==='REPORTED'?'REPORTED_BY_REQUIRED':'APPROVED_BY_REQUIRED',422);return {slot:{name:'—',license:'—',date:'—',signature:null},authority:null};}
  const a=await signerAuthority(db,user,id,role);
  return {slot:{name:a.profile.legal_name,license:a.profile.mt_license_no,date:reportDate(bangkokDay(a.checkedAt)),signature:{bytes:await store.get(a.profile.signature_sha256),media:a.profile.signature_media}},authority:a};
 };
 const reported=await slot('REPORTED',pick.reportedBy);const approved=await slot('APPROVED',pick.approvedBy);
 return {reported,approved};
}
/** The rendered PDF must read back as exactly what was bound: identity, results, QC, both signers and both dates, on one page. */
export async function verifyRendered(pdf:Buffer,p:Prepared,signers:{reported:SignerSlot;approved:SignerSlot}){
 const x=await pdfText(pdf),parsed=parseReport(x.text,'internal.pdf'),v=p.values!,text=x.text.replace(/\s+/g,' '),problems:string[]=[];
 const want=(cond:boolean,code:string)=>{if(!cond)problems.push(code);};
 want(x.pages===1,'PAGE_COUNT');want(parsed.templateKind===p.template,'TEMPLATE_KIND');want(!/\$\{/.test(x.text),'PLACEHOLDER_REMAINS');
 want(parsed.identifiers.labNumber.value===v.sampleID,'LAB_NUMBER');want(parsed.identifiers.hn.value===v.hn,'HN');
 want(parsed.results.qc.value===v.qc,'QC');want(parsed.identifiers.gestationalAgeDays.value===Number(p.sources.gaDays),'GA');
 // A No Call must read back as the Task 1 No Call contract and carry no risk, detection, sex or fetal-fraction finding at all.
 // (The Twin master's static guidance text mentions "Detected", so findings are checked per field, never by a page-wide word scan.)
 if(p.noCall){want(isNoCallReport(parsed),'NO_CALL_RESULT');want(!/\b(?:Low Risk|High Risk|Male|Female)\b/.test(text),'NO_CALL_FINDING_PRINTED');
  const r=parsed.results;want([r.t21,r.t18,r.t13,r.yChromosome,r.fetalSex,r.xo,r.xxx,r.xxy,r.xyy,r.fetalFraction].every(x=>x.value===null),'NO_CALL_FINDING_READ');}
 else{want(!parsed.results.result?.value,'UNEXPECTED_RESULT_LINE');
 want(parsed.results.t21.value===v.trisomy21_ra&&parsed.results.t18.value===v.trisomy18_ra&&parsed.results.t13.value===v.trisomy13_ra,'TRISOMY');
 if(p.template==='SINGLETON'){want([parsed.results.xo.value,parsed.results.xxx.value,parsed.results.xxy.value,parsed.results.xyy.value].join('/')===[v.XO_NEW,v.XXX_NEW,v.XXY_NEW,v.XYY_NEW].join('/'),'SCA');
  want(parsed.results.fetalFraction.value===Number(v.fetalFaction_2),'FETAL_FRACTION');want(parsed.results.fetalSex.value===v.gender,'FETAL_SEX');}
 else want(parsed.results.yChromosome.value===v.gender_cbh,'Y_CHROMOSOME');}
 for(const [label,s] of [['Reported',signers.reported],['Approved',signers.approved]] as const){
  // PDF text extraction splits "25-Oct-2026" into "25 - Oct - 2026" (as in the real ReadyGen PDFs); compare without those spaces.
  want(text.replace(/\s*-\s*/g,'-').includes(`${label} Date: ${s.date}`),`${label.toUpperCase()}_DATE`);want(text.replace(/\s+/g,'').includes(`(${s.name})`.replace(/\s+/g,'')),`${label.toUpperCase()}_NAME`);
  want(text.replace(/\s+/g,'').includes(`no.${s.license})`),`${label.toUpperCase()}_LICENSE`);}
 return {ok:problems.length===0,problems,parsed};
}

const previewSchema=z.strictObject({rowId:uuid,pregnancyOverride:z.enum(['Singleton','Twins']).optional(),overrideReason:z.string().max(500).optional(),reportedBy:uuid.nullable().optional(),approvedBy:uuid.nullable().optional()});
/** Draft preview from the exact master. Watermarked, never stored as a report, never linked or released. */
export async function previewReport(db:Queryable,user:Staff,deps:ReportDeps,input:unknown){
 await assertSession(db,user);need(user,'result.review','read');
 const d=previewSchema.parse(input),p=await prepareReport(db,user,deps,d);
 if(!p.values)throw new LabError('REPORT_VALUES_INCOMPLETE',409,{holds:p.holds});
 const master=await masterBytes(db,deps,p.template);if(!master)throw new LabError('REPORT_MASTER_NOT_INSTALLED',409);
 const signers=await signerSlots(db,user,deps.store,d,false);
 let docx;try{docx=fillReport(master.bytes,p.template,p.values,{reported:signers.reported.slot,approved:signers.approved.slot},{sha256:master.sha256,code:master.code});}catch(e){if(e instanceof DocxError)throw new LabError(e.message,409,e.details);throw e;}
 const [pdf]=await(deps.render??renderDocxBatch)([{id:'preview',docx:docx.bytes}]);
 await db.query("INSERT INTO result_access_log(actor_id,case_id,purpose) VALUES($1,$2,'LAB_INTERNAL_PREVIEW')",[user.id,p.caseId]);
 await audit(db,user,'INTERNAL_REPORT_PREVIEWED','HALOS_IMPORT_ROW',p.rowId,{outcome:p.holds.length?'HOLD':'ELIGIBLE',count:p.holds.length});
 return {bytes:await watermark(pdf.bytes),holds:p.holds,pages:pdf.pages};
}
/** Read model for the report dialog: values, sources, interpretation trace and HOLD reasons. */
export async function reportCandidate(db:Queryable,user:Staff,deps:ReportDeps,input:unknown){
 await assertSession(db,user);need(user,'result.review','read');
 const d=previewSchema.pick({rowId:true,pregnancyOverride:true,overrideReason:true}).parse(input),p=await prepareReport(db,user,deps,d);
 return {rowId:p.rowId,template:p.template,templateCode:(await masterBytes(db,deps,p.template))?.code??TEMPLATES[p.template].code,pregnancySource:p.pregnancySource,holds:p.holds,eligible:p.holds.length===0,values:p.values,interpretation:p.interpretation,
  productCode:p.productCode,sources:p.sources,hisLn:p.hisLn,lnHalos:p.lnHalos,hn:p.hn,sampleId:p.sampleId,reissue:p.reissue,approval:{revisionId:p.approval.revisionId,approved:p.approval.approvedRevision&&p.approval.value.interpretationApproved,reference:p.approval.value.approvalReference},
  canFinalize:authorize(user,'result.certify')};
}

const finalizeSchema=z.strictObject({idempotencyKey:uuid,defaults:z.strictObject({reportedBy:uuid.nullable().default(null),approvedBy:uuid.nullable().default(null)}).default({reportedBy:null,approvedBy:null}),
 release:z.boolean().default(false),releaseConfirmations:z.strictObject({reportContentVerified:z.literal(true),identityAndValuesMatchReport:z.literal(true),disclosureReviewed:z.literal(true),abnormalAcknowledged:z.boolean(),benchMeasurementsReviewed:z.literal(true).optional()}).optional(),
 items:z.array(z.strictObject({rowId:uuid,pregnancyOverride:z.enum(['Singleton','Twins']).optional(),overrideReason:z.string().max(500).optional(),reportedBy:uuid.nullable().optional(),approvedBy:uuid.nullable().optional(),reissueReason:z.string().trim().min(8).max(500).refine(x=>!/\d{13}/.test(x),'REASON_TEXT_INVALID').optional()})).min(1).max(100)});
export type FinalizeOutcome={rowId:string;outcome:'FINAL'|'HOLD'|'ERROR';holds?:Hold[];code?:string;details?:unknown;internalReportId?:string;versionId?:string;versionState?:string;release?:string;downloadName?:string};
/**
 * Single or batch Final. One PDF per patient; held/invalid rows stay visible and unfinalised. Each row runs in its own savepoint,
 * so one failure never finalises or rolls back another. Replaying the same idempotency key returns the recorded batch.
 */
export async function finalizeReports(db:Queryable,user:Staff,deps:ReportDeps,input:unknown){
 await assertSession(db,user);need(user,'result.review');need(user,'result.certify');
 const d=finalizeSchema.parse(input);
 await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,75432862))',[d.idempotencyKey]);
 const prior=(await db.query<{id:string;operator_id:string;outcome:FinalizeOutcome[]}>('SELECT id,operator_id,outcome FROM internal_report_batch WHERE idempotency_key=$1',[d.idempotencyKey])).rows[0];
 if(prior){if(prior.operator_id!==user.id)throw new LabError('IDEMPOTENCY_KEY_REUSED',409);return {batchId:prior.id,replayed:true,items:prior.outcome};}
 if(new Set(d.items.map(i=>i.rowId)).size!==d.items.length)throw new LabError('DUPLICATE_ROW_IN_BATCH',422);
 const template=await downloadTemplate(db),out:FinalizeOutcome[]=[],work:{i:number;p:Prepared;signers:Awaited<ReturnType<typeof signerSlots>>;docx:ReturnType<typeof fillReport>;master:Master}[]=[];
 // Phase 1: authority, eligibility and filled masters. Nothing is written yet.
 for(const [i,item] of d.items.entries()){
  try{
   const p=await prepareReport(db,user,deps,{rowId:item.rowId,pregnancyOverride:item.pregnancyOverride,overrideReason:item.overrideReason,reissue:!!item.reissueReason});
   if(p.holds.length||!p.values){out[i]={rowId:item.rowId,outcome:'HOLD',holds:p.holds};continue;}
   const signers=await signerSlots(db,user,deps.store,{reportedBy:item.reportedBy??d.defaults.reportedBy,approvedBy:item.approvedBy??d.defaults.approvedBy},true);
   const master=(await masterBytes(db,deps,p.template))!;
   const docx=fillReport(master.bytes,p.template,p.values,{reported:signers.reported.slot,approved:signers.approved.slot},{sha256:master.sha256,code:master.code});
   work.push({i,p,signers,docx,master});
  }catch(e){
   if(e instanceof LabError&&e.code==='ROW_NOT_REPORTABLE'){out[i]={rowId:item.rowId,outcome:'HOLD',holds:[{code:'ROW_NOT_REPORTABLE',raw:String((e.details as {raw?:string})?.raw??'')}]};continue;}
   if(e instanceof LabError||e instanceof DocxError)out[i]={rowId:item.rowId,outcome:'ERROR',code:e instanceof LabError?e.code:e.message,...(e.details?{details:e.details}:{})};else throw e;}
 }
 // Phase 2: one Microsoft Word session renders every eligible report.
 const rendered=work.length?await(deps.render??renderDocxBatch)(work.map(w=>({id:String(w.i),docx:w.docx.bytes}))):[];
 // The batch record is written once, at the end, with every outcome (its rows reference it through a deferred key).
 const batchId=randomUUID();
 // Phase 3: verify, store, freeze and register each report on the existing ledger.
 for(const w of work){
  const item=d.items[w.i],pdf=rendered.find(r=>r.id===String(w.i))!;
  await db.query('SAVEPOINT internal_report_item');
  try{
   const check=await verifyRendered(pdf.bytes,w.p,{reported:w.signers.reported.slot,approved:w.signers.approved.slot});
   if(!check.ok)throw new LabError('REPORT_RENDER_VERIFICATION_FAILED',409,{problems:check.problems});
   const hash=await deps.store.put(pdf.bytes);
   await db.query("INSERT INTO file_asset(sha256,byte_size,media_type,storage_key) VALUES($1,$2,'application/pdf',$3) ON CONFLICT(sha256) DO NOTHING",[hash,pdf.bytes.length,`sha256/${hash.slice(0,2)}/${hash.slice(2,4)}/${hash}`]);
   const seq=Number((await db.query<{n:number}>('SELECT count(*)::int+1 n FROM internal_report WHERE attempt_id=$1',[w.p.attemptId])).rows[0].n);
   const name=renderDownloadName(template,{hisLn:w.p.hisLn,lnHalos:w.p.lnHalos??'',sampleId:w.p.sampleId,hn:w.p.hn??'',patientName:w.p.values!.patientName,reportDate:bangkokDay(w.signers.approved.authority!.checkedAt),template:TEMPLATES[w.p.template].code,version:String(seq)});
   const snap=(a:SignerAuthority)=>({basis:a.basis,delegationId:a.delegationId,authorityReference:a.authorityReference,operatorId:a.operatorId,profileId:a.profile.id,profileVersion:a.profile.version,legalName:a.profile.legal_name,license:a.profile.mt_license_no,signatureSha256:a.profile.signature_sha256,checkedAt:a.checkedAt});
   const ruleset={id:RULESET.id,version:RULESET.version,sha256:RULESET_SHA256,settingRevisionId:w.p.approval.revisionId,settingRevisionVersion:w.p.approval.revisionVersion,approved:w.p.approval.approvedRevision&&w.p.approval.value.interpretationApproved,
    combinationApproved:(w.p.template==='SINGLETON'?w.p.approval.value.singletonApprovedProduct:w.p.approval.value.twinApprovedProduct)===w.p.productCode,productCode:w.p.productCode,approvalReference:w.p.approval.value.approvalReference,
    noCallRenderingApproved:w.p.approval.approvedRevision&&w.p.approval.value.noCallRenderingApproved};
   // A No Call is a recorded disposition of the attempt, not an interpretation of findings; the HALOS trace is kept for the record only.
   const interpretation=w.p.noCall?{status:'NO_CALL',template:w.p.template,source:'ATTEMPT_NO_CALL_SELECTED',qc:w.p.values!.qc,ruleset:w.p.interpretation.ruleset,halosTrace:w.p.interpretation.trace}:w.p.interpretation;
   // A re-issue before release retires the earlier internal report: its version can no longer pass RG-14, and the new version waits
   // Unlinked for the existing two-person revision link. After release the existing OD-17 policy holds it (see prepareReport).
   if(w.p.reissue)await db.query("UPDATE internal_report SET state='Superseded',state_reason=$2 WHERE id=$1 AND state='Final'",[w.p.reissue.internalId,'REISSUED: '+item.reissueReason]);
   const report=(await db.query<{id:string}>(`INSERT INTO internal_report(halos_row_id,attempt_id,round_id,case_id,template_kind,template_code,template_sha256,pregnancy_source,pregnancy_override_reason,interpretation,ruleset,bindings,operator_id,
     reported_by,reported_profile_id,reported_authority,reported_at,approved_by,approved_profile_id,approved_authority,approved_at,pdf_sha256,download_name,supersedes_id,batch_id)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25) RETURNING id`,
    [w.p.rowId,w.p.attemptId,w.p.roundId,w.p.caseId,w.p.template,w.master.code,w.master.sha256,w.p.pregnancySource,w.p.overrideReason,JSON.stringify(interpretation),JSON.stringify(ruleset),
     JSON.stringify({values:w.p.values,docx:w.docx.bindings,sources:w.p.sources,docxSha256:w.docx.sha256,renderer:pdf.renderer,pages:pdf.pages,readback:{templateKind:check.parsed.templateKind,parserVersion:check.parsed.parserVersion}}),user.id,
     w.signers.reported.authority!.profile.user_id,w.signers.reported.authority!.profile.id,JSON.stringify(snap(w.signers.reported.authority!)),w.signers.reported.authority!.checkedAt,
     w.signers.approved.authority!.profile.user_id,w.signers.approved.authority!.profile.id,JSON.stringify(snap(w.signers.approved.authority!)),w.signers.approved.authority!.checkedAt,hash,name,w.p.reissue?.internalId??null,batchId])).rows[0];
   await audit(db,user,'INTERNAL_REPORT_FINALIZED','INTERNAL_REPORT',report.id,{outcome:w.p.noCall?'NO_CALL':'FINAL',origin:'INTERNAL_GENERATED',ruleVersion:`${RULESET.id}-${RULESET.version}`});
   let v=await registerInternalVersion(db,user,deps.store,report.id);
   let release:string|undefined;
   if(d.release&&d.releaseConfirmations&&['Linked','ValidationBlocked','PendingCertification'].includes(v.state)){
    const r=await acceptInternalAndRelease(db,user,{versionId:v.id,expectedRowVersion:v.row_version,idempotencyKey:`t3-${d.idempotencyKey.slice(0,8)}-${report.id}`,...d.releaseConfirmations,...(d.releaseConfirmations.benchMeasurementsReviewed?{benchMeasurementsReviewed:true,benchRevision:await benchRevisionFor(db,w.p.attemptId)}:{})});
    release=r.outcome;v=(await db.query<typeof v>('SELECT * FROM result_report_version WHERE id=$1',[v.id])).rows[0];
   }
   await db.query('RELEASE SAVEPOINT internal_report_item');
   out[w.i]={rowId:item.rowId,outcome:'FINAL',internalReportId:report.id,versionId:v.id,versionState:v.state,downloadName:name,...(release?{release}:{})};
  }catch(e){
   await db.query('ROLLBACK TO SAVEPOINT internal_report_item');await db.query('RELEASE SAVEPOINT internal_report_item');
   if(!(e instanceof LabError))throw e;out[w.i]={rowId:item.rowId,outcome:'ERROR',code:e.code,...(e.details?{details:e.details}:{})};
  }
 }
 await db.query('INSERT INTO internal_report_batch(id,operator_id,idempotency_key,requested,outcome) VALUES($1,$2,$3,$4,$5)',[batchId,user.id,d.idempotencyKey,JSON.stringify({count:d.items.length,release:d.release}),JSON.stringify(out)]);
 await audit(db,user,'INTERNAL_REPORT_BATCH','INTERNAL_REPORT_BATCH',batchId,{outcome:'COMPLETED',count:out.filter(x=>x.outcome==='FINAL').length});
 return {batchId,replayed:false,items:out};
}
async function benchRevisionFor(db:Queryable,attemptId:string){
 return (await db.query<{revision:number}>('SELECT w.revision FROM lab_slot_assignment s JOIN LATERAL (SELECT revision FROM task_workbook_revision r WHERE r.batch_id=s.batch_id ORDER BY revision DESC LIMIT 1) w ON true WHERE s.attempt_id=$1 AND s.removed_at IS NULL LIMIT 1',[attemptId])).rows[0]?.revision;
}

// ---------- LAB worklist, batch ZIP and final file reads ----------
export type WorklistStatus='READY'|'HOLD'|'FINAL'|'RELEASED'|'NOT_REPORTABLE';
const worklistSchema=z.strictObject({q:z.string().trim().max(40).default(''),status:z.enum(['ALL','READY','HOLD','FINAL','RELEASED','NOT_REPORTABLE']).default('ALL'),page:z.number().int().min(1).max(1000).default(1),pageSize:z.number().int().min(10).max(100).default(50)});
/** Rows of confirmed HALOS imports with what to do next. Search by LN, HN, LN Halos or the HALOS sample ID. */
export async function reportWorklist(db:Queryable,user:Staff,deps:ReportDeps,input:unknown){
 await assertSession(db,user);need(user,'result.review','read');
 const d=worklistSchema.parse(input),q=d.q.replace(/[%_\\]/g,'');
 const rows=(await db.query<{row_id:string;sample_key:string;classification:string;reason:string;case_id:string|null;round_id:string|null;attempt_id:string|null;import_id:string;import_name:string;uploaded_at:Date;chip_id:string|null;
  ln:string|null;ln_halos:string|null;hn:string|null;unit_id:string|null;registration_origin:string|null;internal_id:string|null;internal_state:string|null;template_kind:string|null;download_name:string|null;version_id:string|null;version_state:string|null;row_version:number|null;release_id:string|null;attested:boolean}>(
  `SELECT h.id row_id,h.sample_key,h.classification,h.reason,h.case_id,h.round_id,h.attempt_id,i.id import_id,i.original_name import_name,i.uploaded_at,h.chip_id,l.ln,n.ln_halos,ci.hn,
    (SELECT s.unit_id FROM case_unit_scope s WHERE s.case_id=h.case_id ORDER BY s.unit_id LIMIT 1) unit_id,c.registration_origin,
    ir.id internal_id,ir.state internal_state,ir.template_kind,ir.download_name,v.id version_id,v.state version_state,v.row_version,rel.id release_id,COALESCE(task3_his_presence_attested(v.id),false) attested
   FROM halos_import_row h JOIN halos_import i ON i.id=h.import_id AND i.state='Confirmed'
   LEFT JOIN specimen_round_current sr ON sr.id=h.round_id LEFT JOIN case_ln l ON l.id=sr.case_ln_id LEFT JOIN specimen_lab_number n ON n.round_id=h.round_id
   LEFT JOIN p2_case_identity ci ON ci.case_id=h.case_id LEFT JOIN nipt_case c ON c.id=h.case_id
   LEFT JOIN LATERAL (SELECT * FROM internal_report r WHERE r.halos_row_id=h.id ORDER BY r.created_at DESC LIMIT 1) ir ON true
   LEFT JOIN result_report_version v ON v.id=ir.version_id LEFT JOIN result_release rel ON rel.version_id=v.id AND rel.state='Active'
   WHERE h.sheet='result' AND ($1='' OR l.ln LIKE $1||'%' OR ltrim(ci.hn,'0') LIKE ltrim($1,'0')||'%' OR h.sample_key ILIKE '%'||$1||'%' OR n.ln_halos ILIKE '%'||$1||'%')
   ORDER BY i.uploaded_at DESC,h.row_number LIMIT 500`,[q])).rows.filter(r=>!r.case_id||caseVisible(user,{unit_id:r.unit_id,registration_origin:r.registration_origin??'ANC'}));
 const out:{status:WorklistStatus;[key:string]:unknown}[]=[];
 for(const r of rows){
  let status:WorklistStatus,holds:Hold[]=[],template=r.template_kind;
  if(r.classification!=='PATIENT')status='NOT_REPORTABLE';
  else if(r.release_id)status='RELEASED';
  else if(r.internal_state==='Final')status='FINAL';
  else{const p=await prepareReport(db,user,deps,{rowId:r.row_id}).catch(e=>{if(e instanceof LabError)return null;throw e;});holds=p?.holds??[{code:'ROW_NOT_AVAILABLE'}];template=p?.template??null;status=holds.length?'HOLD':'READY';}
  if(d.status!=='ALL'&&d.status!==status)continue;
  out.push({rowId:r.row_id,sampleId:r.sample_key,classification:r.classification,reason:r.reason,status,holds,template,caseId:r.case_id,roundId:r.round_id,attemptId:r.attempt_id,
   ln:r.ln,lnHalos:r.ln_halos,hn:r.hn,importId:r.import_id,importName:r.import_name,importedAt:r.uploaded_at,chip:r.chip_id,
   internalReportId:r.internal_id,internalState:r.internal_state,downloadName:r.download_name,versionId:r.version_id,versionState:r.version_state,rowVersion:r.row_version,releaseId:r.release_id,hisAttested:r.attested});
 }
 const total=out.length,start=(d.page-1)*d.pageSize;
 return {rows:out.slice(start,start+d.pageSize),page:{number:d.page,size:d.pageSize,total,totalPages:Math.max(1,Math.ceil(total/d.pageSize)),hasNext:start+d.pageSize<total},
  counts:Object.fromEntries((['READY','HOLD','FINAL','RELEASED','NOT_REPORTABLE'] as const).map(s=>[s,out.filter(x=>x.status===s).length])),canFinalize:authorize(user,'result.certify')};
}
/** One immutable PDF per patient, never merged. The ZIP holds only reports still Final; the manifest lists held/failed rows too. */
export async function batchZip(db:Queryable,user:Staff,store:FileStore,batchId:string){
 await assertSession(db,user);need(user,'result.review','read');
 const b=(await db.query<{id:string;outcome:FinalizeOutcome[];created_at:Date;operator_id:string}>('SELECT id,outcome,created_at,operator_id FROM internal_report_batch WHERE id=$1',[uuid.parse(batchId)])).rows[0];if(!b)throw new LabError('NOT_FOUND',404);
 const reports=(await db.query<{id:string;case_id:string;version_id:string|null;state:string;pdf_sha256:string;download_name:string;unit_id:string|null;registration_origin:string}>(
  'SELECT r.id,r.case_id,r.version_id,r.state,r.pdf_sha256,r.download_name,(SELECT s.unit_id FROM case_unit_scope s WHERE s.case_id=r.case_id ORDER BY s.unit_id LIMIT 1) unit_id,c.registration_origin FROM internal_report r JOIN nipt_case c ON c.id=r.case_id WHERE r.batch_id=$1 ORDER BY r.created_at',[b.id])).rows
  .filter(r=>caseVisible(user,{unit_id:r.unit_id,registration_origin:r.registration_origin}));
 const final=reports.filter(r=>r.state==='Final'),names=uniqueNames(final.map(r=>r.download_name));
 const parts=new Map<string,Buffer>(),files:{name:string;zipMember:string;internalReportId:string;versionId:string|null;sha256:string}[]=[];
 for(const [i,r] of final.entries()){
  // ZIP member names stay ASCII for the archive writer; the configured (possibly Thai) name is in the manifest and each download.
  const member=`pdf/${String(i+1).padStart(3,'0')}-${r.id.slice(0,8)}.pdf`;parts.set(member,await store.get(r.pdf_sha256));
  files.push({name:names[i],zipMember:member,internalReportId:r.id,versionId:r.version_id,sha256:r.pdf_sha256});
  await db.query("INSERT INTO result_access_log(actor_id,case_id,version_id,purpose) VALUES($1,$2,$3,'LAB_REVIEW_FILE')",[user.id,r.case_id,r.version_id]);
 }
 const manifest={batchId:b.id,createdAt:b.created_at,operatorId:b.operator_id,files,
  notIncluded:[...b.outcome.filter(o=>o.outcome!=='FINAL').map(o=>({rowId:o.rowId,outcome:o.outcome,code:o.code??null,holds:(o.holds??[]).map(h=>h.code)})),...reports.filter(r=>r.state!=='Final').map(r=>({internalReportId:r.id,outcome:r.state}))]};
 parts.set('manifest.json',Buffer.from(JSON.stringify(manifest,null,2),'utf8'));
 await audit(db,user,'INTERNAL_REPORT_BATCH_DOWNLOADED','INTERNAL_REPORT_BATCH',b.id,{outcome:'ZIP',count:final.length});
 return {bytes:writeArchive(parts),filename:`NIPT-REPORTS-${b.created_at.toISOString().slice(0,10)}-${b.id.slice(0,8)}.zip`,manifest};
}
export async function internalReportFile(db:Queryable,user:Staff,store:FileStore,internalId:string){
 await assertSession(db,user);need(user,'result.review','read');
 const r=(await db.query<{case_id:string;version_id:string|null;pdf_sha256:string;download_name:string;unit_id:string|null;registration_origin:string}>('SELECT r.case_id,r.version_id,r.pdf_sha256,r.download_name,(SELECT s.unit_id FROM case_unit_scope s WHERE s.case_id=r.case_id ORDER BY s.unit_id LIMIT 1) unit_id,c.registration_origin FROM internal_report r JOIN nipt_case c ON c.id=r.case_id WHERE r.id=$1',[uuid.parse(internalId)])).rows[0];
 if(!r||!caseVisible(user,{unit_id:r.unit_id,registration_origin:r.registration_origin}))throw new LabError('NOT_FOUND',404);
 await db.query("INSERT INTO result_access_log(actor_id,case_id,version_id,purpose) VALUES($1,$2,$3,'LAB_REVIEW_FILE')",[user.id,r.case_id,r.version_id]);
 return {bytes:await store.get(r.pdf_sha256),sha256:r.pdf_sha256,name:r.download_name};
}
/** Settings validation: an approval may name a product for a master only if that master is installed with its pinned SHA-256. */
export async function reportMastersInstalled(value:{singletonApprovedProduct:string;twinApprovedProduct:string},db:Queryable|null=null,store:FileStore|null=null){
 for(const [kind,product] of [['SINGLETON',value.singletonApprovedProduct],['TWIN',value.twinApprovedProduct]] as const)if(product!=='NONE'&&!await masterBytes(db,{store:store as unknown as FileStore},kind))return false;
 return true;
}
