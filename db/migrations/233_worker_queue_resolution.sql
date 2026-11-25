-- Owner 2026-11-25: an Administrator closes a HIS outbox job that shows "ต้องตรวจสอบปลายทาง" after checking it by hand
-- ("ปิดงานที่ตรวจแล้ว"). The system cannot tell whether such a job reached HIS, so it never closes one by itself; a person who
-- has checked says so here, once per job. The job is marked Cancelled (the Worker skips a Cancelled job and the backlog no longer
-- counts it); its receipts, releases and HIS evidence are not changed. Forward-only and additive.
CREATE TABLE worker_queue_resolution (
 job_id uuid PRIMARY KEY REFERENCES job_outbox(id),
 scope text NOT NULL CHECK(scope='OUTBOX'),
 status_before text NOT NULL,
 resolved_by uuid NOT NULL REFERENCES app_user(id),
 resolved_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER worker_queue_resolution_immutable BEFORE UPDATE OR DELETE ON worker_queue_resolution
 FOR EACH ROW EXECUTE FUNCTION immutable_row();

REVOKE ALL ON worker_queue_resolution FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='app_rw') THEN GRANT SELECT,INSERT ON worker_queue_resolution TO app_rw; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='worker_rw') THEN GRANT SELECT ON worker_queue_resolution TO worker_rw; END IF;
END $$;
