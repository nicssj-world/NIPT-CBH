-- P7 A19/A21: synthetic diagnostic/access evidence only; no report/version or clinical state mutation.
CREATE TABLE result_query_export_evidence(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),actor_id uuid NOT NULL REFERENCES app_user,session_id uuid NOT NULL REFERENCES app_session,
 filters jsonb NOT NULL,page integer NOT NULL CHECK(page>0),page_size integer NOT NULL CHECK(page_size BETWEEN 1 AND 300),has_next boolean NOT NULL,
 version_ids uuid[] NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),synthetic boolean NOT NULL DEFAULT true CHECK(synthetic)
);
CREATE TRIGGER result_query_export_immutable BEFORE UPDATE OR DELETE ON result_query_export_evidence FOR EACH ROW EXECUTE FUNCTION immutable_row();
CREATE TABLE result_reparse_evidence(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),version_id uuid NOT NULL REFERENCES result_report_version,source_sha256 text NOT NULL CHECK(source_sha256 ~ '^[a-f0-9]{64}$'),
 actor_id uuid NOT NULL REFERENCES app_user,session_id uuid NOT NULL REFERENCES app_session,reason text NOT NULL CHECK(length(reason) BETWEEN 8 AND 500),
 idempotency_key uuid NOT NULL,request_sha256 text NOT NULL CHECK(request_sha256 ~ '^[a-f0-9]{64}$'),
 parser_version text NOT NULL,template_version text,outcome text NOT NULL CHECK(outcome IN ('PARSED_DIAGNOSTIC','REJECTED_DIAGNOSTIC')),
 parsed jsonb,reject_code text,created_at timestamptz NOT NULL DEFAULT now(),synthetic boolean NOT NULL DEFAULT true CHECK(synthetic),
 UNIQUE(actor_id,idempotency_key),CHECK((outcome='PARSED_DIAGNOSTIC')=(parsed IS NOT NULL)),CHECK((outcome='REJECTED_DIAGNOSTIC')=(reject_code IS NOT NULL))
);
CREATE INDEX result_reparse_version_time ON result_reparse_evidence(version_id,created_at);
CREATE TRIGGER result_reparse_immutable BEFORE UPDATE OR DELETE ON result_reparse_evidence FOR EACH ROW EXECUTE FUNCTION immutable_row();
CREATE FUNCTION p7_result_diagnostic_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM result_report_version v WHERE v.id=NEW.version_id AND v.sha256=NEW.source_sha256 AND v.synthetic) THEN RAISE EXCEPTION 'DIAGNOSTIC_SOURCE_MISMATCH'; END IF;
 IF NOT EXISTS(SELECT 1 FROM app_session s WHERE s.id=NEW.session_id AND s.user_id=NEW.actor_id AND s.revoked_at IS NULL AND s.idle_expires_at>now() AND s.absolute_expires_at>now() AND NOT s.signing_suspended) THEN RAISE EXCEPTION 'DIAGNOSTIC_SESSION_INVALID'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER result_reparse_source_guard BEFORE INSERT ON result_reparse_evidence FOR EACH ROW EXECUTE FUNCTION p7_result_diagnostic_guard();
REVOKE ALL ON result_query_export_evidence,result_reparse_evidence FROM PUBLIC;
REVOKE ALL ON FUNCTION p7_result_diagnostic_guard() FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='app_rw') THEN
 GRANT SELECT,INSERT ON result_query_export_evidence,result_reparse_evidence TO app_rw;
 REVOKE UPDATE,DELETE,TRUNCATE ON result_query_export_evidence,result_reparse_evidence FROM app_rw;
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='report_ro') THEN GRANT SELECT ON result_query_export_evidence,result_reparse_evidence TO report_ro; END IF;
END $$;
