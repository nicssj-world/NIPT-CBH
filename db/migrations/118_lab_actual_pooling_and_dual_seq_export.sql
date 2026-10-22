-- Owner LAB-13 amendment: direct operator evidence, not a new approval stage.
CREATE TABLE lab_actual_pooling(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),batch_id uuid NOT NULL REFERENCES lab_batch,
 workbook_revision_id uuid NOT NULL REFERENCES task_workbook_revision,
 qc_source_sha256 text NOT NULL CHECK(qc_source_sha256 ~ '^[a-f0-9]{64}$'),
 qc_values jsonb NOT NULL,placements jsonb NOT NULL,members jsonb NOT NULL CHECK(jsonb_array_length(members)=48),
 note text NOT NULL CHECK(length(trim(note))>=8),recorded_by uuid NOT NULL REFERENCES app_user,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER lab_actual_pooling_immutable BEFORE UPDATE OR DELETE ON lab_actual_pooling FOR EACH ROW EXECUTE FUNCTION immutable_row();
CREATE TRIGGER lab_actual_pooling_release_lock BEFORE INSERT ON lab_actual_pooling FOR EACH ROW EXECUTE FUNCTION lab_bench_revision_release_lock();
ALTER TABLE lab_bench_export DROP CONSTRAINT lab_bench_export_kind_check;
ALTER TABLE lab_bench_export ADD CONSTRAINT lab_bench_export_kind_check CHECK(kind IN ('POOL_CSV','NIFTY_XLSX','HALOS_TASK_XLSX'));
CREATE TABLE lab_seq_export_pair(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),batch_id uuid NOT NULL REFERENCES lab_batch,
 workbook_revision_id uuid NOT NULL REFERENCES task_workbook_revision,actual_pooling_id uuid NOT NULL REFERENCES lab_actual_pooling,
 nifty_export_id uuid NOT NULL REFERENCES lab_bench_export,halos_export_id uuid NOT NULL REFERENCES lab_bench_export,
 idempotency_key uuid NOT NULL,manifest jsonb NOT NULL,created_by uuid NOT NULL REFERENCES app_user,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(batch_id,idempotency_key)
);
CREATE TRIGGER lab_seq_export_pair_immutable BEFORE UPDATE OR DELETE ON lab_seq_export_pair FOR EACH ROW EXECUTE FUNCTION immutable_row();
CREATE FUNCTION lab_actual_pooling_current(target uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM lab_actual_pooling p JOIN lab_batch b ON b.id=p.batch_id
 JOIN LATERAL(SELECT * FROM task_workbook_revision WHERE batch_id=b.id ORDER BY revision DESC LIMIT 1) r ON true
 WHERE p.id=target AND b.state<>'Cancelled' AND NOT EXISTS(SELECT 1 FROM lab_batch_removal WHERE batch_id=b.id)
 AND p.id=(SELECT id FROM lab_actual_pooling WHERE batch_id=b.id ORDER BY recorded_at DESC,id DESC LIMIT 1)
 AND p.placements=r.source_snapshot->'placements'
 AND p.qc_values=(SELECT jsonb_object_agg(key,value) FROM jsonb_each(r.values) WHERE key ~ '^slot\.[0-9]+\.libraryQc$|^qc\.[123]\.'))
$$;
ALTER TABLE lab_bench_review ADD COLUMN actual_pooling_id uuid REFERENCES lab_actual_pooling;
ALTER TABLE lab_bench_review DROP CONSTRAINT lab_bench_review_workbook_revision_id_reviewer_id_key;
ALTER TABLE lab_bench_review ADD UNIQUE(workbook_revision_id,reviewer_id,actual_pooling_id);
CREATE OR REPLACE FUNCTION lab_bench_review_current(target uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM lab_bench_review q JOIN task_workbook_revision r ON r.id=q.workbook_revision_id
 JOIN lab_actual_pooling p ON p.id=q.actual_pooling_id AND p.batch_id=q.batch_id
 WHERE q.id=target AND r.batch_id=q.batch_id AND r.id=(SELECT id FROM task_workbook_revision WHERE batch_id=q.batch_id ORDER BY revision DESC LIMIT 1)
 AND q.source_sha256=lab_bench_revision_sha(r.id) AND lab_bench_measurements_ready(q.batch_id) AND lab_actual_pooling_current(p.id))
$$;
CREATE FUNCTION lab_bench_actual_review_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM lab_actual_pooling p WHERE p.id=NEW.actual_pooling_id AND p.batch_id=NEW.batch_id AND lab_actual_pooling_current(p.id)) THEN RAISE EXCEPTION 'ACTUAL_POOLING_CURRENT_REVIEW_REQUIRED'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER lab_bench_actual_review_guard BEFORE INSERT ON lab_bench_review FOR EACH ROW EXECUTE FUNCTION lab_bench_actual_review_guard();
CREATE FUNCTION lab_bench_attempt_actually_pooled(target uuid,pool_id uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM lab_slot_assignment a JOIN lab_actual_pooling p ON p.batch_id=a.batch_id
 CROSS JOIN LATERAL jsonb_array_elements(p.members) m WHERE a.attempt_id=target AND a.removed_at IS NULL AND p.id=pool_id
 AND lab_actual_pooling_current(p.id) AND (m->>'slot')::integer=a.slot_number AND m->>'attemptId'=target::text AND (m->>'pooled')::boolean)
$$;
DO $$ DECLARE d text; BEGIN
 SELECT pg_get_functiondef('lab_bench_qc5_valid(result_qc5_review)'::regprocedure) INTO d;
 IF position('lab_bench_review_current(q.bench_review_id)' in d)=0 THEN RAISE EXCEPTION 'ACTUAL_POOL_QC5_GUARD_SHAPE_MISMATCH'; END IF;
 d:=replace(d,'lab_bench_review_current(q.bench_review_id)','lab_bench_review_current(q.bench_review_id) AND lab_bench_attempt_actually_pooled(q.attempt_id,(SELECT actual_pooling_id FROM lab_bench_review WHERE id=q.bench_review_id))');EXECUTE d;
END $$;
DO $$ BEGIN IF EXISTS(SELECT FROM pg_roles WHERE rolname='app_rw') THEN
 GRANT SELECT,INSERT ON lab_actual_pooling,lab_seq_export_pair TO app_rw;
 END IF; END $$;
