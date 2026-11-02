-- v1.1.3 EQA: an external proficiency-testing specimen is an ordinary LAB_DIRECT case (same Task List, QC, HALOS, ReadyGen,
-- report and certification as a patient) with two differences enforced in the database: it has no HIS PET, and it must never
-- produce any HIS outbound result (RES, CFS PDF, transfer, outbox delivery, retry or replay).
-- Existing composed release guards are NOT replaced: new triggers are added beside them and p6_release_eligible is wrapped
-- (the same pattern as migrations 165/166), so every clinical gate that exists today keeps running first.
-- Fields are copied from the organizer's referral card; nothing is inferred (the card has no EDD, so none is stored).
CREATE TABLE eqa_case (
 case_id uuid PRIMARY KEY REFERENCES nipt_case,
 round_id uuid NOT NULL,
 organizer text NOT NULL CHECK(length(btrim(organizer)) BETWEEN 1 AND 120),
 program_year integer NOT NULL CHECK(program_year BETWEEN 2020 AND 2100),
 sample_ref text NOT NULL CHECK(length(btrim(sample_ref)) BETWEEN 1 AND 80),
 surname text NOT NULL CHECK(length(btrim(surname)) BETWEEN 1 AND 120),
 first_name text NOT NULL CHECK(length(btrim(first_name)) BETWEEN 1 AND 120),
 dob date NOT NULL,
 ga_weeks integer NOT NULL CHECK(ga_weeks BETWEEN 0 AND 45),
 ga_days integer NOT NULL CHECK(ga_days BETWEEN 0 AND 6),
 collection_date date NOT NULL,
 pregnancy text NOT NULL CHECK(pregnancy IN ('Singleton','Twins')),
 note text CHECK(note IS NULL OR length(note)<=200),
 registered_by uuid NOT NULL REFERENCES app_user,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(organizer,program_year,sample_ref),
 UNIQUE(round_id),
 FOREIGN KEY(round_id,case_id) REFERENCES specimen_round(id,case_id)
);
CREATE TRIGGER eqa_case_immutable BEFORE UPDATE OR DELETE ON eqa_case FOR EACH ROW EXECUTE FUNCTION immutable_row();

CREATE FUNCTION nipt_case_is_eqa(c uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM public.eqa_case WHERE case_id=c)
$$;
REVOKE ALL ON FUNCTION nipt_case_is_eqa(uuid) FROM PUBLIC;

-- A real patient can never be reclassified: the case must be an unreceived-by-HIS LAB_DIRECT case with no PET, order,
-- release or transfer, and its current round must be the first one. Fails closed on anything else.
CREATE FUNCTION eqa_case_insert_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM nipt_case c JOIN specimen_round r ON r.case_id=c.id AND r.id=NEW.round_id
   WHERE c.id=NEW.case_id AND c.registration_origin='LAB_DIRECT' AND c.current_round_id=r.id AND r.round_number=1
    AND r.received_at IS NULL AND r.received_source IS NULL) THEN RAISE EXCEPTION 'EQA_REQUIRES_NEW_LAB_DIRECT_CASE'; END IF;
 IF EXISTS(SELECT 1 FROM his_inbound_file WHERE case_id=NEW.case_id)
  OR EXISTS(SELECT 1 FROM his_order o JOIN case_ln l ON l.id=o.case_ln_id WHERE l.case_id=NEW.case_id)
  OR EXISTS(SELECT 1 FROM result_release WHERE case_id=NEW.case_id)
  OR EXISTS(SELECT 1 FROM migration_record WHERE case_id=NEW.case_id)
 THEN RAISE EXCEPTION 'EQA_CASE_HAS_PATIENT_EVIDENCE'; END IF;
  IF NOT EXISTS(SELECT 1 FROM app_user WHERE id=NEW.registered_by AND enabled) THEN RAISE EXCEPTION 'EQA_ACTOR_INVALID'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER eqa_case_insert_guard BEFORE INSERT ON eqa_case FOR EACH ROW EXECUTE FUNCTION eqa_case_insert_guard();

-- 1. A PET that later names an EQA case's LN cannot become a HIS receipt for it.
CREATE FUNCTION eqa_his_order_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM case_ln l JOIN eqa_case e ON e.case_id=l.case_id WHERE l.id=NEW.case_ln_id) THEN RAISE EXCEPTION 'EQA_CASE_REJECTS_HIS_RECEIPT'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER eqa_his_order_guard BEFORE INSERT ON his_order FOR EACH ROW EXECUTE FUNCTION eqa_his_order_guard();

-- 2. No transfer (RES/CFS/OK journal) can be reserved for an EQA release, whatever path inserts it.
CREATE FUNCTION eqa_transfer_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF NEW.clinical_release_id IS NOT NULL AND EXISTS(SELECT 1 FROM result_release r JOIN eqa_case e ON e.case_id=r.case_id WHERE r.id=NEW.clinical_release_id)
 THEN RAISE EXCEPTION 'EQA_NO_HIS_TRANSFER'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER eqa_transfer_guard BEFORE INSERT ON p6_transfer FOR EACH ROW EXECUTE FUNCTION eqa_transfer_guard();

-- 3. No outbox job that names an EQA case, release, version or transfer (delivery, retry, replay, reroute).
--    Identifiers are compared as text so a malformed payload cannot raise a cast error and skip the check.
CREATE FUNCTION eqa_outbox_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF jsonb_typeof(NEW.payload)='object' AND (
   EXISTS(SELECT 1 FROM eqa_case e WHERE e.case_id::text=NEW.payload->>'caseId')
   OR EXISTS(SELECT 1 FROM result_release r JOIN eqa_case e ON e.case_id=r.case_id
      WHERE r.id::text=NEW.payload->>'releaseId' OR r.version_id::text=NEW.payload->>'versionId')
   OR EXISTS(SELECT 1 FROM p6_transfer t JOIN result_release r ON r.id=t.clinical_release_id JOIN eqa_case e ON e.case_id=r.case_id
      WHERE t.id::text=NEW.payload->>'transferId')
 ) THEN RAISE EXCEPTION 'EQA_NO_HIS_OUTBOUND'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER eqa_outbox_guard BEFORE INSERT ON job_outbox FOR EACH ROW EXECUTE FUNCTION eqa_outbox_guard();

-- 4. The worker's eligibility test is false for an EQA release (wraps the current composed function).
ALTER FUNCTION p6_release_eligible(uuid,integer) RENAME TO eqa_unfiltered_release_eligible;
CREATE FUNCTION p6_release_eligible(rid uuid,expected_epoch integer) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT eqa_unfiltered_release_eligible(rid,expected_epoch) AND NOT EXISTS(SELECT 1 FROM result_release r JOIN eqa_case e ON e.case_id=r.case_id WHERE r.id=rid)
$$;
REVOKE ALL ON FUNCTION eqa_unfiltered_release_eligible(uuid,integer),p6_release_eligible(uuid,integer) FROM PUBLIC;

DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='app_rw') THEN
  GRANT SELECT,INSERT ON eqa_case TO app_rw;
  GRANT EXECUTE ON FUNCTION nipt_case_is_eqa(uuid),p6_release_eligible(uuid,integer) TO app_rw;
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='worker_rw') THEN
  GRANT SELECT ON eqa_case TO worker_rw;
  GRANT EXECUTE ON FUNCTION nipt_case_is_eqa(uuid),p6_release_eligible(uuid,integer) TO worker_rw;
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='report_ro') THEN GRANT SELECT ON eqa_case TO report_ro; END IF;
END $$;
