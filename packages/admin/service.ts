import {z} from 'zod';
import type {Queryable} from '../db/connection';
import {appendAudit,safeDetails} from '../db/audit';
import {authorize,requirePermission,ROLES,type Principal,type Role} from '../security/policy';
export function canReadAdministration(user:Principal){return authorize(user,'user.manage',{},'read')||authorize(user,'user.manage',{},'approve');}
export function requireAdministrationRead(user:Principal){if(!canReadAdministration(user))throw Error('FORBIDDEN');}
import {hashPassword,verifyPassword} from '../security/password';
import {token,LOCKOUT_MS} from '../security/session';
export const SENSITIVE_ROLES:readonly Role[]=['APP_ADMIN','CLINICAL_APPROVER','LAB_CERTIFIER','IT_OPERATOR','HISTORICAL_VERIFIER'];
export type Actor=Principal&{sessionId?:string};

const uuid=z.uuid(),version=z.number().int().positive();
const username=z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{3,64}$/);
const name=z.string().trim().min(1).max(120);
const optionalPermissions=['ANC_VIEW_ALL_UNITS','HISTORICAL_ENTRY'] as const;
const access=z.object({operation:z.literal('requestAccess'),id:uuid,version,roles:z.array(z.enum(ROLES)).max(9),unitIds:z.array(uuid).max(100),permissions:z.array(z.enum(optionalPermissions)).max(2),reason:z.string().trim().min(1).max(250)}).strict();
const command=z.discriminatedUnion('operation',[
 z.object({operation:z.literal('saveUser'),id:uuid.optional(),version:version.optional(),username,displayName:name,password:z.string().max(128).optional(),jobPosition:z.string().trim().max(120).default(''),phone:z.string().trim().max(40).regex(/^[0-9+().\s-]*$/).default(''),unitId:uuid.nullable(),enabled:z.boolean(),roles:z.array(z.enum(ROLES)).min(1).max(9),unitIds:z.array(uuid).max(100),permissions:z.array(z.enum(optionalPermissions)).max(2)}).strict(),
 z.object({operation:z.literal('createUser'),username,displayName:name,password:z.string().max(128),unitId:uuid.nullable().optional()}).strict(),
 z.object({operation:z.literal('updateUser'),id:uuid,version,username,displayName:name,unitId:uuid.nullable(),enabled:z.boolean()}).strict(),
 z.object({operation:z.literal('resetPassword'),id:uuid,version,password:z.string().max(128)}).strict(),
 z.object({operation:z.literal('requestPasswordReset'),id:uuid,version,reason:z.string().trim().min(1).max(250)}).strict(),
 z.object({operation:z.literal('unlockUser'),id:uuid,version}).strict(),access,
 z.object({operation:z.enum(['approveAccess','rejectAccess']),id:uuid}).strict(),
 z.object({operation:z.literal('saveUnit'),id:uuid.optional(),version:version.optional(),code:z.string().trim().regex(/^[A-Za-z0-9._-]{1,40}$/),name,active:z.boolean()}).strict()
]);
export type AdminUser={id:string;username:string;display_name:string;job_position:string;phone:string;enabled:boolean;locked_until:Date|null;created_at:Date;last_login_at:Date|null;must_change_password:boolean;unit_id:string|null;unit_name:string|null;version:number;roles:Role[];unit_ids:string[];permissions:string[];requires_independent_recovery:boolean};
const userColumns=`u.id,u.username,u.display_name,u.job_position,u.phone,u.enabled,u.locked_until,u.created_at,u.last_login_at,u.must_change_password,u.unit_id,u.version,d.name unit_name,
 coalesce((SELECT jsonb_agg(a.role ORDER BY a.role) FROM role_assignment a WHERE a.user_id=u.id AND a.effective_from<=now() AND (a.expires_at IS NULL OR a.expires_at>now())),'[]') roles,
 coalesce((SELECT jsonb_agg(s.unit_id) FROM user_unit_scope s WHERE s.user_id=u.id),'[]') unit_ids,
 coalesce((SELECT jsonb_agg(p.permission) FROM user_permission p WHERE p.user_id=u.id),'[]') permissions,EXISTS(SELECT 1 FROM role_assignment f WHERE f.user_id=u.id AND f.role IN ('APP_ADMIN','CLINICAL_APPROVER','LAB_CERTIFIER','IT_OPERATOR','HISTORICAL_VERIFIER') AND (f.expires_at IS NULL OR f.expires_at>clock_timestamp())) requires_independent_recovery`;
