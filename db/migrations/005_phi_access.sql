CREATE TABLE phi_access_log (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_id uuid NOT NULL REFERENCES app_user,
 case_id uuid NOT NULL REFERENCES nipt_case, purpose text NOT NULL CHECK(purpose IN ('REGISTRY_VIEW','CASE_DETAIL_VIEW')),
 accessed_at timestamptz NOT NULL DEFAULT now(), synthetic boolean NOT NULL DEFAULT true CHECK(synthetic)
);
CREATE INDEX phi_access_case_time ON phi_access_log(case_id,accessed_at);
CREATE TRIGGER phi_access_immutable BEFORE UPDATE OR DELETE ON phi_access_log FOR EACH ROW EXECUTE FUNCTION immutable_row();
