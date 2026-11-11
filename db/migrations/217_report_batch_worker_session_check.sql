-- The Worker re-checks the operator's signed-in session before it finalizes a report batch item (assertSession).
-- Migration 216 missed it because the test operator had no session; in Production every item then failed (permission denied for table app_session).
-- Read-only and column-limited: the Worker never sees the session token or CSRF hashes. roles.sql repeats this after role creation on a fresh installation.
DO $$ BEGIN
 IF EXISTS(SELECT FROM pg_roles WHERE rolname='worker_rw') THEN
  EXECUTE 'GRANT SELECT(id,user_id,revoked_at,idle_expires_at,absolute_expires_at,signing_suspended) ON app_session TO worker_rw';
 END IF;
END $$;
