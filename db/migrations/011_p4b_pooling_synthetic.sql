-- Additive synthetic Pooling/QC2/F4 evidence. No owner decisions are approved here.
CREATE TABLE p4b_pool_attempt(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),batch_id uuid NOT NULL REFERENCES lab_batch,
 attempt_number integer NOT NULL CHECK(attempt_number>0),revision integer NOT NULL DEFAULT 1 CHECK(revision=1),
 supersedes_id uuid REFERENCES p4b_pool_attempt,reason text NOT NULL CHECK(length(trim(reason))>=8),
 payload jsonb NOT NULL CHECK(payload->>'synthetic'='true'),sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 source_sha256 text NOT NULL CHECK(source_sha256 ~ '^[a-f0-9]{64}$'),
 seed text NOT NULL,selected_slots integer[] NOT NULL,created_by uuid NOT NULL REFERENCES app_user,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(batch_id,attempt_number)
);
CREATE TABLE p4b_pool_event(
 sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
 pool_id uuid NOT NULL REFERENCES p4b_pool_attempt,event_type text NOT NULL CHECK(event_type IN
 ('CROSSCHECK_PASS','CROSSCHECK_FAIL','PREVIEW','PRE_WORK','START','END','COMPLETED','HOLD','STOP_USE','SUPERSEDED','RECALL')),
 payload jsonb NOT NULL,actor_id uuid NOT NULL REFERENCES app_user,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE p4b_pool_observation(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
 pool_id uuid NOT NULL REFERENCES p4b_pool_attempt,field text NOT NULL CHECK(field IN ('TRANSFER','BUFFER','QC2','STD1','STD2')),
 slot integer CHECK(slot BETWEEN 1 AND 48),value jsonb NOT NULL,source text NOT NULL CHECK(source IN ('DIRECT_ENTRY','PAPER_TRANSCRIPTION')),
 copy_id uuid,event_time timestamptz,event_precision text NOT NULL CHECK(event_precision IN ('MINUTE','DAY','NOT_RECORDED')),
 recorded_by uuid NOT NULL REFERENCES app_user,recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),supersedes_id uuid REFERENCES p4b_pool_observation,
 reason text, CHECK((field='TRANSFER')=(slot IS NOT NULL)),CHECK((source='PAPER_TRANSCRIPTION')=(copy_id IS NOT NULL)),
 CHECK((event_time IS NULL)=(event_precision='NOT_RECORDED')),CHECK(event_time IS NULL OR event_time<=recorded_at),
 CHECK(supersedes_id IS NULL OR length(trim(reason))>=8),UNIQUE(supersedes_id)
);
CREATE TABLE p4b_pool_review(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),observation_id uuid NOT NULL UNIQUE REFERENCES p4b_pool_observation,
 result text NOT NULL CHECK(result IN ('Confirmed','Discrepancy')),reviewer_id uuid NOT NULL REFERENCES app_user,
 note text NOT NULL CHECK(length(trim(note))>=8),created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE p4b_qc2_decision(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
 pool_id uuid NOT NULL REFERENCES p4b_pool_attempt,observation_id uuid NOT NULL REFERENCES p4b_pool_observation,
 decision text NOT NULL CHECK(decision IN ('Hold','Remeasure','Failed','SyntheticReviewed')),
 criteria_version text NOT NULL CHECK(criteria_version='QC2-WI-BM19-UNAPPROVED-OD31-v1'),
 reason text NOT NULL CHECK(length(trim(reason))>=8),actor_id uuid NOT NULL REFERENCES app_user,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE p4b_pool_snapshot(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),pool_id uuid NOT NULL UNIQUE REFERENCES p4b_pool_attempt,
 revision integer NOT NULL CHECK(revision=1),payload jsonb NOT NULL CHECK(payload->>'acceptance'='HOLD'),
 sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),created_by uuid NOT NULL REFERENCES app_user,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE p4b_document(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),pool_id uuid NOT NULL REFERENCES p4b_pool_attempt,
 kind text NOT NULL CHECK(kind IN ('PRE_WORK','COMPLETED')),revision integer NOT NULL DEFAULT 1 CHECK(revision=1),
 snapshot jsonb NOT NULL,file_sha256 text NOT NULL CHECK(file_sha256 ~ '^[a-f0-9]{64}$'),
 issued_by uuid NOT NULL REFERENCES app_user,issued_at timestamptz NOT NULL DEFAULT now(),UNIQUE(pool_id,kind)
);
CREATE TABLE p4b_document_copy(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),document_id uuid NOT NULL REFERENCES p4b_document,
 copy_number integer NOT NULL CHECK(copy_number>0),kind text NOT NULL CHECK(kind IN ('WORKING_COPY','ORIGINAL_REPRINT','STATUS_MARKED')),
 file_sha256 text NOT NULL CHECK(file_sha256 ~ '^[a-f0-9]{64}$'),derived_from text NOT NULL CHECK(derived_from ~ '^[a-f0-9]{64}$'),
 reason text NOT NULL CHECK(length(trim(reason))>=8),actor_id uuid NOT NULL REFERENCES app_user,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(document_id,copy_number)
);
ALTER TABLE p4b_pool_observation ADD FOREIGN KEY(copy_id) REFERENCES p4b_document_copy;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['p4b_pool_attempt','p4b_pool_event','p4b_pool_observation','p4b_pool_review','p4b_qc2_decision','p4b_pool_snapshot','p4b_document','p4b_document_copy'] LOOP
  EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION immutable_row()',t||'_immutable',t);
 END LOOP;
