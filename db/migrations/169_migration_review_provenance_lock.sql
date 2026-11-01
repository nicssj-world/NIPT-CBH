-- Clinical provenance is independent from the administrative HIS checkbox row-version.
-- The review still pins the exact immutable HALOS analysis/source and official PDF lineage, with all current exceptions/holds.
DO $$ DECLARE definition text; BEGIN
 SELECT pg_get_functiondef('migration_result_review_current(uuid)'::regprocedure) INTO definition;
 IF position('AND r.record_row_version=m.row_version' in definition)=0 THEN RAISE EXCEPTION 'MIGRATION_REVIEW_VERSION_GUARD_SHAPE_MISMATCH'; END IF;
 EXECUTE replace(definition,'AND r.record_row_version=m.row_version','');
END $$;
-- Serialize source/exception changes with the existing worker's final release lock around publication.
-- Shared order with the HIS flag guard: target record row -> exact affected release rows; no case-wide inheritance.
CREATE FUNCTION migration_review_provenance_lock() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$ BEGIN
 IF (to_jsonb(NEW)-'his_pdf_exists'-'row_version') IS DISTINCT FROM (to_jsonb(OLD)-'his_pdf_exists'-'row_version') THEN
  PERFORM r.id FROM result_release r JOIN result_report_version v ON v.id=r.version_id
  WHERE r.state='Active' AND ((v.case_id,v.round_id,v.attempt_id)=(OLD.case_id,OLD.round_id,OLD.attempt_id)
   OR (v.case_id,v.round_id,v.attempt_id)=(NEW.case_id,NEW.round_id,NEW.attempt_id))
  ORDER BY r.id FOR UPDATE OF r;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER migration_review_provenance_lock BEFORE UPDATE ON migration_record FOR EACH ROW EXECUTE FUNCTION migration_review_provenance_lock();
REVOKE ALL ON FUNCTION migration_review_provenance_lock() FROM PUBLIC;
