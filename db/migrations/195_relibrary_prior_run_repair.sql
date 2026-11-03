-- Owner 2026-11-04: LN Halos 26B261020101 was already Re-Libraried in the first run, before the system was complete, so the system has the LN Halos number but no attempt for it.
-- The owner authorised recording it as the Re-Library attempt (-2) so it can be placed in Run 4. Nothing is invented beyond that: attempt 1 is recorded as stopped/superseded by the repeat, attempt 2 is the Re-Library, both with events that name this authorisation.
-- The repair is a no-op (with a notice) unless every precondition holds: one round holds the number, it is the case's current received round, it has no attempt at all, no reported result and it is not an EQA.
CREATE FUNCTION lab_repair_prior_run_relibrary(p_ln_halos text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE r specimen_round; n specimen_lab_number; a1 uuid; ord uuid; a2 uuid; note constant text:='Re-Library ทำไปแล้วในรันแรกก่อนระบบเสร็จ - Owner อนุญาตให้บันทึกเป็น -2 (2026-11-04)';
BEGIN
 SELECT * INTO n FROM specimen_lab_number WHERE ln_halos=p_ln_halos;
 IF n.round_id IS NULL THEN RETURN 'NO_SUCH_LN_HALOS'; END IF;
 SELECT * INTO r FROM specimen_round WHERE id=n.round_id FOR UPDATE;
 IF r.received_at IS NULL OR r.state NOT IN ('ReceivedInHIS','ReceivedInNIPT') OR NOT EXISTS(SELECT 1 FROM nipt_case c WHERE c.id=r.case_id AND c.current_round_id=r.id) THEN RETURN 'ROUND_NOT_CURRENT_RECEIVED'; END IF;
 IF EXISTS(SELECT 1 FROM analytical_attempt WHERE round_id=r.id) THEN RETURN 'ATTEMPT_ALREADY_EXISTS'; END IF;
 IF EXISTS(SELECT 1 FROM eqa_case WHERE case_id=r.case_id) THEN RETURN 'EQA_EXCLUDED'; END IF;
 IF to_regclass('public.historical_reported_result') IS NOT NULL AND EXISTS(SELECT 1 FROM historical_reported_result WHERE case_id=r.case_id AND round_id=r.id) THEN RETURN 'HAS_REPORTED_RESULT'; END IF;
 INSERT INTO analytical_attempt(case_id,round_id,attempt_number,state) VALUES(r.case_id,r.id,1,'Ready') RETURNING id INTO a1;
 UPDATE analytical_attempt SET state='Stopped' WHERE id=a1;
 INSERT INTO repeat_work_order(case_id,round_id,reason_code,state,parent_attempt_id,level,note) VALUES(r.case_id,r.id,'OTHER','RepeatPendingBatch',a1,'RE_LIBRARY',note) RETURNING id INTO ord;
 INSERT INTO analytical_attempt(case_id,round_id,attempt_number,repeat_order_id,state) VALUES(r.case_id,r.id,2,ord,'Ready') RETURNING id INTO a2;
 UPDATE analytical_attempt SET state='Superseded' WHERE id=a1;
 INSERT INTO attempt_event(attempt_id,case_id,event_type,from_state,to_state,details) VALUES(a1,r.case_id,'STATE_CHANGED','Ready','Stopped',jsonb_build_object('repair','PRIOR_RUN_RELIBRARY','note',note));
 INSERT INTO attempt_event(attempt_id,case_id,event_type,from_state,to_state,details) VALUES(a1,r.case_id,'STATE_CHANGED','Stopped','Superseded',jsonb_build_object('repeatOrderId',ord,'childAttemptId',a2,'repair','PRIOR_RUN_RELIBRARY'));
 INSERT INTO attempt_event(attempt_id,case_id,event_type,reason,details) VALUES(a2,r.case_id,'REPEAT_ORDERED',note,jsonb_build_object('parentAttemptId',a1,'level','RE_LIBRARY','reasonCode','OTHER','repair','PRIOR_RUN_RELIBRARY'));
 INSERT INTO case_event(case_id,event_type,details) VALUES(r.case_id,'LAB_REPEAT_ORDERED',jsonb_build_object('roundNumber',r.round_number,'level','RE_LIBRARY','reasonCode','OTHER','attemptNumber',2,'repair','PRIOR_RUN_RELIBRARY','ownerAuthorised','2026-11-04'));
 RETURN 'REPAIRED';
END $$;
REVOKE ALL ON FUNCTION lab_repair_prior_run_relibrary(text) FROM PUBLIC;
DO $$ DECLARE res text; BEGIN res:=lab_repair_prior_run_relibrary('26B261020101'); RAISE NOTICE 'lab_repair_prior_run_relibrary(26B261020101): %',res; END $$;
