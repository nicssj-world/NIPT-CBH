-- LAB-UAT-003: Genomic-CBH 9x9 position reference only; no retention/destruction rules.
CREATE TABLE lab_storage_box(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 box_number bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
 box_id text NOT NULL UNIQUE,
 created_by uuid NOT NULL REFERENCES app_user,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE lab_storage_position(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 box_id uuid NOT NULL REFERENCES lab_storage_box,
 slot integer NOT NULL CHECK(slot BETWEEN 1 AND 81),
 round_id uuid NOT NULL UNIQUE REFERENCES specimen_round,
 stored_by uuid NOT NULL REFERENCES app_user,
 stored_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(box_id,slot)
);
CREATE TRIGGER lab_storage_box_immutable BEFORE UPDATE OR DELETE ON lab_storage_box FOR EACH ROW EXECUTE FUNCTION immutable_row();
CREATE TRIGGER lab_storage_position_immutable BEFORE UPDATE OR DELETE ON lab_storage_position FOR EACH ROW EXECUTE FUNCTION immutable_row();
DO $$ BEGIN IF EXISTS(SELECT FROM pg_roles WHERE rolname='app_rw') THEN
 GRANT SELECT,INSERT ON lab_storage_box,lab_storage_position TO app_rw;
 GRANT USAGE,SELECT ON SEQUENCE lab_storage_box_box_number_seq TO app_rw;
END IF; END $$;
