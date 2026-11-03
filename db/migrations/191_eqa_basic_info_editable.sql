-- Owner 2026-11-03: the basic data of an EQA specimen (name, date of birth, gestational age, collection date, pregnancy type, note) is entered on the specimen's page and
-- printed on the report, so it can be corrected until a report exists. Identity (organizer, programme year, sample reference, round, registrar) stays append-only.
CREATE FUNCTION eqa_case_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$ BEGIN
 IF TG_OP='UPDATE'
  AND (to_jsonb(NEW)-'surname'-'first_name'-'dob'-'ga_weeks'-'ga_days'-'collection_date'-'pregnancy'-'note')=(to_jsonb(OLD)-'surname'-'first_name'-'dob'-'ga_weeks'-'ga_days'-'collection_date'-'pregnancy'-'note') THEN
  IF EXISTS(SELECT 1 FROM result_report_version WHERE case_id=OLD.case_id) THEN RAISE EXCEPTION 'EQA_INFO_LOCKED_AFTER_REPORT'; END IF;
  RETURN NEW;
 END IF;
 RAISE EXCEPTION 'append-only record';
END $$;
DROP TRIGGER eqa_case_immutable ON eqa_case;
CREATE TRIGGER eqa_case_guard BEFORE UPDATE OR DELETE ON eqa_case FOR EACH ROW EXECUTE FUNCTION eqa_case_guard();
DO $$ BEGIN IF EXISTS(SELECT FROM pg_roles WHERE rolname='app_rw') THEN
 GRANT UPDATE(surname,first_name,dob,ga_weeks,ga_days,collection_date,pregnancy,note) ON eqa_case TO app_rw;
 END IF; END $$;
