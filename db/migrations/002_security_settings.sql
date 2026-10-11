CREATE TABLE app_user (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), username text UNIQUE NOT NULL CHECK (username ~ '^[a-z0-9._-]{3,64}$'),
 display_name text NOT NULL, password_hash text NOT NULL CHECK (password_hash LIKE '$argon2id$%'),
 enabled boolean NOT NULL DEFAULT true, failed_count integer NOT NULL DEFAULT 0 CHECK(failed_count >= 0),
 locked_until timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE unit (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code text UNIQUE NOT NULL, name text NOT NULL);
CREATE TABLE role_assignment (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES app_user,
 role text NOT NULL CHECK(role IN ('ANC_NURSE','ANC_SUPERVISOR','LAB_STAFF','LAB_CERTIFIER','CLINICAL_APPROVER','APP_ADMIN','IT_OPERATOR','AUDITOR','HISTORICAL_VERIFIER')),
 approved_by uuid REFERENCES app_user, effective_from timestamptz NOT NULL DEFAULT now(), expires_at timestamptz,
 CHECK(role <> 'LAB_CERTIFIER' OR (approved_by IS NOT NULL AND approved_by <> user_id)), UNIQUE(user_id,role)
);
CREATE TABLE user_unit_scope (user_id uuid NOT NULL REFERENCES app_user, unit_id uuid NOT NULL REFERENCES unit, PRIMARY KEY(user_id,unit_id));
CREATE TABLE user_permission (user_id uuid NOT NULL REFERENCES app_user, permission text NOT NULL CHECK(permission IN ('ANC_VIEW_ALL_UNITS','HISTORICAL_ENTRY')), approved_by uuid NOT NULL REFERENCES app_user, PRIMARY KEY(user_id,permission));
CREATE TABLE app_session (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES app_user,
 token_hash text UNIQUE NOT NULL CHECK(length(token_hash)=64), csrf_hash text NOT NULL CHECK(length(csrf_hash)=64),
 created_at timestamptz NOT NULL DEFAULT now(), last_seen_at timestamptz NOT NULL DEFAULT now(),
 idle_expires_at timestamptz NOT NULL, absolute_expires_at timestamptz NOT NULL, revoked_at timestamptz
);
CREATE TABLE login_throttle (key_hash text PRIMARY KEY CHECK(length(key_hash)=64), attempts integer NOT NULL CHECK(attempts>=0), window_started_at timestamptz NOT NULL);
CREATE TABLE settings_revision (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), setting_key text NOT NULL, version integer NOT NULL CHECK(version>0),
 category text NOT NULL, risk text NOT NULL CHECK(risk IN ('GENERAL','SECURITY','CLINICAL','INTEGRATION')),
 value jsonb NOT NULL, state text NOT NULL CHECK(state IN ('Draft','Validated','Approved','Active','Archived')),
 created_by uuid NOT NULL REFERENCES app_user, approved_by uuid REFERENCES app_user,
 created_at timestamptz NOT NULL DEFAULT now(), effective_from timestamptz NOT NULL DEFAULT now(),
 reason text NOT NULL CHECK(length(reason)>0), previous_revision_id uuid REFERENCES settings_revision,
 test_passed boolean NOT NULL DEFAULT false,
 CHECK(approved_by IS NULL OR approved_by <> created_by), UNIQUE(setting_key,version)
);
CREATE TABLE setting_active (setting_key text PRIMARY KEY, revision_id uuid UNIQUE NOT NULL REFERENCES settings_revision);
CREATE TABLE secret_revision (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), secret_key text NOT NULL, key_version text NOT NULL,
 wrapped_key text NOT NULL, iv text NOT NULL, tag text NOT NULL, ciphertext text NOT NULL,
 created_by uuid NOT NULL REFERENCES app_user, created_at timestamptz NOT NULL DEFAULT now(),
 tested_at timestamptz, retired_at timestamptz
);
CREATE FUNCTION security_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'IMMUTABLE_SECURITY_RECORD'; END $$;
CREATE TRIGGER settings_payload_immutable BEFORE UPDATE OF setting_key,version,category,risk,value,created_by,created_at,effective_from,reason,previous_revision_id ON settings_revision FOR EACH ROW EXECUTE FUNCTION security_immutable();
CREATE TRIGGER settings_delete_denied BEFORE DELETE ON settings_revision FOR EACH ROW EXECUTE FUNCTION security_immutable();
CREATE TRIGGER secret_payload_immutable BEFORE UPDATE OF secret_key,key_version,wrapped_key,iv,tag,ciphertext,created_by,created_at ON secret_revision FOR EACH ROW EXECUTE FUNCTION security_immutable();
CREATE TRIGGER secret_delete_denied BEFORE DELETE ON secret_revision FOR EACH ROW EXECUTE FUNCTION security_immutable();
CREATE FUNCTION settings_activation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r settings_revision; BEGIN
 SELECT * INTO r FROM settings_revision WHERE id=NEW.revision_id;
 IF r.setting_key <> NEW.setting_key OR r.state NOT IN ('Validated','Approved','Active') OR NOT r.test_passed OR r.effective_from > now() THEN RAISE EXCEPTION 'SETTING_NOT_VALIDATED'; END IF;
 IF r.risk IN ('CLINICAL','INTEGRATION') AND (r.approved_by IS NULL OR r.approved_by=r.created_by OR r.state NOT IN ('Approved','Active')) THEN RAISE EXCEPTION 'SETTING_APPROVAL_REQUIRED'; END IF;
 IF r.setting_key='go_live_cutoff' AND EXISTS(SELECT 1 FROM nipt_case WHERE registration_origin='HISTORICAL') THEN RAISE EXCEPTION 'OD27_REQUIRED'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER setting_active_guard BEFORE INSERT OR UPDATE ON setting_active FOR EACH ROW EXECUTE FUNCTION settings_activation_guard();
