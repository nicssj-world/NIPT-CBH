-- v1.1.3 EQA: an organizer-supplied specimen has no HIS PET, so its first round is received locally. The constraint that
-- confined local receipt to round >= 2 becomes a trigger that keeps exactly that rule for every real patient and allows
-- round 1 only for a case classified in eqa_case. LN Halos issue, gates and the receipt channel are otherwise unchanged
-- (issued_on stays NIPT_LOCAL_RECEIPT, which specimen_lab_number already accepts).
DO $$ DECLARE c record; BEGIN
 FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='specimen_round'::regclass AND conname='round_receipt_source' LOOP
  EXECUTE format('ALTER TABLE specimen_round DROP CONSTRAINT %I',c.conname);
 END LOOP;
END $$;
ALTER TABLE specimen_round ADD CONSTRAINT round_receipt_source CHECK(received_source IS NULL OR received_source IN ('HIS_PET_RECEIPT','NIPT_LOCAL_RECEIPT'));
-- The state check "ReceivedInNIPT only from round 2" is the same rule; it is re-expressed below for EQA round 1.
DO $$ DECLARE c record; BEGIN
 FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='specimen_round'::regclass AND contype='c'
   AND pg_get_constraintdef(oid) LIKE '%ReceivedInNIPT%' AND pg_get_constraintdef(oid) LIKE '%round_number >= 2%' LOOP
  EXECUTE format('ALTER TABLE specimen_round DROP CONSTRAINT %I',c.conname);
 END LOOP;
END $$;
ALTER TABLE specimen_round ADD CONSTRAINT round_nipt_receipt_state CHECK(state<>'ReceivedInNIPT' OR (received_source='NIPT_LOCAL_RECEIPT' AND received_at IS NOT NULL));
CREATE FUNCTION specimen_round_local_receipt_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF NEW.received_source='NIPT_LOCAL_RECEIPT' AND NEW.round_number<2 AND NOT EXISTS(SELECT 1 FROM eqa_case e WHERE e.round_id=NEW.id AND e.case_id=NEW.case_id)
 THEN RAISE EXCEPTION 'LOCAL_RECEIPT_ROUND1_EQA_ONLY'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER specimen_round_local_receipt_guard BEFORE INSERT OR UPDATE OF received_source,round_number ON specimen_round FOR EACH ROW EXECUTE FUNCTION specimen_round_local_receipt_guard();
