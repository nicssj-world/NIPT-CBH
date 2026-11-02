-- Owner decision 2026-11-02: the doctors named on the reports issued by Genomic-CBH ("Referring Doctor:") are imported as a historical doctor registry and linked to
-- the cases whose report names them. They are NOT p2_doctor_version rows: those need a unit and a signature and can sign a request or consent, and a historical
-- doctor has neither (no unit is assumed, no signature is created, nothing is approved retroactively). A historical doctor can never order, sign or approve in NIPT-CBH.
CREATE TABLE migration_doctor(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 doctor_key text NOT NULL UNIQUE CHECK(length(doctor_key) BETWEEN 2 AND 200),
 name text NOT NULL CHECK(length(btrim(name)) BETWEEN 2 AND 200),
 source text NOT NULL DEFAULT 'GENOMIC_CBH_REPORT' CHECK(source='GENOMIC_CBH_REPORT'),
 created_by uuid NOT NULL REFERENCES app_user,created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE migration_doctor_case(
 doctor_id uuid NOT NULL REFERENCES migration_doctor,case_id uuid NOT NULL REFERENCES nipt_case,
 version_id uuid NOT NULL REFERENCES result_report_version,evidence_sha256 text NOT NULL CHECK(length(evidence_sha256)=64),
 created_by uuid NOT NULL REFERENCES app_user,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(case_id,doctor_id)
);
CREATE INDEX migration_doctor_case_doctor ON migration_doctor_case(doctor_id);
CREATE TRIGGER migration_doctor_immutable BEFORE UPDATE OR DELETE ON migration_doctor FOR EACH ROW EXECUTE FUNCTION immutable_row();
CREATE TRIGGER migration_doctor_case_immutable BEFORE UPDATE OR DELETE ON migration_doctor_case FOR EACH ROW EXECUTE FUNCTION immutable_row();
REVOKE ALL ON migration_doctor,migration_doctor_case FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS(SELECT FROM pg_roles WHERE rolname='app_rw') THEN GRANT SELECT,INSERT ON migration_doctor,migration_doctor_case TO app_rw; END IF;
 IF EXISTS(SELECT FROM pg_roles WHERE rolname='worker_rw') THEN GRANT SELECT ON migration_doctor,migration_doctor_case TO worker_rw; END IF;
 IF EXISTS(SELECT FROM pg_roles WHERE rolname='report_ro') THEN GRANT SELECT ON migration_doctor,migration_doctor_case TO report_ro; END IF;
END $$;
