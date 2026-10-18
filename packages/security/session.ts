import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Queryable } from "../db/connection";
import type { Principal, Role } from "./policy";
import { hashPassword, verifyPassword } from "./password";

export const IDLE_MS = 30 * 60_000;
export const ABSOLUTE_MS = 8 * 60 * 60_000;
export const LOCKOUT_MS = 15 * 60_000;
/** Mirrors the locked Settings literal security.lockoutAttempts (asserted by tests/db/settings-consumers.test.ts). */
export const LOCKOUT_ATTEMPTS = 5;
export const digest = (value: string): string => createHash("sha256").update(value).digest("hex");
export const token = (): string => randomBytes(32).toString("base64url");
export function equalToken(a: string, b: string): boolean {
  const left = Buffer.from(digest(a)), right = Buffer.from(digest(b));
  return timingSafeEqual(left, right);
}
let dummyHash: Promise<string> | undefined;

type UserRow = { id: string; username: string; password_hash: string; enabled: boolean; failed_count: number; locked_until: Date | string | null };
// Caller transaction owns row locks. Failure counters must be committed even when login fails.
export async function authenticate(db: Queryable, username: string, password: string, now = new Date()): Promise<{ userId: string; token: string; csrf: string } | null> {
  const name = username.trim().toLowerCase();
  const found = await db.query<UserRow>("SELECT * FROM app_user WHERE username=$1 FOR UPDATE", [name]);
  const user = found.rows[0];
  dummyHash ??= hashPassword(token());
  const valid = await verifyPassword(user?.password_hash ?? await dummyHash, password);
  if (!user || !user.enabled || (user.locked_until && new Date(user.locked_until) > now)) return null;
  if (!valid) {
    const count = user.locked_until && new Date(user.locked_until) <= now ? 1 : user.failed_count + 1;
    await db.query("UPDATE app_user SET failed_count=$2,locked_until=$3 WHERE id=$1", [user.id, count, count >= LOCKOUT_ATTEMPTS ? new Date(now.getTime() + LOCKOUT_MS) : null]);
    return null;
  }
  await db.query("UPDATE app_user SET failed_count=0,locked_until=NULL,last_login_at=$2 WHERE id=$1", [user.id,now]);
  const sessionToken = token(), csrf = token();
  await db.query("INSERT INTO app_session(user_id,token_hash,csrf_hash,created_at,last_seen_at,idle_expires_at,absolute_expires_at) VALUES($1,$2,$3,$4,$4,$5,$6)", [user.id, digest(sessionToken), digest(csrf), now, new Date(now.getTime() + IDLE_MS), new Date(now.getTime() + ABSOLUTE_MS)]);
  return { userId: user.id, token: sessionToken, csrf };
}

export async function throttleLogin(db: Queryable, clientKey: string, now = new Date()): Promise<boolean> {
  const key = digest(clientKey);
  const result = await db.query<{ attempts: number }>(`INSERT INTO login_throttle(key_hash,attempts,window_started_at) VALUES($1,1,$2)
    ON CONFLICT(key_hash) DO UPDATE SET attempts=CASE WHEN login_throttle.window_started_at < $2::timestamptz - interval '15 minutes' THEN 1 ELSE login_throttle.attempts+1 END,
    window_started_at=CASE WHEN login_throttle.window_started_at < $2::timestamptz - interval '15 minutes' THEN $2 ELSE login_throttle.window_started_at END RETURNING attempts`, [key, now]);
  return result.rows[0].attempts <= 20;
}

export async function readSession(db: Queryable, raw: string, now = new Date(), allowSigningSuspended = false): Promise<(Principal & { sessionId: string; csrfHash: string; signingSuspended:boolean;mustChangePassword:boolean }) | null> {
  if (!/^[\w-]{43}$/.test(raw)) return null;
  const row = await db.query<{ id: string; user_id: string; csrf_hash: string; signing_suspended:boolean;must_change_password:boolean }>(`UPDATE app_session s SET last_seen_at=$2,idle_expires_at=LEAST($2::timestamptz+interval '30 minutes',absolute_expires_at)
    FROM app_user u WHERE s.token_hash=$1 AND s.user_id=u.id AND u.enabled=true AND s.revoked_at IS NULL AND s.idle_expires_at>$2 AND s.absolute_expires_at>$2 AND (NOT s.signing_suspended OR $3) RETURNING s.id,s.user_id,s.csrf_hash,s.signing_suspended,u.must_change_password`, [digest(raw), now,allowSigningSuspended]);
  if (!row.rows[0]) return null;
  const s = row.rows[0];
  const [roles, units, permissions] = await Promise.all([
    db.query<{ role: Role }>("SELECT role FROM role_assignment WHERE user_id=$1 AND effective_from<=$2 AND (expires_at IS NULL OR expires_at>$2)", [s.user_id, now]),
    db.query<{ unit_id: string }>("SELECT unit_id FROM user_unit_scope WHERE user_id=$1", [s.user_id]),
    db.query<{ permission: string }>("SELECT permission FROM user_permission WHERE user_id=$1", [s.user_id])
  ]);
  return { id: s.user_id, sessionId: s.id, csrfHash: s.csrf_hash, signingSuspended:s.signing_suspended,mustChangePassword:s.must_change_password,roles: roles.rows.map(x => x.role), unitIds: units.rows.map(x => x.unit_id), permissions: permissions.rows.map(x => x.permission) };
}

export async function revokeSession(db: Queryable, raw: string): Promise<void> {
  const revoked=await db.query<{id:string}>("UPDATE app_session SET revoked_at=now() WHERE token_hash=$1 AND revoked_at IS NULL RETURNING id", [digest(raw)]);
  if(revoked.rows.length){const {clearDocumentSession}=await import('../p2/documents');for(const s of revoked.rows)clearDocumentSession(s.id);}
}

export function validateCsrf(origin: string | null, expectedOrigin: string, csrf: string, expectedHash: string): void {
  if (origin !== expectedOrigin || !/^[\w-]{43}$/.test(csrf) || !equalToken(digest(csrf), expectedHash)) throw new Error("CSRF_REJECTED");
}
