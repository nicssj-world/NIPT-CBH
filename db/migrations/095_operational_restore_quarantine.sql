-- Restore pg_dump excludes this table's data. A missing row fails closed.
-- Source fencing and target activation are operator-only; runtime groups cannot clear it.
CREATE TABLE nipt_restore_state(singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),quarantined boolean NOT NULL DEFAULT false,restore_id text,source_fingerprint text,verified boolean NOT NULL DEFAULT false);
INSERT INTO nipt_restore_state(singleton,quarantined) VALUES(true,false);
REVOKE ALL ON nipt_restore_state FROM PUBLIC;
CREATE FUNCTION nipt_runtime_quarantined() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$ SELECT coalesce((SELECT quarantined FROM public.nipt_restore_state WHERE singleton),true) $$;
REVOKE ALL ON FUNCTION nipt_runtime_quarantined() FROM PUBLIC;
DO $$ DECLARE r text; BEGIN FOREACH r IN ARRAY ARRAY['app_rw','worker_rw','report_ro'] LOOP
 IF EXISTS(SELECT FROM pg_roles WHERE rolname=r) THEN EXECUTE format('GRANT EXECUTE ON FUNCTION nipt_runtime_quarantined() TO %I',r); END IF;
END LOOP; END $$;
