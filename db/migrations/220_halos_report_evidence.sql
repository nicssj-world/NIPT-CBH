-- Owner 2026-11-11: confirmed HALOS is completed analysis and paper request/consent
-- evidence at reporting. Bind that source directly; do not manufacture worksheet QC.
ALTER TABLE result_qc5_review ADD COLUMN halos_row_id uuid REFERENCES halos_import_row;
ALTER TABLE result_qc5_review DROP CONSTRAINT result_qc5_evidence_class;
ALTER TABLE result_qc5_review ADD CONSTRAINT result_qc5_evidence_class CHECK(
 (halos_row_id IS NOT NULL AND no_call_event_id IS NULL AND bench_review_id IS NULL AND pool_id IS NULL AND dnb_id IS NULL AND sequencing_id IS NULL) OR
 (halos_row_id IS NULL AND (
  (no_call_event_id IS NOT NULL AND bench_review_id IS NULL AND pool_id IS NULL AND dnb_id IS NULL AND sequencing_id IS NULL) OR
  (no_call_event_id IS NULL AND ((bench_review_id IS NULL AND pool_id IS NOT NULL AND dnb_id IS NOT NULL AND sequencing_id IS NOT NULL) OR
   (bench_review_id IS NOT NULL AND pool_id IS NULL AND dnb_id IS NULL AND sequencing_id IS NULL))))));

CREATE FUNCTION task3_halos_row_current(target uuid) RETURNS boolean LANGUAGE sql STABLE
SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM halos_import_row h JOIN halos_import i ON i.id=h.import_id
 JOIN analytical_attempt a ON a.id=h.attempt_id JOIN nipt_case c ON c.id=h.case_id
 WHERE h.id=target AND h.sheet='result' AND h.classification='PATIENT' AND i.state='Confirmed'
 AND a.case_id=h.case_id AND a.round_id=h.round_id AND c.current_round_id=h.round_id
 AND a.printed_sample_id=h.sample_key
 AND a.attempt_number=(SELECT max(x.attempt_number) FROM analytical_attempt x WHERE x.round_id=a.round_id)
 AND a.state NOT IN ('Superseded','Stopped','BatchCancelled','Cancelled')
 AND (a.state<>'QcFailed' OR task1_no_call_source(a.id) IS NOT NULL)
 AND NOT EXISTS(SELECT 1 FROM halos_row_dismissal d WHERE d.row_id=h.id)
 AND NOT EXISTS(SELECT 1 FROM halos_import_row newer JOIN halos_import ni ON ni.id=newer.import_id
  WHERE newer.attempt_id=a.id AND newer.sheet='result' AND newer.classification='PATIENT' AND ni.state='Confirmed' AND ni.uploaded_at>i.uploaded_at)
 AND NOT EXISTS(SELECT 1 FROM p2_revocation r WHERE r.case_id=c.id)
 AND p2_consent_latest_decision(h.round_id) IS DISTINCT FROM 'Declined')
$$;

CREATE FUNCTION task3_halos_paper_ready(target uuid) RETURNS boolean LANGUAGE sql STABLE
SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT nipt_operational_enabled() AND EXISTS(SELECT 1 FROM halos_import_row h
 WHERE h.round_id=target AND task3_halos_row_current(h.id))
$$;

CREATE FUNCTION task3_halos_report_row(target uuid) RETURNS uuid LANGUAGE sql STABLE
SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT h.id FROM result_report_version v JOIN internal_report r ON r.version_id=v.id
 JOIN halos_import_row h ON h.id=r.halos_row_id
 WHERE v.id=target AND v.kind='RESULT' AND v.origin='INTERNAL_GENERATED' AND NOT v.synthetic
 AND nipt_operational_enabled() AND task3_internal_version_current(v.id)
 AND r.case_id=v.case_id AND r.round_id=v.round_id AND r.attempt_id=v.attempt_id
 AND h.case_id=v.case_id AND h.round_id=v.round_id AND h.attempt_id=v.attempt_id
 AND r.interpretation->>'status'='FINAL_ELIGIBLE' AND task3_halos_row_current(h.id)
