-- v1.1.3: operator can clear any visible queue class without destroying
-- immutable receipts or lying about in-flight external side effects.
CREATE TABLE worker_queue_clear_event (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 scope text NOT NULL CHECK(scope IN ('OUTBOX','ARCHIVE')),
 job_id uuid NOT NULL,
 state_before text NOT NULL,
 resolution text NOT NULL CHECK(resolution IN ('CANCELLED','CANCEL_REQUESTED','RECONCILIATION_REQUIRED','HIDDEN_COMPLETED')),
 actor_id uuid NOT NULL REFERENCES app_user(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(scope,job_id)
);
CREATE TRIGGER worker_queue_clear_event_immutable BEFORE UPDATE OR DELETE ON worker_queue_clear_event
 FOR EACH ROW EXECUTE FUNCTION immutable_row();

-- A claimed archive may already be writing. Request cancellation first;
-- the Worker must check it, while an already published report remains ARCHIVED.
ALTER TABLE pdf_archive_job ADD COLUMN cancellation_requested_at timestamptz;
ALTER TABLE pdf_archive_job DROP CONSTRAINT pdf_archive_job_state_check;
ALTER TABLE pdf_archive_job ADD CONSTRAINT pdf_archive_job_state_check
 CHECK(state IN ('PENDING','ARCHIVED','FAILED','CANCELLED'));

DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='app_rw') THEN
  GRANT SELECT,INSERT ON worker_queue_clear_event TO app_rw;
  GRANT UPDATE(state,cancellation_requested_at,updated_at) ON pdf_archive_job TO app_rw;
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='worker_rw') THEN
  GRANT SELECT ON worker_queue_clear_event TO worker_rw;
 END IF;
END $$;
