-- v1.1.3 owner PET Gate + immutable EQA identity declaration.
-- Existing data and older archived/finalized placements are NOT retroactively changed.
CREATE TABLE eqa_case (
 case_id uuid PRIMARY KEY REFERENCES nipt_case(id),
 organizer text NOT NULL CHECK(length(trim(organizer)) BETWEEN 2 AND 200),
 organizer_sample_id text NOT NULL CHECK(length(trim(organizer_sample_id)) BETWEEN 1 AND 120),
 patient_name text NOT NULL CHECK(length(trim(patient_name)) BETWEEN 2 AND 200),
 patient_dob date,
 patient_sex text CHECK(patient_sex IN ('M','F','U')),
 pregnancy_type text CHECK(pregnancy_type IN ('Singleton','Twins')),
 collection_at timestamptz,
 edd date,
 program_year integer NOT NULL CHECK(program_year BETWEEN 2000 AND 2200),
 evidence_reference text NOT NULL CHECK(length(trim(evidence_reference)) BETWEEN 3 AND 300),
 verified_by uuid NOT NULL REFERENCES app_user(id),
 verified_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE (organizer,program_year,organizer_sample_id)
);
CREATE TRIGGER eqa_case_immutable BEFORE UPDATE OR DELETE ON eqa_case FOR EACH ROW EXECUTE FUNCTION immutable_row();
CREATE FUNCTION eqa_case_registration_guard() RETURNS trigger LANGUAGE plpgsql AS $$
 BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM nipt_case c JOIN case_ln l ON l.case_id=c.id
    JOIN specimen_round r ON r.case_id=c.id AND r.round_number=1
    WHERE c.id=NEW.case_id AND c.registration_origin='LAB_DIRECT'
      AND l.verification='AWAITING_PET'
      AND r.state='Expected' AND r.received_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM his_order o WHERE o.case_ln_id=l.id)
      AND NOT EXISTS (SELECT 1 FROM result_release x WHERE x.case_id=c.id)
  ) THEN RAISE EXCEPTION 'EQA_CLASSIFICATION_REQUIRES_UNRECEIVED_LAB_REGISTRATION'; END IF;
  RETURN NEW;
 END $$;
CREATE TRIGGER eqa_case_registration_guard BEFORE INSERT ON eqa_case FOR EACH ROW EXECUTE FUNCTION eqa_case_registration_guard();

-- A round is PET-backed only when its exact current specimen has a matching applied HIS order;
-- verified LN on a previous redraw is NOT sufficient.
CREATE FUNCTION nipt_round_pet_or_eqa_ok(p_round uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS (
  SELECT 1 FROM specimen_round r JOIN nipt_case c ON c.id=r.case_id
  JOIN case_ln l ON l.id=r.case_ln_id AND l.case_id=c.id
  LEFT JOIN eqa_case eq ON eq.case_id=c.id
  WHERE r.id=p_round AND c.current_round_id=r.id
    AND NOT EXISTS (
      SELECT 1 FROM his_intake_issue i WHERE i.case_id=c.id AND i.state IN ('Open','Proposed')
    )
    AND (
      (r.received_source='HIS_PET_RECEIPT' AND r.state='ReceivedInHIS'
       AND l.verification='VERIFIED_BY_PET'
       AND EXISTS (SELECT 1 FROM his_order o JOIN his_inbound_file f ON f.id=o.inbound_file_id
          WHERE o.round_id=r.id AND o.case_ln_id=r.case_ln_id
            AND f.state=CASE WHEN r.round_number=1 THEN 'Applied(S1)' ELSE 'Applied(Redraw)' END))
      OR
      (eq.case_id IS NOT NULL AND r.received_source='NIPT_LOCAL_RECEIPT'
       AND r.state='ReceivedInNIPT' AND r.receipt_check @> '{"identity":true,"label":true}'::jsonb)
    )
 ) $$;
REVOKE ALL ON FUNCTION nipt_round_pet_or_eqa_ok(uuid) FROM PUBLIC;

CREATE FUNCTION nipt_p3_slot_pet_guard() RETURNS trigger LANGUAGE plpgsql AS $$
 DECLARE r_id uuid;
 BEGIN
  IF TG_OP='UPDATE' AND NEW.attempt_id=OLD.attempt_id AND NEW.slot_number=OLD.slot_number
    AND NEW.batch_id=OLD.batch_id THEN RETURN NEW; END IF;
  SELECT a.round_id INTO r_id FROM analytical_attempt a WHERE a.id=NEW.attempt_id;
  IF r_id IS NULL OR NOT nipt_round_pet_or_eqa_ok(r_id) THEN
   RAISE EXCEPTION 'CURRENT_ROUND_PET_OR_EQA_VERIFICATION_REQUIRED';
  END IF;
  RETURN NEW;
 END $$;
CREATE TRIGGER zz_nipt_p3_slot_pet_guard BEFORE INSERT OR UPDATE OF attempt_id,slot_number,batch_id
  ON lab_slot_assignment FOR EACH ROW EXECUTE FUNCTION nipt_p3_slot_pet_guard();

-- Defence in depth: no EQA-certified report may be reserved for HIS,
-- even if an old worker job is replayed after classification.
CREATE FUNCTION nipt_his_eqa_block() RETURNS trigger LANGUAGE plpgsql AS $$
 BEGIN
  IF NEW.clinical_release_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM result_release r JOIN eqa_case e ON e.case_id=r.case_id
    WHERE r.id=NEW.clinical_release_id
  ) THEN RAISE EXCEPTION 'EQA_HIS_OUTBOUND_PROHIBITED'; END IF;
  RETURN NEW;
 END $$;
CREATE TRIGGER nipt_his_eqa_block BEFORE INSERT OR UPDATE OF clinical_release_id
  ON p6_transfer FOR EACH ROW EXECUTE FUNCTION nipt_his_eqa_block();

DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='app_rw') THEN
  GRANT SELECT,INSERT ON eqa_case TO app_rw;
  GRANT EXECUTE ON FUNCTION nipt_round_pet_or_eqa_ok(uuid) TO app_rw;
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='worker_rw') THEN
  GRANT SELECT ON eqa_case TO worker_rw;
  GRANT EXECUTE ON FUNCTION nipt_round_pet_or_eqa_ok(uuid) TO worker_rw;
 END IF;
END $$;
