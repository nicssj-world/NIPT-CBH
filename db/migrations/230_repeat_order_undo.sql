-- Owner 2026-11-17: "ยกเลิกคำสั่งตรวจซ้ำ" — a repeat (Re-Library / Re-Extraction) ordered by mistake is removed AS IF IT WAS NEVER ORDERED,
-- while its new attempt (-2 / -3) has not been put on a Task List. Every step must be able to go on or go back.
-- Why a delete: attempt_number (UNIQUE per round) and overall_ordinal (UNIQUE per case) are immutable and drive the printed suffix, the S1
-- -3 ceiling and the 4-attempt No Call rule; a kept "Cancelled" -2 would make the next repeat -3 and count as a test. So the function
-- deletes the unplaced child attempt, its events and its order, deletes the parent's events written by the same action (same transaction
-- time: the failure confirmation and state changes of that Action Center click) and puts the parent back in the state it had before.
-- Kept: the audit chain (hash chain) and the case events (LAB_REPEAT_ORDERED stays; the caller adds LAB_REPEAT_CANCELLED).
-- Refused unless: the child is Ready, has no printed ID and was never on a Task List (no slot assignment, ever), its order is still
-- Requested/PendingBatch, the child is the newest attempt of the round and of the case, and the parent was superseded by this order and
-- has not changed since. Foreign keys stay enforced (only USER triggers are paused), so any other row pointing at the child aborts it.
CREATE FUNCTION lab_repeat_undo(p_child uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
 c analytical_attempt%ROWTYPE; o repeat_work_order%ROWTYPE; p analytical_attempt%ROWTYPE;
 at timestamptz; restore text;
 guarded constant text[]:=ARRAY['analytical_attempt','attempt_event','repeat_work_order'];
 t text;
BEGIN
 SELECT * INTO c FROM analytical_attempt WHERE id=p_child FOR UPDATE;
 IF NOT FOUND OR c.repeat_order_id IS NULL THEN RAISE EXCEPTION 'REPEAT_UNDO_NOT_A_REPEAT'; END IF;
 PERFORM 1 FROM nipt_case WHERE id=c.case_id FOR UPDATE;
 SELECT * INTO o FROM repeat_work_order WHERE id=c.repeat_order_id FOR UPDATE;
 IF c.state<>'Ready' OR c.printed_sample_id IS NOT NULL OR o.state NOT IN ('RepeatRequested','RepeatPendingBatch')
  OR EXISTS(SELECT 1 FROM lab_slot_assignment s WHERE s.attempt_id=c.id) THEN RAISE EXCEPTION 'REPEAT_UNDO_ALREADY_PLACED'; END IF;
 IF c.overall_ordinal<>(SELECT max(x.overall_ordinal) FROM analytical_attempt x WHERE x.case_id=c.case_id)
  OR c.attempt_number<>(SELECT max(x.attempt_number) FROM analytical_attempt x WHERE x.round_id=c.round_id) THEN RAISE EXCEPTION 'REPEAT_UNDO_NOT_LATEST'; END IF;
 SELECT * INTO p FROM analytical_attempt WHERE id=o.parent_attempt_id FOR UPDATE;
 IF NOT FOUND OR p.state<>'Superseded' THEN RAISE EXCEPTION 'REPEAT_UNDO_PARENT_CHANGED'; END IF;
 SELECT e.created_at INTO at FROM attempt_event e WHERE e.attempt_id=c.id AND e.event_type='REPEAT_ORDERED' ORDER BY e.sequence LIMIT 1;
 IF at IS NULL OR NOT EXISTS(SELECT 1 FROM attempt_event e WHERE e.attempt_id=p.id AND e.event_type='STATE_CHANGED' AND e.to_state='Superseded'
   AND e.created_at=at AND e.details->>'repeatOrderId'=o.id::text)
  OR EXISTS(SELECT 1 FROM attempt_event e WHERE e.attempt_id=p.id AND e.created_at>at) THEN RAISE EXCEPTION 'REPEAT_UNDO_PARENT_CHANGED'; END IF;
 -- The parent's state before that action: the from_state of the first state change written by the same transaction.
 SELECT e.from_state INTO restore FROM attempt_event e WHERE e.attempt_id=p.id AND e.event_type='STATE_CHANGED' AND e.created_at=at ORDER BY e.sequence LIMIT 1;
 IF restore IS NULL THEN RAISE EXCEPTION 'REPEAT_UNDO_PARENT_CHANGED'; END IF;

 FOREACH t IN ARRAY guarded LOOP EXECUTE format('ALTER TABLE %I DISABLE TRIGGER USER',t); END LOOP;
 DELETE FROM attempt_event WHERE attempt_id=c.id;
 DELETE FROM analytical_attempt WHERE id=c.id;
 DELETE FROM repeat_work_order WHERE id=o.id;
 DELETE FROM attempt_event WHERE attempt_id=p.id AND created_at=at;
 -- Only a QcFailed attempt carries a failed stage; any other earlier state never had one.
 UPDATE analytical_attempt SET state=restore,qc_failed_stage=CASE WHEN restore='QcFailed' THEN qc_failed_stage ELSE NULL END WHERE id=p.id;
 -- A parent that was itself a repeat had its own order closed by that same action; reopen it when the parent is live again.
 IF restore IN ('Assigned','InProgress') THEN
  UPDATE repeat_work_order SET state='RepeatInProgress',closed_by=NULL,closed_at=NULL,close_reason=NULL
   WHERE id=p.repeat_order_id AND state='RepeatFailed' AND closed_at=at AND close_reason LIKE 'CHILD\_%';
 END IF;
 FOREACH t IN ARRAY guarded LOOP EXECUTE format('ALTER TABLE %I ENABLE TRIGGER USER',t); END LOOP;
 RETURN jsonb_build_object('parentAttemptId',p.id,'restoredState',restore,'level',o.level,'reasonCode',o.reason_code,'attemptNumber',c.attempt_number);
END $$;
REVOKE ALL ON FUNCTION lab_repeat_undo(uuid) FROM PUBLIC;
-- roles.sql repeats this grant on a fresh install.
DO $$ BEGIN
 IF EXISTS(SELECT FROM pg_roles WHERE rolname='app_rw') THEN EXECUTE 'GRANT EXECUTE ON FUNCTION lab_repeat_undo(uuid) TO app_rw'; END IF;
END $$;
