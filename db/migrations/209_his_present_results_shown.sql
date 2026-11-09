-- Owner 2026-11-09: a result that HIS already holds (the previous system sent it, or a person attested "มีผลใน HIS แล้ว") is shown to ANC on the patient
-- and is never sent again. It must not wait for the full legacy-analysis evidence that migration 178 asked of a Genomic-CBH import: that evidence is
-- about NIPT-CBH releasing a result, and this result is not released here.
--
-- This replaces the view of migration 178 with the same columns. Two ways in:
--   1. the original rule, unchanged: an imported, current, qualified analysis with exact-content link evidence;
--   2. task3_his_presence_attested(): an active "มีผลใน HIS แล้ว" attestation, or a migration record that says HIS already holds the PDF.
-- Either way the version is linked to a round, has no NIPT-CBH release, and (as before) creates no release, signature or HIS transfer: the P6 guard
-- already refuses any transfer for a version that task3_his_presence_attested() accepts. Withdrawing an attestation takes the version back out.
-- record_id / ln_halos are null for a result that is not from a Genomic-CBH import; every consumer that joins on record_id only ever meant migrated rows.
CREATE OR REPLACE VIEW historical_reported_result AS
SELECT v.id version_id,v.case_id,v.round_id,v.attempt_id,m.id record_id,COALESCE(m.ln,l.ln) ln,m.ln_halos,v.sha256,v.state technical_state,v.imported_at
FROM result_report_version v
LEFT JOIN migration_record m ON m.case_id=v.case_id AND m.round_id=v.round_id AND m.attempt_id=v.attempt_id AND m.state='IMPORTED'
LEFT JOIN specimen_round sr ON sr.id=v.round_id
LEFT JOIN case_ln l ON l.id=sr.case_ln_id
WHERE v.kind='RESULT' AND v.state IN ('Linked','ValidationBlocked','PendingCertification')
 AND v.round_id IS NOT NULL
 AND NOT EXISTS(SELECT 1 FROM result_release r WHERE r.version_id=v.id)
 AND (
  (m.id IS NOT NULL
   AND EXISTS(SELECT 1 FROM migration_analysis a WHERE a.record_id=m.id AND a.attempt_id=m.attempt_id AND a.is_current AND a.classification='ANALYSIS' AND a.advice_status='QUALIFIED')
   AND EXISTS(SELECT 1 FROM result_link_event e WHERE e.version_id=v.id AND e.event='AUTO_LINKED' AND e.match_evidence->>'contract'='MIGRATION-EXACT-CONTENT-v1'))
  OR task3_his_presence_attested(v.id));
