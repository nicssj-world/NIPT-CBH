-- Owner decision 2026-11-01 (single APP_ADMIN): Production starts with ONE application account, APP_ADMIN, which holds full
-- application authority. The database guards below decided the authority of the ACTING user (reviewer_id, certified_by,
-- created_by, reviewerId) from LAB_CERTIFIER / CLINICAL_APPROVER only; they now also accept a current APP_ADMIN assignment.
--
-- Unchanged on purpose:
--  * every evidence, state, hash, currency and operational-mode condition of each guard;
--  * the separation rules between two people (e.g. worksheet author <> peer reviewer, maker <> checker);
--  * who may be NAMED on a report: Reported By / Approved By eligibility (LAB_STAFF / LAB_CERTIFIER with a verified signer
--    profile, and the named person's own delegation to the operator) lives in packages/readygen/signers.ts and is not widened.
-- Forward-only. Generated from the installed definitions (pg_get_functiondef); only the role predicates differ
-- (9/1/1 replacements).

CREATE OR REPLACE FUNCTION public.lab_bench_qc5_valid(q result_qc5_review)
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
 SELECT nipt_operational_enabled() AND q.bench_review_id IS NOT NULL AND lab_bench_review_current(q.bench_review_id) AND lab_bench_attempt_actually_pooled(q.attempt_id,(SELECT actual_pooling_id FROM lab_bench_review WHERE id=q.bench_review_id))
 AND EXISTS(SELECT 1 FROM result_report_version v JOIN result_review w ON w.id=q.review_id AND w.version_id=v.id JOIN analytical_attempt a ON a.id=v.attempt_id JOIN nipt_case c ON c.id=v.case_id JOIN lab_slot_assignment x ON x.attempt_id=a.id AND x.removed_at IS NULL JOIN lab_bench_review b ON b.id=q.bench_review_id AND b.batch_id=x.batch_id
 WHERE v.id=q.version_id AND v.attempt_id=q.attempt_id AND v.kind='RESULT' AND NOT v.synthetic AND v.sha256=q.report_sha256 AND v.state IN ('Linked','ValidationBlocked','PendingCertification','CertifiedReleased') AND w.values_match_pdf AND c.current_round_id=v.round_id AND a.round_id=v.round_id AND b.reviewer_id=q.reviewer_id)
 AND EXISTS(SELECT 1 FROM role_assignment a WHERE a.user_id=q.reviewer_id AND (a.role='APP_ADMIN' OR (a.role='LAB_CERTIFIER' AND a.approved_by IS NOT NULL)) AND a.effective_from<=now() AND (a.expires_at IS NULL OR a.expires_at>now()))
$function$
;

CREATE OR REPLACE FUNCTION public.lab_bench_review_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
 PERFORM id FROM lab_batch WHERE id=NEW.batch_id FOR UPDATE NOWAIT;
 IF NOT nipt_operational_enabled() OR NOT lab_bench_measurements_ready(NEW.batch_id)
 OR NOT EXISTS(SELECT 1 FROM task_workbook_revision r WHERE r.id=NEW.workbook_revision_id AND r.batch_id=NEW.batch_id AND r.id=(SELECT id FROM task_workbook_revision WHERE batch_id=NEW.batch_id ORDER BY revision DESC LIMIT 1) AND r.created_by<>NEW.reviewer_id AND NEW.source_sha256=lab_bench_revision_sha(r.id))
 OR NOT EXISTS(SELECT 1 FROM role_assignment a WHERE a.user_id=NEW.reviewer_id AND (a.role='APP_ADMIN' OR (a.role='LAB_CERTIFIER' AND a.approved_by IS NOT NULL)) AND a.effective_from<=now() AND (a.expires_at IS NULL OR a.expires_at>now()))
 THEN RAISE EXCEPTION 'OWNER_WORKSHEET_MEASUREMENTS_AND_PEER_REVIEW_REQUIRED'; END IF;
 RETURN NEW;
END $function$
;

CREATE OR REPLACE FUNCTION public.lab_manual_result_review_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM role_assignment WHERE user_id=NEW.reviewer_id AND role IN ('LAB_STAFF','LAB_CERTIFIER','APP_ADMIN') AND effective_from<=now() AND (expires_at IS NULL OR expires_at>now()))
 OR NOT EXISTS(SELECT 1 FROM historical_draft d JOIN historical_batch_file f ON f.id=d.pdf_file_id
 WHERE d.id=NEW.draft_id AND d.version=NEW.draft_version AND d.pdf_file_id=NEW.pdf_file_id
 AND f.sha256=NEW.pdf_sha256 AND f.state='Parsed' AND d.state NOT IN ('Abandoned','Promoted'))
 THEN RAISE EXCEPTION 'MANUAL_REVIEW_AUTHORITY_OR_SOURCE_INVALID'; END IF;
 RETURN NEW;
