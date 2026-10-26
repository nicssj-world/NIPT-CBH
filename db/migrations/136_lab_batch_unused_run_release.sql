-- OWNER-LAB-030: one trash action per Batch. A Batch that was never printed/executed and holds no evidence may give its
-- Run number back (no gaps in Run numbering); the row, its events and audit stay as history. Executed or evidenced
-- Batches keep their number for ever. Forward-only; no existing row is released by this migration (a pre-existing
-- cancelled Run, e.g. an Owner-created test Run, needs the Owner's decision before its number is reused).
ALTER TABLE lab_batch ADD COLUMN run_released_at timestamptz, ADD COLUMN run_released_by uuid REFERENCES app_user,
 ADD CONSTRAINT lab_batch_run_release_pair CHECK((run_released_at IS NULL)=(run_released_by IS NULL));
ALTER TABLE lab_batch DROP CONSTRAINT lab_batch_run_label_key;
ALTER TABLE lab_batch DROP CONSTRAINT lab_batch_run_year_run_number_key;
CREATE UNIQUE INDEX lab_batch_run_label_active ON lab_batch(run_label) WHERE run_released_at IS NULL;
CREATE UNIQUE INDEX lab_batch_run_number_active ON lab_batch(run_year,run_number) WHERE run_released_at IS NULL;

CREATE FUNCTION lab_batch_run_release_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF OLD.run_released_at IS NOT NULL AND (NEW.run_released_at IS DISTINCT FROM OLD.run_released_at OR NEW.run_released_by IS DISTINCT FROM OLD.run_released_by) THEN RAISE EXCEPTION 'RUN_RELEASE_IMMUTABLE'; END IF;
 IF NEW.run_year<>OLD.run_year OR NEW.run_number<>OLD.run_number OR NEW.run_label<>OLD.run_label THEN RAISE EXCEPTION 'RUN_IDENTITY_IMMUTABLE'; END IF;
 IF OLD.run_released_at IS NULL AND NEW.run_released_at IS NOT NULL THEN
  IF NEW.state<>'Cancelled' THEN RAISE EXCEPTION 'RUN_RELEASE_REQUIRES_CANCELLED'; END IF;
  IF EXISTS(SELECT 1 FROM lab_task_sheet WHERE batch_id=NEW.id AND placement_revision>0)
   OR EXISTS(SELECT 1 FROM lab_placement_snapshot WHERE batch_id=NEW.id)
   OR EXISTS(SELECT 1 FROM lab_slot_assignment WHERE batch_id=NEW.id AND removed_at IS NULL)
   OR EXISTS(SELECT 1 FROM lab_document WHERE batch_id=NEW.id)
   OR EXISTS(SELECT 1 FROM lab_observation WHERE batch_id=NEW.id)
   OR EXISTS(SELECT 1 FROM task_workbook_revision WHERE batch_id=NEW.id)
   OR EXISTS(SELECT 1 FROM p4b_pool_attempt WHERE batch_id=NEW.id)
   OR EXISTS(SELECT 1 FROM p4c_dnb_attempt WHERE batch_id=NEW.id)
   OR EXISTS(SELECT 1 FROM lab_actual_pooling WHERE batch_id=NEW.id)
   OR EXISTS(SELECT 1 FROM lab_bench_export WHERE batch_id=NEW.id)
   OR EXISTS(SELECT 1 FROM lab_seq_export_pair WHERE batch_id=NEW.id)
   OR EXISTS(SELECT 1 FROM run_photo WHERE batch_id=NEW.id)
  THEN RAISE EXCEPTION 'RUN_RELEASE_REQUIRES_UNUSED_BATCH'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER lab_batch_run_release_guard BEFORE UPDATE ON lab_batch FOR EACH ROW EXECUTE FUNCTION lab_batch_run_release_guard();
