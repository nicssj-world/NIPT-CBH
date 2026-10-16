-- Forward only: old accounts retain credentials and access. New administrative
-- writes use optimistic versions and an independently approved access request.
ALTER TABLE unit ADD COLUMN active boolean NOT NULL DEFAULT true;
ALTER TABLE unit ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK(version>0);
ALTER TABLE app_user ADD COLUMN unit_id uuid REFERENCES unit(id);
ALTER TABLE app_user ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK(version>0);
ALTER TABLE app_user ADD COLUMN must_change_password boolean NOT NULL DEFAULT false;
ALTER TABLE app_user ADD COLUMN last_login_at timestamptz;
CREATE UNIQUE INDEX app_user_username_casefold ON app_user(lower(username));
CREATE TABLE admin_access_request(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL REFERENCES app_user(id),
 expected_version integer NOT NULL CHECK(expected_version>0),
 roles jsonb NOT NULL CHECK(jsonb_typeof(roles)='array'),unit_ids jsonb NOT NULL CHECK(jsonb_typeof(unit_ids)='array'),
 permissions jsonb NOT NULL CHECK(jsonb_typeof(permissions)='array'),
 reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 1 AND 250),
 created_by uuid NOT NULL REFERENCES app_user(id),created_at timestamptz NOT NULL DEFAULT now(),
 decided_by uuid REFERENCES app_user(id),decided_at timestamptz,state text NOT NULL DEFAULT 'Pending' CHECK(state IN ('Pending','Approved','Rejected')),
 CHECK(created_by<>user_id),CHECK(decided_by IS NULL OR (decided_by<>created_by AND decided_by<>user_id)),
 CHECK((state='Pending' AND decided_by IS NULL AND decided_at IS NULL) OR (state<>'Pending' AND decided_by IS NOT NULL AND decided_at IS NOT NULL))
);
CREATE TRIGGER admin_access_payload_immutable BEFORE UPDATE OF user_id,expected_version,roles,unit_ids,permissions,reason,created_by,created_at ON admin_access_request FOR EACH ROW EXECUTE FUNCTION security_immutable();
CREATE TRIGGER admin_access_delete_denied BEFORE DELETE ON admin_access_request FOR EACH ROW EXECUTE FUNCTION security_immutable();
CREATE FUNCTION admin_access_decision_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF OLD.state<>'Pending' THEN RAISE EXCEPTION 'ACCESS_REQUEST_ALREADY_DECIDED'; END IF; RETURN NEW; END $$;
CREATE TRIGGER admin_access_decision_guard BEFORE UPDATE ON admin_access_request FOR EACH ROW EXECUTE FUNCTION admin_access_decision_guard();
CREATE INDEX admin_access_pending ON admin_access_request(created_at DESC) WHERE state='Pending';
DO $$ BEGIN IF EXISTS(SELECT FROM pg_roles WHERE rolname='app_rw') THEN
 GRANT SELECT,INSERT,UPDATE ON admin_access_request TO app_rw;
 GRANT SELECT,INSERT,UPDATE ON unit,app_user,role_assignment,user_unit_scope,user_permission TO app_rw;
 GRANT DELETE ON role_assignment,user_unit_scope,user_permission TO app_rw;
 END IF; END $$;
