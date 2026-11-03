-- Owner 2026-11-03: a single authorized HIS-intake operator resolves an issue directly.
-- Preserve immutable historical PROPOSED/APPROVED/REJECTED events and their maker-checker trigger.
-- New operation has its own event type, actor/time/action provenance, and no free-text reason requirement.
ALTER TABLE his_intake_issue_event DROP CONSTRAINT IF EXISTS his_intake_issue_event_event_check;
ALTER TABLE his_intake_issue_event
  ADD CONSTRAINT his_intake_issue_event_event_check
  CHECK (event IN ('OPENED','PROPOSED','APPROVED','REJECTED','AUTO_CLOSED','RESOLVED_DIRECT'));

ALTER TABLE his_intake_issue_event
  ADD CONSTRAINT his_intake_direct_resolution_evidence_check
  CHECK (event <> 'RESOLVED_DIRECT' OR (actor_id IS NOT NULL AND action IS NOT NULL));
