-- v1.1.3 EQA: an organizer specimen has no patient request/consent, so the bench-review and No Call release branches accept an EQA case
-- in place of "clinical ready". Every other condition of those branches (certified version, gate evaluation by the same actor, certifier
-- role, QC5 review, revocation) is unchanged. The composed guard is patched from its CURRENT definition, never replaced wholesale, and the
-- migration fails if the definition no longer has exactly the two expected places.
DO $$ DECLARE d text; n integer; needle constant text:='NOT (p2_clinical_ready(NEW.round_id) OR lab_owner_paper_ready(NEW.round_id))'; BEGIN
 SELECT pg_get_functiondef('p5_operational_release_guard()'::regprocedure) INTO d;
 n:=(length(d)-length(replace(d,needle,'')))/length(needle);
 IF n<>2 THEN RAISE EXCEPTION 'EQA_P5_GUARD_SHAPE_MISMATCH'; END IF;
 d:=replace(d,needle,'NOT (p2_clinical_ready(NEW.round_id) OR lab_owner_paper_ready(NEW.round_id) OR nipt_case_is_eqa(NEW.case_id))');
 EXECUTE d;
END $$;
