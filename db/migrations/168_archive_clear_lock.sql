CREATE FUNCTION lock_archive_queue_for_clear(p_actor uuid,p_ids uuid[] DEFAULT NULL)
RETURNS TABLE(id uuid,state text,completed boolean,claimed boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.role_assignment WHERE user_id=p_actor AND role='APP_ADMIN') THEN
  RAISE EXCEPTION 'FORBIDDEN';
 END IF;
 RETURN QUERY SELECT j.id,j.state,j.state='ARCHIVED',j.claim_token IS NOT NULL
  FROM public.pdf_archive_job j
  WHERE (p_ids IS NULL OR j.id=ANY(p_ids))
   AND NOT EXISTS(SELECT 1 FROM public.worker_queue_clear_event e WHERE e.scope='ARCHIVE' AND e.job_id=j.id)
  ORDER BY j.created_at,j.id FOR UPDATE OF j;
END $$;
REVOKE ALL ON FUNCTION lock_archive_queue_for_clear(uuid,uuid[]) FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='app_rw') THEN
  GRANT EXECUTE ON FUNCTION lock_archive_queue_for_clear(uuid,uuid[]) TO app_rw;
 END IF;
END $$;
