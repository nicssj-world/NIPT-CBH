-- Disabled on upgrade. No existing reports are selected, copied, or changed.
CREATE TABLE pdf_archive_config (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 enabled boolean NOT NULL DEFAULT false,
 root_path text,
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_by uuid REFERENCES app_user(id),
 CHECK(NOT enabled OR (root_path IS NOT NULL AND length(root_path)>0))
);
INSERT INTO pdf_archive_config(singleton) VALUES(true);

CREATE TABLE pdf_archive_probe (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 root_path text NOT NULL,
 requested_by uuid NOT NULL REFERENCES app_user(id),
 state text NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','RUNNING','PASSED','FAILED')),
 error_code text,
 worker_account text,
 requested_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 completed_at timestamptz,
 used_at timestamptz,
 claimed_until timestamptz,
 claim_token uuid
);

-- Each enablement has its own cutoff. Closed windows remain for pending work;
-- a later enablement must never make releases from a disabled interval eligible.
CREATE TABLE pdf_archive_window (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 root_path text NOT NULL CHECK(length(root_path)>0),
 activated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 deactivated_at timestamptz,
 activated_by uuid NOT NULL REFERENCES app_user(id),
 CHECK(deactivated_at IS NULL OR deactivated_at>=activated_at)
);
CREATE UNIQUE INDEX pdf_archive_one_open_window ON pdf_archive_window((true)) WHERE deactivated_at IS NULL;

CREATE TABLE pdf_archive_job (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 window_id uuid NOT NULL REFERENCES pdf_archive_window(id),
 release_id uuid NOT NULL UNIQUE REFERENCES result_release(id),
 version_id uuid NOT NULL REFERENCES result_report_version(id),
 case_id uuid NOT NULL REFERENCES nipt_case(id),
 source_sha256 text NOT NULL REFERENCES file_asset(sha256),
 state text NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','ARCHIVED','FAILED')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0),
 last_error text,
 next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 claimed_until timestamptz,
 claim_token uuid,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 archived_at timestamptz,
 CHECK((claim_token IS NULL)=(claimed_until IS NULL)),
 CHECK((state='ARCHIVED')=(archived_at IS NOT NULL))
);
CREATE INDEX pdf_archive_job_due ON pdf_archive_job(next_attempt_at) WHERE state='PENDING';
REVOKE ALL ON pdf_archive_config,pdf_archive_window,pdf_archive_job,pdf_archive_probe FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='app_rw') THEN
  GRANT SELECT,INSERT,UPDATE ON pdf_archive_config,pdf_archive_window TO app_rw;
  GRANT SELECT ON pdf_archive_probe TO app_rw;
  GRANT INSERT(root_path,requested_by) ON pdf_archive_probe TO app_rw;
  GRANT UPDATE(used_at) ON pdf_archive_probe TO app_rw;
  GRANT SELECT ON pdf_archive_job TO app_rw;
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='worker_rw') THEN
  GRANT SELECT ON pdf_archive_config,pdf_archive_window,result_release_completed TO worker_rw;
  GRANT SELECT ON pdf_archive_probe TO worker_rw;
  GRANT UPDATE(state,error_code,worker_account,completed_at,claimed_until,claim_token) ON pdf_archive_probe TO worker_rw;
  GRANT SELECT,INSERT,UPDATE ON pdf_archive_job TO worker_rw;
  GRANT SELECT(id,version_id,case_id,round_id,certified_at) ON result_release TO worker_rw;
  GRANT SELECT(id,case_id,round_id,sha256) ON result_report_version TO worker_rw;
  GRANT SELECT(id,registration_origin) ON nipt_case TO worker_rw;
  GRANT SELECT(sha256,byte_size,media_type) ON file_asset TO worker_rw;
 END IF;
END $$;
