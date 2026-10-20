-- PET may fill only an unrecorded patient name/date of birth for the current S1 round.
-- Keep worker_rw away from the P2 workspace itself; expose this narrow operation instead.
CREATE OR REPLACE FUNCTION p2_reconcile_pet_patient(p_case_id uuid,p_round_id uuid,p_name text,p_dob date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE w p2_workspace; patient jsonb; current_name text; current_dob date; filled text[]:=ARRAY[]::text[]; conflicts text[]:=ARRAY[]::text[]; pending text[]:=ARRAY[]::text[];
BEGIN
 IF p_name IS NULL OR btrim(p_name)='' OR p_dob IS NULL THEN RAISE EXCEPTION 'PET_IDENTITY_FIELDS_REQUIRED'; END IF;
 PERFORM 1 FROM nipt_case c JOIN specimen_round r ON r.id=p_round_id AND r.case_id=c.id
 WHERE c.id=p_case_id AND c.current_round_id=p_round_id AND r.round_number=1 AND r.received_source='HIS_PET_RECEIPT';
 IF NOT FOUND THEN RAISE EXCEPTION 'PET_IDENTITY_ROUND_INVALID'; END IF;
 SELECT * INTO w FROM p2_workspace WHERE case_id=p_case_id AND round_id=p_round_id FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('filled',filled,'conflicts',conflicts,'pending',pending); END IF;
 patient:=COALESCE(w.draft->'patient','{}'::jsonb);
 current_name:=NULLIF(btrim(COALESCE(patient->>'syntheticName','')),'');
 current_dob:=NULLIF(patient->>'dob','')::date;
 IF current_name IS NULL THEN filled:=array_append(filled,'name'); ELSIF current_name<>btrim(p_name) THEN conflicts:=array_append(conflicts,'name'); END IF;
 IF current_dob IS NULL THEN filled:=array_append(filled,'dob'); ELSIF current_dob<>p_dob THEN conflicts:=array_append(conflicts,'dob'); END IF;
 IF cardinality(filled)=0 AND cardinality(conflicts)=0 THEN RETURN jsonb_build_object('filled',filled,'conflicts',conflicts,'pending',pending); END IF;
 IF EXISTS(SELECT 1 FROM p2_document_revision d WHERE d.round_id=p_round_id AND d.kind='REQUEST') THEN
  pending:=filled;filled:=ARRAY[]::text[];
  RETURN jsonb_build_object('filled',filled,'conflicts',conflicts,'pending',pending);
 END IF;
 IF 'name'=ANY(filled) THEN patient:=jsonb_set(patient,'{syntheticName}',to_jsonb(btrim(p_name)),true); END IF;
 IF 'dob'=ANY(filled) THEN patient:=jsonb_set(patient,'{dob}',to_jsonb(p_dob::text),true); END IF;
 IF cardinality(filled)>0 THEN
  UPDATE p2_workspace SET draft=jsonb_set(w.draft,'{patient}',patient,true),version=version+1,updated_at=now()
  WHERE case_id=p_case_id AND round_id=p_round_id;
 END IF;
 RETURN jsonb_build_object('filled',filled,'conflicts',conflicts,'pending',pending);
END $$;
REVOKE ALL ON FUNCTION p2_reconcile_pet_patient(uuid,uuid,text,date) FROM PUBLIC;