END $function$
;

CREATE OR REPLACE FUNCTION public.p2_clinical_positive_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$ BEGIN
 IF NEW.result->>'passed'='true' OR NEW.result->>'state'='ClinicalPassed' THEN
  IF NOT nipt_operational_enabled() OR NOT p2_clinical_documents_ready(NEW.round_id) OR NEW.rule_version<>'CBH-AUTHORIZED-REVIEW-v1' OR NEW.result->>'authority'<>'AUTHORIZED_CLINICAL_REVIEW'
   OR NEW.result->>'sourceHash' IS DISTINCT FROM p2_clinical_source_hash(NEW.round_id)
   OR NEW.input_snapshot IS DISTINCT FROM p2_clinical_source(NEW.round_id)
   OR NOT EXISTS(SELECT 1 FROM role_assignment a JOIN app_user u ON u.id=a.user_id WHERE a.user_id::text=NEW.result->>'reviewerId' AND a.role IN ('CLINICAL_APPROVER','APP_ADMIN') AND u.enabled AND a.effective_from<=now() AND (a.expires_at IS NULL OR a.expires_at>now()))
  THEN RAISE EXCEPTION 'AUTHORIZED_CURRENT_CLINICAL_REVIEW_REQUIRED'; END IF;
 END IF; RETURN NEW;
END $function$
;

CREATE OR REPLACE FUNCTION public.p4b_operational_snapshot_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$ DECLARE p p4b_pool_attempt; BEGIN
 IF NEW.payload->>'acceptance'<>'Accepted' THEN RETURN NEW; END IF;
 SELECT * INTO p FROM p4b_pool_attempt WHERE id=NEW.pool_id;
 PERFORM id FROM lab_batch WHERE id=p.batch_id FOR UPDATE;
 IF p.payload->>'synthetic'<>'false' OR NOT nipt_operational_enabled()
 OR EXISTS(SELECT 1 FROM p4b_pool_event WHERE pool_id=p.id AND event_type IN ('HOLD','STOP_USE','SUPERSEDED','ACCEPTED'))
 OR NOT EXISTS(SELECT 1 FROM p4b_pool_event WHERE pool_id=p.id AND event_type='END')
 OR NOT EXISTS(SELECT 1 FROM p4b_pool_event WHERE pool_id=p.id AND event_type='CROSSCHECK_PASS')
 OR NOT EXISTS(SELECT 1 FROM p4b_qc2_decision q WHERE pool_id=p.id AND decision='Accepted' AND q.id::text=NEW.payload->'decision'->>'id')
 OR NEW.payload->'members' IS DISTINCT FROM p.payload->'members' OR NEW.payload->'placements' IS DISTINCT FROM p.payload->'placements'
 OR NEW.payload->>'calculationSha256' IS DISTINCT FROM p.sha256
 OR NOT EXISTS(SELECT 1 FROM role_assignment a WHERE a.user_id=NEW.created_by AND (a.role='APP_ADMIN' OR (a.role='LAB_CERTIFIER' AND a.approved_by IS NOT NULL)) AND a.effective_from<=now() AND (a.expires_at IS NULL OR a.expires_at>now()))
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(p.payload->'members') m WHERE NOT EXISTS(SELECT 1 FROM p4b_pool_observation o JOIN p4b_pool_review r ON r.observation_id=o.id WHERE o.pool_id=p.id AND o.field='TRANSFER' AND o.slot=(m->>'slot')::int AND r.result='Confirmed' AND o.event_time IS NOT NULL AND NOT EXISTS(SELECT 1 FROM p4b_pool_observation x WHERE x.supersedes_id=o.id)))
 OR 4<>(SELECT count(DISTINCT o.field) FROM p4b_pool_observation o JOIN p4b_pool_review r ON r.observation_id=o.id WHERE o.pool_id=p.id AND o.field IN ('BUFFER','QC2','STD1','STD2') AND r.result='Confirmed' AND o.event_time IS NOT NULL AND NOT EXISTS(SELECT 1 FROM p4b_pool_observation x WHERE x.supersedes_id=o.id))
 THEN RAISE EXCEPTION 'POOL_ACCEPTANCE_EVIDENCE_REQUIRED'; END IF;
 RETURN NEW;
