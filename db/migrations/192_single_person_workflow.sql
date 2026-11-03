-- Owner 2026-11-03: nobody needs a second name. Whoever proposed, recorded or imported something may also review, verify and approve it; the role matrix still decides who may do what.
-- Only the "must be a different person" condition is cut out of each guard; every other condition (a Confirmed review must exist, the observation must be current, the verifier role, ...) stays.
-- Each function is rewritten from its installed definition. A pattern that is not found stops the migration: nothing is changed half-way.
DO $single$
DECLARE r record; def text; fixed text;
BEGIN
 FOR r IN SELECT * FROM (VALUES
  ('his_intake_event_guard','IF p\.actor_id=NEW\.actor_id THEN RAISE EXCEPTION ''SECOND_PERSON_REQUIRED''; END IF;'),
  ('p5_link_event_guard','IF p\.actor_id=NEW\.actor_id THEN RAISE EXCEPTION ''SECOND_PERSON_REQUIRED''; END IF;'),
  ('historical_verification_guard','IF NEW\.verifier_id = ANY\(d\.contributor_ids\) THEN RAISE EXCEPTION ''HISTORICAL_SELF_VERIFICATION''; END IF;'),
  ('p2_doctor_approval_guard','IF NEW\.event_type=''Approved'' AND EXISTS\(SELECT 1 FROM p2_doctor_version WHERE id=NEW\.doctor_version_id AND created_by=NEW\.actor_id\)\s+AND NOT EXISTS\(SELECT 1 FROM p2_doctor_registration WHERE doctor_version_id=NEW\.doctor_version_id AND actor_id=NEW\.actor_id AND authorized\)\s+THEN RAISE EXCEPTION ''MAKER_CHECKER_REQUIRED''; END IF;'),
  ('p4_review_guard','IF EXISTS\(SELECT 1 FROM lab_observation WHERE id=NEW\.observation_id AND recorded_by=NEW\.reviewer_id\) THEN RAISE EXCEPTION ''SECOND_PERSON_REQUIRED''; END IF;'),
  ('p4b_review_guard','IF EXISTS\(SELECT 1 FROM p4b_pool_observation WHERE id=NEW\.observation_id AND recorded_by=NEW\.reviewer_id\) THEN RAISE EXCEPTION ''SECOND_PERSON_REQUIRED''; END IF;'),
  ('p4c_qc4_review_guard','IF NEW\.reviewer_id=o\.recorded_by THEN RAISE EXCEPTION ''SECOND_PERSON_REQUIRED''; END IF;'),
  ('p4c_review_guard','IF o\.recorded_by=NEW\.reviewer_id THEN RAISE EXCEPTION ''SECOND_PERSON_REQUIRED''; END IF;'),
  ('p4c_verification_guard','IF t\.actor_id=NEW\.reviewer_id THEN RAISE EXCEPTION ''SECOND_PERSON_REQUIRED''; END IF;'),
  ('lab_bench_review_guard',' AND r\.created_by<>NEW\.reviewer_id'),
  ('settings_activation_guard','OR r.approved_by=r.created_by '),
  ('p4b_qc2_guard',' AND o\.recorded_by<>NEW\.actor_id'),
  ('p4c_qc3_guard',' AND o\.recorded_by<>NEW\.actor_id')
 ) AS t(fn,pattern) LOOP
  SELECT pg_get_functiondef(p.oid) INTO def FROM pg_proc p WHERE p.proname=r.fn AND p.pronamespace='public'::regnamespace;
  IF def IS NULL THEN RAISE EXCEPTION 'SINGLE_PERSON_FUNCTION_NOT_FOUND: %',r.fn; END IF;
  fixed:=regexp_replace(def,r.pattern,'','g');
  IF fixed=def THEN RAISE EXCEPTION 'SINGLE_PERSON_PATTERN_NOT_FOUND: %',r.fn; END IF;
  EXECUTE fixed;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace AND prosrc ~ 'RAISE EXCEPTION ''(SECOND_PERSON_REQUIRED|HISTORICAL_SELF_VERIFICATION|MAKER_CHECKER_REQUIRED)''') THEN RAISE EXCEPTION 'SINGLE_PERSON_GUARD_REMAINS'; END IF;
END $single$;

-- The same rule written as table CHECK constraints. Each is looked up by name and must exist (a missing one stops the migration).
-- Left as they are on purpose: who may be given admin access (admin_access_request) and the LAB_CERTIFIER role grant (role_assignment) are access control, not workflow steps.
DO $constraints$
DECLARE r record;
BEGIN
 FOR r IN SELECT * FROM (VALUES ('lab_slot_disposition','lab_slot_disposition_check1'),('settings_revision','settings_revision_check'),('report_template_revision','report_template_revision_check1')) AS t(tbl,con) LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid=('public.'||r.tbl)::regclass AND conname=r.con AND contype='c') THEN RAISE EXCEPTION 'SINGLE_PERSON_CONSTRAINT_NOT_FOUND: %.%',r.tbl,r.con; END IF;
  EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I',r.tbl,r.con);
 END LOOP;
END $constraints$;
-- A template revision still must say who approved it and when; it just may be the person who made it.
ALTER TABLE report_template_revision ADD CONSTRAINT report_template_revision_approved_evidence
 CHECK(state NOT IN ('Approved','Active') OR (approved_by IS NOT NULL AND approved_at IS NOT NULL));
