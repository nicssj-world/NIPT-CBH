-- Preserve runtime least privilege: web cannot insert arbitrary specimen numbers.
-- This helper can reserve only the original pair in an authenticated administrator's imported source plan.
CREATE FUNCTION migration_reserve_original_number(record_id uuid,actor uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE m migration_record; r specimen_round; base text; existing text; source_date date; seq integer;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM app_user u JOIN role_assignment a ON a.user_id=u.id WHERE u.id=actor AND u.enabled
  AND a.role='APP_ADMIN' AND a.effective_from<=now() AND(a.expires_at IS NULL OR a.expires_at>now())) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 SELECT * INTO m FROM migration_record WHERE id=record_id FOR UPDATE;
 IF m.id IS NULL OR m.state<>'IMPORTED' OR m.case_id IS NULL OR m.round_id IS NULL
 OR NOT EXISTS(SELECT 1 FROM migration_execution e JOIN migration_source s ON s.execution_id=e.id AND s.kind='GENOMIC_MAPPING'
  CROSS JOIN LATERAL jsonb_array_elements(e.plan->'mappings') p WHERE e.id=m.execution_id AND p->>'hisLn'=m.ln AND p->>'halosId'=m.ln_halos AND p->>'valid'='true')
 THEN RAISE EXCEPTION 'MIGRATION_VERIFIED_IDENTIFIER_SOURCE_REQUIRED'; END IF;
 SELECT s.* INTO r FROM specimen_round s JOIN nipt_case c ON c.id=s.case_id WHERE s.id=m.round_id AND s.case_id=m.case_id
 AND c.registration_origin='LAB_DIRECT' AND c.current_round_id=s.id;
 IF r.id IS NULL THEN RAISE EXCEPTION 'MIGRATION_OPERATIONAL_BINDING_REQUIRED'; END IF;
 base:=substring(m.ln_halos from '^([0-9]{2}B[0-9]{9})');
 IF base IS NULL THEN RAISE EXCEPTION 'MIGRATION_IDENTIFIER_LINEAGE_REVIEW_REQUIRED'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(r.id::text,75432810));
 SELECT ln_halos INTO existing FROM specimen_lab_number WHERE round_id=r.id;
 IF existing IS NOT NULL THEN
  IF existing<>base THEN RAISE EXCEPTION 'MIGRATION_IDENTIFIER_CONFLICT'; END IF;
  RETURN existing;
 END IF;
 source_date:=('20'||substring(base from 4 for 2)||'-'||substring(base from 6 for 2)||'-'||substring(base from 8 for 2))::date;
 seq:=substring(base from 10 for 3)::integer;
 INSERT INTO specimen_lab_number(round_id,case_id,ln_halos,sequence_date,sequence_value,issued_on,issue_path)
 VALUES(r.id,r.case_id,base,source_date,seq,'MIGRATION_SOURCE','MIGRATION_IMPORT');
 RETURN base;
END $$;
REVOKE ALL ON FUNCTION migration_reserve_original_number(uuid,uuid) FROM PUBLIC;
DO $$ BEGIN IF EXISTS(SELECT FROM pg_roles WHERE rolname='app_rw') THEN GRANT EXECUTE ON FUNCTION migration_reserve_original_number(uuid,uuid) TO app_rw; END IF; END $$;
