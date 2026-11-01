CREATE TABLE migration_historical_run(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),execution_id uuid NOT NULL REFERENCES migration_execution,
 run_year integer NOT NULL,run_number integer NOT NULL CHECK(run_number>0),run_label text NOT NULL UNIQUE,
 source_sha256 text NOT NULL REFERENCES file_asset(sha256),UNIQUE(run_year,run_number),
 CHECK(run_label='Run'||lpad(run_number::text,3,'0')||'/'||run_year::text)
);
CREATE FUNCTION migration_run_reservation_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 PERFORM pg_advisory_xact_lock(75432811);
 IF EXISTS(SELECT 1 FROM lab_batch WHERE run_year=NEW.run_year AND run_number=NEW.run_number AND run_released_at IS NULL) THEN RAISE EXCEPTION 'MIGRATION_RUN_CONFLICT'; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER migration_run_reservation_guard BEFORE INSERT ON migration_historical_run FOR EACH ROW EXECUTE FUNCTION migration_run_reservation_guard();
CREATE TRIGGER migration_historical_run_immutable BEFORE UPDATE OR DELETE ON migration_historical_run FOR EACH ROW EXECUTE FUNCTION immutable_row();
CREATE TABLE migration_analysis(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),record_id uuid REFERENCES migration_record,source_id uuid NOT NULL REFERENCES migration_source,
 analysis_key text NOT NULL UNIQUE,sheet text NOT NULL CHECK(sheet IN ('result','repeat','sampleinfo')),row_number integer NOT NULL CHECK(row_number>=2),
 run_label text NOT NULL,chip_id text,lane_id text,barcode_id text,sample_raw text NOT NULL,
 attempt_number integer CHECK(attempt_number>0),classification text NOT NULL CHECK(classification IN ('ANALYSIS','CONTROL','TECHNICAL_REPEAT','UNRESOLVED','SAMPLEINFO')),
 advice_status text NOT NULL CHECK(advice_status IN ('QUALIFIED','RERUN','REVIEW')),raw jsonb NOT NULL,values jsonb NOT NULL,
 sampleinfo jsonb,interpretation jsonb,previous_key text,superseded_by text,origin_analysis_key text,is_current boolean NOT NULL DEFAULT false,
 attempt_id uuid REFERENCES analytical_attempt,UNIQUE(source_id,sheet,row_number)
);
CREATE INDEX migration_analysis_record ON migration_analysis(record_id,is_current);
CREATE FUNCTION migration_analysis_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='UPDATE' AND (to_jsonb(NEW)-ARRAY['attempt_id','is_current','superseded_by']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['attempt_id','is_current','superseded_by']) THEN RAISE EXCEPTION 'MIGRATION_ANALYSIS_IMMUTABLE'; END IF;
 IF TG_OP='UPDATE' AND OLD.attempt_id IS NOT NULL AND NEW.attempt_id IS DISTINCT FROM OLD.attempt_id THEN RAISE EXCEPTION 'MIGRATION_ANALYSIS_BINDING_IMMUTABLE'; END IF;
 IF NEW.attempt_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM migration_record r JOIN analytical_attempt a ON a.case_id=r.case_id AND a.round_id=r.round_id WHERE r.id=NEW.record_id AND a.id=NEW.attempt_id) THEN RAISE EXCEPTION 'MIGRATION_ANALYSIS_LINEAGE_INVALID'; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER migration_analysis_guard BEFORE INSERT OR UPDATE ON migration_analysis FOR EACH ROW EXECUTE FUNCTION migration_analysis_guard();
CREATE TRIGGER migration_analysis_delete_denied BEFORE DELETE ON migration_analysis FOR EACH ROW EXECUTE FUNCTION immutable_row();
-- The normal batch allocator must also enforce these reservations even for unused-number reuse.
CREATE FUNCTION migration_batch_number_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF EXISTS(SELECT 1 FROM migration_historical_run WHERE run_year=NEW.run_year AND run_number=NEW.run_number) THEN RAISE EXCEPTION 'HISTORICAL_RUN_NUMBER_RESERVED'; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER migration_batch_number_guard BEFORE INSERT ON lab_batch FOR EACH ROW EXECUTE FUNCTION migration_batch_number_guard();
REVOKE ALL ON migration_historical_run,migration_analysis FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS(SELECT FROM pg_roles WHERE rolname='app_rw') THEN GRANT SELECT,INSERT ON migration_historical_run TO app_rw;GRANT SELECT,INSERT,UPDATE ON migration_analysis TO app_rw; END IF;
 IF EXISTS(SELECT FROM pg_roles WHERE rolname='worker_rw') THEN GRANT SELECT ON migration_historical_run,migration_analysis TO worker_rw; END IF;
 IF EXISTS(SELECT FROM pg_roles WHERE rolname='report_ro') THEN GRANT SELECT ON migration_historical_run,migration_analysis TO report_ro; END IF;
END $$;
