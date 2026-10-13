import {createHash} from 'node:crypto';
import {z} from 'zod';
import type {Queryable} from '../db/connection';
import type {FileStore} from '../storage';
import {LabError,assertSession,need,audit,uuid,reasonText,type Staff} from '../lab/core';
import {extract,screen,QuarantineError} from './extract';
import {parseReport,PARSER_VERSION,type Parsed} from './parser';
import {resultSettings,limitsOf} from './service';

const requestSchema=z.strictObject({versionId:uuid,reason:reasonText,idempotencyKey:uuid});
type Evidence={id:string;version_id:string;source_sha256:string;actor_id:string;reason:string;parser_version:string;outcome:string;parsed:Parsed|null;reject_code:string|null;request_sha256:string;created_at:Date};
const response=(e:Evidence)=>({id:e.id,versionId:e.version_id,sourceSha256:e.source_sha256,parserVersion:e.parser_version,outcome:e.outcome,rejectCode:e.reject_code,createdAt:e.created_at,promoted:false as const});
/** Maintenance can spend time extracting a PDF: check wall-clock expiry and live role, not transaction-start now(). */
async function activeMaintenance(db:Queryable,user:Staff){
 if(!user.sessionId)throw new LabError('UNAUTHENTICATED',401);
 await assertSession(db,user);need(user,'result.review','read');need(user,'result.revise','approve');if(!user.roles.includes('LAB_CERTIFIER'))throw new LabError('FORBIDDEN',403);
 const s=(await db.query<{active:boolean;enabled:boolean;certifier:boolean}>(`SELECT s.revoked_at IS NULL AND NOT s.signing_suspended AND s.idle_expires_at>clock_timestamp() AND s.absolute_expires_at>clock_timestamp() active,
 u.enabled,EXISTS(SELECT 1 FROM role_assignment r WHERE r.user_id=u.id AND r.role='LAB_CERTIFIER' AND r.effective_from<=clock_timestamp() AND (r.expires_at IS NULL OR r.expires_at>clock_timestamp())) certifier
 FROM app_session s JOIN app_user u ON u.id=s.user_id WHERE s.id=$1 AND s.user_id=$2`,[user.sessionId,user.id])).rows[0];
 if(!s?.active||!s.enabled)throw new LabError('UNAUTHENTICATED',401);if(!s.certifier)throw new LabError('FORBIDDEN',403);
}
export async function reparseHistory(db:Queryable,user:Staff,id:string){
 await activeMaintenance(db,user);
 const version=(await db.query(`SELECT 1 FROM result_report_version v LEFT JOIN nipt_case c ON c.id=v.case_id WHERE v.id=$1 AND v.synthetic AND (v.case_id IS NULL OR c.registration_origin<>'HISTORICAL')`,[uuid.parse(id)])).rows[0];if(!version)throw new LabError('NOT_FOUND',404);
 return (await db.query<Evidence>('SELECT * FROM result_reparse_evidence WHERE version_id=$1 ORDER BY created_at DESC,id DESC LIMIT 50',[uuid.parse(id)])).rows.map(e=>({...response(e),reason:e.reason,actorId:e.actor_id,parsed:e.parsed}));
}
/** Explicit certifier maintenance of immutable bytes. Diagnostic output is never a replacement clinical report. */
export async function reparseResult(db:Queryable,user:Staff,store:FileStore,input:unknown){
 await activeMaintenance(db,user);
 const d=requestSchema.parse(input),fingerprint=createHash('sha256').update(JSON.stringify({...d,parserVersion:PARSER_VERSION})).digest('hex');
 await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`p7-reparse:${user.id}:${d.idempotencyKey}`]);
 const prior=(await db.query<Evidence>('SELECT * FROM result_reparse_evidence WHERE actor_id=$1 AND idempotency_key=$2',[user.id,d.idempotencyKey])).rows[0];
 if(prior){if(prior.request_sha256!==fingerprint)throw new LabError('IDEMPOTENCY_KEY_REUSED',409);return response(prior);}
 const v=(await db.query<{id:string;sha256:string;name:string;historical:boolean}>(`SELECT v.id,v.sha256,coalesce(i.member_name,i.original_name) name,
 coalesce(c.registration_origin='HISTORICAL',false) historical FROM result_report_version v JOIN result_intake_file i ON i.id=v.intake_file_id LEFT JOIN nipt_case c ON c.id=v.case_id WHERE v.id=$1 AND v.synthetic`,[d.versionId])).rows[0];
 if(!v||v.historical)throw new LabError('NOT_FOUND',404);
 let parsed:Parsed|null=null,rejectCode:string|null=null;
 const limits=limitsOf(await resultSettings(db));
 let bytes:Buffer|undefined;
 try{bytes=await store.get(v.sha256);}catch(e){rejectCode=e instanceof Error&&e.message==='HASH_MISMATCH'?'ORIGINAL_HASH_MISMATCH':'ORIGINAL_UNREADABLE';}
 if(bytes)try{screen(bytes,limits.maxBytes);const extracted=await extract(bytes);if(extracted.container==='ZIP_BATCH')throw new QuarantineError('BATCH_REPARSE_PROHIBITED');parsed=parseReport(extracted.text,v.name);}catch(e){if(!(e instanceof QuarantineError))throw e;rejectCode=e.message;}
 // Assert again after extraction: a revoked/suspended session cannot finish a maintenance action.
 await activeMaintenance(db,user);
 const row=(await db.query<Evidence>(`INSERT INTO result_reparse_evidence(version_id,source_sha256,actor_id,session_id,reason,idempotency_key,request_sha256,parser_version,template_version,outcome,parsed,reject_code)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,[v.id,v.sha256,user.id,user.sessionId,d.reason,d.idempotencyKey,fingerprint,PARSER_VERSION,parsed?.templateVersion??null,parsed?'PARSED_DIAGNOSTIC':'REJECTED_DIAGNOSTIC',parsed?JSON.stringify(parsed):null,rejectCode])).rows[0];
 await audit(db,user,'RESULT_DIAGNOSTIC_REPARSED','RESULT_REPARSE',row.id,{outcome:row.outcome,version:PARSER_VERSION});
 return response(row);
}
