-- Permit the existing final publication barrier to lock a release without granting Worker release writes.
CREATE FUNCTION p6_lock_current_release(rid uuid,expected_epoch integer) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 PERFORM id FROM public.result_release WHERE id=rid FOR UPDATE;
 RETURN public.p6_release_eligible(rid,expected_epoch);
END $$;
REVOKE ALL ON FUNCTION p6_lock_current_release(uuid,integer) FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='worker_rw') THEN
  GRANT EXECUTE ON FUNCTION p6_lock_current_release(uuid,integer) TO worker_rw;
 END IF;
END $$;
