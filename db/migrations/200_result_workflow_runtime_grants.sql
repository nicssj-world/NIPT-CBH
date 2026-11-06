-- Runtime-role grants for migrations 198-199.
-- Migrations run before roles.sql on a fresh installation, so roles.sql repeats these grants after role creation.
REVOKE ALL ON his_inbound_scan_state,internal_report_request,internal_report_request_item FROM PUBLIC;
DO $$ DECLARE r text; BEGIN
 FOREACH r IN ARRAY ARRAY['app_rw','worker_rw','report_ro'] LOOP
  IF EXISTS(SELECT FROM pg_roles WHERE rolname=r) THEN
   EXECUTE format('GRANT SELECT ON his_inbound_scan_state TO %I',r);
   IF r='worker_rw' THEN EXECUTE format('GRANT INSERT,UPDATE ON his_inbound_scan_state TO %I',r); END IF;
  END IF;
 END LOOP;
 -- Migration 198 granted these writes to app_rw, but only the scan worker writes current state.
 IF EXISTS(SELECT FROM pg_roles WHERE rolname='app_rw') THEN
  EXECUTE 'REVOKE INSERT,UPDATE ON his_inbound_scan_state FROM app_rw';
 END IF;
 IF EXISTS(SELECT FROM pg_roles WHERE rolname='app_rw') THEN
  EXECUTE 'GRANT SELECT ON internal_report_request,internal_report_request_item TO app_rw';
  EXECUTE 'GRANT INSERT(operator_id,session_id,idempotency_key,request) ON internal_report_request TO app_rw';
  EXECUTE 'GRANT INSERT(id,request_id,ordinal,row_id,idempotency_key,outbox_id) ON internal_report_request_item TO app_rw';
 END IF;
 IF EXISTS(SELECT FROM pg_roles WHERE rolname='worker_rw') THEN
  EXECUTE 'GRANT SELECT ON internal_report_request,internal_report_request_item TO worker_rw';
  EXECUTE 'GRANT UPDATE(state,outcome,finalization_batch_id,completed_at) ON internal_report_request_item TO worker_rw';
 END IF;
END $$;
