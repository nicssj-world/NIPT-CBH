-- Owner 2026-11-09: recover Run007/2026's 15 first attempts incorrectly consumed by plan cancellation.
-- A printed placement is not physical execution. Preserve every identity, placement, cancellation and receipt.
-- Recovery is privileged, guarded and atomic; no trigger is disabled and no repeat attempt is fabricated.
CREATE FUNCTION lab_cancelled_unstarted_attempt_recoverable(target uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT EXISTS(
  SELECT 1 FROM analytical_attempt a JOIN nipt_case c ON c.id=a.case_id JOIN specimen_round r ON r.id=a.round_id
  WHERE a.id=target AND a.state='BatchCancelled' AND a.attempt_number=1 AND a.repeat_order_id IS NULL
   AND a.qc_failed_stage IS NULL AND NOT a.resume_decision_required AND c.current_round_id=a.round_id
   AND c.registration_origin<>'HISTORICAL' AND r.state IN ('ReceivedInHIS','ReceivedInNIPT')
   AND EXISTS(SELECT 1 FROM attempt_event e WHERE e.attempt_id=a.id AND e.event_type='STATE_CHANGED'
    AND e.from_state='Assigned' AND e.to_state='BatchCancelled')
   AND NOT EXISTS(SELECT 1 FROM attempt_event e WHERE e.attempt_id=a.id AND (
    e.from_state IN ('InProgress','QcFailed','AnalysisComplete','FinalQcAccepted','Final','Stopped','Superseded')
    OR e.to_state IN ('InProgress','QcFailed','AnalysisComplete','FinalQcAccepted','Final','Stopped','Superseded')
    OR e.event_type='NO_CALL_SELECTED'))
   AND NOT EXISTS(SELECT 1 FROM analytical_attempt child WHERE child.round_id=a.round_id AND child.id<>a.id)
   AND NOT EXISTS(SELECT 1 FROM repeat_work_order w WHERE w.parent_attempt_id=a.id)
   AND NOT EXISTS(SELECT 1 FROM result_report_version v WHERE v.attempt_id=a.id OR v.round_id=a.round_id)
   AND NOT EXISTS(SELECT 1 FROM historical_reported_result h WHERE h.round_id=a.round_id)
   AND NOT EXISTS(SELECT 1 FROM attempt_stage_qc q WHERE q.attempt_id=a.id)
   AND EXISTS(SELECT 1 FROM lab_slot_assignment x JOIN lab_batch b ON b.id=x.batch_id
    WHERE x.attempt_id=a.id AND x.removed_reason='BATCH_CANCELLED' AND x.removed_at IS NOT NULL AND b.state='Cancelled')
   AND NOT EXISTS(SELECT 1 FROM lab_slot_assignment x JOIN lab_batch b ON b.id=x.batch_id WHERE x.attempt_id=a.id AND (
    x.removed_at IS NULL OR b.state<>'Cancelled'
    OR EXISTS(SELECT 1 FROM lab_task_sheet t WHERE t.batch_id=b.id AND
     (t.execution_started_at IS NOT NULL OR t.execution_ended_at IS NOT NULL OR t.verified_at IS NOT NULL OR t.execution_mode IS NOT NULL))
    OR EXISTS(SELECT 1 FROM lab_observation o WHERE o.batch_id=b.id)
    OR EXISTS(SELECT 1 FROM p4b_pool_attempt p WHERE p.batch_id=b.id)
    OR EXISTS(SELECT 1 FROM p4c_dnb_attempt d WHERE d.batch_id=b.id)
    OR EXISTS(SELECT 1 FROM lab_bench_export e WHERE e.batch_id=b.id)
    OR EXISTS(SELECT 1 FROM lab_seq_export_pair e WHERE e.batch_id=b.id)
    OR EXISTS(SELECT 1 FROM lab_actual_pooling p WHERE p.batch_id=b.id AND p.note<>'AUTO_RECORDED_FROM_SAVED_TASK_AT_EXPORT')
    OR EXISTS(SELECT 1 FROM lab_document_copy copy JOIN lab_document doc ON doc.id=copy.document_id
     WHERE doc.batch_id=b.id AND copy.kind='WORKING_COPY' AND copy.recalled_at IS NULL)
    OR EXISTS(SELECT 1 FROM task_workbook_revision w CROSS JOIN LATERAL jsonb_each(w.values) e WHERE w.batch_id=b.id AND (
     (jsonb_typeof(e.value)='number' AND e.key ~ '^(slot\.[0-9]+\.(libraryQc|extractionQc)|qc\.[123]\.(standard1|standard2|standard2Concentration)|pool\.(concentration|standard1|standard2|standard2Concentration|dilutionC1)|seq\.(standard1|standard2|standard2Concentration|dnbConcentration|dilutedConcentration|driveMemoryTb|negativePressureKpa|loadedDnb|q30|bic|fit))$')
     OR (e.key ~ '^slot\.[0-9]+\.transferChecked$' AND e.value='"✓"'::jsonb)))
   ))
 )
$$;
REVOKE ALL ON FUNCTION lab_cancelled_unstarted_attempt_recoverable(uuid) FROM PUBLIC;

-- Extend the lifecycle only for a proven unexecuted, cancelled first attempt. Every other existing transition guard remains.
DO $$ DECLARE definition text; BEGIN
 SELECT pg_get_functiondef('p4_attempt_transition_guard()'::regprocedure) INTO definition;
 IF position('BEGIN' in definition)=0 THEN RAISE EXCEPTION 'CANCELLED_RECOVERY_TRANSITION_GUARD_SHAPE_MISMATCH'; END IF;
 definition:=replace(definition,'BEGIN',$body$BEGIN
 IF OLD.state='BatchCancelled' AND NEW.state='Ready' THEN
  IF (to_jsonb(NEW)-'state')=(to_jsonb(OLD)-'state') AND lab_cancelled_unstarted_attempt_recoverable(OLD.id)
  THEN RETURN NEW; END IF;
 END IF;
 $body$);
 EXECUTE definition;
END $$;

CREATE FUNCTION lab_recover_cancelled_unstarted_run(target uuid,expected integer) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE b lab_batch; ids uuid[]; item analytical_attempt; total integer; recovered integer:=0;
BEGIN
 IF expected NOT BETWEEN 1 AND 48 THEN RAISE EXCEPTION 'CANCELLED_RUN_RECOVERY_COUNT_INVALID'; END IF;
 SELECT * INTO b FROM lab_batch WHERE id=target FOR UPDATE;
 IF b.id IS NULL THEN RETURN 'NOT_FOUND'; END IF;
 IF b.state<>'Cancelled' THEN RAISE EXCEPTION 'CANCELLED_RUN_RECOVERY_NOT_CANCELLED'; END IF;
 SELECT array_agg(DISTINCT x.attempt_id) INTO ids FROM lab_slot_assignment x
  WHERE x.batch_id=target AND x.removed_at IS NOT NULL AND x.removed_reason='BATCH_CANCELLED';
 total:=COALESCE(cardinality(ids),0);
 IF total<>expected THEN RAISE EXCEPTION 'CANCELLED_RUN_RECOVERY_COUNT_MISMATCH'; END IF;
 -- Serialize current-round/redraw changes as well as attempt changes during an administrative invocation.
 PERFORM id FROM nipt_case WHERE id IN(SELECT case_id FROM analytical_attempt WHERE id=ANY(ids)) ORDER BY id FOR UPDATE;
 PERFORM id FROM specimen_round WHERE id IN(SELECT round_id FROM analytical_attempt WHERE id=ANY(ids)) ORDER BY id FOR UPDATE;
 PERFORM id FROM analytical_attempt WHERE id=ANY(ids) ORDER BY id FOR UPDATE;
 IF NOT EXISTS(SELECT 1 FROM analytical_attempt a WHERE a.id=ANY(ids) AND NOT EXISTS(
  SELECT 1 FROM attempt_event e WHERE e.attempt_id=a.id AND e.details->>'repair'='CANCELLED_RUN_BEFORE_EXECUTION'
   AND e.details->>'batchId'=target::text)) THEN RETURN 'ALREADY_RECOVERED'; END IF;
 IF EXISTS(SELECT 1 FROM analytical_attempt a WHERE a.id=ANY(ids) AND NOT lab_cancelled_unstarted_attempt_recoverable(a.id))
 THEN RAISE EXCEPTION 'CANCELLED_RUN_RECOVERY_UNSAFE'; END IF;
 FOR item IN SELECT * FROM analytical_attempt WHERE id=ANY(ids) ORDER BY id LOOP
  UPDATE analytical_attempt SET state='Ready' WHERE id=item.id;
  INSERT INTO attempt_event(attempt_id,case_id,event_type,from_state,to_state,reason,details)
   VALUES(item.id,item.case_id,'STATE_CHANGED','BatchCancelled','Ready','Owner-authorized recovery of an unexecuted cancelled Run',
    jsonb_build_object('repair','CANCELLED_RUN_BEFORE_EXECUTION','batchId',target,'migration','207_cancelled_unstarted_run_recovery','system',true));
  INSERT INTO case_event(case_id,event_type,details) VALUES(item.case_id,'LAB_CANCELLED_RUN_RECOVERED',
   jsonb_build_object('repair','CANCELLED_RUN_BEFORE_EXECUTION','batchId',target,'attemptId',item.id,'migration','207_cancelled_unstarted_run_recovery','system',true));
  recovered:=recovered+1;
 END LOOP;
 RETURN 'RECOVERED:'||recovered;
END $$;
REVOKE ALL ON FUNCTION lab_recover_cancelled_unstarted_run(uuid,integer) FROM PUBLIC;

-- Exact Run UUID prevents similarly numbered Staging/synthetic Runs from being touched.
-- Expected cardinality prevents partial restoration if the real records changed since the Owner's inspection.
DO $$ DECLARE result text; BEGIN
 result:=lab_recover_cancelled_unstarted_run('58847492-6d52-4802-9230-0c8b0d206fa0',15);
 RAISE NOTICE 'Owner-authorized Run007 recovery: %',result;
END $$;
