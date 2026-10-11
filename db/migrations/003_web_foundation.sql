CREATE TABLE case_unit_scope(case_id uuid NOT NULL REFERENCES nipt_case, unit_id uuid NOT NULL REFERENCES unit, PRIMARY KEY(case_id,unit_id));
CREATE TABLE pdf_preview_cache (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), session_id uuid NOT NULL REFERENCES app_session,
 asset_hash text NOT NULL CHECK(length(asset_hash)=64), template_version text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL,
 CHECK(expires_at > created_at)
);
