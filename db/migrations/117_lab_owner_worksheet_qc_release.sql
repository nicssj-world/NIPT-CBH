-- Owner 2026-10-22: latest Master QC1 and paper-first LAB workflow.
-- This is a separate, explicit evidence class. Never fabricate legacy F2/P4b/P4c
-- execution, HALOS import, QC observations, times or acceptance rows.
CREATE TABLE lab_bench_review(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),batch_id uuid NOT NULL REFERENCES lab_batch,
 workbook_revision_id uuid NOT NULL REFERENCES task_workbook_revision,
 source_sha256 text NOT NULL CHECK(source_sha256 ~ '^[a-f0-9]{64}$'),
 criteria_reference text NOT NULL CHECK(criteria_reference='OWNER-MASTER-LAB-20261022'),
 qc_measurements_reviewed boolean NOT NULL CHECK(qc_measurements_reviewed),
 pooling_reviewed boolean NOT NULL CHECK(pooling_reviewed),
 sequencing_reviewed boolean NOT NULL CHECK(sequencing_reviewed),
 reason text NOT NULL CHECK(length(trim(reason))>=8),reviewer_id uuid NOT NULL REFERENCES app_user,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(workbook_revision_id,reviewer_id)
);
CREATE TRIGGER lab_bench_review_immutable BEFORE UPDATE OR DELETE ON lab_bench_review FOR EACH ROW EXECUTE FUNCTION immutable_row();
CREATE FUNCTION lab_bench_revision_sha(target uuid) RETURNS text LANGUAGE sql STABLE AS $$
 SELECT encode(sha256(convert_to(jsonb_build_object('id',r.id,'master',r.master_sha256,'source',r.source_snapshot,'values',r.values)::text,'UTF8')),'hex') FROM task_workbook_revision r WHERE r.id=target
