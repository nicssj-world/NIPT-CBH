-- A registry reservation is not a claim of receipt. Existing normal provenance stays unchanged.
ALTER TABLE specimen_lab_number DROP CONSTRAINT specimen_lab_number_issued_on_check;
ALTER TABLE specimen_lab_number ADD CONSTRAINT specimen_lab_number_issued_on_check CHECK(issued_on IN ('HIS_PET_RECEIPT','NIPT_LOCAL_RECEIPT','MIGRATION_SOURCE'));
ALTER TABLE specimen_lab_number DROP CONSTRAINT specimen_lab_number_issue_path_check;
ALTER TABLE specimen_lab_number ADD CONSTRAINT specimen_lab_number_issue_path_check CHECK(issue_path IN ('RECEIPT_TRIGGER','RECEIPT_RECOVERY','MIGRATION_IMPORT'));
CREATE FUNCTION migration_number_provenance_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.issue_path='MIGRATION_IMPORT' OR NEW.issued_on='MIGRATION_SOURCE' THEN
  IF NEW.issue_path<>'MIGRATION_IMPORT' OR NEW.issued_on<>'MIGRATION_SOURCE' OR NOT EXISTS(
   SELECT 1 FROM migration_record r WHERE r.case_id=NEW.case_id AND r.round_id=NEW.round_id AND r.state<>'EXCEPTION'
    AND substring(r.ln_halos from '^([0-9]{2}B[0-9]{9})')=NEW.ln_halos
  ) THEN RAISE EXCEPTION 'MIGRATION_NUMBER_SOURCE_REQUIRED'; END IF;
 END IF;
 RETURN NEW; END $$;
CREATE TRIGGER migration_number_provenance_guard BEFORE INSERT ON specimen_lab_number FOR EACH ROW EXECUTE FUNCTION migration_number_provenance_guard();
CREATE TABLE migration_pet_binding(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),record_id uuid NOT NULL UNIQUE REFERENCES migration_record,
 inbound_file_id uuid NOT NULL REFERENCES his_inbound_file,source_sha256 text NOT NULL REFERENCES file_asset(sha256),
 ward text NOT NULL,unit_id uuid NOT NULL REFERENCES unit,created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER migration_pet_binding_immutable BEFORE UPDATE OR DELETE ON migration_pet_binding FOR EACH ROW EXECUTE FUNCTION immutable_row();
REVOKE ALL ON migration_pet_binding FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS(SELECT FROM pg_roles WHERE rolname='app_rw') THEN GRANT SELECT,INSERT ON migration_pet_binding TO app_rw; END IF;
 IF EXISTS(SELECT FROM pg_roles WHERE rolname='worker_rw') THEN GRANT SELECT ON migration_pet_binding TO worker_rw; END IF;
 IF EXISTS(SELECT FROM pg_roles WHERE rolname='report_ro') THEN GRANT SELECT ON migration_pet_binding TO report_ro; END IF;
END $$;
