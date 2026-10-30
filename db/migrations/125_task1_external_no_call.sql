-- Owner 2026-10-24: same external RESULT PDF and existing review/certify/delivery.
-- No successful QC/analysis evidence or additional authority is created.
ALTER TABLE result_qc5_review ADD COLUMN no_call_event_id uuid REFERENCES attempt_event;
ALTER TABLE result_qc5_review DROP CONSTRAINT result_qc5_evidence_class;
ALTER TABLE result_qc5_review ADD CONSTRAINT result_qc5_evidence_class CHECK(
 (no_call_event_id IS NOT NULL AND bench_review_id IS NULL AND pool_id IS NULL AND dnb_id IS NULL AND sequencing_id IS NULL) OR
 (no_call_event_id IS NULL AND ((bench_review_id IS NULL AND pool_id IS NOT NULL AND dnb_id IS NOT NULL AND sequencing_id IS NOT NULL) OR
 (bench_review_id IS NOT NULL AND pool_id IS NULL AND dnb_id IS NULL AND sequencing_id IS NULL))));

CREATE FUNCTION task1_no_call_source(target uuid) RETURNS uuid LANGUAGE sql STABLE AS $$
 SELECT e.id FROM analytical_attempt a JOIN nipt_case c ON c.id=a.case_id
 JOIN specimen_round r ON r.id=a.round_id JOIN attempt_event e ON e.attempt_id=a.id AND e.event_type='NO_CALL_SELECTED'
 WHERE a.id=target AND a.state='QcFailed' AND a.qc_failed_stage IS NOT NULL AND a.overall_ordinal>=4
 AND c.current_round_id=a.round_id AND r.state IN ('ReceivedInHIS','ReceivedInNIPT')
 AND a.overall_ordinal=(SELECT max(x.overall_ordinal) FROM analytical_attempt x WHERE x.case_id=a.case_id)
 AND NOT COALESCE((SELECT h.event_type='HOLD_SET' FROM attempt_event h WHERE h.attempt_id=a.id AND h.event_type IN ('HOLD_SET','HOLD_RELEASED') ORDER BY h.sequence DESC LIMIT 1),false)
 AND NOT EXISTS(SELECT 1 FROM repeat_work_order o WHERE o.round_id=a.round_id AND o.state IN ('RepeatRequested','RepeatPendingBatch','RepeatInProgress'))
 AND NOT EXISTS(SELECT 1 FROM lab_slot_assignment s JOIN lab_batch b ON b.id=s.batch_id WHERE s.attempt_id=a.id AND (s.removed_reason='BATCH_CANCELLED' OR b.state='Cancelled'))
 ORDER BY e.sequence DESC LIMIT 1
$$;
CREATE FUNCTION task1_no_call_qc5_valid(q result_qc5_review) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT nipt_operational_enabled() AND q.no_call_event_id IS NOT NULL AND q.no_call_event_id=task1_no_call_source(q.attempt_id)
 AND q.bench_review_id IS NULL AND q.pool_id IS NULL AND q.dnb_id IS NULL AND q.sequencing_id IS NULL
 AND EXISTS(SELECT 1 FROM result_report_version v JOIN result_review w ON w.id=q.review_id AND w.version_id=v.id
 WHERE v.id=q.version_id AND v.attempt_id=q.attempt_id AND v.kind='RESULT' AND NOT v.synthetic
 AND v.template_kind IN ('SINGLETON','TWIN') AND v.parsed->'results'->'result'->>'value'='No Call'
 AND v.parsed->'results'->'result'->>'method'='ANCHORED' AND v.parsed->'results'->'qc'->>'value' IN ('PASS','FAIL')
 AND v.sha256=q.report_sha256 AND v.state IN ('Linked','ValidationBlocked','PendingCertification','CertifiedReleased')
 AND w.values_match_pdf AND w.reviewer_id=q.reviewer_id
 AND w.created_at>=(SELECT max(e.created_at) FROM result_link_event e WHERE e.version_id=v.id AND e.event IN ('APPROVED','AUTO_LINKED'))
 AND q.source_sha256=encode(sha256(convert_to(q.no_call_event_id::text||':'||v.sha256,'UTF8')),'hex'))
 AND EXISTS(SELECT 1 FROM role_assignment a JOIN app_user u ON u.id=a.user_id WHERE a.user_id=q.reviewer_id AND u.enabled AND a.role='LAB_CERTIFIER' AND a.approved_by IS NOT NULL AND a.effective_from<=now() AND (a.expires_at IS NULL OR a.expires_at>now()))
