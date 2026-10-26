-- FINAL OWNER LOCK (run photos): photos are optional and no workflow function may depend on them (tests/db/run-photos.test.ts).
-- Migration 136's run-number release guard also looked at run_photo; photos never decide whether an unused Batch gives its Run number back.
-- (The Batch row, its events and any photos stay as history.) Forward-only replacement of the function.
CREATE OR REPLACE FUNCTION lab_batch_run_release_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
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
  THEN RAISE EXCEPTION 'RUN_RELEASE_REQUIRES_UNUSED_BATCH'; END IF;
 END IF;
 RETURN NEW;
END $$;
