CREATE TABLE specimen_acceptance(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),round_id uuid NOT NULL REFERENCES specimen_round(id),
 identity_checked boolean NOT NULL CHECK(identity_checked),label_checked boolean NOT NULL CHECK(label_checked),
 condition text NOT NULL CHECK(condition IN ('ACCEPTABLE','REJECTED')),
 criteria_reference text NOT NULL CHECK(length(trim(criteria_reference)) BETWEEN 8 AND 500),
 reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 8 AND 500),
 actor_id uuid NOT NULL REFERENCES app_user,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER specimen_acceptance_immutable BEFORE UPDATE OR DELETE ON specimen_acceptance FOR EACH ROW EXECUTE FUNCTION immutable_row();
CREATE FUNCTION specimen_acceptance_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NOT nipt_operational_enabled() OR NOT EXISTS(SELECT 1 FROM specimen_round r JOIN nipt_case c ON c.id=r.case_id
  WHERE r.id=NEW.round_id AND c.current_round_id=r.id AND r.received_at IS NOT NULL AND r.state IN ('ReceivedInHIS','ReceivedInNIPT') AND NOT r.analysis_started)
 THEN RAISE EXCEPTION 'CURRENT_RECEIVED_SPECIMEN_REQUIRED'; END IF; RETURN NEW;
END $$;
CREATE TRIGGER specimen_acceptance_guard BEFORE INSERT ON specimen_acceptance FOR EACH ROW EXECUTE FUNCTION specimen_acceptance_guard();
ALTER TABLE attempt_stage_qc DROP CONSTRAINT attempt_stage_qc_criteria_status_check;
ALTER TABLE attempt_stage_qc ADD CONSTRAINT attempt_stage_qc_criteria_status_check CHECK(criteria_status IN ('UNAPPROVED_OD31','REVIEWED_OPERATIONAL'));
