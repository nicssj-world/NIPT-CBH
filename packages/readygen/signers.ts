import {z} from 'zod';
import type {Queryable} from '../db/connection';
import type {FileStore} from '../storage';
import {authorize} from '../security/policy';
import {need,assertSession,audit,uuid,reasonText,LabError,type Staff} from '../lab/core';

// Report signers (Reported by / Approved by). A signer submits their own legal name, MT licence and signature image; a different
// administrator verifies it. Applying someone else's stored signature needs that person's own standing delegation, which cites the
// hospital's documented authority. The operator who finalises is always recorded as themselves, never as the signer.
export type SignerRole='REPORTED'|'APPROVED';
const MAX_SIGNATURE_BYTES=512*1024;
/** PNG/JPEG only, decoded dimensions within sane bounds; the image is never scaled or re-encoded. */
export function signatureImage(bytes:Buffer):{media:'image/png'|'image/jpeg';width:number;height:number}{
 if(!bytes.length||bytes.length>MAX_SIGNATURE_BYTES)throw new LabError('SIGNATURE_IMAGE_SIZE_INVALID',422);
 let out:{media:'image/png'|'image/jpeg';width:number;height:number}|null=null;
 if(bytes.subarray(0,8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]))&&bytes.subarray(12,16).toString('latin1')==='IHDR')out={media:'image/png',width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20)};
 else if(bytes[0]===0xff&&bytes[1]===0xd8){for(let i=2;i+9<bytes.length;){if(bytes[i]!==0xff){i++;continue;}const marker=bytes[i+1],len=bytes.readUInt16BE(i+2);
  if(marker>=0xc0&&marker<=0xcf&&![0xc4,0xc8,0xcc].includes(marker)){out={media:'image/jpeg',height:bytes.readUInt16BE(i+5),width:bytes.readUInt16BE(i+7)};break;}i+=2+len;}}
 if(!out)throw new LabError('SIGNATURE_IMAGE_FORMAT_INVALID',422);
 if(out.width<40||out.height<16||out.width>4000||out.height>2000)throw new LabError('SIGNATURE_IMAGE_DIMENSIONS_INVALID',422);
 return out;
}
const eligibleRoleSql=(role:SignerRole)=>role==='APPROVED'
 ?"EXISTS(SELECT 1 FROM role_assignment a WHERE a.user_id=u.id AND a.role='LAB_CERTIFIER' AND a.approved_by IS NOT NULL AND a.effective_from<=now() AND (a.expires_at IS NULL OR a.expires_at>now()))"
 :"EXISTS(SELECT 1 FROM role_assignment a WHERE a.user_id=u.id AND a.role IN ('LAB_STAFF','LAB_CERTIFIER') AND (a.role<>'LAB_CERTIFIER' OR a.approved_by IS NOT NULL) AND a.effective_from<=now() AND (a.expires_at IS NULL OR a.expires_at>now()))";

