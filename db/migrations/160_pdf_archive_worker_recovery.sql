-- Archive retry is an untrusted scheduling hint. No APP_ADMIN identity is
-- asserted by app_rw and no privileged retry function is exposed.
-- Only the independent worker can change pdf_archive_job.state.
ALTER TABLE pdf_archive_probe
 ADD COLUMN retry_job_id uuid REFERENCES pdf_archive_job(id);

-- Web may request a probe for an existing failed job, but cannot reset the
-- job status or manufacture a PASSED probe result.
DO $$
BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='app_rw') THEN
  GRANT INSERT(retry_job_id) ON pdf_archive_probe TO app_rw;
 END IF;
END $$;

-- At most one in-flight recheck per target. A completed/failed probe does not
-- lock the job permanently; worker independently verifies any later request.
CREATE UNIQUE INDEX pdf_archive_one_pending_recheck
 ON pdf_archive_probe(retry_job_id)
 WHERE retry_job_id IS NOT NULL AND state IN ('PENDING','RUNNING');