END $$;
CREATE FUNCTION p4b_review_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF EXISTS(SELECT 1 FROM p4b_pool_observation WHERE id=NEW.observation_id AND recorded_by=NEW.reviewer_id) THEN RAISE EXCEPTION 'SECOND_PERSON_REQUIRED'; END IF;
 IF EXISTS(SELECT 1 FROM p4b_pool_observation WHERE supersedes_id=NEW.observation_id) THEN RAISE EXCEPTION 'OBSERVATION_SUPERSEDED'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER p4b_review_guard BEFORE INSERT ON p4b_pool_review FOR EACH ROW EXECUTE FUNCTION p4b_review_guard();
-- Upstream change and Stop-use occur in the SAME transaction. Conservative batch-wide
-- invalidation includes controls, new placements, QC1, holds, withdrawals and redraw.
CREATE FUNCTION p4b_invalidate_pool() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$ DECLARE bid uuid; aid uuid; cid uuid; BEGIN
 IF TG_TABLE_NAME IN ('lab_task_sheet','lab_slot_assignment','lab_slot_disposition','lab_observation','lab_placement_snapshot') THEN bid:=NEW.batch_id;
 ELSIF TG_TABLE_NAME IN ('attempt_stage_qc','attempt_event') THEN aid:=NEW.attempt_id;
 ELSIF TG_TABLE_NAME='analytical_attempt' THEN aid:=NEW.id;
 ELSIF TG_TABLE_NAME='nipt_case' THEN cid:=NEW.id;
 ELSE cid:=NEW.case_id; END IF;
 PERFORM b.id FROM lab_batch b WHERE EXISTS(SELECT 1 FROM p4b_pool_attempt p WHERE p.batch_id=b.id
  AND (p.batch_id=bid OR EXISTS(SELECT 1 FROM lab_slot_assignment a JOIN analytical_attempt at ON at.id=a.attempt_id
  WHERE a.batch_id=p.batch_id AND (a.attempt_id=aid OR at.case_id=cid)))) ORDER BY b.id FOR UPDATE;
 INSERT INTO p4b_pool_event(pool_id,event_type,payload,actor_id)
 SELECT p.id,'STOP_USE',jsonb_build_object('reason','UPSTREAM_CHANGED','table',TG_TABLE_NAME),p.created_by FROM p4b_pool_attempt p
 WHERE (p.batch_id=bid OR EXISTS(SELECT 1 FROM lab_slot_assignment a JOIN analytical_attempt at ON at.id=a.attempt_id
  WHERE a.batch_id=p.batch_id AND (a.attempt_id=aid OR at.case_id=cid)))
 AND NOT EXISTS(SELECT 1 FROM p4b_pool_event e WHERE e.pool_id=p.id AND e.event_type IN ('STOP_USE','SUPERSEDED'));
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION p4b_invalidate_pool() FROM PUBLIC;
CREATE TRIGGER p4b_sheet_changed AFTER UPDATE ON lab_task_sheet FOR EACH ROW EXECUTE FUNCTION p4b_invalidate_pool();
CREATE TRIGGER p4b_assignment_changed AFTER INSERT OR UPDATE ON lab_slot_assignment FOR EACH ROW EXECUTE FUNCTION p4b_invalidate_pool();
CREATE TRIGGER p4b_disposition_changed AFTER INSERT OR UPDATE ON lab_slot_disposition FOR EACH ROW EXECUTE FUNCTION p4b_invalidate_pool();
CREATE TRIGGER p4b_qc1_changed AFTER INSERT OR UPDATE ON lab_observation FOR EACH ROW EXECUTE FUNCTION p4b_invalidate_pool();
CREATE TRIGGER p4b_placement_changed AFTER INSERT ON lab_placement_snapshot FOR EACH ROW EXECUTE FUNCTION p4b_invalidate_pool();
CREATE TRIGGER p4b_qc1_decision_changed AFTER INSERT ON attempt_stage_qc FOR EACH ROW EXECUTE FUNCTION p4b_invalidate_pool();
CREATE TRIGGER p4b_attempt_event_changed AFTER INSERT ON attempt_event FOR EACH ROW EXECUTE FUNCTION p4b_invalidate_pool();
CREATE TRIGGER p4b_attempt_changed AFTER UPDATE ON analytical_attempt FOR EACH ROW EXECUTE FUNCTION p4b_invalidate_pool();
CREATE TRIGGER p4b_case_changed AFTER UPDATE ON nipt_case FOR EACH ROW EXECUTE FUNCTION p4b_invalidate_pool();
CREATE TRIGGER p4b_revoked AFTER INSERT ON p2_revocation FOR EACH ROW EXECUTE FUNCTION p4b_invalidate_pool();
REVOKE ALL ON p4b_pool_attempt,p4b_pool_event,p4b_pool_observation,p4b_pool_review,p4b_qc2_decision,p4b_pool_snapshot,p4b_document,p4b_document_copy FROM PUBLIC;
CREATE FUNCTION p4b_observation_guard() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE p p4b_pool_attempt; anchor timestamptz; old p4b_pool_observation; BEGIN
 SELECT * INTO p FROM p4b_pool_attempt WHERE id=NEW.pool_id;
 PERFORM id FROM lab_batch WHERE id=p.batch_id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM p4b_pool_event WHERE pool_id=p.id AND event_type IN ('STOP_USE','SUPERSEDED','HOLD','COMPLETED')) THEN RAISE EXCEPTION 'POOL_NOT_CURRENT'; END IF;
 SELECT created_at INTO anchor FROM p4b_pool_event WHERE pool_id=p.id AND event_type=CASE WHEN NEW.field IN ('QC2','STD1','STD2') THEN 'END' ELSE 'START' END ORDER BY sequence DESC LIMIT 1;
 IF anchor IS NULL THEN RAISE EXCEPTION 'POOL_EXECUTION_ANCHOR_REQUIRED'; END IF;
 IF NEW.event_time IS NOT NULL AND NEW.event_time<anchor THEN RAISE EXCEPTION 'EVENT_BEFORE_EXECUTION_ANCHOR'; END IF;
 IF NEW.field='TRANSFER' AND (NEW.value<>'{"checked":true}'::jsonb OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p.payload->'members') m WHERE (m->>'slot')::int=NEW.slot)) THEN RAISE EXCEPTION 'TRANSFER_MEMBER_REQUIRED'; END IF;
 IF NEW.field<>'TRANSFER' AND (NEW.value->>'value' IS NULL OR NEW.value->>'value' !~ '^(0|[1-9][0-9]{0,5})(\.[0-9]{1,8})?$' OR NEW.value->>'unit'<>CASE WHEN NEW.field='BUFFER' THEN 'uL' ELSE 'ng/uL' END) THEN RAISE EXCEPTION 'OBSERVATION_UNIT_OR_SCOPE'; END IF;
 IF NEW.copy_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM p4b_document_copy c JOIN p4b_document d ON d.id=c.document_id WHERE c.id=NEW.copy_id AND d.pool_id=p.id AND c.kind='WORKING_COPY'
  AND NOT EXISTS(SELECT 1 FROM p4b_pool_event e WHERE e.pool_id=p.id AND e.event_type='RECALL' AND e.payload->>'copyId'=c.id::text)) THEN RAISE EXCEPTION 'WORKING_COPY_NOT_USABLE'; END IF;
 SELECT * INTO old FROM p4b_pool_observation o WHERE o.pool_id=p.id AND o.field=NEW.field AND o.slot IS NOT DISTINCT FROM NEW.slot AND NOT EXISTS(SELECT 1 FROM p4b_pool_observation x WHERE x.supersedes_id=o.id) ORDER BY sequence DESC LIMIT 1;
 IF (old.id IS NOT NULL AND NEW.supersedes_id IS DISTINCT FROM old.id) OR (old.id IS NULL AND NEW.supersedes_id IS NOT NULL) THEN RAISE EXCEPTION 'OBSERVATION_REQUIRES_EXACT_SUPERSESSION'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER p4b_observation_guard BEFORE INSERT ON p4b_pool_observation FOR EACH ROW EXECUTE FUNCTION p4b_observation_guard();
CREATE FUNCTION p4b_qc2_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM p4b_pool_observation o JOIN p4b_pool_review r ON r.observation_id=o.id WHERE o.id=NEW.observation_id AND o.pool_id=NEW.pool_id AND o.field='QC2' AND r.result='Confirmed' AND o.recorded_by<>NEW.actor_id
  AND NOT EXISTS(SELECT 1 FROM p4b_pool_observation x WHERE x.supersedes_id=o.id)) THEN RAISE EXCEPTION 'QC2_VERIFIED_EVIDENCE_REQUIRED'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER p4b_qc2_guard BEFORE INSERT ON p4b_qc2_decision FOR EACH ROW EXECUTE FUNCTION p4b_qc2_guard();
