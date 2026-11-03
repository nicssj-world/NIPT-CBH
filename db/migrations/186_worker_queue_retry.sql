-- v1.1.3 Worker Queue retry. Same principle as 181: web records an immutable request, only the Worker acts (through the supported
-- pg-boss API) and records the outcome. A retry is refused whenever an external effect may already exist.
CREATE TABLE worker_queue_retry_request (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 job_id uuid NOT NULL,
 requested_by uuid NOT NULL REFERENCES app_user,
 requested_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX worker_queue_retry_request_job ON worker_queue_retry_request(job_id,requested_at);
CREATE TRIGGER worker_queue_retry_request_immutable BEFORE UPDATE OR DELETE ON worker_queue_retry_request
 FOR EACH ROW EXECUTE FUNCTION immutable_row();

CREATE TABLE worker_queue_retry_outcome (
 request_id uuid PRIMARY KEY REFERENCES worker_queue_retry_request(id),
 outcome text NOT NULL CHECK(outcome IN ('RETRIED','REFUSED')),
 reason text NOT NULL CHECK(reason ~ '^[A-Z0-9_]{3,60}$'),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER worker_queue_retry_outcome_immutable BEFORE UPDATE OR DELETE ON worker_queue_retry_outcome
 FOR EACH ROW EXECUTE FUNCTION immutable_row();

-- State of specific pg-boss jobs (id and state only, no payload). 'unavailable' when pg-boss has not created its schema yet,
-- 'missing' when the schema exists but holds no such job. Dynamic SQL because pg-boss creates pgboss.job at Worker start.
CREATE FUNCTION nipt_pg_boss_state_of(p_ids uuid[]) RETURNS TABLE(job_id uuid,job_state text)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF p_ids IS NULL OR cardinality(p_ids)>5000 THEN RAISE EXCEPTION 'QUEUE_PAGE_SIZE_INVALID'; END IF;
 IF to_regclass('pgboss.job') IS NULL THEN
  RETURN QUERY SELECT i,'unavailable'::text FROM unnest(p_ids) i; RETURN;
 END IF;
 RETURN QUERY EXECUTE 'SELECT i,COALESCE(j.state::text,''missing'') FROM unnest($1::uuid[]) i LEFT JOIN pgboss.job j ON j.id=i' USING p_ids;
END $$;
REVOKE ALL ON FUNCTION nipt_pg_boss_state_of(uuid[]) FROM PUBLIC;

REVOKE ALL ON worker_queue_retry_request,worker_queue_retry_outcome FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='app_rw') THEN
  GRANT SELECT,INSERT ON worker_queue_retry_request TO app_rw;
  GRANT SELECT ON worker_queue_retry_outcome TO app_rw;
  GRANT EXECUTE ON FUNCTION nipt_pg_boss_state_of(uuid[]) TO app_rw;
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='worker_rw') THEN
  GRANT SELECT ON worker_queue_retry_request TO worker_rw;
  GRANT SELECT,INSERT ON worker_queue_retry_outcome TO worker_rw;
 END IF;
END $$;

-- Redacted read of the HIS transfer journal for the Admin queue page: state, attempts, last event code and time only. The web role has
-- no privilege on p6_transfer (it holds file names, destinations and the report plan), so this is the only way the page can see it.
CREATE FUNCTION nipt_his_transfer_overview() RETURNS TABLE(id uuid,transfer_state text,attempts integer,last_code text,created_at timestamptz)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT t.id,t.model->>'state',(t.model->>'attempts')::int,t.model->'log'->-1->>'code',t.created_at FROM public.p6_transfer t
$$;
REVOKE ALL ON FUNCTION nipt_his_transfer_overview() FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='app_rw') THEN GRANT EXECUTE ON FUNCTION nipt_his_transfer_overview() TO app_rw; END IF;
END $$;
