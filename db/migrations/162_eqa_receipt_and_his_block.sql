-- 1.1.3 EQA specimens may be received without HIS PET, but only after immutable
-- organizer enrollment. Never allow this path for normal patients.
ALTER TABLE specimen_round DROP CONSTRAINT round_receipt_source;
ALTER TABLE specimen_round ADD CONSTRAINT round_receipt_source CHECK(
 received_source IS NULL OR received_source IN ('HIS_PET_RECEIPT','NIPT_LOCAL_RECEIPT')
);
ALTER TABLE specimen_round DROP CONSTRAINT specimen_round_check4;
ALTER TABLE specimen_round ADD CONSTRAINT specimen_round_check4 CHECK (
 state<>'ReceivedInNIPT' OR (received_source='NIPT_LOCAL_RECEIPT' AND received_at IS NOT NULL)
);
CREATE FUNCTION nipt_eqa_receipt_guard() RETURNS trigger LANGUAGE plpgsql AS $$
 BEGIN
  IF NEW.received_source='NIPT_LOCAL_RECEIPT' AND NEW.round_number=1 THEN
   IF TG_OP<>'UPDATE' OR OLD.received_source IS NOT NULL OR OLD.received_at IS NOT NULL
      OR OLD.state<>'Expected' OR NEW.state<>'ReceivedInNIPT'
      OR NEW.received_by IS NULL OR NEW.receipt_check IS NULL
      OR NOT (NEW.receipt_check @> '{"identity":true,"label":true}'::jsonb)
      OR NOT EXISTS (SELECT 1 FROM eqa_case e JOIN nipt_case c ON c.id=e.case_id
         WHERE c.id=NEW.case_id AND c.current_round_id=NEW.id AND c.registration_origin='LAB_DIRECT')
   THEN RAISE EXCEPTION 'EQA_VERIFIED_RECEIPT_REQUIRED'; END IF;
  END IF;
  -- Regular non-EQA Round 2+ local receipt is legacy synthetic-only; it does not
  -- satisfy the patient PET gate at Task assignment under migration 161.
  RETURN NEW;
 END $$;
CREATE TRIGGER nipt_eqa_receipt_guard BEFORE INSERT OR UPDATE OF received_source,received_at
  ON specimen_round FOR EACH ROW EXECUTE FUNCTION nipt_eqa_receipt_guard();

-- An EQA-tagged case may never gain a real HIS order, even if a matching LN arrives.
CREATE FUNCTION nipt_eqa_pet_order_block() RETURNS trigger LANGUAGE plpgsql AS $$
 BEGIN
  IF EXISTS(SELECT 1 FROM case_ln l JOIN eqa_case e ON e.case_id=l.case_id
    WHERE l.id=NEW.case_ln_id) THEN RAISE EXCEPTION 'EQA_HIS_PET_ORDER_PROHIBITED'; END IF;
  RETURN NEW;
 END $$;
CREATE TRIGGER a_nipt_eqa_pet_order_block BEFORE INSERT ON his_order
 FOR EACH ROW EXECUTE FUNCTION nipt_eqa_pet_order_block();

-- Block every direct or replayed release->HIS queue enqueue for EQA (including
-- post-certification retry). Other queue kinds and normal clinical patients remain.
CREATE FUNCTION nipt_eqa_his_outbox_guard() RETURNS trigger LANGUAGE plpgsql AS $$
 BEGIN
  IF NEW.kind='result_release_completed' AND EXISTS (
     SELECT 1 FROM result_release r JOIN eqa_case e ON e.case_id=r.case_id
     WHERE r.id::text=NEW.payload->>'releaseId'
  ) THEN RAISE EXCEPTION 'EQA_HIS_OUTBOUND_PROHIBITED'; END IF;
  RETURN NEW;
 END $$;
CREATE TRIGGER nipt_eqa_his_outbox_guard BEFORE INSERT OR UPDATE OF kind,payload ON job_outbox
 FOR EACH ROW EXECUTE FUNCTION nipt_eqa_his_outbox_guard();
