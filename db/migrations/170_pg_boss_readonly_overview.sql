-- v1.1.3 P1: read-only pg-boss inventory. No job payload, credentials,
-- PII or direct job mutation is exposed to the application role.
-- pg-boss may be initialized AFTER app migrations, so use a bounded dynamic
-- query and return empty results when the queue schema is not yet created.
CREATE FUNCTION nipt_pg_boss_counts()
 RETURNS TABLE(kind text,job_state text,job_count integer)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 BEGIN
  IF to_regclass('pgboss.job') IS NULL THEN RETURN; END IF;
  RETURN QUERY EXECUTE
   'SELECT j.name::text,j.state::text,count(*)::int FROM pgboss.job j GROUP BY j.name,j.state ORDER BY j.name,j.state';
 END $$;
CREATE FUNCTION nipt_pg_boss_recent(p_limit integer DEFAULT 75)
 RETURNS TABLE(job_id uuid,kind text,job_state text,created_at timestamptz,
               start_after timestamptz,retry_count integer)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 BEGIN
  IF p_limit<1 OR p_limit>200 THEN RAISE EXCEPTION 'QUEUE_PAGE_SIZE_INVALID'; END IF;
  IF to_regclass('pgboss.job') IS NULL THEN RETURN; END IF;
  RETURN QUERY EXECUTE
   'SELECT j.id,j.name::text,j.state::text,j.createdon,j.startafter,j.retrycount::integer FROM pgboss.job j ORDER BY j.createdon DESC,j.id DESC LIMIT $1'
  USING p_limit;
 END $$;
REVOKE ALL ON FUNCTION nipt_pg_boss_counts(),nipt_pg_boss_recent(integer) FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='app_rw') THEN
  GRANT EXECUTE ON FUNCTION nipt_pg_boss_counts() TO app_rw;
  GRANT EXECUTE ON FUNCTION nipt_pg_boss_recent(integer) TO app_rw;
 END IF;
END $$;
