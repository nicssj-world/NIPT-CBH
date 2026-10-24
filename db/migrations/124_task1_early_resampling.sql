-- Owner 2026-10-24: allow early and further genuine HIS PET Re-Sampling.
-- Keep identity, expected receipt, strictly newer PET time, original base and immutable lineage guards.
CREATE OR REPLACE FUNCTION pet_order_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r specimen_round; BEGIN
 IF NEW.round_id IS NULL THEN SELECT * INTO r FROM specimen_round WHERE case_ln_id=NEW.case_ln_id AND round_number=1;
 ELSE SELECT * INTO r FROM specimen_round WHERE id=NEW.round_id; END IF;
 IF r.id IS NULL OR r.case_ln_id<>NEW.case_ln_id THEN RAISE EXCEPTION 'PET_ROUND_LINEAGE_MISMATCH'; END IF;
 NEW.round_id:=r.id;
 IF NOT EXISTS(SELECT 1 FROM his_inbound_file WHERE id=NEW.inbound_file_id AND state=CASE WHEN r.round_number=1 THEN 'Applied(S1)' ELSE 'Applied(Redraw)' END)
 THEN RAISE EXCEPTION 'order requires applied PET'; END IF;
 IF EXISTS(SELECT 1 FROM nipt_case WHERE id=r.case_id AND registration_origin='HISTORICAL') THEN RAISE EXCEPTION 'historical order prohibited'; END IF;
 IF r.round_number>1 AND (r.state<>'Expected' OR r.received_at IS NOT NULL
  OR NOT EXISTS(SELECT 1 FROM nipt_case c JOIN redraw_request d ON d.id=r.redraw_request_id JOIN specimen_round_current s ON s.id=d.source_round_id
    WHERE c.id=r.case_id AND c.current_round_id=r.id AND d.case_id=r.case_id AND d.state='Requested'
      AND s.case_ln_id=r.case_ln_id AND s.round_number=r.round_number-1 AND s.received_at<NEW.his_received_at)) THEN RAISE EXCEPTION 'EXPECTED_REDRAW_PET_REQUIRED'; END IF;
 UPDATE case_ln SET verification='VERIFIED_BY_PET' WHERE id=NEW.case_ln_id;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION p3_worker_round_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF p3_worker_session() AND NEW.round_number>=2 THEN
  IF TG_OP<>'UPDATE' THEN RAISE EXCEPTION 'WORKER_ROUND2_PROHIBITED'; END IF;
  IF OLD.state<>'Expected' OR OLD.received_at IS NOT NULL OR NEW.state<>'ReceivedInHIS' OR NEW.received_source<>'HIS_PET_RECEIPT'
   OR NEW.received_by IS NOT NULL OR NEW.receipt_check IS NOT NULL OR NEW.analysis_started IS DISTINCT FROM OLD.analysis_started
   OR NOT EXISTS(SELECT 1 FROM his_order WHERE round_id=NEW.id AND case_ln_id=NEW.case_ln_id AND his_received_at=NEW.received_at)
   OR NOT EXISTS(SELECT 1 FROM nipt_case WHERE id=NEW.case_id AND current_round_id=NEW.id)
  THEN RAISE EXCEPTION 'WORKER_ROUND2_PROHIBITED'; END IF;
 END IF; RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION p4_ensure_ln_halos(p_round uuid,p_path text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE r specimen_round; original specimen_lab_number; code text; BEGIN
 IF p_path NOT IN ('RECEIPT_TRIGGER','RECEIPT_RECOVERY') THEN RAISE EXCEPTION 'LN_HALOS_ISSUE_PATH_INVALID'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_round::text,75432810));
 SELECT * INTO r FROM specimen_round WHERE id=p_round;
 IF r.id IS NULL OR r.received_at IS NULL OR r.received_source IS NULL THEN RAISE EXCEPTION 'LN_HALOS_REQUIRES_RECEIPT'; END IF;
 SELECT ln_halos INTO code FROM specimen_lab_number WHERE round_id=p_round;
 IF code IS NOT NULL THEN RETURN code; END IF;
 IF r.round_number=1 OR r.received_source='NIPT_LOCAL_RECEIPT' THEN RETURN p4_issue_original_ln_halos(p_round,p_path); END IF;
 SELECT n.* INTO original FROM specimen_lab_number n JOIN specimen_round s ON s.id=n.round_id WHERE s.case_id=r.case_id AND s.round_number=1;
 IF original.round_id IS NULL THEN RAISE EXCEPTION 'ORIGINAL_LN_HALOS_REQUIRED'; END IF;
 INSERT INTO specimen_lab_number(round_id,case_id,ln_halos,sequence_date,sequence_value,issued_on,issue_path,original_round_id)
 VALUES(r.id,r.case_id,original.ln_halos,original.sequence_date,original.sequence_value,r.received_source,p_path,original.round_id);
 INSERT INTO analytical_attempt(case_id,round_id,attempt_number,state) VALUES(r.case_id,r.id,1,'Ready');
 RETURN original.ln_halos;
END $$;
