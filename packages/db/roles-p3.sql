-- P3 synthetic HIS inbound grants. Executed after roles.sql by tools/prepare-db.ts; merge into roles.sql at P2 integration.
GRANT SELECT,INSERT,UPDATE ON his_intake_issue,his_inbound_waiting TO worker_rw;
GRANT SELECT,INSERT ON his_intake_issue_event,his_inbound_source,his_inbound_scan_run TO worker_rw;
GRANT SELECT ON nipt_case,case_ln,specimen_round,his_order,app_user TO worker_rw;
GRANT SELECT,INSERT ON case_event TO worker_rw;
-- Registration-time intake linking (D-49) runs inside the web registration transaction.
GRANT SELECT,UPDATE ON his_inbound_file TO app_rw;
GRANT SELECT,INSERT ON his_order TO app_rw;
GRANT SELECT,INSERT,UPDATE ON his_intake_issue TO app_rw;
GRANT SELECT,INSERT ON his_intake_issue_event TO app_rw;
GRANT SELECT ON his_inbound_source,his_inbound_waiting,his_inbound_scan_run TO app_rw;
GRANT SELECT ON his_inbound_file,his_intake_issue,his_inbound_scan_run TO report_ro;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO app_rw,worker_rw;