$$;

CREATE FUNCTION task3_halos_qc5_valid(q result_qc5_review) RETURNS boolean LANGUAGE sql STABLE
SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT q.halos_row_id IS NOT NULL AND q.halos_row_id=task3_halos_report_row(q.version_id)
 AND q.no_call_event_id IS NULL AND q.bench_review_id IS NULL AND q.pool_id IS NULL AND q.dnb_id IS NULL AND q.sequencing_id IS NULL
 AND EXISTS(SELECT 1 FROM result_report_version v JOIN result_review w ON w.id=q.review_id AND w.version_id=v.id
 WHERE v.id=q.version_id AND v.attempt_id=q.attempt_id AND v.sha256=q.report_sha256 AND w.values_match_pdf
 AND v.state IN ('Linked','ValidationBlocked','PendingCertification','CertifiedReleased'))
 AND EXISTS(SELECT 1 FROM app_user u JOIN role_assignment a ON a.user_id=u.id WHERE u.id=q.reviewer_id AND u.enabled
 AND (a.role='APP_ADMIN' OR (a.role='LAB_CERTIFIER' AND a.approved_by IS NOT NULL))
 AND a.effective_from<=now() AND (a.expires_at IS NULL OR a.expires_at>now()))
$$;

-- A distinct review source uses the existing result review/certification ledger.
DO $$ DECLARE d text; BEGIN
 SELECT pg_get_functiondef('p5_qc5_guard()'::regprocedure) INTO d;
 IF position('QC5_ACCEPTED_CURRENT_EVIDENCE_REQUIRED' in d)=0 THEN RAISE EXCEPTION 'HALOS_QC5_GUARD_SHAPE_MISMATCH'; END IF;
 d:=replace(d,'BEGIN',$body$BEGIN
 IF NEW.halos_row_id IS NOT NULL THEN
  IF task3_halos_qc5_valid(NEW) IS DISTINCT FROM true THEN RAISE EXCEPTION 'HALOS_CURRENT_REPORT_REVIEW_REQUIRED'; END IF;
  RETURN NEW;
 END IF;
$body$); EXECUTE d;
END $$;

DO $$ DECLARE d text; BEGIN
 SELECT pg_get_functiondef('p7_closed_clinical_state_guard()'::regprocedure) INTO d;
 IF position('CLINICAL_QC_ADAPTER_PENDING' in d)=0 THEN RAISE EXCEPTION 'HALOS_ATTEMPT_GUARD_SHAPE_MISMATCH'; END IF;
 d:=replace(d,'BEGIN',$body$BEGIN
 IF TG_OP='UPDATE' AND NEW.state IN ('AnalysisComplete','FinalQcAccepted','Final') AND NEW.state IS DISTINCT FROM OLD.state
 AND EXISTS(SELECT 1 FROM result_qc5_review q WHERE q.attempt_id=NEW.id AND task3_halos_qc5_valid(q)) THEN RETURN NEW; END IF;
$body$); EXECUTE d;
END $$;

CREATE FUNCTION task3_halos_release_eligible(rid uuid,expected_epoch integer) RETURNS boolean LANGUAGE sql STABLE
SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM result_release r JOIN result_report_version v ON v.id=r.version_id
 JOIN nipt_case c ON c.id=r.case_id JOIN analytical_attempt a ON a.id=v.attempt_id
 JOIN result_qc5_review q ON q.version_id=v.id JOIN app_user u ON u.id=r.certified_by
 WHERE r.id=rid AND r.epoch=expected_epoch AND r.state='Active' AND r.kind='RESULT' AND NOT r.synthetic
 AND v.state='CertifiedReleased' AND v.case_id=r.case_id AND v.round_id=r.round_id
 AND c.current_round_id=r.round_id AND c.registration_origin<>'HISTORICAL' AND u.enabled
 AND a.state='FinalQcAccepted' AND task3_halos_qc5_valid(q)
 AND NOT EXISTS(SELECT 1 FROM eqa_case e WHERE e.case_id=c.id)
 AND NOT EXISTS(SELECT 1 FROM attempt_event e WHERE e.attempt_id=a.id AND e.event_type='HOLD_SET'
  AND e.sequence=(SELECT max(x.sequence) FROM attempt_event x WHERE x.attempt_id=a.id AND x.event_type IN ('HOLD_SET','HOLD_RELEASED')))
 AND EXISTS(SELECT 1 FROM role_assignment ra WHERE ra.user_id=u.id
  AND (ra.role='APP_ADMIN' OR (ra.role='LAB_CERTIFIER' AND ra.approved_by IS NOT NULL))
  AND ra.effective_from<=now() AND (ra.expires_at IS NULL OR ra.expires_at>now())))
