-- Current HIS PET identity replaces current editable identity only; signed revisions remain immutable.
CREATE OR REPLACE FUNCTION p2_reconcile_pet_patient(p_case_id uuid,p_round_id uuid,p_name text,p_dob date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE w p2_workspace; patient jsonb; before_patient jsonb; changed text[]:=ARRAY[]::text[];
BEGIN
 IF p_name IS NULL OR btrim(p_name)='' OR p_dob IS NULL THEN RAISE EXCEPTION 'PET_IDENTITY_FIELDS_REQUIRED'; END IF;
 PERFORM 1 FROM nipt_case c JOIN specimen_round r ON r.id=p_round_id AND r.case_id=c.id
 WHERE c.id=p_case_id AND c.current_round_id=p_round_id AND r.received_source='HIS_PET_RECEIPT';
 IF NOT FOUND THEN RAISE EXCEPTION 'PET_IDENTITY_ROUND_INVALID'; END IF;
 SELECT * INTO w FROM p2_workspace WHERE case_id=p_case_id AND round_id=p_round_id FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('filled',changed,'conflicts','[]'::jsonb,'pending','[]'::jsonb); END IF;
 before_patient:=COALESCE(w.draft->'patient','{}'::jsonb);patient:=before_patient;
 IF NULLIF(btrim(patient->>'syntheticName'),'') IS DISTINCT FROM btrim(p_name) THEN changed:=array_append(changed,'name'); END IF;
 IF NULLIF(patient->>'dob','') IS DISTINCT FROM p_dob::text THEN changed:=array_append(changed,'dob'); END IF;
 IF cardinality(changed)>0 THEN
  patient:=jsonb_set(jsonb_set(patient,'{syntheticName}',to_jsonb(btrim(p_name)),true),'{dob}',to_jsonb(p_dob::text),true);
  UPDATE p2_workspace SET draft=jsonb_set(w.draft,'{patient}',patient,true),version=version+1,updated_at=clock_timestamp() WHERE round_id=p_round_id;
  INSERT INTO case_event(case_id,event_type,details) VALUES(p_case_id,'PET_CURRENT_IDENTITY_RECONCILED',jsonb_build_object('roundId',p_round_id,'source','HIS_PET_RECEIPT','recordedAt',clock_timestamp(),'before',jsonb_build_object('name',before_patient->'syntheticName','dob',before_patient->'dob'),'after',jsonb_build_object('name',patient->'syntheticName','dob',patient->'dob'),'fields',changed));
 END IF;
 RETURN jsonb_build_object('filled',changed,'conflicts','[]'::jsonb,'pending','[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION p2_reconcile_pet_patient(uuid,uuid,text,date) FROM PUBLIC;
