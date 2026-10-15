-- Owner 2026-10-14: an expected redraw can receive a new PET at immutable P[21].
-- Existing receipt times and issued identifiers are retained unchanged.
ALTER TABLE his_order ADD COLUMN round_id uuid REFERENCES specimen_round(id);
ALTER TABLE his_order DISABLE TRIGGER order_immutable;
UPDATE his_order o SET round_id=r.id FROM specimen_round r WHERE r.case_ln_id=o.case_ln_id AND r.round_number=1;
ALTER TABLE his_order ENABLE TRIGGER order_immutable;
ALTER TABLE his_order ALTER COLUMN round_id SET NOT NULL;
ALTER TABLE his_order DROP CONSTRAINT his_order_case_ln_id_key;
ALTER TABLE his_order ADD CONSTRAINT his_order_round_unique UNIQUE(round_id);
ALTER TABLE his_inbound_file DROP CONSTRAINT his_inbound_file_state_check;
ALTER TABLE his_inbound_file ADD CONSTRAINT his_inbound_file_state_check CHECK(state IN ('Ready','Applied(S1)','Applied(Redraw)','Conflict','ParseError','DuplicateSameContent','Unlinked','S1IntegrityEvent','HistoricalIntake'));

CREATE OR REPLACE FUNCTION pet_order_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r specimen_round; BEGIN
 IF NEW.round_id IS NULL THEN SELECT * INTO r FROM specimen_round WHERE case_ln_id=NEW.case_ln_id AND round_number=1;
 ELSE SELECT * INTO r FROM specimen_round WHERE id=NEW.round_id; END IF;
 IF r.id IS NULL OR r.case_ln_id<>NEW.case_ln_id THEN RAISE EXCEPTION 'PET_ROUND_LINEAGE_MISMATCH'; END IF;
 NEW.round_id:=r.id;
 IF NOT EXISTS(SELECT 1 FROM his_inbound_file WHERE id=NEW.inbound_file_id AND state=CASE WHEN r.round_number=1 THEN 'Applied(S1)' ELSE 'Applied(Redraw)' END)
 THEN RAISE EXCEPTION 'order requires applied PET'; END IF;
 IF EXISTS(SELECT 1 FROM nipt_case WHERE id=r.case_id AND registration_origin='HISTORICAL') THEN RAISE EXCEPTION 'historical order prohibited'; END IF;
 IF r.round_number>1 AND (r.round_number<>2 OR r.state<>'Expected' OR r.received_at IS NOT NULL
  OR NOT EXISTS(SELECT 1 FROM nipt_case c JOIN redraw_request d ON d.id=r.redraw_request_id JOIN specimen_round s ON s.id=d.source_round_id
    WHERE c.id=r.case_id AND c.current_round_id=r.id AND d.case_id=r.case_id AND d.state='Requested'
      AND s.case_ln_id=r.case_ln_id AND s.round_number=1 AND s.received_at<NEW.his_received_at)) THEN RAISE EXCEPTION 'EXPECTED_REDRAW_PET_REQUIRED'; END IF;
 UPDATE case_ln SET verification='VERIFIED_BY_PET' WHERE id=NEW.case_ln_id;
 RETURN NEW;
END $$;

-- Remove only the two old source/channel restrictions, by their definitions, not generated constraint names.
DO $$ DECLARE c record; BEGIN
 FOR c IN SELECT conname,pg_get_constraintdef(oid) d FROM pg_constraint WHERE conrelid='specimen_round'::regclass AND contype='c' LOOP
  IF (c.d LIKE '%round_number = 1%' AND c.d LIKE '%received_source%' AND c.d NOT LIKE '%redraw_request_id%') THEN
   EXECUTE format('ALTER TABLE specimen_round DROP CONSTRAINT %I',c.conname);
  END IF;
 END LOOP;
END $$;
ALTER TABLE specimen_round ADD CONSTRAINT round_receipt_source CHECK(received_source IS NULL OR received_source='HIS_PET_RECEIPT' OR (round_number>=2 AND received_source='NIPT_LOCAL_RECEIPT'));
ALTER TABLE specimen_round ADD CONSTRAINT round_his_receipt_state CHECK(state<>'ReceivedInHIS' OR (received_source='HIS_PET_RECEIPT' AND received_at IS NOT NULL));

