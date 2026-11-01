import type {Parsed} from '../results/parser';
import {verifyPdfIdentity,currentPatientNames,type PdfIdentityEvidence} from './pdf-identity';
export type MigrationPdfTarget={recordId:string;caseId:string;roundId:string;attemptId:string;ln:string;lnHalos:string;sampleRaw:string;attemptNumber:number;hn:string|null;current:boolean;qualified:boolean;patientName?:string|null};
/**
 * Content selects at most one current Qualified attempt: the printed sample ID with its attempt suffix plus the HN, so a base ID can never pick a
 * later repeat. The owner-confirmed file name (HIS LN + name) and the PDF's printed name must then agree with the HIS LN and the PET patient name.
 */
export function matchMigrationPdf(parsed:Parsed,targets:MigrationPdfTarget[],fileName:string|null){
 const lab=parsed.identifiers.labNumber.value,hn=parsed.identifiers.hn.value;
 const candidates=targets.filter(t=>t.current&&t.qualified&&lab===t.sampleRaw.trim()&&!!hn&&!!t.hn&&hn.replace(/^0+/,'')===t.hn.replace(/^0+/,''));
 if(candidates.length!==1)return {match:null as MigrationPdfTarget|null,identity:null as PdfIdentityEvidence|null,reason:candidates.length>1?'AMBIGUOUS_PDF_IDENTITY':'PDF_IDENTITY_OR_ATTEMPT_UNRESOLVED'};
 const identity=verifyPdfIdentity({fileName,pdfName:parsed.identifiers.patientName.value,target:{ln:candidates[0].ln,patientName:candidates[0].patientName??null}});
 if(identity.status!=='MATCH')return {match:null,identity,reason:identity.status==='CONFLICT'?'PDF_IDENTITY_CONFLICT':'PDF_IDENTITY_UNVERIFIED'};
 return {match:candidates[0],identity,reason:'EXACT_CONTENT_IDENTITY'};
}
import type {Queryable} from '../db/connection';
import type {FileStore} from '../storage';
import {assertSession,caseVisible,LabError,need,type Staff} from '../lab/core';
import {registerIntake,parseIntake} from '../results/intake';
export async function migrationPdfTargets(db:Queryable){
 const rows=(await db.query<MigrationPdfTarget&{unit_id:string|null;registration_origin:string}>(`SELECT m.id "recordId",m.case_id "caseId",m.round_id "roundId",m.attempt_id "attemptId",m.ln,m.ln_halos "lnHalos",a.sample_raw "sampleRaw",a.attempt_number "attemptNumber",i.hn,(a.is_current AND c.current_round_id=m.round_id) current,(a.advice_status='QUALIFIED') qualified,c.registration_origin,(SELECT s.unit_id FROM case_unit_scope s WHERE s.case_id=c.id ORDER BY s.unit_id LIMIT 1) unit_id
 FROM migration_record m JOIN migration_analysis a ON a.record_id=m.id AND a.attempt_id=m.attempt_id JOIN nipt_case c ON c.id=m.case_id JOIN p2_case_identity i ON i.case_id=m.case_id WHERE m.state='IMPORTED' AND a.is_current AND a.classification='ANALYSIS'`)).rows;
 const names=await currentPatientNames(db,rows.map(r=>r.caseId));
 return rows.map(r=>({...r,patientName:names.get(r.caseId)??null}));
}
/** Existing immutable intake/quarantine/parser/version ledger, one row outcome per PDF/ZIP member. Never releases. */
export async function ingestMigrationPdfs(db:Queryable,user:Staff,store:FileStore,files:{name:string;bytes:Buffer}[]){
 await assertSession(db,user);need(user,'result.import');
 if(files.length<1||files.length>20)throw new LabError('FILE_COUNT_INVALID',422);
 const {resultSettings,limitsOf,confirmImport,autoLinkUnique}=await import('../results/service');
 const limits=limitsOf(await resultSettings(db)),targets=await migrationPdfTargets(db);
 const rows:{intakeId?:string;file:string;state:string;reason:string;identity?:PdfIdentityEvidence['checks']|null;versionId?:string;match:MigrationPdfTarget|null}[]=[];
 for(const file of files){
  await db.query('SAVEPOINT migration_pdf_file');
  try{
   if(file.bytes.length>limits.maxBytes)throw new LabError('FILE_TOO_LARGE',422);
   const root=await registerIntake(db,store,{source:'UPLOAD',relativePath:null,originalName:file.name,actorId:user.id,jobId:null},file.bytes);
   await parseIntake(db,store,root,limits);
   const intakes=(await db.query<{id:string;original_name:string;member_name:string|null;state:string;container:string|null;parsed:Parsed|null;reject_code:string|null;sha256:string}>("SELECT id,original_name,member_name,state,container,parsed,reject_code,sha256 FROM result_intake_file WHERE (id=$1 OR parent_id=$1) AND actor_id=$2 AND container IS DISTINCT FROM 'ZIP_BATCH' ORDER BY created_at,member_name",[root,user.id])).rows;
   for(const intake of intakes){
    const matched=intake.parsed?matchMigrationPdf(intake.parsed,targets,intake.member_name??intake.original_name):{match:null,identity:null,reason:intake.reject_code??intake.state};
    const visible=matched.match&&targets.find(t=>t.recordId===matched.match?.recordId);
    const match=visible&&caseVisible(user,visible)?matched.match:null;
    const row={intakeId:intake.id,file:intake.member_name??intake.original_name,state:intake.state,reason:match?matched.reason:matched.match?'PDF_IDENTITY_OR_ATTEMPT_UNRESOLVED':matched.reason,identity:matched.identity?.checks??null,match,versionId:undefined as string|undefined};
    if(match&&intake.state==='Parsed'){
     const conflict=(await db.query(`SELECT 1 FROM result_report_version v WHERE (v.case_id,v.round_id,v.attempt_id)=($1,$2,$3) AND v.sha256<>$4 AND v.state NOT IN ('Superseded','Voided') LIMIT 1`,[match.caseId,match.roundId,match.attemptId,intake.sha256])).rows.length>0;
     if(conflict){
      await db.query(`UPDATE migration_record SET exceptions=exceptions||jsonb_build_array(jsonb_build_object('code','CONFLICTING_OFFICIAL_PDFS','severity','REVIEW_BEFORE_RELEASE')),row_version=row_version+1 WHERE id=$1 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(exceptions) e WHERE e->>'code'='CONFLICTING_OFFICIAL_PDFS')`,[match.recordId]);
      await db.query("INSERT INTO migration_record_event(record_id,actor_id,event,details) VALUES($1,$2,'PDF_CONFLICT_DETECTED',$3)",[match.recordId,user.id,{intakeId:intake.id}]);
      row.reason='CONFLICTING_OFFICIAL_PDFS';rows.push(row);continue;
     }
     await db.query('SAVEPOINT migration_pdf_confirm');
     try{const imported=(await confirmImport(db,user,{intakeIds:[intake.id]}))[0];row.versionId=imported.versionId;row.state=imported.outcome;if(imported.versionId&&imported.outcome==='Unlinked'){const linked=await autoLinkUnique(db,user,imported.versionId,{migrationOnly:true});if(linked.linked)row.state=linked.version.state;else row.reason=linked.reason;}}
     catch(e){await db.query('ROLLBACK TO SAVEPOINT migration_pdf_confirm');row.reason=e instanceof Error?e.message:'IMPORT_REVIEW_REQUIRED';}
     await db.query('RELEASE SAVEPOINT migration_pdf_confirm');
    }
    rows.push(row);
   }
   await db.query('RELEASE SAVEPOINT migration_pdf_file');
  }catch(e){await db.query('ROLLBACK TO SAVEPOINT migration_pdf_file');await db.query('RELEASE SAVEPOINT migration_pdf_file');rows.push({file:file.name,state:'Rejected',reason:e instanceof Error?e.message:'PDF_INTAKE_FAILED',match:null});}
 }
 return {rows,imported:rows.filter(r=>r.versionId).length,reviewRequired:rows.filter(r=>!r.versionId).length,released:0 as const};
}