$$;
CREATE FUNCTION lab_bench_measurements_ready(target uuid) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE r task_workbook_revision; v jsonb; placement jsonb; s jsonb; k text; n numeric;
BEGIN
 SELECT * INTO r FROM task_workbook_revision WHERE batch_id=target ORDER BY revision DESC LIMIT 1;
 IF r.id IS NULL OR NOT nipt_operational_enabled() OR r.master_sha256<>'4c5300f9039af57c0d0649160f5da8e4c2ee1ed7ae44dd7aa525823104f9c7f1'
 OR NOT EXISTS(SELECT 1 FROM lab_batch b WHERE b.id=target AND b.state<>'Cancelled')
 OR EXISTS(SELECT 1 FROM lab_batch_removal WHERE batch_id=target)
 OR jsonb_typeof(r.source_snapshot->'placements') IS DISTINCT FROM 'array'
 OR jsonb_array_length(r.source_snapshot->'placements')<>3 THEN RETURN false; END IF;
 v:=r.values;
 FOR placement IN SELECT jsonb_array_elements(r.source_snapshot->'placements') LOOP
  IF NOT EXISTS(SELECT 1 FROM lab_placement_snapshot p JOIN lab_task_sheet t ON t.id=p.sheet_id WHERE p.id::text=placement->>'id' AND t.batch_id=target AND p.content_hash=placement->>'content_hash' AND p.payload=placement->'payload' AND p.revision=(SELECT max(x.revision) FROM lab_placement_snapshot x WHERE x.sheet_id=t.id)) THEN RETURN false; END IF;
  FOR s IN SELECT jsonb_array_elements(placement->'payload'->'slots') LOOP
   k:='slot.'||(s->>'slot')||'.libraryQc';
   IF s->>'control' IS NOT NULL OR s->>'attemptId' IS NOT NULL THEN
    IF jsonb_typeof(v->k) IS DISTINCT FROM 'number' THEN RETURN false; END IF;
    n:=(v->>k)::numeric;
    -- QC1 may accept a measured BLANK zero; the separate preserved Pooling
    -- formula cannot divide by zero and therefore cannot complete that artifact.
    IF n=0 THEN RETURN false; END IF;
    IF s->>'control'='blank' THEN IF n<0 OR n>0.60 THEN RETURN false; END IF;
    ELSE IF n<2.00 THEN RETURN false; END IF; END IF;
   ELSIF v->>k IS NOT NULL THEN RETURN false;
   END IF;
   IF s->>'attemptId' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM lab_slot_assignment a JOIN analytical_attempt x ON x.id=a.attempt_id JOIN nipt_case c ON c.id=x.case_id WHERE a.batch_id=target AND a.attempt_id::text=s->>'attemptId' AND a.slot_number=(s->>'slot')::int AND a.removed_at IS NULL AND x.round_id=c.current_round_id AND x.state IN ('Assigned','InProgress','AnalysisComplete','FinalQcAccepted','Final')) THEN RETURN false; END IF;
  END LOOP;
 END LOOP;
 FOR k IN SELECT 'qc.'||strip||'.'||field FROM generate_series(1,3) strip CROSS JOIN unnest(ARRAY['standard1','standard2','standard2Concentration']) field LOOP
  IF jsonb_typeof(v->k) IS DISTINCT FROM 'number' OR (v->>k)::numeric<0 THEN RETURN false; END IF;
 END LOOP;
 FOREACH k IN ARRAY ARRAY['pool.standard1','pool.standard2','pool.standard2Concentration','pool.concentration'] LOOP
  IF jsonb_typeof(v->k) IS DISTINCT FROM 'number' OR (v->>k)::numeric<0 THEN RETURN false; END IF;
 END LOOP;
 n:=(v->>'pool.concentration')::numeric;
 IF n<3.00 OR n>3.60 THEN
  IF jsonb_typeof(v->'pool.dilutionC1') IS DISTINCT FROM 'number' THEN RETURN false; END IF;
  n:=(v->>'pool.dilutionC1')::numeric;
  -- Equivalent to the preserved Master EB formula being finite and non-negative.
  IF n<=0 OR 100-(3.33*100)/n<0 THEN RETURN false; END IF;
 END IF;
 FOREACH k IN ARRAY ARRAY['seq.instrument','seq.barcodeType','seq.standard1','seq.standard2','seq.standard2Concentration','seq.dnbConcentration','seq.dilutedConcentration','seq.driveMemoryTb','seq.negativePressureKpa','seq.loadedDnb','seq.q30','seq.bic','seq.fit'] LOOP
  IF jsonb_typeof(v->k) IS DISTINCT FROM 'number' THEN RETURN false; END IF;
  IF k<>'seq.negativePressureKpa' AND (v->>k)::numeric<0 THEN RETURN false; END IF;
 END LOOP;
 FOREACH k IN ARRAY ARRAY['seq.date','seq.operator','seq.dnbId','seq.reagentConfirmation.28','seq.reagentConfirmation.29','seq.reagentConfirmation.30','seq.reagentConfirmation.31'] LOOP
  IF jsonb_typeof(v->k) IS DISTINCT FROM 'string' OR length(trim(v->>k))=0 THEN RETURN false; END IF;
 END LOOP;
 IF v->'seq.chipPositionedFirmly' IS DISTINCT FROM 'true'::jsonb THEN RETURN false; END IF;
 -- Review binds an actual current vendor export, not merely a UI field.
 IF NOT EXISTS(SELECT 1 FROM lab_bench_export e WHERE e.batch_id=target AND e.workbook_revision_id=r.id AND e.kind='NIFTY_XLSX') THEN RETURN false; END IF;
 RETURN true;
END $$;
CREATE FUNCTION lab_bench_review_current(target uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM lab_bench_review q JOIN task_workbook_revision r ON r.id=q.workbook_revision_id WHERE q.id=target AND r.batch_id=q.batch_id AND r.id=(SELECT id FROM task_workbook_revision WHERE batch_id=q.batch_id ORDER BY revision DESC LIMIT 1) AND q.source_sha256=lab_bench_revision_sha(r.id) AND lab_bench_measurements_ready(q.batch_id))
$$;
CREATE FUNCTION lab_bench_review_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM id FROM lab_batch WHERE id=NEW.batch_id FOR UPDATE NOWAIT;
 IF NOT nipt_operational_enabled() OR NOT lab_bench_measurements_ready(NEW.batch_id)
 OR NOT EXISTS(SELECT 1 FROM task_workbook_revision r WHERE r.id=NEW.workbook_revision_id AND r.batch_id=NEW.batch_id AND r.id=(SELECT id FROM task_workbook_revision WHERE batch_id=NEW.batch_id ORDER BY revision DESC LIMIT 1) AND r.created_by<>NEW.reviewer_id AND NEW.source_sha256=lab_bench_revision_sha(r.id))
 OR NOT EXISTS(SELECT 1 FROM role_assignment a WHERE a.user_id=NEW.reviewer_id AND a.role='LAB_CERTIFIER' AND a.approved_by IS NOT NULL AND a.effective_from<=now() AND (a.expires_at IS NULL OR a.expires_at>now()))
 THEN RAISE EXCEPTION 'OWNER_WORKSHEET_MEASUREMENTS_AND_PEER_REVIEW_REQUIRED'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER lab_bench_review_guard BEFORE INSERT ON lab_bench_review FOR EACH ROW EXECUTE FUNCTION lab_bench_review_guard();

