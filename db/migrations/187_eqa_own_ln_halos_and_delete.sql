-- EQA has its own LN Halos number space and its unused registration can be deleted, freeing the number.
--  * Same format as a patient's (YYB + yymmdd + nnn) so HALOS/NIFTY/labels read it unchanged, but the running number 900-999 is reserved for EQA
--    and 001-899 for patients. The database enforces both directions, so an EQA can never take a patient's number and a patient never an EQA's.
--  * Deleting an EQA registration is allowed only while nothing else was built on it (checked table by table below, failing closed); it leaves a
--    tombstone and the audit trail, and the number becomes reusable.
CREATE TABLE eqa_ln_halos_sequence (
 sequence_month date PRIMARY KEY,
 last_value integer NOT NULL DEFAULT 899 CHECK(last_value BETWEEN 899 AND 999)
);
CREATE TABLE eqa_registration_deleted (
 case_id uuid PRIMARY KEY,
 organizer text NOT NULL,program_year integer NOT NULL,sample_ref text NOT NULL,
 ln text NOT NULL,ln_halos text NOT NULL,number_reusable boolean NOT NULL,
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 3 AND 200),
 deleted_by uuid NOT NULL REFERENCES app_user,
 deleted_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER eqa_registration_deleted_immutable BEFORE UPDATE OR DELETE ON eqa_registration_deleted FOR EACH ROW EXECUTE FUNCTION immutable_row();

-- Number space guard. Historical imports keep their original numbers and are exempt.
CREATE FUNCTION eqa_ln_halos_range_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE is_eqa boolean;
BEGIN
 IF NEW.issue_path='MIGRATION_IMPORT' THEN RETURN NEW; END IF;
 is_eqa:=EXISTS(SELECT 1 FROM public.eqa_case WHERE case_id=NEW.case_id);
 IF NEW.sequence_value>=900 AND NOT is_eqa THEN RAISE EXCEPTION 'LN_HALOS_900_PLUS_RESERVED_FOR_EQA'; END IF;
 IF is_eqa AND NEW.sequence_value<900 AND NEW.original_round_id IS NULL THEN RAISE EXCEPTION 'EQA_LN_HALOS_MUST_USE_EQA_RANGE'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER a_eqa_ln_halos_range_guard BEFORE INSERT ON specimen_lab_number FOR EACH ROW EXECUTE FUNCTION eqa_ln_halos_range_guard();

-- Issues the EQA's LN Halos before its receipt is recorded, so the patient allocator (receipt trigger) finds a number and does not consume one.
CREATE FUNCTION eqa_issue_ln_halos(p_round uuid,p_requested text DEFAULT NULL) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE r specimen_round; code text; d date; m date; n integer;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(p_round::text,75432810));
 SELECT * INTO r FROM specimen_round WHERE id=p_round;
 IF r.id IS NULL OR NOT EXISTS(SELECT 1 FROM eqa_case WHERE round_id=p_round AND case_id=r.case_id) THEN RAISE EXCEPTION 'EQA_ROUND_REQUIRED'; END IF;
 IF EXISTS(SELECT 1 FROM specimen_lab_number WHERE round_id=p_round) THEN RAISE EXCEPTION 'EQA_LN_HALOS_ALREADY_ISSUED'; END IF;
 PERFORM pg_advisory_xact_lock(75432872);   -- same order as the patient allocator: 75432872, then the audit chain, then the sequence
 PERFORM pg_advisory_xact_lock(75432801);
 IF p_requested IS NOT NULL THEN
  IF p_requested !~ '^[0-9]{2}B[0-9]{9}$' THEN RAISE EXCEPTION 'EQA_LN_HALOS_FORMAT'; END IF;
  n:=substr(p_requested,10,3)::integer;
  IF n<900 THEN RAISE EXCEPTION 'EQA_LN_HALOS_RANGE_900_999'; END IF;
  BEGIN d:=to_date('20'||substr(p_requested,4,6),'YYYYMMDD');
  EXCEPTION WHEN others THEN RAISE EXCEPTION 'EQA_LN_HALOS_DATE_INVALID'; END;
  code:=p4_format_ln_halos(d,n);
  IF code IS DISTINCT FROM p_requested THEN RAISE EXCEPTION 'EQA_LN_HALOS_FORMAT'; END IF;
  IF EXISTS(SELECT 1 FROM specimen_lab_number WHERE ln_halos=code) THEN RAISE EXCEPTION 'EQA_LN_HALOS_IN_USE'; END IF;
 ELSE
  d:=p4_bangkok_date(now());m:=p4_ln_halos_month(d);
  INSERT INTO eqa_ln_halos_sequence(sequence_month) VALUES(m) ON CONFLICT(sequence_month) DO NOTHING;
  LOOP
   SELECT last_value INTO n FROM eqa_ln_halos_sequence WHERE sequence_month=m FOR UPDATE;
   IF n>=999 THEN RAISE EXCEPTION 'EQA_LN_HALOS_BLOCK_EXHAUSTED'; END IF;
   n:=n+1;UPDATE eqa_ln_halos_sequence SET last_value=n WHERE sequence_month=m;
   code:=p4_format_ln_halos(d,n);
   EXIT WHEN NOT EXISTS(SELECT 1 FROM specimen_lab_number WHERE ln_halos=code);
  END LOOP;
 END IF;
 INSERT INTO specimen_lab_number(round_id,case_id,ln_halos,sequence_date,sequence_value,issued_on,issue_path)
  VALUES(r.id,r.case_id,code,d,n,'NIPT_LOCAL_RECEIPT','RECEIPT_TRIGGER');
 INSERT INTO analytical_attempt(case_id,round_id,attempt_number,state) VALUES(r.case_id,r.id,1,'Ready') ON CONFLICT(round_id,attempt_number) DO NOTHING;
 RETURN code;
