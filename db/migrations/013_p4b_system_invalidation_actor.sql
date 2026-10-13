-- Automated invalidation is a system action, never a fabricated action by the
-- pool creator. Keep upstream mutation attribution in its original P4 evidence.
ALTER TABLE p4b_pool_event ALTER COLUMN actor_id DROP NOT NULL;
CREATE OR REPLACE FUNCTION p4b_invalidate_pool() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$ DECLARE bid uuid; aid uuid; cid uuid; BEGIN
 IF TG_TABLE_NAME IN ('lab_task_sheet','lab_slot_assignment','lab_slot_disposition','lab_observation','lab_placement_snapshot') THEN bid:=NEW.batch_id;
 ELSIF TG_TABLE_NAME IN ('attempt_stage_qc','attempt_event') THEN aid:=NEW.attempt_id;
 ELSIF TG_TABLE_NAME='analytical_attempt' THEN aid:=NEW.id;
 ELSIF TG_TABLE_NAME='nipt_case' THEN cid:=NEW.id;
 ELSE cid:=NEW.case_id; END IF;
 PERFORM b.id FROM lab_batch b WHERE EXISTS(SELECT 1 FROM p4b_pool_attempt p WHERE p.batch_id=b.id
  AND (p.batch_id=bid OR EXISTS(SELECT 1 FROM lab_slot_assignment a JOIN analytical_attempt at ON at.id=a.attempt_id
  WHERE a.batch_id=p.batch_id AND (a.attempt_id=aid OR at.case_id=cid)))) ORDER BY b.id FOR UPDATE;
 INSERT INTO p4b_pool_event(pool_id,event_type,payload,actor_id)
 SELECT p.id,'STOP_USE',jsonb_build_object('reason','UPSTREAM_CHANGED','table',TG_TABLE_NAME,'sourceId',NEW.id,'systemGenerated',true),NULL FROM p4b_pool_attempt p
 WHERE (p.batch_id=bid OR EXISTS(SELECT 1 FROM lab_slot_assignment a JOIN analytical_attempt at ON at.id=a.attempt_id
  WHERE a.batch_id=p.batch_id AND (a.attempt_id=aid OR at.case_id=cid)))
 AND NOT EXISTS(SELECT 1 FROM p4b_pool_event e WHERE e.pool_id=p.id AND e.event_type IN ('STOP_USE','SUPERSEDED'));
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION p4b_invalidate_pool() FROM PUBLIC;