-- Paper Lab route bypasses ANC entry/re-signing, not a recorded clinical failure,
-- withdrawal, identity conflict, reviewer role or the active specimen round.
CREATE FUNCTION lab_owner_paper_ready(target uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM specimen_round r JOIN nipt_case c ON c.id=r.case_id WHERE r.id=target AND c.current_round_id=r.id AND c.registration_origin='LAB_DIRECT'
 AND EXISTS(SELECT 1 FROM lab_operational_registration l WHERE l.case_id=c.id AND l.paper_request AND l.paper_consent)
 AND NOT EXISTS(SELECT 1 FROM clinical_snapshot s WHERE s.round_id=r.id)
 AND NOT EXISTS(SELECT 1 FROM p2_revocation v WHERE v.case_id=c.id)
 AND p2_consent_latest_decision(r.id) IS DISTINCT FROM 'Declined'
 AND NOT EXISTS(SELECT 1 FROM his_intake_issue i WHERE i.case_id=c.id AND i.state IN ('Open','Proposed')))
$$;
ALTER TABLE result_qc5_review ADD COLUMN bench_review_id uuid REFERENCES lab_bench_review;
ALTER TABLE result_qc5_review ALTER COLUMN pool_id DROP NOT NULL;
ALTER TABLE result_qc5_review ALTER COLUMN dnb_id DROP NOT NULL;
ALTER TABLE result_qc5_review ALTER COLUMN sequencing_id DROP NOT NULL;
ALTER TABLE result_qc5_review ADD CONSTRAINT result_qc5_evidence_class CHECK(
 (bench_review_id IS NULL AND pool_id IS NOT NULL AND dnb_id IS NOT NULL AND sequencing_id IS NOT NULL) OR
 (bench_review_id IS NOT NULL AND pool_id IS NULL AND dnb_id IS NULL AND sequencing_id IS NULL));
CREATE FUNCTION lab_bench_qc5_valid(q result_qc5_review) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT nipt_operational_enabled() AND q.bench_review_id IS NOT NULL AND lab_bench_review_current(q.bench_review_id)
 AND EXISTS(SELECT 1 FROM result_report_version v JOIN result_review w ON w.id=q.review_id AND w.version_id=v.id JOIN analytical_attempt a ON a.id=v.attempt_id JOIN nipt_case c ON c.id=v.case_id JOIN lab_slot_assignment x ON x.attempt_id=a.id AND x.removed_at IS NULL JOIN lab_bench_review b ON b.id=q.bench_review_id AND b.batch_id=x.batch_id
 WHERE v.id=q.version_id AND v.attempt_id=q.attempt_id AND v.kind='RESULT' AND NOT v.synthetic AND v.sha256=q.report_sha256 AND v.state IN ('Linked','ValidationBlocked','PendingCertification','CertifiedReleased') AND w.values_match_pdf AND c.current_round_id=v.round_id AND a.round_id=v.round_id AND b.reviewer_id=q.reviewer_id)
 AND EXISTS(SELECT 1 FROM role_assignment a WHERE a.user_id=q.reviewer_id AND a.role='LAB_CERTIFIER' AND a.approved_by IS NOT NULL AND a.effective_from<=now() AND (a.expires_at IS NULL OR a.expires_at>now()))
