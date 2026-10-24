-- Task 3: native No Call report (Owner Task 1 decision 2: the same normal master with an explicit "Result = No Call").
-- A No Call internal report carries no interpretation of findings: its record is status NO_CALL. It is current only while the
-- No Call rendering approval it was made under is recorded and the attempt is still the live Task 1 No Call source.
-- Every existing release guard (including the Task 1 No Call QC5 authority) still runs.
DO $$ BEGIN
 IF position($q$(r.interpretation->>'status')='FINAL_ELIGIBLE'$q$ in pg_get_functiondef('task3_internal_version_current(uuid)'::regprocedure))=0 THEN RAISE EXCEPTION 'TASK3_INTERNAL_CURRENT_SHAPE_MISMATCH'; END IF;
END $$;
CREATE OR REPLACE FUNCTION task3_internal_version_current(target uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM result_report_version v JOIN internal_report r ON r.version_id=v.id
  WHERE v.id=target AND v.origin='INTERNAL_GENERATED' AND r.state='Final' AND r.pdf_sha256=v.sha256 AND r.attempt_id=v.attempt_id
  AND (r.ruleset->>'approved')='true' AND (r.ruleset->>'combinationApproved')='true'
  AND ((r.interpretation->>'status')='FINAL_ELIGIBLE'
   OR ((r.interpretation->>'status')='NO_CALL' AND (r.ruleset->>'noCallRenderingApproved')='true' AND task1_no_call_source(r.attempt_id) IS NOT NULL
    AND v.parsed->'results'->'result'->>'value'='No Call' AND v.parsed->'results'->'result'->>'method'='ANCHORED')))
$$;