END $function$
;

CREATE OR REPLACE FUNCTION public.p5_operational_release_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$ BEGIN
 IF TG_OP='INSERT' AND EXISTS(SELECT 1 FROM result_report_version v WHERE v.id=NEW.version_id AND v.origin='INTERNAL_GENERATED') AND NOT task3_internal_version_current(NEW.version_id) THEN
  RAISE EXCEPTION 'INTERNAL_REPORT_AUTHORITY_REQUIRED';
 END IF;
 
 IF TG_OP='INSERT' AND EXISTS(SELECT 1 FROM result_qc5_review WHERE version_id=NEW.version_id AND no_call_event_id IS NOT NULL) THEN
  IF NEW.synthetic OR NOT nipt_operational_enabled()
  OR NOT EXISTS(SELECT 1 FROM result_report_version v JOIN result_qc5_review q ON q.version_id=v.id WHERE v.id=NEW.version_id AND v.state='CertifiedReleased' AND NOT v.synthetic AND v.case_id=NEW.case_id AND v.round_id=NEW.round_id AND task1_no_call_qc5_valid(q))
  OR NOT EXISTS(SELECT 1 FROM result_gate_evaluation g WHERE g.version_id=NEW.version_id AND g.eligible AND g.outcome='CERTIFIED_RELEASED' AND g.actor_id=NEW.certified_by)
  OR NOT EXISTS(SELECT 1 FROM role_assignment a JOIN app_user u ON u.id=a.user_id WHERE a.user_id=NEW.certified_by AND u.enabled AND (a.role='APP_ADMIN' OR (a.role='LAB_CERTIFIER' AND a.approved_by IS NOT NULL)) AND a.effective_from<=now() AND (a.expires_at IS NULL OR a.expires_at>now()))
  OR NOT (p2_clinical_ready(NEW.round_id) OR lab_owner_paper_ready(NEW.round_id))
  OR EXISTS(SELECT 1 FROM p2_revocation WHERE case_id=NEW.case_id)
  THEN RAISE EXCEPTION 'RELEASE_CURRENT_NO_CALL_REVIEW_AUTHORITY_REQUIRED'; END IF;
  RETURN NEW;
 END IF;
 
 IF TG_OP='INSERT' AND EXISTS(SELECT 1 FROM result_qc5_review WHERE version_id=NEW.version_id AND bench_review_id IS NOT NULL) THEN
  IF NEW.synthetic OR NOT nipt_operational_enabled()
  OR NOT EXISTS(SELECT 1 FROM result_report_version v JOIN result_qc5_review q ON q.version_id=v.id JOIN analytical_attempt a ON a.id=v.attempt_id WHERE v.id=NEW.version_id AND v.state='CertifiedReleased' AND NOT v.synthetic AND v.case_id=NEW.case_id AND v.round_id=NEW.round_id AND a.state='FinalQcAccepted' AND lab_bench_qc5_valid(q))
  OR NOT EXISTS(SELECT 1 FROM result_gate_evaluation g WHERE g.version_id=NEW.version_id AND g.eligible AND g.outcome='CERTIFIED_RELEASED' AND g.actor_id=NEW.certified_by)
  OR NOT EXISTS(SELECT 1 FROM role_assignment a WHERE a.user_id=NEW.certified_by AND (a.role='APP_ADMIN' OR (a.role='LAB_CERTIFIER' AND a.approved_by IS NOT NULL)) AND a.effective_from<=now() AND (a.expires_at IS NULL OR a.expires_at>now()))
  OR NOT (p2_clinical_ready(NEW.round_id) OR lab_owner_paper_ready(NEW.round_id))
  OR EXISTS(SELECT 1 FROM p2_revocation WHERE case_id=NEW.case_id)
  THEN RAISE EXCEPTION 'RELEASE_CURRENT_QC5_AUTHORITY_REQUIRED'; END IF;
  RETURN NEW;
 END IF;
 
 IF NOT nipt_operational_enabled() THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' THEN RETURN NEW; END IF;
 IF NEW.synthetic OR NOT nipt_operational_enabled() OR NOT EXISTS(SELECT 1 FROM result_report_version v JOIN result_qc5_review q ON q.version_id=v.id JOIN analytical_attempt a ON a.id=v.attempt_id JOIN nipt_case c ON c.id=v.case_id WHERE v.id=NEW.version_id AND v.state='CertifiedReleased' AND NOT v.synthetic AND v.round_id=NEW.round_id AND v.case_id=NEW.case_id AND c.current_round_id=v.round_id AND a.state='FinalQcAccepted' AND q.report_sha256=v.sha256 AND p4c_pool_current(q.dnb_id) AND p4c_handoff_verified(q.dnb_id) AND q.sequencing_id=(SELECT id FROM p4c_sequencing_attempt WHERE dnb_id=q.dnb_id ORDER BY attempt_number DESC LIMIT 1))
 OR NOT EXISTS(SELECT 1 FROM result_gate_evaluation g WHERE g.version_id=NEW.version_id AND g.eligible AND g.outcome='CERTIFIED_RELEASED' AND g.actor_id=NEW.certified_by)
 OR NOT EXISTS(SELECT 1 FROM role_assignment a WHERE a.user_id=NEW.certified_by AND (a.role='APP_ADMIN' OR (a.role='LAB_CERTIFIER' AND a.approved_by IS NOT NULL)) AND a.effective_from<=now() AND (a.expires_at IS NULL OR a.expires_at>now()))
 OR NOT p2_clinical_ready(NEW.round_id) OR EXISTS(SELECT 1 FROM p2_revocation WHERE case_id=NEW.case_id)
 THEN RAISE EXCEPTION 'RELEASE_CURRENT_QC5_AUTHORITY_REQUIRED'; END IF;
 RETURN NEW;
