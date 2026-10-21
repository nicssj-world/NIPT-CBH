-- LAB-05: operator-confirmed paper work is provenance, never invented native QC/measurements or a release.
CREATE TABLE lab_manual_paper_stage(
 sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,draft_id uuid NOT NULL REFERENCES historical_draft,
 stage text NOT NULL CHECK(stage IN ('TASK_LIST','QC','POOLING','SEQUENCING')),
 performed boolean NOT NULL,actor_id uuid NOT NULL REFERENCES app_user,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER lab_manual_paper_stage_immutable BEFORE UPDATE OR DELETE ON lab_manual_paper_stage FOR EACH ROW EXECUTE FUNCTION immutable_row();
DO $$ BEGIN IF EXISTS(SELECT FROM pg_roles WHERE rolname='app_rw') THEN
 GRANT SELECT,INSERT ON lab_manual_paper_stage TO app_rw;GRANT USAGE ON SEQUENCE lab_manual_paper_stage_sequence_seq TO app_rw;
END IF; END $$;
