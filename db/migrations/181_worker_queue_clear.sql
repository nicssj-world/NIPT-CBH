-- v1.1.3 Worker Queue: an Administrator asks for queue items to be cleared; nothing
-- here deletes a job, receipt, release or HIS evidence. Web (app_rw) can only INSERT
-- a request. The independent Worker (worker_rw) is the only identity that changes
-- pdf_archive_job.state and records the outcome, consistent with migration 160.
CREATE TABLE worker_queue_clear_request (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 scope text NOT NULL CHECK(scope IN ('OUTBOX','ARCHIVE')),
 job_id uuid NOT NULL,
 requested_by uuid NOT NULL REFERENCES app_user(id),
 state_before text NOT NULL,
 requested_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(scope,job_id)
);
CREATE TRIGGER worker_queue_clear_request_immutable BEFORE UPDATE OR DELETE ON worker_queue_clear_request
 FOR EACH ROW EXECUTE FUNCTION immutable_row();

-- Outcome of a request, written once. CANCELLED means the system holds evidence the job
-- will not run again; RECONCILIATION_REQUIRED means an external effect may already exist.
CREATE TABLE worker_queue_clear_outcome (
 request_id uuid PRIMARY KEY REFERENCES worker_queue_clear_request(id),
 outcome text NOT NULL CHECK(outcome IN ('CANCELLED','RECONCILIATION_REQUIRED','COMPLETED_NOT_CHANGED')),
 detail text,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER worker_queue_clear_outcome_immutable BEFORE UPDATE OR DELETE ON worker_queue_clear_outcome
 FOR EACH ROW EXECUTE FUNCTION immutable_row();

-- cancellation_requested_at is set by the Worker when it accepts a request, so a claimed
-- job can stop before an external write and an uncertain publication is never called cancelled.
ALTER TABLE pdf_archive_job ADD COLUMN cancellation_requested_at timestamptz;
ALTER TABLE pdf_archive_job DROP CONSTRAINT pdf_archive_job_state_check;
ALTER TABLE pdf_archive_job ADD CONSTRAINT pdf_archive_job_state_check
 CHECK(state IN ('PENDING','ARCHIVED','FAILED','CANCELLED'));

REVOKE ALL ON worker_queue_clear_request,worker_queue_clear_outcome FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='app_rw') THEN
  GRANT SELECT,INSERT ON worker_queue_clear_request TO app_rw;
  GRANT SELECT ON worker_queue_clear_outcome TO app_rw;
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='worker_rw') THEN
  GRANT SELECT ON worker_queue_clear_request TO worker_rw;
  GRANT SELECT,INSERT ON worker_queue_clear_outcome TO worker_rw;
 END IF;
END $$;
