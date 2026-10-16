import {z} from 'zod';
import type {Queryable} from '../db/connection';
import {hashPassword} from '../security/password';
import {appendAudit} from '../db/audit';
import {activeUnits,ensureAdminRemains,revokeUserSessions} from './service';
import type {Role} from '../security/policy';
/** No Web route. An installation owner verifies the target's identity outside
 * Web and supplies a target-only password through a protected launch context. */
export async function completeTargetEnrollment(db:Queryable,input:unknown){
 const d=z.object({requestId:z.uuid(),username:z.string().min(3).max(64),password:z.string().max(128),targetIdentityConfirmed:z.literal(true)}).strict().parse(input);
 await db.query('SELECT pg_advisory_xact_lock(75432806)');
 const owner=(await db.query<{owner:boolean}>("SELECT pg_has_role(current_user,tableowner,'USAGE') owner FROM pg_tables WHERE schemaname='public' AND tablename='app_user'")).rows[0];if(!owner?.owner)throw Error('INSTALLATION_OWNER_REQUIRED');
 const r=(await db.query<{user_id:string;created_by:string;decided_by:string;state:string;kind:string;expected_version:number;roles:Role[];unit_ids:string[];permissions:string[]}>('SELECT * FROM admin_access_request WHERE id=$1 FOR UPDATE',[d.requestId])).rows[0];
 if(!r||r.state!=='AwaitingEnrollment'||r.created_by===r.decided_by||r.user_id===r.created_by||r.user_id===r.decided_by)throw Error('APPROVED_TARGET_ENROLLMENT_REQUIRED');
 for(const [id,role] of [[r.created_by,'APP_ADMIN'],[r.decided_by,'CLINICAL_APPROVER']])if(!(await db.query("SELECT 1 FROM app_user u JOIN role_assignment a ON a.user_id=u.id WHERE u.id=$1 AND u.enabled AND a.role=$2 AND a.effective_from<=clock_timestamp() AND (a.expires_at IS NULL OR a.expires_at>clock_timestamp())",[id,role])).rows.length)throw Error('MAKER_CHECKER_AUTHORITY_CHANGED');
 const u=(await db.query<{username:string;version:number;enabled:boolean}>('SELECT username,version,enabled FROM app_user WHERE id=$1 FOR UPDATE',[r.user_id])).rows[0];
 if(!u?.enabled||u.username!==d.username||u.version!==r.expected_version+1)throw Error('ENROLLMENT_TARGET_CHANGED');
 if(r.kind==='ACCESS'){
  await activeUnits(db,r.unit_ids);await ensureAdminRemains(db,r.user_id,r.roles);
  await db.query('DELETE FROM role_assignment WHERE user_id=$1',[r.user_id]);for(const role of r.roles)await db.query('INSERT INTO role_assignment(user_id,role,approved_by,effective_from) VALUES($1,$2,$3,clock_timestamp())',[r.user_id,role,r.decided_by]);
  await db.query('DELETE FROM user_unit_scope WHERE user_id=$1',[r.user_id]);for(const unit of r.unit_ids)await db.query('INSERT INTO user_unit_scope(user_id,unit_id) VALUES($1,$2)',[r.user_id,unit]);
  await db.query('DELETE FROM user_permission WHERE user_id=$1',[r.user_id]);for(const permission of r.permissions)await db.query('INSERT INTO user_permission(user_id,permission,approved_by) VALUES($1,$2,$3)',[r.user_id,permission,r.decided_by]);
 }
 const hash=await hashPassword(d.password);await db.query('UPDATE app_user SET password_hash=$2,must_change_password=true,failed_count=0,locked_until=NULL,version=version+1 WHERE id=$1',[r.user_id,hash]);await revokeUserSessions(db,r.user_id);
 await db.query("UPDATE admin_access_request SET state='Approved' WHERE id=$1",[d.requestId]);await appendAudit(db,{actorId:r.decided_by,action:'USER_TARGET_ENROLLED_BY_OPERATOR',resourceType:'USER',resourceId:r.user_id,details:{outcome:'SUCCESS',reasonCode:'TARGET_IDENTITY_OPERATOR_CONFIRMED'}});
 return {id:r.user_id};
}
