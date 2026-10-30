-- Preserve all previously composed owner/worksheet/No Call/internal-report
-- release guards (migrations 086, 117, 125 and 128). Add only the precisely
-- scoped EQA alternative, without reintroducing obsolete P4c-only checks.
DO $$ DECLARE definition text;
BEGIN
 SELECT pg_get_functiondef('p5_operational_release_guard()'::regprocedure) INTO definition;
 IF position('BEGIN' in definition)=0 THEN
  RAISE EXCEPTION 'EQA_RELEASE_GUARD_SHAPE_MISMATCH';
 END IF;
 definition:=replace(definition,'BEGIN',$guard$BEGIN
 IF TG_OP='INSERT' AND EXISTS(
  SELECT 1 FROM eqa_case e WHERE e.case_id=NEW.case_id
 ) THEN
  IF NEW.synthetic OR NOT nipt_operational_enabled()
   OR NOT nipt_round_pet_or_eqa_ok(NEW.round_id)
   OR NOT EXISTS(
    SELECT 1 FROM result_report_version v
    JOIN result_qc5_review q ON q.version_id=v.id
    JOIN analytical_attempt a ON a.id=v.attempt_id
    JOIN nipt_case c ON c.id=v.case_id
    WHERE v.id=NEW.version_id AND v.case_id=NEW.case_id
     AND v.round_id=NEW.round_id AND v.state='CertifiedReleased'
     AND NOT v.synthetic AND c.current_round_id=v.round_id
     AND (
       (q.bench_review_id IS NOT NULL AND a.state='FinalQcAccepted' AND lab_bench_qc5_valid(q))
       OR (q.no_call_event_id IS NOT NULL AND task1_no_call_qc5_valid(q))
       OR (q.bench_review_id IS NULL AND q.no_call_event_id IS NULL
         AND a.state='FinalQcAccepted' AND q.report_sha256=v.sha256
         AND p4c_pool_current(q.dnb_id) AND p4c_handoff_verified(q.dnb_id)
         AND q.sequencing_id=(SELECT id FROM p4c_sequencing_attempt
          WHERE dnb_id=q.dnb_id ORDER BY attempt_number DESC LIMIT 1))
     )
     AND (v.origin<>'INTERNAL_GENERATED' OR task3_internal_version_current(v.id))
   )
   OR NOT EXISTS(
     SELECT 1 FROM result_gate_evaluation g WHERE g.version_id=NEW.version_id
      AND g.eligible AND g.outcome='CERTIFIED_RELEASED' AND g.actor_id=NEW.certified_by
   )
   OR NOT EXISTS(
     SELECT 1 FROM app_user u JOIN role_assignment a ON a.user_id=u.id
     WHERE u.id=NEW.certified_by AND u.enabled
      AND a.role='LAB_CERTIFIER' AND a.approved_by IS NOT NULL
      AND a.effective_from<=now() AND (a.expires_at IS NULL OR a.expires_at>now())
   )
   OR EXISTS(SELECT 1 FROM p2_revocation v WHERE v.case_id=NEW.case_id)
  THEN RAISE EXCEPTION 'EQA_CURRENT_QC5_AUTHORITY_REQUIRED'; END IF;
  RETURN NEW;
 END IF;
 $guard$);
 EXECUTE definition;
END $$;
