-- Execute separately as the synthetic database owner, never as an application connection.
-- Migration bridge grants are repeated for first installations whose runtime roles are created after migrations.
-- P7 evidence grants are repeated below for fresh installs where roles are created after migrations.
DO $$ BEGIN
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='app_rw') THEN CREATE ROLE app_rw NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE; END IF;
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='worker_rw') THEN CREATE ROLE worker_rw NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE; END IF;
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='report_ro') THEN CREATE ROLE report_ro NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE; END IF;
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='migrator') THEN CREATE ROLE migrator NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE; END IF;
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='backup') THEN CREATE ROLE backup NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE; END IF;
END $$;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO app_rw,worker_rw,report_ro;
GRANT SELECT ON nipt_case,case_ln,specimen_round,redraw_request,repeat_work_order,analytical_attempt,clinical_snapshot,case_event,file_asset,worker_heartbeat TO report_ro;
GRANT SELECT,INSERT,UPDATE ON nipt_case,case_ln,specimen_round,redraw_request,repeat_work_order,analytical_attempt,job_outbox TO app_rw;
GRANT SELECT,INSERT ON registration_attempt,clinical_snapshot,case_event,audit_chain,file_asset TO app_rw;
GRANT SELECT ON nipt_case,case_ln,specimen_round TO worker_rw;
GRANT SELECT,INSERT ON his_inbound_file,his_order,audit_chain TO worker_rw;
GRANT UPDATE ON case_ln,specimen_round,his_inbound_file,job_outbox TO worker_rw;
GRANT SELECT,INSERT,UPDATE ON worker_heartbeat TO worker_rw;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO app_rw,worker_rw;
GRANT SELECT,INSERT,UPDATE ON app_user,app_session,login_throttle,settings_revision,setting_active TO app_rw;
GRANT SELECT,INSERT,UPDATE,DELETE ON role_assignment,user_unit_scope,user_permission,case_unit_scope TO app_rw;
GRANT SELECT,INSERT,UPDATE ON unit,pdf_preview_cache TO app_rw;
GRANT SELECT,INSERT,UPDATE ON admin_access_request TO app_rw;
GRANT SELECT,INSERT ON admin_access_supersession TO app_rw;
GRANT SELECT ON schema_migration TO app_rw;
GRANT INSERT ON secret_revision TO app_rw;
GRANT SELECT(id,secret_key,key_version,created_by,created_at,tested_at,retired_at) ON secret_revision TO app_rw;
GRANT SELECT ON worker_heartbeat,settings_revision,setting_active TO app_rw;
GRANT SELECT ON settings_revision,setting_active,secret_revision,job_outbox TO worker_rw;
GRANT SELECT,INSERT,UPDATE ON integration_job_receipt TO worker_rw;
GRANT SELECT ON integration_job_receipt TO app_rw;
GRANT SELECT,INSERT ON phi_access_log TO app_rw;
GRANT INSERT ON job_outbox TO worker_rw;
GRANT SELECT,INSERT,UPDATE ON p2_workspace,p2_signing_session TO app_rw;
DO $$ BEGIN
 IF to_regprocedure('public.p2_reconcile_pet_patient(uuid,uuid,text,date)') IS NOT NULL THEN
  EXECUTE 'GRANT EXECUTE ON FUNCTION p2_reconcile_pet_patient(uuid,uuid,text,date) TO worker_rw,app_rw';
 END IF;
 IF to_regclass('public.p2_registration_void') IS NOT NULL THEN
  EXECUTE 'GRANT SELECT,INSERT ON p2_registration_void TO app_rw';
 END IF;
