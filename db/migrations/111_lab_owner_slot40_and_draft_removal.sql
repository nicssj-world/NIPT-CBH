-- Owner LAB-06/LAB-09. Keep original physical slot rows and all history immutable.
CREATE TABLE lab_slot40_mode(
 sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 batch_id uuid NOT NULL REFERENCES lab_batch,
 enabled boolean NOT NULL,actor_id uuid NOT NULL REFERENCES app_user,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER lab_slot40_mode_immutable BEFORE UPDATE OR DELETE ON lab_slot40_mode FOR EACH ROW EXECUTE FUNCTION immutable_row();
CREATE FUNCTION lab_urgent40_enabled(p_batch uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT COALESCE((SELECT enabled FROM lab_slot40_mode WHERE batch_id=p_batch ORDER BY sequence DESC LIMIT 1),false)
$$;
CREATE FUNCTION lab_slot40_mode_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 PERFORM 1 FROM lab_batch WHERE id=NEW.batch_id FOR UPDATE;
 IF NOT EXISTS(SELECT 1 FROM lab_task_sheet WHERE batch_id=NEW.batch_id AND sheet_number=3 AND state IN ('Draft','PlanChecked','Amended') AND placement_revision=0)
 OR EXISTS(SELECT 1 FROM lab_slot_assignment WHERE batch_id=NEW.batch_id AND slot_number=40 AND removed_at IS NULL)
 THEN RAISE EXCEPTION 'SLOT40_MODE_LOCKED'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER lab_slot40_mode_guard BEFORE INSERT ON lab_slot40_mode FOR EACH ROW EXECUTE FUNCTION lab_slot40_mode_guard();
CREATE OR REPLACE FUNCTION p4_assignment_guard() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE s text; BEGIN
 IF TG_OP='UPDATE' AND (NEW.batch_id<>OLD.batch_id OR NEW.slot_number<>OLD.slot_number OR NEW.attempt_id<>OLD.attempt_id OR NEW.assigned_by<>OLD.assigned_by OR NEW.assigned_at<>OLD.assigned_at OR OLD.removed_at IS NOT NULL) THEN RAISE EXCEPTION 'ASSIGNMENT_HISTORY_IMMUTABLE'; END IF;
 IF TG_OP='INSERT' AND EXISTS(SELECT 1 FROM lab_batch_slot WHERE batch_id=NEW.batch_id AND slot_number=NEW.slot_number AND control_type IS NOT NULL) THEN
  IF NEW.slot_number<>40 OR NOT lab_urgent40_enabled(NEW.batch_id) THEN RAISE EXCEPTION 'CONTROL_SLOT_PROTECTED'; END IF;
  IF NOT COALESCE((SELECT event_type='URGENT_SET' FROM attempt_event WHERE attempt_id=NEW.attempt_id AND event_type IN ('URGENT_SET','URGENT_CLEARED') ORDER BY sequence DESC LIMIT 1),false) THEN RAISE EXCEPTION 'SLOT40_REQUIRES_URGENT_PATIENT'; END IF;
 END IF;
 SELECT t.state INTO s FROM lab_task_sheet t JOIN lab_batch_slot b ON b.batch_id=t.batch_id AND b.sheet_number=t.sheet_number WHERE b.batch_id=NEW.batch_id AND b.slot_number=NEW.slot_number;
 IF s NOT IN ('Draft','PlanChecked','Amended') AND NOT (TG_OP='UPDATE' AND NEW.removed_reason='BATCH_CANCELLED') THEN RAISE EXCEPTION 'PLACEMENT_LOCKED'; END IF;
 RETURN NEW;
END $$;
CREATE TABLE lab_batch_removal(
 batch_id uuid PRIMARY KEY REFERENCES lab_batch,
 actor_id uuid NOT NULL REFERENCES app_user,created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER lab_batch_removal_immutable BEFORE UPDATE OR DELETE ON lab_batch_removal FOR EACH ROW EXECUTE FUNCTION immutable_row();
CREATE FUNCTION lab_batch_removal_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 PERFORM 1 FROM lab_batch WHERE id=NEW.batch_id AND state='Draft' FOR UPDATE;
 IF NOT FOUND OR EXISTS(SELECT 1 FROM lab_task_sheet WHERE batch_id=NEW.batch_id AND (placement_revision>0 OR state NOT IN ('Draft','PlanChecked')))
 OR EXISTS(SELECT 1 FROM lab_slot_assignment WHERE batch_id=NEW.batch_id)
 OR EXISTS(SELECT 1 FROM lab_placement_snapshot WHERE batch_id=NEW.batch_id)
 OR EXISTS(SELECT 1 FROM lab_document WHERE batch_id=NEW.batch_id)
 OR EXISTS(SELECT 1 FROM lab_observation WHERE batch_id=NEW.batch_id)
 OR EXISTS(SELECT 1 FROM task_workbook_revision WHERE batch_id=NEW.batch_id)
 OR EXISTS(SELECT 1 FROM p4b_pool_attempt WHERE batch_id=NEW.batch_id)
 THEN RAISE EXCEPTION 'ONLY_EMPTY_DRAFT_BATCH_CAN_BE_REMOVED'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER lab_batch_removal_guard BEFORE INSERT ON lab_batch_removal FOR EACH ROW EXECUTE FUNCTION lab_batch_removal_guard();
DO $$ BEGIN IF EXISTS(SELECT FROM pg_roles WHERE rolname='app_rw') THEN
 GRANT SELECT,INSERT ON lab_slot40_mode,lab_batch_removal TO app_rw;
 GRANT USAGE ON SEQUENCE lab_slot40_mode_sequence_seq TO app_rw;
END IF; END $$;
