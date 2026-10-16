-- Credential recovery is distinct from access assignment and contains NO secret.
ALTER TABLE admin_access_request ADD COLUMN kind text NOT NULL DEFAULT 'ACCESS' CHECK(kind IN ('ACCESS','PASSWORD_RESET'));
CREATE TRIGGER admin_access_kind_immutable BEFORE UPDATE OF kind ON admin_access_request FOR EACH ROW EXECUTE FUNCTION security_immutable();
DO $$ BEGIN IF EXISTS(SELECT FROM pg_roles WHERE rolname='app_rw') THEN GRANT SELECT ON schema_migration TO app_rw; END IF; END $$;
