-- Repair administration listing after app_rw grants are applied out of sequence.
-- Idempotent; preserves existing users, units, roles, requests, and test cases.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rw')
    AND to_regclass('public.admin_access_supersession') IS NOT NULL THEN
    GRANT SELECT, INSERT ON TABLE public.admin_access_supersession TO app_rw;
  END IF;
END
$$;
