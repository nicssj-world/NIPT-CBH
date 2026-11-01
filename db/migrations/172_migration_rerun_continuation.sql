-- A real current HALOS Rerun can be superseded by a newly authorized routine repeat order.
-- No QC failure, historical repeat request, pooling or sequencing event is fabricated.
DO $$ DECLARE definition text; BEGIN
 SELECT pg_get_functiondef('p4_attempt_transition_guard()'::regprocedure) INTO definition;
 IF position('BEGIN' in definition)=0 THEN RAISE EXCEPTION 'MIGRATION_ATTEMPT_TRANSITION_GUARD_SHAPE_MISMATCH'; END IF;
 definition:=replace(definition,'BEGIN',$body$BEGIN
 IF OLD.state='Ready' AND NEW.state='Superseded' AND (to_jsonb(NEW)-'state')=(to_jsonb(OLD)-'state')
 AND EXISTS(SELECT 1 FROM migration_analysis a JOIN migration_record m ON m.id=a.record_id JOIN migration_source s ON s.id=a.source_id
  JOIN migration_historical_run h ON h.run_label=a.run_label AND h.source_sha256=s.sha256
  JOIN repeat_work_order w ON w.parent_attempt_id=OLD.id JOIN analytical_attempt child ON child.repeat_order_id=w.id
  WHERE a.attempt_id=OLD.id AND a.is_current AND a.classification='ANALYSIS' AND a.advice_status='RERUN'
  AND a.values->>'operationAdvice'='Rerun' AND a.values->>'physicianAdvice'='Rerun'
  AND m.state='IMPORTED' AND (m.case_id,m.round_id,m.attempt_id)=(OLD.case_id,OLD.round_id,OLD.id)
  AND w.state='RepeatPendingBatch' AND child.state='Ready' AND child.round_id=OLD.round_id AND child.attempt_number=OLD.attempt_number+1)
 THEN RETURN NEW; END IF;
 $body$);EXECUTE definition;
END $$;