CREATE OR REPLACE FUNCTION s1_receipt_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.received_source='HIS_PET_RECEIPT' AND NOT EXISTS(SELECT 1 FROM his_order WHERE round_id=NEW.id AND case_ln_id=NEW.case_ln_id AND his_received_at=NEW.received_at)
 THEN RAISE EXCEPTION 'receipt requires applied HIS order and immutable HIS time'; END IF; RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION p3_worker_round_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF p3_worker_session() AND NEW.round_number>=2 THEN
  IF TG_OP<>'UPDATE' THEN RAISE EXCEPTION 'WORKER_ROUND2_PROHIBITED'; END IF;
  IF OLD.state<>'Expected' OR OLD.received_at IS NOT NULL OR NEW.round_number<>2 OR NEW.state<>'ReceivedInHIS' OR NEW.received_source<>'HIS_PET_RECEIPT'
   OR NEW.received_by IS NOT NULL OR NEW.receipt_check IS NOT NULL OR NEW.analysis_started IS DISTINCT FROM OLD.analysis_started
   OR NOT EXISTS(SELECT 1 FROM his_order WHERE round_id=NEW.id AND case_ln_id=NEW.case_ln_id AND his_received_at=NEW.received_at)
   OR NOT EXISTS(SELECT 1 FROM nipt_case WHERE id=NEW.case_id AND current_round_id=NEW.id)
  THEN RAISE EXCEPTION 'WORKER_ROUND2_PROHIBITED'; END IF;
 END IF; RETURN NEW;
END $$;

-- A new PET-backed S2 reuses the original stored base. Existing local S2 allocations remain untouched.
ALTER TABLE specimen_lab_number ADD COLUMN original_round_id uuid REFERENCES specimen_lab_number(round_id);
ALTER TABLE specimen_lab_number DROP CONSTRAINT specimen_lab_number_ln_halos_key;
ALTER TABLE specimen_lab_number DROP CONSTRAINT specimen_lab_number_sequence_date_sequence_value_key;
CREATE UNIQUE INDEX ln_halos_original_unique ON specimen_lab_number(ln_halos) WHERE original_round_id IS NULL;
CREATE UNIQUE INDEX ln_halos_original_sequence_unique ON specimen_lab_number(sequence_date,sequence_value) WHERE original_round_id IS NULL;
ALTER FUNCTION p4_ensure_ln_halos(uuid,text) RENAME TO p4_issue_original_ln_halos;
CREATE FUNCTION p4_ensure_ln_halos(p_round uuid,p_path text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE r specimen_round; original specimen_lab_number; code text; BEGIN
 IF p_path NOT IN ('RECEIPT_TRIGGER','RECEIPT_RECOVERY') THEN RAISE EXCEPTION 'LN_HALOS_ISSUE_PATH_INVALID'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_round::text,75432810));
 SELECT * INTO r FROM specimen_round WHERE id=p_round;
 IF r.id IS NULL OR r.received_at IS NULL OR r.received_source IS NULL THEN RAISE EXCEPTION 'LN_HALOS_REQUIRES_RECEIPT'; END IF;
 SELECT ln_halos INTO code FROM specimen_lab_number WHERE round_id=p_round;
 IF code IS NOT NULL THEN RETURN code; END IF;
 IF r.round_number=1 OR r.received_source='NIPT_LOCAL_RECEIPT' THEN RETURN p4_issue_original_ln_halos(p_round,p_path); END IF;
 IF r.round_number<>2 THEN RAISE EXCEPTION 'RESAMPLING_SUFFIX_RULE_REQUIRED'; END IF;
 SELECT n.* INTO original FROM specimen_lab_number n JOIN specimen_round s ON s.id=n.round_id WHERE s.case_id=r.case_id AND s.round_number=1;
 IF original.round_id IS NULL THEN RAISE EXCEPTION 'ORIGINAL_LN_HALOS_REQUIRED'; END IF;
 INSERT INTO specimen_lab_number(round_id,case_id,ln_halos,sequence_date,sequence_value,issued_on,issue_path,original_round_id)
 VALUES(r.id,r.case_id,original.ln_halos,original.sequence_date,original.sequence_value,r.received_source,p_path,original.round_id);
 INSERT INTO analytical_attempt(case_id,round_id,attempt_number,state) VALUES(r.case_id,r.id,1,'Ready');
 RETURN original.ln_halos;
END $$;
REVOKE ALL ON FUNCTION p4_ensure_ln_halos(uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION p4_issue_original_ln_halos(uuid,text) FROM PUBLIC;

CREATE FUNCTION p3_redraw_receipt_complete() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$ BEGIN
 IF NEW.round_number>=2 AND NEW.received_source='HIS_PET_RECEIPT' AND OLD.received_at IS NULL AND NEW.received_at IS NOT NULL THEN
  UPDATE redraw_request SET state='Completed',closed_at=now(),close_reason='RECEIVED_HIS_PET' WHERE id=NEW.redraw_request_id AND state='Requested';
 END IF; RETURN NULL;
END $$;
CREATE TRIGGER p3_redraw_receipt_complete AFTER UPDATE OF received_at ON specimen_round FOR EACH ROW EXECUTE FUNCTION p3_redraw_receipt_complete();
REVOKE ALL ON FUNCTION p3_redraw_receipt_complete() FROM PUBLIC;