END $function$
;

CREATE OR REPLACE FUNCTION public.p5_qc5_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$ BEGIN
 IF NEW.no_call_event_id IS NOT NULL THEN
  IF task1_no_call_qc5_valid(NEW) IS DISTINCT FROM true THEN RAISE EXCEPTION 'NO_CALL_CURRENT_FAILED_ATTEMPT_AND_REVIEW_REQUIRED'; END IF;
  RETURN NEW;
 END IF;
 IF EXISTS(SELECT 1 FROM result_report_version v WHERE v.id=NEW.version_id AND v.parsed->'results'->'result'->>'value'='No Call') THEN RAISE EXCEPTION 'NO_CALL_CURRENT_FAILED_ATTEMPT_AND_REVIEW_REQUIRED'; END IF;
 
 IF NEW.bench_review_id IS NOT NULL THEN
  IF NOT lab_bench_qc5_valid(NEW) THEN RAISE EXCEPTION 'QC5_CURRENT_OWNER_WORKSHEET_REQUIRED'; END IF;
  RETURN NEW;
 END IF;
 
 IF NOT nipt_operational_enabled() OR NOT EXISTS(SELECT 1 FROM role_assignment a WHERE a.user_id=NEW.reviewer_id AND (a.role='APP_ADMIN' OR (a.role='LAB_CERTIFIER' AND a.approved_by IS NOT NULL)) AND a.effective_from<=now() AND (a.expires_at IS NULL OR a.expires_at>now()))
 OR NOT EXISTS(SELECT 1 FROM result_report_version v JOIN result_review r ON r.version_id=v.id JOIN analytical_attempt a ON a.id=v.attempt_id JOIN nipt_case c ON c.id=v.case_id JOIN p4c_dnb_attempt d ON d.id=NEW.dnb_id JOIN p4b_pool_snapshot p ON p.id=d.pool_snapshot_id JOIN p4c_sequencing_attempt s ON s.dnb_id=d.id WHERE v.id=NEW.version_id AND v.attempt_id=NEW.attempt_id AND v.sha256=NEW.report_sha256 AND NOT v.synthetic AND v.state IN ('Linked','ValidationBlocked','PendingCertification') AND r.id=NEW.review_id AND r.values_match_pdf AND p.pool_id=NEW.pool_id AND d.purpose='OPERATIONAL' AND p.payload->>'acceptance'='Accepted' AND s.id=NEW.sequencing_id AND c.current_round_id=v.round_id AND s.id=(SELECT id FROM p4c_sequencing_attempt WHERE dnb_id=d.id ORDER BY attempt_number DESC LIMIT 1) AND p4c_pool_current(d.id) AND p4c_handoff_verified(d.id))
 OR NOT EXISTS(SELECT 1 FROM p4c_dnb_event WHERE dnb_id=NEW.dnb_id AND event_type='ANALYSIS_COMPLETE' AND payload->>'sequencingId'=NEW.sequencing_id::text)
 THEN RAISE EXCEPTION 'QC5_ACCEPTED_CURRENT_EVIDENCE_REQUIRED'; END IF;
 RETURN NEW;
