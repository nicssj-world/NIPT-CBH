-- Native final-master draft revisions and immutable export provenance.
CREATE TABLE task_workbook_revision(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),batch_id uuid NOT NULL REFERENCES lab_batch,
 revision integer NOT NULL CHECK(revision>0),master_sha256 text NOT NULL CHECK(master_sha256='2747a9f6c6da9231996bd9d0a23b1da3100d910209d440643c70158f7fe20722'),
 source_sha256 text NOT NULL CHECK(source_sha256~'^[a-f0-9]{64}$'),source_snapshot jsonb NOT NULL,values jsonb NOT NULL CHECK(jsonb_typeof(values)='object'),
 created_by uuid NOT NULL REFERENCES app_user,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(batch_id,revision)
);
CREATE TRIGGER task_workbook_revision_immutable BEFORE UPDATE OR DELETE ON task_workbook_revision FOR EACH ROW EXECUTE FUNCTION immutable_row();
CREATE TABLE task_workbook_export(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),revision_id uuid NOT NULL REFERENCES task_workbook_revision,
 format text NOT NULL CHECK(format IN ('XLSX','PDF')),sheet text,
 file_sha256 text NOT NULL CHECK(file_sha256~'^[a-f0-9]{64}$'),manifest jsonb NOT NULL,
 created_by uuid NOT NULL REFERENCES app_user,created_at timestamptz NOT NULL DEFAULT now(),
 CHECK((format='XLSX' AND sheet IS NULL) OR (format='PDF' AND sheet IN ('Ext. & Prep. Task List 1','Ext. & Prep. Task List 2','Ext. & Prep. Task List 3','QC measurements','Pooling Table','Seq Task-G50')))
);
CREATE TRIGGER task_workbook_export_immutable BEFORE UPDATE OR DELETE ON task_workbook_export FOR EACH ROW EXECUTE FUNCTION immutable_row();
