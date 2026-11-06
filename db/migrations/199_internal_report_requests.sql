-- Durable orchestration over the existing internal_report_batch ledger and job_outbox.
-- Each item uses its own idempotency UUID and transaction; rendered reports remain on the existing ledger.
CREATE TABLE internal_report_request (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 operator_id uuid NOT NULL REFERENCES app_user,
 session_id uuid REFERENCES app_session,
 idempotency_key uuid NOT NULL UNIQUE,
 request jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX internal_report_request_operator ON internal_report_request(operator_id,created_at DESC);
CREATE TRIGGER internal_report_request_immutable BEFORE UPDATE OR DELETE ON internal_report_request FOR EACH ROW EXECUTE FUNCTION immutable_row();
CREATE TABLE internal_report_request_item (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 request_id uuid NOT NULL REFERENCES internal_report_request,
 ordinal integer NOT NULL CHECK(ordinal>=0),
 row_id uuid NOT NULL,
 idempotency_key uuid NOT NULL UNIQUE,
 outbox_id uuid NOT NULL UNIQUE REFERENCES job_outbox,
 state text NOT NULL DEFAULT 'QUEUED' CHECK(state IN ('QUEUED','FINAL','HOLD','ERROR')),
 outcome jsonb,
 finalization_batch_id uuid REFERENCES internal_report_batch,
 completed_at timestamptz,
 UNIQUE(request_id,ordinal), UNIQUE(request_id,row_id),
 CHECK((state='QUEUED' AND outcome IS NULL AND completed_at IS NULL) OR (state<>'QUEUED' AND outcome IS NOT NULL AND completed_at IS NOT NULL))
);
CREATE FUNCTION internal_report_request_item_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'append-only record'; END IF;
 IF OLD.state<>'QUEUED' OR NEW.id<>OLD.id OR NEW.request_id<>OLD.request_id OR NEW.ordinal<>OLD.ordinal OR NEW.row_id<>OLD.row_id OR NEW.idempotency_key<>OLD.idempotency_key OR NEW.outbox_id<>OLD.outbox_id THEN RAISE EXCEPTION 'immutable report request item'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER internal_report_request_item_guard BEFORE UPDATE OR DELETE ON internal_report_request_item FOR EACH ROW EXECUTE FUNCTION internal_report_request_item_guard();
