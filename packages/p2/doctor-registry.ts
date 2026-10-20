import {z} from 'zod';
import {createHash} from 'node:crypto';
import {PDFDocument} from 'pdf-lib';
import type {Queryable} from '../db/connection';
import {appendAudit} from '../db/audit';
import {requirePermission} from '../security/policy';
import {operationalDataEnabled} from '../security/runtime';
import {syntheticText} from './schema';
import {deriveSignature,vectorSchema} from './signature';
import {assertStaff,P2Error,type Staff} from './service';

const imageSchema=z.strictObject({mime:z.enum(['image/png','image/jpeg']),data:z.string().max(700000).regex(/^[A-Za-z0-9+/]+={0,2}$/)});
export async function uploadedDoctorSignature(input:unknown){
 const image=imageSchema.parse(input),bytes=Buffer.from(image.data,'base64');
 if(bytes.length>512*1024||bytes.toString('base64')!==image.data)throw new P2Error('SIGNATURE_IMAGE_INVALID',422);
 const png=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
 if(image.mime==='image/png'?!png:!bytes.subarray(0,3).equals(Buffer.from([255,216,255])))throw new P2Error('SIGNATURE_IMAGE_INVALID',422);
 if(png&&(bytes.length<24||bytes.readUInt32BE(16)>2400||bytes.readUInt32BE(20)>1600))throw new P2Error('SIGNATURE_IMAGE_SIZE',422);
 try{const doc=await PDFDocument.create(),embedded=await (png?doc.embedPng(bytes):doc.embedJpg(bytes));if(embedded.width<1||embedded.height<1||embedded.width>2400||embedded.height>1600)throw Error('size');await doc.save();}catch{throw new P2Error('SIGNATURE_IMAGE_INVALID',422);}
 return {vector:{source:'upload',mime:image.mime},png:image.data,hash:createHash('sha256').update(bytes).digest('hex')};
}
const saveSchema=z.strictObject({action:z.literal('save'),id:z.uuid().optional(),doctorKey:z.string().max(64).refine(v=>operationalDataEnabled()?/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(v):/^SYNTHETIC-[A-Z0-9-]+$/.test(v)),name:syntheticText.refine(v=>v.length>0),unitId:z.uuid(),authorization:syntheticText.refine(v=>v.length>0).default(()=>operationalDataEnabled()?'DOCTOR_AUTHORIZATION_CONFIRMED':'SYNTHETIC_AUTHORIZATION_CONFIRMED'),authorized:z.literal(true),vector:vectorSchema.optional(),image:imageSchema.optional()});
/** Append a new immutable record; existing Request/Consent snapshots retain their prior signature bytes. */
export async function saveDoctor(db:Queryable,user:Staff,input:unknown){
 await assertStaff(db,user);requirePermission(user,'doctor.manage',{},'write');const d=saveSchema.parse(input);
 if(!user.roles.includes('APP_ADMIN')&&!user.unitIds.includes(d.unitId))throw new P2Error('FORBIDDEN',403);
 await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,75432803))',[d.doctorKey]);
 const prior=(await db.query<{id:string;doctor_key:string;unit_id:string;signature:unknown;signature_png:string;signature_hash:string;version:number}>('SELECT * FROM p2_doctor_version WHERE doctor_key=$1 ORDER BY version DESC LIMIT 1',[d.doctorKey])).rows[0];
 if(d.id?(!prior||prior.id!==d.id):!!prior)throw new P2Error('DOCTOR_RECORD_CHANGED',409);
 if(prior&&prior.unit_id!==d.unitId)throw new P2Error('DOCTOR_UNIT_CHANGE_DENIED',409);
 if(d.image&&d.vector)throw new P2Error('SIGNATURE_IMAGE_INVALID',422);
 const sig=d.image?await uploadedDoctorSignature(d.image):d.vector?deriveSignature(d.vector):prior?{vector:prior.signature,png:prior.signature_png,hash:prior.signature_hash}:null;
 if(!sig)throw new P2Error('DOCTOR_SIGNATURE_REQUIRED',422);
 const row=(await db.query<{id:string;version:number}>('INSERT INTO p2_doctor_version(doctor_key,version,name,unit_id,effective_from,authorization_evidence,signature,signature_png,signature_hash,created_by,synthetic) VALUES($1,$2,$3,$4,clock_timestamp(),$5,$6,$7,$8,$9,$10) RETURNING id,version',[d.doctorKey,(prior?.version??0)+1,d.name,d.unitId,d.authorization,sig.vector,sig.png,sig.hash,user.id,!operationalDataEnabled()])).rows[0];
 await db.query('INSERT INTO p2_doctor_registration(doctor_version_id,actor_id,authorized) VALUES($1,$2,true)',[row.id,user.id]);
 await db.query("INSERT INTO p2_doctor_event(doctor_version_id,event_type,actor_id,reason) VALUES($1,'Approved',$2,'REGISTRY_SAVED_WITH_AUTHORIZATION')",[row.id,user.id]);
 await appendAudit(db,{actorId:user.id,action:'P2_DOCTOR_SAVED_DIRECTLY',resourceType:'p2_doctor_version',resourceId:row.id,details:{version:row.version,synthetic:!operationalDataEnabled()}});
 return {...row,status:'Approved'};
}
