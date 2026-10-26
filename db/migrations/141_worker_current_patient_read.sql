-- The inbound worker records the ANC patient's current identity before/after a PET is applied (anc/current-patient.ts), which
-- needs the ANC workspace draft's name/DOB. Without access every ANC-origin PET failed in the worker with "permission denied for
-- table p2_workspace". The worker must still never read the draft itself (tests/db/p3-roles.test.ts), so this exposes ONLY the
-- two projected values through a SECURITY DEFINER function, as the Task 3 signer/attestation helpers do. Forward-only.
CREATE FUNCTION anc_workspace_patient(p_case uuid) RETURNS TABLE(name text,dob text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT NULLIF(btrim(w.draft#>>'{patient,syntheticName}'),'') AS name,w.draft#>>'{patient,dob}' AS dob
 FROM p2_workspace w JOIN specimen_round_current wr ON wr.id=w.round_id
 WHERE w.case_id=p_case AND NULLIF(btrim(w.draft#>>'{patient,syntheticName}'),'') IS NOT NULL
 ORDER BY wr.round_number DESC LIMIT 1
$$;
REVOKE ALL ON FUNCTION anc_workspace_patient(uuid) FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='app_rw') THEN EXECUTE 'GRANT EXECUTE ON FUNCTION anc_workspace_patient(uuid) TO app_rw'; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='worker_rw') THEN EXECUTE 'GRANT EXECUTE ON FUNCTION anc_workspace_patient(uuid) TO worker_rw'; END IF;
END $$;
