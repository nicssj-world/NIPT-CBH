-- Owner decision 2026-11-02: a result imported from Genomic-CBH, matched to its complete PDF, was already issued and used in care. It is a business
-- fact of its own - "reported by the previous system" - and never enters the clinical validation / certification gate of a result produced in
-- NIPT-CBH. This view is the one definition of that fact: every API and screen reads it, so a PDF linked later is covered without any data change.
-- It requires the imported, current, qualified HALOS attempt, the migration exact-match link evidence, and that NIPT-CBH never released the
-- version itself. It does not touch result_report_version, creates no release, signature, approval or HIS transfer, and weakens no guard.
CREATE VIEW historical_reported_result AS
SELECT v.id version_id,v.case_id,v.round_id,v.attempt_id,m.id record_id,m.ln,m.ln_halos,v.sha256,v.state technical_state,v.imported_at
FROM result_report_version v
JOIN migration_record m ON m.case_id=v.case_id AND m.round_id=v.round_id AND m.attempt_id=v.attempt_id AND m.state='IMPORTED'
WHERE v.kind='RESULT' AND v.state IN ('Linked','ValidationBlocked','PendingCertification')
 AND EXISTS(SELECT 1 FROM migration_analysis a WHERE a.record_id=m.id AND a.attempt_id=m.attempt_id AND a.is_current AND a.classification='ANALYSIS' AND a.advice_status='QUALIFIED')
 AND EXISTS(SELECT 1 FROM result_link_event e WHERE e.version_id=v.id AND e.event='AUTO_LINKED' AND e.match_evidence->>'contract'='MIGRATION-EXACT-CONTENT-v1')
 AND NOT EXISTS(SELECT 1 FROM result_release r WHERE r.version_id=v.id);
REVOKE ALL ON historical_reported_result FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS(SELECT FROM pg_roles WHERE rolname='app_rw') THEN GRANT SELECT ON historical_reported_result TO app_rw; END IF;
 IF EXISTS(SELECT FROM pg_roles WHERE rolname='worker_rw') THEN GRANT SELECT ON historical_reported_result TO worker_rw; END IF;
 IF EXISTS(SELECT FROM pg_roles WHERE rolname='report_ro') THEN GRANT SELECT ON historical_reported_result TO report_ro; END IF;
END $$;
