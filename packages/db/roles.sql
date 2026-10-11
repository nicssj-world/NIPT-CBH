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