export async function submitSignerProfile(db:Queryable,user:Staff,store:FileStore,input:{legalName:string;mtLicenseNo:string;signature:Buffer}){
 await assertSession(db,user);
 const d=z.strictObject({legalName:z.string().trim().min(3).max(120).refine(v=>!/[\r\n\0()]/.test(v),'LEGAL_NAME_INVALID'),mtLicenseNo:z.string().trim().regex(/^[0-9]{3,10}$/,'MT_LICENSE_INVALID')}).parse({legalName:input.legalName,mtLicenseNo:input.mtLicenseNo});
 if(!(await db.query(`SELECT 1 FROM app_user u WHERE u.id=$1 AND ${eligibleRoleSql('REPORTED')}`,[user.id])).rows.length)throw new LabError('SIGNER_ROLE_REQUIRED',403);
 const img=signatureImage(input.signature),hash=await store.put(input.signature);
 await db.query("INSERT INTO file_asset(sha256,byte_size,media_type,storage_key) VALUES($1,$2,$3,$4) ON CONFLICT(sha256) DO NOTHING",[hash,input.signature.length,img.media,`sha256/${hash.slice(0,2)}/${hash.slice(2,4)}/${hash}`]);
 await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,75432861))',[user.id]);
 const row=(await db.query<{id:string;version:number}>(`INSERT INTO report_signer_profile(user_id,version,legal_name,mt_license_no,signature_sha256,signature_media,submitted_by)
  VALUES($1,(SELECT COALESCE(max(version),0)+1 FROM report_signer_profile WHERE user_id=$1),$2,$3,$4,$5,$1) RETURNING id,version`,[user.id,d.legalName,d.mtLicenseNo,hash,img.media])).rows[0];
 await audit(db,user,'SIGNER_PROFILE_SUBMITTED','REPORT_SIGNER_PROFILE',row.id,{outcome:'PENDING_VERIFICATION',version:row.version});
 return {id:row.id,version:row.version,state:'PendingVerification'};
}
export async function decideSignerProfile(db:Queryable,user:Staff,input:unknown){
 await assertSession(db,user);
 const d=z.strictObject({profileId:uuid,decision:z.enum(['VERIFY','REVOKE']),reason:reasonText}).parse(input);
 const p=(await db.query<{id:string;user_id:string}>('SELECT id,user_id FROM report_signer_profile WHERE id=$1 FOR UPDATE',[d.profileId])).rows[0];if(!p)throw new LabError('NOT_FOUND',404);
 // Verification is an administrator's check of identity, licence and signature against hospital records; never self-verification.
 if(d.decision==='VERIFY'){need(user,'user.manage');if(p.user_id===user.id)throw new LabError('SECOND_PERSON_REQUIRED',403);}
 else if(p.user_id!==user.id)need(user,'user.manage');
 try{await db.query('INSERT INTO report_signer_profile_event(profile_id,event,reason,actor_id) VALUES($1,$2,$3,$4)',[p.id,d.decision==='VERIFY'?'VERIFIED':'REVOKED',d.reason,user.id]);}
 catch(e){const m=e instanceof Error?e.message:'';if(/SIGNER_VERIFICATION_INVALID|SIGNER_ALREADY_REVOKED/.test(m))throw new LabError(m.match(/SIGNER_[A-Z_]+/)![0],409);throw e;}
 await audit(db,user,d.decision==='VERIFY'?'SIGNER_PROFILE_VERIFIED':'SIGNER_PROFILE_REVOKED','REPORT_SIGNER_PROFILE',p.id,{outcome:d.decision});
 return {profileId:p.id,state:d.decision==='VERIFY'?'Verified':'Revoked'};
}
export async function grantDelegation(db:Queryable,user:Staff,input:unknown){
 await assertSession(db,user);
 const d=z.strictObject({granteeId:uuid,roles:z.array(z.enum(['REPORTED','APPROVED'])).min(1).max(2),authorityReference:z.string().trim().min(8).max(300).refine(v=>!/[\r\n\0]/.test(v)&&!/\d{13}/.test(v),'AUTHORITY_REFERENCE_INVALID'),expiresAt:z.iso.datetime({offset:true}).nullable().default(null)}).parse(input);
 if(d.granteeId===user.id)throw new LabError('DELEGATION_TO_SELF_INVALID',422);
 const mine=await currentProfile(db,user.id);if(!mine)throw new LabError('SIGNER_PROFILE_NOT_VERIFIED',409);
 if(d.roles.includes('APPROVED')&&!(await db.query(`SELECT 1 FROM app_user u WHERE u.id=$1 AND ${eligibleRoleSql('APPROVED')}`,[user.id])).rows.length)throw new LabError('SIGNER_NOT_ELIGIBLE',403);
 if(!(await db.query(`SELECT 1 FROM app_user u WHERE u.id=$1 AND u.enabled AND ${eligibleRoleSql('REPORTED')}`,[d.granteeId])).rows.length)throw new LabError('DELEGATE_NOT_ELIGIBLE',422);
 const row=(await db.query<{id:string}>('INSERT INTO report_signature_delegation(grantor_id,grantee_id,roles,authority_reference,expires_at,created_by) VALUES($1,$2,$3,$4,$5,$1) RETURNING id',[user.id,d.granteeId,[...new Set(d.roles)],d.authorityReference,d.expiresAt])).rows[0];
 await audit(db,user,'SIGNATURE_DELEGATION_GRANTED','REPORT_SIGNATURE_DELEGATION',row.id,{outcome:'GRANTED',count:d.roles.length});
 return {id:row.id};
}
export async function revokeDelegation(db:Queryable,user:Staff,input:unknown){
 await assertSession(db,user);
 const d=z.strictObject({delegationId:uuid,reason:reasonText}).parse(input);
 const r=(await db.query<{grantor_id:string;revoked_at:Date|null}>('SELECT grantor_id,revoked_at FROM report_signature_delegation WHERE id=$1 FOR UPDATE',[d.delegationId])).rows[0];if(!r)throw new LabError('NOT_FOUND',404);
 if(r.grantor_id!==user.id)need(user,'user.manage');if(r.revoked_at)throw new LabError('DELEGATION_ALREADY_REVOKED',409);
 await db.query('UPDATE report_signature_delegation SET revoked_at=clock_timestamp(),revoked_by=$2,revoke_reason=$3 WHERE id=$1',[d.delegationId,user.id,d.reason]);
 await audit(db,user,'SIGNATURE_DELEGATION_REVOKED','REPORT_SIGNATURE_DELEGATION',d.delegationId,{outcome:'REVOKED'});
 return {id:d.delegationId,state:'Revoked'};
}
type Profile={id:string;user_id:string;version:number;legal_name:string;mt_license_no:string;signature_sha256:string;signature_media:'image/png'|'image/jpeg'};
export async function currentProfile(db:Queryable,userId:string){
 return (await db.query<Profile>('SELECT p.* FROM report_signer_profile p WHERE p.user_id=$1 AND task3_signer_profile_current(p.id) LIMIT 1',[userId])).rows[0]??null;
}
export type SignerAuthority={profile:Profile;basis:'SELF'|'STANDING_DELEGATION';delegationId:string|null;authorityReference:string|null;operatorId:string;role:SignerRole;checkedAt:string};
/** Re-evaluated inside the finalising transaction. Missing licence/signature, ineligible role, revoked profile or delegation all refuse. */
export async function signerAuthority(db:Queryable,operator:Staff,signerId:string,role:SignerRole):Promise<SignerAuthority>{
 const signer=(await db.query<{ok:boolean;enabled:boolean}>(`SELECT ${eligibleRoleSql(role)} ok,u.enabled FROM app_user u WHERE u.id=$1`,[uuid.parse(signerId)])).rows[0];
 if(!signer?.enabled||!signer.ok)throw new LabError('SIGNER_NOT_ELIGIBLE',409,{role,signerId});
 const profile=await currentProfile(db,signerId);if(!profile)throw new LabError('SIGNER_PROFILE_NOT_VERIFIED',409,{role,signerId});
 if(!profile.mt_license_no||!profile.signature_sha256)throw new LabError('SIGNER_LICENSE_OR_SIGNATURE_MISSING',409,{role,signerId});
 const checkedAt=(await db.query<{t:Date}>('SELECT clock_timestamp() t')).rows[0].t.toISOString();
 if(signerId===operator.id)return {profile,basis:'SELF',delegationId:null,authorityReference:null,operatorId:operator.id,role,checkedAt};
 const dlg=(await db.query<{id:string;authority_reference:string}>(`SELECT id,authority_reference FROM report_signature_delegation WHERE grantor_id=$1 AND grantee_id=$2 AND $3=ANY(roles)
  AND revoked_at IS NULL AND effective_from<=clock_timestamp() AND (expires_at IS NULL OR expires_at>clock_timestamp()) ORDER BY created_at DESC LIMIT 1`,[signerId,operator.id,role])).rows[0];
 if(!dlg)throw new LabError('SIGNATURE_DELEGATION_REQUIRED',403,{role,signerId});
 return {profile,basis:'STANDING_DELEGATION',delegationId:dlg.id,authorityReference:dlg.authority_reference,operatorId:operator.id,role,checkedAt};
}
/** Searchable selector source: verified signers eligible for the role, with whether the current operator may apply each one. */
export async function listSigners(db:Queryable,user:Staff,input:unknown){
 await assertSession(db,user);need(user,'result.review','read');
 const d=z.strictObject({role:z.enum(['REPORTED','APPROVED']),q:z.string().trim().max(60).default('')}).parse(input);
 const rows=(await db.query<{user_id:string;legal_name:string;mt_license_no:string;display_name:string;delegated:boolean}>(
  `SELECT p.user_id,p.legal_name,p.mt_license_no,u.display_name,EXISTS(SELECT 1 FROM report_signature_delegation g WHERE g.grantor_id=p.user_id AND g.grantee_id=$1 AND $2=ANY(g.roles) AND g.revoked_at IS NULL AND g.effective_from<=clock_timestamp() AND (g.expires_at IS NULL OR g.expires_at>clock_timestamp())) delegated
   FROM report_signer_profile p JOIN app_user u ON u.id=p.user_id WHERE task3_signer_profile_current(p.id) AND ${eligibleRoleSql(d.role)}
   AND ($3='' OR p.legal_name ILIKE '%'||$3||'%' OR u.display_name ILIKE '%'||$3||'%' OR p.mt_license_no LIKE $3||'%') ORDER BY p.legal_name LIMIT 50`,[user.id,d.role,d.q.replace(/[%_\\]/g,'')])).rows;
 return rows.map(r=>({userId:r.user_id,legalName:r.legal_name,license:r.mt_license_no,displayName:r.display_name,usable:r.user_id===user.id||r.delegated,basis:r.user_id===user.id?'SELF':r.delegated?'STANDING_DELEGATION':null}));
}
/** Own profile page, and the administrator's verification queue (only administrators see others' pending images). */
export async function signerOverview(db:Queryable,user:Staff){
 await assertSession(db,user);
 const admin=authorize(user,'user.manage');
 const profiles=(await db.query(`SELECT p.id,p.user_id "userId",u.display_name "displayName",p.version,p.legal_name "legalName",p.mt_license_no "license",p.submitted_at "submittedAt",
   (SELECT e.event FROM report_signer_profile_event e WHERE e.profile_id=p.id ORDER BY e.sequence DESC LIMIT 1) state,task3_signer_profile_current(p.id) current
   FROM report_signer_profile p JOIN app_user u ON u.id=p.user_id WHERE p.user_id=$1 OR $2 ORDER BY p.submitted_at DESC LIMIT 100`,[user.id,admin])).rows;
 const delegations=(await db.query(`SELECT g.id,g.grantor_id "grantorId",gu.display_name grantor,g.grantee_id "granteeId",ge.display_name grantee,g.roles,g.authority_reference "authorityReference",g.effective_from "effectiveFrom",g.expires_at "expiresAt",g.revoked_at "revokedAt"
   FROM report_signature_delegation g JOIN app_user gu ON gu.id=g.grantor_id JOIN app_user ge ON ge.id=g.grantee_id WHERE g.grantor_id=$1 OR g.grantee_id=$1 OR $2 ORDER BY g.created_at DESC LIMIT 100`,[user.id,admin])).rows;
 const candidates=(await db.query(`SELECT u.id,u.display_name "displayName" FROM app_user u WHERE u.enabled AND u.id<>$1 AND ${eligibleRoleSql('REPORTED')} ORDER BY u.display_name LIMIT 200`,[user.id])).rows;
 return {canManage:admin,profiles,delegations,delegateCandidates:candidates};
}
export async function readSignatureImage(db:Queryable,user:Staff,store:FileStore,profileId:string){
 await assertSession(db,user);
 const p=(await db.query<{user_id:string;signature_sha256:string;signature_media:string}>('SELECT user_id,signature_sha256,signature_media FROM report_signer_profile WHERE id=$1',[uuid.parse(profileId)])).rows[0];
 if(!p)throw new LabError('NOT_FOUND',404);if(p.user_id!==user.id)need(user,'user.manage');
 await audit(db,user,'SIGNATURE_IMAGE_VIEWED','REPORT_SIGNER_PROFILE',profileId,{outcome:p.user_id===user.id?'SELF':'ADMIN_VERIFICATION'});
 return {bytes:await store.get(p.signature_sha256),media:p.signature_media};
}
