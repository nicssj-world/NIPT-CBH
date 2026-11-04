-- Allow the operator to restore the physical BLANK at slot 40 while revising
-- an already printed Task List. History stays append-only and the next print
-- creates a new immutable placement revision.
CREATE OR REPLACE FUNCTION lab_slot40_mode_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 PERFORM 1 FROM lab_batch WHERE id=NEW.batch_id FOR UPDATE;
 IF NOT EXISTS(
  SELECT 1 FROM lab_task_sheet
  WHERE batch_id=NEW.batch_id AND sheet_number=3
   AND state IN ('Draft','PlanChecked','Amended')
   AND (placement_revision=0 OR state='Amended')
 ) OR EXISTS(
  SELECT 1 FROM lab_slot_assignment
  WHERE batch_id=NEW.batch_id AND slot_number=40 AND removed_at IS NULL
 ) THEN RAISE EXCEPTION 'SLOT40_MODE_LOCKED'; END IF;
 RETURN NEW;
END $$;
