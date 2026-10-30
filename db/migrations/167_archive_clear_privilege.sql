-- Application callers may request only this bounded transition; they cannot
-- directly rewrite archive state or worker-owned claim/publication fields.
CREATE FUNCTION request_archive_queue_clear(p_job uuid,p_actor uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.role_assignment WHERE user_id=p_actor AND role='APP_ADMIN') THEN
  RAISE EXCEPTION 'FORBIDDEN';
 END IF;
 UPDATE public.pdf_archive_job SET cancellation_requested_at=clock_timestamp(),updated_at=clock_timestamp(),
  state=CASE WHEN claim_token IS NULL THEN 'CANCELLED' ELSE state END
 WHERE id=p_job AND state IN ('PENDING','FAILED');
END $$;
REVOKE ALL ON FUNCTION request_archive_queue_clear(uuid,uuid) FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='app_rw') THEN
  REVOKE UPDATE(state,cancellation_requested_at,updated_at) ON pdf_archive_job FROM app_rw;
  GRANT EXECUTE ON FUNCTION request_archive_queue_clear(uuid,uuid) TO app_rw;
 END IF;
END $$;
