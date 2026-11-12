-- Owner 2026-11-12: a LAB-registered case often has no pregnancy type when its Printed Sample ID is frozen at batch placement.
-- When the paper Request review later records Twins, the tube label and the Halos file carry the Twin suffix "D" but the frozen ID did not.
-- The ID stays immutable EXCEPT for adding or removing the single Twin "D" on an attempt that is not yet running and that no Halos/NIFTY export has frozen.
CREATE FUNCTION lab_printed_id_twin_resync_allowed(target uuid,old_id text,new_id text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT old_id IS NOT NULL AND new_id IS NOT NULL AND old_id<>new_id
  AND substring(old_id from '^[0-9]{2}B[0-9]{9}')=substring(new_id from '^[0-9]{2}B[0-9]{9}')
  AND substring(old_id from '^[0-9]{2}B[0-9]{9}D?(.*)$')=substring(new_id from '^[0-9]{2}B[0-9]{9}D?(.*)$')
  AND EXISTS(SELECT 1 FROM analytical_attempt a WHERE a.id=target AND a.state IN ('Ready','Assigned'))
  AND NOT EXISTS(SELECT 1 FROM lab_bench_export e CROSS JOIN LATERAL jsonb_array_elements(e.mapping) m WHERE m->>'attemptId'=target::text)
  AND NOT EXISTS(SELECT 1 FROM p4b_halos_export e CROSS JOIN LATERAL jsonb_array_elements(e.source->'members') m WHERE m->>'exportSampleId' IN (old_id,new_id))
$$;
REVOKE ALL ON FUNCTION lab_printed_id_twin_resync_allowed(uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION lab_printed_id_twin_resync_allowed(uuid,text,text) TO PUBLIC;

DO $$ DECLARE definition text; needle text:='IF OLD.printed_sample_id IS NOT NULL AND NEW.printed_sample_id IS DISTINCT FROM OLD.printed_sample_id THEN';
BEGIN
 SELECT pg_get_functiondef('p4_attempt_transition_guard()'::regprocedure) INTO definition;
 IF position(needle in definition)=0 THEN RAISE EXCEPTION 'PRINTED_ID_TWIN_RESYNC_GUARD_SHAPE_MISMATCH'; END IF;
 definition:=replace(definition,needle,'IF OLD.printed_sample_id IS NOT NULL AND NEW.printed_sample_id IS DISTINCT FROM OLD.printed_sample_id AND NOT lab_printed_id_twin_resync_allowed(OLD.id,OLD.printed_sample_id,NEW.printed_sample_id) THEN');
 EXECUTE definition;
END $$;
