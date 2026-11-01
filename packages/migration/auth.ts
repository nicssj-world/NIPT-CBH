import type {Queryable} from '../db/connection';
import {digest} from '../security/session';
import type {Role} from '../security/policy';
import type {Staff} from '../lab/core';
/** Dry Run must not refresh session timestamps, acquire row locks or append application audit rows. */
export async function readOnlyMigrationSession(db:Queryable,raw:string):Promise<(Staff&{csrfHash:string})|null>{
 if(!/^[\w-]{43}$/.test(raw))return null;
 const row=(await db.query<{id:string;user_id:string;csrf_hash:string}>(`SELECT s.id,s.user_id,s.csrf_hash FROM app_session s JOIN app_user u ON u.id=s.user_id WHERE s.token_hash=$1 AND u.enabled AND NOT u.must_change_password AND NOT s.signing_suspended AND s.revoked_at IS NULL AND s.idle_expires_at>now() AND s.absolute_expires_at>now()`,[digest(raw)])).rows[0];if(!row)return null;
 const roles=(await db.query<{role:Role}>('SELECT role FROM role_assignment WHERE user_id=$1 AND effective_from<=now() AND (expires_at IS NULL OR expires_at>now())',[row.user_id])).rows;
 const units=(await db.query<{unit_id:string}>('SELECT unit_id FROM user_unit_scope WHERE user_id=$1',[row.user_id])).rows;
 const permissions=(await db.query<{permission:string}>('SELECT permission FROM user_permission WHERE user_id=$1',[row.user_id])).rows;
 return {id:row.user_id,sessionId:row.id,csrfHash:row.csrf_hash,roles:roles.map(x=>x.role),unitIds:units.map(x=>x.unit_id),permissions:permissions.map(x=>x.permission)};
}
