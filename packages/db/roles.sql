-- Execute separately as the synthetic database owner, never as an application connection.
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
GRANT INSERT ON secret_revision TO app_rw;
GRANT SELECT(id,secret_key,key_version,created_by,created_at,tested_at,retired_at) ON secret_revision TO app_rw;
GRANT SELECT ON worker_heartbeat,settings_revision,setting_active TO app_rw;
GRANT SELECT ON settings_revision,setting_active,secret_revision,job_outbox TO worker_rw;
GRANT SELECT,INSERT,UPDATE ON integration_job_receipt TO worker_rw;
GRANT SELECT ON integration_job_receipt TO app_rw;
GRANT SELECT,INSERT ON phi_access_log TO app_rw;
GRANT INSERT ON job_outbox TO worker_rw;
GRANT SELECT,INSERT,UPDATE ON p2_workspace,p2_signing_session TO app_rw;
GRANT SELECT,INSERT ON p2_case_identity,p2_doctor_version,p2_doctor_event,p2_document_revision,p2_collection_fact,p2_paper_review,p2_consent_ack,p2_consent_signature,p2_final_consent,p2_revocation,p2_disposition,p2_document_access TO app_rw;
GRANT SELECT,INSERT ON p2_request_ack TO app_rw;
-- The deferred S1 receipt guard reads existing HIS orders even for an Expected synthetic round.
GRANT SELECT ON his_order TO app_rw;
-- P3 synthetic HIS inbound (migration 008) and P2-P3 integration grants.
GRANT SELECT,INSERT,UPDATE ON his_intake_issue,his_inbound_waiting TO worker_rw;
GRANT SELECT,INSERT ON his_intake_issue_event,his_inbound_source,his_inbound_scan_run TO worker_rw;
GRANT SELECT ON nipt_case,case_ln,specimen_round,his_order,app_user TO worker_rw;
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