$$;
DO $$ DECLARE d text; old_clause text; BEGIN
 SELECT pg_get_functiondef('p5_qc5_guard()'::regprocedure) INTO d;
 d:=replace(d,'BEGIN',$body$BEGIN
 IF NEW.no_call_event_id IS NOT NULL THEN
  IF task1_no_call_qc5_valid(NEW) IS DISTINCT FROM true THEN RAISE EXCEPTION 'NO_CALL_CURRENT_FAILED_ATTEMPT_AND_REVIEW_REQUIRED'; END IF;
  RETURN NEW;
 END IF;
 IF EXISTS(SELECT 1 FROM result_report_version v WHERE v.id=NEW.version_id AND v.parsed->'results'->'result'->>'value'='No Call') THEN RAISE EXCEPTION 'NO_CALL_CURRENT_FAILED_ATTEMPT_AND_REVIEW_REQUIRED'; END IF;
 $body$);EXECUTE d;
 SELECT pg_get_functiondef('p5_operational_release_guard()'::regprocedure) INTO d;
 d:=replace(d,'BEGIN',$body$BEGIN
 IF TG_OP='INSERT' AND EXISTS(SELECT 1 FROM result_qc5_review WHERE version_id=NEW.version_id AND no_call_event_id IS NOT NULL) THEN
  IF NEW.synthetic OR NOT nipt_operational_enabled()
  OR NOT EXISTS(SELECT 1 FROM result_report_version v JOIN result_qc5_review q ON q.version_id=v.id WHERE v.id=NEW.version_id AND v.state='CertifiedReleased' AND NOT v.synthetic AND v.case_id=NEW.case_id AND v.round_id=NEW.round_id AND task1_no_call_qc5_valid(q))
  OR NOT EXISTS(SELECT 1 FROM result_gate_evaluation g WHERE g.version_id=NEW.version_id AND g.eligible AND g.outcome='CERTIFIED_RELEASED' AND g.actor_id=NEW.certified_by)
  OR NOT EXISTS(SELECT 1 FROM role_assignment a JOIN app_user u ON u.id=a.user_id WHERE a.user_id=NEW.certified_by AND u.enabled AND a.role='LAB_CERTIFIER' AND a.approved_by IS NOT NULL AND a.effective_from<=now() AND (a.expires_at IS NULL OR a.expires_at>now()))
  OR NOT (p2_clinical_ready(NEW.round_id) OR lab_owner_paper_ready(NEW.round_id))
  OR EXISTS(SELECT 1 FROM p2_revocation WHERE case_id=NEW.case_id)
  THEN RAISE EXCEPTION 'RELEASE_CURRENT_NO_CALL_REVIEW_AUTHORITY_REQUIRED'; END IF;
  RETURN NEW;
 END IF;
 $body$);EXECUTE d;
 -- Keep the existing publication epoch, active role, current round, consent and origin checks.
 SELECT pg_get_functiondef('p6_release_eligible(uuid,integer)'::regprocedure) INTO d;
 old_clause:='((q.bench_review_id IS NOT NULL AND lab_bench_qc5_valid(q)) OR (q.bench_review_id IS NULL AND p4c_pool_current(q.dnb_id) AND p4c_handoff_verified(q.dnb_id)))';
 IF position(old_clause in d)=0 THEN RAISE EXCEPTION 'TASK1_P6_GUARD_SHAPE_MISMATCH'; END IF;
 EXECUTE replace(d,old_clause,'(task1_no_call_qc5_valid(q) OR (q.no_call_event_id IS NULL AND '||old_clause||'))');
END $$;
REVOKE ALL ON FUNCTION task1_no_call_source(uuid),task1_no_call_qc5_valid(result_qc5_review) FROM PUBLIC;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='app_rw') THEN
 GRANT EXECUTE ON FUNCTION task1_no_call_source(uuid),task1_no_call_qc5_valid(result_qc5_review) TO app_rw;
END IF; END $$;