END $$;
GRANT SELECT,INSERT ON p2_case_identity,p2_doctor_version,p2_doctor_event,p2_document_revision,p2_collection_fact,p2_paper_review,p2_consent_ack,p2_consent_signature,p2_final_consent,p2_revocation,p2_disposition,p2_document_access TO app_rw;
GRANT SELECT,INSERT ON p2_doctor_registration TO app_rw;
GRANT SELECT,INSERT ON p2_request_ack TO app_rw;
-- The deferred S1 receipt guard reads existing HIS orders even for an Expected synthetic round.
GRANT SELECT ON his_order TO app_rw;
-- P3 synthetic HIS inbound (migration 008) and P2-P3 integration grants.
GRANT SELECT,INSERT,UPDATE ON his_intake_issue,his_inbound_waiting TO worker_rw;
GRANT SELECT,INSERT ON his_intake_issue_event,his_inbound_source,his_inbound_scan_run TO worker_rw;
GRANT SELECT,INSERT ON file_asset TO worker_rw;
GRANT SELECT ON nipt_case,case_ln,specimen_round,his_order,app_user TO worker_rw;
-- Read requested redraw lineage for PET-backed S2; worker still cannot create/edit redraw requests.
GRANT SELECT ON redraw_request TO worker_rw;
GRANT SELECT,INSERT ON specimen_acceptance TO app_rw;
GRANT SELECT,INSERT ON task_workbook_revision,task_workbook_export TO app_rw;
-- Operational lab/result evidence remains append-only; P5 release writes require DB review guards.
GRANT SELECT,INSERT ON p4b_halos_export,p4b_halos_verification,result_qc5_review,result_release_completed TO app_rw;
GRANT INSERT,UPDATE ON result_release TO app_rw;
GRANT SELECT,INSERT ON case_event TO worker_rw;
-- Worker matching compares the registrant's immutable P2 HN; it never writes P2 evidence. Column-scoped reads only.
GRANT SELECT(case_id,hn) ON p2_case_identity TO worker_rw;
GRANT SELECT(case_id,round_id,source,collection_date,sequence) ON p2_collection_fact TO worker_rw;
-- Registration-time intake linking (D-49) runs inside the web registration transaction.
GRANT SELECT,UPDATE ON his_inbound_file TO app_rw;
GRANT SELECT,INSERT ON his_order TO app_rw;
GRANT SELECT,INSERT,UPDATE ON his_intake_issue TO app_rw;
GRANT SELECT,INSERT ON his_intake_issue_event TO app_rw;
GRANT SELECT ON his_inbound_source,his_inbound_waiting,his_inbound_scan_run TO app_rw;
GRANT SELECT ON his_inbound_file,his_intake_issue,his_inbound_scan_run TO report_ro;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO app_rw,worker_rw;
-- P4 synthetic Lab workflow (migration 010). LN Halos and attempt #1 are issued only by the SECURITY DEFINER receipt trigger;
-- neither the web nor the worker role can insert or alter a lab number directly.
GRANT SELECT ON specimen_lab_number,ln_halos_daily_sequence,lab_qc_criteria_version TO app_rw;
GRANT EXECUTE ON FUNCTION p4_ensure_ln_halos(uuid,text) TO app_rw;
GRANT SELECT,INSERT ON attempt_event,lab_batch_slot,lab_batch_event,lab_placement_snapshot,lab_observation_review,attempt_stage_qc,label_print_job,label_print_item TO app_rw;
GRANT SELECT,INSERT,UPDATE ON lab_batch_sequence,lab_batch,lab_task_sheet,lab_slot_assignment,lab_document,lab_document_copy,lab_observation,lab_slot_disposition TO app_rw;
GRANT SELECT ON specimen_lab_number,lab_batch,lab_task_sheet,lab_slot_assignment,lab_document,attempt_stage_qc,label_print_job TO report_ro;
-- P4b evidence is insert-only; app_rw cannot replace snapshots, observations or PDFs.
GRANT SELECT,INSERT ON p4b_pool_attempt,p4b_pool_event,p4b_pool_observation,p4b_pool_review,p4b_qc2_decision,p4b_pool_snapshot,p4b_document,p4b_document_copy TO app_rw;
GRANT SELECT ON p4b_pool_attempt,p4b_pool_event,p4b_pool_snapshot,p4b_document TO report_ro;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO app_rw;
-- DNB/QC3, sequencing/QC4, HALOS handoff and F5 restricted simulation evidence.
GRANT SELECT,INSERT ON p4c_dnb_attempt,p4c_dnb_event,p4c_dnb_observation,p4c_dnb_review,p4c_qc3_decision,p4c_handoff,p4c_handoff_transfer,p4c_handoff_verification,p4c_sequencing_attempt,p4c_qc4_observation,p4c_qc4_review,p4c_command,p4c_document,p4c_document_copy TO app_rw;
GRANT SELECT ON p4c_dnb_attempt,p4c_dnb_event,p4c_handoff,p4c_sequencing_attempt,p4c_document TO report_ro;
-- P5 synthetic Result Management (migration 050). The worker reads the configured synthetic folder and records quarantined intake;
-- it never creates report versions, links or releases. Releases stay SELECT-only and are additionally blocked by RELEASE_HOLD_AL5.
GRANT SELECT,INSERT,UPDATE ON result_intake_file TO worker_rw;
GRANT SELECT(id,sha256,state) ON result_report_version TO worker_rw;
GRANT SELECT,INSERT,UPDATE ON result_intake_file,result_report_version TO app_rw;
GRANT SELECT,INSERT ON result_version_event,result_link_event,result_gate_evaluation,result_review,result_access_log TO app_rw;
GRANT SELECT ON result_release TO app_rw;
GRANT SELECT ON result_report_version,result_release TO report_ro;
-- P5H historical bulk import (migration 070). Evaluations, verifications and revisions are insert-only; drafts are guarded by triggers.
GRANT SELECT,INSERT,UPDATE ON historical_batch,historical_batch_file,historical_draft TO app_rw;
GRANT SELECT,INSERT ON historical_draft_revision,historical_eligibility_evaluation,historical_verification,historical_record TO app_rw;
GRANT SELECT,INSERT ON historical_batch,historical_batch_file,historical_draft TO worker_rw;
-- The worker may only record staging results; it cannot edit drafts' data, versions, contributors or promotion columns.
GRANT UPDATE(state,row_count,error_code,staged_at,cutoff_version,policy,issues) ON historical_batch TO worker_rw;
GRANT UPDATE(state,reject_code,parsed) ON historical_batch_file TO worker_rw;
GRANT UPDATE(state,issues,ln_key,evaluation_id,updated_at) ON historical_draft TO worker_rw;
GRANT SELECT,INSERT ON historical_draft_revision,historical_eligibility_evaluation TO worker_rw;
GRANT SELECT ON historical_record,historical_verification TO worker_rw;
-- P7 A19/A21: append-only access/diagnostic evidence, never report mutation permission.
GRANT SELECT,INSERT ON result_query_export_evidence,result_reparse_evidence TO app_rw;
REVOKE UPDATE,DELETE,TRUNCATE ON result_query_export_evidence,result_reparse_evidence FROM app_rw;
GRANT SELECT ON result_query_export_evidence,result_reparse_evidence TO report_ro;

