-- Mutable operational projection only. Historical immutable scan runs and audit evidence remain intact.
CREATE TABLE his_inbound_scan_state(
 configuration_id text PRIMARY KEY,
 heartbeat_at timestamptz NOT NULL,
 started_at timestamptz NOT NULL,
 finished_at timestamptz NOT NULL,
 trigger text NOT NULL CHECK(trigger IN ('INTERVAL','MANUAL','DEEP')),
 outcome text NOT NULL CHECK(outcome IN ('SUCCESS','PARTIAL','SHARE_UNAVAILABLE','FAILED','SKIPPED_BACKOFF')),
 counts jsonb NOT NULL DEFAULT '{}',
 error_code text,
 last_success_at timestamptz,
 last_error_at timestamptz,
 last_error_code text,
 consecutive_failures integer NOT NULL DEFAULT 0 CHECK(consecutive_failures>=0),
 CHECK(finished_at>=started_at)
);
REVOKE ALL ON his_inbound_scan_state FROM PUBLIC;
DO $$ DECLARE r text; BEGIN
 FOREACH r IN ARRAY ARRAY['app_rw','worker_rw','report_ro'] LOOP
  IF EXISTS(SELECT FROM pg_roles WHERE rolname=r) THEN
   EXECUTE format('GRANT SELECT ON his_inbound_scan_state TO %I',r);
   IF r IN ('app_rw','worker_rw') THEN EXECUTE format('GRANT INSERT,UPDATE ON his_inbound_scan_state TO %I',r); END IF;
  END IF;
 END LOOP;
END $$;
