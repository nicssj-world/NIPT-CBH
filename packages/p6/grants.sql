-- Apply only in an isolated synthetic database after existing roles.sql. Never grants release writes.
DO $$ BEGIN
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='p6_fixture_writer') THEN CREATE ROLE p6_fixture_writer NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO p6_fixture_writer;
GRANT SELECT,INSERT ON p6_fixture,p6_transfer,p6_transfer_event TO p6_fixture_writer;
GRANT SELECT,INSERT ON audit_chain TO p6_fixture_writer;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO p6_fixture_writer;
GRANT SELECT ON p6_fixture,p6_transfer,p6_transfer_event TO app_rw,worker_rw,report_ro;
GRANT UPDATE ON p6_transfer TO worker_rw;
GRANT INSERT ON p6_transfer_event TO worker_rw;
GRANT SELECT,INSERT,UPDATE ON p6_worker_heartbeat TO worker_rw;
GRANT SELECT ON p6_worker_heartbeat TO app_rw,report_ro;
GRANT SELECT,INSERT ON p6_reconciliation TO worker_rw;
GRANT SELECT ON p6_reconciliation TO app_rw,report_ro;
-- Actual authority is read only and is never inferred from an ANC-view release.
GRANT SELECT ON result_release TO worker_rw;
-- Actual source validation, never writes to P5/P2; existing P6 journal is shared by both modes.
GRANT SELECT ON result_report_version,redraw_request,p2_revocation TO worker_rw;
GRANT INSERT ON p6_transfer TO worker_rw;
GRANT EXECUTE ON FUNCTION p6_release_eligible(uuid,integer) TO worker_rw,app_rw;
GRANT EXECUTE ON FUNCTION p6_lock_current_release(uuid,integer) TO worker_rw;

-- Settings-bound fixture enrollment reads approved configuration; no configuration writes.
GRANT SELECT ON settings_revision,setting_active TO p6_fixture_writer;