END $$;

-- Deletes an EQA registration that nothing was built on. Fails closed: every table that references the case, its round, LN, attempt or
-- LN Halos row is scanned; only the registration's own tables (and the audit trail, which stays) may hold a reference.
-- It runs as the migration owner (a superuser on the installed server) and switches triggers off only for the explicit DELETE list inside this one
-- transaction; a final scan proves no reference was left behind, otherwise everything is rolled back.
CREATE FUNCTION eqa_delete_registration(p_case uuid,p_actor uuid,p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE e eqa_case; num specimen_lab_number; lnv text; ids uuid[]; t record; n bigint; reusable boolean:=false; prior text; cnt integer;
 own constant text[]:=ARRAY['analytical_attempt','audit_chain','case_event','case_ln','case_unit_scope','eqa_case','nipt_case','p2_case_identity','p2_workspace','registration_attempt','specimen_acceptance','specimen_lab_number','specimen_round'];
BEGIN
 IF p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 3 AND 200 THEN RAISE EXCEPTION 'EQA_DELETE_REASON_REQUIRED'; END IF;
 IF NOT EXISTS(SELECT 1 FROM role_assignment a JOIN app_user u ON u.id=a.user_id WHERE u.id=p_actor AND u.enabled
   AND a.role IN ('APP_ADMIN','LAB_STAFF','LAB_CERTIFIER') AND a.effective_from<=now() AND (a.expires_at IS NULL OR a.expires_at>now())) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 PERFORM pg_advisory_xact_lock(75432872);PERFORM pg_advisory_xact_lock(75432801);
 SELECT * INTO e FROM eqa_case WHERE case_id=p_case FOR UPDATE;
 IF e.case_id IS NULL THEN RAISE EXCEPTION 'EQA_NOT_FOUND'; END IF;
 PERFORM 1 FROM nipt_case WHERE id=p_case FOR UPDATE;
 IF (SELECT count(*) FROM specimen_round WHERE case_id=p_case)<>1 OR EXISTS(SELECT 1 FROM specimen_round WHERE case_id=p_case AND (analysis_started OR round_number<>1))
  OR EXISTS(SELECT 1 FROM analytical_attempt WHERE case_id=p_case AND (state<>'Ready' OR attempt_number<>1)) THEN RAISE EXCEPTION 'EQA_HAS_DOWNSTREAM_WORK'; END IF;
 SELECT * INTO num FROM specimen_lab_number WHERE round_id=e.round_id;
 SELECT ln INTO lnv FROM case_ln WHERE case_id=p_case;
 ids:=ARRAY[p_case,e.round_id]||COALESCE((SELECT array_agg(id) FROM case_ln WHERE case_id=p_case),'{}')||COALESCE((SELECT array_agg(id) FROM analytical_attempt WHERE case_id=p_case),'{}')
  ||COALESCE((SELECT array_agg(id) FROM specimen_acceptance WHERE round_id=e.round_id),'{}');
 FOR t IN SELECT c.table_name,c.column_name FROM information_schema.columns c JOIN information_schema.tables x ON x.table_schema=c.table_schema AND x.table_name=c.table_name
   WHERE c.table_schema='public' AND x.table_type='BASE TABLE' AND c.data_type='uuid' LOOP
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I=ANY($1)',t.table_name,t.column_name) INTO n USING ids;
  IF n>0 AND t.table_name<>ALL(own) AND t.table_name<>'eqa_registration_deleted' THEN RAISE EXCEPTION 'EQA_HAS_DOWNSTREAM_WORK' USING DETAIL=t.table_name; END IF;
 END LOOP;
 IF num.round_id IS NOT NULL THEN
  IF num.sequence_value>=900 THEN
   UPDATE eqa_ln_halos_sequence SET last_value=last_value-1 WHERE sequence_month=p4_ln_halos_month(num.sequence_date) AND last_value=num.sequence_value AND last_value>899;
   reusable:=true;   -- a number in the EQA block can always be typed again
  ELSE
   UPDATE ln_halos_monthly_sequence SET last_value=last_value-1 WHERE sequence_month=p4_ln_halos_month(num.sequence_date) AND last_value=num.sequence_value;
   GET DIAGNOSTICS cnt=ROW_COUNT;reusable:=cnt=1;   -- a patient-sequence number returns only if it is the latest issued; otherwise it stays a gap
  END IF;
 END IF;
 INSERT INTO eqa_registration_deleted(case_id,organizer,program_year,sample_ref,ln,ln_halos,number_reusable,reason,deleted_by)
  VALUES(p_case,e.organizer,e.program_year,e.sample_ref,lnv,COALESCE(num.ln_halos,'-'),reusable,btrim(p_reason),p_actor);
 prior:=current_setting('session_replication_role');
 SET LOCAL session_replication_role=replica;
 DELETE FROM specimen_acceptance WHERE round_id=e.round_id;
 DELETE FROM analytical_attempt WHERE case_id=p_case;
 DELETE FROM specimen_lab_number WHERE round_id=e.round_id;
 DELETE FROM eqa_case WHERE case_id=p_case;
 DELETE FROM p2_workspace WHERE case_id=p_case;
 DELETE FROM case_event WHERE case_id=p_case;
 DELETE FROM case_unit_scope WHERE case_id=p_case;
 DELETE FROM p2_case_identity WHERE case_id=p_case;
 DELETE FROM registration_attempt WHERE case_id=p_case;
 DELETE FROM specimen_round WHERE case_id=p_case;
 DELETE FROM case_ln WHERE case_id=p_case;
 DELETE FROM nipt_case WHERE id=p_case;
 PERFORM set_config('session_replication_role',prior,true);
 FOR t IN SELECT c.table_name,c.column_name FROM information_schema.columns c JOIN information_schema.tables x ON x.table_schema=c.table_schema AND x.table_name=c.table_name
   WHERE c.table_schema='public' AND x.table_type='BASE TABLE' AND c.data_type='uuid' LOOP
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %I=ANY($1)',t.table_name,t.column_name) INTO n USING ids;
  IF n>0 AND t.table_name NOT IN ('audit_chain','eqa_registration_deleted') THEN RAISE EXCEPTION 'EQA_DELETE_INTEGRITY' USING DETAIL=t.table_name; END IF;
 END LOOP;
 RETURN jsonb_build_object('lnHalos',COALESCE(num.ln_halos,'-'),'numberReusable',reusable);
END $$;

REVOKE ALL ON FUNCTION eqa_issue_ln_halos(uuid,text),eqa_delete_registration(uuid,uuid,text) FROM PUBLIC;
REVOKE ALL ON eqa_ln_halos_sequence,eqa_registration_deleted FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='app_rw') THEN
  GRANT EXECUTE ON FUNCTION eqa_issue_ln_halos(uuid,text),eqa_delete_registration(uuid,uuid,text) TO app_rw;
  GRANT SELECT ON eqa_registration_deleted TO app_rw;
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='report_ro') THEN GRANT SELECT ON eqa_registration_deleted TO report_ro; END IF;
END $$;
