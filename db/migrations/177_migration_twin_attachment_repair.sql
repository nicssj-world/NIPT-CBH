-- Owner decision 2026-11-02 (twin pregnancy "<LN Halos>D-<n>"): a twin analysis imported before the parser knew the D form was kept as an
-- unresolved HALOS row while its case already existed with a bare first attempt. The immutability guards stay in force for everything else;
-- this function is the one audited, evidence-checked correction for that exact situation, and it is idempotent (a repaired row no longer matches).
-- It changes nothing unless ALL of these hold for a candidate: an unresolved result row printed "<12 chars>D-<n>", the same run's sampleinfo carries
-- "<12 chars>D", exactly one IMPORTED record owns that plain LN Halos with a bound case, and its attempt is the bare Ready attempt with that number.
CREATE FUNCTION migration_repair_twin_attachments(actor uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE candidates uuid[]; cid uuid; a migration_analysis; si migration_analysis; m migration_record; att analytical_attempt; base text; ordinal integer; repaired integer:=0; skipped integer:=0; ids jsonb:='[]'::jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM app_user u JOIN role_assignment r ON r.user_id=u.id WHERE u.id=actor AND u.enabled AND r.role='APP_ADMIN' AND r.effective_from<=now() AND (r.expires_at IS NULL OR r.expires_at>now())) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 PERFORM pg_advisory_xact_lock(75432873);
 -- the candidate ids are collected first: ALTER TABLE cannot run while a cursor on the same table is open
 SELECT COALESCE(array_agg(x.id ORDER BY x.id),'{}') INTO candidates FROM migration_analysis x WHERE x.record_id IS NULL AND x.attempt_id IS NULL AND x.sheet='result' AND x.classification='UNRESOLVED'
   AND btrim(x.sample_raw) ~ '^[0-9]{2}B[0-9]{9}D-[1-9][0-9]?$';
 FOREACH cid IN ARRAY candidates LOOP
  SELECT * INTO a FROM migration_analysis x WHERE x.id=cid AND x.record_id IS NULL AND x.attempt_id IS NULL FOR UPDATE;
  IF a.id IS NULL THEN CONTINUE; END IF;
  base:=substring(btrim(a.sample_raw) from 1 for 12);ordinal:=substring(btrim(a.sample_raw) from '-([1-9][0-9]?)$')::integer;
  IF (SELECT count(*) FROM migration_analysis s WHERE s.source_id=a.source_id AND s.sheet='sampleinfo' AND btrim(s.sample_raw)=base||'D')<>1
   OR (SELECT count(*) FROM migration_record r WHERE r.ln_halos=base AND r.state='IMPORTED')<>1 THEN skipped:=skipped+1;CONTINUE; END IF;
  SELECT * INTO si FROM migration_analysis s WHERE s.source_id=a.source_id AND s.sheet='sampleinfo' AND btrim(s.sample_raw)=base||'D';
  SELECT * INTO m FROM migration_record r WHERE r.ln_halos=base AND r.state='IMPORTED' FOR UPDATE;
  IF m.case_id IS NULL OR m.round_id IS NULL OR m.attempt_id IS NULL OR EXISTS(SELECT 1 FROM migration_analysis x WHERE x.record_id=m.id AND x.classification='ANALYSIS') THEN skipped:=skipped+1;CONTINUE; END IF;
  SELECT * INTO att FROM analytical_attempt t WHERE t.id=m.attempt_id AND t.case_id=m.case_id AND t.round_id=m.round_id AND t.attempt_number=ordinal AND t.state='Ready' AND t.printed_sample_id IS NULL AND t.historical_source_id IS NULL;
  IF att.id IS NULL OR a.advice_status<>'QUALIFIED' THEN skipped:=skipped+1;CONTINUE; END IF;
  ALTER TABLE migration_analysis DISABLE TRIGGER migration_analysis_guard;
  ALTER TABLE analytical_attempt DISABLE TRIGGER migration_historical_attempt_guard;
  UPDATE migration_analysis SET record_id=m.id,classification='ANALYSIS',attempt_number=ordinal,is_current=true,sampleinfo=si.raw WHERE id=a.id;
  UPDATE analytical_attempt SET printed_sample_id=btrim(a.sample_raw),historical_source_id=a.id WHERE id=att.id;
  UPDATE migration_analysis SET attempt_id=att.id WHERE id=a.id;
  ALTER TABLE analytical_attempt ENABLE TRIGGER migration_historical_attempt_guard;
  ALTER TABLE migration_analysis ENABLE TRIGGER migration_analysis_guard;
  UPDATE migration_record SET classification='QUALIFIED_PDF_PENDING',row_version=row_version+1 WHERE id=m.id AND classification='NO_HALOS';
  INSERT INTO migration_record_event(record_id,actor_id,event,details) VALUES(m.id,actor,'TWIN_ANALYSIS_ATTACHED',jsonb_build_object('analysisId',a.id,'sampleinfoId',si.id,'attemptId',att.id,'attemptNumber',ordinal));
  repaired:=repaired+1;ids:=ids||jsonb_build_array(m.id);
 END LOOP;
 RETURN jsonb_build_object('repaired',repaired,'skipped',skipped,'records',ids);
END $$;
REVOKE ALL ON FUNCTION migration_repair_twin_attachments(uuid) FROM PUBLIC;
DO $$ BEGIN IF EXISTS(SELECT FROM pg_roles WHERE rolname='app_rw') THEN GRANT EXECUTE ON FUNCTION migration_repair_twin_attachments(uuid) TO app_rw; END IF; END $$;
