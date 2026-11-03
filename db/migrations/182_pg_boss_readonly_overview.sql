-- v1.1.3 Worker Queue: read-only pg-boss inventory for the Admin queue page. No payload (data/output),
-- no singleton key and no mutation. Column names follow pg-boss 12 (pgboss.job: created_on,
-- start_after, retry_count); pg-boss creates its schema at Worker start, possibly after this
-- migration, so the query is dynamic and returns nothing when pgboss.job does not exist.
-- pg-boss jobs are cancelled or retried only by the Worker through the pg-boss API, never by SQL here.
CREATE FUNCTION nipt_pg_boss_counts()
 RETURNS TABLE(kind text,job_state text,job_count integer)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF to_regclass('pgboss.job') IS NULL THEN RETURN; END IF;
 RETURN QUERY EXECUTE
  'SELECT j.name::text,j.state::text,count(*)::int FROM pgboss.job j GROUP BY j.name,j.state ORDER BY j.name,j.state';
END $$;

CREATE FUNCTION nipt_pg_boss_recent(p_limit integer DEFAULT 75)
 RETURNS TABLE(job_id uuid,kind text,job_state text,created_on timestamptz,start_after timestamptz,retry_count integer)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF p_limit IS NULL OR p_limit<1 OR p_limit>200 THEN RAISE EXCEPTION 'QUEUE_PAGE_SIZE_INVALID'; END IF;
 IF to_regclass('pgboss.job') IS NULL THEN RETURN; END IF;
 RETURN QUERY EXECUTE
  'SELECT j.id,j.name::text,j.state::text,j.created_on,j.start_after,j.retry_count::int FROM pgboss.job j ORDER BY j.created_on DESC,j.id DESC LIMIT $1'
  USING p_limit;
END $$;

REVOKE ALL ON FUNCTION nipt_pg_boss_counts(),nipt_pg_boss_recent(integer) FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='app_rw') THEN
  GRANT EXECUTE ON FUNCTION nipt_pg_boss_counts() TO app_rw;
  GRANT EXECUTE ON FUNCTION nipt_pg_boss_recent(integer) TO app_rw;
 END IF;
END $$;
