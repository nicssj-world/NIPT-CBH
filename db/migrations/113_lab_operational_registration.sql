-- Owner LAB-01: paper request/consent are intake markers, never fabricated clinical/signature evidence.
CREATE TABLE lab_operational_registration(
 round_id uuid PRIMARY KEY REFERENCES specimen_round,
 case_id uuid NOT NULL REFERENCES nipt_case,
 ga_weeks integer NOT NULL CHECK(ga_weeks BETWEEN 0 AND 45),ga_days integer NOT NULL CHECK(ga_days BETWEEN 0 AND 6),
 edd date NOT NULL,pregnancy text NOT NULL CHECK(pregnancy IN ('Singleton','Twins')),
 doctor_version_id uuid REFERENCES p2_doctor_version,
 paper_request boolean NOT NULL CHECK(paper_request),paper_consent boolean NOT NULL CHECK(paper_consent),
 input_sha256 text NOT NULL CHECK(input_sha256 ~ '^[a-f0-9]{64}$'),
 actor_id uuid NOT NULL REFERENCES app_user,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(round_id,case_id) REFERENCES specimen_round(id,case_id)
);
CREATE TRIGGER lab_operational_registration_immutable BEFORE UPDATE OR DELETE ON lab_operational_registration FOR EACH ROW EXECUTE FUNCTION immutable_row();
CREATE FUNCTION lab_registration_origin_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM nipt_case WHERE id=NEW.case_id AND registration_origin='LAB_DIRECT') THEN RAISE EXCEPTION 'LAB_DIRECT_ORIGIN_REQUIRED'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER lab_registration_origin_guard BEFORE INSERT ON lab_operational_registration FOR EACH ROW EXECUTE FUNCTION lab_registration_origin_guard();
DO $$ BEGIN IF EXISTS(SELECT FROM pg_roles WHERE rolname='app_rw') THEN GRANT SELECT,INSERT ON lab_operational_registration TO app_rw; END IF;
IF EXISTS(SELECT FROM pg_roles WHERE rolname='worker_rw') THEN GRANT SELECT ON lab_operational_registration TO worker_rw; END IF; END $$;