$$;

DO $$ DECLARE d text; BEGIN
 SELECT pg_get_functiondef('p5_operational_release_guard()'::regprocedure) INTO d;
 IF position('RELEASE_CURRENT_QC5_AUTHORITY_REQUIRED' in d)=0 THEN RAISE EXCEPTION 'HALOS_RELEASE_GUARD_SHAPE_MISMATCH'; END IF;
 d:=replace(d,'BEGIN',$body$BEGIN
 IF TG_OP='INSERT' AND EXISTS(SELECT 1 FROM result_qc5_review WHERE version_id=NEW.version_id AND halos_row_id IS NOT NULL) THEN
  IF NEW.synthetic OR NOT nipt_operational_enabled()
  OR NOT EXISTS(SELECT 1 FROM result_report_version v JOIN result_qc5_review q ON q.version_id=v.id JOIN analytical_attempt a ON a.id=v.attempt_id
   WHERE v.id=NEW.version_id AND v.case_id=NEW.case_id AND v.round_id=NEW.round_id
   AND v.state='CertifiedReleased' AND NOT v.synthetic AND a.state='FinalQcAccepted' AND task3_halos_qc5_valid(q))
  OR NOT EXISTS(SELECT 1 FROM result_gate_evaluation g WHERE g.version_id=NEW.version_id AND g.eligible AND g.outcome='CERTIFIED_RELEASED' AND g.actor_id=NEW.certified_by)
  OR NOT EXISTS(SELECT 1 FROM role_assignment a JOIN app_user u ON u.id=a.user_id WHERE a.user_id=NEW.certified_by AND u.enabled
   AND (a.role='APP_ADMIN' OR (a.role='LAB_CERTIFIER' AND a.approved_by IS NOT NULL))
   AND a.effective_from<=now() AND (a.expires_at IS NULL OR a.expires_at>now()))
  THEN RAISE EXCEPTION 'HALOS_CURRENT_REPORT_RELEASE_REQUIRED'; END IF;
  RETURN NEW;
 END IF;
$body$); EXECUTE d;
END $$;

-- Preserve the existing eligibility path and the outer EQA prohibition.
CREATE OR REPLACE FUNCTION p6_release_eligible(rid uuid,expected_epoch integer) RETURNS boolean LANGUAGE sql STABLE
SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT NOT EXISTS(SELECT 1 FROM result_release r JOIN eqa_case e ON e.case_id=r.case_id WHERE r.id=rid)
 AND (task3_halos_release_eligible(rid,expected_epoch) OR eqa_unfiltered_release_eligible(rid,expected_epoch))
$$;

REVOKE ALL ON FUNCTION task3_halos_row_current(uuid),task3_halos_paper_ready(uuid),task3_halos_report_row(uuid),task3_halos_qc5_valid(result_qc5_review),task3_halos_release_eligible(uuid,integer) FROM PUBLIC;
DO $$ DECLARE role_name text; BEGIN
 FOREACH role_name IN ARRAY ARRAY['app_rw','worker_rw'] LOOP
  IF EXISTS(SELECT FROM pg_roles WHERE rolname=role_name) THEN
   EXECUTE format('GRANT EXECUTE ON FUNCTION task3_halos_row_current(uuid),task3_halos_paper_ready(uuid),task3_halos_report_row(uuid),task3_halos_qc5_valid(result_qc5_review) TO %I',role_name);
  END IF;
 END LOOP;
END $$;