END $function$
;

CREATE OR REPLACE FUNCTION public.p6_release_eligible(rid uuid, expected_epoch integer)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
 SELECT EXISTS(SELECT 1 FROM result_release r JOIN result_report_version v ON v.id=r.version_id JOIN nipt_case c ON c.id=r.case_id
  JOIN result_qc5_review q ON q.version_id=v.id JOIN app_user u ON u.id=r.certified_by
  WHERE r.id=rid AND r.epoch=expected_epoch AND r.state='Active' AND r.kind='RESULT' AND NOT r.synthetic AND v.state='CertifiedReleased'
   AND c.registration_origin<>'HISTORICAL' AND c.current_round_id=r.round_id AND nipt_operational_enabled() AND u.enabled
   AND (p2_clinical_ready(r.round_id) OR lab_owner_paper_ready(r.round_id)) AND (task1_no_call_qc5_valid(q) OR (q.no_call_event_id IS NULL AND ((q.bench_review_id IS NOT NULL AND lab_bench_qc5_valid(q)) OR (q.bench_review_id IS NULL AND p4c_pool_current(q.dnb_id) AND p4c_handoff_verified(q.dnb_id)))))
   AND EXISTS(SELECT 1 FROM role_assignment a WHERE a.user_id=u.id AND (a.role='APP_ADMIN' OR (a.role='LAB_CERTIFIER' AND a.approved_by IS NOT NULL)) AND a.effective_from<=now() AND (a.expires_at IS NULL OR a.expires_at>now()))
   AND NOT EXISTS(SELECT 1 FROM p2_revocation WHERE case_id=r.case_id))
$function$
;

CREATE OR REPLACE FUNCTION public.task1_no_call_qc5_valid(q result_qc5_review)
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
 SELECT nipt_operational_enabled() AND q.no_call_event_id IS NOT NULL AND q.no_call_event_id=task1_no_call_source(q.attempt_id)
 AND q.bench_review_id IS NULL AND q.pool_id IS NULL AND q.dnb_id IS NULL AND q.sequencing_id IS NULL
 AND EXISTS(SELECT 1 FROM result_report_version v JOIN result_review w ON w.id=q.review_id AND w.version_id=v.id
 WHERE v.id=q.version_id AND v.attempt_id=q.attempt_id AND v.kind='RESULT' AND NOT v.synthetic
 AND v.template_kind IN ('SINGLETON','TWIN') AND v.parsed->'results'->'result'->>'value'='No Call'
 AND v.parsed->'results'->'result'->>'method'='ANCHORED' AND v.parsed->'results'->'qc'->>'value' IN ('PASS','FAIL')
 AND v.sha256=q.report_sha256 AND v.state IN ('Linked','ValidationBlocked','PendingCertification','CertifiedReleased')
 AND w.values_match_pdf AND w.reviewer_id=q.reviewer_id
 AND w.created_at>=(SELECT max(e.created_at) FROM result_link_event e WHERE e.version_id=v.id AND e.event IN ('APPROVED','AUTO_LINKED','FROZEN_EXPORT_LINKED'))
 AND q.source_sha256=encode(sha256(convert_to(q.no_call_event_id::text||':'||v.sha256,'UTF8')),'hex'))
 AND EXISTS(SELECT 1 FROM role_assignment a JOIN app_user u ON u.id=a.user_id WHERE a.user_id=q.reviewer_id AND u.enabled AND (a.role='APP_ADMIN' OR (a.role='LAB_CERTIFIER' AND a.approved_by IS NOT NULL)) AND a.effective_from<=now() AND (a.expires_at IS NULL OR a.expires_at>now()))
$function$
;
