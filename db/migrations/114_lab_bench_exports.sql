-- Every bench export binds a persisted workbook/QC revision. Prior files remain immutable evidence.
CREATE TABLE lab_bench_export(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),batch_id uuid NOT NULL REFERENCES lab_batch,
 workbook_revision_id uuid NOT NULL REFERENCES task_workbook_revision,
 kind text NOT NULL CHECK(kind IN ('POOL_CSV','NIFTY_XLSX')),
 source_sha256 text NOT NULL CHECK(source_sha256 ~ '^[a-f0-9]{64}$'),
 file_sha256 text NOT NULL CHECK(file_sha256 ~ '^[a-f0-9]{64}$'),
 mapping jsonb NOT NULL DEFAULT '[]',created_by uuid NOT NULL REFERENCES app_user,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER lab_bench_export_immutable BEFORE UPDATE OR DELETE ON lab_bench_export FOR EACH ROW EXECUTE FUNCTION immutable_row();
DO $$ BEGIN IF EXISTS(SELECT FROM pg_roles WHERE rolname='app_rw') THEN GRANT SELECT,INSERT ON lab_bench_export TO app_rw; END IF; END $$;