$$;
-- Prepend only the explicit new evidence branch. The full legacy guards remain.
DO $$ DECLARE d text; BEGIN
 SELECT pg_get_functiondef('p5_qc5_guard()'::regprocedure) INTO d;
 IF position('BEGIN' in d)=0 THEN RAISE EXCEPTION 'OWNER_QC5_GUARD_SHAPE_MISMATCH'; END IF;
 d:=replace(d,'BEGIN',$body$BEGIN
 IF NEW.bench_review_id IS NOT NULL THEN
  IF NOT lab_bench_qc5_valid(NEW) THEN RAISE EXCEPTION 'QC5_CURRENT_OWNER_WORKSHEET_REQUIRED'; END IF;
  RETURN NEW;
 END IF;
 $body$);EXECUTE d;
 SELECT pg_get_functiondef('p7_closed_clinical_state_guard()'::regprocedure) INTO d;
 d:=replace(d,'BEGIN',$body$BEGIN
 IF TG_OP='UPDATE' AND NEW.state IN ('AnalysisComplete','FinalQcAccepted','Final') AND NEW.state IS DISTINCT FROM OLD.state AND EXISTS(SELECT 1 FROM result_qc5_review q WHERE q.attempt_id=NEW.id AND q.bench_review_id IS NOT NULL AND lab_bench_qc5_valid(q)) THEN RETURN NEW; END IF;
 $body$);EXECUTE d;
 SELECT pg_get_functiondef('p5_operational_release_guard()'::regprocedure) INTO d;
 d:=replace(d,'BEGIN',$body$BEGIN
 IF TG_OP='INSERT' AND EXISTS(SELECT 1 FROM result_qc5_review WHERE version_id=NEW.version_id AND bench_review_id IS NOT NULL) THEN
  IF NEW.synthetic OR NOT nipt_operational_enabled()
  OR NOT EXISTS(SELECT 1 FROM result_report_version v JOIN result_qc5_review q ON q.version_id=v.id JOIN analytical_attempt a ON a.id=v.attempt_id WHERE v.id=NEW.version_id AND v.state='CertifiedReleased' AND NOT v.synthetic AND v.case_id=NEW.case_id AND v.round_id=NEW.round_id AND a.state='FinalQcAccepted' AND lab_bench_qc5_valid(q))
  OR NOT EXISTS(SELECT 1 FROM result_gate_evaluation g WHERE g.version_id=NEW.version_id AND g.eligible AND g.outcome='CERTIFIED_RELEASED' AND g.actor_id=NEW.certified_by)
  OR NOT EXISTS(SELECT 1 FROM role_assignment a WHERE a.user_id=NEW.certified_by AND a.role='LAB_CERTIFIER' AND a.approved_by IS NOT NULL AND a.effective_from<=now() AND (a.expires_at IS NULL OR a.expires_at>now()))
  OR NOT (p2_clinical_ready(NEW.round_id) OR lab_owner_paper_ready(NEW.round_id))
  OR EXISTS(SELECT 1 FROM p2_revocation WHERE case_id=NEW.case_id)
  THEN RAISE EXCEPTION 'RELEASE_CURRENT_QC5_AUTHORITY_REQUIRED'; END IF;
  RETURN NEW;
 END IF;
 $body$);EXECUTE d;
END $$;
-- Preserve the existing outbound authority/epoch/role/consent guards; select
-- the exact new worksheet evidence class instead of inventing a legacy DNB.
DO $$ DECLARE d text; old_clause text := 'AND p2_clinical_ready(r.round_id) AND p4c_pool_current(q.dnb_id) AND p4c_handoff_verified(q.dnb_id)'; BEGIN
 SELECT pg_get_functiondef('p6_release_eligible(uuid,integer)'::regprocedure) INTO d;
 IF position(old_clause in d)=0 THEN RAISE EXCEPTION 'OWNER_P6_RELEASE_GUARD_SHAPE_MISMATCH'; END IF;
 d:=replace(d,old_clause,'AND (p2_clinical_ready(r.round_id) OR lab_owner_paper_ready(r.round_id)) AND ((q.bench_review_id IS NOT NULL AND lab_bench_qc5_valid(q)) OR (q.bench_review_id IS NULL AND p4c_pool_current(q.dnb_id) AND p4c_handoff_verified(q.dnb_id)))');
 EXECUTE d;
END $$;
-- Serialize a worksheet revision against the existing final publication lock.
-- An already published historical release is retained; a changed source cannot
-- be published afterwards under its earlier review.
CREATE FUNCTION lab_bench_revision_release_lock() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$ BEGIN
 PERFORM r.id FROM result_release r JOIN result_report_version v ON v.id=r.version_id JOIN result_qc5_review q ON q.version_id=v.id JOIN lab_slot_assignment a ON a.attempt_id=v.attempt_id WHERE a.batch_id=NEW.batch_id AND a.removed_at IS NULL AND q.bench_review_id IS NOT NULL AND r.state='Active' ORDER BY r.id FOR UPDATE OF r;
 RETURN NEW;
END $$;
CREATE TRIGGER lab_bench_revision_release_lock BEFORE INSERT ON task_workbook_revision FOR EACH ROW EXECUTE FUNCTION lab_bench_revision_release_lock();
REVOKE ALL ON lab_bench_review FROM PUBLIC;