GRANT EXECUTE ON FUNCTION nipt_runtime_quarantined() TO app_rw,worker_rw,report_ro;
-- Run Photo Evidence (migration 103): optional evidence only; history is append-only and photos are never deleted.
GRANT SELECT,INSERT,UPDATE ON run_photo_storage_root,run_photo TO app_rw;
GRANT SELECT,INSERT ON run_photo_root_location,run_photo_event TO app_rw;
GRANT SELECT ON run_photo_root_current TO app_rw;
GRANT SELECT ON run_photo,run_photo_event TO report_ro;
-- Owner LAB-01/LAB-06/LAB-09/LAB-13 append-only intake, placement options and export provenance.
GRANT SELECT,INSERT ON lab_operational_registration,lab_slot40_mode,lab_batch_removal,lab_bench_export TO app_rw;
GRANT USAGE ON SEQUENCE lab_slot40_mode_sequence_seq TO app_rw;
GRANT SELECT ON lab_operational_registration TO worker_rw;
GRANT SELECT ON lab_operational_registration,lab_slot40_mode,lab_batch_removal,lab_bench_export TO report_ro;
GRANT SELECT ON lab_pet_clock_correction,his_inbound_file_current,his_order_current,specimen_round_current TO app_rw,worker_rw,report_ro;
GRANT SELECT,INSERT ON lab_manual_paper_stage TO app_rw;
GRANT USAGE ON SEQUENCE lab_manual_paper_stage_sequence_seq TO app_rw;
GRANT SELECT,INSERT ON lab_bench_review TO app_rw;
GRANT SELECT ON lab_bench_review TO report_ro;
GRANT SELECT,INSERT ON lab_actual_pooling,lab_seq_export_pair TO app_rw;
GRANT SELECT ON lab_actual_pooling,lab_seq_export_pair TO report_ro;
-- LAB-UAT-003/008: also provision grants when roles are created AFTER migrations.
GRANT SELECT,INSERT ON lab_manual_result_review TO app_rw;
GRANT EXECUTE ON FUNCTION task1_no_call_source(uuid),task1_no_call_qc5_valid(result_qc5_review) TO app_rw;
-- OWNER-LAB-051/052 (migrations 126/135): storage rows are written only by the SECURITY DEFINER functions, which also
-- write the immutable box log; the app role reads the tables and executes the functions.
REVOKE INSERT,UPDATE,DELETE ON lab_storage_box,lab_storage_position,lab_storage_typed_position,lab_storage_movement,lab_storage_box_event FROM app_rw;
REVOKE USAGE,SELECT ON SEQUENCE lab_storage_box_box_number_seq FROM app_rw;
GRANT SELECT ON lab_storage_box,lab_storage_position,lab_storage_typed_position,lab_storage_movement,lab_storage_box_event TO app_rw;
GRANT EXECUTE ON FUNCTION lab_storage_create_box(text,uuid),lab_storage_set_position(uuid,text,uuid,integer,uuid,uuid,integer),
 lab_storage_swap(uuid,uuid,text,uuid,integer,uuid,integer,uuid),lab_storage_log_label(uuid,uuid,text,uuid) TO app_rw;