const filters=z.object({search:z.string().max(120).default(''),page:z.coerce.number().int().min(1).max(100000).default(1),status:z.enum(['','Active','Disabled','Locked']).default(''),role:z.union([z.enum(ROLES),z.literal('')]).default(''),action:z.string().max(80).default(''),outcome:z.string().max(80).default(''),resourceId:uuid.optional()});
export async function listUsers(db:Queryable,user:Principal,input:unknown={}){
 requireAdministrationRead(user);const f=filters.parse(input),where=`($1='' OR u.username ILIKE $1 OR u.display_name ILIKE $1) AND ($2='' OR ($2='Disabled' AND NOT u.enabled) OR ($2='Locked' AND u.enabled AND u.locked_until>now()) OR ($2='Active' AND u.enabled AND (u.locked_until IS NULL OR u.locked_until<=now()))) AND ($3='' OR EXISTS(SELECT 1 FROM role_assignment r WHERE r.user_id=u.id AND r.role=$3 AND r.effective_from<=now() AND (r.expires_at IS NULL OR r.expires_at>now())))`;
 const values=[f.search?`%${f.search}%`:'',f.status,f.role];
 const rows=await db.query<AdminUser>(`SELECT ${userColumns} FROM app_user u LEFT JOIN unit d ON d.id=u.unit_id WHERE ${where} ORDER BY u.username LIMIT 20 OFFSET $4`,[...values,(f.page-1)*20]);
 const count=(await db.query<{count:string}>(`SELECT count(*)::text count FROM app_user u WHERE ${where}`,values)).rows[0];
 return {rows:rows.rows,total:Number(count.count),page:f.page};
}
export async function listUnits(db:Queryable,user:Principal,input:unknown={}){
 requireAdministrationRead(user);const f=filters.parse(input);
 const where=`($1='' OR code ILIKE $1 OR name ILIKE $1)`;const search=f.search?`%${f.search}%`:'';
 return {rows:(await db.query<{id:string;code:string;name:string;active:boolean;version:number}>(`SELECT id,code,name,active,version FROM unit WHERE ${where} ORDER BY code LIMIT 20 OFFSET $2`,[search,(f.page-1)*20])).rows,total:Number((await db.query<{count:string}>(`SELECT count(*)::text count FROM unit WHERE ${where}`,[search])).rows[0].count),page:f.page};
}
export async function activeUnits(db:Queryable,ids:string[]){if(new Set(ids).size!==ids.length)throw Error('DUPLICATE_UNIT');for(const id of ids)if(!(await db.query('SELECT id FROM unit WHERE id=$1 AND active',[id])).rows[0])throw Error('ACTIVE_UNIT_REQUIRED');}
async function unitHasReferences(db:Queryable,id:string,code:string){
 const refs=(await db.query<{schema_name:string;table_name:string;column_name:string;target_column:string}>(`SELECT n.nspname schema_name,t.relname table_name,a.attname column_name,b.attname target_column FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=c.conkey[1] JOIN pg_attribute b ON b.attrelid=c.confrelid AND b.attnum=c.confkey[1] WHERE c.contype='f' AND c.confrelid='unit'::regclass`)).rows;
 const quote=(s:string)=>'"'+s.replaceAll('"','""')+'"';
 for(const r of refs)if((await db.query(`SELECT 1 FROM ${quote(r.schema_name)}.${quote(r.table_name)} WHERE ${quote(r.column_name)}::text=$1 LIMIT 1`,[r.target_column==='code'?code:id])).rows.length)return true;
 return !!(await db.query('SELECT 1 FROM admin_access_request WHERE unit_ids @> $1::jsonb LIMIT 1',[JSON.stringify([id])])).rows.length;
}
async function assertLiveSession(db:Queryable,user:Actor){if(user.sessionId&&!((await db.query('SELECT id FROM app_session WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL AND NOT signing_suspended AND idle_expires_at>clock_timestamp() AND absolute_expires_at>clock_timestamp()',[user.sessionId,user.id])).rows[0]))throw Error('UNAUTHENTICATED');}
async function liveActor(db:Queryable,user:Actor){
 const u=(await db.query<{enabled:boolean;must_change_password:boolean}>('SELECT enabled,must_change_password FROM app_user WHERE id=$1 FOR UPDATE',[user.id])).rows[0];
 if(!u?.enabled||u.must_change_password)throw Error('FORBIDDEN');
 await assertLiveSession(db,user);
 const roles=(await db.query<{role:Role}>("SELECT role FROM role_assignment WHERE user_id=$1 AND effective_from<=clock_timestamp() AND (expires_at IS NULL OR expires_at>clock_timestamp())",[user.id])).rows.map(x=>x.role);
 return {...user,roles};
}
async function lockUserSessions(db:Queryable,id:string){await db.query('SELECT id FROM app_session WHERE user_id=$1 AND revoked_at IS NULL ORDER BY id FOR UPDATE NOWAIT',[id]);}
export async function revokeUserSessions(db:Queryable,id:string){await lockUserSessions(db,id);const sessions=await db.query<{id:string}>('UPDATE app_session SET revoked_at=clock_timestamp() WHERE user_id=$1 AND revoked_at IS NULL RETURNING id',[id]);const {clearDocumentSession}=await import('../p2/documents');for(const s of sessions.rows)clearDocumentSession(s.id);}
async function audit(db:Queryable,user:Principal,action:string,id:string,resourceType='USER'){await appendAudit(db,{actorId:user.id,action,resourceType,resourceId:id,details:{outcome:'SUCCESS'}});}
/** Caller owns BEGIN/COMMIT: serialization covers approvals, reset and last-admin protection. */
export async function adminCommand(db:Queryable,principal:Actor,input:unknown):Promise<{id:string;state?:string}> {
 const c=command.parse(input);
 await db.query('SELECT pg_advisory_xact_lock(75432806)');
 const actor=await liveActor(db,principal);
 requirePermission(actor,'user.manage',{},c.operation==='approveAccess'||c.operation==='rejectAccess'?'approve':'write');
 if(c.operation==='saveUser'){
  if(!actor.roles.includes('APP_ADMIN'))throw Error('FORBIDDEN');
  if(new Set(c.roles).size!==c.roles.length||new Set(c.permissions).size!==c.permissions.length)throw Error('DUPLICATE_ACCESS');
  // An administrator explicitly assigning an ANC role and primary unit grants
  // that unit through the existing scope table; no implicit cross-unit rights.
  if(c.unitId&&c.roles.some(r=>r==='ANC_NURSE'||r==='ANC_SUPERVISOR')&&!c.unitIds.includes(c.unitId))c.unitIds.push(c.unitId);
  await activeUnits(db,c.unitIds);if(c.unitId)await activeUnits(db,[c.unitId]);
  if(c.roles.some(r=>r==='ANC_NURSE'||r==='ANC_SUPERVISOR')&&!c.unitIds.length)throw Error('ANC_UNIT_SCOPE_REQUIRED');
  let id=c.id;
  if(id){
   const old=(await db.query<{version:number}>('SELECT version FROM app_user WHERE id=$1 FOR UPDATE',[id])).rows[0];
   if(!old||old.version!==c.version)throw Error('STALE_VERSION');
   await ensureAdminRemains(db,id,c.enabled?c.roles:[]);
   await revokeUserSessions(db,id);
   await db.query('UPDATE app_user SET username=$2,display_name=$3,job_position=$4,phone=$5,unit_id=$6,enabled=$7,version=version+1 WHERE id=$1',[id,c.username,c.displayName,c.jobPosition,c.phone,c.unitId,c.enabled]);
  }else{
   const hash=await hashPassword(c.password??'');
   id=(await db.query<{id:string}>('INSERT INTO app_user(username,display_name,password_hash,job_position,phone,unit_id,enabled,must_change_password) VALUES($1,$2,$3,$4,$5,$6,$7,true) RETURNING id',[c.username,c.displayName,hash,c.jobPosition,c.phone,c.unitId,c.enabled])).rows[0].id;
  }
  await db.query('INSERT INTO admin_access_supersession(request_id,actor_id) SELECT id,$2 FROM admin_access_request WHERE user_id=$1 AND kind=\'ACCESS\' AND state IN (\'Pending\',\'AwaitingEnrollment\') ON CONFLICT DO NOTHING',[id,actor.id]);
  await db.query('DELETE FROM role_assignment WHERE user_id=$1',[id]);
  for(const role of c.roles)await db.query('INSERT INTO role_assignment(user_id,role,approved_by) VALUES($1,$2,$3)',[id,role,actor.id]);
  await db.query('DELETE FROM user_unit_scope WHERE user_id=$1',[id]);for(const unit of c.unitIds)await db.query('INSERT INTO user_unit_scope(user_id,unit_id) VALUES($1,$2)',[id,unit]);
  await db.query('DELETE FROM user_permission WHERE user_id=$1',[id]);for(const permission of c.permissions)await db.query('INSERT INTO user_permission(user_id,permission,approved_by) VALUES($1,$2,$3)',[id,permission,actor.id]);
  await audit(db,actor,c.id?'USER_ACCESS_ASSIGNED_DIRECTLY':'USER_CREATED_WITH_ACCESS',id);
  return {id};
 }
 if(c.operation==='saveUnit'){
  let id=c.id;
  if(id){const old=(await db.query<{code:string;version:number}>('SELECT code,version FROM unit WHERE id=$1 FOR UPDATE',[id])).rows[0];if(!old||old.version!==c.version)throw Error('STALE_VERSION');
   // Inspect every current FK plus immutable pending scope requests. Used codes
   // retain their external identity; a genuinely unused unit may be corrected.
   if(old.code!==c.code&&await unitHasReferences(db,id,old.code))throw Error('UNIT_CODE_IN_USE');
   await db.query('UPDATE unit SET name=$2,active=$3,version=version+1,code=$4 WHERE id=$1',[id,c.name,c.active,c.code]);
  }else id=(await db.query<{id:string}>('INSERT INTO unit(code,name,active) VALUES($1,$2,$3) RETURNING id',[c.code,c.name,c.active])).rows[0].id;
  await audit(db,actor,'UNIT_SAVED',id,'UNIT');return {id};
 }
 if(c.operation==='createUser'){
  if(c.unitId)await activeUnits(db,[c.unitId]);const hash=await hashPassword(c.password);
  const id=(await db.query<{id:string}>('INSERT INTO app_user(username,display_name,password_hash,unit_id,must_change_password) VALUES($1,$2,$3,$4,true) RETURNING id',[c.username,c.displayName,hash,c.unitId??null])).rows[0].id;
  await audit(db,actor,'USER_CREATED',id);return {id};
 }
 if(c.operation==='approveAccess'||c.operation==='rejectAccess'){
  if((await db.query('SELECT 1 FROM admin_access_supersession WHERE request_id=$1',[c.id])).rows.length)throw Error('ACCESS_REQUEST_SUPERSEDED');
  const r=(await db.query<{user_id:string;created_by:string;state:string;kind:string;expected_version:number;roles:Role[];unit_ids:string[];permissions:string[]}>('SELECT * FROM admin_access_request WHERE id=$1 FOR UPDATE',[c.id])).rows[0];
  if(!r||r.state!=='Pending')throw Error('PENDING_REQUEST_REQUIRED');
  if(actor.id===r.created_by||actor.id===r.user_id)throw Error('FORBIDDEN');
  const u=(await db.query<{version:number}>('SELECT version FROM app_user WHERE id=$1 FOR UPDATE',[r.user_id])).rows[0];
  let state=c.operation==='approveAccess'?'Approved':'Rejected';
  if(c.operation==='approveAccess'&&(r.kind==='PASSWORD_RESET'||r.roles.some(role=>SENSITIVE_ROLES.includes(role)))){
   if(u.version!==r.expected_version)throw Error('STALE_VERSION');
   // Discard the random plaintext immediately. Neither maker nor checker can
   // authenticate as the target. Operator delivers target-only enrollment.
   const hash=await hashPassword(token());await db.query('UPDATE app_user SET password_hash=$2,must_change_password=true,failed_count=0,locked_until=NULL,version=version+1 WHERE id=$1',[r.user_id,hash]);await revokeUserSessions(db,r.user_id);state='AwaitingEnrollment';
  }else if(c.operation==='approveAccess'){
   if(u.version!==r.expected_version)throw Error('STALE_VERSION');await activeUnits(db,r.unit_ids);
   await ensureAdminRemains(db,r.user_id,r.roles);
   await db.query('DELETE FROM role_assignment WHERE user_id=$1',[r.user_id]);
   for(const role of r.roles)await db.query('INSERT INTO role_assignment(user_id,role,approved_by) VALUES($1,$2,$3)',[r.user_id,role,actor.id]);
   await db.query('DELETE FROM user_unit_scope WHERE user_id=$1',[r.user_id]);for(const unit of r.unit_ids)await db.query('INSERT INTO user_unit_scope(user_id,unit_id) VALUES($1,$2)',[r.user_id,unit]);
   await db.query('DELETE FROM user_permission WHERE user_id=$1',[r.user_id]);for(const permission of r.permissions)await db.query('INSERT INTO user_permission(user_id,permission,approved_by) VALUES($1,$2,$3)',[r.user_id,permission,actor.id]);
   await db.query('UPDATE app_user SET version=version+1 WHERE id=$1',[r.user_id]);await revokeUserSessions(db,r.user_id);
  }
  await db.query('UPDATE admin_access_request SET state=$2,decided_by=$3,decided_at=clock_timestamp() WHERE id=$1',[c.id,state,actor.id]);
  await audit(db,actor,state==='AwaitingEnrollment'?'USER_ENROLLMENT_REQUIRED':r.kind==='PASSWORD_RESET'?(c.operation==='approveAccess'?'USER_RECOVERY_APPROVED':'USER_RECOVERY_REJECTED'):(c.operation==='approveAccess'?'USER_ACCESS_APPROVED':'USER_ACCESS_REJECTED'),r.user_id);return {id:c.id,state};
 }
 if(!('version' in c))throw Error('INVALID_OPERATION');
 const u=(await db.query<{version:number;unit_id:string|null}>('SELECT version,unit_id FROM app_user WHERE id=$1 FOR UPDATE',[c.id])).rows[0];if(!u||u.version!==c.version)throw Error('STALE_VERSION');
 if(c.id===actor.id&&(c.operation!=='updateUser'||!c.enabled||c.unitId!==u.unit_id))throw Error('SELF_SECURITY_CHANGE_DENIED');
 if(c.operation==='requestPasswordReset'){
  const id=(await db.query<{id:string}>("INSERT INTO admin_access_request(user_id,expected_version,roles,unit_ids,permissions,created_by,reason,kind) VALUES($1,$2,'[]','[]','[]',$3,$4,'PASSWORD_RESET') RETURNING id",[c.id,c.version,actor.id,c.reason])).rows[0].id;
  await audit(db,actor,'USER_RECOVERY_REQUESTED',c.id);return {id};
 }
 if(c.operation==='requestAccess'){
  if(new Set(c.roles).size!==c.roles.length||new Set(c.permissions).size!==c.permissions.length)throw Error('DUPLICATE_ACCESS');
  await activeUnits(db,c.unitIds);
  const id=(await db.query<{id:string}>('INSERT INTO admin_access_request(user_id,expected_version,roles,unit_ids,permissions,created_by,reason) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id',[c.id,c.version,JSON.stringify(c.roles),JSON.stringify(c.unitIds),JSON.stringify(c.permissions),actor.id,c.reason])).rows[0].id;
  await audit(db,actor,'USER_ACCESS_REQUESTED',c.id);return {id};
 }
 if(c.operation==='updateUser'){
  if(c.unitId&&c.unitId!==u.unit_id)await activeUnits(db,[c.unitId]);if(!c.enabled)await ensureAdminRemains(db,c.id,[]);
  await db.query('UPDATE app_user SET username=$2,display_name=$3,unit_id=$4,enabled=$5,version=version+1 WHERE id=$1',[c.id,c.username,c.displayName,c.unitId,c.enabled]);await revokeUserSessions(db,c.id);
 }else if(c.operation==='resetPassword'){
  const assigned=(await db.query<{role:Role}>("SELECT role FROM role_assignment WHERE user_id=$1 AND (expires_at IS NULL OR expires_at>clock_timestamp())",[c.id])).rows;
  if(assigned.some(a=>SENSITIVE_ROLES.includes(a.role)))throw Error('INDEPENDENT_RECOVERY_REQUIRED');
  const hash=await hashPassword(c.password);await db.query('UPDATE app_user SET password_hash=$2,must_change_password=true,failed_count=0,locked_until=NULL,version=version+1 WHERE id=$1',[c.id,hash]);await revokeUserSessions(db,c.id);
 }else await db.query('UPDATE app_user SET failed_count=0,locked_until=NULL,version=version+1 WHERE id=$1',[c.id]);
 await audit(db,actor,c.operation==='updateUser'?'USER_UPDATED':c.operation==='resetPassword'?'USER_PASSWORD_RESET':'USER_UNLOCKED',c.id);return {id:c.id};
}
export async function ensureAdminRemains(db:Queryable,target:string,nextRoles:Role[]){if(nextRoles.includes('APP_ADMIN'))return;const r=await db.query(`SELECT 1 FROM role_assignment a JOIN app_user u ON u.id=a.user_id WHERE a.role='APP_ADMIN' AND u.id<>$1 AND u.enabled AND a.effective_from<=clock_timestamp() AND (a.expires_at IS NULL OR a.expires_at>clock_timestamp()) LIMIT 1`,[target]);if(!r.rows.length)throw Error('LAST_ADMIN_REQUIRED');}
export async function changePassword(db:Queryable,user:Actor,current:string,next:string):Promise<boolean>{
 const u=(await db.query<{password_hash:string;enabled:boolean;failed_count:number;locked_until:Date|null}>('SELECT password_hash,enabled,failed_count,locked_until FROM app_user WHERE id=$1 FOR UPDATE',[user.id])).rows[0];
 if(!u?.enabled||u.locked_until&&new Date(u.locked_until)>new Date())return false;
 await assertLiveSession(db,user);
 await lockUserSessions(db,user.id); // Busy signing sessions reject before password verification; no lock-order deadlock.
 if(!await verifyPassword(u.password_hash,current)){
  const count=u.locked_until?1:u.failed_count+1;await db.query('UPDATE app_user SET failed_count=$2,locked_until=$3 WHERE id=$1',[user.id,count,count>=5?new Date(Date.now()+LOCKOUT_MS):null]);if(count>=5)await revokeUserSessions(db,user.id);
  await appendAudit(db,{actorId:user.id,action:'USER_PASSWORD_CHANGE_DENIED',resourceType:'USER',resourceId:user.id,details:{outcome:'DENIED'}});return false; // caller commits counters before returning generic error.
 }
 if(current===next)throw Error('NEW_PASSWORD_REQUIRED');
 const hash=await hashPassword(next);await db.query('UPDATE app_user SET password_hash=$2,must_change_password=false,failed_count=0,locked_until=NULL,version=version+1 WHERE id=$1',[user.id,hash]);await revokeUserSessions(db,user.id);await audit(db,user,'USER_PASSWORD_CHANGED',user.id);return true;
}
export async function listAccessRequests(db:Queryable,user:Principal){requireAdministrationRead(user);return (await db.query(`SELECT r.*,u.version current_version,u.username,u.display_name,m.username maker_username,m.display_name maker_name FROM admin_access_request r JOIN app_user u ON u.id=r.user_id JOIN app_user m ON m.id=r.created_by WHERE r.state IN ('Pending','AwaitingEnrollment') AND NOT EXISTS(SELECT 1 FROM admin_access_supersession x WHERE x.request_id=r.id) ORDER BY r.created_at DESC LIMIT 100`)).rows;}
export async function listAudit(db:Queryable,user:Principal,input:unknown={}){
 requirePermission(user,'audit.read',{},'read');const f=filters.parse(input),where=`($1='' OR a.action ILIKE $1 OR u.username ILIKE $1 OR u.display_name ILIKE $1) AND ($2='' OR a.action=$2) AND ($3='' OR a.details->>'outcome'=$3) AND ($4::uuid IS NULL OR a.resource_id=$4)`;
 const params=[f.search?`%${f.search}%`:'',f.action,f.outcome,f.resourceId??null];
 const rows=(await db.query<{sequence:string;action:string;resource_type:string;resource_id:string|null;created_at:Date;username:string|null;display_name:string|null;details:Record<string,unknown>}>(`SELECT a.sequence::text,a.action,a.resource_type,a.resource_id,a.created_at,u.username,u.display_name,a.details FROM audit_chain a LEFT JOIN app_user u ON u.id=a.actor_id WHERE ${where} ORDER BY a.sequence DESC LIMIT 20 OFFSET $5`,[...params,(f.page-1)*20])).rows;
 // Do not expose payload, hashes, snapshots or arbitrary legacy details. Whitelist
 // each scalar individually so unsafe old details cannot break the whole viewer.
 return {rows:rows.map(r=>({...r,details:Object.fromEntries(Object.entries(r.details).flatMap(([k,v])=>{try{return Object.entries(safeDetails({[k]:v}));}catch{return [];}}))})),page:f.page,total:Number((await db.query<{count:string}>(`SELECT count(*)::text count FROM audit_chain a LEFT JOIN app_user u ON u.id=a.actor_id WHERE ${where}`,params)).rows[0].count)};
}
