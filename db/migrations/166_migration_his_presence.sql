-- Case-bound declaration can exist before a PDF. Changing it is never a send command.
CREATE OR REPLACE FUNCTION task3_his_presence_attested(version uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM result_his_attestation WHERE version_id=version AND withdrawn_at IS NULL)
 OR EXISTS(SELECT 1 FROM migration_record m JOIN result_report_version v ON (v.case_id,v.round_id,v.attempt_id)=(m.case_id,m.round_id,m.attempt_id) WHERE v.id=version AND m.his_pdf_exists AND v.supersedes_id IS NULL)
$$;
ALTER FUNCTION p6_release_eligible(uuid,integer) RENAME TO migration_presence_unfiltered_release_eligible;
CREATE FUNCTION p6_release_eligible(rid uuid,expected_epoch integer) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT migration_presence_unfiltered_release_eligible(rid,expected_epoch) AND NOT EXISTS(SELECT 1 FROM result_release r WHERE r.id=rid AND task3_his_presence_attested(r.version_id))
$$;
CREATE FUNCTION migration_his_presence_lock() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.his_pdf_exists IS DISTINCT FROM OLD.his_pdf_exists THEN
 PERFORM r.id FROM result_release r JOIN result_report_version v ON v.id=r.version_id WHERE (v.case_id,v.round_id,v.attempt_id)=(NEW.case_id,NEW.round_id,NEW.attempt_id) AND v.supersedes_id IS NULL ORDER BY r.id FOR UPDATE OF r;
 IF EXISTS(SELECT 1 FROM p6_transfer t JOIN result_release r ON r.id=t.clinical_release_id JOIN result_report_version v ON v.id=r.version_id WHERE (v.case_id,v.round_id,v.attempt_id)=(NEW.case_id,NEW.round_id,NEW.attempt_id) AND v.supersedes_id IS NULL) THEN RAISE EXCEPTION 'MIGRATION_HIS_TRANSFER_RECONCILIATION_REQUIRED'; END IF;
 END IF; RETURN NEW;
END $$;
CREATE TRIGGER migration_his_presence_lock BEFORE UPDATE OF his_pdf_exists ON migration_record FOR EACH ROW EXECUTE FUNCTION migration_his_presence_lock();
REVOKE ALL ON FUNCTION migration_presence_unfiltered_release_eligible(uuid,integer),p6_release_eligible(uuid,integer) FROM PUBLIC;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='app_rw') THEN GRANT EXECUTE ON FUNCTION p6_release_eligible(uuid,integer) TO app_rw; END IF; IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='worker_rw') THEN GRANT EXECUTE ON FUNCTION p6_release_eligible(uuid,integer) TO worker_rw; END IF; END $$;