-- Task 3 (migration 128): HALOS import evidence, signer profiles/delegations, internal reports, outage provenance and HIS-presence attestation.
GRANT SELECT,INSERT ON halos_import_row,report_signer_profile,report_signer_profile_event,internal_report_batch,result_external_fallback TO app_rw;
GRANT SELECT,INSERT,UPDATE ON halos_import,report_signature_delegation,internal_report,result_his_attestation TO app_rw;
GRANT USAGE ON SEQUENCE report_signer_profile_event_sequence_seq TO app_rw;
GRANT EXECUTE ON FUNCTION task3_his_presence_attested(uuid),task3_signer_profile_current(uuid),task3_internal_version_current(uuid) TO app_rw;
GRANT SELECT ON result_his_attestation TO worker_rw;
GRANT EXECUTE ON FUNCTION task3_his_presence_attested(uuid) TO worker_rw;
GRANT SELECT ON halos_import,halos_import_row,internal_report,internal_report_batch,result_external_fallback,result_his_attestation TO report_ro;
-- OWNER-LAB-056: report template registry (web role manages revisions; reads for report_ro; no deletes anywhere).
GRANT SELECT,INSERT,UPDATE ON report_template_revision,report_template_active TO app_rw;
GRANT SELECT ON report_template_revision,report_template_active TO report_ro;
-- ANC current-patient projection (inbound worker evidence on PET apply): only name/DOB through a definer function, never the draft.
GRANT EXECUTE ON FUNCTION anc_workspace_patient(uuid) TO app_rw,worker_rw;
-- PDF archive worker only: no clinical release or HIS mutation privileges.
GRANT SELECT ON pdf_archive_config,pdf_archive_window,result_release_completed TO worker_rw;
GRANT SELECT,INSERT,UPDATE ON pdf_archive_job TO worker_rw;
GRANT SELECT(id,version_id,case_id,round_id,certified_at) ON result_release TO worker_rw;
GRANT SELECT(id,case_id,round_id,sha256) ON result_report_version TO worker_rw;
GRANT SELECT(id,registration_origin) ON nipt_case TO worker_rw;
GRANT SELECT(sha256,byte_size,media_type) ON file_asset TO worker_rw;
GRANT SELECT,INSERT,UPDATE ON pdf_archive_config,pdf_archive_window TO app_rw;
REVOKE INSERT,UPDATE ON pdf_archive_probe FROM app_rw;
REVOKE UPDATE ON pdf_archive_probe FROM worker_rw;
GRANT SELECT ON pdf_archive_probe TO app_rw;
GRANT INSERT(root_path,requested_by) ON pdf_archive_probe TO app_rw;
GRANT UPDATE(used_at) ON pdf_archive_probe TO app_rw;
GRANT SELECT ON pdf_archive_job TO app_rw;
GRANT SELECT ON pdf_archive_probe TO worker_rw;
GRANT UPDATE(state,error_code,worker_account,completed_at,claimed_until,claim_token) ON pdf_archive_probe TO worker_rw;
-- Migration 160: an untrusted recovery hint, never permission to mutate job state.
GRANT INSERT(retry_job_id) ON pdf_archive_probe TO app_rw;
-- Owner migration bridge 2026-10-26: source staging never grants clinical certification to the utility.
GRANT SELECT,INSERT,UPDATE ON migration_execution,migration_record,migration_analysis TO app_rw;
GRANT SELECT,INSERT ON migration_source,migration_execution_record,migration_record_event,migration_historical_run,migration_pet_binding,migration_result_review TO app_rw;
GRANT SELECT ON migration_execution,migration_source,migration_execution_record,migration_record,migration_analysis,migration_historical_run,migration_pet_binding,migration_result_review TO report_ro;
GRANT SELECT ON migration_execution,migration_source,migration_execution_record,migration_record,migration_analysis,migration_historical_run,migration_pet_binding TO worker_rw;
GRANT SELECT,INSERT ON his_inbound_file,his_inbound_source TO app_rw;
GRANT EXECUTE ON FUNCTION migration_result_source_current(uuid),migration_result_review_current(uuid),task3_his_presence_attested(uuid) TO app_rw;
GRANT EXECUTE ON FUNCTION p6_release_eligible(uuid,integer),task3_his_presence_attested(uuid) TO worker_rw;

GRANT SELECT ON migration_allocator_handover TO app_rw;
GRANT EXECUTE ON FUNCTION migration_apply_allocator_handover(uuid,uuid,jsonb) TO app_rw;

GRANT EXECUTE ON FUNCTION migration_reserve_original_number(uuid,uuid) TO app_rw;
