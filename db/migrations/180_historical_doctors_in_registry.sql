-- Owner decision 2026-11-02: the doctors of the historical cases belong in the ordinary doctor registry (p2_doctor_version), not in a separate list.
-- Genomic-CBH holds no unit and no signature for them, and none is invented: a doctor may therefore exist without either. Such a doctor is listed and
-- searchable like any other but is NOT selectable on a request until an administrator adds the signature (activeDoctor already requires it).
ALTER TABLE p2_doctor_version ALTER COLUMN unit_id DROP NOT NULL;
ALTER TABLE p2_doctor_version ALTER COLUMN signature DROP NOT NULL;
ALTER TABLE p2_doctor_version ALTER COLUMN signature_png DROP NOT NULL;
ALTER TABLE p2_doctor_version ALTER COLUMN signature_hash DROP NOT NULL;
-- which registry doctor each name written on the Genomic-CBH reports became (several spellings of one doctor map to one registry entry)
CREATE TABLE migration_doctor_registry(
 migration_doctor_id uuid PRIMARY KEY REFERENCES migration_doctor,doctor_version_id uuid NOT NULL REFERENCES p2_doctor_version,
 created_by uuid NOT NULL REFERENCES app_user,created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER migration_doctor_registry_immutable BEFORE UPDATE OR DELETE ON migration_doctor_registry FOR EACH ROW EXECUTE FUNCTION immutable_row();
REVOKE ALL ON migration_doctor_registry FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS(SELECT FROM pg_roles WHERE rolname='app_rw') THEN GRANT SELECT,INSERT ON migration_doctor_registry TO app_rw; END IF;
 IF EXISTS(SELECT FROM pg_roles WHERE rolname='worker_rw') THEN GRANT SELECT ON migration_doctor_registry TO worker_rw; END IF;
 IF EXISTS(SELECT FROM pg_roles WHERE rolname='report_ro') THEN GRANT SELECT ON migration_doctor_registry TO report_ro; END IF;
END $$;
