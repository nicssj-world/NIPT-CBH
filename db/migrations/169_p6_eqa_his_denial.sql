-- v1.1.3: Do NOT replace the composed v1.1.2 P6 eligibility function
-- with migration-089's obsolete DNB-only body. Migrations 117 and 125 add
-- worksheet and No Call pathways that must remain eligible for real patients.
-- Add one fail-closed EQA prohibition to the FINAL composed function.
DO $v113$
DECLARE definition text;
        anchor text := 'AND NOT EXISTS(SELECT 1 FROM p2_revocation WHERE case_id=r.case_id)';
BEGIN
 SELECT pg_get_functiondef('p6_release_eligible(uuid,integer)'::regprocedure)
 INTO definition;
 IF position(anchor in definition)=0
    OR position('NOT EXISTS(SELECT 1 FROM eqa_case WHERE case_id=r.case_id)' in definition)>0
 THEN RAISE EXCEPTION 'P6_EQA_GUARD_COMPOSITION_MISMATCH'; END IF;
 definition:=replace(definition,anchor,
  anchor||' AND NOT EXISTS(SELECT 1 FROM eqa_case WHERE case_id=r.case_id)');
 EXECUTE definition;
END $v113$;
REVOKE ALL ON FUNCTION p6_release_eligible(uuid,integer) FROM PUBLIC;
DO $roles$
BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='worker_rw') THEN
  GRANT EXECUTE ON FUNCTION p6_release_eligible(uuid,integer) TO worker_rw;
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='app_rw') THEN
  GRANT EXECUTE ON FUNCTION p6_release_eligible(uuid,integer) TO app_rw;
 END IF;
END $roles$;
