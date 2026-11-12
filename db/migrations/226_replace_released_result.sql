-- Owner 2026-11-12: "ออกผลใหม่แทนผลเดิม". A released result found to be wrong (e.g. the first HALOS file was wrong) is DELETED, by the
-- Owner's rule, when the person ticks the box while generating the new report from the corrected HALOS row. The round is then empty, so
-- the new report links by itself (FROZEN_EXPORT) and is sent to HIS as usual. The Owner corrects HIS directly.
-- Deleted: the old report version, its release, the report PDF record (internal_report) and its intake row, and every row that hangs off
-- them (reviews, gates, link and state events, access log rows, HIS transfer and its events, PDF archive jobs, NHSO entries).
-- Kept: the audit chain (a hash chain; one removed row would break verification; it holds identifiers only, never result values),
-- the HALOS import rows (immutable source files) and the stored PDF bytes (content-addressed; not reachable from any screen).
-- Only a released INTERNAL report (one generated from HALOS) can be deleted. The function runs as the schema owner because every
-- result table refuses DELETE to the application roles; it re-enables those guards before it returns.
CREATE FUNCTION result_purge_released(p_version uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
 v result_report_version%ROWTYPE;
 guarded constant text[]:=ARRAY['p6_reconciliation','p6_transfer_event','p6_transfer','pdf_archive_job','nhso_result_entry_event','result_release_completed','result_release',
  'result_qc5_review','result_review','result_gate_evaluation','result_link_event','result_version_event','result_access_log','result_reparse_evidence','result_external_fallback',
  'result_his_attestation','migration_result_review','migration_doctor_case','internal_report','result_report_version','result_intake_file'];
 t text;
BEGIN
 SELECT * INTO v FROM result_report_version WHERE id=p_version FOR UPDATE;
 IF NOT FOUND OR v.state<>'CertifiedReleased' OR v.kind<>'RESULT' THEN RAISE EXCEPTION 'PURGE_REQUIRES_RELEASED_RESULT'; END IF;
 IF v.origin<>'INTERNAL_GENERATED' THEN RAISE EXCEPTION 'PURGE_REQUIRES_INTERNAL_REPORT'; END IF;
 FOREACH t IN ARRAY guarded LOOP EXECUTE format('ALTER TABLE %I DISABLE TRIGGER USER',t); END LOOP;
 -- HIS transfer of the old release and its history.
 DELETE FROM p6_reconciliation WHERE transfer_id IN (SELECT x.id FROM p6_transfer x JOIN result_release r ON r.id=x.clinical_release_id WHERE r.version_id=v.id);
 DELETE FROM p6_transfer_event WHERE transfer_id IN (SELECT x.id FROM p6_transfer x JOIN result_release r ON r.id=x.clinical_release_id WHERE r.version_id=v.id);
 DELETE FROM p6_transfer WHERE clinical_release_id IN (SELECT id FROM result_release WHERE version_id=v.id);
 -- A HIS job of the old release that has not run never runs.
 UPDATE job_outbox SET state='Cancelled',cancel_epoch=cancel_epoch+1 WHERE kind='result_release_completed' AND state='Pending' AND payload->>'releaseId' IN (SELECT id::text FROM result_release WHERE version_id=v.id);
 DELETE FROM pdf_archive_probe WHERE retry_job_id IN (SELECT id FROM pdf_archive_job WHERE version_id=v.id OR release_id IN (SELECT id FROM result_release WHERE version_id=v.id));
 DELETE FROM pdf_archive_job WHERE version_id=v.id OR release_id IN (SELECT id FROM result_release WHERE version_id=v.id);
 DELETE FROM nhso_result_entry_event WHERE version_id=v.id OR release_id IN (SELECT id FROM result_release WHERE version_id=v.id);
 DELETE FROM result_release_completed WHERE version_id=v.id OR release_id IN (SELECT id FROM result_release WHERE version_id=v.id);
 DELETE FROM result_release WHERE version_id=v.id;
 -- The version's own evidence.
 DELETE FROM result_qc5_review WHERE version_id=v.id;
 DELETE FROM result_review WHERE version_id=v.id;
 DELETE FROM result_gate_evaluation WHERE version_id=v.id;
 DELETE FROM result_link_event WHERE version_id=v.id;
 DELETE FROM result_version_event WHERE version_id=v.id;
 DELETE FROM result_access_log WHERE version_id=v.id;
 DELETE FROM result_reparse_evidence WHERE version_id=v.id;
 DELETE FROM result_external_fallback WHERE version_id=v.id;
 DELETE FROM result_his_attestation WHERE version_id=v.id;
 DELETE FROM migration_result_review WHERE version_id=v.id;
 DELETE FROM migration_doctor_case WHERE version_id=v.id;
 -- The report PDF record behind it, then the version and its intake row.
 UPDATE internal_report SET supersedes_id=NULL WHERE supersedes_id IN (SELECT id FROM internal_report WHERE version_id=v.id);
 DELETE FROM internal_report WHERE version_id=v.id;
 UPDATE result_report_version SET supersedes_id=NULL WHERE supersedes_id=v.id;
 UPDATE result_intake_file SET duplicate_of=NULL WHERE duplicate_of=v.id;
 DELETE FROM result_report_version WHERE id=v.id;
 DELETE FROM result_intake_file WHERE parent_id=v.intake_file_id;
 DELETE FROM result_intake_file WHERE id=v.intake_file_id;
 FOREACH t IN ARRAY guarded LOOP EXECUTE format('ALTER TABLE %I ENABLE TRIGGER USER',t); END LOOP;
END $$;
REVOKE ALL ON FUNCTION result_purge_released(uuid) FROM PUBLIC;
-- Report batch items run in the Worker (migration 216); roles.sql repeats this on a fresh install.
DO $$ BEGIN
 IF EXISTS(SELECT FROM pg_roles WHERE rolname='worker_rw') THEN EXECUTE 'GRANT EXECUTE ON FUNCTION result_purge_released(uuid) TO worker_rw'; END IF;
 IF EXISTS(SELECT FROM pg_roles WHERE rolname='app_rw') THEN EXECUTE 'GRANT EXECUTE ON FUNCTION result_purge_released(uuid) TO app_rw'; END IF;
END $$;
