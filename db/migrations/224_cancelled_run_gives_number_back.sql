-- Owner 2026-11-12: every cancelled Run gives its Run number back so the next Batch reuses the lowest free number, whether or not
-- the Run held specimens (they return to the queue). Replaces the 136/142 guard that refused a release once a Run was placed,
-- had a document or a workbook. A Run that has recorded bench work can never be cancelled (CANCEL_ONLY_BEFORE_EXECUTION), and the
-- guard below still refuses a release when execution evidence exists. The row, events and audit stay as history; identity stays immutable.
-- Forward-only. No existing row is released by this migration: a Run cancelled earlier (e.g. Run007/2026) needs a separate Owner-approved step.
CREATE OR REPLACE FUNCTION lab_batch_run_release_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF OLD.run_released_at IS NOT NULL AND (NEW.run_released_at IS DISTINCT FROM OLD.run_released_at OR NEW.run_released_by IS DISTINCT FROM OLD.run_released_by) THEN RAISE EXCEPTION 'RUN_RELEASE_IMMUTABLE'; END IF;
 IF NEW.run_year<>OLD.run_year OR NEW.run_number<>OLD.run_number OR NEW.run_label<>OLD.run_label THEN RAISE EXCEPTION 'RUN_IDENTITY_IMMUTABLE'; END IF;
 IF OLD.run_released_at IS NULL AND NEW.run_released_at IS NOT NULL THEN
  IF NEW.state<>'Cancelled' THEN RAISE EXCEPTION 'RUN_RELEASE_REQUIRES_CANCELLED'; END IF;
  IF EXISTS(SELECT 1 FROM lab_slot_assignment WHERE batch_id=NEW.id AND removed_at IS NULL)
   OR EXISTS(SELECT 1 FROM lab_observation WHERE batch_id=NEW.id)
   OR EXISTS(SELECT 1 FROM p4b_pool_attempt WHERE batch_id=NEW.id)
   OR EXISTS(SELECT 1 FROM p4c_dnb_attempt WHERE batch_id=NEW.id)
   OR EXISTS(SELECT 1 FROM lab_actual_pooling WHERE batch_id=NEW.id)
   OR EXISTS(SELECT 1 FROM lab_bench_export WHERE batch_id=NEW.id)
   OR EXISTS(SELECT 1 FROM lab_seq_export_pair WHERE batch_id=NEW.id)
  THEN RAISE EXCEPTION 'RUN_RELEASE_REQUIRES_UNUSED_BATCH'; END IF;
 END IF;
 RETURN NEW;
END $$;
