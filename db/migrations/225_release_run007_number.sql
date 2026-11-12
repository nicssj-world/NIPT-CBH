-- Owner 2026-11-12: Run007/2026 was cancelled unstarted (15 specimens recovered by migration 207) and kept its Run number,
-- so the next Batch became Run008. Under the Owner's rule (a cancelled Run gives its number back), release that one Run number
-- so the next Batch is Run007. Exact-UUID, guarded and idempotent; a no-op on any database that does not hold this Run.
-- The Run row, its events, audit and recovered specimens are untouched; only the release marker is set (guard from migration 224).
DO $$
DECLARE target constant uuid := '58847492-6d52-4802-9230-0c8b0d206fa0'; b lab_batch%ROWTYPE;
BEGIN
 SELECT * INTO b FROM lab_batch WHERE id=target FOR UPDATE;
 IF NOT FOUND OR b.run_released_at IS NOT NULL THEN RETURN; END IF;
 IF b.run_label<>'Run007/2026' OR b.state<>'Cancelled' OR b.cancelled_by IS NULL THEN RETURN; END IF;
 -- never create a duplicate active label: another live Run already holding 007/2026 means the number is in use.
 IF EXISTS(SELECT 1 FROM lab_batch WHERE run_year=b.run_year AND run_number=b.run_number AND run_released_at IS NULL AND id<>b.id) THEN RETURN; END IF;
 UPDATE lab_batch SET run_released_at=now(),run_released_by=b.cancelled_by WHERE id=b.id;
 INSERT INTO lab_batch_event(batch_id,event_type,reason,actor_id,details)
  VALUES(b.id,'RUN_NUMBER_RELEASED','Owner 2026-11-12: cancelled Run gives its number back',b.cancelled_by,
   jsonb_build_object('runLabel',b.run_label,'migration','225_release_run007_number','system',true));
END $$;
