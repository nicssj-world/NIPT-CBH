import {z} from 'zod';
import type {Queryable} from '../db/connection';
import {appendAudit} from '../db/audit';
import {assertStaff,type Staff} from '../p2/service';
import {uploadedDoctorSignature} from '../p2/doctor-registry';
const image=z.strictObject({mime:z.enum(['image/png','image/jpeg']),data:z.string().max(700000)});
const input=z.strictObject({version:z.number().int().positive(),displayName:z.string().trim().min(1).max(120),phone:z.string().trim().max(40).regex(/^[0-9+().\s-]*$/),jobPosition:z.string().trim().max(120),image:image.optional()});
export async function readOwnProfile(db:Queryable,user:Staff){
 await assertStaff(db,user);
 const p=(await db.query<{username:string;display_name:string;phone:string;job_position:string;version:number;unit_name:string|null;personal_signature:{mime:string;data:string;hash:string}|null}>('SELECT u.username,u.display_name,u.phone,u.job_position,u.version,d.name unit_name,u.personal_signature FROM app_user u LEFT JOIN unit d ON d.id=u.unit_id WHERE u.id=$1 AND u.enabled',[user.id])).rows[0];
 if(!p)throw Error('UNAUTHENTICATED');
 return {id:user.id,username:p.username,displayName:p.display_name,phone:p.phone,jobPosition:p.job_position,version:p.version,unit:p.unit_name,roles:user.roles,permissions:user.permissions,signature:p.personal_signature};
}
export async function saveOwnProfile(db:Queryable,user:Staff,value:unknown){
 await assertStaff(db,user);const d=input.parse(value);
 const current=(await db.query<{version:number}>('SELECT version FROM app_user WHERE id=$1 AND enabled FOR UPDATE',[user.id])).rows[0];
 if(!current)throw Error('UNAUTHENTICATED');if(current.version!==d.version)throw Error('STALE_VERSION');
 const signature=d.image?{...d.image,hash:(await uploadedDoctorSignature(d.image)).hash}:null;
 await db.query('UPDATE app_user SET display_name=$2,phone=$3,job_position=$4,personal_signature=COALESCE($5::jsonb,personal_signature),version=version+1 WHERE id=$1',[user.id,d.displayName,d.phone,d.jobPosition,signature?JSON.stringify(signature):null]);
 await appendAudit(db,{actorId:user.id,action:'OWN_PROFILE_UPDATED',resourceType:'USER',resourceId:user.id,details:{version:d.version+1}});
 return readOwnProfile(db,user);
}
