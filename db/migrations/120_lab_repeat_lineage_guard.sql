-- LAB-13: repeat assignment updates repeat_work_order. A generic trigger must not
-- resolve analytical_attempt-only record fields while running on that table.
-- Preserve every immutable lineage constraint; only separate the table branch.
CREATE OR REPLACE FUNCTION work_lineage_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.case_id<>OLD.case_id OR NEW.round_id<>OLD.round_id THEN RAISE EXCEPTION 'immutable work lineage'; END IF;
 IF TG_TABLE_NAME='analytical_attempt' THEN
  IF NEW.repeat_order_id IS DISTINCT FROM OLD.repeat_order_id OR NEW.attempt_number<>OLD.attempt_number THEN RAISE EXCEPTION 'immutable attempt lineage'; END IF;
 END IF;
 RETURN NEW;
END $$;
