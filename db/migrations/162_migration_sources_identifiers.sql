-- Owner migration lock 2026-10-26: staging never certifies or creates clinical evidence.
CREATE TABLE migration_execution(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),plan_digest text NOT NULL UNIQUE CHECK(plan_digest ~ '^[a-f0-9]{64}$'),
 plan jsonb NOT NULL,created_by uuid NOT NULL REFERENCES app_user,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 state text NOT NULL DEFAULT 'RUNNING' CHECK(state IN ('RUNNING','CANCELLED','COMPLETED','PARTIAL')),
 backup_evidence jsonb,watermark jsonb,pet_source jsonb,last_error text,row_version integer NOT NULL DEFAULT 0
);
CREATE TABLE migration_source(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),execution_id uuid NOT NULL REFERENCES migration_execution,
 kind text NOT NULL CHECK(kind IN ('GENOMIC_MAPPING','HALOS_RUN','PET_ARCHIVE','FINAL_PDF')),
 sha256 text NOT NULL REFERENCES file_asset(sha256),original_name text NOT NULL,run_label text,
 UNIQUE(execution_id,kind,sha256)
);
CREATE TABLE migration_record(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),execution_id uuid NOT NULL REFERENCES migration_execution,
 source_key text NOT NULL,row_number integer NOT NULL CHECK(row_number>=2),ln text NOT NULL,ln_halos text NOT NULL,
 classification text NOT NULL CHECK(classification IN ('NO_HALOS','RERUN','QUALIFIED_PDF_PENDING','PDF_REVIEW','CERTIFIED_RELEASED')),
 his_pdf_exists boolean NOT NULL DEFAULT false,row_version integer NOT NULL DEFAULT 0,
 state text NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','IMPORTED','EXCEPTION')),
 exceptions jsonb NOT NULL DEFAULT '[]',case_id uuid REFERENCES nipt_case,round_id uuid,attempt_id uuid REFERENCES analytical_attempt,
 UNIQUE(execution_id,source_key),FOREIGN KEY(round_id,case_id) REFERENCES specimen_round(id,case_id),
 CHECK(round_id IS NULL OR case_id IS NOT NULL)
);
CREATE INDEX migration_record_ln ON migration_record(ln);
CREATE TABLE migration_execution_record(
 execution_id uuid NOT NULL REFERENCES migration_execution,record_id uuid NOT NULL REFERENCES migration_record,
 source_key text NOT NULL,row_number integer NOT NULL,PRIMARY KEY(execution_id,source_key),UNIQUE(execution_id,record_id)
);
CREATE UNIQUE INDEX migration_reserved_ln ON migration_record(ln) WHERE state<>'EXCEPTION';
CREATE UNIQUE INDEX migration_reserved_halos ON migration_record(ln_halos) WHERE state<>'EXCEPTION';
CREATE TABLE migration_record_event(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),record_id uuid NOT NULL REFERENCES migration_record,
 actor_id uuid REFERENCES app_user,event text NOT NULL,details jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER migration_record_event_immutable BEFORE UPDATE OR DELETE ON migration_record_event FOR EACH ROW EXECUTE FUNCTION immutable_row();
CREATE FUNCTION migration_record_identity_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF (NEW.execution_id,NEW.source_key,NEW.row_number,NEW.ln,NEW.ln_halos) IS DISTINCT FROM (OLD.execution_id,OLD.source_key,OLD.row_number,OLD.ln,OLD.ln_halos)
 THEN RAISE EXCEPTION 'MIGRATION_SOURCE_IDENTITY_IMMUTABLE'; END IF;
 IF OLD.case_id IS NOT NULL AND (NEW.case_id,NEW.round_id) IS DISTINCT FROM (OLD.case_id,OLD.round_id) THEN RAISE EXCEPTION 'MIGRATION_BINDING_IMMUTABLE'; END IF;
 IF NEW.attempt_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM analytical_attempt WHERE id=NEW.attempt_id AND case_id=NEW.case_id AND round_id=NEW.round_id) THEN RAISE EXCEPTION 'MIGRATION_ATTEMPT_LINEAGE_INVALID'; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER migration_record_identity_guard BEFORE UPDATE ON migration_record FOR EACH ROW EXECUTE FUNCTION migration_record_identity_guard();
CREATE TRIGGER migration_source_immutable BEFORE UPDATE OR DELETE ON migration_source FOR EACH ROW EXECUTE FUNCTION immutable_row();
REVOKE ALL ON migration_execution,migration_source,migration_record,migration_record_event,migration_execution_record FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS(SELECT FROM pg_roles WHERE rolname='app_rw') THEN
  GRANT SELECT,INSERT,UPDATE ON migration_execution,migration_record TO app_rw;
  GRANT SELECT,INSERT ON migration_source,migration_record_event TO app_rw;
  GRANT SELECT,INSERT ON migration_execution_record TO app_rw;
 END IF;
 IF EXISTS(SELECT FROM pg_roles WHERE rolname='worker_rw') THEN GRANT SELECT ON migration_record,migration_execution,migration_source TO worker_rw; END IF;
 IF EXISTS(SELECT FROM pg_roles WHERE rolname='report_ro') THEN GRANT SELECT ON migration_execution,migration_record,migration_source,migration_record_event TO report_ro; END IF;
END $$;
